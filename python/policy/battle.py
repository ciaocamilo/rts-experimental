"""Estrategia del Modo batalla (P10, policy-0.9).

Función pura y sin estado, igual que la de villa: la misma observación produce los mismos comandos.
Solo usa Move, Attack y Stop. Cada decisión tiene tres pasos:

1. Análisis: balance de fuerzas entre las unidades propias y las enemigas que se ven, distancia al contacto
   y estado del comandante.
2. Plan: marcha (sin enemigos a la vista), mantener la línea, asalto o repliegue sobre los cañones. La
   personalidad (semilla y jugador) cambia los umbrales: ofensiva, defensiva o envolvente.
3. Órdenes agrupadas por rol, con un máximo de MAX_COMMANDS comandos por decisión, en este orden de prioridad:
   comandante, soldados, arqueros, cañones, caballeros y avance de cañones.

La marcha es una sola orden para el bloque soldados + arqueros + cañones (el núcleo conserva su forma). Mantener
la línea no es quedarse quieto: toda unidad con un enemigo visible a menos de HOLD_ENGAGE_RADIUS lo ataca.

El comandante lidera: marcha y combate en el centro del frente (a lo sumo LEAD_DISTANCE celdas por delante
de los soldados), se repliega con menos del RETREAT_HP_RATIO de vida y, si muere, el caballero más sano
ocupa su lugar.
"""

import math

MAX_COMMANDS = 8
MAX_ENTITIES = 100

OFFENSIVE, DEFENSIVE, ENVELOPING = 0, 1, 2
PERSONALITY_NAMES = ("OFFENSIVE", "DEFENSIVE", "ENVELOPING")
ATTACK_RATIO = (0.8, 1.2, 1.0)
FALLBACK_RATIO = 0.45
HOLD_UNTIL_TICK = 5400
TIMEOUT_TICK = 7200
TIMEOUT_ATTACK_RATIO = 0.7

STAGE_OFFSETS = (-8, 8)
STAGE_TOLERANCE = 3
PACE_LEAD = 10
LEAD_DISTANCE = 3
RETREAT_HP_RATIO = 0.4
LEADER_ENGAGE_RADIUS = 7
CANNON_REACH = 7.0
CANNON_SCAN = 9.0
SPLASH_RADIUS = 2.0
SWEEP_MARGIN = 20
MOVE_TOLERANCE = 1.5
BLOCK_TOLERANCE = 2.5
HOLD_ENGAGE_RADIUS = 11.0
MAX_CANNON_VOLLEYS = 2

_MAX_HP = {"soldier": 300, "archer": 180, "knight": 300, "commander": 1200, "cannon": 360, "villager": 40}
_POWER = {"soldier": 1.0, "archer": 0.9, "knight": 1.6, "commander": 6.5, "cannon": 3.0, "villager": 0.2}
# Cuanto menor, más prioritario: los cañones y arqueros rivales son los blancos preferidos de caballeros y arqueros.
_KNIGHT_PRIORITY = {"cannon": 0.5, "archer": 0.7, "commander": 0.6}
_ARCHER_PRIORITY = {"cannon": 0.7, "archer": 0.8}
_LEADER_PRIORITY = {"commander": 0.6, "knight": 0.7}


def _dist(ax, az, bx, bz):
    return math.hypot(ax - bx, az - bz)


def _centroid(units):
    if not units:
        return None
    return sum(u["x"] for u in units) / len(units), sum(u["z"] for u in units) / len(units)


def _power(unit):
    return _POWER.get(unit["kind"], 1.0) * max(unit["hp"], 0) / _MAX_HP.get(unit["kind"], 100)


def _halves(units):
    """Mitad septentrional y mitad meridional (por z, luego por id)."""
    ordered = sorted(units, key=lambda u: (u["z"], u["id"]))
    middle = len(ordered) // 2
    return ordered[:middle], ordered[middle:]


