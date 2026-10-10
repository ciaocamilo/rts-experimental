import { describe, expect, it } from "vitest";
import fixtureFile from "../../contracts/worker-v2/fixtures.json";
import { MAX_OBSERVATION_BYTES, MAX_RESPONSE_BYTES } from "../../src/ai-client/protocol";
import { checkDecisionSemantics, jsonByteLength, validateMessage } from "../../src/ai-client/validate";
import type { DecisionMessage } from "../../src/ai-client/protocol";

interface Case {
  name: string;
  valid: boolean;
  code?: string;
  message: unknown;
}

const SENTINELS: Record<string, number> = { __NaN__: Number.NaN, __Infinity__: Number.POSITIVE_INFINITY };

function revive(value: unknown): unknown {
  if (typeof value === "string" && value in SENTINELS) return SENTINELS[value];
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

const cases = fixtureFile.cases as Case[];
const byName = (name: string): Record<string, unknown> => {
  const found = cases.find((c) => c.name === name);
  if (!found) throw new Error(`Fixture ${name} no existe`);
  return revive(found.message) as Record<string, unknown>;
};

describe("T-13 contrato Worker v1 (TypeScript)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("fixture compartido: %s", (_name, fixture) => {
    const result = validateMessage(revive(fixture.message));
    if (fixture.valid) {
      expect(result).toMatchObject({ ok: true });
    } else {
      expect(result).toMatchObject({ ok: false, code: fixture.code });
    }
  });

  it("rechaza una observación de más de 1 MiB con PAYLOAD_TOO_LARGE", () => {
    const observe = byName("observe completo");
    expect(jsonByteLength(observe)).toBeLessThan(MAX_OBSERVATION_BYTES);
    const result = validateMessage({ ...observe, padding: "x".repeat(MAX_OBSERVATION_BYTES) });
    expect(result).toMatchObject({ ok: false, code: "PAYLOAD_TOO_LARGE" });
  });

  it("rechaza una respuesta de más de 64 KiB con PAYLOAD_TOO_LARGE", () => {
    const decision = byName("decision con un Move");
    decision.reason_codes = ["PAD"];
    const result = validateMessage({ ...decision, padding: "x".repeat(MAX_RESPONSE_BYTES) });
    expect(result).toMatchObject({ ok: false, code: "PAYLOAD_TOO_LARGE" });
  });

  it("acepta los límites exactos: 4 comandos y 100 entidades por comando", () => {
    const decision = byName("decision con un Move");
    decision.commands = Array.from({ length: 4 }, (_, i) => ({
      command_id: `7:${i}`,
      type: "Stop",
      entity_ids: Array.from({ length: 100 }, (_, j) => j + 1),
      payload: {},
    }));
    expect(validateMessage(decision)).toMatchObject({ ok: true });
  });

  it("exige command_id derivado de request_id e índice", () => {
    const decision = byName("decision con un Move") as unknown as DecisionMessage;
    expect(checkDecisionSemantics(decision)).toBeNull();
    decision.commands[0]!.command_id = "9:0";
    expect(checkDecisionSemantics(decision)).not.toBeNull();
  });
});
