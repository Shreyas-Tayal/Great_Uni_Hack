"""
Foresight forecast engine: Monte Carlo cash-flow simulation, cliff alerts, fix-it actions.

    model  = build_model(profile)
    result = forecast(model, days=90, adjustments=[...])

Adjustments (shared vocabulary for the UI, n8n and the LLM - see contracts/adjustments.md):
    {"type": "cut_spend", "weekly": 20}
    {"type": "shift_stream", "stream_id": "...", "days": 5}
    {"type": "remove_stream", "stream_id": "..."}
    {"type": "scale_stream", "stream_id": "...", "factor": 0.75}
    {"type": "income_change", "factor": 0.8}
    {"type": "one_off", "amount": -300, "in_days": 10, "label": "Boiler repair"}
    {"type": "invoice_on_time"}                       business: chase overdue invoices
    {"type": "invoice_finance", "advance": 0.8}       business: advance on unpaid invoices
    {"type": "client_late", "extra_days": 30}         business: what if clients pay later

OWNER: Person 1.
"""
from __future__ import annotations

import json
import statistics as st
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

from .modes import MODES, categorise
from .recurring import Detection, detect, evaluate, normalise

N_PATHS = 1000
SEED = 7  # fixed -> common random numbers, so action deltas reflect the action not noise


@dataclass
class Model:
    profile: dict
    mode: str
    today: date
    balance: float
    det: Detection
    residual_by_wd: list[np.ndarray]
    season: dict[int, float] = field(default_factory=dict)   # month -> spending multiplier
    invoices: list[dict] = field(default_factory=list)   # unpaid + projected
    lateness: dict[str, list[int]] = field(default_factory=dict)
    history: list[dict] = field(default_factory=list)
    detection_score: dict = field(default_factory=dict)


