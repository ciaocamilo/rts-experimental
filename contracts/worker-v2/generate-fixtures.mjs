// Genera fixtures.json (casos válidos e inválidos compartidos por TypeScript, CPython y Pyodide).
// Uso: node contracts/worker-v2/generate-fixtures.mjs
// "__NaN__" e "__Infinity__" son centinelas: JSON no puede representarlos y cada lector los sustituye.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION = "3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c";
const clone = (value) => JSON.parse(JSON.stringify(value));

const base = {
  init: {
    type: "INIT",
    protocol_version: 2,
    session_id: SESSION,
    worker_generation: 1,
    expected: { pyodide: "0.27.7", python: "3.12", policy: "policy-0.3" },
    config: { max_commands: 4 },
  },
  ready: {
    type: "READY",
    protocol_version: 2,
    session_id: SESSION,
    worker_generation: 1,
    versions: { pyodide: "0.27.7", python: "3.12.7", policy: "policy-0.3" },
    timings_ms: { pyodide_load: 1400.5, policy_load: 12.25, total: 1420 },
  },
  observe: {
    type: "OBSERVE",
    protocol_version: 2,
    session_id: SESSION,
    worker_generation: 1,
    request_id: 7,
    observation_tick: 140,
    player_id: 1,
    seed: 1,
    game_version: "p3.0.0",
    map_version: "map-0.3 (128x64, piedra)",
    balance_version: "balance-0.2",
    players: [
      { id: 0, food: 200, wood: 200, stone: 0, pop: 3, pop_capacity: 10 },
      { id: 1, food: 200, wood: 200, stone: 0, pop: 3, pop_capacity: 10 },
    ],
    units: [
      { id: 2, owner: 0, kind: "villager", x: 13.5, z: 31, hp: 40, task: "idle", activity: "idle", dest: null, blocked_reason: null, carry: null, target_id: null, defending: false },
      { id: 5, owner: 1, kind: "villager", x: 50.5, z: 31, hp: 40, task: "idle", activity: "gathering", dest: null, blocked_reason: null, carry: { kind: "food", amount: 4 }, target_id: 8, defending: false },
      { id: 6, owner: 1, kind: "villager", x: 49, z: 32.5, hp: 40, task: "moving", activity: "moving", dest: { x: 48.5, z: 32.5 }, blocked_reason: null, carry: null, target_id: null, defending: false },
      { id: 7, owner: 1, kind: "villager", x: 50.5, z: 33, hp: 40, task: "blocked", activity: "blocked", dest: { x: 48.5, z: 32.5 }, blocked_reason: "STUCK", carry: null, target_id: null, defending: false },
    ],
    buildings: [
      { id: 1, owner: 0, kind: "townCenter", cell_x: 8, cell_z: 30, hp: 1500, complete: true, build_done: 0, queue: [] },
      { id: 4, owner: 1, kind: "townCenter", cell_x: 116, cell_z: 30, hp: 1500, complete: true, build_done: 0, queue: [{ id: 9, kind: "villager", remaining: 120 }] },
    ],
    resource_nodes: [
      { id: 8, kind: "food", cell_x: 15, cell_z: 22, remaining: 500 },
      { id: 10, kind: "stone", cell_x: 15, cell_z: 46, remaining: 500 },
    ],
    map: { width: 128, depth: 64, terrain: [{ x: 62, z: 8, w: 4, h: 18 }, { x: 62, z: 38, w: 4, h: 18 }] },
    rules: {
      max_population: 50,
      queue_limit: 5,
      house_housing: 5,
      unit_cost: {
        villager: { food: 50, wood: 0, stone: 0 },
        soldier: { food: 60, wood: 20, stone: 0 },
        archer: { food: 40, wood: 50, stone: 0 },
      },
      building_cost: {
        house: { food: 0, wood: 50, stone: 0 },
        barracks: { food: 0, wood: 150, stone: 0 },
        tower: { food: 0, wood: 0, stone: 300 },
      },
      footprint: { townCenter: 4, house: 2, barracks: 3, tower: 2 },
    },
    previous_results: [
      { command_id: "6:0", accepted: true, code: null },
      { command_id: "6:1", accepted: false, code: "NOT_IMPLEMENTED" },
    ],
  },
  decision: {
    type: "DECISION",
    protocol_version: 2,
    session_id: SESSION,
    worker_generation: 1,
    request_id: 7,
    observation_tick: 140,
    player_id: 1,
    policy_version: "policy-0.3",
    commands: [{ command_id: "7:0", type: "Move", entity_ids: [5, 6], payload: { x: 48.5, z: 32.5 } }],
    reason_codes: ["GATHER"],
    metrics: { policy_ms: 1.5, convert_ms: 0.25 },
  },
  error: {
    type: "ERROR",
    protocol_version: 2,
    session_id: SESSION,
    worker_generation: 1,
    request_id: 7,
    code: "POLICY_ERROR",
    message: "excepción en la política",
  },
};

