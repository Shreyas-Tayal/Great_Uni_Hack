"""
Recurring cash-flow detection from raw bank descriptions.

Two kinds of stream:
  CadenceStream  - fixed schedule (weekly, fortnightly, 4-weekly, monthly, quarterly, semiannual)
  WeekdayStream  - frequent, irregular flows tied to weekdays (card takings, Stripe payouts,
                   gig payouts, supplier deliveries). Modelled as P(occurs | weekday) x empirical amounts.

OWNER: Person 1. The engine never reads the generator's `_category` / `_recurring_id`;
use them only in evaluate() to score detection accuracy.
"""
from __future__ import annotations

import re
import statistics as st
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

_DIGIT_TOKEN = re.compile(r"\b[A-Z0-9*]*\d[A-Z0-9*]*\b")
_JUNK = re.compile(r"[^A-Z&' ]")

CADENCES = [  # name, period days, tolerance days, min occurrences
    ("weekly", 7, 1.5, 4),
    ("fortnightly", 14, 2.5, 4),
    ("monthly", 30.44, 4.5, 3),     # checked before four_weekly: month-end shifts look like ~28-33d
    ("four_weekly", 28, 1.5, 3),
    ("quarterly", 91.3, 9, 3),
    ("semiannual", 182.6, 12, 2),
]


def normalise(desc: str) -> str:
    """'TESCO STORES 2041 MANCHESTER' -> 'TESCO STORES MANCHESTER'; 'DWP UC 7KX2P9QA' -> 'DWP UC'."""
    d = _DIGIT_TOKEN.sub(" ", desc.upper().replace("*", " "))
    d = _JUNK.sub(" ", d)
    # drop random 8-letter payment refs (few vowels), keep real words
    toks = [t for t in d.split() if not (len(t) == 8 and sum(c in "AEIOU" for c in t) <= 1)]
    return " ".join(toks).strip()


_ACRONYMS = {"HMRC", "VAT", "PAYE", "UC", "DWP", "BT", "AWS", "EE", "NNDR", "CC", "UK", "SLC", "MCR", "BACS"}
_PREFIXES = ("DD ", "SO ", "FPS ", "BACS ")


def pretty(key: str) -> str:
    """'DD OCTOPUS ENERGY' -> 'Octopus Energy'; 'HMRC VAT' -> 'HMRC VAT'."""
    for p in _PREFIXES:
        if key.startswith(p) and len(key) > len(p) + 2:
            key = key[len(p):]
    return " ".join(w if w in _ACRONYMS else w.capitalize() for w in key.split())


@dataclass
class CadenceStream:
    id: str
    label: str
    cadence: str
    period: float
    direction: str            # "in" | "out"
    amount_mean: float        # signed
    amount_std: float
    amounts: list[float]
    dates: list[date]
    day_of_month: int | None = None
    hit_rate: float = 1.0      # share of expected slots that actually paid (weekly/fortnightly)
    kind: str = "cadence"

    def next_dates(self, after: date, until: date) -> list[date]:
        out = []
        if self.cadence == "annual":
            return [d2 for d in self.dates for d2 in (_plus_year(d),) if after < d2 <= until]
        if self.cadence in ("monthly", "quarterly", "semiannual"):
            step = {"monthly": 1, "quarterly": 3, "semiannual": 6}[self.cadence]
            y, m = self.dates[-1].year, self.dates[-1].month
            while True:
                m += step
                while m > 12:
                    y, m = y + 1, m - 12
                d = _safe_date(y, m, self.day_of_month or self.dates[-1].day)
                while d.weekday() >= 5:
                    d += timedelta(days=1)
                if d > until:
                    break
                if d > after:
                    out.append(d)
        else:
            d = self.dates[-1]
            while True:
                d += timedelta(days=round(self.period))
                if d > until:
                    break
                if d > after:
                    out.append(d)
        return out

    def amount_on(self, d: date, k: int) -> float:
        if self.cadence == "annual":
            for past, a in zip(self.dates, self.amounts):
                if _plus_year(past) == d:
                    return a
        return self.amount_for(k)

    def amount_for(self, k: int) -> float:
        """Expected amount of the k-th future occurrence (semiannual alternates, e.g. Jan vs Jul tax)."""
        if self.cadence == "semiannual" and len(self.amounts) >= 2:
            return self.amounts[-2] if k % 2 == 0 else self.amounts[-1]
        return self.amount_mean


@dataclass
class WeekdayStream:
    id: str
    label: str
    direction: str
    p_by_weekday: list[float]
    amounts_by_weekday: list[list[float]]
    kind: str = "weekday"


@dataclass
class Detection:
    cadence: list[CadenceStream] = field(default_factory=list)
    weekday: list[WeekdayStream] = field(default_factory=list)
    recurring_txn_ids: set[str] = field(default_factory=set)


