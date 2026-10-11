import json
import unittest
from pathlib import Path

from policy import contract, entry, policy

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "contracts" / "worker-v2" / "fixtures.json"


def _base():
    with open(FIXTURES, encoding="utf-8") as handle:
        case = next(c for c in json.load(handle)["cases"] if c["name"] == "observe completo")
    return case["message"]


def unit(uid, kind="villager", owner=1, x=50.0, z=33.0, activity="idle", target=None, carry=None, hp=40, defending=False):
    task = "moving" if activity == "moving" else "blocked" if activity == "blocked" else "idle"
    return {
        "id": uid, "owner": owner, "kind": kind, "x": x, "z": z, "hp": hp, "task": task, "activity": activity,
        "dest": None, "blocked_reason": "STUCK" if task == "blocked" else None, "carry": carry, "target_id": target,
        "defending": defending,
    }


def building(bid, kind, owner, cell_x, cell_z, complete=True, queue=None):
    return {
        "id": bid, "owner": owner, "kind": kind, "cell_x": cell_x, "cell_z": cell_z, "hp": 300,
        "complete": complete, "build_done": 0, "queue": queue or [],
    }


def scene(units=None, extra_buildings=None, food=0, wood=0, stone=0, pop=None, capacity=10, tick=200, tc_queue=None, stone_nodes=True):
    """Observación del jugador 1 (base en x=52) con nodos de comida (100-107), madera (200-207) y piedra (300-303)."""
    message = _base()
    units = units if units is not None else []
    message["observation_tick"] = tick
    message["units"] = units
    message["buildings"] = [
        building(1, "townCenter", 0, 8, 30),
        building(4, "townCenter", 1, 52, 30, queue=tc_queue),
        *(extra_buildings or []),
    ]
    message["resource_nodes"] = [
        *({"id": 100 + i, "kind": "food", "cell_x": 48, "cell_z": 22 + i, "remaining": 500} for i in range(8)),
        *({"id": 200 + i, "kind": "wood", "cell_x": 48, "cell_z": 35 + i, "remaining": 500} for i in range(8)),
        *({"id": 300 + i, "kind": "stone", "cell_x": 56, "cell_z": 44 + i, "remaining": 500} for i in range(4 if stone_nodes else 0)),
    ]
    mine = [u for u in units if u["owner"] == 1]
    message["players"] = [
        {"id": 0, "food": 200, "wood": 200, "stone": 0, "pop": 3, "pop_capacity": 10},
        {"id": 1, "food": food, "wood": wood, "stone": stone, "pop": len(mine) if pop is None else pop, "pop_capacity": capacity},
    ]
    message["previous_results"] = []
    return message


def villagers(count, start=10, **kwargs):
    return [unit(start + i, **kwargs) for i in range(count)]


def soldiers(count, start=50, kind="soldier", **kwargs):
    return [unit(start + i, kind=kind, hp=100, x=45.0, z=31.0 + i * 0.1, **kwargs) for i in range(count)]


def kinds(commands):
    return [c["type"] for c in commands]


