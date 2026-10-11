import { resolveMatch, updateCombat } from "./combat";
import { refreshCapacity, removeDead, snapshotMainBuildings, updateJobs, updateProduction } from "./economy";
import { invalidateBlockedPaths, issueMove, issueStop, moveUnits, processPathQueue } from "./movement";
import { currentGrid, getGrid } from "./obstacles";
import { issueAttack, issueBuild, issueCancelBuild, issueCancelTraining, issueGather, issueResumeBuild, issueTrain, type OrderOutcome } from "./orders";
import type { NavGrid } from "../navigation/grid";
import type { Command, CommandResult, GameState, RejectCode, StepResult } from "./types";

function reject(command: Command, code: RejectCode): CommandResult {
  return { commandId: command.id, accepted: false, code };
}

function route(state: GameState, grid: NavGrid, command: Command): OrderOutcome {
  switch (command.type) {
    case "Move":
      return issueMove(state, grid, command);
    case "Gather":
      return issueGather(state, grid, command);
    case "Build":
      return issueBuild(state, grid, command);
    case "ResumeBuild":
      return issueResumeBuild(state, grid, command);
    case "CancelBuild":
      return issueCancelBuild(state, command);
    case "Train":
      return issueTrain(state, command);
    case "CancelTraining":
      return issueCancelTraining(state, command);
    case "Attack":
      return issueAttack(state, grid, command);
    case "Stop":
      issueStop(state, command);
      return {};
    default:
      return { code: "NOT_IMPLEMENTED" };
  }
}

function admit(state: GameState, grid: NavGrid, command: Command): CommandResult {
  if (command.seq <= state.lastCommandSeq) return reject(command, "DUPLICATE_SEQUENCE");

  for (const id of command.entityIds) {
    const entity = state.units.find((u) => u.id === id) ?? state.buildings.find((b) => b.id === id);
    if (!entity) return reject(command, "UNKNOWN_ENTITY");
    if (entity.owner !== command.player) return reject(command, "NOT_OWNER");
  }

  const outcome = route(state, grid, command);
  if ("code" in outcome) return reject(command, outcome.code);
  return { commandId: command.id, accepted: true, ...outcome };
}

/** Avanza un tick (50 ms de juego). Muta `state` y es independiente de DOM y renderizado. */
export function stepSimulation(state: GameState, commands: readonly Command[] = []): StepResult {
  if (state.matchStatus === "ended") {
    return {
      tick: state.tick,
      results: commands.map((c) => reject(c, "MATCH_ENDED")),
      strikes: [],
      destroyed: [],
    };
  }

  const first = getGrid(state);
  if (first.changed) invalidateBlockedPaths(state, first.grid);

  const results: CommandResult[] = [];
  for (const command of [...commands].sort((a, b) => a.seq - b.seq)) {
    // Una obra aceptada bloquea su huella al instante: las órdenes siguientes ya la ven.
    const result = admit(state, currentGrid(state), command);
    if (result.accepted) state.lastCommandSeq = command.seq;
    results.push(result);
  }

  const { grid, changed } = getGrid(state);
  if (changed) invalidateBlockedPaths(state, grid);

  processPathQueue(state, grid);
  moveUnits(state, grid);
  updateJobs(state, grid);
  updateProduction(state, grid);
  const strikes = updateCombat(state, grid);
  // La instantánea de los edificios principales se toma antes de retirar entidades, con la vida que causa el fin de partida.
  const mainBuildings = snapshotMainBuildings(state);
  const { lostCenters, destroyed } = removeDead(state);
  refreshCapacity(state);

  state.tick += 1;
  resolveMatch(state, lostCenters, mainBuildings);
  return { tick: state.tick, results, strikes, destroyed };
}
