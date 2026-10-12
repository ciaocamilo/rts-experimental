import type { BuildingKind, ResourceKind, UnitKind } from "../content/balance";

export type PlayerId = 0 | 1;
export type Gender = "male" | "female";
export type EntityId = number;

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerState {
  id: PlayerId;
  food: number;
  wood: number;
  stone: number;
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
  | { type: "gather"; nodeId: EntityId; kind: ResourceKind; stage: "approach" | "harvest" | "return"; timer: number; retries: number }
  | { type: "build"; siteId: EntityId; stage: "approach" | "work"; retries: number }
  /**
   * `anchor` es el punto de adquisición de un ataque automático o defensivo; null si la orden fue explícita.
   * `defense` marca el objetivo temporal de contraataque (P3-R01), distinguible de una orden manual.
   * `resume` es el destino de un movimiento interrumpido por la defensa, que se reanuda al terminar.
   * `back` es el ataque a un edificio que la defensa interrumpió y que se retoma al terminar.
   */
  | {
      type: "attack";
      targetId: EntityId;
      anchor: Vec2 | null;
      retries: number;
      defense: boolean;
      resume: Vec2 | null;
      back: { targetId: EntityId; anchor: Vec2 | null } | null;
    };

/** Último agresor hostil que dañó a una unidad militar (se consume al reaccionar). */
export interface Threat {
  attackerId: EntityId;
  tick: number;
}

/** Objetivo que no pudo alcanzarse: no se vuelve a adquirir automáticamente hasta `until`. */
export interface AvoidedTarget {
  targetId: EntityId;
  until: number;
}

export interface Unit {
  id: EntityId;
  owner: PlayerId;
  kind: UnitKind;
  /** Solo cambia el aspecto y el nombre (Aldeana); las reglas son las mismas. Los militares son "male". */
  gender: Gender;
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
  threat: Threat | null;
  avoid: AvoidedTarget | null;
}

export interface TerrainRect {
  x: number;
  z: number;
  w: number;
  h: number;
  /** El agua bloquea igual que la roca; el puente se camina pero no admite obras. Ausente = roca. */
  kind?: "water" | "bridge" | "forest";
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
  /** Ticks hasta poder disparar de nuevo (solo edificios con arma). */
  cooldown: number;
}

export interface ResourceNode {
  id: EntityId;
  kind: ResourceKind;
  cell: Vec2;
  remaining: number;
}

export type MatchStatus = "playing" | "ended";

/** Instantánea del edificio principal de un bando, tomada en el tick terminal antes de retirar entidades. */
export interface MainBuildingFinal {
  id: EntityId;
  owner: PlayerId;
  kind: BuildingKind;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  complete: boolean;
  /** Trabajo de construcción acumulado entre 0 y 1; no es una razón de vida. */
  buildProgress: number;
}

/** Bajas acumuladas por bando (índice = propietario de lo perdido). */
export interface Losses {
  units: [number, number];
  buildings: [number, number];
}

/** `winner: null` es empate. */
export interface MatchOutcome {
  winner: PlayerId | null;
  reason: "TOWN_CENTER_DESTROYED" | "TIME_LIMIT";
  endTick: number;
  mainBuildings: MainBuildingFinal[];
  casualties: Losses;
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
  /** Bajas acumuladas de la partida. */
  losses: Losses;
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
  /** Edificios que dejaron el estado lógico en este tick; solo los consume la vista (colapso visual). */
  destroyed: BuildingDestroyedEvent[];
  /** Eventos de salida para el audio; no forman parte del estado ni del hash. */
  deaths: DeathEvent[];
  spawns: SpawnEvent[];
  works: WorkEvent[];
}

/** Unidad retirada por vida cero, en su posición final. */
export interface DeathEvent {
  tick: number;
  id: EntityId;
  owner: PlayerId;
  kind: UnitKind;
  gender: Gender;
  pos: Vec2;
}

/** Unidad entrenada que acaba de entrar al estado. */
export interface SpawnEvent {
  tick: number;
  buildingId: EntityId;
  unitId: EntityId;
  owner: PlayerId;
  kind: UnitKind;
  pos: Vec2;
}

export type WorkKind = "build" | "wood" | "stone" | "food";

/** Un golpe de trabajo efectivo: obra cada 10 ticks o un recurso recolectado. */
export interface WorkEvent {
  tick: number;
  unitId: EntityId;
  owner: PlayerId;
  kind: WorkKind;
  pos: Vec2;
}

/** Instantánea de un edificio retirado por vida cero. */
export interface BuildingDestroyedEvent {
  tick: number;
  id: EntityId;
  owner: PlayerId;
  kind: BuildingKind;
  cell: Vec2;
  complete: boolean;
}

/** Un ataque efectivo, con las posiciones capturadas en el momento del daño. */
export interface StrikeEvent {
  tick: number;
  attackerId: EntityId;
  attackerOwner: PlayerId;
  /** `"tower"` para disparos de torre: usan el mismo arma (flecha) que el arquero. */
  attackerKind: UnitKind | "tower";
  targetId: EntityId;
  targetOwner: PlayerId;
  from: Vec2;
  to: Vec2;
}
