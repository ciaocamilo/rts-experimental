import { describe, expect, it } from "vitest";
import { GameSession } from "../../src/app/session";
import { CueTranslator, computeFire, type CueRequest } from "../../src/audio/cues";
import { createFixture, type FinalOption } from "../../src/core/fixtures";

const project = (): { x: number; y: number } => ({ x: 0, y: 0 });

function play(final: FinalOption | undefined, ticks: number): { cues: CueRequest[]; session: GameSession; fire: number } {
  const session = new GameSession(1, createFixture("sonidos", { final }));
  const translator = new CueTranslator();
  const cues: CueRequest[] = [];
  let fire = 0;
  for (let i = 0; i < ticks; i++) {
    session.stepOnce();
    cues.push(
      ...translator.process({
        state: session.state,
        strikes: session.strikeLog,
        deaths: session.deathLog,
        spawns: session.spawnLog,
        works: session.workLog,
        destroyed: session.destroyedLog,
        project,
      }),
    );
    fire = Math.max(fire, computeFire(session.state, project).length);
  }
  return { cues, session, fire };
}

describe("fixture sonidos", () => {
  it("dispara todos los efectos y acepta todas sus órdenes", () => {
    const { cues, session, fire } = play(undefined, 20 * 40);
    const rejected = session.commandLog.filter((c) => !c.result.accepted).map((c) => `${c.command.type}:${"code" in c.result ? c.result.code : ""}`);
    expect(rejected).toEqual([]);
    const seen = new Set(cues.map((c) => c.cue));
    for (const cue of ["sword", "arrow", "arrowHit", "blow", "bell", "hammer", "axe", "pick", "forage", "death", "door", "collapse"] as const) {
      expect(seen.has(cue), cue).toBe(true);
    }
    expect(fire).toBeGreaterThan(0);
    expect(session.state.matchStatus).toBe("playing");
    // Solo el cuartel y el centro urbano propios hacen sonar la puerta.
    expect(cues.filter((c) => c.cue === "door").length).toBe(session.spawnLog.filter((s) => s.owner === 0).length);
  });

  it.each([
    ["victoria", 0],
    ["derrota", 1],
  ] as const)("final=%s termina la partida con el ganador esperado", (final, winner) => {
    const { cues, session } = play(final, 20 * 20);
    expect(session.state.matchStatus).toBe("ended");
    expect(session.state.outcome?.winner).toBe(winner);
    const end = cues.filter((c) => c.cue === "victory" || c.cue === "defeat");
    expect(end.map((c) => c.cue)).toEqual([winner === 0 ? "victory" : "defeat"]);
    expect(end[0]!.delay).toBe(1);
  });
});
