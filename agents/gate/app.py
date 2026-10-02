"""
gate-agent/app.py

Fast local decision gate. One Ollama POST /v1/systemone call classifies
a support ticket. This is a Skill, not a Reasoner: it does not call app.ai().

On any error (timeout, HTTP failure, model not pulled, bad JSON) the skill
returns {"ok": false, "error": "..."} and never raises, so the orchestrator
can fall back to sentiment + routing.

Endpoints exposed:
  POST /api/v1/execute/gate-agent.decide
"""
import logging
import os
import time
import uuid

import httpx
from agentfield import Agent, AIConfig
from startup import install_shutdown_handler, wait_for_control_plane

from systemone import build_request, normalize_response

log = logging.getLogger("gate-agent")

AGENTFIELD_SERVER = os.environ["AGENTFIELD_SERVER"]
AGENT_PORT        = int(os.environ.get("AGENT_PORT", 9005))

SYSTEMONE_BASE    = os.environ.get("SYSTEMONE_BASE", "http://host.docker.internal:11434").rstrip("/")
SYSTEMONE_MODEL   = os.environ.get("SYSTEMONE_MODEL", "tev1:0.8b")


def _timeout_seconds() -> float:
    """Read SYSTEMONE_TIMEOUT_S. Invalid or non-positive values fall back to 3."""
    raw = os.environ.get("SYSTEMONE_TIMEOUT_S", "3")
    try:
        value = float(raw)
    except ValueError:
        log.warning(f"Invalid SYSTEMONE_TIMEOUT_S={raw!r}, using 3")
        return 3.0
    if value <= 0:
        log.warning(f"SYSTEMONE_TIMEOUT_S={value} out of range, using 3")
        return 3.0
    return value


SYSTEMONE_TIMEOUT_S = _timeout_seconds()

wait_for_control_plane(AGENTFIELD_SERVER)

app = Agent(
    node_id=os.environ.get("AGENT_NODE_ID", "gate-agent"),
    agentfield_server=AGENTFIELD_SERVER,
    ai_config=AIConfig(model="ollama/gemma4:31b-cloud"),
    tags=["gate", "routing", "production"],
    description="Fast Ollama /v1/systemone decision gate — one typed call, no chat LLM",
    port=AGENT_PORT,
    dev_mode=True,
)

install_shutdown_handler(app)


def _error_detail(resp: httpx.Response) -> str:
    """Prefer Ollama's JSON error field, then the response body, capped at 300 characters."""
    try:
        data = resp.json()
        if isinstance(data, dict) and data.get("error"):
            return str(data["error"])[:300]
    except Exception:
        pass
    text = (resp.text or "").strip()
    return (text[:300] or resp.reason_phrase or "request failed")


def _fail(error: str, latency_ms: int | None = None) -> dict:
    """Error shape the orchestrator already understands. Never raises."""
    payload = {"ok": False, "error": error[:300]}
    if latency_ms is not None:
        payload["latency_ms"] = latency_ms
        payload["model"] = SYSTEMONE_MODEL
    return payload


@app.skill(tags=["gate", "routing"])
async def decide(subject: str, body: str, account_tier: str) -> dict:
    """
    Classify one ticket with a single /v1/systemone request.

    Returns a normalized dict (ok, team, urgency, contains_threat,
    needs_escalation, frustration, probabilities, confidence, latency_ms,
    model). On failure returns ok=false and an error string.
    """
    request_id = uuid.uuid4().hex[:12]
    state, payload = build_request(SYSTEMONE_MODEL, subject, body, account_tier)
    url = f"{SYSTEMONE_BASE}/v1/systemone"
    started = time.perf_counter()

    log.info(
        f"systemone request_id={request_id} state_len={len(state)} "
        f"model={SYSTEMONE_MODEL}"
    )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(SYSTEMONE_TIMEOUT_S)) as client:
            resp = await client.post(url, json=payload)
    except httpx.TimeoutException:
        latency_ms = int((time.perf_counter() - started) * 1000)
        log.warning(
            f"systemone request_id={request_id} state_len={len(state)} "
            f"latency_ms={latency_ms} error=timeout"
        )
        return _fail(f"timeout after {SYSTEMONE_TIMEOUT_S}s", latency_ms)
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        log.warning(
            f"systemone request_id={request_id} state_len={len(state)} "
            f"latency_ms={latency_ms} error={exc}"
        )
        return _fail(f"request failed: {exc}", latency_ms)

    latency_ms = int((time.perf_counter() - started) * 1000)
    remote_id = resp.headers.get("x-request-id") or resp.headers.get("x-ollama-request-id") or "-"
    log.info(
        f"systemone request_id={request_id} remote_id={remote_id} "
        f"state_len={len(state)} latency_ms={latency_ms} status={resp.status_code}"
    )

    if resp.status_code != 200:
        return _fail(f"HTTP {resp.status_code}: {_error_detail(resp)}", latency_ms)

    try:
        data = resp.json()
    except Exception as exc:
        return _fail(f"invalid JSON: {exc}", latency_ms)

    try:
        normalized = normalize_response(data, latency_ms=latency_ms, model=SYSTEMONE_MODEL)
    except Exception as exc:
        log.warning(f"systemone request_id={request_id} parse error: {exc}")
        return _fail(f"parse failure: {exc}", latency_ms)

    if not normalized.get("ok"):
        log.warning(
            f"systemone request_id={request_id} state_len={len(state)} "
            f"latency_ms={latency_ms} error={normalized.get('error')}"
        )
    return normalized


if __name__ == "__main__":
    log.info(
        f"Starting gate-agent on port {AGENT_PORT} "
        f"model={SYSTEMONE_MODEL} base={SYSTEMONE_BASE}"
    )
    app.run(port=AGENT_PORT, auto_port=False)