const cases = [];
const add = (name, valid, message, code) => cases.push(valid ? { name, valid, message } : { name, valid, code, message });
const mutate = (kind, fn) => {
  const copy = clone(base[kind]);
  fn(copy);
  return copy;
};
const withCommands = (commands) => mutate("decision", (d) => (d.commands = commands));

// Válidos
add("init válido", true, base.init);
add("ready válido", true, base.ready);
add("observe completo", true, base.observe);
add("observe sin entidades", true, mutate("observe", (o) => {
  o.units = [];
  o.buildings = [];
  o.resource_nodes = [];
  o.map.terrain = [];
  o.previous_results = [];
}));
add("decision con un Move", true, base.decision);
add("decision vacía", true, mutate("decision", (d) => {
  d.commands = [];
  d.reason_codes = [];
}));
add("decision con cuatro comandos (Move, Stop, Gather, Attack)", true, withCommands([
  { command_id: "7:0", type: "Move", entity_ids: [5], payload: { x: 1, z: 2 } },
  { command_id: "7:1", type: "Stop", entity_ids: [6], payload: {} },
  { command_id: "7:2", type: "Gather", entity_ids: [5], payload: { target_id: 8 } },
  { command_id: "7:3", type: "Attack", entity_ids: [6], payload: { target_id: 1 } },
]));
add("decision con ResumeBuild, Build, Train y CancelBuild", true, withCommands([
  { command_id: "7:0", type: "ResumeBuild", entity_ids: [5], payload: { target_id: 9 } },
  { command_id: "7:1", type: "Build", entity_ids: [5], payload: { building_kind: "house", cell_x: 50, cell_z: 20 } },
  { command_id: "7:2", type: "Train", entity_ids: [4], payload: { unit_kind: "villager" } },
  { command_id: "7:3", type: "CancelBuild", entity_ids: [9], payload: {} },
]));
add("decision con CancelTraining", true, withCommands([
  { command_id: "7:0", type: "CancelTraining", entity_ids: [4], payload: { queue_item_id: 3 } },
]));
add("decision con Gather de piedra y Build de torre", true, withCommands([
  { command_id: "7:0", type: "Gather", entity_ids: [5], payload: { target_id: 10 } },
  { command_id: "7:1", type: "Build", entity_ids: [5], payload: { building_kind: "tower", cell_x: 40, cell_z: 20 } },
]));
add("observe con unidad defendiéndose y carga de piedra", true, mutate("observe", (o) => {
  o.units[1].carry = { kind: "stone", amount: 8 };
  o.units[2].defending = true;
}));
add("error mínimo", true, { type: "ERROR", protocol_version: 2, code: "LOAD_ERROR", message: "" });
add("error con identificadores", true, base.error);

// Versión incompatible
add("observe con protocolo 1", false, mutate("observe", (o) => (o.protocol_version = 1)), "INCOMPATIBLE_VERSION");
add("decision con protocolo 1", false, mutate("decision", (d) => (d.protocol_version = 1)), "INCOMPATIBLE_VERSION");
add("init con protocolo 0", false, mutate("init", (m) => (m.protocol_version = 0)), "INCOMPATIBLE_VERSION");

