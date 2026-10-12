"""Política estratégica policy-0.4 (P6).

Función pura y sin estado: la misma observación produce los mismos comandos. No usa reloj ni azar.
Prioridades, de mayor a menor: defender, reasignar aldeanos, casa, aldeanos, cuartel, torre, militares, ataque.
Cada comando que se emite descuenta de una estimación local de recursos y población, de modo que
varios comandos del mismo lote no gastan dos veces lo mismo. Como máximo se emiten 4 comandos.

Novedades de P3: recoge piedra y construye torres; solo ordena recolectar nodos a los que las unidades
pueden llegar (así no repite órdenes que el núcleo rechazará con UNREACHABLE); y no saca de su defensa
automática a los militares que ya están peleando (`defending`).

Novedades de P6: el objetivo principal sigue siendo el centro urbano, pero la expedición ataca una torre
enemiga completa que «vea» (a VISION_RADIUS celdas o menos de algún militar) si está más cerca del grupo
que el centro urbano (motivo ATTACK_TOWER).
"""

import math
from collections import deque

VERSION = "policy-0.4"

MAX_COMMANDS = 4
MAX_ENTITIES = 100

TARGET_VILLAGERS = 12
FOOD_SHARE_PERCENT = 60
MIN_VILLAGERS_FOR_BARRACKS = 6
MIN_VILLAGERS_FOR_TOWER = 8
STONE_WORKERS = 2
MAX_TOWERS = 4
VISION_RADIUS = 14
HOUSE_FREE_SLOTS = 2
VILLAGER_QUEUE_MAX = 1
MILITARY_QUEUE_MAX = 1
DEFEND_RADIUS = 10
EXPEDITION_SIZE = 8
ENGAGE_RADIUS = 8
PLACEMENT_MIN_DISTANCE = 3
PLACEMENT_MAX_DISTANCE = 12
PLACEMENT_CHOICES = 4
NODE_CHOICES = 3
DECISION_TICKS = 20

_MILITARY = ("soldier", "archer")
_IDLE_ACTIVITIES = ("idle", "blocked")
_NEIGHBORS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


def _footprint_rect(building, rules):
    size = rules["footprint"][building["kind"]]
    return building["cell_x"], building["cell_z"], size, size


def _center(building, rules):
    x, z, w, h = _footprint_rect(building, rules)
    return x + w / 2, z + h / 2


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


class _Plan:
    """Lote de comandos con presupuesto local de comida, madera, piedra y población."""

    def __init__(self, observation):
        self.obs = observation
        self.rules = observation["rules"]
        self.player_id = observation["player_id"]
        me = next(p for p in observation["players"] if p["id"] == self.player_id)
        self.food = me["food"]
        self.wood = me["wood"]
        self.stone = me["stone"]
        self.pop = me["pop"]
        self.capacity = me["pop_capacity"]
        self.tick = observation["observation_tick"]
        self.commands = []
        self.reasons = []
        self.placed = []
        self._reach = None

    def full(self):
        return len(self.commands) >= MAX_COMMANDS

    def emit(self, command, reason, food=0, wood=0, stone=0, pop=0):
        if self.full():
            return False
        self.commands.append(command)
        if reason not in self.reasons:
            self.reasons.append(reason)
        self.food -= food
        self.wood -= wood
        self.stone -= stone
        self.pop += pop
        return True

    def reachable(self, origin):
        """Celdas libres conectadas con el perímetro del edificio `origin` (8 vecinos, sin cortar esquinas)."""
        if self._reach is not None:
            return self._reach
        solid = _blocked_cells(self)
        width = self.obs["map"]["width"]
        depth = self.obs["map"]["depth"]
        x, z, w, h = _footprint_rect(origin, self.rules)
        seen = set()
        queue = deque()
        for cx in range(x - 1, x + w + 1):
            for cz in range(z - 1, z + h + 1):
                cell = (cx, cz)
                if 0 <= cx < width and 0 <= cz < depth and cell not in solid and cell not in seen:
                    seen.add(cell)
                    queue.append(cell)
        while queue:
            cx, cz = queue.popleft()
            for dx, dz in _NEIGHBORS:
                nx, nz = cx + dx, cz + dz
                cell = (nx, nz)
                if cell in seen or not (0 <= nx < width and 0 <= nz < depth) or cell in solid:
                    continue
                if dx != 0 and dz != 0 and ((cx + dx, cz) in solid or (cx, cz + dz) in solid):
                    continue
                seen.add(cell)
                queue.append(cell)
        self._reach = seen
        return seen


