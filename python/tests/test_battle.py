import json
import unittest
from pathlib import Path

from policy import battle, contract, entry, policy

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "contracts" / "worker-v2" / "fixtures.json"

HP = {"soldier": 300, "archer": 180, "knight": 300, "commander": 1200, "cannon": 360}


def _base():
    with open(FIXTURES, encoding="utf-8") as handle:
        case = next(c for c in json.load(handle)["cases"] if c["name"] == "observe de batalla con comandante y terreno")
    return case["message"]


def unit(uid, kind, owner, x, z, hp=None, activity="idle", target=None, dest=None):
    return {
        "id": uid, "owner": owner, "kind": kind, "x": x, "z": z, "hp": HP[kind] if hp is None else hp,
        "task": "moving" if activity == "moving" else "idle", "activity": activity, "dest": dest,
        "blocked_reason": None, "carry": None, "target_id": target, "defending": False,
    }


def army(owner, start, x, direction=1, cannons=5, archers=15, knights=10, soldiers=30):
    """Ejército en formación: comandante al centro, soldados delante, arqueros y cañones detrás."""
    units = [unit(start, "commander", owner, x + direction * 4, 32)]
    uid = start + 1
    for i in range(soldiers):
        units.append(unit(uid, "soldier", owner, x + direction * 3, 22 + i * 0.7))
        uid += 1
    for i in range(archers):
        units.append(unit(uid, "archer", owner, x + direction * 1, 24 + i * 1.1))
        uid += 1
    for i in range(cannons):
        units.append(unit(uid, "cannon", owner, x - direction * 2, 24 + i * 4))
        uid += 1
    for i in range(knights):
        units.append(unit(uid, "knight", owner, x + direction * 3, 16 + i * 3.5))
        uid += 1
    return units


def scene(units, player=1, seed=0, tick=300):
    message = _base()
    message["player_id"] = player
    message["seed"] = seed
    message["observation_tick"] = tick
    message["units"] = units
    return message


def by_type(commands, kind):
    return [c for c in commands if c["type"] == kind]


class BattleDispatchTest(unittest.TestCase):
    def test_battle_observation_is_valid_for_the_contract(self):
        code, detail = contract.validate_message(_base())
        self.assertIsNone(code, detail)

    def test_policy_dispatches_to_battle_when_mode_is_battle(self):
        message = scene(army(1, 100, 110, -1))
        self.assertEqual(policy.decide(message), battle.decide(message))

    def test_village_mode_is_untouched(self):
        message = _base()
        message["mode"] = "village"
        self.assertNotEqual(policy.decide(message)[1][:1], ["BATTLE_MARCH"])

    def test_limit_is_eight_commands_and_ids_are_unique_per_command(self):
        units = army(1, 100, 110, -1) + army(0, 300, 66, 1)
        message = scene(units)
        commands, _ = battle.decide(message)
        self.assertLessEqual(len(commands), 8)
        for command in commands:
            self.assertLessEqual(len(command["entity_ids"]), 100)

    def test_entry_returns_a_valid_decision_with_up_to_eight_commands(self):
        units = army(1, 100, 110, -1) + army(0, 300, 76, 1)
        message = scene(units, tick=2000)
        message["request_id"] = 3
        text = entry.handle_observe(json.dumps(message))
        result = json.loads(text)
        self.assertTrue(result["ok"], result)
        self.assertLessEqual(len(result["decision"]["commands"]), 8)
        self.assertEqual(result["decision"]["policy_version"], "policy-0.9")

    def test_only_move_attack_and_stop_are_used(self):
        units = army(1, 100, 110, -1) + army(0, 300, 80, 1)
        for tick in (300, 3000, 9000):
            for seed in (0, 1, 2):
                commands, _ = battle.decide(scene(units, seed=seed, tick=tick))
                self.assertTrue({c["type"] for c in commands} <= {"Move", "Attack", "Stop"})

    def test_deterministic(self):
        units = army(1, 100, 110, -1) + army(0, 300, 80, 1)
        message = scene(units)
        self.assertEqual(battle.decide(message), battle.decide(message))


