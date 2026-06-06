"""
sentiment-agent/app.py

Analyzes the emotional tone and urgency of customer support text.
Uses Claude to produce a structured, validated sentiment assessment.

Endpoints exposed:
  POST /api/v1/execute/sentiment-agent.analyze
"""
import logging
import os
from typing import Literal

from agentfield import Agent, AIConfig
from pydantic import BaseModel, Field
from startup import install_shutdown_handler, wait_for_control_plane

log = logging.getLogger("sentiment-agent")

AGENTFIELD_SERVER = os.environ["AGENTFIELD_SERVER"]
AGENT_PORT        = int(os.environ.get("AGENT_PORT", 9002))

wait_for_control_plane(AGENTFIELD_SERVER)

app = Agent(
    node_id=os.environ.get("AGENT_NODE_ID", "sentiment-agent"),
    agentfield_server=AGENTFIELD_SERVER,
    ai_config=AIConfig(
        model="ollama/gemma4:31b-cloud",
        temperature=0.1,    # Low temp — we want consistent classification
        max_tokens=512,
    ),
    tags=["nlp", "support", "production"],
    description="Analyzes sentiment and urgency of customer support text",
    port=AGENT_PORT,
    dev_mode=True,
)

install_shutdown_handler(app)


class SentimentResult(BaseModel):
    label: Literal["positive", "neutral", "negative", "angry"]
    urgency: Literal["low", "medium", "high", "critical"]
    frustration_level: int = Field(
        ge=1, le=10,
        description="1=calm and patient, 10=furious and threatening to leave",
    )
    key_emotion: str = Field(
        description="One word: the dominant emotion (frustrated, confused, panicked, etc.)"
    )
    contains_threat: bool = Field(
        description="True if customer threatens to cancel, escalate, or take legal action"
    )


@app.reasoner(tags=["nlp", "sentiment"])
async def analyze(text: str) -> dict:
    """
    Analyze customer support text for sentiment, urgency, and frustration.
    Returns a structured SentimentResult validated by Pydantic.
    """
    log.info(f"Analyzing sentiment for text length={len(text)}")

    result = await app.ai(
        system="""You are a sentiment analysis specialist for customer support.
Analyze the provided text and assess:
  - label: overall tone (positive/neutral/negative/angry)
  - urgency: how urgently this needs attention (low/medium/high/critical)
  - frustration_level: integer 1-10 (1=calm, 10=furious)
  - key_emotion: single word describing the dominant emotion
  - contains_threat: whether the customer threatens cancellation, legal action, or social media escalation

Be calibrated and evidence-based. Read between the lines for passive frustration.
Critical urgency is reserved for: data loss, security breach, complete service outage.""",
        user=text,
        schema=SentimentResult,
    )

    log.info(
        f"Sentiment: label={result.label} urgency={result.urgency} "
        f"frustration={result.frustration_level} threat={result.contains_threat}"
    )

    app.note(
        f"Sentiment: {result.label} / urgency={result.urgency} / frustration={result.frustration_level}",
        ["sentiment", result.urgency],
    )

    return result.model_dump()


if __name__ == "__main__":
    log.info(f"Starting sentiment-agent on port {AGENT_PORT}")
    app.run(port=AGENT_PORT, auto_port=False)