class EconomyTest(unittest.TestCase):
    def test_idle_villagers_split_sixty_forty_between_food_and_wood(self):
        commands, reasons = policy.decide(scene(units=villagers(5)))
        self.assertEqual(reasons, ["GATHER"])
        by_node = {c["payload"]["target_id"]: c["entity_ids"] for c in commands}
        food = [ids for node, ids in by_node.items() if node < 200]
        wood = [ids for node, ids in by_node.items() if node >= 200]
        self.assertEqual((len(food[0]), len(wood[0])), (3, 2))

    def test_gatherers_already_working_are_left_alone(self):
        working = [unit(10 + i, activity="gathering", target=100) for i in range(3)] + [
            unit(20 + i, activity="delivering", target=200, carry={"kind": "wood", "amount": 5}) for i in range(2)
        ]
        self.assertEqual(policy.decide(scene(units=working)), ([], ["NOTHING_TO_DO"]))

    def test_new_idle_villager_goes_to_the_most_needed_kind(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(3)]
        units.append(unit(20))
        commands, _ = policy.decide(scene(units=units))
        node = commands[0]["payload"]["target_id"]
        self.assertGreaterEqual(node, 200)

    def test_gather_spreads_over_the_least_crowded_near_nodes(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(4)] + [unit(30)]
        commands, _ = policy.decide(scene(units=units))
        self.assertNotEqual(commands[0]["payload"]["target_id"], 100)

    def test_exhausted_nodes_are_not_targeted(self):
        message = scene(units=villagers(1))
        for node in message["resource_nodes"]:
            if node["kind"] == "food":
                node["remaining"] = 0
        commands, _ = policy.decide(message)
        self.assertTrue(all(c["payload"]["target_id"] >= 200 for c in commands))

    def test_trains_villagers_until_the_target_and_keeps_queue_short(self):
        working = [unit(10 + i, activity="gathering", target=100) for i in range(5)]
        commands, reasons = policy.decide(scene(units=working, food=100))
        self.assertEqual(kinds(commands), ["Train"])
        self.assertEqual(commands[0], {"type": "Train", "entity_ids": [4], "payload": {"unit_kind": "villager"}})
        self.assertEqual(reasons, ["TRAIN_VILLAGER"])

        busy = [{"id": 90 + i, "kind": "villager", "remaining": 100} for i in range(2)]
        self.assertEqual(policy.decide(scene(units=working, food=100, tc_queue=busy))[0], [])

        full = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        self.assertEqual(policy.decide(scene(units=full, food=500, capacity=50))[0], [])

    def test_does_not_train_without_food_or_population_room(self):
        working = [unit(10 + i, activity="gathering", target=100) for i in range(5)]
        self.assertEqual(policy.decide(scene(units=working, food=49))[0], [])
        self.assertEqual(kinds(policy.decide(scene(units=working, food=100, pop=10))[0]).count("Train"), 0)


