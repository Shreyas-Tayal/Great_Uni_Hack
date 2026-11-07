"""
Mode adapters: everything that differs between Personal and Business lives here.
The forecast engine itself is mode-agnostic.

OWNER: Person 1 (tune thresholds/labels with Person 3 so the coach's wording matches).
"""
MODES = {
    "personal": {
        "hero_label": "Safe to spend in the next 2 weeks",
        "risk_threshold": 0.25,          # P(balance < 0) that triggers an alert
        "cut_spend_options": [10, 25],   # £/week
        "shift_days": 5,
        "small_subscription_max": 30.0,
        "categories": {
            "Rent & housing": ["RENT", "HOUSING", "STUDENT HOMES"],
            "Bills": ["DD ", "ENERGY", "UTILITIES", "COUNCIL", "VIRGIN", "EE LIMITED", "GIFFGAFF", "BILLS"],
            "Groceries": ["TESCO", "ALDI", "LIDL", "ASDA", "SAINSBURY", "CO-OP"],
            "Eating out": ["GREGGS", "MCDONALDS", "NANDOS", "JUST EAT", "DELIVEROO.CO", "UBER *EATS", "DOMINOS", "COSTA"],
            "Transport": ["STAGECOACH", "METROLINK", "UBER *TRIP"],
            "Subscriptions": ["NETFLIX", "SPOTIFY", "PUREGYM", "PRIME"],
            "Going out": ["FAC251", "DICE", "FIXR", "SU BAR"],
            "Children": ["PARENTPAY", "SMYTHS", "CLARKS", "PRIMARK", "SCHOOLWEAR"],
            "Tax": ["HMRC"],
            "Cash": ["CASH ATM"],
        },
    },
    "business": {
        "hero_label": "Cash runway",
        "risk_threshold": 0.20,
        "cut_spend_options": [150, 300],
        "shift_days": 14,
        "small_subscription_max": 100.0,
        "categories": {
            "Payroll & pensions": ["PAYROLL", "NEST"],
            "Tax (VAT, PAYE)": ["HMRC"],
            "Premises": ["PROPERTY", "WEWORK", "GAS", "UTILITIES", "NNDR", "BIFFA"],
            "Suppliers": ["ROASTERS", "DAIRY", "BOOKER"],
            "Software & cloud": ["AWS", "AMAZON WEB", "ANTHROPIC", "GOOGLE", "SLACK", "GITHUB", "FIGMA",
                                 "LINEAR", "NOTION", "XERO", "SQUARESPACE"],
            "Owner drawings": ["OWNER"],
            "Professional fees": ["LLP", "INSURANCE", "HISCOX"],
        },
    },
}


def categorise(desc: str, mode: str) -> str:
    d = desc.upper()
    for cat, keys in MODES[mode]["categories"].items():
        if any(k in d for k in keys):
            return cat
    return "Other"