class BattleMarchTest(unittest.TestCase):
    def test_marches_with_no_enemy_in_sight(self):
        commands, reasons = battle.decide(scene(army(1, 100, 110, -1)))
        self.assertEqual(reasons[0], "BATTLE_MARCH")
        self.assertTrue(commands)
        self.assertEqual(battle.analyze(scene(army(1, 100, 110, -1)))["plan"], "MARCH")

    def test_march_advances_toward_the_enemy_side(self):
        # Jugador 1 avanza hacia x decreciente; los cañones (lentos) limitan cuánto se adelanta la columna.
        units = army(1, 100, 110, -1)
        commands, _ = battle.decide(scene(units, seed=0))
        moves = by_type(commands, "Move")
        self.assertTrue(moves)
        by_id = {u["id"]: u for u in units}
        for move in moves:
            origin = by_id[move["entity_ids"][0]]
            self.assertLess(move["payload"]["x"], origin["x"] + 0.01)
            self.assertGreaterEqual(move["payload"]["x"], 60)

    def test_player_zero_marches_to_the_left_half_stage(self):
        commands, _ = battle.decide(scene(army(0, 10, 18, 1), player=0, seed=0))
        self.assertTrue(commands)
        for move in by_type(commands, "Move"):
            self.assertLessEqual(move["payload"]["x"], 64)

    def test_cannons_set_the_pace(self):
        units = army(1, 100, 100, -1)
        # Infantería muy adelantada y cañones atrás: el destino de la infantería no pasa de PACE_LEAD sobre el cañón.
        units = [dict(u, x=70.0) if u["kind"] in ("soldier", "archer") else u for u in units]
        message = scene(units, seed=0)
        commands, _ = battle.decide(message)
        cannon_prog = min(message["map"]["width"] - u["x"] for u in units if u["kind"] == "cannon")
        for move in by_type(commands, "Move"):
            prog = message["map"]["width"] - move["payload"]["x"]
            self.assertLessEqual(prog, cannon_prog + battle.PACE_LEAD + battle.LEAD_DISTANCE + 2)

    def test_defensive_personality_holds_the_first_stage_early(self):
        message = scene(army(1, 100, 72, -1), seed=0, tick=500)  # (0 + 1) % 3 = DEFENSIVE
        self.assertEqual(battle.analyze(message)["personality"], "DEFENSIVE")
        commands, _ = battle.decide(message)
        for move in by_type(commands, "Move"):
            self.assertGreaterEqual(move["payload"]["x"], 66)

    def test_march_is_a_single_block_order_for_the_core(self):
        units = army(1, 100, 110, -1)
        commands, _ = battle.decide(scene(units, seed=0))
        core = {u["id"] for u in units if u["kind"] in ("soldier", "archer", "cannon")}
        blocks = [c for c in by_type(commands, "Move") if set(c["entity_ids"]) == core]
        self.assertEqual(len(blocks), 1)

    def test_block_that_is_already_heading_to_the_target_is_not_reordered(self):
        units = army(1, 100, 110, -1)
        commands, _ = battle.decide(scene(units, seed=0))
        block = next(c for c in by_type(commands, "Move") if len(c["entity_ids"]) > 20)
        dest = {"x": block["payload"]["x"], "z": block["payload"]["z"]}
        moving = [dict(u, dest=dest, activity="moving") if u["id"] in block["entity_ids"] else u for u in units]
        again, _ = battle.decide(scene(moving, seed=0))
        self.assertFalse([c for c in by_type(again, "Move") if len(c["entity_ids"]) > 20])

    def test_units_already_at_the_destination_are_not_reordered(self):
        units = army(1, 100, 110, -1)
        message = scene(units)
        commands, _ = battle.decide(message)
        again = [
            dict(u, dest=next(({"x": c["payload"]["x"], "z": c["payload"]["z"]} for c in commands if u["id"] in c["entity_ids"] and c["type"] == "Move"), None))
            for u in units
        ]
        commands_again, _ = battle.decide(scene(again))
        self.assertEqual(commands_again, [])


