#!/usr/bin/env python3
"""Compare the existing two-call triage path with Ollama /v1/systemone.

Path (a), "existing", replays the production sentiment prompt and the
production routing prompt as two Ollama POST /api/chat calls. It does not
start AgentField. The model name is BASELINE_MODEL (default
gemma4:31b-cloud, the stack's model without the "ollama/" prefix).

Path (b), "gate", is one POST /v1/systemone. The model name is
SYSTEMONE_MODEL (default tev1:0.8b).

Path (c) runs only when SYSTEMONE_COMPARE_MODEL is set, for example:

    SYSTEMONE_COMPARE_MODEL=nimble python eval/run_eval.py

Fast-path rate uses the orchestrator rule in
agents/gate/systemone.py:fast_path_eligible and GATE_CONFIDENCE_MIN
(default 0.7).

The live gate fails fast (SYSTEMONE_TIMEOUT_S, default 3s) so a missing
model falls back inside the product. This script waits longer so a cold
local model can load:

    EVAL_SYSTEMONE_TIMEOUT_S   default 60
    EVAL_BASELINE_TIMEOUT_S    default 180

On the host, point the base URL at localhost. host.docker.internal is for
containers:

    SYSTEMONE_BASE=http://127.0.0.1:11434 python eval/run_eval.py

A failed call counts as an error for that field and does not abort the
table. --check validates the labeled set and prints nothing to Ollama.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agents" / "gate"))
sys.path.insert(0, str(ROOT / "eval"))

from systemone import (  # noqa: E402
    TEAMS,
    URGENCIES,
    build_request,
    fast_path_eligible,
    normalize_response,
)
from tickets import TICKETS  # noqa: E402

UI_PRESET_IDS = ("preset-data-loss", "preset-billing", "preset-csv", "preset-praise")
FIELDS = ("team", "urgency", "escalate")

SENTIMENT_SYSTEM = """You are a sentiment analysis specialist for customer support.
Analyze the provided text and assess:
  - label: overall tone (positive/neutral/negative/angry)
  - urgency: how urgently this needs attention (low/medium/high/critical)
  - frustration_level: integer 1-10 (1=calm, 10=furious)
  - key_emotion: single word describing the dominant emotion
  - contains_threat: whether the customer threatens cancellation, legal action, or social media escalation

Be calibrated and evidence-based. Read between the lines for passive frustration.
Critical urgency is reserved for: data loss, security breach, complete service outage.

Reply with a single JSON object with keys label, urgency, frustration_level, key_emotion, contains_threat."""

ROUTING_SYSTEM = """You are an expert support ticket router.
Given ticket details, sentiment analysis, and SLA constraints, decide:
  - team: one of "support-engineering" | "billing" | "general" | "sales"
  - escalate: true only if urgency is critical AND frustration >= 7, or account_tier is enterprise and urgency is high
  - summary: a single clear sentence describing the issue
  - confidence: 0.0-1.0 for your routing confidence

