import { BALANCE } from "../content/balance";
import { visibleEnemies } from "../core/battle";
import type { VisionMap } from "../core/vision";
import type { GameState, TerrainRect } from "../core/types";

const GROUND = "#1f3b22";
const ROCK = "#7d7d7d";
const VALLEY = "#2f5b2c";
const CAMP = "#c9b887";
const COMMANDER_MARK = "#f1d27a";
const FOREST = "#0f2d17";
const WATER = "#2d6aa6";
const BRIDGE = "#8a5a2b";
const OWN = "#4aa8ff";
const RIVAL = "#e0483c";
const MIN_BUILDING_PX = 3;
const UNIT_PX = 2;

export interface MinimapHooks {
  /** Pide centrar la cámara en un punto del mapa (celdas). */
  centerOn(x: number, z: number): void;
}

/** Convierte un punto del lienzo en coordenadas de mapa; `null` solo si el lienzo no tiene tamaño. */
export function minimapPoint(px: number, py: number, rectW: number, rectH: number, mapWidth: number, mapDepth: number): { x: number; z: number } | null {
  if (rectW <= 0 || rectH <= 0) return null;
  return { x: Math.min(mapWidth, Math.max(0, (px / rectW) * mapWidth)), z: Math.min(mapDepth, Math.max(0, (py / rectH) * mapDepth)) };
}

