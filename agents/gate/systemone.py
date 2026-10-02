"""
systemone.py — Ollama POST /v1/systemone request builder and normalizer.

Pure functions. No AgentField import, so the eval script and unit tests
can use the same payload the gate agent sends.

Verified against the Ollama docs on 2026-10-02:
  https://docs.ollama.com/api/systemone
  https://docs.ollama.com/capabilities/decision

Schema this module follows (the early sketch of noul-as-a-string and
score-as-a-dict does not match the published API):

  - choice criteria: object, option key → description, 2–26 options.
  - noul criteria: object with optional "false" and "true" strings.
    The answer field "noul" is a probability in [0, 1], not a boolean.
    Noul answers have no confidence field.
  - score criteria: array of 2–26 descriptions, lowest to highest.
    "score" is the probability-weighted average of the zero-based
    indexes, not a 1–10 rating.
  - 1–64 questions, no streaming, 64 KiB cap without images.

Assumptions layered on that schema:

  - contains_threat / needs_escalation are true when noul >= 0.5.
  - Noul confidence, used only for the overall minimum, is
    abs(probability - 0.5) * 2. That is 0 at a coin flip and 1 at 0 or 1.
  - Frustration criteria are 10 short levels. Index 0 maps to 1 and
    index 9 maps to 10, linearly, rounded half-up.
  - Overall confidence is the minimum of the choice confidences, the
    score confidence, and the two derived noul confidences.
  - Subject + body are capped at 1,200 characters. tev1:0.8b's context
    is about 2,000 tokens and the state is repeated for every question.
"""
from __future__ import annotations

MAX_TICKET_CHARS = 1200
NOUL_TRUE_AT = 0.5

TEAMS = ("support-engineering", "billing", "general", "sales")
URGENCIES = ("low", "medium", "high", "critical")

# Index 0 is frustration 1 (calm). Index 9 is frustration 10.
FRUSTRATION_CRITERIA = (
    "Calm",
    "Slightly annoyed",
    "Impatient",
    "Frustrated",
    "Upset",
    "Angry",
    "Very angry",
    "Furious",
    "Threatening",
    "About to leave",
)


def questions() -> dict:
    """Return a fresh question set. Callers must not mutate the template."""
    return {
        "team": {
            "type": "choice",
            "instructions": "Which team should own this ticket?",
            "criteria": {
                "support-engineering": "Bugs, outages, data loss, API or product errors",
                "billing": "Charges, invoices, refunds, or subscription plans",
                "general": "How-to questions, feedback, or account how-tos",
                "sales": "Pricing, upgrades, demos, or a new purchase",
            },
        },
        "urgency": {
            "type": "choice",
            "instructions": "How urgently does this need a response?",
            "criteria": {
                "low": "No time pressure: praise or a simple question",
                "medium": "Inconvenient, but the product still works",
                "high": "A major feature is broken or the customer is blocked",
                "critical": "Outage, data loss, or a security breach",
            },
        },
        "contains_threat": {
            "type": "noul",
            "instructions": "Does the customer threaten to cancel, sue, or post publicly?",
            "criteria": {
                "false": "No cancel, legal, or public threat",
                "true": "Threatens to cancel, sue, or post publicly",
            },
        },
        "needs_escalation": {
            "type": "noul",
            "instructions": "Does this need immediate human escalation?",
            "criteria": {
                "false": "A normal queue can handle it",
                "true": "Critical outage, data loss, security, or enterprise high severity",
            },
        },
        "frustration": {
            "type": "score",
            "instructions": "How frustrated is the customer?",
            "criteria": list(FRUSTRATION_CRITERIA),
        },
    }


def build_state(subject: str, body: str, account_tier: str) -> str:
    """Build the systemone state. Subject + body stay within 1,200 chars."""
    subject = " ".join((subject or "").split())
    body = " ".join((body or "").split())
    tier = " ".join((account_tier or "unknown").split()) or "unknown"

    if len(subject) > MAX_TICKET_CHARS:
        subject = subject[: MAX_TICKET_CHARS - 1].rstrip() + "…"
        body = ""
    else:
        body_budget = MAX_TICKET_CHARS - len(subject)
        if len(body) > body_budget:
            if body_budget <= 1:
                body = ""
            else:
                body = body[: body_budget - 1].rstrip() + "…"

    text = f"Tier: {tier}\nSubject: {subject}\n\n{body}"
    return text.strip()


def build_request(model: str, subject: str, body: str, account_tier: str) -> tuple[str, dict]:
    """Return (state, JSON body) for POST /v1/systemone."""
    state = build_state(subject, body, account_tier)
    payload = {
        "model": model,
        "state": state,
        "questions": questions(),
    }
    return state, payload


def noul_confidence(probability: float) -> float:
    """Confidence stand-in for a noul answer, which has no confidence field."""
    return _clamp01(abs(float(probability) - 0.5) * 2)


def frustration_from_score(score: float, n_levels: int) -> int:
    """Map a zero-based weighted score onto the 1–10 frustration scale."""
    if n_levels <= 1:
        return 1
    scaled = 1 + (float(score) / (n_levels - 1)) * 9
    # Half-up for positive numbers. Avoid Python's bankers' round().
    value = int(scaled + 0.5)
    return max(1, min(10, value))