def _node_accessible(reach, node):
    """Un nodo es accesible si alguna celda libre contigua es alcanzable desde la base."""
    for dx, dz in _NEIGHBORS:
        if (node["cell_x"] + dx, node["cell_z"] + dz) in reach:
            return True
    return False


def _blocked_cells(plan, solid_only=False):
    """Celdas ocupadas por terreno, edificios, nodos con recursos y obras decididas en este lote."""
    rules = plan.rules
    cells = set()
    for t in plan.obs["map"]["terrain"]:
        for x in range(int(t["x"]), int(t["x"] + t["w"])):
            for z in range(int(t["z"]), int(t["z"] + t["h"])):
                cells.add((x, z))
    for b in plan.obs["buildings"]:
        x, z, w, h = _footprint_rect(b, rules)
        for cx in range(x, x + w):
            for cz in range(z, z + h):
                cells.add((cx, cz))
    for n in plan.obs["resource_nodes"]:
        if n["remaining"] > 0:
            cells.add((n["cell_x"], n["cell_z"]))
    for x, z, w, h in plan.placed:
        for cx in range(x, x + w):
            for cz in range(z, z + h):
                cells.add((cx, cz))
    return cells


def _unit_cells(plan):
    """Celdas que toca algún círculo de unidad, con un margen para que no estorbe la huella."""
    cells = set()
    for u in plan.obs["units"]:
        for cx in range(math.floor(u["x"] - 0.8), math.floor(u["x"] + 0.8) + 1):
            for cz in range(math.floor(u["z"] - 0.8), math.floor(u["z"] + 0.8) + 1):
                cells.add((cx, cz))
    return cells


