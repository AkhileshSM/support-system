"""
sla-agent/app.py

Pure deterministic SLA policy lookup. No LLM — this is a Skill,
not a Reasoner. Returns SLA minutes and priority boost per account tier.

Endpoints exposed:
  POST /api/v1/execute/sla-agent.get_policy
"""
import logging
import os

from agentfield import Agent, AIConfig
from startup import install_shutdown_handler, wait_for_control_plane

log = logging.getLogger("sla-agent")

AGENTFIELD_SERVER = os.environ["AGENTFIELD_SERVER"]
AGENT_PORT        = int(os.environ.get("AGENT_PORT", 9003))

wait_for_control_plane(AGENTFIELD_SERVER)

app = Agent(
    node_id=os.environ.get("AGENT_NODE_ID", "sla-agent"),
    agentfield_server=AGENTFIELD_SERVER,
    ai_config=AIConfig(model="ollama/gemma4:31b-cloud"),
    tags=["policy", "sla", "production"],
    description="Deterministic SLA policy lookup — no LLM, pure business rules",
    port=AGENT_PORT,
    dev_mode=True,
)

install_shutdown_handler(app)


# SLA table: (tier, priority_label) → minutes to first response
_SLA_TABLE = {
    "enterprise": {"sla_minutes": 30,   "priority_boost": True,  "tier_label": "Enterprise"},
    "pro":        {"sla_minutes": 120,  "priority_boost": False, "tier_label": "Pro"},
    "free":       {"sla_minutes": 1440, "priority_boost": False, "tier_label": "Free"},
}

_DEFAULT_SLA = {"sla_minutes": 240, "priority_boost": False, "tier_label": "Unknown"}


@app.skill(tags=["policy", "sla"])
def get_policy(tier: str) -> dict:
    """
    Return the SLA policy for a given account tier.
    Deterministic — no AI involved. Pure lookup table.
    """
    tier_key = tier.lower().strip()
    policy = _SLA_TABLE.get(tier_key, _DEFAULT_SLA)

    log.info(f"SLA lookup: tier={tier} → {policy['sla_minutes']}min boost={policy['priority_boost']}")

    return {
        **policy,
        "tier_input": tier,
        "response_target": _format_duration(policy["sla_minutes"]),
    }


@app.skill(tags=["policy"])
def list_tiers() -> dict:
    """Return all available SLA tiers and their policies."""
    return {"tiers": _SLA_TABLE}


def _format_duration(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} minutes"
    hours = minutes // 60
    return f"{hours} hour{'s' if hours != 1 else ''}"


if __name__ == "__main__":
    log.info(f"Starting sla-agent on port {AGENT_PORT}")
    app.run(port=AGENT_PORT, auto_port=False)