def _safe_date(y: int, m: int, d: int) -> date:
    import calendar
    return date(y, m, min(d, calendar.monthrange(y, m)[1]))


def _plus_year(d: date) -> date:
    try:
        n = d.replace(year=d.year + 1)
    except ValueError:
        n = d.replace(year=d.year + 1, day=28)
    while n.weekday() >= 5:
        n += timedelta(days=1)
    return n


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:40]


def detect(transactions: list[dict], as_of: date, exclude_keys: set[str] | None = None) -> Detection:
    exclude_keys = exclude_keys or set()
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in transactions:
        key = normalise(t["description"])
        if any(key.startswith(x) for x in exclude_keys):
            continue
        groups[(key, "in" if t["amount"] > 0 else "out")].append(t)

    det = Detection()
    for (key, direction), txns in groups.items():
        txns.sort(key=lambda t: t["date"])
        dates = [date.fromisoformat(t["date"]) for t in txns]
        amounts = [t["amount"] for t in txns]
        # Ignore streams that stopped (no occurrence in the last ~2 periods / 120 days)
        if (as_of - dates[-1]).days > 200:
            continue

        # 1) Frequent flows -> weekday model (needs density: >= 1 per 2 weeks over 120d)
        recent = [(d, a) for d, a in zip(dates, amounts) if (as_of - d).days <= 120]
        if len(recent) >= 18:
            ints = [(b - a).days for a, b in zip(dates, dates[1:])]
            if ints and st.median(ints) <= 6:
                counts, amts = [0] * 7, [[] for _ in range(7)]
                for d, a in recent:
                    counts[d.weekday()] += 1
                    amts[d.weekday()].append(a)
                n_wd = [sum(1 for i in range(120) if (as_of - timedelta(days=i)).weekday() == w) for w in range(7)]
                det.weekday.append(WeekdayStream(
                    id=_slug(key) + "_" + direction, label=pretty(key), direction=direction,
                    p_by_weekday=[min(1.0, counts[w] / n_wd[w]) for w in range(7)],
                    amounts_by_weekday=amts))
                det.recurring_txn_ids.update(t["id"] for t in txns)
                continue

        # 2) Fixed cadence
        if len(dates) < 2:
            continue
        matched = False
        ints = [(b - a).days for a, b in zip(dates, dates[1:])]
        med = st.median(ints)
        for name, period, tol, min_n in CADENCES:
            if len(dates) < min_n or abs(med - period) > tol:
                continue
            ok = sum(1 for i in ints if abs(i - period) <= tol) / len(ints)
            if ok < 0.6 and not (name == "monthly" and ok >= 0.5):
                continue
            if name == "semiannual" and abs(st.mean(amounts)) < 100:
                continue
            recent_amts = amounts[-max(3, int(90 / period)):]   # ~last 90 days: tracks pay rises, new hires
            mean = st.mean(recent_amts)
            std = st.pstdev(amounts[-6:]) if len(amounts) > 1 else 0.0
            dom = st.mode([d.day for d in dates]) if name in ("monthly", "quarterly", "semiannual") else None
            slots = 1 + (dates[-1] - dates[0]).days / period
            hit = min(1.0, len(dates) / slots) if name in ("weekly", "fortnightly") else 1.0
            det.cadence.append(CadenceStream(
                id=_slug(key) + "_" + direction, label=pretty(key), cadence=name, period=period,
                direction=direction, amount_mean=round(mean, 2), amount_std=round(std, 2),
                amounts=amounts, dates=dates, day_of_month=dom, hit_rate=round(hit, 3)))
            det.recurring_txn_ids.update(t["id"] for t in txns)
            matched = True
            break
        # 3) Irregular but large and repeated (student loan instalments, tax bills): assume
        #    each occurrence repeats on the same date next year
        if not matched and abs(st.mean(amounts)) >= 300:
            det.cadence.append(CadenceStream(
                id=_slug(key) + "_" + direction, label=pretty(key), cadence="annual", period=365,
                direction=direction, amount_mean=round(st.mean(amounts), 2), amount_std=0.0,
                amounts=amounts, dates=dates))
            det.recurring_txn_ids.update(t["id"] for t in txns)
    return det


def evaluate(transactions: list[dict], det: Detection) -> dict:
    """Precision/recall of recurring flagging vs generator ground truth (debug + pitch stat)."""
    truth = {t["id"] for t in transactions if t.get("_recurring_id")}
    pred = det.recurring_txn_ids
    tp = len(truth & pred)
    return {"precision": round(tp / max(1, len(pred)), 3), "recall": round(tp / max(1, len(truth)), 3),
            "streams": len(det.cadence) + len(det.weekday)}
