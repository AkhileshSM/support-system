"""
triage-orchestrator/app.py

The main orchestrator agent. Receives incoming tickets, asks the local
decision gate and the SLA agent in parallel, and either takes a fast path
(no sentiment or routing LLM calls) or the existing full pipeline.

Fast path when the gate is confident, the ticket is not critical, the gate
does not ask for escalation, and the account is not an enterprise ticket
already marked high urgency. Anything else, including a gate error, uses
the original sentiment + app.ai() path. Escalation only happens on that
full path.

Endpoints exposed:
  POST /api/v1/execute/triage-orchestrator.handle_ticket
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from agentfield import Agent, AIConfig
from pydantic import BaseModel
from startup import install_shutdown_handler, wait_for_control_plane

log = logging.getLogger("orchestrator")

# ── Configuration from environment ───────────────────────────
AGENTFIELD_SERVER = os.environ["AGENTFIELD_SERVER"]
AGENT_PORT        = int(os.environ.get("AGENT_PORT", 9001))

_TEAMS = {"support-engineering", "billing", "general", "sales"}
_URGENCIES = {"low", "medium", "high", "critical"}


def _confidence_min() -> float:
    """Read GATE_CONFIDENCE_MIN. Invalid or out-of-range values fall back to 0.7."""
    raw = os.environ.get("GATE_CONFIDENCE_MIN", "0.7")
    try:
        value = float(raw)
    except ValueError:
        log.warning(f"Invalid GATE_CONFIDENCE_MIN={raw!r}, using 0.7")
        return 0.7
    if not 0.0 <= value <= 1.0:
        log.warning(f"GATE_CONFIDENCE_MIN={value} out of range, using 0.7")
        return 0.7
    return value


# Keep this rule aligned with agents/gate/systemone.py fast_path_eligible.
GATE_CONFIDENCE_MIN = _confidence_min()

# ── Wait for control plane before registering ────────────────
wait_for_control_plane(AGENTFIELD_SERVER)

# ── Agent definition ─────────────────────────────────────────
app = Agent(
    node_id=os.environ.get("AGENT_NODE_ID", "triage-orchestrator"),
    agentfield_server=AGENTFIELD_SERVER,
    ai_config=AIConfig(
        model="ollama/gemma4:31b-cloud",
        temperature=0.2,
        max_tokens=1024,
    ),
    tags=["orchestrator", "support", "production"],
    description="Orchestrates ticket triage: decision gate → SLA → fast path or full routing → escalation",
    port=AGENT_PORT,
    dev_mode=True,
)

install_shutdown_handler(app)


# ── Output schemas ────────────────────────────────────────────
class TicketRoute(BaseModel):
    """Routing result shared by the fast path and the full app.ai() path."""

    team: str             # "support-engineering" | "billing" | "general" | "sales"
    escalate: bool        # True if this needs immediate human attention
    summary: str          # One-line summary for the queue
    confidence: float     # 0.0–1.0 — how sure the AI is about the routing


def _valid_frustration(value) -> bool:
    """True for a whole number from 1 to 10. Booleans are rejected."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and not value.is_integer():
        return False
    return 1 <= int(value) <= 10


def _fast_path_eligible(gate: dict, account_tier: str) -> bool:
    """Skip sentiment and routing only for a confident, non-escalating gate.

    Same conditions as agents/gate/systemone.py fast_path_eligible.
    Enterprise + high urgency stays on the full path because that is
    already an escalation under the routing prompt.
    """
    if not isinstance(gate, dict) or gate.get("ok") is not True:
        return False
    if gate.get("team") not in _TEAMS or gate.get("urgency") not in _URGENCIES:
        return False
    if gate.get("urgency") == "critical":
        return False
    if gate.get("needs_escalation") is not False:
        return False
    if not _valid_frustration(gate.get("frustration")):
        return False
    try:
        confidence = float(gate["confidence"])
    except (KeyError, TypeError, ValueError):
        return False
    if confidence < GATE_CONFIDENCE_MIN:
        return False
    tier = (account_tier or "").strip().lower()
    if tier == "enterprise" and gate.get("urgency") == "high":
        return False
    return True


