"""
triage-orchestrator/app.py

The main orchestrator agent. Receives incoming tickets, fans out
to sentiment + SLA agents in parallel, makes an AI routing decision,
then conditionally calls the escalation agent.

Endpoints exposed:
  POST /api/v1/execute/triage-orchestrator.handle_ticket
"""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone

from agentfield import Agent, AIConfig
from pydantic import BaseModel
from startup import install_shutdown_handler, wait_for_control_plane

log = logging.getLogger("orchestrator")

# ── Configuration from environment ───────────────────────────
AGENTFIELD_SERVER = os.environ["AGENTFIELD_SERVER"]
AGENT_PORT        = int(os.environ.get("AGENT_PORT", 9001))

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
    description="Orchestrates ticket triage: sentiment → SLA → AI routing → escalation",
    port=AGENT_PORT,
    dev_mode=True,
)

install_shutdown_handler(app)


# ── Output schemas ────────────────────────────────────────────
class TicketRoute(BaseModel):
    team: str             # "support-engineering" | "billing" | "general" | "sales"
    escalate: bool        # True if this needs immediate human attention
    summary: str          # One-line summary for the queue
    confidence: float     # 0.0–1.0 — how sure the AI is about the routing


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

    # ── Fan out to specialist agents in parallel ──────────────
    app.note(f"Fanning out to sentiment + SLA agents", ["triage", "fanout"])

    sentiment_result, sla_result = await asyncio.gather(
        app.call(
            "sentiment-agent.analyze",
            text=f"{subject}\n\n{body}",
        ),
        app.call(
            "sla-agent.get_policy",
            tier=account_tier,
        ),
    )

    log.info(
        f"[{ticket_id}] sentiment={sentiment_result['label']} "
        f"urgency={sentiment_result['urgency']} "
        f"sla={sla_result['sla_minutes']}min"
    )

    # ── AI makes the final routing decision ───────────────────
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
        f"[{ticket_id}] Route → team={route.team} "
        f"escalate={route.escalate} confidence={route.confidence:.2f}"
    )

    # ── Conditional escalation ────────────────────────────────
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
    }

    await app.memory.set(f"ticket:{ticket_id}:outcome", outcome)

    app.note(
        f"Ticket {ticket_id} processed: team={route.team} escalated={route.escalate}",
        ["triage", "complete"],
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