// Estructura
add("mensaje null", false, null, "INVALID_MESSAGE");
add("mensaje arreglo", false, [], "INVALID_MESSAGE");
add("tipo desconocido", false, { type: "PING", protocol_version: 2 }, "INVALID_MESSAGE");
add("sin tipo", false, mutate("observe", (o) => delete o.type), "INVALID_MESSAGE");
add("observe con campo extra", false, mutate("observe", (o) => (o.extra = 1)), "INVALID_MESSAGE");
add("observe con campo extra en unidad", false, mutate("observe", (o) => (o.units[0].carga = 5)), "INVALID_MESSAGE");
add("observe sin map", false, mutate("observe", (o) => delete o.map), "INVALID_MESSAGE");
add("observe con player_id 2", false, mutate("observe", (o) => (o.player_id = 2)), "INVALID_MESSAGE");
add("observe con session_id mal formado", false, mutate("observe", (o) => (o.session_id = "no-es-uuid")), "INVALID_MESSAGE");
add("observe con generación 0", false, mutate("observe", (o) => (o.worker_generation = 0)), "INVALID_MESSAGE");
add("observe con hp negativo", false, mutate("observe", (o) => (o.units[0].hp = -1)), "INVALID_MESSAGE");
add("observe con NaN en posición", false, mutate("observe", (o) => (o.units[0].x = "__NaN__")), "INVALID_MESSAGE");
add("observe con Infinity en posición", false, mutate("observe", (o) => (o.units[0].z = "__Infinity__")), "INVALID_MESSAGE");
add("observe con tarea desconocida", false, mutate("observe", (o) => (o.units[0].task = "flying")), "INVALID_MESSAGE");
add("observe sin rules", false, mutate("observe", (o) => delete o.rules), "INVALID_MESSAGE");
add("observe con actividad desconocida", false, mutate("observe", (o) => (o.units[0].activity = "dancing")), "INVALID_MESSAGE");
add("observe con carga sin cantidad", false, mutate("observe", (o) => (o.units[1].carry = { kind: "food" })), "INVALID_MESSAGE");
add("observe con cola de más de 5", false, mutate("observe", (o) => {
  o.buildings[1].queue = Array.from({ length: 6 }, (_, i) => ({ id: 20 + i, kind: "villager", remaining: 10 }));
}), "INVALID_MESSAGE");
add("observe con coste de unidad faltante", false, mutate("observe", (o) => delete o.rules.unit_cost.archer), "INVALID_MESSAGE");
add("observe sin piedra en el jugador", false, mutate("observe", (o) => delete o.players[0].stone), "INVALID_MESSAGE");
add("observe con unidad sin defending", false, mutate("observe", (o) => delete o.units[0].defending), "INVALID_MESSAGE");
add("observe sin coste de torre", false, mutate("observe", (o) => delete o.rules.building_cost.tower), "INVALID_MESSAGE");
add("observe con booleano como entero", false, mutate("observe", (o) => (o.request_id = true)), "INVALID_MESSAGE");
add("observe con entero fraccionario", false, mutate("observe", (o) => (o.request_id = 1.5)), "INVALID_MESSAGE");
add("observe con un solo jugador", false, mutate("observe", (o) => o.players.pop()), "INVALID_MESSAGE");
add("observe con más de 500 unidades", false, mutate("observe", (o) => {
  o.units = Array.from({ length: 501 }, (_, i) => ({ ...o.units[0], id: i + 1 }));
}), "INVALID_MESSAGE");
add("init sin expected", false, mutate("init", (m) => delete m.expected), "INVALID_MESSAGE");
add("init con max_commands 5", false, mutate("init", (m) => (m.config.max_commands = 5)), "INVALID_MESSAGE");
add("ready sin versions", false, mutate("ready", (m) => delete m.versions), "INVALID_MESSAGE");
add("ready con tiempo negativo", false, mutate("ready", (m) => (m.timings_ms.total = -1)), "INVALID_MESSAGE");
add("error con código desconocido", false, mutate("error", (m) => (m.code = "BOOM")), "INVALID_MESSAGE");
add("error con mensaje largo", false, mutate("error", (m) => (m.message = "x".repeat(201))), "INVALID_MESSAGE");

