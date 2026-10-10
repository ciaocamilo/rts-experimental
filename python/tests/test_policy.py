import json
import unittest
from pathlib import Path

from policy import contract, entry, policy

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "contracts" / "worker-v2" / "fixtures.json"
SCHEMA = ROOT / "contracts" / "worker-v2" / "worker-v2.schema.json"

SENTINELS = {"__NaN__": float("nan"), "__Infinity__": float("inf")}


def revive(value):
    if isinstance(value, str) and value in SENTINELS:
        return SENTINELS[value]
    if isinstance(value, list):
        return [revive(item) for item in value]
    if isinstance(value, dict):
        return {key: revive(item) for key, item in value.items()}
    return value


def load_cases():
    with open(FIXTURES, encoding="utf-8") as handle:
        return json.load(handle)["cases"]


def observation(**overrides):
    case = next(c for c in load_cases() if c["name"] == "observe completo")
    message = revive(case["message"])
    message.update(overrides)
    return message


class ContractFixturesTest(unittest.TestCase):
    def test_fixtures_expected_results(self):
        for case in load_cases():
            with self.subTest(case=case["name"]):
                code, detail = contract.validate_message(revive(case["message"]))
                if case["valid"]:
                    self.assertIsNone(code, detail)
                else:
                    self.assertEqual(code, case["code"], detail)

    def test_fixtures_agree_with_jsonschema_oracle(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema no está instalado")
        with open(SCHEMA, encoding="utf-8") as handle:
            schema = json.load(handle)
        validator = jsonschema.Draft202012Validator(schema)
        for case in load_cases():
            # jsonschema acepta NaN/Infinity como números; el contrato los rechaza.
            if "__NaN__" in json.dumps(case["message"]) or "__Infinity__" in json.dumps(case["message"]):
                continue
            with self.subTest(case=case["name"]):
                self.assertEqual(validator.is_valid(case["message"]), case["valid"])

    def test_schema_covers_every_message_type(self):
        types = {c["message"].get("type") for c in load_cases() if isinstance(c["message"], dict)}
        for kind in ("INIT", "READY", "OBSERVE", "DECISION", "ERROR"):
            self.assertIn(kind, types)


class EntryTest(unittest.TestCase):
    def call(self, message):
        return json.loads(entry.handle_observe(json.dumps(message)))

    def test_valid_observation_returns_valid_decision(self):
        result = self.call(observation())
        self.assertTrue(result["ok"])
        decision = result["decision"]
        decision["metrics"] = {"policy_ms": 0.0, "convert_ms": 0.0}
        self.assertEqual(contract.validate_message(decision), (None, ""))
        self.assertEqual(decision["request_id"], 7)
        self.assertEqual(decision["commands"][0]["command_id"], "7:0")

    def test_same_observation_same_commands(self):
        self.assertEqual(entry.handle_observe(json.dumps(observation())), entry.handle_observe(json.dumps(observation())))

    def test_oversized_observation_rejected(self):
        padded = json.dumps(observation()) + " " * contract.MAX_OBSERVATION_BYTES
        self.assertEqual(json.loads(entry.handle_observe(padded))["code"], "PAYLOAD_TOO_LARGE")

    def test_incompatible_version_rejected(self):
        result = self.call(observation(protocol_version=1))
        self.assertEqual((result["ok"], result["code"]), (False, "INCOMPATIBLE_VERSION"))

    def test_extra_field_rejected(self):
        result = self.call(observation(extra=1))
        self.assertEqual((result["ok"], result["code"]), (False, "INVALID_MESSAGE"))

    def test_not_json_rejected(self):
        self.assertEqual(json.loads(entry.handle_observe("{no"))["code"], "INVALID_MESSAGE")

    def test_non_observe_rejected(self):
        message = revive(next(c for c in load_cases() if c["name"] == "init válido")["message"])
        self.assertEqual(self.call(message)["code"], "INVALID_MESSAGE")

    def test_policy_exception_becomes_policy_error(self):
        original = policy.decide
        policy.decide = lambda _observation: 1 / 0
        try:
            result = self.call(observation())
        finally:
            policy.decide = original
        self.assertEqual((result["ok"], result["code"]), (False, "POLICY_ERROR"))
        self.assertNotIn("Traceback", result["message"])

    def test_runtime_info(self):
        info = json.loads(entry.runtime_info())
        self.assertEqual(info["policy"], policy.VERSION)
        self.assertRegex(info["python"], r"^\d+\.\d+\.\d+$")


class PolicyTest(unittest.TestCase):
    def test_reassigns_the_blocked_villager_to_a_node(self):
        commands, reasons = policy.decide(observation())
        self.assertEqual(reasons[0], "GATHER")
        self.assertEqual(commands[0], {"type": "Gather", "entity_ids": [7], "payload": {"target_id": 8}})

    def test_no_base_gives_no_commands(self):
        message = observation()
        message["buildings"] = [b for b in message["buildings"] if b["owner"] != 1]
        self.assertEqual(policy.decide(message), ([], ["NO_BASE"]))

    def test_batch_is_capped_and_valid(self):
        message = observation()
        message["units"] = [
            {
                "id": 100 + i, "owner": 1, "kind": "villager", "x": 60, "z": 5, "hp": 40, "task": "idle",
                "activity": "idle", "dest": None, "blocked_reason": None, "carry": None, "target_id": None,
            }
            for i in range(250)
        ]
        result = json.loads(entry.handle_observe(json.dumps(message)))
        self.assertTrue(result["ok"])
        self.assertLessEqual(len(result["decision"]["commands"]), contract.MAX_COMMANDS)
        for command in result["decision"]["commands"]:
            self.assertLessEqual(len(command["entity_ids"]), 100)


if __name__ == "__main__":
    unittest.main()
