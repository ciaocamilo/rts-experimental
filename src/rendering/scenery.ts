export interface SceneryRect {
  x: number;
  z: number;
  w: number;
  h: number;
  kind?: "water" | "bridge";
}

export interface TreeSpec {
  x: number;
  y: number;
  z: number;
  variant: 0 | 1 | 2;
  scale: number;
  rot: number;
  /** Variación de tono 0..1. */
  tone: number;
}

export interface BushSpec {
  x: number;
  y: number;
  z: number;
  variant: 0 | 1;
  scale: number;
  rot: number;
  tone: number;
}

export interface SceneryPlan {
  trees: TreeSpec[];
  bushes: BushSpec[];
}

/** Altura visual de los bloques de roca; los árboles decorativos crecen sobre ellos. */
export const ROCK_HEIGHT = 1.2;

/** Generador determinista y propio: la decoración nunca consume la aleatoriedad de la lógica. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Vegetación puramente decorativa: solo sobre celdas ya bloqueadas (roca). Nunca produce troncos sobre celdas
 * transitables, agua, puente ni fuera del mapa (P2-H06 CA06, P6-H07).
 */
export function planScenery(_width: number, _depth: number, terrain: readonly SceneryRect[], seed = 1337, density = 1): SceneryPlan {
  const rng = mulberry32(seed);
  const trees: TreeSpec[] = [];
  const bushes: BushSpec[] = [];
  const variant3 = (): 0 | 1 | 2 => Math.min(2, Math.floor(rng() * 3)) as 0 | 1 | 2;

  for (const t of terrain) {
    if (t.kind === "water" || t.kind === "bridge") continue;
    for (let i = 0; i < t.w; i++) {
      for (let j = 0; j < t.h; j++) {
        const r = rng();
        const x = t.x + i + 0.25 + rng() * 0.5;
        const z = t.z + j + 0.25 + rng() * 0.5;
        if (r < 0.5 * density) {
          trees.push({ x, y: ROCK_HEIGHT, z, variant: variant3(), scale: 0.8 + rng() * 0.5, rot: rng() * Math.PI * 2, tone: rng() });
        } else if (r < 0.62 * density) {
          bushes.push({ x, y: ROCK_HEIGHT, z, variant: rng() < 0.5 ? 0 : 1, scale: 0.7 + rng() * 0.5, rot: rng() * Math.PI * 2, tone: rng() });
        }
      }
    }
  }

  return { trees, bushes };
}