def _full_path_reason(gate: dict, account_tier: str) -> str:
    """Short note explaining why this ticket stayed on the full path."""
    if not isinstance(gate, dict) or gate.get("ok") is not True:
        error = gate.get("error") if isinstance(gate, dict) else "no response"
        return f"gate unavailable ({error})"
    if gate.get("urgency") == "critical":
        return "urgency is critical"
    if gate.get("needs_escalation") is True:
        return "gate flagged needs_escalation"
    tier = (account_tier or "").strip().lower()
    if tier == "enterprise" and gate.get("urgency") == "high":
        return "enterprise account with high urgency"
    try:
        confidence = float(gate.get("confidence"))
    except (TypeError, ValueError):
        return "gate confidence missing"
    if confidence < GATE_CONFIDENCE_MIN:
        return f"confidence {confidence:.2f} below {GATE_CONFIDENCE_MIN:.2f}"
    return "gate result was not eligible for the fast path"


def _summary_from_subject(subject: str) -> str:
    """One-line queue summary taken from the subject. No LLM."""
    line = " ".join((subject or "").split())
    if not line:
        line = "Support request"
    if len(line) > 160:
        line = line[:157].rstrip() + "..."
    if line[-1] not in ".!?":
        line += "."
    return line


def _sentiment_from_gate(gate: dict) -> dict:
    """Sentiment-shaped dict so the outcome contract stays unchanged."""
    urgency = gate["urgency"]
    frustration = int(gate["frustration"])
    threat = bool(gate["contains_threat"])
    if threat or frustration >= 8:
        label = "angry"
        emotion = "threatened" if threat else "furious"
    elif urgency == "high" or frustration >= 6:
        label = "negative"
        emotion = "frustrated"
    elif urgency == "low" and frustration <= 2:
        label = "positive"
        emotion = "pleased"
    else:
        label = "neutral"
        emotion = "calm" if urgency == "low" else "concerned"
    return {
        "label": label,
        "urgency": urgency,
        "frustration_level": frustration,
        "key_emotion": emotion,
        "contains_threat": threat,
    }


async def _call_gate(ticket_id: str, subject: str, body: str, account_tier: str) -> dict:
    """Call the gate. A down agent becomes ok=false, not a 500."""
    try:
        result = await app.call(
            "gate-agent.decide",
            subject=subject,
            body=body,
            account_tier=account_tier,
        )
    except Exception as exc:
        log.warning(f"[{ticket_id}] gate-agent.decide failed: {exc}")
        return {"ok": False, "error": f"gate call failed: {exc}"}
    if not isinstance(result, dict):
        return {"ok": False, "error": "gate returned a non-object"}
    return result