def _choose_cell(plan, base, kind, forward=False):
    """Esquina de la huella en un anillo alrededor del centro; evita el lado del enemigo (o lo prefiere si `forward`)."""
    size = plan.rules["footprint"][kind]
    map_width = plan.obs["map"]["width"]
    map_depth = plan.obs["map"]["depth"]
    base_x, base_z = _center(base, plan.rules)
    toward_enemy = 1 if map_width / 2 > base_x else -1
    enemy_centers = [b for b in plan.obs["buildings"] if b["owner"] != plan.player_id and b["kind"] == "townCenter"]
    if enemy_centers:
        enemy = min(enemy_centers, key=lambda b: b["id"])
        toward_enemy = 1 if _center(enemy, plan.rules)[0] > base_x else -1
    solid = _blocked_cells(plan)
    busy = _unit_cells(plan)
    candidates = []
    span = PLACEMENT_MAX_DISTANCE + size
    for cx in range(int(base_x) - span, int(base_x) + span + 1):
        for cz in range(int(base_z) - span, int(base_z) + span + 1):
            if cx < 0 or cz < 0 or cx + size > map_width or cz + size > map_depth:
                continue
            center = (cx + size / 2, cz + size / 2)
            distance = _dist(center, (base_x, base_z))
            if distance < PLACEMENT_MIN_DISTANCE + size / 2 or distance > PLACEMENT_MAX_DISTANCE:
                continue
            ring = [(x, z) for x in range(cx - 1, cx + size + 1) for z in range(cz - 1, cz + size + 1)]
            if any(cell in solid for cell in ring):
                continue
            if any((x, z) in busy for x in range(cx, cx + size) for z in range(cz, cz + size)):
                continue
            penalty = max(0.0, toward_enemy * (center[0] - base_x))
            if forward:
                penalty = max(0.0, -toward_enemy * (center[0] - base_x))
            candidates.append((distance + penalty, cx, cz))
    if not candidates:
        return None
    candidates.sort()
    pick = (plan.tick // DECISION_TICKS) % min(PLACEMENT_CHOICES, len(candidates))
    _, cx, cz = candidates[pick]
    return cx, cz


def _builder_order(villagers, busy_ids):
    """Constructor preferido: inactivo, luego sin carga, por ID."""

    def key(u):
        idle = 0 if u["activity"] in _IDLE_ACTIVITIES else 1
        loaded = 0 if u["carry"] is None else 1
        return idle, loaded, u["id"]

    return sorted((u for u in villagers if u["id"] not in busy_ids), key=key)


def _pick_node(nodes, counts, origin):
    live = sorted((n for n in nodes if n["remaining"] > 0), key=lambda n: (_dist((n["cell_x"] + 0.5, n["cell_z"] + 0.5), origin), n["id"]))
    near = live[:NODE_CHOICES]
    if not near:
        return None
    return min(
        near,
        key=lambda n: (counts.get(n["id"], 0), _dist((n["cell_x"] + 0.5, n["cell_z"] + 0.5), origin), n["id"]),
    )


def _defend(plan, tc_center, military, enemy_units):
    threats = [e for e in enemy_units if e["kind"] in _MILITARY and _dist((e["x"], e["z"]), tc_center) <= DEFEND_RADIUS]
    if not threats:
        return False
    target = min(threats, key=lambda e: (_dist((e["x"], e["z"]), tc_center), e["id"]))
    ids = [m["id"] for m in military if m["target_id"] != target["id"]][:MAX_ENTITIES]
    if ids:
        plan.emit({"type": "Attack", "entity_ids": ids, "payload": {"target_id": target["id"]}}, "DEFEND")
    return True


def _attack(plan, military, enemy_units, enemy_buildings):
    # Quien ya se defiende solo (defending) termina su pelea antes de unirse a una expedición.
    military = [m for m in military if not m["defending"]]
    if len(military) < EXPEDITION_SIZE:
        return
    group = (sum(m["x"] for m in military) / len(military), sum(m["z"] for m in military) / len(military))
    foes = [e for e in enemy_units if e["kind"] in _MILITARY and _dist((e["x"], e["z"]), group) <= ENGAGE_RADIUS]
    reason = "ATTACK"
    if foes:
        target = min(foes, key=lambda e: (_dist((e["x"], e["z"]), group), e["id"]))
    else:
        centers = sorted((b for b in enemy_buildings if b["kind"] == "townCenter"), key=lambda b: b["id"])
        others = sorted(
            enemy_buildings,
            key=lambda b: (_dist(_center(b, plan.rules), group), b["id"]),
        )
        target = (centers or others or [None])[0]
        if target is None:
            rest = sorted(enemy_units, key=lambda e: (_dist((e["x"], e["z"]), group), e["id"]))
            target = rest[0] if rest else None
        seen = [
            b
            for b in enemy_buildings
            if b["kind"] == "tower"
            and b["complete"]
            and min(_dist((m["x"], m["z"]), _center(b, plan.rules)) for m in military) <= VISION_RADIUS
        ]
        if seen and centers:
            tower = min(seen, key=lambda b: (_dist(_center(b, plan.rules), group), b["id"]))
            if _dist(_center(tower, plan.rules), group) < _dist(_center(centers[0], plan.rules), group):
                target = tower
                reason = "ATTACK_TOWER"
    if target is None:
        return
    ids = [m["id"] for m in military if m["target_id"] != target["id"]][:MAX_ENTITIES]
    if ids:
        plan.emit({"type": "Attack", "entity_ids": ids, "payload": {"target_id": target["id"]}}, reason)


def _assign_gatherers(plan, villagers, idle, nodes, tc_center, builders_busy, origin, stone_wanted):
    node_by_id = {n["id"]: n for n in nodes}
    counts = {}
    per_kind = {"food": 0, "wood": 0, "stone": 0}
    for v in villagers:
        node = node_by_id.get(v["target_id"]) if v["target_id"] is not None else None
        if node is not None and v["activity"] not in _IDLE_ACTIVITIES:
            counts[node["id"]] = counts.get(node["id"], 0) + 1
            per_kind[node["kind"]] += 1

    workers = len(villagers) - builders_busy
    stone_want = min(STONE_WORKERS, workers) if stone_wanted else 0
    rest = workers - stone_want
    want_food = (rest * FOOD_SHARE_PERCENT + 50) // 100
    want = {"food": want_food, "wood": rest - want_food, "stone": stone_want}

    # Solo se ordena recolectar nodos a los que se puede llegar: el núcleo rechazaría el resto con UNREACHABLE.
    usable = [n for n in nodes if n["remaining"] > 0]
    if idle:
        reach = plan.reachable(origin)
        usable = [n for n in usable if _node_accessible(reach, n)]
    kinds = ("food", "wood", "stone")
    groups = {k: [] for k in kinds}
    for v in idle:
        candidates = [k for k in kinds if any(n["kind"] == k for n in usable) and (k != "stone" or want["stone"] - per_kind["stone"] > 0)]
        if not candidates:
            break
        kind = max(candidates, key=lambda k: (want[k] - per_kind[k], -kinds.index(k)))
        groups[kind].append(v["id"])
        per_kind[kind] += 1

    for kind in kinds:
        if not groups[kind]:
            continue
        node = _pick_node([n for n in usable if n["kind"] == kind], counts, tc_center)
        if node is None:
            continue
        plan.emit(
            {"type": "Gather", "entity_ids": groups[kind][:MAX_ENTITIES], "payload": {"target_id": node["id"]}},
            "GATHER",
        )


def decide(observation):
    """Devuelve (comandos sin command_id, reason_codes)."""
    plan = _Plan(observation)
    player_id = plan.player_id
    rules = plan.rules

    units = observation["units"]
    buildings = observation["buildings"]
    mine = sorted((u for u in units if u["owner"] == player_id), key=lambda u: u["id"])
    enemy_units = sorted((u for u in units if u["owner"] != player_id), key=lambda u: u["id"])
    my_buildings = sorted((b for b in buildings if b["owner"] == player_id), key=lambda b: b["id"])
    enemy_buildings = sorted((b for b in buildings if b["owner"] != player_id and b["hp"] > 0), key=lambda b: b["id"])

    town_centers = [b for b in my_buildings if b["kind"] == "townCenter" and b["complete"]]
    if not town_centers:
        return [], ["NO_BASE"]
    town_center = town_centers[0]
    tc_center = _center(town_center, rules)

    villagers = [u for u in mine if u["kind"] == "villager"]
    military = [u for u in mine if u["kind"] in _MILITARY]
    nodes = observation["resource_nodes"]

    defending = _defend(plan, tc_center, military, enemy_units)

    sites = [b for b in my_buildings if not b["complete"]]
    site_ids = {b["id"] for b in sites}
    working = {v["id"] for v in villagers if v["target_id"] in site_ids}
    idle = [v for v in villagers if v["activity"] in _IDLE_ACTIVITIES]

    houses = [b for b in my_buildings if b["kind"] == "house"]
    barracks = [b for b in my_buildings if b["kind"] == "barracks"]
    towers = [b for b in my_buildings if b["kind"] == "tower"]
    cost = rules["building_cost"]

    # Decisión previa de obras para reservar constructores antes de reasignar a los inactivos.
    wood_left = plan.wood
    want_house = (
        plan.capacity - plan.pop <= HOUSE_FREE_SLOTS
        and plan.capacity < rules["max_population"]
        and not any(not h["complete"] for h in houses)
        and wood_left >= cost["house"]["wood"]
    )
    if want_house:
        wood_left -= cost["house"]["wood"]
    want_barracks = (
        not barracks
        and len(villagers) >= MIN_VILLAGERS_FOR_BARRACKS
        and wood_left >= cost["barracks"]["wood"]
    )

    tower_stone = cost["tower"]["stone"]
    want_tower = (
        len(towers) < MAX_TOWERS
        and not any(not t["complete"] for t in towers)
        and len(villagers) >= MIN_VILLAGERS_FOR_TOWER
        and plan.stone >= tower_stone
    )
    # Se junta piedra solo mientras falta para la próxima torre.
    stone_wanted = len(towers) < MAX_TOWERS and len(villagers) >= MIN_VILLAGERS_FOR_TOWER and plan.stone < tower_stone

    unattended = [b for b in sites if not any(v["target_id"] == b["id"] for v in villagers)]
    reserved = []
    pool = _builder_order(villagers, working)
    for _ in range(len(unattended) + int(want_house) + int(want_barracks) + int(want_tower)):
        if pool:
            reserved.append(pool.pop(0))
    reserved_ids = {v["id"] for v in reserved}

    _assign_gatherers(
        plan,
        villagers,
        [v for v in idle if v["id"] not in reserved_ids],
        nodes,
        tc_center,
        len(working | reserved_ids),
        town_center,
        stone_wanted,
    )

    # Obras abandonadas: otro aldeano las retoma.
    builders = list(reserved)
    for site in unattended:
        if builders:
            builder = builders.pop(0)
            plan.emit({"type": "ResumeBuild", "entity_ids": [builder["id"]], "payload": {"target_id": site["id"]}}, "RESUME_BUILD")

    if want_house and builders:
        cell = _choose_cell(plan, town_center, "house")
        if cell is not None:
            builder = builders[0]
            payload = {"building_kind": "house", "cell_x": cell[0], "cell_z": cell[1]}
            if plan.emit({"type": "Build", "entity_ids": [builder["id"]], "payload": payload}, "BUILD_HOUSE", wood=cost["house"]["wood"]):
                builders.pop(0)
                size = rules["footprint"]["house"]
                plan.placed.append((cell[0], cell[1], size, size))

    queued_villagers = sum(1 for q in town_center["queue"] if q["kind"] == "villager")
    if (
        len(villagers) + queued_villagers < TARGET_VILLAGERS
        and len(town_center["queue"]) <= VILLAGER_QUEUE_MAX
        and plan.food >= rules["unit_cost"]["villager"]["food"]
        and plan.pop + 1 <= plan.capacity
    ):
        plan.emit(
            {"type": "Train", "entity_ids": [town_center["id"]], "payload": {"unit_kind": "villager"}},
            "TRAIN_VILLAGER",
            food=rules["unit_cost"]["villager"]["food"],
            pop=1,
        )

    if want_barracks and builders and plan.wood >= cost["barracks"]["wood"]:
        cell = _choose_cell(plan, town_center, "barracks")
        if cell is not None:
            payload = {"building_kind": "barracks", "cell_x": cell[0], "cell_z": cell[1]}
            if plan.emit(
                {"type": "Build", "entity_ids": [builders[0]["id"]], "payload": payload},
                "BUILD_BARRACKS",
                wood=cost["barracks"]["wood"],
            ):
                builders.pop(0)
                size = rules["footprint"]["barracks"]
                plan.placed.append((cell[0], cell[1], size, size))

    if want_tower and builders and plan.stone >= tower_stone:
        cell = _choose_cell(plan, town_center, "tower", forward=True)
        if cell is not None:
            payload = {"building_kind": "tower", "cell_x": cell[0], "cell_z": cell[1]}
            if plan.emit(
                {"type": "Build", "entity_ids": [builders[0]["id"]], "payload": payload},
                "BUILD_TOWER",
                stone=tower_stone,
            ):
                builders.pop(0)
                size = rules["footprint"]["tower"]
                plan.placed.append((cell[0], cell[1], size, size))

    ready_barracks = [b for b in barracks if b["complete"]]
    if ready_barracks:
        hall = min(ready_barracks, key=lambda b: (len(b["queue"]), b["id"]))
        if len(hall["queue"]) <= MILITARY_QUEUE_MAX:
            soldiers = sum(1 for u in military if u["kind"] == "soldier")
            archers = sum(1 for u in military if u["kind"] == "archer")
            for b in barracks:
                for q in b["queue"]:
                    soldiers += q["kind"] == "soldier"
                    archers += q["kind"] == "archer"
            kind = "archer" if archers < soldiers // 2 else "soldier"
            unit_cost = rules["unit_cost"][kind]
            if plan.food >= unit_cost["food"] and plan.wood >= unit_cost["wood"] and plan.pop + 1 <= plan.capacity:
                plan.emit(
                    {"type": "Train", "entity_ids": [hall["id"]], "payload": {"unit_kind": kind}},
                    "TRAIN_MILITARY",
                    food=unit_cost["food"],
                    wood=unit_cost["wood"],
                    pop=1,
                )

    if not defending:
        _attack(plan, military, enemy_units, enemy_buildings)

    if not plan.commands:
        return [], ["NOTHING_TO_DO"]
    return plan.commands, plan.reasons
