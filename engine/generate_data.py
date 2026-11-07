#!/usr/bin/env python3
"""
Foresight: synthetic bank transaction generator.

Generates 12 months of realistic UK bank-feed data for 5 demo profiles:
  personal: amara (single parent, wages + Universal Credit), jay (gig rider),
            sam (student, loan instalments + bar job)
  business: corner_cup (café, quarterly rent, VAT, late-paying catering client),
            lumen_labs (4-person SaaS startup, Stripe payouts, enterprise invoices)

Each profile is written to <out>/<id>.json, plus <out>/index.json for the
frontend profile switcher.

Design notes
- Descriptions look like raw bank feeds ("TESCO STORES 2041 MANCHESTER",
  "DD OCTOPUS ENERGY"), so the engine has to do real recurring detection.
- Every transaction carries hidden ground-truth fields (_category,
  _recurring_id). The engine must NOT read these; use them to evaluate
  recurring detection and to debug.
- Built-in "cliffs" for the demo: Amara's rent lands before payday, Jay's
  January self-assessment tax bill, Sam's gap before the January loan,
  the café's VAT + quarterly rent collision in December, Lumen's overdue
  enterprise invoice.
- Deterministic: same --seed gives identical output.

Usage:
  python generate_data.py                      # defaults below
  python generate_data.py --seed 7 --out ../data/profiles --as-of 2026-11-07
"""
from __future__ import annotations

import argparse
import calendar
import json
import math
import random
import string
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Iterable, Optional, Union

Amount = Union[float, Callable[[date], Optional[float]]]


# ---------------------------------------------------------------- date utils
def month_iter(start: date, end: date) -> Iterable[tuple[int, int]]:
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def dom(y: int, m: int, day: int) -> date:
    """Day of month, clamped; day=-1 means last day."""
    last = calendar.monthrange(y, m)[1]
    return date(y, m, last if day == -1 else min(day, last))