Base your decision strictly on the evidence provided. Be conservative with escalation.
Reply with a single JSON object with keys team, escalate, summary, confidence."""

SLA_MINUTES = {"enterprise": 30, "pro": 120, "free": 1440}


def expected_escalate(ticket: dict) -> bool:
    """Label rule: escalate when urgency is critical, or the account is enterprise and urgency is high."""
    if ticket["urgency"] == "critical":
        return True
    if ticket["account_tier"] == "enterprise" and ticket["urgency"] == "high":
        return True
    return False


def validate_tickets(tickets: list[dict]) -> None:
    """Reject a labeled set that is the wrong size, duplicated, or inconsistent with the escalate rule."""
    if not 30 <= len(tickets) <= 50:
        raise SystemExit(f"expected 30-50 tickets, found {len(tickets)}")
    seen = set()
    for ticket in tickets:
        for key in ("id", "subject", "body", "account_tier", "team", "urgency", "escalate"):
            if key not in ticket:
                raise SystemExit(f"{ticket.get('id')} missing {key}")
        if ticket["id"] in seen:
            raise SystemExit(f"duplicate id {ticket['id']}")
        seen.add(ticket["id"])
        if ticket["team"] not in TEAMS:
            raise SystemExit(f"{ticket['id']} team {ticket['team']!r} is not a known team")
        if ticket["urgency"] not in URGENCIES:
            raise SystemExit(f"{ticket['id']} urgency {ticket['urgency']!r} is not a known urgency")
        if not isinstance(ticket["escalate"], bool):
            raise SystemExit(f"{ticket['id']} escalate must be a bool")
        if ticket["escalate"] is not expected_escalate(ticket):
            raise SystemExit(
                f"{ticket['id']} escalate={ticket['escalate']} does not match "
                "critical, or enterprise + high"
            )
    missing = [preset for preset in UI_PRESET_IDS if preset not in seen]
    if missing:
        raise SystemExit(f"missing UI presets: {', '.join(missing)}")


def env_float(name: str, default: float) -> float:
    """Read a float from the environment. A blank or invalid value returns the default."""
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def model_name(raw: str) -> str:
    """Strip a leading ollama/ prefix so the name matches the Ollama API."""
    name = raw.strip()
    if name.startswith("ollama/"):
        name = name[len("ollama/"):]
    return name


def percentile(values: list[float], pct: float) -> float | None:
    """Linear-interpolated percentile. An empty list returns None."""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * (pct / 100)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    weight = rank - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def http_json(url: str, payload: dict, timeout: float) -> tuple[dict | None, str | None]:
    """POST JSON with urllib. Returns (body, None) or (None, error)."""
    raw = json.dumps(payload).encode()
    request = urllib.request.Request(
        url,
        data=raw,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8")), None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        try:
            parsed = json.loads(detail)
            if isinstance(parsed, dict) and parsed.get("error"):
                detail = str(parsed["error"])[:300]
        except json.JSONDecodeError:
            pass
        return None, f"HTTP {exc.code}: {detail}"
    except Exception as exc:
        return None, str(exc)


def parse_json_content(content: str) -> dict | None:
    """Parse chat content, including a fenced JSON block or JSON embedded in a sentence."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return None
    return data if isinstance(data, dict) else None


def norm_token(value) -> str:
    """Lowercase a label and turn spaces or underscores into hyphens."""
    if not isinstance(value, str):
        return ""
    return "-".join(value.strip().lower().replace("_", "-").split())


