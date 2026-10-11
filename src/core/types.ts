import type { BuildingKind, ResourceKind, UnitKind } from "../content/balance";

export type PlayerId = 0 | 1;
export type EntityId = number;

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerState {
  id: PlayerId;
  food: number;
  wood: number;
  popCapacity: number;
}

export type UnitTask = "idle" | "moving" | "blocked";
export type BlockReason = "UNREACHABLE" | "STUCK";

export interface Carry {
  kind: ResourceKind;
  amount: number;
}

/** Motivo por el que una unidad militar quedó inactiva tras perder su objetivo. */
export type IdleReason = "TARGET_DEAD" | "UNREACHABLE";

/** Trabajo de una unidad; la ruta hacia su destino usa los campos de movimiento de la unidad. */
export type Job =
  | { type: "gather"; nodeId: EntityId; stage: "approach" | "harvest" | "return"; timer: number; retries: number }
  | { type: "build"; siteId: EntityId; stage: "approach" | "work"; retries: number }
  /** `anchor` es el punto de adquisición de un ataque automático; null si la orden fue explícita. */
  | { type: "attack"; targetId: EntityId; anchor: Vec2 | null; retries: number };

export interface Unit {
  id: EntityId;
  owner: PlayerId;
  kind: UnitKind;
  pos: Vec2;
  hp: number;
  task: UnitTask;
  /** Centro de la celda de destino mientras se mueve. */
  dest: Vec2 | null;
  /** Puntos de paso restantes, en coordenadas de celda continuas. */
  path: Vec2[];
  needsPath: boolean;
  stuckTicks: number;
  repaths: number;
  blockedReason: BlockReason | null;
  carry: Carry | null;
  job: Job | null;
  /** Ticks hasta poder atacar de nuevo. */
  cooldown: number;
  idleReason: IdleReason | null;
}

export interface TerrainRect {
  x: number;
  z: number;
  w: number;
  h: number;
  /** Solo cosmético: el agua bloquea igual que la roca. Ausente = roca. */
  kind?: "water";
}

export interface QueueItem {
  /** ID estable del elemento, usado por CancelTraining. */
  id: EntityId;
  kind: UnitKind;
  /** Ticks de producción pendientes; 0 significa lista para salir. */
  remaining: number;
}

/** Un edificio con `complete: false` es una obra: ocupa su huella y avanza solo con un constructor. */
export interface Building {
  id: EntityId;
  owner: PlayerId;
  kind: BuildingKind;
  /** Esquina mínima de la huella, en celdas. */
  cell: Vec2;
  hp: number;
  complete: boolean;
  /** Ticks de trabajo acumulados en la obra. */
  buildDone: number;
  /** Cola FIFO; solo el primer elemento avanza. */
  queue: QueueItem[];
}

export interface ResourceNode {
  id: EntityId;
  kind: ResourceKind;
  cell: Vec2;
  remaining: number;
}

export type MatchStatus = "playing" | "ended";

/** `winner: null` es empate. */
export interface MatchOutcome {
  winner: PlayerId | null;
  reason: "TOWN_CENTER_DESTROYED" | "TIME_LIMIT";
}

export interface GameState {
  schemaVersion: number;
  seed: number;
  tick: number;
  matchStatus: MatchStatus;
  /** Se fija una sola vez, junto con `matchStatus: "ended"`. */
  outcome: MatchOutcome | null;
  mapWidth: number;
  mapDepth: number;
  terrain: TerrainRect[];
  /** Debe incrementarse al cambiar cualquier obstáculo estático (terreno, edificios, nodos). */
  obstacleVersion: number;
  /** Cola FIFO de unidades que esperan una búsqueda de ruta. */
  pathQueue: EntityId[];
  players: [PlayerState, PlayerState];
  units: Unit[];
  buildings: Building[];
  resourceNodes: ResourceNode[];
  nextEntityId: EntityId;
  lastCommandSeq: number;
}

export type CommandType =
  | "Move"
  | "Stop"
  | "Gather"
  | "Build"
  | "ResumeBuild"
  | "CancelBuild"
  | "Train"
  | "CancelTraining"
  | "Attack";

export interface Command {
  id: string;
  /** Tick solicitado; el tick efectivo de aplicación lo registra el bucle. */
  tick: number;
  seq: number;
  player: PlayerId;
  type: CommandType;
  entityIds: EntityId[];
  /** Punto, entidad o, en Build, la esquina mínima de la huella en celdas. */
  target?: { x: number; z: number } | { entityId: EntityId };
  /** Tipo de edificio (Build) o de unidad (Train). */
  kind?: BuildingKind | UnitKind;
}

export type RejectCode =
  | "DUPLICATE_SEQUENCE"
  | "NOT_OWNER"
  | "UNKNOWN_ENTITY"
  | "MATCH_ENDED"
  | "INVALID_TARGET"
  | "INCOMPATIBLE_ENTITY"
  | "UNREACHABLE"
  | "INSUFFICIENT_RESOURCES"
  | "POPULATION_LIMIT"
  | "QUEUE_FULL"
  | "INVALID_PLACEMENT"
  | "BLOCKS_PATH"
  | "SITE_BUSY"
  | "NOT_COMPLETE"
  | "NOT_IMPLEMENTED";

export type CommandResult =
  | { commandId: string; accepted: true; assigned?: number; total?: number }
  | { commandId: string; accepted: false; code: RejectCode };

export interface StepResult {
  tick: number;
  results: CommandResult[];
  /** Ataques válidos de este tick; solo los consume el renderizador y no forman parte del estado. */
  strikes: StrikeEvent[];
}

/** Un ataque efectivo, con las posiciones capturadas en el momento del daño. */
export interface StrikeEvent {
  tick: number;
  attackerId: EntityId;
  attackerOwner: PlayerId;
  attackerKind: UnitKind;
  targetId: EntityId;
  from: Vec2;
  to: Vec2;
}
