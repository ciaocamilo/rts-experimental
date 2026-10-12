// Tipos del contrato Worker v2 (ampliado en P3 con piedra, torre y `defending`). La fuente normativa es contracts/worker-v2/worker-v2.schema.json.

export const PROTOCOL_VERSION = 2;
export const PYODIDE_VERSION = "0.27.7";
export const PYTHON_VERSION_PREFIX = "3.12";
export const POLICY_VERSION = "policy-0.4";

export const MAX_OBSERVATION_BYTES = 1024 * 1024;
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const MAX_COMMANDS = 4;

export type ErrorCode =
  | "INVALID_MESSAGE"
  | "INCOMPATIBLE_VERSION"
  | "PAYLOAD_TOO_LARGE"
  | "STALE_RESPONSE"
  | "POLICY_ERROR"
  | "LOAD_ERROR"
  | "TIMEOUT";

export type PlayerIdWire = 0 | 1;

export interface Versions {
  pyodide: string;
  python: string;
  policy: string;
}

export interface InitMessage {
  type: "INIT";
  protocol_version: 2;
  session_id: string;
  worker_generation: number;
  expected: Versions;
  config: { max_commands: number };
}

export interface ReadyMessage {
  type: "READY";
  protocol_version: 2;
  session_id: string;
  worker_generation: number;
  versions: Versions;
  timings_ms: { pyodide_load: number; policy_load: number; total: number };
}

export interface UnitView {
  id: number;
  owner: PlayerIdWire;
  kind: "villager" | "soldier" | "archer";
  x: number;
  z: number;
  hp: number;
  task: "idle" | "moving" | "blocked";
  activity: "idle" | "moving" | "blocked" | "gathering" | "delivering" | "building" | "attacking";
  dest: { x: number; z: number } | null;
  blocked_reason: "UNREACHABLE" | "STUCK" | null;
  carry: { kind: "food" | "wood" | "stone"; amount: number } | null;
  target_id: number | null;
  /** true si el objetivo es un contraataque automático temporal (no una orden manual ni de la IA). */
  defending: boolean;
}

export interface QueueItemView {
  id: number;
  kind: "villager" | "soldier" | "archer";
  remaining: number;
}

export interface BuildingView {
  id: number;
  owner: PlayerIdWire;
  kind: "townCenter" | "house" | "barracks" | "tower";
  cell_x: number;
  cell_z: number;
  hp: number;
  complete: boolean;
  build_done: number;
  queue: QueueItemView[];
}

export interface CostView {
  food: number;
  wood: number;
  stone: number;
}

export interface RulesView {
  max_population: number;
  queue_limit: number;
  house_housing: number;
  unit_cost: Record<"villager" | "soldier" | "archer", CostView>;
  building_cost: Record<"house" | "barracks" | "tower", CostView>;
  footprint: Record<"townCenter" | "house" | "barracks" | "tower", number>;
}

export interface ResourceNodeView {
  id: number;
  kind: "food" | "wood" | "stone";
  cell_x: number;
  cell_z: number;
  remaining: number;
}

export interface OrderResult {
  command_id: string;
  accepted: boolean;
  code: string | null;
}

export interface ObserveMessage {
  type: "OBSERVE";
  protocol_version: 2;
  session_id: string;
  worker_generation: number;
  request_id: number;
  observation_tick: number;
  player_id: PlayerIdWire;
  seed: number;
  game_version: string;
  map_version: string;
  balance_version: string;
  players: { id: PlayerIdWire; food: number; wood: number; stone: number; pop: number; pop_capacity: number }[];
  units: UnitView[];
  buildings: BuildingView[];
  resource_nodes: ResourceNodeView[];
  map: { width: number; depth: number; terrain: { x: number; z: number; w: number; h: number }[] };
  rules: RulesView;
  previous_results: OrderResult[];
}

interface CommandBase {
  command_id: string;
  entity_ids: number[];
}

export type WireCommand =
  | (CommandBase & { type: "Move"; payload: { x: number; z: number } })
  | (CommandBase & { type: "Stop"; payload: Record<string, never> })
  | (CommandBase & { type: "Gather" | "Attack" | "ResumeBuild"; payload: { target_id: number } })
  | (CommandBase & { type: "Build"; payload: { building_kind: "townCenter" | "house" | "barracks" | "tower"; cell_x: number; cell_z: number } })
  | (CommandBase & { type: "Train"; payload: { unit_kind: "villager" | "soldier" | "archer" } })
  | (CommandBase & { type: "CancelBuild"; payload: Record<string, never> })
  | (CommandBase & { type: "CancelTraining"; payload: { queue_item_id: number } });

export interface DecisionMessage {
  type: "DECISION";
  protocol_version: 2;
  session_id: string;
  worker_generation: number;
  request_id: number;
  observation_tick: number;
  player_id: PlayerIdWire;
  policy_version: string;
  commands: WireCommand[];
  reason_codes: string[];
  metrics: { policy_ms: number; convert_ms: number };
}

export interface ErrorMessage {
  type: "ERROR";
  protocol_version: 2;
  session_id?: string;
  worker_generation?: number;
  request_id?: number;
  code: ErrorCode;
  message: string;
}

export type WorkerMessage = InitMessage | ReadyMessage | ObserveMessage | DecisionMessage | ErrorMessage;

/** Error del proveedor; `fatal` implica worker terminado y simulación pausada (§8.2, punto 5). */
export class AIError extends Error {
  constructor(
    readonly code: ErrorCode | "ABORTED",
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = "AIError";
  }
}
