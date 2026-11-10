import { BALANCE, TICKS_PER_SECOND, type ArtilleryDef } from "../content/balance";
import { buildingRect, distanceToRect } from "./spatial";
import type { GameState, ImpactEvent, Projectile, Unit, Vec2 } from "./types";

/** Ticks de vuelo de una bala: proporcionales a la distancia y acotados por el arma. */
export function flightTicksFor(def: ArtilleryDef, distance: number): number {
  const ticks = Math.ceil(distance / (def.shotSpeedCellsPerSec / TICKS_PER_SECOND));
  return Math.min(def.maxFlightTicks, Math.max(def.minFlightTicks, ticks));
}

/** Fracción del daño a una distancia `d` del impacto (borde del objetivo): 1 en el centro, `edgeDamageRatio` en el borde, 0 fuera. */
export function splashFactor(def: ArtilleryDef, d: number): number {
  if (d > def.splashRadius) return 0;
  return 1 - (1 - def.edgeDamageRatio) * (d / def.splashRadius);
}

/** Daño entero de área; nunca menos de 1 dentro del radio. */
export function splashDamage(damage: number, def: ArtilleryDef, d: number, building: boolean): number {
  const factor = splashFactor(def, d);
  if (factor <= 0) return 0;
  return Math.max(1, Math.round(damage * factor * (building ? def.buildingMultiplier : 1)));
}

/** Crea la bala de un disparo de cañón en el estado. El impacto queda fijado en `to`. */
export function launchProjectile(state: GameState, attacker: Unit, to: Vec2): Projectile {
  const def = BALANCE.units[attacker.kind].artillery!;
  const from = { x: attacker.pos.x, z: attacker.pos.z };
  const launchTick = state.tick + 1;
  const projectile: Projectile = {
    id: state.nextEntityId++,
    owner: attacker.owner,
    attackerId: attacker.id,
    from,
    to: { x: to.x, z: to.z },
    launchTick,
    impactTick: launchTick + flightTicksFor(def, Math.hypot(to.x - from.x, to.z - from.z)),
  };
  state.projectiles.push(projectile);
  return projectile;
}

/**
 * Resuelve las balas que caen en este tick (orden por id): daño de área a unidades y edificios enemigos, sin fuego amigo.
 * Se calcula todo sobre el estado previo y se aplica al final, de modo que el orden de las entidades no influye.
 */
export function resolveProjectiles(state: GameState): ImpactEvent[] {
  const tick = state.tick + 1;
  const due = state.projectiles.filter((p) => p.impactTick <= tick).sort((a, b) => a.id - b.id);
  if (due.length === 0) return [];
  state.projectiles = state.projectiles.filter((p) => p.impactTick > tick);

  const events: ImpactEvent[] = [];
  for (const shot of due) {
    const shooter = state.units.find((u) => u.id === shot.attackerId);
    const def = BALANCE.units[shooter?.kind ?? "cannon"].artillery ?? BALANCE.units.cannon.artillery!;
    const damage = BALANCE.units.cannon.damage;
    const hits: ImpactEvent["hits"] = [];

    for (const unit of state.units) {
      if (unit.owner === shot.owner || unit.hp <= 0) continue;
      const d = Math.max(0, Math.hypot(unit.pos.x - shot.to.x, unit.pos.z - shot.to.z) - BALANCE.units[unit.kind].radius);
      const dealt = splashDamage(damage, def, d, false);
      if (dealt <= 0) continue;
      unit.hp = Math.max(0, unit.hp - dealt);
      hits.push({ id: unit.id, kind: "unit", killed: unit.hp <= 0, damage: dealt });
      if (unit.hp > 0 && BALANCE.units[unit.kind].damage > 0 && shooter && shooter.hp > 0) {
        unit.threat = { attackerId: shooter.id, tick };
      }
    }
    for (const building of state.buildings) {
      if (building.owner === shot.owner || building.hp <= 0) continue;
      const dealt = splashDamage(damage, def, distanceToRect(shot.to, buildingRect(building)), true);
      if (dealt <= 0) continue;
      building.hp = Math.max(0, building.hp - dealt);
      hits.push({ id: building.id, kind: "building", killed: building.hp <= 0, damage: dealt });
    }
    events.push({ tick, attackerId: shot.attackerId, attackerOwner: shot.owner, at: { ...shot.to }, from: { ...shot.from }, hits });
  }
  return events;
}
