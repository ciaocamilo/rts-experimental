export interface Cell {
  readonly x: number;
  readonly z: number;
}

export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Cuadrícula lógica de transitabilidad. Fuera del mapa cuenta como bloqueado. */
export class NavGrid {
  readonly blocked: Uint8Array;
  readonly component: Int32Array;

  constructor(readonly width: number, readonly depth: number = width) {
    this.blocked = new Uint8Array(width * depth);
    this.component = new Int32Array(width * depth).fill(-1);
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  isBlocked(x: number, z: number): boolean {
    return !this.inBounds(x, z) || this.blocked[z * this.width + x] === 1;
  }

  blockRect(x: number, z: number, w: number, h: number = w): void {
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        if (this.inBounds(x + i, z + j)) this.blocked[(z + j) * this.width + x + i] = 1;
      }
    }
  }

  /** Paso permitido: destino libre y, en diagonales, sin cortar esquinas bloqueadas. */
  canStep(x: number, z: number, dx: number, dz: number): boolean {
    if (this.isBlocked(x + dx, z + dz)) return false;
    if (dx !== 0 && dz !== 0 && (this.isBlocked(x + dx, z) || this.isBlocked(x, z + dz))) return false;
    return true;
  }

  componentAt(x: number, z: number): number {
    return this.inBounds(x, z) ? this.component[z * this.width + x]! : -1;
  }

  /** Etiqueta regiones conectadas con las mismas reglas de movimiento que A*. */
  label(): void {
    const n = this.width * this.depth;
    this.component.fill(-1);
    const queue = new Int32Array(n);
    let next = 0;
    for (let start = 0; start < n; start++) {
      if (this.blocked[start] === 1 || this.component[start]! >= 0) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      this.component[start] = next;
      while (head < tail) {
        const cur = queue[head++]!;
        const cx = cur % this.width;
        const cz = (cur - cx) / this.width;
        for (const [dx, dz] of DIRS) {
          if (!this.canStep(cx, cz, dx, dz)) continue;
          const idx = (cz + dz) * this.width + cx + dx;
          if (this.component[idx]! >= 0) continue;
          this.component[idx] = next;
          queue[tail++] = idx;
        }
      }
      next++;
    }
  }

  /** Celda libre más cercana (distancia euclídea al centro, desempate z, x). */
  nearestFree(x: number, z: number): Cell | null {
    let best: Cell | null = null;
    let bestD = Infinity;
    for (let radius = 0; radius < Math.max(this.width, this.depth); radius++) {
      if (best && radius > Math.sqrt(bestD) + 1) break;
      for (let cz = z - radius; cz <= z + radius; cz++) {
        for (let cx = x - radius; cx <= x + radius; cx++) {
          if (Math.max(Math.abs(cx - x), Math.abs(cz - z)) !== radius) continue;
          if (this.isBlocked(cx, cz)) continue;
          const d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: cx, z: cz };
          }
        }
      }
    }
    return best;
  }
}