class BuildingTest(unittest.TestCase):
    def free(self, message, command):
        payload = command["payload"]
        size = message["rules"]["footprint"][payload["building_kind"]]
        cx, cz = payload["cell_x"], payload["cell_z"]
        self.assertTrue(0 <= cx and 0 <= cz and cx + size <= message["map"]["width"] and cz + size <= message["map"]["depth"])
        taken = []
        for t in message["map"]["terrain"]:
            taken.append((t["x"], t["z"], t["w"], t["h"]))
        for b in message["buildings"]:
            s = message["rules"]["footprint"][b["kind"]]
            taken.append((b["cell_x"], b["cell_z"], s, s))
        for n in message["resource_nodes"]:
            taken.append((n["cell_x"], n["cell_z"], 1, 1))
        for x, z, w, h in taken:
            self.assertFalse(cx < x + w and x < cx + size and cz < z + h and z < cz + size, f"solapa {x},{z}")

    def test_builds_a_house_when_the_population_is_nearly_full(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(7)] + [unit(30)]
        message = scene(units=units, wood=60, pop=9, capacity=10)
        commands, reasons = policy.decide(message)
        self.assertEqual(reasons[0], "BUILD_HOUSE")
        build = commands[0]
        self.assertEqual((build["type"], build["entity_ids"], build["payload"]["building_kind"]), ("Build", [30], "house"))
        self.free(message, build)

    def test_house_uses_a_working_villager_when_nobody_is_idle(self):
        units = [unit(10 + i, activity="gathering", target=100, carry={"kind": "food", "amount": 3} if i == 0 else None) for i in range(8)]
        commands, _ = policy.decide(scene(units=units, wood=60, pop=9, capacity=10))
        self.assertEqual(commands[0]["entity_ids"], [11])

    def test_no_second_house_while_one_is_under_construction(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(7)] + [unit(30, activity="building", target=70)]
        site = building(70, "house", 1, 58, 20, complete=False)
        commands, _ = policy.decide(scene(units=units, extra_buildings=[site], wood=500, pop=9, capacity=10))
        self.assertNotIn("house", [c["payload"].get("building_kind") for c in commands])

    def test_no_house_at_the_population_cap_or_without_wood(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(8)]
        self.assertEqual(policy.decide(scene(units=units, wood=49, pop=9, capacity=10))[0], [])
        commands, _ = policy.decide(scene(units=units, wood=500, pop=49, capacity=50))
        self.assertNotIn("house", [c["payload"].get("building_kind") for c in commands])

    def test_builds_barracks_once_with_enough_wood_and_villagers(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(5)] + [unit(30)]
        message = scene(units=units, wood=150)
        commands, reasons = policy.decide(message)
        self.assertEqual(reasons[0], "BUILD_BARRACKS")
        self.assertEqual((commands[0]["entity_ids"], commands[0]["payload"]["building_kind"]), ([30], "barracks"))
        self.free(message, commands[0])

        site = building(70, "barracks", 1, 58, 20, complete=False)
        units[-1] = unit(30, activity="building", target=70)
        commands, _ = policy.decide(scene(units=units, extra_buildings=[site], wood=300))
        self.assertNotIn("barracks", [c["payload"].get("building_kind") for c in commands])

    def test_waits_for_enough_villagers_before_the_barracks(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(2)] + [unit(30)]
        commands, _ = policy.decide(scene(units=units, wood=200))
        self.assertNotIn("Build", kinds(commands))

    def test_house_and_barracks_in_one_batch_use_distinct_builders_and_cells(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(6)] + [unit(30), unit(31)]
        message = scene(units=units, wood=200, pop=9, capacity=10)
        commands, _ = policy.decide(message)
        builds = [c for c in commands if c["type"] == "Build"]
        self.assertEqual(len(builds), 2)
        self.assertEqual(sorted(c["entity_ids"][0] for c in builds), [30, 31])
        a, b = builds[0]["payload"], builds[1]["payload"]
        self.assertNotEqual((a["cell_x"], a["cell_z"]), (b["cell_x"], b["cell_z"]))
        for command in builds:
            self.free(message, command)

    def test_resumes_an_abandoned_site(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(4)] + [unit(30)]
        site = building(70, "house", 1, 58, 20, complete=False)
        commands, reasons = policy.decide(scene(units=units, extra_buildings=[site]))
        self.assertEqual(reasons[0], "RESUME_BUILD")
        self.assertEqual(commands[0], {"type": "ResumeBuild", "entity_ids": [30], "payload": {"target_id": 70}})

    def test_placement_rotates_with_the_tick_and_is_deterministic(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(7)] + [unit(30)]
        cells = set()
        for tick in (200, 220, 240, 260):
            message = scene(units=units, wood=60, pop=9, capacity=10, tick=tick)
            first = policy.decide(message)
            self.assertEqual(first, policy.decide(message))
            cells.add((first[0][0]["payload"]["cell_x"], first[0][0]["payload"]["cell_z"]))
        self.assertGreater(len(cells), 1)