class _Situation:
    """Lectura de la observación: grupos propios, enemigos visibles y geometría del frente."""

    def __init__(self, observation):
        self.obs = observation
        self.player = observation["player_id"]
        self.tick = observation["observation_tick"]
        self.width = observation["map"]["width"]
        self.depth = observation["map"]["depth"]
        self.direction = 1 if self.player == 0 else -1
        self.personality = (observation["seed"] + self.player) % 3

        units = observation["units"]
        self.mine = sorted((u for u in units if u["owner"] == self.player and u["hp"] > 0), key=lambda u: u["id"])
        self.foes = sorted((u for u in units if u["owner"] != self.player and u["hp"] > 0), key=lambda u: u["id"])
        self.foe_by_id = {u["id"]: u for u in self.foes}

        commanders = [u for u in self.mine if u["kind"] == "commander"]
        knights = [u for u in self.mine if u["kind"] == "knight"]
        self.successor = False
        if commanders:
            self.leader = commanders[0]
        elif knights:
            self.leader = max(knights, key=lambda u: (u["hp"], -u["id"]))
            self.successor = True
        else:
            self.leader = None
        leader_id = self.leader["id"] if self.leader else None
        self.soldiers = [u for u in self.mine if u["kind"] == "soldier"]
        self.archers = [u for u in self.mine if u["kind"] == "archer"]
        self.cannons = [u for u in self.mine if u["kind"] == "cannon"]
        self.knights = [u for u in knights if u["id"] != leader_id]

        self.mine_power = sum(_power(u) for u in self.mine)
        self.foe_power = sum(_power(u) for u in self.foes)
        self.ratio = self.mine_power / self.foe_power if self.foe_power > 0 else math.inf

    def prog(self, x):
        """Avance hacia el enemigo: 0 en el borde propio, `width` en el rival."""
        return x if self.direction == 1 else self.width - x

    def x_at(self, prog):
        return prog if self.direction == 1 else self.width - prog

    def point(self, prog, z):
        return (
            min(max(self.x_at(prog), 1.0), self.width - 1.0),
            min(max(z, 1.0), self.depth - 1.0),
        )

    def stages(self):
        half = self.width / 2
        return [half + offset for offset in STAGE_OFFSETS]

    @property
    def mid_z(self):
        return self.depth / 2 - 0.5

    def front_prog(self):
        """Avance de los soldados en el percentil 80 (ignora a los adelantados sueltos)."""
        pool = self.soldiers or self.archers or self.knights or self.mine
        values = sorted(self.prog(u["x"]) for u in pool)
        return values[min(len(values) - 1, int(len(values) * 0.8))]

    def core_center(self):
        return _centroid(self.soldiers + self.archers) or _centroid(self.knights) or _centroid(self.mine)


class _Orders:
    def __init__(self):
        self.commands = []
        self.reasons = []

    def full(self):
        return len(self.commands) >= MAX_COMMANDS

    def _add(self, command, reason):
        if self.full():
            return False
        self.commands.append(command)
        if reason not in self.reasons and len(self.reasons) < 8:
            self.reasons.append(reason)
        return True

    def move(self, units, x, z, reason, tolerance=MOVE_TOLERANCE):
        movers = [u for u in units if _needs_move(u, x, z, tolerance)]
        if not movers:
            return False
        ids = [u["id"] for u in movers][:MAX_ENTITIES]
        return self._add({"type": "Move", "entity_ids": ids, "payload": {"x": round(x, 2), "z": round(z, 2)}}, reason)

    def move_block(self, units, x, z, reason, tolerance=BLOCK_TOLERANCE):
        """Una sola orden para todo el bloque: el núcleo conserva su forma, así que se compara el centro del bloque."""
        if not units:
            return False
        cx = sum((u["dest"]["x"] if u["dest"] is not None else u["x"]) for u in units) / len(units)
        cz = sum((u["dest"]["z"] if u["dest"] is not None else u["z"]) for u in units) / len(units)
        if _dist(cx, cz, x, z) <= tolerance:
            return False
        ids = [u["id"] for u in units][:MAX_ENTITIES]
        return self._add({"type": "Move", "entity_ids": ids, "payload": {"x": round(x, 2), "z": round(z, 2)}}, reason)

    def attack(self, units, target, reason):
        # Quien ya persigue o golpea a este blanco no recibe la orden otra vez: reiniciaría su ruta y lo frenaría.
        workers = [u for u in units if not _on_target(u, target)]
        if not workers:
            return False
        ids = [u["id"] for u in workers][:MAX_ENTITIES]
        return self._add({"type": "Attack", "entity_ids": ids, "payload": {"target_id": target["id"]}}, reason)

    def stop(self, units, reason):
        if not units:
            return False
        ids = [u["id"] for u in units][:MAX_ENTITIES]
        return self._add({"type": "Stop", "entity_ids": ids, "payload": {}}, reason)


