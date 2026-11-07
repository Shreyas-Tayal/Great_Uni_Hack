"""
Foresight engine API (FastAPI). Run:  uvicorn main:app --reload --port 8000
Expose to n8n / Lovable during the hackathon:  cloudflared tunnel --url http://localhost:8000
                                          (or: ngrok http 8000)
OWNER: Person 1 (engine) - Person 3 calls it from n8n, Person 2 calls it from the UI.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from foresight.accountant import ai_enabled, ask_claude, build_facts, clean_adjustments, fill_blocks
from foresight.engine import build_model, forecast, summary

DATA = Path(os.getenv("FORESIGHT_DATA", Path(__file__).parent.parent / "data" / "profiles"))

app = FastAPI(title="Foresight engine", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@lru_cache(maxsize=16)
def model_for(pid: str):
    f = DATA / f"{pid}.json"
    if not f.exists():
        raise HTTPException(404, f"Unknown profile '{pid}'. Run generate_data.py first.")
    return build_model(json.loads(f.read_text()))


class ForecastReq(BaseModel):
    profile_id: str
    days: int = Field(90, ge=14, le=180)
    adjustments: list[dict] = []
    with_actions: bool = True


@app.get("/health")
def health():
    return {"ok": True, "ai_chat": ai_enabled()}


DEMO_PROFILES = os.getenv("DEMO_PROFILES", "amara,sam,margaret,jay,corner_cup,fixit_plumbing,lumen_labs").split(",")


@app.get("/profiles")
def profiles():
    idx = json.loads((DATA / "index.json").read_text())
    idx["profiles"] = [p for p in idx["profiles"] if p["profile_id"] in DEMO_PROFILES]
    return idx


@app.get("/profiles/{pid}/summary")
def get_summary(pid: str):
    return summary(model_for(pid))


@app.post("/forecast")
def post_forecast(req: ForecastReq):
    return forecast(model_for(req.profile_id), req.days, req.adjustments, req.with_actions)


def run_simulation(pid: str, days: int, adjustments: list[dict], with_actions: bool = True) -> dict:
    """Baseline vs scenario in one call: what the UI animates and what the accountant narrates."""
    m = model_for(pid)
    base = forecast(m, days, [], with_actions=False)
    scen = forecast(m, days, adjustments, with_actions=with_actions)
    focus = None
    if base["alerts"]:  # how the scenario changes the most urgent cliff specifically
        a = base["alerts"][0]
        lo, hi = max(0, a["window"][0] - 7), min(days, a["window"][1] + 8)
        after = max(b["p_negative"] for b in scen["bands"][lo:hi])
        focus = {"alert_id": a["id"], "title": a["title"], "peak_date": a["peak_date"],
                 "p_before": a["p_negative"], "p_after": round(after, 3)}
    return {"baseline": base["risk_summary"] | {"hero": base["hero"]},
            "focus_alert": focus,
            "scenario": scen,
            "delta": {"peak_p_negative": round(scen["risk_summary"]["peak_p_negative"]
                                               - base["risk_summary"]["peak_p_negative"], 3),
                      "low_point_p50": round(scen["risk_summary"]["low_point_p50"]
                                             - base["risk_summary"]["low_point_p50"], 2)}}


@app.post("/simulate")
def post_simulate(req: ForecastReq):
    return run_simulation(req.profile_id, req.days, req.adjustments, req.with_actions)


class ChatReq(BaseModel):
    profile_id: str
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[dict] = []


@app.post("/chat")
def post_chat(req: ChatReq):
    """The AI accountant (Claude). Same response shape as the n8n accountant-chat webhook.
    Needs ANTHROPIC_API_KEY; without it this returns 503 and the app uses its built-in coach."""
    if not ai_enabled():
        raise HTTPException(503, "AI chat is off: set ANTHROPIC_API_KEY on the engine.")
    m = model_for(req.profile_id)
    f, s = forecast(m, 90, []), summary(m)
    try:
        ai = ask_claude(req.message, req.history, build_facts(f, s))
    except Exception as e:  # network, auth or rate limit: let the UI fall back calmly
        raise HTTPException(502, f"The AI accountant didn't answer: {type(e).__name__}")
    adjustments = clean_adjustments(ai.get("adjustments", []), s)
    sim = run_simulation(req.profile_id, 90, adjustments) if adjustments else None
    blocks = [b for b in ai.get("blocks", []) if isinstance(b, str)]
    return {"reply": str(ai.get("reply", "")), "speak": str(ai.get("speak", "")),
            "intent": "whatif" if adjustments else "ai", "adjustments": adjustments,
            "blocks": fill_blocks(blocks, f, s, sim), "audio_base64": None, "audio_mime": "audio/mpeg"}
