"""Validación del contrato Worker v2 sin dependencias.

Interpreta el subconjunto de JSON Schema que usa contracts/worker-v2/worker-v2.schema.json
(type, const, enum, required, properties, additionalProperties=false, items, minItems, maxItems,
minimum, maximum, minLength, maxLength, pattern, oneOf y $ref local). Pyodide no puede descargar
paquetes durante la partida, por lo que no se usa la biblioteca jsonschema.
"""

import json
import math
import re
from pathlib import Path

PROTOCOL_VERSION = 2
MAX_OBSERVATION_BYTES = 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_COMMANDS = 4

INVALID_MESSAGE = "INVALID_MESSAGE"
INCOMPATIBLE_VERSION = "INCOMPATIBLE_VERSION"
PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"

_MESSAGE_DEFS = {
    "INIT": "InitMessage",
    "READY": "ReadyMessage",
    "OBSERVE": "ObserveMessage",
    "DECISION": "DecisionMessage",
    "ERROR": "ErrorMessage",
}

_SCHEMA_NAME = "worker-v2.schema.json"
_schema_cache = None
_pattern_cache = {}


def load_schema(path=None):
    global _schema_cache
    if path is None and _schema_cache is not None:
        return _schema_cache
    if path is None:
        here = Path(__file__).resolve().parent
        candidates = [here / _SCHEMA_NAME, here.parent.parent / "contracts" / "worker-v2" / "worker-v2.schema.json"]
        path = next((c for c in candidates if c.exists()), candidates[0])
    with open(path, encoding="utf-8") as handle:
        schema = json.load(handle)
    if _schema_cache is None:
        _schema_cache = schema
    return schema


def _is_bool(value):
    return isinstance(value, bool)


def _is_number(value):
    return isinstance(value, (int, float)) and not _is_bool(value) and math.isfinite(value)


def _is_integer(value):
    if _is_bool(value):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value) and value.is_integer()


def _type_ok(name, value):
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    if name == "string":
        return isinstance(value, str)
    if name == "boolean":
        return _is_bool(value)
    if name == "null":
        return value is None
    if name == "integer":
        return _is_integer(value)
    if name == "number":
        return _is_number(value)
    return False


def _same(left, right):
    """Igualdad JSON estricta: True no es 1 ni 1.0 es distinto de 1."""
    if _is_bool(left) or _is_bool(right):
        return _is_bool(left) and _is_bool(right) and left == right
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, str) or isinstance(right, str):
        return isinstance(left, str) and isinstance(right, str) and left == right
    if _is_number(left) and _is_number(right):
        return left == right
    return False


def _resolve(root, ref):
    if not ref.startswith("#/"):
        raise ValueError("referencia no soportada: " + ref)
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def _matches(root, schema, value):
    return _check(root, schema, value) is None


def _check(root, schema, value):
    """Devuelve None si valida o una descripción breve del primer fallo."""
    if "$ref" in schema:
        return _check(root, _resolve(root, schema["$ref"]), value)

    if "oneOf" in schema:
        matched = sum(1 for option in schema["oneOf"] if _matches(root, option, value))
        if matched != 1:
            return "oneOf: coinciden %d opciones" % matched

    if "const" in schema and not _same(schema["const"], value):
        return "const"
    if "enum" in schema and not any(_same(option, value) for option in schema["enum"]):
        return "enum"

    if "type" in schema:
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_type_ok(name, value) for name in names):
            return "type"

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            return "minLength"
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            return "maxLength"
        if "pattern" in schema:
            pattern = _pattern_cache.get(schema["pattern"])
            if pattern is None:
                pattern = _pattern_cache[schema["pattern"]] = re.compile(schema["pattern"])
            if pattern.search(value) is None:
                return "pattern"

    if _is_number(value):
        if "minimum" in schema and value < schema["minimum"]:
            return "minimum"
        if "maximum" in schema and value > schema["maximum"]:
            return "maximum"

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            return "minItems"
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            return "maxItems"
        if "items" in schema:
            for index, item in enumerate(value):
                problem = _check(root, schema["items"], item)
                if problem is not None:
                    return "[%d] %s" % (index, problem)

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                return "falta " + name
        if schema.get("additionalProperties") is False:
            for name in value:
                if name not in properties:
                    return "campo adicional " + name
        for name, sub in properties.items():
            if name in value:
                problem = _check(root, sub, value[name])
                if problem is not None:
                    return "%s: %s" % (name, problem)

    return None


def validate_message(message, schema=None):
    """Devuelve (None, "") si el mensaje es válido o (código, detalle)."""
    if not isinstance(message, dict):
        return INVALID_MESSAGE, "el mensaje no es un objeto"
    kind = message.get("type")
    definition = _MESSAGE_DEFS.get(kind) if isinstance(kind, str) else None
    if definition is None:
        return INVALID_MESSAGE, "tipo de mensaje desconocido"
    version = message.get("protocol_version")
    if _is_integer(version) and version != PROTOCOL_VERSION:
        return INCOMPATIBLE_VERSION, "protocolo %s no soportado" % version
    root = schema if schema is not None else load_schema()
    problem = _check(root, {"$ref": "#/$defs/" + definition}, message)
    if problem is not None:
        return INVALID_MESSAGE, problem
    return None, ""


def utf8_size(text):
    return len(text.encode("utf-8"))
