"""Punto de entrada que invoca el puente JavaScript del worker.

handle_observe recibe el texto JSON de una OBSERVE y devuelve texto JSON simple. Al intercambiar
cadenas no se crean PyProxy temporales ni se conservan referencias al snapshot.
"""

import json
import sys

from . import contract, policy


def runtime_info():
    version = sys.version_info
    return json.dumps(
        {"python": "%d.%d.%d" % (version.major, version.minor, version.micro), "policy": policy.VERSION},
        separators=(",", ":"),
    )


def _failure(code, message):
    return json.dumps({"ok": False, "code": code, "message": message[:200]}, separators=(",", ":"))


def handle_observe(text):
    if contract.utf8_size(text) > contract.MAX_OBSERVATION_BYTES:
        return _failure(contract.PAYLOAD_TOO_LARGE, "la observación supera 1 MiB")
    try:
        message = json.loads(text)
    except ValueError:
        return _failure(contract.INVALID_MESSAGE, "JSON no válido")

    if not isinstance(message, dict) or message.get("type") != "OBSERVE":
        return _failure(contract.INVALID_MESSAGE, "se esperaba OBSERVE")
    code, detail = contract.validate_message(message)
    if code is not None:
        return _failure(code, detail)

    try:
        commands, reasons = policy.decide(message)
    except Exception as error:  # noqa: BLE001 - cualquier fallo de la política se informa como POLICY_ERROR
        return _failure("POLICY_ERROR", "%s en la política" % type(error).__name__)

    request_id = message["request_id"]
    numbered = [
        {"command_id": "%d:%d" % (request_id, index), **command}
        for index, command in enumerate(commands[: contract.MAX_COMMANDS])
    ]
    decision = {
        "type": "DECISION",
        "protocol_version": contract.PROTOCOL_VERSION,
        "session_id": message["session_id"],
        "worker_generation": message["worker_generation"],
        "request_id": request_id,
        "observation_tick": message["observation_tick"],
        "player_id": message["player_id"],
        "policy_version": policy.VERSION,
        "commands": numbered,
        "reason_codes": reasons,
    }
    return json.dumps({"ok": True, "decision": decision}, separators=(",", ":"))