class MilitaryTest(unittest.TestCase):
    def barracks(self, queue=None, complete=True):
        return building(60, "barracks", 1, 44, 14, complete=complete, queue=queue)

    def test_trains_soldiers_and_archers_two_to_one(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        order = []
        army = []
        for i in range(6):
            message = scene(units=base + army, extra_buildings=[self.barracks()], food=500, wood=500, capacity=50, pop=12 + len(army))
            commands, reasons = policy.decide(message)
            self.assertEqual(reasons, ["TRAIN_MILITARY"])
            kind = commands[0]["payload"]["unit_kind"]
            order.append(kind)
            army.append(unit(100 + i, kind=kind, hp=100, x=45.0, z=31.0 + i, activity="idle"))
        self.assertEqual(order, ["soldier", "soldier", "archer", "soldier", "soldier", "archer"])

    def test_queued_units_count_for_the_ratio(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        queue = [{"id": 90, "kind": "soldier", "remaining": 100}, {"id": 91, "kind": "soldier", "remaining": 200}]
        message = scene(units=base, extra_buildings=[self.barracks(queue=queue)], food=500, wood=500, capacity=50, pop=14)
        self.assertEqual(policy.decide(message)[0], [])
        queue = [{"id": 90, "kind": "soldier", "remaining": 100}]
        message = scene(units=base, extra_buildings=[self.barracks(queue=queue)], food=500, wood=500, capacity=50, pop=13)
        self.assertEqual(policy.decide(message)[0][0]["payload"]["unit_kind"], "soldier")

    def test_does_not_train_what_it_cannot_afford(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        message = scene(units=base, extra_buildings=[self.barracks()], food=59, wood=500, capacity=50)
        self.assertEqual(policy.decide(message)[0], [])

    def test_incomplete_barracks_does_not_train(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        message = scene(units=base, extra_buildings=[self.barracks(complete=False)], food=500, wood=500, capacity=50)
        self.assertNotIn("Train", kinds(policy.decide(message)[0]))

    def test_expedition_waits_for_eight_military_then_attacks_the_enemy_center(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        self.assertEqual(policy.decide(scene(units=base + soldiers(7)))[0], [])
        commands, reasons = policy.decide(scene(units=base + soldiers(8)))
        self.assertEqual(reasons, ["ATTACK"])
        self.assertEqual(commands, [{"type": "Attack", "entity_ids": list(range(50, 58)), "payload": {"target_id": 1}}])

    def test_expedition_does_not_repeat_orders_for_units_already_attacking(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        army = soldiers(8)
        for u in army[:5]:
            u.update(activity="attacking", target_id=1)
        commands, _ = policy.decide(scene(units=base + army))
        self.assertEqual(commands[0]["entity_ids"], [55, 56, 57])
        for u in army[5:]:
            u.update(activity="moving", target_id=1)
        self.assertEqual(policy.decide(scene(units=base + army))[0], [])

    def test_expedition_prefers_enemy_military_close_to_the_group(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        foe = unit(300, kind="soldier", owner=0, x=39.0, z=31.0, hp=100)
        commands, _ = policy.decide(scene(units=base + soldiers(8) + [foe]))
        self.assertEqual(commands[0]["payload"]["target_id"], 300)

    def test_defends_the_base_with_any_military_and_skips_the_expedition(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        raider = unit(300, kind="archer", owner=0, x=47.0, z=31.0, hp=60)
        far = unit(301, kind="soldier", owner=0, x=30.0, z=10.0, hp=100)
        army = soldiers(3)
        commands, reasons = policy.decide(scene(units=base + army + [raider, far]))
        self.assertEqual(reasons, ["DEFEND"])
        self.assertEqual(commands, [{"type": "Attack", "entity_ids": [50, 51, 52], "payload": {"target_id": 300}}])

        army = soldiers(8)
        commands, reasons = policy.decide(scene(units=base + army + [raider]))
        self.assertEqual(reasons, ["DEFEND"])
        self.assertEqual(commands[0]["payload"]["target_id"], 300)

    def test_enemy_villagers_near_the_base_are_not_a_threat(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        scout = unit(300, kind="villager", owner=0, x=47.0, z=31.0)
        self.assertEqual(policy.decide(scene(units=base + soldiers(3) + [scout]))[0], [])


class StoneAndTowerTest(unittest.TestCase):
    def workers(self, count=8):
        return [unit(10 + i, activity="gathering", target=100) for i in range(count)]

    def test_version_is_policy_0_3(self):
        self.assertEqual(policy.VERSION, "policy-0.3")

    def test_sends_two_idle_villagers_to_stone_when_a_tower_is_missing(self):
        units = [unit(10 + i, activity="gathering", target=100) for i in range(4)]
        units += [unit(20 + i, activity="gathering", target=200) for i in range(2)] + [unit(30), unit(31)]
        commands, reasons = policy.decide(scene(units=units))
        self.assertEqual(reasons, ["GATHER"])
        stone = [c for c in commands if 300 <= c["payload"]["target_id"] < 400]
        self.assertEqual(len(stone), 1)
        self.assertEqual(sorted(stone[0]["entity_ids"]), [30, 31])

    def test_no_stone_gathering_before_the_economy_is_ready(self):
        units = self.workers(3) + [unit(30)]
        commands, _ = policy.decide(scene(units=units))
        self.assertTrue(all(c["payload"]["target_id"] < 300 for c in commands))

    def test_no_stone_gathering_once_the_tower_is_affordable(self):
        units = self.workers(6) + [unit(30), unit(31)]
        commands, _ = policy.decide(scene(units=units, stone=300))
        self.assertTrue(all(c["type"] != "Gather" or c["payload"]["target_id"] < 300 for c in commands))

    def test_builds_a_tower_with_exactly_the_stone_cost(self):
        units = self.workers(7) + [unit(30)]
        message = scene(units=units, stone=300)
        commands, reasons = policy.decide(message)
        self.assertIn("BUILD_TOWER", reasons)
        build = next(c for c in commands if c["type"] == "Build")
        self.assertEqual((build["entity_ids"], build["payload"]["building_kind"]), ([30], "tower"))
        self.assertEqual(message["rules"]["building_cost"]["tower"]["stone"], 300)

    def test_does_not_build_a_tower_without_enough_stone(self):
        units = self.workers(7) + [unit(30)]
        commands, _ = policy.decide(scene(units=units, stone=299))
        self.assertNotIn("tower", [c["payload"].get("building_kind") for c in commands])

    def test_tower_goes_towards_the_enemy_side_of_the_base(self):
        units = self.workers(7) + [unit(30)]
        message = scene(units=units, stone=300)
        build = next(c for c in policy.decide(message)[0] if c["type"] == "Build")
        # Base del jugador 1 en x=52 (lado derecho): el enemigo queda a la izquierda.
        self.assertLessEqual(build["payload"]["cell_x"] + 1, 53)

    def test_no_second_tower_while_one_is_under_construction_and_a_limit_applies(self):
        units = self.workers(7) + [unit(30, activity="building", target=70)]
        site = building(70, "tower", 1, 46, 30, complete=False)
        commands, _ = policy.decide(scene(units=units, extra_buildings=[site], stone=300))
        self.assertNotIn("tower", [c["payload"].get("building_kind") for c in commands])
        done = [building(70 + i, "tower", 1, 46, 26 + 4 * i) for i in range(2)]
        commands, _ = policy.decide(scene(units=self.workers(7) + [unit(30)], extra_buildings=done, stone=300))
        self.assertNotIn("tower", [c["payload"].get("building_kind") for c in commands])

    def test_unreachable_nodes_are_not_targeted(self):
        message = scene(units=[unit(30)] + self.workers(7), stone_nodes=False)
        message["resource_nodes"] = [n for n in message["resource_nodes"] if n["kind"] != "wood"]
        walled = {"id": 400, "kind": "wood", "cell_x": 20, "cell_z": 10, "remaining": 500}
        open_node = {"id": 401, "kind": "wood", "cell_x": 40, "cell_z": 40, "remaining": 500}
        message["resource_nodes"] += [walled, open_node]
        ring = [(19, 9, 3, 1), (19, 11, 3, 1), (19, 10, 1, 1), (21, 10, 1, 1)]
        message["map"]["terrain"] = message["map"]["terrain"] + [{"x": x, "z": z, "w": w, "h": h} for x, z, w, h in ring]
        commands, _ = policy.decide(message)
        wood = [c["payload"]["target_id"] for c in commands if c["type"] == "Gather" and c["payload"]["target_id"] >= 400]
        self.assertEqual(wood, [401])

    def test_military_that_defends_itself_is_not_pulled_into_the_expedition(self):
        base = [unit(10 + i, activity="gathering", target=100) for i in range(12)]
        army = soldiers(8)
        for u in army[:3]:
            u.update(activity="attacking", target_id=999, defending=True)
        self.assertEqual(policy.decide(scene(units=base + army))[0], [])
        army[0].update(defending=False)
        self.assertEqual(policy.decide(scene(units=base + army))[0], [])


class BatchTest(unittest.TestCase):
    def random_scenes(self):
        import random

        rng = random.Random(7)
        for _ in range(60):
            count = rng.randint(1, 14)
            units = [
                unit(10 + i, activity=rng.choice(["idle", "gathering", "moving", "blocked", "delivering"]),
                     target=rng.choice([None, 100, 200]), carry=None)
                for i in range(count)
            ]
            units += soldiers(rng.randint(0, 10), kind=rng.choice(["soldier", "archer"]))
            extra = []
            if rng.random() < 0.7:
                extra.append(building(60, "barracks", 1, 44, 14, complete=rng.random() < 0.7,
                                      queue=[{"id": 90, "kind": "soldier", "remaining": 50}] if rng.random() < 0.3 else None))
            yield scene(
                units=units, extra_buildings=extra, food=rng.randint(0, 400), wood=rng.randint(0, 400),
                pop=len(units), capacity=max(len(units), rng.choice([10, 15, 20, 50])), tick=rng.randint(0, 5000),
            )

    def test_never_exceeds_four_commands_or_the_available_resources(self):
        for message in self.random_scenes():
            commands, reasons = policy.decide(message)
            self.assertLessEqual(len(commands), 4)
            self.assertLessEqual(len(reasons), 8)
            me = message["players"][1]
            rules = message["rules"]
            food = wood = pop = 0
            for c in commands:
                if c["type"] == "Train":
                    cost = rules["unit_cost"][c["payload"]["unit_kind"]]
                    food, wood, pop = food + cost["food"], wood + cost["wood"], pop + 1
                elif c["type"] == "Build":
                    cost = rules["building_cost"][c["payload"]["building_kind"]]
                    food, wood = food + cost["food"], wood + cost["wood"]
            self.assertLessEqual(food, me["food"])
            self.assertLessEqual(wood, me["wood"])
            self.assertLessEqual(me["pop"] + pop, me["pop_capacity"])

    def test_every_decision_is_a_valid_contract_message_and_deterministic(self):
        for message in self.random_scenes():
            raw = json.dumps(message)
            first = entry.handle_observe(raw)
            self.assertEqual(first, entry.handle_observe(raw))
            outcome = json.loads(first)
            self.assertTrue(outcome["ok"], outcome)
            decision = dict(outcome["decision"], metrics={"policy_ms": 0.0, "convert_ms": 0.0})
            self.assertEqual(contract.validate_message(decision), (None, ""))

    def test_observation_is_not_mutated(self):
        message = scene(units=villagers(6) + soldiers(8), wood=300, food=300, pop=14)
        before = json.dumps(message)
        policy.decide(message)
        self.assertEqual(json.dumps(message), before)

    def test_player_zero_mirrors_the_logic(self):
        message = scene(units=villagers(3))
        message["player_id"] = 0
        message["players"][0].update(food=0, wood=0, pop=3, pop_capacity=10)
        for u in message["units"]:
            u["owner"] = 0
        commands, reasons = policy.decide(message)
        self.assertEqual(reasons, ["GATHER"])
        self.assertEqual(sorted(i for c in commands for i in c["entity_ids"]), [10, 11, 12])


if __name__ == "__main__":
    unittest.main()
