"""
Foresight engine API (FastAPI). Run:  uvicorn main:app --reload --port 8000
Expose to n8n / Lovable during the hackathon:  cloudflared tunnel --url http://localhost:8000
                                          (or: ngrok http 8000)
OWNER: Person 1 (engine) - Person 3 calls it from n8n, Person 2 calls it from the UI.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

from foresight.engine import build_model, forecast, summary

DATA = Path(os.getenv("FORESIGHT_DATA", Path(__file__).parent.parent / "data" / "profiles"))

app = FastAPI(title="Foresight engine", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@lru_cache(maxsize=16)
def model_for(pid: str):
    if not re.fullmatch(r"[a-z0-9_]+", pid):
        raise HTTPException(404, "Unknown profile")
    known = json.loads((DATA / "index.json").read_text())["profiles"]
    if pid not in {p["profile_id"] for p in known}:
        raise HTTPException(404, "Unknown demo profile")
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


class VoiceSessionReq(BaseModel):
    profile_id: str


@app.post("/voice/session")
def voice_session(req: VoiceSessionReq, outgoing: Response):
    m = model_for(req.profile_id)
    key = os.getenv("ELEVENLABS_API_KEY")
    agent = os.getenv("ELEVENLABS_AGENT_ID")
    if not key or not agent:
        raise HTTPException(503, "Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID on the server")
    try:
        response = httpx.get(
            "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
            params={"agent_id": agent}, headers={"xi-api-key": key}, timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid provider response")
        signed_url = payload.get("signed_url")
        if not isinstance(signed_url, str) or not signed_url.startswith("wss://"):
            raise ValueError("Invalid signed URL")
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(502, "Could not start the voice service. Try again later.") from None
    outgoing.headers["Cache-Control"] = "no-store"
    # Use the same detected streams and amounts as the existing account summary.
    streams = [{k: s[k] for k in ("stream_id", "label", "amount")}
               for s in summary(m)["recurring"] if s["direction"] == "in"]
    return {"signed_url": signed_url, "income_streams": streams,
            "profile_name": m.profile["name"]}


class VoiceScenarioReq(BaseModel):
    profile_id: str
    stream_id: str = Field(min_length=1, max_length=160)
    days: int = Field(ge=1, le=90, strict=True)


@app.post("/voice/simulate")
def voice_simulate(req: VoiceScenarioReq):
    m = model_for(req.profile_id)
    stream = next((s for s in [*m.det.cadence, *m.det.weekday]
                   if s.id == req.stream_id and s.direction == "in"), None)
    if stream is None:
        raise HTTPException(422, "Choose an income stream from this account's voice session context")
    # Each question compares independently with today's plan, matching the displayed baseline.
    result = post_simulate(ForecastReq(profile_id=req.profile_id, adjustments=[
        {"type": "shift_stream", "stream_id": stream.id, "days": req.days}
    ]))
    base = forecast(m, 90, [], with_actions=False)
    if result["scenario"]["bands"] == base["bands"]:
        raise HTTPException(422, "This stream has no forecast receipts affected within 90 days; choose another income stream")
    return {"label": f"{stream.label} paid {req.days} days late", "result": result}