def as_bool(value):
    """Coerce a model bool. true/yes/1 and false/no/0 are accepted. Anything else returns None."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "yes", "1"}:
            return True
        if lowered in {"false", "no", "0"}:
            return False
    return None


def ollama_chat(base: str, model: str, system: str, user: str, timeout: float):
    """One POST /api/chat call. Returns (parsed JSON, latency_ms, error)."""
    started = time.perf_counter()
    data, error = http_json(
        base.rstrip("/") + "/api/chat",
        {
            "model": model,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "options": {"temperature": 0.1},
        },
        timeout,
    )
    latency_ms = (time.perf_counter() - started) * 1000
    if error or not isinstance(data, dict):
        return None, latency_ms, error or "empty chat response"
    parsed = parse_json_content((data.get("message") or {}).get("content") or "")
    if parsed is None:
        return None, latency_ms, "chat response was not JSON"
    return parsed, latency_ms, None


def run_existing(base: str, model: str, ticket: dict, timeout: float) -> dict:
    """Replay sentiment, then routing. A failed call returns ok false and does not raise."""
    sentiment, sentiment_ms, sentiment_error = ollama_chat(
        base,
        model,
        SENTIMENT_SYSTEM,
        f"{ticket['subject']}\n\n{ticket['body']}",
        timeout,
    )
    if sentiment_error or sentiment is None:
        return {
            "ok": False,
            "error": f"sentiment: {sentiment_error}",
            "latency_ms": sentiment_ms,
            "team": None,
            "urgency": None,
            "escalate": None,
        }

    sla = SLA_MINUTES.get(ticket["account_tier"], 240)
    route, route_ms, route_error = ollama_chat(
        base,
        model,
        ROUTING_SYSTEM,
        (
            f"Subject: {ticket['subject']}\n"
            f"Body: {ticket['body']}\n"
            f"Account Tier: {ticket['account_tier']}\n"
            f"Sentiment: {json.dumps(sentiment)}\n"
            f"SLA Minutes Allowed: {sla}"
        ),
        timeout,
    )
    latency_ms = sentiment_ms + route_ms
    urgency = norm_token(sentiment.get("urgency"))
    if route_error or route is None:
        return {
            "ok": False,
            "error": f"routing: {route_error}",
            "latency_ms": latency_ms,
            "team": None,
            "urgency": urgency or None,
            "escalate": None,
        }
    return {
        "ok": True,
        "error": None,
        "latency_ms": latency_ms,
        "team": norm_token(route.get("team")),
        "urgency": urgency,
        "escalate": as_bool(route.get("escalate")),
    }


def run_gate(base: str, model: str, ticket: dict, timeout: float) -> dict:
    """One /v1/systemone call, normalized the same way the gate agent normalizes it."""
    _state, payload = build_request(model, ticket["subject"], ticket["body"], ticket["account_tier"])
    started = time.perf_counter()
    data, error = http_json(base.rstrip("/") + "/v1/systemone", payload, timeout)
    latency_ms = int((time.perf_counter() - started) * 1000)
    if error or not isinstance(data, dict):
        return {
            "ok": False,
            "error": error or "empty systemone response",
            "latency_ms": latency_ms,
            "model": model,
            "team": None,
            "urgency": None,
            "escalate": None,
            "fast": False,
        }
    normalized = normalize_response(data, latency_ms=latency_ms, model=model)
    if not normalized.get("ok"):
        normalized["team"] = None
        normalized["urgency"] = None
        normalized["escalate"] = None
        normalized["fast"] = False
        return normalized
    normalized["escalate"] = bool(normalized["needs_escalation"])
    normalized["fast"] = fast_path_eligible(
        normalized,
        env_float("GATE_CONFIDENCE_MIN", 0.7),
        ticket["account_tier"],
    )
    return normalized


class Scoreboard:
    """Accuracy, error, latency, and fast-path counts for one evaluated path."""

    def __init__(self, path: str, model: str, track_fast: bool):
        """Start an empty board. track_fast is true only for a gate path."""
        self.path = path
        self.model = model
        self.track_fast = track_fast
        self.correct = {field: 0 for field in FIELDS}
        self.predicted = {field: 0 for field in FIELDS}
        self.errors = {field: 0 for field in FIELDS}
        self.latencies: list[float] = []
        self.fast = 0
        self.fast_correct = 0
        self.n = 0

    def add(self, ticket: dict, result: dict) -> None:
        """Score one ticket. A missing prediction counts as a field error."""
        self.n += 1
        if result.get("latency_ms") is not None and result.get("ok"):
            self.latencies.append(float(result["latency_ms"]))
        predicted = {
            "team": result.get("team") or "",
            "urgency": result.get("urgency") or "",
            "escalate": result.get("escalate"),
        }
        all_match = True
        for field in FIELDS:
            if predicted[field] in (None, ""):
                self.errors[field] += 1
                all_match = False
                continue
            self.predicted[field] += 1
            if predicted[field] == ticket[field]:
                self.correct[field] += 1
            else:
                all_match = False
        if self.track_fast and result.get("fast"):
            self.fast += 1
            if all_match:
                self.fast_correct += 1


def fmt_pct(correct: int, total: int) -> str:
    """Format accuracy as a percent. Zero scored tickets print an em dash."""
    if total == 0:
        return "—"
    return f"{(100.0 * correct / total):5.1f}%"


def fmt_ms(value: float | None) -> str:
    """Format milliseconds for the report table. None prints an em dash."""
    if value is None:
        return "—"
    return f"{value:8.0f}"


def print_report(boards: list[Scoreboard], ticket_count: int, confidence_min: float) -> None:
    """Print per-field accuracy and latency tables to stdout."""
    print()
    print(f"Decision-gate evaluation  ({ticket_count} tickets)")
    print(f"Fast path when confidence >= {confidence_min:.2f}, urgency is not critical,")
    print("needs_escalation is false, and the ticket is not enterprise + high.")
    print()
    header = f"{'path':<12} {'model':<22} {'field':<10} {'accuracy':>8} {'correct':>8} {'scored':>7} {'errors':>7}"
    print(header)
    print("-" * len(header))
    for board in boards:
        for field in FIELDS:
            scored = board.predicted[field]
            print(
                f"{board.path:<12} {board.model:<22} {field:<10} "
                f"{fmt_pct(board.correct[field], board.n):>8} "
                f"{board.correct[field]:8d} {scored:7d} {board.errors[field]:7d}"
            )
    print()
    header = f"{'path':<12} {'model':<22} {'p50 ms':>8} {'p95 ms':>8} {'fast path':>18} {'fast correct':>14}"
    print(header)
    print("-" * len(header))
    for board in boards:
        if board.track_fast:
            fast = f"{board.fast}/{board.n} ({fmt_pct(board.fast, board.n).strip()})"
            fast_ok = "—" if board.fast == 0 else f"{board.fast_correct}/{board.fast}"
        else:
            fast = "—"
            fast_ok = "—"
        print(
            f"{board.path:<12} {board.model:<22} "
            f"{fmt_ms(percentile(board.latencies, 50)):>8} "
            f"{fmt_ms(percentile(board.latencies, 95)):>8} "
            f"{fast:>18} {fast_ok:>14}"
        )
    print()


def dataset_table(tickets: list[dict]) -> None:
    """Print team, urgency, and escalation counts for the labeled set."""
    print(f"Labeled tickets: {len(tickets)}  (UI presets: {len(UI_PRESET_IDS)})")
    print(f"{'team':<22} {'n':>4}")
    for team in TEAMS:
        count = sum(1 for ticket in tickets if ticket["team"] == team)
        print(f"{team:<22} {count:4d}")
    print(f"{'urgency':<22} {'n':>4}")
    for urgency in URGENCIES:
        count = sum(1 for ticket in tickets if ticket["urgency"] == urgency)
        print(f"{urgency:<22} {count:4d}")
    escalations = sum(1 for ticket in tickets if ticket["escalate"])
    print(f"{'escalate':<22} {escalations:4d}")


def main() -> None:
    """Validate the dataset, run the requested paths, and print the report."""
    parser = argparse.ArgumentParser(description="Compare triage paths on labeled tickets.")
    parser.add_argument("--limit", type=int, default=0, help="Evaluate only the first N tickets.")
    parser.add_argument("--skip-baseline", action="store_true", help="Do not run the two chat calls.")
    parser.add_argument("--check", action="store_true", help="Validate the labeled set and exit.")
    args = parser.parse_args()

    tickets = list(TICKETS)
    validate_tickets(tickets)
    if args.limit > 0:
        tickets = tickets[: args.limit]
    if args.check:
        dataset_table(TICKETS)
        return

    base = os.environ.get("SYSTEMONE_BASE") or os.environ.get("OLLAMA_API_BASE") or "http://127.0.0.1:11434"
    baseline_model = model_name(os.environ.get("BASELINE_MODEL", "gemma4:31b-cloud"))
    gate_model = model_name(os.environ.get("SYSTEMONE_MODEL", "tev1:0.8b"))
    compare_model = os.environ.get("SYSTEMONE_COMPARE_MODEL", "").strip()
    compare_model = model_name(compare_model) if compare_model else ""
    gate_timeout = env_float("EVAL_SYSTEMONE_TIMEOUT_S", 60)
    baseline_timeout = env_float("EVAL_BASELINE_TIMEOUT_S", 180)
    confidence_min = env_float("GATE_CONFIDENCE_MIN", 0.7)

    print(
        f"base={base} baseline={baseline_model} gate={gate_model} "
        f"compare={compare_model or '—'} tickets={len(tickets)}",
        file=sys.stderr,
    )

    boards: list[Scoreboard] = []
    baseline = None
    if not args.skip_baseline:
        baseline = Scoreboard("existing", baseline_model, track_fast=False)
        boards.append(baseline)
    gate = Scoreboard("gate", gate_model, track_fast=True)
    boards.append(gate)
    compare = None
    if compare_model:
        compare = Scoreboard("gate", compare_model, track_fast=True)
        boards.append(compare)

    for index, ticket in enumerate(tickets, start=1):
        if baseline is not None:
            result = run_existing(base, baseline_model, ticket, baseline_timeout)
            baseline.add(ticket, result)
            print(
                f"[{index}/{len(tickets)}] existing {ticket['id']} "
                f"ok={result.get('ok')} {result.get('latency_ms', 0):.0f}ms",
                file=sys.stderr,
            )
        gate_result = run_gate(base, gate_model, ticket, gate_timeout)
        gate.add(ticket, gate_result)
        print(
            f"[{index}/{len(tickets)}] gate:{gate_model} {ticket['id']} "
            f"ok={gate_result.get('ok')} fast={gate_result.get('fast')} "
            f"{gate_result.get('latency_ms', 0)}ms",
            file=sys.stderr,
        )
        if compare is not None:
            compare_result = run_gate(base, compare_model, ticket, gate_timeout)
            compare.add(ticket, compare_result)
            print(
                f"[{index}/{len(tickets)}] gate:{compare_model} {ticket['id']} "
                f"ok={compare_result.get('ok')} fast={compare_result.get('fast')} "
                f"{compare_result.get('latency_ms', 0)}ms",
                file=sys.stderr,
            )

    print_report(boards, len(tickets), confidence_min)


if __name__ == "__main__":
    main()
