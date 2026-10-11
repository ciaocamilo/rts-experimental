import { DIRS, type Cell, type NavGrid } from "./grid";

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  private less(i: number, j: number): boolean {
    const a = this.keys[i]!;
    const b = this.keys[j]!;
    return a < b || (a === b && this.vals[i]! < this.vals[j]!);
  }

  private swap(i: number, j: number): void {
    [this.keys[i], this.keys[j]] = [this.keys[j]!, this.keys[i]!];
    [this.vals[i], this.vals[j]] = [this.vals[j]!, this.vals[i]!];
  }

  push(key: number, val: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.vals[0]!;
    const lastKey = this.keys.pop()!;
    const lastVal = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

function octile(dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  return ax + az + (Math.SQRT2 - 2) * Math.min(ax, az);
}

/** A* de ocho vecinos (costes 1 y √2, heurística octil). Devuelve celdas desde el siguiente paso hasta la meta, o null. */
export function findPath(grid: NavGrid, start: Cell, goal: Cell): Cell[] | null {
  if (grid.isBlocked(start.x, start.z) || grid.isBlocked(goal.x, goal.z)) return null;
  if (grid.componentAt(start.x, start.z) !== grid.componentAt(goal.x, goal.z)) return null;
  if (start.x === goal.x && start.z === goal.z) return [];

  const size = grid.width;
  const n = size * grid.depth;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();
  const s = start.z * size + start.x;
  const t = goal.z * size + goal.x;

  g[s] = 0;
  open.push(octile(goal.x - start.x, goal.z - start.z), s);

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === t) break;
    const cx = cur % size;
    const cz = (cur - cx) / size;
    for (const [dx, dz] of DIRS) {
      if (!grid.canStep(cx, cz, dx, dz)) continue;
      const nx = cx + dx;
      const nz = cz + dz;
      const idx = nz * size + nx;
      if (closed[idx]) continue;
      const cost = g[cur]! + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
      if (cost < g[idx]!) {
        g[idx] = cost;
        parent[idx] = cur;
        open.push(cost + octile(goal.x - nx, goal.z - nz), idx);
      }
    }
  }

  if (parent[t] === -1) return null;
  const cells: Cell[] = [];
  for (let cur = t; cur !== s; cur = parent[cur]!) {
    cells.push({ x: cur % size, z: Math.floor(cur / size) });
  }
  return cells.reverse();
}