# ------------------------------------------------------------------ build
def build_model(profile: dict) -> Model:
    txns = profile["transactions"]
    today = date.fromisoformat(profile["as_of"])
    mode = profile["mode"]
    invoices = profile.get("invoices", [])

    client_keys = {normalise(i["client"]).split(" ")[0] for i in invoices}
    det = detect(txns, today, exclude_keys=client_keys)

    # Residual = day-to-day spending not explained by recurring streams or invoices.
    window = [t for t in txns if (today - date.fromisoformat(t["date"])).days < 91
              and t["id"] not in det.recurring_txn_ids
              and not any(normalise(t["description"]).startswith(k) for k in client_keys)]
    desc_count = defaultdict(int)
    for t in txns:
        desc_count[normalise(t["description"])] += 1
    window = [t for t in window if not (abs(t["amount"]) > 500 and desc_count[normalise(t["description"])] == 1)]
    abs_amts = sorted(abs(t["amount"]) for t in window) or [0]
    cap = max(150.0, 5 * abs_amts[len(abs_amts) // 2])   # robust: 5x median
    daily = defaultdict(float)
    for t in window:
        if abs(t["amount"]) <= cap:            # big one-offs are shocks, not habits
            daily[t["date"]] += t["amount"]
    by_wd: list[list[float]] = [[] for _ in range(7)]
    for i in range(91):
        d = today - timedelta(days=i)
        by_wd[d.weekday()].append(daily.get(d.isoformat(), 0.0))

    # Seasonality ("financial time travel"): how last year's same month compared with the average
    month_out: dict[int, list[float]] = defaultdict(list)
    for t in txns:
        if t["id"] not in det.recurring_txn_ids and t["amount"] < 0 and abs(t["amount"]) <= cap:
            month_out[int(t["date"][5:7])].append(-t["amount"])
    totals = {m: sum(v) for m, v in month_out.items()}
    avg = st.mean(totals.values()) if totals else 1.0
    season = {m: float(np.clip(v / avg, 0.7, 1.6)) for m, v in totals.items()}
    recent_level = st.mean([season.get((today - timedelta(days=30 * i)).month, 1.0) for i in range(3)])
    season = {m: v / recent_level for m, v in season.items()}   # residual pool already reflects recent months

    # Invoices: lateness history per client, unpaid ones, and projected future monthly invoices
    late: dict[str, list[int]] = defaultdict(list)
    for inv in invoices:
        if inv["paid_date"]:
            late[inv["client"]].append((date.fromisoformat(inv["paid_date"]) - date.fromisoformat(inv["due"])).days)
    future = [dict(i) for i in invoices if not i["paid_date"]]
    by_client = defaultdict(list)
    for inv in invoices:
        by_client[inv["client"]].append(inv)
    for client, invs in by_client.items():
        invs.sort(key=lambda x: x["issued"])
        issued = [date.fromisoformat(i["issued"]) for i in invs]
        gaps = [(b - a).days for a, b in zip(issued, issued[1:])]
        if len(invs) >= 3 and gaps and 25 <= st.median(gaps) <= 35:
            terms = st.median([(date.fromisoformat(i["due"]) - date.fromisoformat(i["issued"])).days for i in invs])
            amt = st.mean(i["amount"] for i in invs)
            d = issued[-1]
            for _ in range(4):
                d = _add_month_first_wd(d)
                future.append({"id": f"proj-{client}-{d}", "client": client, "issued": d.isoformat(),
                               "due": (d + timedelta(days=terms)).isoformat(), "amount": round(amt, 2),
                               "paid_date": None, "status": "projected"})

    # History for the left side of the chart (actual end-of-day balance, last 60 days)
    eod: dict[str, float] = {}
    for t in txns:
        eod[t["date"]] = t["balance"]
    hist, last = [], profile["opening_balance"]
    for i in range(60, 0, -1):
        d = (today - timedelta(days=i - 1)).isoformat()
        last = eod.get(d, last)
        hist.append({"date": d, "balance": round(last, 2)})

    return Model(profile=profile, mode=mode, today=today, balance=profile["closing_balance"], det=det,
                 residual_by_wd=[np.array(x) for x in by_wd], season=season, invoices=future, lateness=dict(late),
                 history=hist, detection_score=evaluate(txns, det))


def _add_month_first_wd(d: date) -> date:
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    n = date(y, m, 1)
    while n.weekday() >= 5:
        n += timedelta(days=1)
    return n


# ------------------------------------------------------------------ simulate
def _simulate(model: Model, days: int, adjustments: list[dict], n: int = N_PATHS):
    rng = np.random.default_rng(SEED)
    T, today = days, model.today
    end = today + timedelta(days=T)
    flows = np.zeros((n, T))
    events: list[dict] = []  # deterministic schedule for "upcoming" + alert explanations

    adj = defaultdict(list)
    for a in adjustments:
        adj[a["type"]].append(a)
    removed = {a["stream_id"] for a in adj["remove_stream"]}
    shifts = {a["stream_id"]: int(a["days"]) for a in adj["shift_stream"]}
    scales = {a["stream_id"]: float(a["factor"]) for a in adj["scale_stream"]}
    income_factor = np.prod([a["factor"] for a in adj["income_change"]]) if adj["income_change"] else 1.0

    def factor(sid: str, direction: str) -> float:
        return scales.get(sid, 1.0) * (income_factor if direction == "in" else 1.0)

    # Fixed-cadence streams
    for s in model.det.cadence:
        if s.id in removed:
            continue
        sh = shifts.get(s.id, 0)
        for k, d in enumerate(s.next_dates(today, end)):
            d2 = d + timedelta(days=sh)
            idx = (d2 - today).days - 1
            mean = s.amount_on(d, k) * factor(s.id, s.direction)
            sd = s.amount_std * factor(s.id, s.direction)
            amt = rng.normal(mean, sd, n) if sd > 0 else np.full(n, mean)
            if s.hit_rate < 0.9:                       # e.g. a side gig that pays most weeks
                amt = amt * (rng.random(n) < s.hit_rate)
            amt = np.maximum(amt, 0) if s.direction == "in" else np.minimum(amt, 0)
            # Draw even when the shifted receipt falls outside the horizon. This
            # keeps all other streams on the same random draws as the baseline.
            if not 0 <= idx < T:
                continue
            flows[:, idx] += amt
            events.append({"date": d2.isoformat(), "label": s.label, "amount": round(mean, 2),
                           "stream_id": s.id, "cadence": s.cadence, "shifted": sh != 0})

    # Frequent weekday streams
    for s in model.det.weekday:
        if s.id in removed:
            continue
        f = factor(s.id, s.direction)
        sh = shifts.get(s.id, 0)
        for t in range(T):
            wd = (today + timedelta(days=t + 1)).weekday()
            pool = s.amounts_by_weekday[wd]
            if not pool:
                continue
            hit = rng.random(n) < s.p_by_weekday[wd]
            amt = hit * rng.choice(pool, n) * f
            idx = t + sh
            if 0 <= idx < T:
                flows[:, idx] += amt

    # Day-to-day residual spending (bootstrapped by weekday)
    cut = sum(a["weekly"] for a in adj["cut_spend"]) / 7.0
    for t in range(T):
        day = today + timedelta(days=t + 1)
        r = rng.choice(model.residual_by_wd[day.weekday()], n)
        r = np.where(r < 0, r * model.season.get(day.month, 1.0), r)
        flows[:, t] += np.where(r < 0, np.minimum(r + cut, 0), r) if cut else r

    # Invoices with uncertain payment dates
    pooled = [x for v in model.lateness.values() for x in v] or [0, 7, 14, 30]
    extra = sum(a["extra_days"] for a in adj["client_late"])
    on_time = bool(adj["invoice_on_time"])
    advance = adj["invoice_finance"][0].get("advance", 0.8) if adj["invoice_finance"] else 0.0
    for inv in model.invoices:
        due = date.fromisoformat(inv["due"])
        overdue_by = max(0, (today - due).days)
        pool = np.array(model.lateness.get(inv["client"]) or pooled)
        amount = inv["amount"]
        if advance and inv["status"] in ("overdue", "outstanding"):
            flows[:, 0] += amount * advance * 0.97          # 3% fee
            events.append({"date": (today + timedelta(days=1)).isoformat(), "label": f"Invoice finance: {inv['client']}",
                           "amount": round(amount * advance * 0.97, 2), "stream_id": "invoice_finance"})
            amount *= (1 - advance)
        if on_time and inv["status"] != "projected":
            lag = rng.integers(3, 10, n) + overdue_by if overdue_by else np.zeros(n, int)
        else:
            lag = rng.choice(pool, n) + extra
            if overdue_by:  # condition on it already being this late
                lag = np.maximum(lag, overdue_by + rng.integers(3, 21, n))
        pay_idx = (due - today).days + lag - 1
        pay_idx = np.maximum(pay_idx, 0)
        ok = pay_idx < T
        np.add.at(flows, (np.nonzero(ok)[0], pay_idx[ok].astype(int)), amount)
        events.append({"date": inv["due"], "label": f"Invoice due from {inv['client']}", "amount": round(amount, 2),
                       "stream_id": "invoices", "uncertain": True})

    for a in adj["one_off"]:
        idx = max(0, int(a["in_days"]) - 1)
        if idx < T:
            flows[:, idx] += a["amount"]
            events.append({"date": (today + timedelta(days=idx + 1)).isoformat(),
                           "label": a.get("label", "One-off"), "amount": a["amount"], "stream_id": "one_off"})

    bal = model.balance + np.cumsum(flows, axis=1)
    events.sort(key=lambda e: e["date"])
    return bal, events


# ------------------------------------------------------------------ outputs
def _nice(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b')}"


def _alerts(model: Model, p_neg: np.ndarray, events: list[dict], dates: list[str]) -> list[dict]:
    thr = MODES[model.mode]["risk_threshold"]
    alerts, t, T = [], 0, len(p_neg)
    while t < T and len(alerts) < 3:
        if p_neg[t] >= thr:
            s = t
            while t < T and p_neg[t] >= thr * 0.6:
                t += 1
            e = t - 1
            peak = int(s + np.argmax(p_neg[s:e + 1]))
            lo = (model.today + timedelta(days=s - 4)).isoformat()
            causes = sorted([ev for ev in events if lo <= ev["date"] <= dates[peak] and ev["amount"] < 0],
                            key=lambda ev: ev["amount"])[:2]
            cause_txt = " and ".join(f"{c['label']} (£{abs(c['amount']):,.0f}) on {_nice(c['date'])}" for c in causes)
            chance = f"{round(p_neg[peak] * 10)} out of 10"
            alerts.append({
                "id": f"alert-{dates[s]}", "start": dates[s], "end": dates[e], "peak_date": dates[peak],
                "p_negative": round(float(p_neg[peak]), 3), "window": [s, e], "causes": causes,
                "title": (f"{causes[0]['label']} before money comes in" if causes else "Balance likely to dip below zero"),
                "explanation": (f"{cause_txt} {'land' if len(causes) > 1 else 'lands'} before enough money arrives. "
                                f"In {chance} simulated futures, your balance goes below £0 "
                                f"around {_nice(dates[peak])}.") if causes else
                               f"In {chance} simulated futures, your balance goes below £0 around {_nice(dates[peak])}.",
            })
        t += 1
    return alerts


def _candidate_actions(model: Model, alert: dict) -> list[dict]:
    seen, out = set(), []
    for x in _raw_candidates(model, alert):
        key = json.dumps({k: v for k, v in x.items() if k != "label"}, sort_keys=True)
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


def _raw_candidates(model: Model, alert: dict) -> list[dict]:
    cfg = MODES[model.mode]
    c = [{"type": "cut_spend", "weekly": w, "label": f"Spend £{w} less a week on day-to-day costs"}
         for w in cfg["cut_spend_options"]]
    for cause in alert["causes"]:
        if cause["stream_id"] not in ("invoices", "one_off", "invoice_finance"):
            c.append({"type": "shift_stream", "stream_id": cause["stream_id"], "days": cfg["shift_days"],
                      "label": f"Ask to move {cause['label']} {cfg['shift_days']} days later"})
    for s in model.det.cadence:
        if s.direction == "out" and s.cadence == "monthly" and abs(s.amount_mean) <= cfg["small_subscription_max"] \
                and "DD" not in s.label.upper():
            c.append({"type": "remove_stream", "stream_id": s.id, "label": f"Pause {s.label} for now"})
    if model.mode == "business" and any(i["status"] in ("overdue", "outstanding") for i in model.invoices):
        c.append({"type": "invoice_on_time", "label": "Chase overdue invoices today"})
        c.append({"type": "invoice_finance", "advance": 0.8, "label": "Get 80% of unpaid invoices advanced now"})
    return c


def forecast(model: Model, days: int = 90, adjustments: list[dict] | None = None,
             with_actions: bool = True) -> dict:
    adjustments = adjustments or []
    bal, events = _simulate(model, days, adjustments)
    dates = [(model.today + timedelta(days=i + 1)).isoformat() for i in range(days)]
    p10, p50, p90 = np.percentile(bal, [10, 50, 90], axis=0)
    p_neg = (bal < 0).mean(axis=0)
    alerts = _alerts(model, p_neg, events, dates)

    if with_actions:
        for a in alerts[:1]:  # rank fixes for the first (most urgent) cliff
            s, e = a["window"]
            lo, hi = max(0, s - 7), min(days, e + 8)
            ranked = []
            for cand in _candidate_actions(model, a):
                b2, _ = _simulate(model, days, adjustments + [cand])
                new_p = float((b2[:, lo:hi] < 0).mean(axis=0).max())
                ranked.append({"adjustment": {k: v for k, v in cand.items() if k != "label"},
                               "label": cand["label"], "new_p_negative": round(new_p, 3)})
            ranked.sort(key=lambda x: x["new_p_negative"])
            a["actions"] = ranked[:3]

    return {
        "profile_id": model.profile["profile_id"], "mode": model.mode, "as_of": model.today.isoformat(),
        "balance_now": model.balance, "hero": _hero(model, bal, days),
        "history": model.history,
        "bands": [{"date": d, "p10": round(float(a), 2), "p50": round(float(b), 2), "p90": round(float(c), 2),
                   "p_negative": round(float(p), 3)} for d, a, b, c, p in zip(dates, p10, p50, p90, p_neg)],
        "alerts": alerts,
        "upcoming": [e for e in events if e["date"] <= dates[min(29, days - 1)]][:25],
        "adjustments": adjustments,
        "risk_summary": {"peak_p_negative": round(float(p_neg.max()), 3),
                         "low_point_p50": round(float(p50.min()), 2),
                         "low_point_date": dates[int(np.argmin(p50))]},
    }


def _hero(model: Model, bal: np.ndarray, days: int) -> dict:
    if model.mode == "personal":
        safe = float(np.percentile(bal[:, :14].min(axis=1), 20))
        return {"label": MODES["personal"]["hero_label"], "value": round(max(0.0, safe), 2), "unit": "GBP",
                "note": "Keeps you above £0 in 4 out of 5 simulated futures"}
    # Business: runway from the median simulated path
    p50 = np.percentile(bal, 50, axis=0)
    burn_per_day = (model.balance - float(p50[-1])) / days
    below = np.nonzero(p50 < 0)[0]
    if len(below):
        weeks = round(float(below[0] + 1) / 7, 1)
    elif burn_per_day > 0:
        weeks = round(float(model.balance / burn_per_day / 7), 1)
    else:
        weeks = None
    overdue = sum(i["amount"] for i in model.invoices if i["status"] == "overdue")
    return {"label": MODES["business"]["hero_label"], "value": weeks, "unit": "weeks",
            "note": "Cash-flow positive" if weeks is None else "Based on the median simulated future",
            "kpis": [{"label": "Cash now", "value": round(model.balance, 2), "unit": "GBP"},
                     {"label": "Overdue invoices", "value": round(overdue, 2), "unit": "GBP"},
                     {"label": "Avg daily burn (forecast)", "value": round(burn_per_day, 2), "unit": "GBP"}]}


def summary(model: Model) -> dict:
    """Backward-looking view for charts: monthly in/out, spending by category, recurring list."""
    txns, mode = model.profile["transactions"], model.mode
    months: dict[str, dict] = defaultdict(lambda: {"in": 0.0, "out": 0.0})
    cats: dict[str, float] = defaultdict(float)
    for t in txns:
        m = t["date"][:7]
        months[m]["in" if t["amount"] > 0 else "out"] += t["amount"]
        if t["amount"] < 0 and (model.today - date.fromisoformat(t["date"])).days < 90:
            cats[categorise(t["description"], mode)] += -t["amount"]
    end = model.today + timedelta(days=60)
    recurring = []
    for s in model.det.cadence:
        nxt = s.next_dates(model.today, end)
        recurring.append({"stream_id": s.id, "label": s.label, "cadence": s.cadence, "direction": s.direction,
                          "amount": s.amount_mean, "next_date": nxt[0].isoformat() if nxt else None})
    for s in model.det.weekday:
        avg = sum(p * (st.mean(a) if a else 0) for p, a in zip(s.p_by_weekday, s.amounts_by_weekday))
        recurring.append({"stream_id": s.id, "label": s.label, "cadence": "weekly (variable)",
                          "direction": s.direction, "amount": round(avg, 2), "next_date": None})
    return {
        "profile_id": model.profile["profile_id"], "name": model.profile["name"], "mode": mode,
        "tagline": model.profile["tagline"], "balance_now": model.balance,
        "monthly": [{"month": k, "in": round(v["in"], 2), "out": round(-v["out"], 2)} for k, v in sorted(months.items())],
        "categories_90d": sorted([{"category": k, "amount": round(v, 2)} for k, v in cats.items()],
                                 key=lambda x: -x["amount"]),
        "recurring": sorted(recurring, key=lambda r: r["amount"]),
        "invoices": [i for i in model.profile.get("invoices", []) if i["status"] != "paid"],
        "detection_score": model.detection_score,
    }