// Decisión: lote y comandos
add("decision con cinco comandos", false, withCommands(
  Array.from({ length: 5 }, (_, i) => ({ command_id: `7:${i % 4}`, type: "Stop", entity_ids: [5], payload: {} })),
), "INVALID_MESSAGE");
add("decision con comandos no arreglo", false, mutate("decision", (d) => (d.commands = {})), "INVALID_MESSAGE");
add("decision con campo extra", false, mutate("decision", (d) => (d.estado = {})), "INVALID_MESSAGE");
add("decision con request_id texto", false, mutate("decision", (d) => (d.request_id = "7")), "INVALID_MESSAGE");
add("decision con reason_code en minúsculas", false, mutate("decision", (d) => (d.reason_codes = ["rally"])), "INVALID_MESSAGE");
add("decision con métricas negativas", false, mutate("decision", (d) => (d.metrics.policy_ms = -0.5)), "INVALID_MESSAGE");
add("comando de tipo desconocido", false, withCommands([
  { command_id: "7:0", type: "Teleport", entity_ids: [5], payload: { x: 1, z: 2 } },
]), "INVALID_MESSAGE");
add("Move sin payload", false, withCommands([{ command_id: "7:0", type: "Move", entity_ids: [5] }]), "INVALID_MESSAGE");
add("Move con NaN", false, withCommands([
  { command_id: "7:0", type: "Move", entity_ids: [5], payload: { x: "__NaN__", z: 2 } },
]), "INVALID_MESSAGE");
add("Move con Infinity", false, withCommands([
  { command_id: "7:0", type: "Move", entity_ids: [5], payload: { x: 1, z: "__Infinity__" } },
]), "INVALID_MESSAGE");
add("Move con destino fuera de rango", false, withCommands([
  { command_id: "7:0", type: "Move", entity_ids: [5], payload: { x: 5000, z: 2 } },
]), "INVALID_MESSAGE");
add("Move con payload extra", false, withCommands([
  { command_id: "7:0", type: "Move", entity_ids: [5], payload: { x: 1, z: 2, run: true } },
]), "INVALID_MESSAGE");
add("Move sin entidades", false, withCommands([
  { command_id: "7:0", type: "Move", entity_ids: [], payload: { x: 1, z: 2 } },
]), "INVALID_MESSAGE");
add("Move con más de 100 entidades", false, withCommands([
  { command_id: "7:0", type: "Move", entity_ids: Array.from({ length: 101 }, (_, i) => i + 1), payload: { x: 1, z: 2 } },
]), "INVALID_MESSAGE");
add("Stop con payload", false, withCommands([
  { command_id: "7:0", type: "Stop", entity_ids: [5], payload: { x: 1 } },
]), "INVALID_MESSAGE");
add("command_id mal formado", false, withCommands([
  { command_id: "abc", type: "Stop", entity_ids: [5], payload: {} },
]), "INVALID_MESSAGE");
add("Build con tipo de edificio desconocido", false, withCommands([
  { command_id: "7:0", type: "Build", entity_ids: [5], payload: { building_kind: "castle", cell_x: 1, cell_z: 1 } },
]), "INVALID_MESSAGE");
add("Train con unidad desconocida", false, withCommands([
  { command_id: "7:0", type: "Train", entity_ids: [4], payload: { unit_kind: "dragon" } },
]), "INVALID_MESSAGE");

const out = join(dirname(fileURLToPath(import.meta.url)), "fixtures.json");
writeFileSync(out, `${JSON.stringify({ contract: "worker-v2", cases }, null, 1)}\n`);
console.log(`${cases.length} casos escritos en ${out}`);