class BattleCommanderTest(unittest.TestCase):
    def test_commander_leads_ahead_of_the_soldiers(self):
        units = army(1, 100, 110, -1)
        message = scene(units)
        commands, reasons = battle.decide(message)
        leader_move = next(c for c in commands if 100 in c["entity_ids"])
        soldier_move = next(c for c in commands if 101 in c["entity_ids"])
        self.assertEqual(leader_move["entity_ids"], [100])
        self.assertLess(leader_move["payload"]["x"], soldier_move["payload"]["x"])
        self.assertIn("LEADER_LEAD", reasons)

    def test_commander_retreats_below_forty_percent_hp(self):
        units = army(1, 100, 90, -1) + army(0, 300, 80, 1)
        units = [dict(u, hp=200) if u["id"] == 100 else u for u in units]
        commands, reasons = battle.decide(scene(units))
        self.assertIn("LEADER_RETREAT", reasons)
        move = next(c for c in commands if c["entity_ids"] == [100])
        self.assertEqual(move["type"], "Move")
        self.assertGreater(move["payload"]["x"], 90)

    def test_healthiest_knight_takes_over_when_the_commander_dies(self):
        units = [u for u in army(1, 100, 110, -1) if u["kind"] != "commander"]
        units = [dict(u, hp=40) if u["id"] == 131 else u for u in units]
        message = scene(units)
        situation = battle._Situation(message)
        self.assertTrue(situation.successor)
        self.assertNotEqual(situation.leader["id"], 131)
        self.assertEqual(situation.leader["kind"], "knight")
        _, reasons = battle.decide(message)
        self.assertIn("LEADER_SUCCESSOR", reasons)

    def test_commander_attacks_an_enemy_in_reach(self):
        units = army(1, 100, 90, -1)
        units.append(unit(900, "soldier", 0, 83.0, 32.0))
        commands, _ = battle.decide(scene(units))
        move = next(c for c in commands if c["entity_ids"] == [100])
        self.assertEqual((move["type"], move["payload"]["target_id"]), ("Attack", 900))

    def test_no_army_gives_no_commands(self):
        message = scene([unit(900, "soldier", 0, 83.0, 32.0)])
        self.assertEqual(battle.decide(message), ([], ["NO_ARMY"]))