def _needs_move(unit, x, z, tolerance):
    dest = unit["dest"]
    if dest is not None and _dist(dest["x"], dest["z"], x, z) <= tolerance:
        return False
    if unit["activity"] == "idle" and _dist(unit["x"], unit["z"], x, z) <= tolerance * 2:
        return False
    return True


def _on_target(unit, target):
    """La unidad ya tiene como blanco a `target`, golpeándolo o de camino hacia él."""
    return unit["target_id"] == target["id"] and unit["activity"] in ("attacking", "moving")


def _free_units(units):
    """Unidades que no están ya golpeando: no se les cambia el objetivo a mitad de golpe."""
    return [u for u in units if u["activity"] != "attacking"]


def _nearest(point, foes, priority=None):
    """Enemigo más cercano a `point`, con la distancia ponderada por prioridad de tipo."""
    priority = priority or {}
    best = None
    best_key = None
    for foe in foes:
        key = (_dist(point[0], point[1], foe["x"], foe["z"]) * priority.get(foe["kind"], 1.0), foe["id"])
        if best_key is None or key < best_key:
            best, best_key = foe, key
    return best


def _cannon_target(cannon, foes, reach):
    """Blanco que maximiza el daño de área esperado dentro del alcance del cañón."""
    best = None
    best_key = None
    for foe in foes:
        d = _dist(cannon["x"], cannon["z"], foe["x"], foe["z"])
        if d > reach:
            continue
        score = 0.0
        for other in foes:
            gap = _dist(foe["x"], foe["z"], other["x"], other["z"])
            if gap > SPLASH_RADIUS:
                continue
            factor = 1 - 0.5 * gap / SPLASH_RADIUS
            still = 1.0 if other["activity"] != "moving" else 0.6
            score += _power(other) * factor * still
        key = (-(score - 0.05 * d), foe["id"])
        if best_key is None or key < best_key:
            best, best_key = foe, key
    return best


def analyze(observation):
    """Resumen legible del análisis (lo usan los tests y los reason_codes)."""
    s = _Situation(observation)
    return {
        "personality": PERSONALITY_NAMES[s.personality],
        "plan": _choose_plan(s),
        "ratio": s.ratio,
        "mine": len(s.mine),
        "foes": len(s.foes),
        "leader": s.leader["id"] if s.leader else None,
    }


def _choose_plan(s):
    if not s.foes:
        return "MARCH"
    attack_ratio = ATTACK_RATIO[s.personality]
    if s.tick >= TIMEOUT_TICK:
        attack_ratio = min(attack_ratio, TIMEOUT_ATTACK_RATIO)
    if s.ratio < FALLBACK_RATIO and s.cannons:
        center = _centroid(s.soldiers + s.archers + s.knights)
        cannons = _centroid(s.cannons)
        if center is not None and _dist(center[0], center[1], cannons[0], cannons[1]) > 8:
            return "FALLBACK"
    if s.ratio >= attack_ratio or s.ratio < FALLBACK_RATIO:
        return "ASSAULT"
    return "HOLD"


def decide(observation):
    """Devuelve (comandos sin command_id, reason_codes)."""
    s = _Situation(observation)
    if not s.mine:
        return [], ["NO_ARMY"]
    orders = _Orders()
    plan = _choose_plan(s)
    if plan == "MARCH":
        _march(s, orders)
    elif plan == "ASSAULT":
        _assault(s, orders)
    elif plan == "FALLBACK":
        _fallback(s, orders)
    else:
        _hold(s, orders)
    if not orders.commands:
        return [], ["NOTHING_TO_DO"]
    reasons = ["BATTLE_" + plan] + [r for r in orders.reasons if r != "BATTLE_" + plan]
    return orders.commands, reasons[:8]