def next_wd(d: date) -> date:
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def prev_wd(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


# ------------------------------------------------------------------- ledger
@dataclass
class Txn:
    date: date
    description: str
    amount: float
    category: str
    recurring_id: Optional[str]


class Ledger:
    def __init__(self, start: date, end: date, rng: random.Random):
        self.start, self.end, self.rng = start, end, rng
        self.txns: list[Txn] = []

    # -- primitives
    def fill(self, desc: str) -> str:
        r = self.rng
        return (desc.replace("{n}", str(r.randint(1000, 9999)))
                    .replace("{ref}", "".join(r.choices(string.ascii_uppercase, k=2)) + str(r.randint(100000, 999999))))

    def add(self, d: date, desc: str, amount: Optional[float], cat: str, rid: Optional[str] = None):
        if amount is None or not (self.start <= d <= self.end):
            return
        self.txns.append(Txn(d, self.fill(desc), round(amount, 2), cat, rid))

    def days(self) -> Iterable[date]:
        d = self.start
        while d <= self.end:
            yield d
            d += timedelta(days=1)

    @staticmethod
    def _amt(a: Amount, d: date) -> Optional[float]:
        return a(d) if callable(a) else a

    # -- schedules
    def monthly(self, day: int, desc: str, amount: Amount, cat: str, rid: str,
                shift: str = "next", months: Optional[set[int]] = None):
        for y, m in month_iter(self.start, self.end):
            if months and m not in months:
                continue
            d = dom(y, m, day)
            d = next_wd(d) if shift == "next" else prev_wd(d) if shift == "prev" else d
            self.add(d, desc, self._amt(amount, d), cat, rid)

    def every(self, first: date, step: int, desc: str, amount: Amount, cat: str, rid: str,
              shift: str = "none"):
        d = first
        while d < self.start:
            d += timedelta(days=step)
        while d <= self.end:
            pd = next_wd(d) if shift == "next" else d
            self.add(pd, desc, self._amt(amount, pd), cat, rid)
            d += timedelta(days=step)

    def weekly_on(self, weekdays: set[int], desc: str, amount: Amount, cat: str, rid: str):
        for d in self.days():
            if d.weekday() in weekdays:
                self.add(d, desc, self._amt(amount, d), cat, rid)

    def once(self, d: date, desc: str, amount: float, cat: str):
        self.add(d, desc, amount, cat, None)

    def spend(self, merchants: list[str], cat: str, prob: float, mean: float, sigma: float = 0.5,
              weekday_mult: Optional[list[float]] = None, month_mult: Optional[dict[int, float]] = None,
              active: Optional[Callable[[date], bool]] = None):
        """Random card spending: Bernoulli per day x lognormal amount."""
        r = self.rng
        for d in self.days():
            if active and not active(d):
                continue
            p = prob * (weekday_mult[d.weekday()] if weekday_mult else 1.0)
            if r.random() < min(p, 0.95):
                mm = month_mult.get(d.month, 1.0) if month_mult else 1.0
                mu = math.log(mean * mm) - sigma ** 2 / 2
                amt = max(0.5, r.lognormvariate(mu, sigma))
                self.add(d, r.choice(merchants), -amt, cat, None)


def gauss_pos(r: random.Random, mu: float, sd: float, floor: float = 0.0) -> float:
    return max(floor, r.gauss(mu, sd))


# ------------------------------------------------------------ invoice model
def invoice_flow(L: Ledger, invoices: list[dict], client: str, issued: date, amount: float,
                 terms: int, lag_days: int, desc: str, rid: str):
    """Records an invoice and, if paid by the end date, the matching receipt."""
    due = issued + timedelta(days=terms)
    paid = next_wd(due + timedelta(days=lag_days))
    is_paid = paid <= L.end
    invoices.append({
        "id": f"INV-{len(invoices) + 1001}",
        "client": client,
        "issued": issued.isoformat(),
        "due": due.isoformat(),
        "amount": round(amount, 2),
        "paid_date": paid.isoformat() if is_paid else None,
        "status": "paid" if is_paid else ("overdue" if due < L.end else "outstanding"),
        "days_late": max(0, (paid - due).days) if is_paid else max(0, (L.end - due).days),
    })
    if is_paid:
        L.add(paid, desc, amount, "income:invoice", rid)


# ================================================================= PERSONAL
def build_amara(L: Ledger):
    """Single parent, 2 kids. Part-time care work + Universal Credit (55% taper)."""
    r = L.rng
    wages = {(y, m): round(gauss_pos(r, 810, 70, 500), 2)
             for y, m in month_iter(L.start - timedelta(days=45), L.end)}

    def wage(d):
        return wages[(d.year, d.month)]

    def uc(d):  # UC this month depends on last month's earnings
        py, pm = (d.year, d.month - 1) if d.month > 1 else (d.year - 1, 12)
        return round(1180 - 0.55 * max(0.0, wages[(py, pm)] - 404), 2)

    L.monthly(28, "BRIGHTCARE LTD SALARY", wage, "income:wages", "wages", shift="prev")
    L.monthly(6, "DWP UC {ref}", uc, "income:benefits", "universal_credit")
    L.every(date(2025, 11, 10), 28, "HMRC CHILD BENEFIT", 172.80, "income:benefits", "child_benefit")

    L.monthly(1, "SO HOMELY HOUSING ASSOC", -725.00, "housing:rent", "rent")
    L.monthly(15, "DD MANCHESTER CITY COUNCIL", -112.00, "bills:council_tax", "council_tax",
              months={4, 5, 6, 7, 8, 9, 10, 11, 12, 1})
    L.monthly(10, "DD OCTOPUS ENERGY", -118.00, "bills:energy", "energy")
    L.monthly(20, "DD UNITED UTILITIES", -38.00, "bills:water", "water")
    L.monthly(5, "DD VIRGIN MEDIA", -28.00, "bills:broadband", "broadband")
    L.monthly(12, "DD EE LIMITED", -20.00, "bills:phone", "phone")
    L.monthly(9, "NETFLIX.COM", -5.99, "subscriptions", "netflix", shift="none")

    L.spend(["TESCO STORES {n} MANCHESTER", "ALDI {n} MANCHESTER", "LIDL GB MANCHESTER",
             "ASDA SUPERSTORE {n}"], "groceries", 0.40, 36, 0.45, month_mult={12: 1.35})
    L.spend(["STAGECOACH BUS {n}", "TFGM METROLINK"], "transport", 0.45, 3.2, 0.3,
            weekday_mult=[1, 1, 1, 1, 1, 0.4, 0.3])
    L.spend(["CASH ATM {n} MANCHESTER"], "cash", 0.12, 30, 0.3)
    L.spend(["PARENTPAY {ref}", "PRIMARK MANCHESTER", "CLARKS {n}", "SMYTHS TOYS {n}"],
            "children", 0.08, 22, 0.6)
    L.spend(["JUST EAT.CO.UK", "MCDONALDS {n}", "GREGGS {n}"], "eating_out", 0.12, 11, 0.5)
    L.spend(["B&M RETAIL {n}", "HOME BARGAINS {n}", "BOOTS {n}"], "household", 0.10, 14, 0.5)
    # Seasonal shocks
    L.spend(["ARGOS {n}", "SMYTHS TOYS {n}", "PRIMARK MANCHESTER"], "seasonal:christmas", 0.30, 38, 0.5,
            active=lambda d: d.month == 12 and d.day <= 22)
    L.once(date(2026, 8, 24), "SCHOOLWEAR DIRECT {n}", -96.40, "children:uniform")
    L.once(date(2026, 8, 26), "CLARKS {n}", -78.00, "children:uniform")
    L.once(date(2026, 3, 14), "CURRYS {n} MANCHESTER", -329.00, "shock:appliance")
    # Paying off Christmas with buy-now-pay-later from January
    L.monthly(19, "KLARNA*{ref}", lambda d: -85.00 if d >= date(2026, 1, 1) else None,
              "debt:bnpl", "klarna", shift="none")

    return {"name": "Amara", "mode": "personal", "opening_balance": 210.00,
            "tagline": "Single parent of two, part-time carer, on Universal Credit",
            "persona": {"household": "1 adult, 2 children", "income_type": "wages + benefits",
                        "pay_cycle": "monthly wages (28th), UC (6th), child benefit 4-weekly"}}


def build_jay(L: Ledger):
    """Delivery rider: weekly irregular platform payouts, self-assessment tax shocks."""
    r = L.rng
    season = {12: 1.15, 1: 1.10, 2: 1.05, 7: 0.85, 8: 0.85}

    def main_payout(d):
        if r.random() < 0.05:  # sick / bike off the road
            return None
        return round(gauss_pos(r, 305, 95, 60) * season.get(d.month, 1.0), 2)

    def side_payout(d):
        return round(gauss_pos(r, 90, 40, 15), 2) if r.random() < 0.6 else None

    L.weekly_on({0}, "DELIVEROO PAYOUT {ref}", main_payout, "income:gig", "deliveroo")
    L.weekly_on({3}, "UBER EATS UK PAYOUT", side_payout, "income:gig", "uber_eats")

    L.monthly(1, "SO M OKAFOR RENT", -600.00, "housing:rent", "rent")
    L.monthly(3, "DD ZEGO INSURANCE", -42.00, "work:insurance", "bike_insurance")
    L.monthly(18, "DD EE LIMITED", -25.00, "bills:phone", "phone")
    L.monthly(7, "PUREGYM {ref}", -24.99, "subscriptions", "gym", shift="none")
    L.monthly(14, "SPOTIFY P{n}", -11.99, "subscriptions", "spotify", shift="none")
    L.monthly(25, "TRANSFER TO MUM", -100.00, "transfers", "family_support")

    L.spend(["TESCO EXPRESS {n}", "SAINSBURYS LOCAL {n}", "ALDI {n} MANCHESTER"],
            "groceries", 0.30, 22, 0.45)
    L.spend(["GREGGS {n}", "NANDOS {n}", "MCDONALDS {n}", "COSTA COFFEE {n}"],
            "eating_out", 0.45, 9, 0.5)
    L.spend(["BIKE DOCTOR MANCHESTER", "HALFORDS {n}"], "work:bike", 0.02, 70, 0.5)
    L.spend(["AMAZON.CO.UK*{ref}", "JD SPORTS {n}"], "shopping", 0.06, 28, 0.6)
    # Shocks
    L.once(prev_wd(date(2026, 1, 31)), "HMRC SELF ASSESSMENT", -1240.00, "tax:self_assessment")
    L.once(prev_wd(date(2026, 7, 31)), "HMRC SELF ASSESSMENT", -520.00, "tax:self_assessment")
    L.once(date(2026, 5, 9), "PHONE REPAIR CENTRE MCR", -129.00, "shock:phone")

    return {"name": "Jay", "mode": "personal", "opening_balance": 150.00,
            "tagline": "Self-employed delivery rider with irregular weekly income",
            "persona": {"household": "1 adult", "income_type": "gig platforms (self-employed)",
                        "pay_cycle": "weekly, variable; tax due Jan + Jul"}}


def build_sam(L: Ledger):
    """Second-year student: termly maintenance loan, 4-weekly bar job, monthly rent."""
    r = L.rng

    def bar_pay(d):
        if d.month in (6, 7, 8):
            return round(gauss_pos(r, 840, 90, 300), 2)
        if d.month == 5:
            return round(gauss_pos(r, 200, 60, 50), 2)
        return round(gauss_pos(r, 440, 80, 100), 2)

    L.once(date(2026, 1, 26), "SLC RECEIPTS {ref}", 1612.00, "income:student_loan")
    L.once(date(2026, 4, 20), "SLC RECEIPTS {ref}", 1612.00, "income:student_loan")
    L.once(date(2026, 9, 21), "SLC RECEIPTS {ref}", 1705.00, "income:student_loan")
    L.every(date(2025, 11, 14), 28, "J D WETHERSPOON PLC", bar_pay, "income:wages", "bar_job")
    L.monthly(1, "TRANSFER FROM MUM", 120.00, "income:family", "parents")

    L.monthly(1, "SO STUDENT HOMES MCR", -540.00, "housing:rent", "rent")
    L.monthly(3, "BILLS SPLIT ALEX", -45.00, "bills:shared", "bills_split", shift="none")
    L.monthly(8, "GIFFGAFF", -10.00, "bills:phone", "phone", shift="none")
    L.monthly(16, "SPOTIFY P{n}", -5.99, "subscriptions", "spotify", shift="none")
    L.monthly(22, "AMAZON PRIME*{ref}", -4.49, "subscriptions", "prime", shift="none")

    L.spend(["ALDI {n} MANCHESTER", "LIDL GB MANCHESTER", "TESCO EXPRESS {n}", "CO-OP GROUP {n}"],
            "groceries", 0.30, 18, 0.45)
    L.spend(["FAC251 MANCHESTER", "DICE.FM", "FIXR.CO", "SU BAR MANCHESTER"], "going_out", 0.10, 24, 0.55,
            weekday_mult=[0.4, 0.5, 2.0, 5.5, 5.5, 5.5, 0.8], month_mult={6: 0.6, 7: 0.5, 8: 0.5})
    L.spend(["DELIVEROO.CO.UK", "UBER *EATS", "DOMINOS PIZZA {n}"], "eating_out", 0.12, 14, 0.4)
    L.spend(["UBER *TRIP", "STAGECOACH BUS {n}"], "transport", 0.12, 7, 0.5)
    L.once(date(2026, 9, 25), "BLACKWELLS MANCHESTER", -84.00, "education:books")
    L.once(date(2026, 9, 28), "UOM SPORT", -125.00, "subscriptions:gym_annual")

    return {"name": "Sam", "mode": "personal", "opening_balance": 760.00,
            "tagline": "Second-year student living between loan instalments",
            "persona": {"household": "shared student house", "income_type": "student loan + bar job",
                        "pay_cycle": "loan 3x/year, wages 4-weekly"}}


# ================================================================= BUSINESS
def build_corner_cup(L: Ledger, invoices: list[dict]):
    """Independent café: card takings, quarterly rent, VAT, late-paying catering client."""
    r = L.rng
    base = [535, 555, 575, 600, 660, 845, 710]  # Mon..Sun gross takings
    season = {1: .80, 2: .85, 3: .95, 4: 1.0, 5: 1.05, 6: 1.12, 7: 1.15, 8: 1.12,
              9: 1.0, 10: .98, 11: .95, 12: 1.10}
    closed = {(12, 25), (12, 26), (1, 1)}

    # Daily gross sales from well before start (needed for VAT quarters)
    sales: dict[date, float] = {}
    d = L.start - timedelta(days=150)
    while d <= L.end:
        if (d.month, d.day) not in closed:
            sales[d] = round(base[d.weekday()] * season[d.month] * gauss_pos(r, 1, .12, .4), 2)
        d += timedelta(days=1)

    # SumUp-style payouts: each business day pays out all unsettled prior days, net of 1.69%
    unpaid = 0.0
    d = L.start - timedelta(days=150)
    while d <= L.end:
        if d.weekday() < 5 and unpaid > 0:
            L.add(d, "SUMUP PAYOUT {ref}", round(unpaid * (1 - 0.0169), 2), "income:card_takings", "card_takings")
            unpaid = 0.0
        unpaid += sales.get(d, 0.0)
        d += timedelta(days=1)

    # Catering client: monthly invoice, 30-day terms, habitually late
    for y, m in month_iter(L.start - timedelta(days=100), L.end):
        issued = next_wd(dom(y, m, 1))
        invoice_flow(L, invoices, "Halden & Co Ltd", issued, gauss_pos(r, 2600, 300, 1500), 30,
                     r.choice([0, 3, 9, 14, 21, 35, 46]), "HALDEN & CO LTD {ref}", "halden_invoices")
    # Events client: ad-hoc invoices every 6-9 weeks, 14-day terms
    issued = L.start - timedelta(days=40)
    while issued <= L.end:
        invoice_flow(L, invoices, "MCR Events Collective", next_wd(issued), r.uniform(900, 1800), 14,
                     r.choice([0, 2, 7, 15, 28]), "MCR EVENTS COLLECTIVE", "events_invoices")
        issued += timedelta(days=r.randint(42, 63))

    # VAT: quarters end Jan/Apr/Jul/Oct, paid 7th of month+2 (so Oct quarter -> 7 Dec)
    for y, m in month_iter(L.start, L.end):
        if m in (3, 6, 9, 12):
            q_end = dom(y, m - 2, -1)
            q_start = (q_end.replace(day=1) - timedelta(days=62)).replace(day=1)
            q_sales = sum(v for k, v in sales.items() if q_start <= k <= q_end)
            L.add(next_wd(date(y, m, 7)), "HMRC VAT", -round(q_sales * 0.095, 2), "tax:vat", "vat")

    # Quarterly rent in advance (English quarter days; Christmas paid 24 Dec)
    for y in range(L.start.year, L.end.year + 1):
        for qd in (date(y, 3, 25), date(y, 6, 24), date(y, 9, 29), date(y, 12, 24)):
            L.add(prev_wd(qd), "SO NORTHGATE PROPERTY LTD", -6900.00, "premises:rent", "rent")

    L.monthly(-1, "BACS PAYROLL CORNER CUP", lambda d: -round(gauss_pos(r, 7850, 200), 2),
              "staff:payroll", "payroll", shift="prev")
    L.monthly(22, "HMRC PAYE CUMBERNAULD", -1720.00, "tax:paye", "paye")
    # Owner raised drawings in September (cost-of-living) -> squeezes cash going into winter
    L.monthly(1, "TRANSFER TO OWNER", lambda d: -3500.00 if d >= date(2026, 9, 1) else -1500.00,
              "owner:drawings", "drawings")
    L.weekly_on({1}, "BEAN AND LEAF ROASTERS", lambda d: -round(gauss_pos(r, 380, 40) * season[d.month], 2),
                "cogs:coffee", "coffee_supplier")
    L.weekly_on({0, 3}, "MEADOW DAIRY LTD", lambda d: -round(gauss_pos(r, 105, 15) * season[d.month], 2),
                "cogs:dairy", "dairy_supplier")
    L.weekly_on({4}, "BOOKER LTD {n}", lambda d: -round(gauss_pos(r, 520, 70) * season[d.month], 2),
                "cogs:wholesale", "wholesaler")
    L.monthly(12, "DD BRITISH GAS BUSINESS", -540.00, "premises:energy", "energy")
    L.monthly(18, "DD UNITED UTILITIES", -96.00, "premises:water", "water")
    L.monthly(1, "DD MANCHESTER CC NNDR", -312.00, "premises:business_rates", "business_rates",
              months={4, 5, 6, 7, 8, 9, 10, 11, 12, 1})
    L.monthly(9, "DD BT BUSINESS", -48.00, "overheads:telecoms", "telecoms")
    L.monthly(6, "DD BIFFA WASTE", -64.00, "premises:waste", "waste")
    L.monthly(15, "XERO UK", -33.00, "overheads:software", "xero", shift="none")
    L.monthly(20, "SQUARESPACE", -18.00, "overheads:software", "website", shift="none")
    L.once(date(2026, 6, 10), "HISCOX INSURANCE", -1180.00, "overheads:insurance")
    L.once(date(2026, 2, 17), "COFFEE MACHINE SERVICE", -940.00, "shock:equipment")
    L.once(date(2026, 10, 14), "KITCHEN REFIT LTD", -10500.00, "shock:capex")

    return {"name": "The Corner Cup", "mode": "business", "opening_balance": 11500.00,
            "tagline": "Independent café with 4 staff and a catering side-line",
            "persona": {"sector": "hospitality", "staff": 4, "vat_quarters_end": "Jan/Apr/Jul/Oct",
                        "rent": "quarterly in advance", "income_type": "card takings + B2B invoices"}}


def build_lumen_labs(L: Ledger, invoices: list[dict]):
    """4-person B2B SaaS: Stripe MRR growing ~4.5%/month, enterprise invoices paid late."""
    r = L.rng
    mrr0, growth = 14000.0, 1.045

    def mrr(d):
        return mrr0 * growth ** months_between(L.start, d)

    L.weekly_on({1, 4}, "STRIPE PAYMENTS UK LTD",
                lambda d: round(mrr(d) / 8.67 * gauss_pos(r, 1, .15, .4) * (1 - 0.017), 2),
                "income:subscriptions", "stripe")

    invoice_flow(L, invoices, "Northwind Logistics", date(2026, 2, 2), 21600.00, 30, 41,
                 "NORTHWIND LOGISTICS LTD", "enterprise_invoices")
    invoice_flow(L, invoices, "Bramble Health", date(2026, 6, 1), 14400.00, 30, 63,
                 "BRAMBLE HEALTH LTD", "enterprise_invoices")
    invoice_flow(L, invoices, "Kestrel Retail", date(2026, 10, 1), 18000.00, 30, 60,
                 "KESTREL RETAIL PLC", "enterprise_invoices")  # still unpaid at as-of -> overdue
    L.once(date(2026, 8, 14), "HMRC R&D TAX CREDIT", 41300.00, "income:grant")

    hire = date(2026, 7, 1)  # 5th hire joins in July
    L.monthly(25, "BACS PAYROLL LUMEN LABS", lambda d: -(20400.0 if d >= hire else 16800.0),
              "staff:payroll", "payroll", shift="prev")
    L.monthly(22, "HMRC PAYE CUMBERNAULD", lambda d: -(6000.0 if d >= hire else 4900.0), "tax:paye", "paye")
    L.monthly(15, "DD NEST PENSIONS", lambda d: -(1020.0 if d >= hire else 850.0), "staff:pension", "pension")
    L.monthly(3, "AMAZON WEB SERVICES AWS.AMAZON.CO",
              lambda d: -round(1900 * 1.03 ** months_between(L.start, d) * gauss_pos(r, 1, .06), 2),
              "infra:cloud", "aws", shift="none")
    L.monthly(1, "ANTHROPIC, PBC", lambda d: -round(480 * 1.05 ** months_between(L.start, d), 2),
              "infra:ai_api", "ai_api", shift="none")
    L.monthly(1, "WEWORK SPINNINGFIELDS", -2600.00, "premises:office", "office")
    for day, desc, amt, rid in [(1, "GOOGLE*WORKSPACE", -86.40, "google_workspace"), (4, "SLACK T{n}", -63.00, "slack"),
                                (6, "GITHUB, INC.", -84.00, "github"), (10, "FIGMA", -60.00, "figma"),
                                (12, "LINEAR ORBIT", -48.00, "linear"), (14, "NOTION LABS", -40.00, "notion"),
                                (17, "XERO UK", -42.00, "xero")]:
        L.monthly(day, desc, amt, "overheads:software", rid, shift="none")
    L.monthly(20, "DD HISCOX INSURANCE", -96.00, "overheads:insurance", "insurance")

    # VAT: quarters end Mar/Jun/Sep/Dec, paid 7th of month+2
    for y, m in month_iter(L.start, L.end):
        if m in (2, 5, 8, 11):
            L.add(next_wd(date(y, m, 7)), "HMRC VAT",
                  -round(mrr(date(y, m, 1)) * 3 * 0.11, 2), "tax:vat", "vat")

    L.once(date(2026, 3, 11), "SHOOSMITHS LLP", -4800.00, "shock:legal")
    L.once(date(2026, 7, 6), "APPLE STORE R{n}", -2399.00, "shock:equipment")

    return {"name": "Lumen Labs", "mode": "business", "opening_balance": 190000.00,
            "tagline": "Seed-stage B2B SaaS startup, 5 staff, burning cash while MRR grows",
            "persona": {"sector": "software", "staff": "4 -> 5 (July)", "vat_quarters_end": "Mar/Jun/Sep/Dec",
                        "income_type": "Stripe subscriptions + enterprise invoices"}}


PROFILES = {
    "amara": build_amara, "jay": build_jay, "sam": build_sam,
    "corner_cup": build_corner_cup, "lumen_labs": build_lumen_labs,
}


# ------------------------------------------------------------------- output
def generate(pid: str, seed: int, as_of: date, days: int) -> dict:
    rng = random.Random(f"{seed}-{pid}")
    start = as_of - timedelta(days=days - 1)
    L = Ledger(start, as_of, rng)
    invoices: list[dict] = []
    builder = PROFILES[pid]
    meta = builder(L, invoices) if "invoices" in builder.__code__.co_varnames else builder(L)

    L.txns.sort(key=lambda t: (t.date, -t.amount))  # credits before debits on same day
    bal = meta["opening_balance"]
    rows = []
    for i, t in enumerate(L.txns):
        bal = round(bal + t.amount, 2)
        rows.append({"id": f"{pid}-{i:05d}", "date": t.date.isoformat(), "description": t.description,
                     "amount": t.amount, "balance": bal,
                     "_category": t.category, "_recurring_id": t.recurring_id})

    out = {"profile_id": pid, **meta, "currency": "GBP", "as_of": as_of.isoformat(),
           "history_start": start.isoformat(), "closing_balance": bal, "transactions": rows}
    if meta["mode"] == "business":
        out["invoices"] = sorted(invoices, key=lambda x: x["issued"])
    return out


def summarise(p: dict) -> dict:
    tx = p["transactions"]
    low = min(tx, key=lambda t: t["balance"])
    daily_close: dict[str, float] = {}
    for t in tx:
        daily_close[t["date"]] = t["balance"]
    return {
        "profile_id": p["profile_id"], "name": p["name"], "mode": p["mode"], "tagline": p["tagline"],
        "transactions": len(tx),
        "total_in": round(sum(t["amount"] for t in tx if t["amount"] > 0), 2),
        "total_out": round(sum(t["amount"] for t in tx if t["amount"] < 0), 2),
        "opening_balance": p["opening_balance"], "closing_balance": p["closing_balance"],
        "min_balance": low["balance"], "min_balance_date": low["date"],
        "days_closed_negative": sum(1 for v in daily_close.values() if v < 0),
    }


def main():
    ap = argparse.ArgumentParser(description="Generate Foresight synthetic bank data")
    ap.add_argument("--out", default="data/profiles")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--as-of", default="2026-11-07")
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--profiles", nargs="*", default=list(PROFILES))
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    as_of = date.fromisoformat(a.as_of)
    index = []
    for pid in a.profiles:
        p = generate(pid, a.seed, as_of, a.days)
        (out / f"{pid}.json").write_text(json.dumps(p, indent=2))
        s = summarise(p)
        index.append(s)
        print(f"{pid:<12} {s['mode']:<9} txns={s['transactions']:<5} in={s['total_in']:>11,.2f} "
              f"out={s['total_out']:>12,.2f} close={s['closing_balance']:>11,.2f} "
              f"min={s['min_balance']:>10,.2f} on {s['min_balance_date']}  neg_days={s['days_closed_negative']}")
    (out / "index.json").write_text(json.dumps({"as_of": a.as_of, "seed": a.seed, "profiles": index}, indent=2))
    print(f"\nWrote {len(index)} profiles + index.json to {out.resolve()}")


if __name__ == "__main__":
    main()
