"""
escalation-agent/app.py

Creates escalation cases with AI-drafted messages and stores them
in shared memory for the UI to display. In production you would
also post to Slack, PagerDuty, Jira, etc.

Endpoints exposed:
  POST /api/v1/execute/escalation-agent.create_case
  POST /api/v1/execute/escalation-agent.list_cases
"""
import logging
import os
import uuid
from datetime import datetime, timezone

from agentfield import Agent, AIConfig
from pydantic import BaseModel
from startup import install_shutdown_handler, wait_for_control_plane

log = logging.getLogger("escalation-agent")

AGENTFIELD_SERVER = os.environ["AGENTFIELD_SERVER"]
AGENT_PORT        = int(os.environ.get("AGENT_PORT", 9004))

wait_for_control_plane(AGENTFIELD_SERVER)

app = Agent(
    node_id=os.environ.get("AGENT_NODE_ID", "escalation-agent"),
    agentfield_server=AGENTFIELD_SERVER,
    ai_config=AIConfig(
        model="ollama/gemma4:31b-cloud",
        temperature=0.3,
        max_tokens=512,
    ),
    tags=["escalation", "support", "production"],
    description="Creates and tracks escalation cases with AI-drafted alert messages",
    port=AGENT_PORT,
    dev_mode=True,
)

install_shutdown_handler(app)


class EscalationDraft(BaseModel):
    alert_message: str    # Short Slack-style message for the on-call team
    severity: str         # "P1" | "P2" | "P3"
    action_required: str  # What the on-call engineer should do first


@app.reasoner(tags=["escalation"])
async def create_case(
    ticket_id: str,
    team: str,
    summary: str,
    account_tier: str,
    sentiment: dict,
) -> dict:
    """
    Create an escalation case with an AI-drafted alert message.
    Stores the case in global shared memory for cross-agent access.
    """
    case_id = f"ESC-{uuid.uuid4().hex[:8].upper()}"
    created_at = datetime.now(timezone.utc).isoformat()

    log.info(f"Creating escalation case {case_id} for ticket {ticket_id}")

    # AI drafts the alert message
    draft = await app.ai(
        system="""You draft concise escalation alerts for a support engineering team.
Format for Slack. Include: ticket ID, severity, what happened, what to do first.
Keep it under 3 sentences. Be direct. No fluff.
Severity:
  P1 = critical / data loss / security / enterprise customer completely blocked
  P2 = major feature broken, enterprise customer impacted
  P3 = high frustration, repeated issues, needs manager attention""",
        user=f"""Ticket: {ticket_id}
Summary: {summary}
Team: {team}
Account Tier: {account_tier}
Sentiment: {sentiment}""",
        schema=EscalationDraft,
    )

    case = {
        "case_id": case_id,
        "ticket_id": ticket_id,
        "team": team,
        "summary": summary,
        "account_tier": account_tier,
        "sentiment_label": sentiment.get("label"),
        "urgency": sentiment.get("urgency"),
        "severity": draft.severity,
        "alert_message": draft.alert_message,
        "action_required": draft.action_required,
        "status": "open",
        "created_at": created_at,
    }

    # Store in global memory so other agents and the UI can see it
    await app.memory.global_scope.set(f"case:{case_id}", case)

    # Append to the cases index
    existing_index = await app.memory.global_scope.get("cases:index") or []
    existing_index.insert(0, case_id)
    existing_index = existing_index[:100]   # Keep last 100
    await app.memory.global_scope.set("cases:index", existing_index)

    log.info(f"Case {case_id} created: severity={draft.severity}")

    app.note(
        f"Escalation case {case_id} created for ticket {ticket_id} — {draft.severity}",
        ["escalation", draft.severity, team],
    )

    # In production: post to Slack, create Jira ticket, page PagerDuty
    # await post_to_slack(team, draft.alert_message)
    # await create_jira_ticket(case)

    return case


@app.skill(tags=["escalation"])
async def list_cases(limit: int = 20) -> dict:
    """Return the most recent escalation cases from shared memory."""
    index = await app.memory.global_scope.get("cases:index") or []
    cases = []
    for case_id in index[:limit]:
        case = await app.memory.global_scope.get(f"case:{case_id}")
        if case:
            cases.append(case)
    return {"cases": cases, "total": len(index)}


if __name__ == "__main__":
    log.info(f"Starting escalation-agent on port {AGENT_PORT}")
    app.run(port=AGENT_PORT, auto_port=False)
