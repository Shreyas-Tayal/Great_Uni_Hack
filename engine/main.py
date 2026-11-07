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
    return {"ok": True}


@app.get("/profiles")
def profiles():
    return json.loads((DATA / "index.json").read_text())


@app.get("/profiles/{pid}/summary")
def get_summary(pid: str):
    return summary(model_for(pid))


@app.post("/forecast")
def post_forecast(req: ForecastReq):
    return forecast(model_for(req.profile_id), req.days, req.adjustments, req.with_actions)


@app.post("/simulate")
def post_simulate(req: ForecastReq):
    """Baseline vs scenario in one call: what the UI animates and what the coach narrates."""
    m = model_for(req.profile_id)
    base = forecast(m, req.days, [], with_actions=False)
    scen = forecast(m, req.days, req.adjustments, with_actions=req.with_actions)
    focus = None
    if base["alerts"]:  # how the scenario changes the most urgent cliff specifically
        a = base["alerts"][0]
        lo, hi = max(0, a["window"][0] - 7), min(req.days, a["window"][1] + 8)
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