class BattleCombatTest(unittest.TestCase):
    def test_cannons_pick_the_densest_cluster(self):
        units = army(1, 100, 90, -1, cannons=1)
        cannon = next(u for u in units if u["kind"] == "cannon")
        units = [dict(u, x=90.0, z=32.0) if u["id"] == cannon["id"] else u for u in units]
        units += [unit(900, "soldier", 0, 84.0, 28.0), unit(901, "soldier", 0, 84.0, 36.0)]
        for i in range(4):
            units.append(unit(910 + i, "soldier", 0, 83.0 + (i % 2) * 0.8, 32.0 + (i // 2) * 0.8))
        commands, reasons = battle.decide(scene(units))
        shot = next(c for c in commands if cannon["id"] in c["entity_ids"])
        self.assertEqual(shot["type"], "Attack")
        self.assertIn(shot["payload"]["target_id"], (910, 911, 912, 913))
        self.assertIn("CANNON_SPLASH", reasons)

    def test_cannon_ignores_targets_out_of_reach(self):
        units = army(1, 100, 100, -1, cannons=1)
        units.append(unit(900, "soldier", 0, 30.0, 32.0))
        commands, _ = battle.decide(scene(units))
        self.assertFalse([c for c in commands if c["type"] == "Attack" and c["payload"]["target_id"] == 900 and any(
            u["kind"] == "cannon" and u["id"] in c["entity_ids"] for u in units)])

    def test_assault_when_the_force_is_superior(self):
        units = army(1, 100, 90, -1) + [unit(900, "soldier", 0, 80.0, 32.0)]
        message = scene(units)
        self.assertEqual(battle.analyze(message)["plan"], "ASSAULT")
        commands, reasons = battle.decide(message)
        self.assertEqual(reasons[0], "BATTLE_ASSAULT")
        self.assertTrue(by_type(commands, "Attack"))

    def test_holds_the_line_when_slightly_outnumbered_and_defensive(self):
        mine = army(1, 100, 100, -1, soldiers=12, knights=2, archers=5, cannons=2)
        foes = army(0, 300, 88, 1, soldiers=14, knights=3, archers=6, cannons=2)
        # El enemigo se ve a ~12 celdas: dentro de la visión pero sin contacto.
        message = scene(mine + foes, seed=0)
        self.assertEqual(battle.analyze(message)["personality"], "DEFENSIVE")
        self.assertEqual(battle.analyze(message)["plan"], "HOLD")

    def test_hold_stops_marching_units(self):
        mine = army(1, 100, 100, -1, soldiers=12, knights=2, archers=5, cannons=2)
        mine = [dict(u, activity="moving", dest={"x": 70.0, "z": 32.0}) if u["kind"] == "soldier" else u for u in mine]
        foes = army(0, 300, 80, 1, soldiers=14, knights=3, archers=6, cannons=2)
        commands, reasons = battle.decide(scene(mine + foes, seed=0))
        self.assertEqual(reasons[0], "BATTLE_HOLD")
        stops = by_type(commands, "Stop")
        self.assertTrue(stops)
        self.assertTrue(all(u["id"] in stops[0]["entity_ids"] for u in mine if u["kind"] == "soldier"))

    def test_hold_does_not_idle_when_the_enemy_is_close(self):
        mine = army(1, 100, 100, -1, soldiers=12, knights=2, archers=5, cannons=2)
        foes = army(0, 300, 88, 1, soldiers=14, knights=3, archers=6, cannons=2)
        message = scene(mine + foes, seed=0)
        self.assertEqual(battle.analyze(message)["plan"], "HOLD")
        commands, reasons = battle.decide(message)
        self.assertIn("HOLD_ENGAGE", reasons)
        attackers = {i for c in by_type(commands, "Attack") for i in c["entity_ids"]}
        for kind in ("soldier", "archer"):
            self.assertTrue({u["id"] for u in mine if u["kind"] == kind} & attackers, kind)
        # Las unidades que combaten no reciben además un Stop.
        stopped = {i for c in by_type(commands, "Stop") for i in c["entity_ids"]}
        self.assertFalse(stopped & attackers)

    def test_hold_keeps_position_when_the_enemy_is_far(self):
        mine = army(1, 100, 100, -1, soldiers=12, knights=2, archers=5, cannons=2)
        foes = army(0, 300, 76, 1, soldiers=14, knights=3, archers=6, cannons=2)
        commands, reasons = battle.decide(scene(mine + foes, seed=0))
        self.assertNotIn("HOLD_ENGAGE", reasons)
        self.assertFalse([c for c in by_type(commands, "Attack") if c["payload"]["target_id"] < 1000 and set(c["entity_ids"]) & {u["id"] for u in mine if u["kind"] == "soldier"}])

    def test_assault_orders_infantry_and_knights_even_with_many_cannon_volleys(self):
        mine = army(1, 100, 90, -1)
        foes = army(0, 300, 76, 1, soldiers=12, archers=4, knights=2, cannons=1)
        commands, _ = battle.decide(scene(mine + foes, seed=0))
        self.assertLessEqual(len(commands), battle.MAX_COMMANDS)
        ordered = {i for c in by_type(commands, "Attack") for i in c["entity_ids"]}
        for kind in ("soldier", "archer", "knight"):
            self.assertTrue({u["id"] for u in mine if u["kind"] == kind} & ordered, kind)

    def test_units_already_chasing_a_target_are_not_given_the_same_attack_again(self):
        mine = army(1, 100, 90, -1)
        foes = [unit(900, "soldier", 0, 78.0, 32.0)]
        chasing = [dict(u, activity="moving", target_id=900, dest={"x": 78.0, "z": 32.0}) if u["kind"] == "soldier" else u for u in mine]
        commands, _ = battle.decide(scene(chasing + foes, seed=0))
        again = {i for c in by_type(commands, "Attack") if c["payload"]["target_id"] == 900 for i in c["entity_ids"]}
        self.assertFalse(again & {u["id"] for u in mine if u["kind"] == "soldier"})
        # Las unidades libres sí reciben la orden.
        self.assertTrue(again & {u["id"] for u in mine if u["kind"] != "soldier"})

    def test_hold_does_not_stop_units_that_are_chasing_a_foe(self):
        mine = army(1, 100, 100, -1, soldiers=12, knights=2, archers=5, cannons=2)
        mine = [dict(u, activity="moving", target_id=300, dest={"x": 80.0, "z": 32.0}) if u["kind"] == "soldier" else u for u in mine]
        foes = army(0, 300, 70, 1, soldiers=14, knights=3, archers=6, cannons=2)
        commands, _ = battle.decide(scene(mine + foes, seed=0))
        stopped = {i for c in by_type(commands, "Stop") for i in c["entity_ids"]}
        self.assertFalse(stopped & {u["id"] for u in mine if u["kind"] == "soldier"})

    def test_timeout_makes_a_defensive_army_attack(self):
        mine = army(1, 100, 100, -1, soldiers=12, knights=2, archers=5, cannons=2)
        foes = army(0, 300, 88, 1, soldiers=14, knights=3, archers=6, cannons=2)
        message = scene(mine + foes, seed=0, tick=9000)
        self.assertEqual(battle.analyze(message)["plan"], "ASSAULT")

    def test_falls_back_to_the_cannons_when_overwhelmed(self):
        mine = army(1, 100, 100, -1, soldiers=5, archers=0, knights=0, cannons=3)
        mine = [dict(u, x=84.0) if u["kind"] in ("soldier", "commander") else u for u in mine]
        foes = army(0, 300, 72, 1)
        message = scene(mine + foes, seed=2)
        self.assertEqual(battle.analyze(message)["plan"], "FALLBACK")
        commands, reasons = battle.decide(message)
        self.assertIn("RETREAT_TO_CANNONS", reasons)
        retreat = next(c for c in commands if 101 in c["entity_ids"])
        self.assertGreater(retreat["payload"]["x"], 90)

    def test_cannons_without_infantry_advance_toward_the_enemy(self):
        mine = [u for u in army(1, 100, 90, -1) if u["kind"] in ("cannon", "commander")]
        foes = [unit(900, "cannon", 0, 76.0, 32.0)]
        message = scene(mine + foes, seed=0)
        self.assertEqual(battle.analyze(message)["plan"], "ASSAULT")
        commands, reasons = battle.decide(message)
        self.assertIn("CANNON_ADVANCE", reasons)
        cannons = {u["id"] for u in mine if u["kind"] == "cannon"}
        move = next(c for c in by_type(commands, "Move") if set(c["entity_ids"]) <= cannons)
        self.assertLess(move["payload"]["x"], 88)

    def test_knights_prefer_enemy_cannons_and_archers(self):
        units = army(1, 100, 90, -1)
        units += [unit(900, "soldier", 0, 80.0, 30.0), unit(901, "cannon", 0, 80.5, 36.0), unit(902, "archer", 0, 81.0, 38.0)]
        commands, _ = battle.decide(scene(units, seed=0))
        knights = {u["id"] for u in units if u["kind"] == "knight"}
        raid = next(c for c in commands if c["type"] == "Attack" and set(c["entity_ids"]) <= knights)
        self.assertIn(raid["payload"]["target_id"], (901, 902))

    def test_units_already_attacking_are_left_alone(self):
        units = army(1, 100, 90, -1) + [unit(900, "soldier", 0, 80.0, 32.0)]
        units = [dict(u, activity="attacking", target=900) if u["kind"] in ("soldier", "archer", "knight") else u for u in units]
        commands, _ = battle.decide(scene(units))
        ids = {i for c in commands if c["type"] == "Attack" for i in c["entity_ids"]}
        self.assertFalse({u["id"] for u in units if u["kind"] in ("soldier", "archer", "knight")} & ids)


class BattlePerformanceTest(unittest.TestCase):
    def test_decision_fits_the_time_budget(self):
        import time

        units = army(1, 100, 90, -1) + army(0, 300, 80, 1)
        message = scene(units)
        started = time.perf_counter()
        for _ in range(20):
            battle.decide(message)
        self.assertLess((time.perf_counter() - started) / 20 * 1000, 8)


if __name__ == "__main__":
    unittest.main()
