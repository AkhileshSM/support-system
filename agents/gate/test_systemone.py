"""Unit tests for the System One request builder and normalizer."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from systemone import (
    MAX_TICKET_CHARS,
    TEAMS,
    URGENCIES,
    build_request,
    build_state,
    fast_path_eligible,
    frustration_from_score,
    normalize_response,
    noul_confidence,
    questions,
)


def _sample_response(**overrides) -> dict:
    """A valid System One body. Keyword arguments replace individual answers."""
    answers = {
        "team": {
            "type": "choice",
            "choice": "general",
            "probabilities": {
                "support-engineering": 0.04,
                "billing": 0.05,
                "general": 0.88,
                "sales": 0.03,
            },
            "confidence": 0.91,
        },
        "urgency": {
            "type": "choice",
            "choice": "low",
            "probabilities": {"low": 0.9, "medium": 0.07, "high": 0.02, "critical": 0.01},
            "confidence": 0.86,
        },
        "contains_threat": {"type": "noul", "noul": 0.04},
        "needs_escalation": {"type": "noul", "noul": 0.03},
        "frustration": {
            "type": "score",
            "score": 0.4,
            "legend": {str(i): f"level-{i}" for i in range(10)},
            "probabilities": {str(i): 0.1 for i in range(10)},
            "confidence": 0.8,
        },
    }
    for key, value in overrides.items():
        answers[key] = value
    return {"model": "tev1:0.8b", "answers": answers, "usage": {"input_tokens": 1, "output_tokens": 1}}


class QuestionSchemaTests(unittest.TestCase):
    """The request matches the published /v1/systemone schema."""

    def test_question_types_match_the_published_api(self):
        """Choice criteria are objects, noul criteria are false/true strings, and score criteria are a list."""
        payload = questions()
        self.assertEqual(set(payload), {"team", "urgency", "contains_threat", "needs_escalation", "frustration"})
        self.assertEqual(payload["team"]["type"], "choice")
        self.assertEqual(set(payload["team"]["criteria"]), set(TEAMS))
        self.assertEqual(set(payload["urgency"]["criteria"]), set(URGENCIES))
        # Noul criteria is an object of false/true strings, not a single string.
        self.assertEqual(set(payload["contains_threat"]["criteria"]), {"false", "true"})
        self.assertIsInstance(payload["contains_threat"]["criteria"]["true"], str)
        # Score criteria is an ordered list, not a dict of "1"/"10".
        frustration = payload["frustration"]["criteria"]
        self.assertIsInstance(frustration, list)
        self.assertEqual(len(frustration), 10)
        self.assertTrue(all(isinstance(item, str) for item in frustration))

    def test_state_truncates_ticket_text_to_1200_chars(self):
        """Subject plus body stay within 1,200 characters and keep the tier line."""
        state = build_state("Short subject", "x" * 5000, "pro")
        subject = "Short subject"
        body = state.split("\n\n", 1)[1]
        self.assertLessEqual(len(subject) + len(body), MAX_TICKET_CHARS)
        self.assertTrue(body.endswith("…"))
        self.assertIn("Tier: pro", state)

    def test_request_uses_the_env_model_name(self):
        """The JSON body carries the caller-supplied model and omits images."""
        state, payload = build_request("nimble", "Hi", "Thanks", "free")
        self.assertEqual(payload["model"], "nimble")
        self.assertEqual(payload["state"], state)
        self.assertNotIn("images", payload)


class NormalizeTests(unittest.TestCase):
    """Response parsing maps scores and treats bad payloads as ok false."""

    def test_happy_path_maps_score_and_derives_noul_confidence(self):
        """Overall confidence is the minimum, and noul probabilities are synthesized."""
        result = normalize_response(_sample_response(), latency_ms=42, model="tev1:0.8b")
        self.assertTrue(result["ok"])
        self.assertEqual(result["team"], "general")
        self.assertEqual(result["urgency"], "low")
        self.assertFalse(result["contains_threat"])
        self.assertFalse(result["needs_escalation"])
        self.assertEqual(result["frustration"], frustration_from_score(0.4, 10))
        self.assertEqual(result["latency_ms"], 42)
        self.assertEqual(result["model"], "tev1:0.8b")
        # Noul 0.04 is very decisive, but team/urgency/score confidences are lower.
        self.assertAlmostEqual(noul_confidence(0.04), 0.92)
        self.assertAlmostEqual(result["confidence"], 0.8)
        self.assertAlmostEqual(result["probabilities"]["contains_threat"]["true"], 0.04)

    def test_noul_at_half_has_zero_confidence_and_blocks_via_min(self):
        """A 0.5 noul answer has confidence 0 and counts as needs_escalation."""
        data = _sample_response(
            needs_escalation={"type": "noul", "noul": 0.5},
        )
        result = normalize_response(data, latency_ms=5, model="tev1:0.8b")
        self.assertTrue(result["ok"])
        self.assertEqual(result["confidence"], 0.0)
        self.assertTrue(result["needs_escalation"])

    def test_score_endpoints_map_onto_one_and_ten(self):
        """Score index 0 maps to frustration 1 and index 9 maps to 10."""
        self.assertEqual(frustration_from_score(0, 10), 1)
        self.assertEqual(frustration_from_score(9, 10), 10)

    def test_missing_answer_is_not_ok(self):
        """A missing team answer returns ok false and names the field."""
        data = _sample_response()
        del data["answers"]["team"]
        result = normalize_response(data, latency_ms=1, model="tev1:0.8b")
        self.assertFalse(result["ok"])
        self.assertIn("team", result["error"])

    def test_unknown_choice_is_not_ok(self):
        """A team label outside the criteria returns ok false."""
        data = _sample_response()
        data["answers"]["team"] = {
            **data["answers"]["team"],
            "choice": "security",
        }
        result = normalize_response(data, latency_ms=1, model="tev1:0.8b")
        self.assertFalse(result["ok"])
        self.assertIn("security", result["error"])


class FastPathTests(unittest.TestCase):
    """Fast path is allowed only for a confident, non-escalating gate."""

    def _gate(self, **overrides):
        """Build a normalized gate result and overlay the fields under test."""
        result = normalize_response(_sample_response(), latency_ms=10, model="tev1:0.8b")
        result.update(overrides)
        return result

    def test_clear_low_urgency_ticket_is_fast(self):
        """A confident low-urgency pro ticket takes the fast path."""
        self.assertTrue(fast_path_eligible(self._gate(), 0.7, "pro"))

    def test_low_confidence_stays_full(self):
        """Confidence 0.69 stays under the 0.7 cutoff."""
        self.assertFalse(fast_path_eligible(self._gate(confidence=0.69), 0.7, "pro"))

    def test_critical_stays_full(self):
        """Critical urgency always stays on the full path."""
        self.assertFalse(fast_path_eligible(self._gate(urgency="critical"), 0.7, "free"))

    def test_needs_escalation_stays_full(self):
        """A needs_escalation flag forces the full path."""
        self.assertFalse(fast_path_eligible(self._gate(needs_escalation=True), 0.7, "free"))

    def test_error_result_stays_full(self):
        """An ok false gate result stays on the full path."""
        self.assertFalse(fast_path_eligible({"ok": False, "error": "timeout"}, 0.7, "pro"))

    def test_enterprise_high_stays_full(self):
        """Enterprise plus high urgency stays full. The same gate is fast for pro."""
        gate = self._gate(urgency="high", team="support-engineering")
        self.assertFalse(fast_path_eligible(gate, 0.7, "enterprise"))
        self.assertTrue(fast_path_eligible(gate, 0.7, "pro"))


if __name__ == "__main__":
    unittest.main()
