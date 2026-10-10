import Ajv2020 from "ajv/dist/2020";
import schema from "../../contracts/worker-v2/worker-v2.schema.json";
import {
  MAX_OBSERVATION_BYTES,
  MAX_RESPONSE_BYTES,
  PROTOCOL_VERSION,
  type DecisionMessage,
  type ErrorCode,
  type WorkerMessage,
} from "./protocol";

const DEFINITIONS: Record<WorkerMessage["type"], string> = {
  INIT: "InitMessage",
  READY: "ReadyMessage",
  OBSERVE: "ObserveMessage",
  DECISION: "DecisionMessage",
  ERROR: "ErrorMessage",
};

export type ValidationResult =
  | { ok: true; message: WorkerMessage }
  | { ok: false; code: Extract<ErrorCode, "INVALID_MESSAGE" | "INCOMPATIBLE_VERSION" | "PAYLOAD_TOO_LARGE">; detail: string };

const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: false });
ajv.addSchema(schema);
const validators = new Map(
  (Object.entries(DEFINITIONS) as [WorkerMessage["type"], string][]).map(([type, name]) => {
    const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
    if (!validate) throw new Error(`Esquema sin definición ${name}`);
    return [type, validate] as const;
  }),
);

const encoder = new TextEncoder();

/** Tamaño de la representación JSON en UTF-8, que es la medida de los límites del contrato. */
export function jsonByteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valida un mensaje en ejecución: objeto, tipo, tamaño, versión de protocolo y esquema. */
export function validateMessage(raw: unknown): ValidationResult {
  if (!isRecord(raw)) return { ok: false, code: "INVALID_MESSAGE", detail: "el mensaje no es un objeto" };
  const type = raw.type;
  const validate = typeof type === "string" ? validators.get(type as WorkerMessage["type"]) : undefined;
  if (!validate) return { ok: false, code: "INVALID_MESSAGE", detail: "tipo de mensaje desconocido" };

  const limit = type === "OBSERVE" ? MAX_OBSERVATION_BYTES : MAX_RESPONSE_BYTES;
  if (jsonByteLength(raw) > limit) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE", detail: `el mensaje ${String(type)} supera ${limit} bytes` };
  }

  const version = raw.protocol_version;
  if (typeof version === "number" && Number.isInteger(version) && version !== PROTOCOL_VERSION) {
    return { ok: false, code: "INCOMPATIBLE_VERSION", detail: `protocolo ${version} no soportado` };
  }

  if (!validate(raw)) {
    const first = validate.errors?.[0];
    return { ok: false, code: "INVALID_MESSAGE", detail: first ? `${first.instancePath} ${first.message ?? ""}`.trim() : "esquema" };
  }
  return { ok: true, message: raw as unknown as WorkerMessage };
}

/** Reglas que JSON Schema no expresa: command_id derivado de request_id e índice. */
export function checkDecisionSemantics(decision: DecisionMessage): string | null {
  for (const [index, command] of decision.commands.entries()) {
    if (command.command_id !== `${decision.request_id}:${index}`) return `command_id ${command.command_id} no coincide`;
  }
  return null;
}