# ── Reasoner ─────────────────────────────────────────────────
@app.reasoner(tags=["triage", "orchestrator"])
async def handle_ticket(
    ticket_id: str,
    subject: str,
    body: str,
    customer_id: str,
    account_tier: str,      # "enterprise" | "pro" | "free"
) -> dict:
    """
    Full triage pipeline for one support ticket.
    Returns routing decision, sentiment, SLA, and escalation status.
    """
    log.info(f"[{ticket_id}] Triage start — tier={account_tier} customer={customer_id}")

    # ── Store ticket context in workflow memory ───────────────
    await app.memory.set(f"ticket:{ticket_id}", {
        "customer_id": customer_id,
        "tier": account_tier,
        "subject": subject,
        "received_at": datetime.now(timezone.utc).isoformat(),
    })

    # ── Gate + SLA in parallel. Sentiment waits for the gate. ─
    app.note("Fanning out to decision gate + SLA", ["triage", "fanout"])

    gate_result, sla_result = await asyncio.gather(
        _call_gate(ticket_id, subject, body, account_tier),
        app.call(
            "sla-agent.get_policy",
            tier=account_tier,
        ),
    )

    use_fast = _fast_path_eligible(gate_result, account_tier)
    decision_path = "fast" if use_fast else "full"
    gate_latency_ms = gate_result.get("latency_ms") if isinstance(gate_result, dict) else None

    log.info(
        f"[{ticket_id}] decision_path={decision_path} "
        f"gate_ok={gate_result.get('ok')} "
        f"gate_confidence={gate_result.get('confidence')} "
        f"sla={sla_result['sla_minutes']}min"
    )

    if use_fast:
        reason = (
            f"confidence {float(gate_result['confidence']):.2f} "
            f">= {GATE_CONFIDENCE_MIN:.2f}"
        )
        app.note(
            f"Decision path: fast ({reason})",
            ["triage", "gate", "fast"],
        )
        sentiment_result = _sentiment_from_gate(gate_result)
        route = TicketRoute(
            team=gate_result["team"],
            escalate=False,
            summary=_summary_from_subject(subject),
            confidence=float(gate_result["confidence"]),
        )
    else:
        reason = _full_path_reason(gate_result, account_tier)
        app.note(
            f"Decision path: full ({reason})",
            ["triage", "gate", "full"],
        )
        log.info(f"[{ticket_id}] full path — {reason}")

        # ── Existing sentiment + routing pipeline ─────────────
        sentiment_result = await app.call(
            "sentiment-agent.analyze",
            text=f"{subject}\n\n{body}",
        )

        log.info(
            f"[{ticket_id}] sentiment={sentiment_result['label']} "
            f"urgency={sentiment_result['urgency']} "
            f"sla={sla_result['sla_minutes']}min"
        )

        route = await app.ai(
            system="""You are an expert support ticket router.
Given ticket details, sentiment analysis, and SLA constraints, decide:
  - team: one of "support-engineering" | "billing" | "general" | "sales"
  - escalate: true only if urgency is critical AND frustration >= 7, or account_tier is enterprise and urgency is high
  - summary: a single clear sentence describing the issue
  - confidence: 0.0-1.0 for your routing confidence

Base your decision strictly on the evidence provided. Be conservative with escalation.""",
            user=f"""Ticket ID: {ticket_id}
Subject: {subject}
Body: {body}
Account Tier: {account_tier}
Sentiment: {sentiment_result}
SLA Minutes Allowed: {sla_result['sla_minutes']}""",
            schema=TicketRoute,
        )

    log.info(
        f"[{ticket_id}] Route → path={decision_path} team={route.team} "
        f"escalate={route.escalate} confidence={route.confidence:.2f}"
    )

    # ── Conditional escalation (full path only reaches True) ──
    escalation_result = None
    if route.escalate:
        app.note(
            f"Escalating ticket {ticket_id} to {route.team}",
            ["escalation", "triggered"],
        )
        escalation_result = await app.call(
            "escalation-agent.create_case",
            ticket_id=ticket_id,
            team=route.team,
            summary=route.summary,
            account_tier=account_tier,
            sentiment=sentiment_result,
        )
        log.info(f"[{ticket_id}] Escalation case created: {escalation_result['case_id']}")

    # ── Store final outcome in memory ─────────────────────────
    outcome = {
        "ticket_id": ticket_id,
        "team": route.team,
        "escalated": route.escalate,
        "confidence": route.confidence,
        "summary": route.summary,
        "sla_minutes": sla_result["sla_minutes"],
        "priority_boost": sla_result["priority_boost"],
        "sentiment": sentiment_result,
        "escalation": escalation_result,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "decision_path": decision_path,
        "gate": gate_result,
        "gate_latency_ms": gate_latency_ms,
    }

    await app.memory.set(f"ticket:{ticket_id}:outcome", outcome)

    app.note(
        f"Ticket {ticket_id} processed: path={decision_path} team={route.team} escalated={route.escalate}",
        ["triage", "complete", decision_path],
    )

    return outcome


# ── Skill: fetch a previously processed ticket outcome ────────
@app.skill(tags=["history"])
async def get_ticket_outcome(ticket_id: str) -> dict:
    """Retrieve a stored ticket outcome from shared memory."""
    outcome = await app.memory.get(f"ticket:{ticket_id}:outcome")
    if outcome is None:
        return {"error": f"No outcome found for ticket {ticket_id}"}
    return outcome


if __name__ == "__main__":
    log.info(f"Starting orchestrator on port {AGENT_PORT}")
    app.run(port=AGENT_PORT, auto_port=False)
