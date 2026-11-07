"""
The AI accountant behind POST /chat.

Claude chooses the words, which visual blocks to show, and any what-if adjustments.
Every number comes from the engine: blocks are filled here from the forecast, never by the model.
The API key stays on the server (ANTHROPIC_API_KEY); the browser never sees it.
"""
from __future__ import annotations

import json
import os
import re

ALLOWED_ADJUSTMENTS = {"cut_spend", "shift_stream", "remove_stream", "scale_stream", "income_change",
                       "one_off", "invoice_on_time", "invoice_finance", "client_late"}
BLOCK_TYPES = ["kpis", "forecast_chart", "scenario_delta", "alert", "actions",
               "category_chart", "cashflow_chart", "upcoming", "invoices"]

SYSTEM_PROMPT = """You are Foresight, a personal AI accountant. You look after the user's money for them: you watch the next 90 days, spot trouble early, and propose concrete actions the user can approve with one tap.
Personal users: a warm, plain-spoken money coach for someone who may be stretched. No jargon, no judgement.
Business users: a sharp, friendly small-business accountant, numbers first.

Answer ANY question about the user's money using ONLY the FACTS provided. Never invent figures, dates, payees or names. If the FACTS don't contain the answer, say so plainly and offer what you can show instead.
Lead with the answer. Round money to the nearest pound. Describe chances simply ("about 3 in 10 of the futures we simulated").
When there is a problem, say what you would do about it, using the fixes in FACTS, and say the user can approve it below. Never claim you have already moved money, paid a bill or contacted anyone: you prepare, the user approves.
This is guidance, not regulated financial advice. If the user seems in hardship, mention free help (MoneyHelper, StepChange, Citizens Advice) and talking to their bank early. Reply in the user's language.
For general money questions (what is an ISA, how do I build an emergency fund) give a short practical answer and relate it to their numbers.

If the user asks a "what if", return adjustments using ONLY these shapes (stream_id values must come from FACTS.recurring):
{"type":"cut_spend","weekly":<£>} {"type":"shift_stream","stream_id":"<id>","days":<int>} {"type":"remove_stream","stream_id":"<id>"}
{"type":"scale_stream","stream_id":"<id>","factor":<0..2>} {"type":"income_change","factor":<0..2>}
{"type":"one_off","amount":<signed £, costs negative>,"in_days":<int>,"label":"<short>"}
{"type":"invoice_on_time"} {"type":"invoice_finance","advance":0.8} {"type":"client_late","extra_days":<int>}
For what-ifs, describe the change qualitatively; the app runs the simulation and shows the numbers.

Return ONLY a JSON object, no code fences:
{"reply": "<markdown, max 120 words, lead with the answer>",
 "speak": "<max 45 words, natural spoken version, no symbols>",
 "blocks": [<0-3 of: "kpis","forecast_chart","scenario_delta","alert","actions","category_chart","cashflow_chart","upcoming","invoices">],
 "adjustments": [<zero or more adjustment objects>]}
Block guide: overview -> kpis + forecast_chart + alert; a problem -> alert + actions; payments due -> upcoming; spending -> category_chart; history -> cashflow_chart; invoices -> invoices; what-if -> forecast_chart; general knowledge -> none."""