def normalize_response(data: dict, latency_ms: int, model: str) -> dict:
    """Turn a System One JSON body into the gate's normalized dict.

    Returns ok=false instead of raising when the body is missing answers
    or a label is outside the question criteria.
    """
    if not isinstance(data, dict):
        return {"ok": False, "error": "response was not a JSON object"}

    answers = data.get("answers")
    if not isinstance(answers, dict):
        return {"ok": False, "error": "response missing answers object"}

    try:
        team_answer = _require_answer(answers, "team", "choice")
        urgency_answer = _require_answer(answers, "urgency", "choice")
        threat_answer = _require_answer(answers, "contains_threat", "noul")
        escalate_answer = _require_answer(answers, "needs_escalation", "noul")
        frustration_answer = _require_answer(answers, "frustration", "score")
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    team = team_answer.get("choice")
    urgency = urgency_answer.get("choice")
    if team not in TEAMS:
        return {"ok": False, "error": f"unexpected team {team!r}"}
    if urgency not in URGENCIES:
        return {"ok": False, "error": f"unexpected urgency {urgency!r}"}

    try:
        threat_p = _probability(threat_answer.get("noul"), "contains_threat")
        escalate_p = _probability(escalate_answer.get("noul"), "needs_escalation")
        score = float(frustration_answer.get("score"))
        team_conf = float(team_answer["confidence"])
        urgency_conf = float(urgency_answer["confidence"])
        frustration_conf = float(frustration_answer["confidence"])
    except (KeyError, TypeError, ValueError) as exc:
        return {"ok": False, "error": f"unreadable answer field: {exc}"}

    legend = frustration_answer.get("legend")
    if isinstance(legend, dict) and legend:
        n_levels = len(legend)
    else:
        n_levels = len(FRUSTRATION_CRITERIA)
    if score < 0 or score > max(0, n_levels - 1):
        return {"ok": False, "error": f"frustration score {score} outside 0..{n_levels - 1}"}

    confidences = [
        _clamp01(team_conf),
        _clamp01(urgency_conf),
        _clamp01(frustration_conf),
        noul_confidence(threat_p),
        noul_confidence(escalate_p),
    ]

    frustration_probs = frustration_answer.get("probabilities")
    team_probs = team_answer.get("probabilities")
    urgency_probs = urgency_answer.get("probabilities")
    if not isinstance(team_probs, dict) or not isinstance(urgency_probs, dict):
        return {"ok": False, "error": "choice answer missing probabilities"}
    if not isinstance(frustration_probs, dict):
        frustration_probs = {}

    return {
        "ok": True,
        "team": team,
        "urgency": urgency,
        "contains_threat": threat_p >= NOUL_TRUE_AT,
        "needs_escalation": escalate_p >= NOUL_TRUE_AT,
        "frustration": frustration_from_score(score, n_levels),
        "probabilities": {
            "team": team_probs,
            "urgency": urgency_probs,
            "contains_threat": {"false": 1 - threat_p, "true": threat_p},
            "needs_escalation": {"false": 1 - escalate_p, "true": escalate_p},
            "frustration": frustration_probs,
        },
        "confidence": min(confidences),
        "latency_ms": int(latency_ms),
        "model": data.get("model") or model,
    }


def fast_path_eligible(gate: dict, confidence_min: float, account_tier: str) -> bool:
    """True when sentiment and routing LLM calls may be skipped.

    Mirrors the orchestrator rule. Critical urgency, a positive
    needs_escalation answer, low confidence, and enterprise + high
    urgency all stay on the full path. Enterprise + high is the
    existing escalation rule, so a confident gate must not skip it.
    """
    if not isinstance(gate, dict) or gate.get("ok") is not True:
        return False
    if gate.get("team") not in TEAMS or gate.get("urgency") not in URGENCIES:
        return False
    if gate.get("urgency") == "critical":
        return False
    # Missing or non-bool means we do not trust the hint.
    if gate.get("needs_escalation") is not False:
        return False
    if not _valid_frustration(gate.get("frustration")):
        return False
    try:
        confidence = float(gate["confidence"])
    except (KeyError, TypeError, ValueError):
        return False
    if confidence < confidence_min:
        return False
    tier = (account_tier or "").strip().lower()
    if tier == "enterprise" and gate.get("urgency") == "high":
        return False
    return True


def _require_answer(answers: dict, name: str, expected_type: str) -> dict:
    """Return one answer object, or raise ValueError when it is missing or the wrong type."""
    answer = answers.get(name)
    if not isinstance(answer, dict):
        raise ValueError(f"missing answer for {name}")
    if answer.get("type") != expected_type:
        raise ValueError(f"{name} type is {answer.get('type')!r}, expected {expected_type}")
    return answer


def _probability(value, name: str) -> float:
    """Parse a noul probability and reject values outside 0..1."""
    probability = float(value)
    if probability < 0 or probability > 1:
        raise ValueError(f"{name} probability {probability} outside 0..1")
    return probability


def _valid_frustration(value) -> bool:
    """True for a whole number from 1 to 10. Booleans are rejected."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and not value.is_integer():
        return False
    return 1 <= int(value) <= 10


def _clamp01(value: float) -> float:
    """Clamp a confidence into the closed interval 0..1."""
    return max(0.0, min(1.0, float(value)))