def _march(s, o):
    """Sin enemigos a la vista: columna que se reagrupa en cada etapa, con los cañones marcando el paso."""
    stages = s.stages()
    if s.personality == DEFENSIVE and s.tick < HOLD_UNTIL_TICK:
        stages = stages[:1]
    columns = s.soldiers + s.archers + s.cannons
    progs = sorted(s.prog(u["x"]) for u in columns)
    slow = progs[len(progs) // 5] if progs else 0
    target = next((p for p in stages if slow < p - STAGE_TOLERANCE), None)
    sweeping = target is None
    if sweeping:
        target = s.width - SWEEP_MARGIN
        if s.personality == DEFENSIVE and s.tick < HOLD_UNTIL_TICK:
            target = stages[-1]
    if s.cannons:
        target = min(target, min(s.prog(c["x"]) for c in s.cannons) + PACE_LEAD)
    z0 = s.mid_z
    reason = "SWEEP" if sweeping else "REGROUP"

    if s.leader:
        o.move([s.leader], *s.point(target + LEAD_DISTANCE + 1, z0), "LEADER_LEAD" if not s.successor else "LEADER_SUCCESSOR")
    o.move_block(s.soldiers + s.archers + s.cannons, *s.point(target, z0), reason)
    knights_north, knights_south = _halves(s.knights)
    knight_target = min(target, s.front_prog() + PACE_LEAD)
    flank = z0 - 16 if sweeping else z0 - 5
    o.move(knights_north, *s.point(knight_target, flank), "FLANK_SCOUT" if sweeping else reason)
    flank = z0 + 16 if sweeping else z0 + 5
    o.move(knights_south, *s.point(knight_target, flank), "FLANK_SCOUT" if sweeping else reason)


def _lead(s, o, retreat_point):
    """Órdenes del comandante (o de su sucesor): primero la salud, luego el combate cercano y si no el frente."""
    leader = s.leader
    if leader is None:
        return
    hp_ratio = leader["hp"] / _MAX_HP[leader["kind"]]
    reason = "LEADER_SUCCESSOR" if s.successor else "LEADER_LEAD"
    if hp_ratio < RETREAT_HP_RATIO and len(s.mine) > 1:
        o.move([leader], retreat_point[0], retreat_point[1], "LEADER_RETREAT")
        return
    if leader["activity"] == "attacking" or (leader["activity"] == "moving" and leader["target_id"] in s.foe_by_id):
        return
    near = [f for f in s.foes if _dist(leader["x"], leader["z"], f["x"], f["z"]) <= LEADER_ENGAGE_RADIUS]
    target = _nearest((leader["x"], leader["z"]), near, _LEADER_PRIORITY)
    if target is not None:
        o.attack([leader], target, reason)
        return
    center = s.core_center()
    if center is not None:
        o.move([leader], *s.point(s.front_prog() + LEAD_DISTANCE, center[1]), reason)


def _retreat_point(s):
    cannons = _centroid(s.cannons)
    if cannons is not None:
        return s.point(s.prog(cannons[0]) - 1, cannons[1])
    center = s.core_center() or (s.x_at(s.width / 2), s.mid_z)
    return s.point(s.prog(center[0]) - 8, center[1])


def _fire_cannons(s, o, reach, max_volleys=None):
    """Cada cañón dispara al blanco de mayor daño de área; los que comparten blanco reciben una sola orden."""
    groups = {}
    for cannon in s.cannons:
        current = s.foe_by_id.get(cannon["target_id"]) if cannon["activity"] in ("attacking", "moving") else None
        if current is not None and (cannon["activity"] == "moving" or _dist(cannon["x"], cannon["z"], current["x"], current["z"]) <= reach + 1):
            continue
        target = _cannon_target(cannon, s.foes, reach)
        if target is not None:
            groups.setdefault(target["id"], []).append(cannon)
    for count, (target_id, cannons) in enumerate(sorted(groups.items(), key=lambda item: (-len(item[1]), item[0]))):
        if max_volleys is not None and count >= max_volleys:
            break
        o.attack(cannons, s.foe_by_id[target_id], "CANNON_SPLASH")
    return groups


def _assault(s, o):
    # Orden de prioridad bajo el tope de órdenes: comandante, infantería, arqueros, cañones y al final caballería y avance.
    retreat = _retreat_point(s)
    _lead(s, o, retreat)

    soldiers = _free_units(s.soldiers)
    north, south = _halves(soldiers)
    for chunk in (north, south):
        center = _centroid(chunk)
        if center is None:
            continue
        target = _nearest(center, s.foes)
        if target is not None:
            o.attack(chunk, target, "FRONT_ATTACK")

    archers = _free_units(s.archers)
    center = _centroid(archers)
    if center is not None:
        target = _nearest(center, s.foes, _ARCHER_PRIORITY)
        if target is not None:
            o.attack(archers, target, "ARCHER_FIRE")

    groups = _fire_cannons(s, o, CANNON_SCAN, MAX_CANNON_VOLLEYS)

    knights = _free_units(s.knights)
    if s.personality == ENVELOPING:
        halves = _halves(knights)
    else:
        halves = (knights, [])
    for chunk in halves:
        center = _centroid(chunk)
        if center is None:
            continue
        target = _nearest(center, s.foes, _KNIGHT_PRIORITY)
        if target is not None:
            o.attack(chunk, target, "FLANK_RAID")

    unattended = [c for c in s.cannons if c["activity"] != "attacking" and all(c not in g for g in groups.values())]
    if unattended and s.foes:
        if s.soldiers or s.archers or s.knights:
            center = s.core_center()
            if center is not None:
                o.move(unattended, *s.point(s.front_prog() - 3, center[1]), "CANNON_ADVANCE")
        else:
            _cannon_advance(s, o, unattended)


def _cannon_advance(s, o, cannons):
    """Cañones sin infantería que los cubra: se acercan al enemigo visible más cercano hasta quedar a tiro."""
    center = _centroid(cannons)
    foe = _nearest(center, s.foes)
    gap = _dist(center[0], center[1], foe["x"], foe["z"])
    stand_off = CANNON_REACH - 1.5
    if gap <= stand_off:
        return
    k = (gap - stand_off) / gap
    x = center[0] + (foe["x"] - center[0]) * k
    z = center[1] + (foe["z"] - center[1]) * k
    o.move(cannons, min(max(x, 1.0), s.width - 1.0), min(max(z, 1.0), s.depth - 1.0), "CANNON_ADVANCE")


def _engage(s, o, units, reason, priority=None):
    """Ordena atacar al enemigo visible más cercano a las unidades libres que lo tienen al alcance de la línea."""
    ready = [
        u
        for u in _free_units(units)
        if any(_dist(u["x"], u["z"], f["x"], f["z"]) <= HOLD_ENGAGE_RADIUS for f in s.foes)
    ]
    for chunk in _halves(ready):
        center = _centroid(chunk)
        if center is None:
            continue
        target = _nearest(center, s.foes, priority)
        if target is not None:
            o.attack(chunk, target, reason)
    return ready


def _hold(s, o):
    """Mantiene la línea sin quedarse quieta: el comandante lidera, los cañones castigan y quien tenga al enemigo cerca lo combate."""
    retreat = _retreat_point(s)
    _lead(s, o, retreat)
    engaged = _engage(s, o, s.soldiers, "HOLD_ENGAGE")
    engaged += _engage(s, o, s.archers, "HOLD_ENGAGE", _ARCHER_PRIORITY)
    _fire_cannons(s, o, CANNON_REACH, MAX_CANNON_VOLLEYS)
    engaged += _engage(s, o, s.knights, "HOLD_ENGAGE", _KNIGHT_PRIORITY)
    engaged_ids = {u["id"] for u in engaged}
    walkers = [u for u in s.soldiers + s.archers + s.knights if u["activity"] == "moving" and u["target_id"] is None and u["id"] not in engaged_ids]
    o.stop(walkers, "HOLD_LINE")


def _fallback(s, o):
    """Muy inferior en fuerza: la infantería se repliega bajo la protección de los cañones."""
    point = _retreat_point(s)
    _lead(s, o, point)
    _fire_cannons(s, o, CANNON_REACH)
    o.move(s.soldiers + s.archers + s.knights, point[0], point[1], "RETREAT_TO_CANNONS", tolerance=2.5)