def build_facts(f: dict, s: dict) -> dict:
    """The compact, numbers-only view of the account the model is allowed to talk about."""
    return {
        "who": {"name": s["name"], "mode": s["mode"], "tagline": s["tagline"]},
        "today": f["as_of"], "balance_now": f["balance_now"], "hero": f["hero"], "risk": f["risk_summary"],
        "alerts": [{"title": a["title"], "peak_date": a["peak_date"], "chance_below_zero": a["p_negative"],
                    "why": a["explanation"],
                    "fixes": [{"fix": x["label"], "chance_after": x["new_p_negative"]} for x in a.get("actions", [])]}
                   for a in f["alerts"]],
        "upcoming_30_days": [{"date": u["date"], "label": u["label"], "amount": u["amount"]} for u in f["upcoming"]],
        "weekly_balance_outlook": [{"date": b["date"], "likely": b["p50"], "low": b["p10"], "high": b["p90"],
                                    "chance_below_zero": b["p_negative"]} for i, b in enumerate(f["bands"]) if i % 7 == 6],
        "recurring": [{"stream_id": r["stream_id"], "label": r["label"], "cadence": r["cadence"], "amount": r["amount"],
                       "next_date": r["next_date"]} for r in s["recurring"]],
        "spending_last_90_days": s["categories_90d"],
        "monthly_in_out": s["monthly"][-6:],
        "unpaid_invoices": [{"id": i["id"], "client": i["client"], "amount": i["amount"], "due": i["due"],
                             "status": i["status"], "days_late": i.get("days_late")} for i in s["invoices"]],
    }


def fill_blocks(types: list[str], f: dict, s: dict, sim: dict | None) -> list[dict]:
    """Turns the block names the model picked into real blocks filled with engine numbers."""
    src = sim["scenario"] if sim else f
    a0 = src["alerts"][0] if src["alerts"] else None
    make = {
        "kpis": lambda: {"type": "kpis", "items": [{"label": src["hero"]["label"], "value": src["hero"]["value"],
                                                    "unit": src["hero"]["unit"]}, *src["hero"].get("kpis", [])]},
        "forecast_chart": lambda: {"type": "forecast_chart", "data": {"history": src["history"], "bands": src["bands"],
                                                                     "alerts": src["alerts"]}},
        "scenario_delta": lambda: {"type": "scenario_delta", "focus": sim["focus_alert"]} if sim and sim.get("focus_alert") else None,
        "alert": lambda: {"type": "alert", "alert": a0} if a0 else None,
        "actions": lambda: {"type": "actions", "actions": a0["actions"]} if a0 and a0.get("actions") else None,
        "category_chart": lambda: {"type": "category_chart", "data": s["categories_90d"]},
        "cashflow_chart": lambda: {"type": "cashflow_chart", "data": s["monthly"]},
        "upcoming": lambda: {"type": "upcoming", "items": src["upcoming"]},
        "invoices": lambda: {"type": "invoices", "items": s["invoices"]} if s["invoices"] else None,
    }
    wanted = list(dict.fromkeys((["scenario_delta"] if sim and "scenario_delta" not in types else []) + types))
    out = [b for b in (make[t]() for t in wanted if t in make) if b]
    return out[:3]


def clean_adjustments(raw: list, s: dict) -> list[dict]:
    """Keeps only adjustment shapes the engine understands, with stream ids that really exist."""
    streams = {r["stream_id"] for r in s["recurring"]}
    out = []
    for a in raw or []:
        if not isinstance(a, dict) or a.get("type") not in ALLOWED_ADJUSTMENTS:
            continue
        if "stream_id" in a and a["stream_id"] not in streams:
            continue
        out.append(a)
    return out


def parse_reply(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return {"reply": text, "blocks": [], "adjustments": []}


def ai_enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def ask_claude(message: str, history: list[dict], facts: dict) -> dict:
    import anthropic  # imported lazily so the engine runs without it when chat is off

    client = anthropic.Anthropic()
    msgs = [{"role": h["role"], "content": str(h["content"])} for h in history[-10:]
            if h.get("role") in ("user", "assistant") and h.get("content")]
    while msgs and msgs[0]["role"] != "user":   # the API needs the first turn to be the user's
        msgs.pop(0)
    msgs.append({"role": "user", "content": f"FACTS:\n{json.dumps(facts, default=str)}\n\nQUESTION:\n{message}"})
    res = client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
        max_tokens=900,
        system=SYSTEM_PROMPT,
        messages=msgs,
    )
    text = "".join(getattr(b, "text", "") for b in res.content)
    return parse_reply(text)