/** Recorta un polígono al rectángulo [x0, x1] × [z0, z1] (Sutherland–Hodgman); el encuadre de cámara suele salirse del mapa. */
export function clipPolygon(polygon: readonly { x: number; z: number }[], x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] {
  type P = { x: number; z: number };
  const edges: { inside: (p: P) => boolean; cut: (a: P, b: P) => P }[] = [
    { inside: (p) => p.x >= x0, cut: (a, b) => ({ x: x0, z: a.z + ((b.z - a.z) * (x0 - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.x <= x1, cut: (a, b) => ({ x: x1, z: a.z + ((b.z - a.z) * (x1 - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.z >= z0, cut: (a, b) => ({ x: a.x + ((b.x - a.x) * (z0 - a.z)) / (b.z - a.z), z: z0 }) },
    { inside: (p) => p.z <= z1, cut: (a, b) => ({ x: a.x + ((b.x - a.x) * (z1 - a.z)) / (b.z - a.z), z: z1 }) },
  ];
  let out: P[] = [...polygon];
  for (const edge of edges) {
    const input = out;
    out = [];
    input.forEach((cur, i) => {
      const prev = input[(i + input.length - 1) % input.length]!;
      if (edge.inside(cur)) {
        if (!edge.inside(prev)) out.push(edge.cut(prev, cur));
        out.push(cur);
      } else if (edge.inside(prev)) out.push(edge.cut(prev, cur));
    });
    if (out.length === 0) break;
  }
  return out;
}

/**
 * Miniatura del mapa (P6-H04): capa estática en un lienzo fuera de pantalla (suelo, rocas, agua y puente),
 * capa dinámica cada cuadro (edificios, unidades y encuadre de la cámara) y centrado de cámara con el puntero.
 * La orientación es la del mapa: x a la derecha, z hacia abajo.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private terrain: readonly TerrainRect[] | null = null;
  private terrainCount = -1;
  private fogLayer: HTMLCanvasElement | null = null;
  private fogVersion = -1;
  private dragging = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mapWidth: number,
    private readonly mapDepth: number,
    hooks: MinimapHooks,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Miniatura: no hay contexto 2D");
    this.ctx = ctx;
    this.layer = document.createElement("canvas");
    this.layer.width = canvas.width;
    this.layer.height = canvas.height;

    const opts = { signal: this.abort.signal };
    const move = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const p = minimapPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height, this.mapWidth, this.mapDepth);
      if (p) hooks.centerOn(p.x, p.z);
    };
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        this.dragging = true;
        move(e);
      },
      opts,
    );
    canvas.addEventListener("pointermove", (e) => (this.dragging ? move(e) : undefined), opts);
    const end = (e: PointerEvent): void => {
      this.dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerup", end, opts);
    canvas.addEventListener("pointercancel", end, opts);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
  }

  dispose(): void {
    this.abort.abort();
  }

  /** Dibuja la miniatura; `footprint` son las esquinas de la vista de cámara sobre el suelo y `vision`, la niebla (solo en batalla). */
  draw(state: GameState, footprint: readonly { x: number; z: number }[], vision: VisionMap | null = null): void {
    if (this.terrain !== state.terrain || this.terrainCount !== state.terrain.length) this.buildStatic(state.terrain);
    const { ctx, canvas } = this;
    const sx = canvas.width / this.mapWidth;
    const sz = canvas.height / this.mapDepth;
    ctx.drawImage(this.layer, 0, 0);
    const fogged = vision !== null && state.mode === "battle" && state.matchStatus === "playing";
    if (fogged) this.drawFog(vision);

    for (const b of state.buildings) {
      const def = BALANCE.buildings[b.kind];
      const w = Math.max(MIN_BUILDING_PX, def.footprint * sx);
      const h = Math.max(MIN_BUILDING_PX, def.footprint * sz);
      const x = b.cell.x * sx;
      const z = b.cell.z * sz;
      const color = b.owner === 0 ? OWN : RIVAL;
      ctx.fillStyle = "#101010";
      ctx.fillRect(x, z, w, h);
      const done = b.complete ? 1 : Math.min(1, Math.max(0, b.buildDone / def.buildTicks));
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, z + 1 + (h - 2) * (1 - done), w - 2, (h - 2) * done);
      // Mismo criterio que las marcas de bando: contorno claro (jugador) u oscuro (rival).
      ctx.strokeStyle = b.owner === 0 ? "#ffffff" : "#300a0a";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, z + 0.5, w - 1, h - 1);
    }

    // En batalla el rival solo aparece mientras alguna unidad propia lo ve.
    const seen = state.mode === "battle" && state.matchStatus === "playing" ? new Set(visibleEnemies(state, 0).map((e) => e.id)) : null;
    for (const u of state.units) {
      if (seen && u.owner === 1 && !seen.has(u.id)) continue;
      ctx.fillStyle = u.owner === 0 ? OWN : RIVAL;
      const x = Math.round(u.pos.x * sx - UNIT_PX / 2);
      const z = Math.round(u.pos.z * sz - UNIT_PX / 2);
      ctx.fillRect(x, z, UNIT_PX, UNIT_PX);
      if (u.kind === "commander") {
        ctx.strokeStyle = COMMANDER_MARK;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 1.5, z - 1.5, UNIT_PX + 3, UNIT_PX + 3);
      }
    }

    const frame = clipPolygon(footprint, 0.5 / sx, 0.5 / sz, this.mapWidth - 0.5 / sx, this.mapDepth - 0.5 / sz);
    if (frame.length >= 3) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      frame.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * sx, p.z * sz) : ctx.lineTo(p.x * sx, p.z * sz)));
      ctx.closePath();
      ctx.stroke();
    }
  }

  /** Oscurece lo no visto con la misma niebla que el mapa; el lienzo auxiliar solo se rehace si la visión cambió. */
  private drawFog(vision: VisionMap): void {
    if (!this.fogLayer) {
      this.fogLayer = document.createElement("canvas");
      this.fogLayer.width = this.mapWidth;
      this.fogLayer.height = this.mapDepth;
    }
    if (this.fogVersion !== vision.version) {
      this.fogVersion = vision.version;
      const fctx = this.fogLayer.getContext("2d");
      if (fctx) {
        const image = fctx.createImageData(this.mapWidth, this.mapDepth);
        for (let z = 0; z < this.mapDepth; z++) {
          for (let x = 0; x < this.mapWidth; x++) {
            const o = (z * this.mapWidth + x) * 4;
            image.data[o] = 4;
            image.data[o + 1] = 6;
            image.data[o + 2] = 12;
            image.data[o + 3] = Math.round(vision.shadeAt(x + 0.5, z + 0.5) * 255);
          }
        }
        fctx.putImageData(image, 0, 0);
      }
    }
    this.ctx.drawImage(this.fogLayer, 0, 0, this.canvas.width, this.canvas.height);
  }

  private buildStatic(terrain: readonly TerrainRect[]): void {
    this.terrain = terrain;
    this.terrainCount = terrain.length;
    const ctx = this.layer.getContext("2d");
    if (!ctx) return;
    const sx = this.layer.width / this.mapWidth;
    const sz = this.layer.height / this.mapDepth;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, this.layer.width, this.layer.height);
    for (const kind of [undefined, "valley", "forest", "mountain", "water", "bridge", "camp"] as const) {
      ctx.fillStyle = kind === "water" ? WATER : kind === "bridge" ? BRIDGE : kind === "forest" ? FOREST : kind === "valley" ? VALLEY : kind === "camp" ? CAMP : ROCK;
      for (const t of terrain) if (t.kind === kind) ctx.fillRect(t.x * sx, t.z * sz, t.w * sx, t.h * sz);
    }
  }
}
