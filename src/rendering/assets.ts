import * as THREE from "three";
import { mulberry32 } from "./scenery";

export type Quality = "high" | "low";

/** Registro de procedencia (P2 §2.2): no se incorpora ningún archivo externo, todo se genera por código. */
export const ASSET_PROVENANCE: readonly { id: string; author: string; origin: string; license: string; attribution: string; modifications: string }[] = [
  "grass",
  "tone-patches",
  "water",
  "water-ripple",
  "bark",
  "leaf",
  "stone",
  "plaster",
  "planks",
  "roof-tile",
  "roof-slate",
].map((id) => ({
  id: `texture:${id}`,
  author: "Proyecto RTS (Camilo Andrés Castañeda Galindo)",
  origin: "src/rendering/assets.ts: textura 2D procedural con semilla fija, sin archivos descargados",
  license: "Propia del proyecto",
  attribution: "No requerida",
  modifications: "Ninguna; generada en tiempo de carga",
}));

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number = w): { el: HTMLCanvasElement; ctx: Ctx } {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  return { el, ctx };
}

/** Ejecuta `draw` también desplazado para que lo dibujado cerca de un borde case al repetir la textura. */
function wrapped(size: number, x: number, y: number, reach: number, draw: (dx: number, dy: number) => void): void {
  const xs = [0, ...(x < reach ? [size] : []), ...(x > size - reach ? [-size] : [])];
  const ys = [0, ...(y < reach ? [size] : []), ...(y > size - reach ? [-size] : [])];
  for (const dx of xs) for (const dy of ys) draw(dx, dy);
}

function makeTexture(el: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function grassTexture(rng: () => number): HTMLCanvasElement {
  const size = 512;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = "#4b7d3a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 25 + rng() * 55;
    const light = rng() < 0.5;
    wrapped(size, x, y, r, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, light ? "rgba(150,190,80,0.22)" : "rgba(25,60,25,0.22)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  const palette = ["#3c6b2f", "#548a3f", "#66a047", "#2f5a28", "#7aa94f", "#5f8f3a"];
  ctx.lineCap = "round";
  for (let i = 0; i < 4200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 4 + rng() * 7;
    const ang = -Math.PI / 2 + (rng() - 0.5) * 0.9;
    ctx.strokeStyle = palette[Math.floor(rng() * palette.length)]!;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1 + rng() * 1.2;
    wrapped(size, x, y, len, (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + Math.cos(ang) * len, y + dy + Math.sin(ang) * len);
      ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
  return el;
}

function tonePatches(rng: () => number): HTMLCanvasElement {
  const { el, ctx } = canvas(1024, 512);
  const tones = ["rgba(20,55,25,0.20)", "rgba(190,215,100,0.17)", "rgba(120,100,50,0.12)", "rgba(40,90,40,0.18)"];
  for (let i = 0; i < 220; i++) {
    const x = rng() * 1024;
    const y = rng() * 512;
    const r = 25 + rng() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, tones[Math.floor(rng() * tones.length)]!);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return el;
}

/** Agua: profundidad con manchas amplias, ondas de varias escalas y destellos; casa al repetirse. */
function waterTexture(rng: () => number): HTMLCanvasElement {
  const size = 512;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = "#2c79a8";
  ctx.fillRect(0, 0, size, size);
  const blobs = (count: number, rMin: number, rMax: number, tones: readonly string[]): void => {
    for (let i = 0; i < count; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = rMin + rng() * (rMax - rMin);
      const tone = tones[Math.floor(rng() * tones.length)]!;
      wrapped(size, x, y, r, (dx, dy) => {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, tone);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      });
    }
  };
  blobs(26, 70, 150, ["rgba(10,60,100,0.30)", "rgba(90,170,200,0.22)"]);
  blobs(70, 25, 60, ["rgba(10,55,95,0.20)", "rgba(130,200,225,0.18)"]);
  ctx.lineCap = "round";
  for (let band = 0; band < 26; band++) {
    const y0 = 14 + (band / 26) * (size - 28) + rng() * 8;
    const phase = rng() * Math.PI * 2;
    const periods = 2 + Math.floor(rng() * 4);
    const amp = 2 + rng() * 5;
    const light = band % 3 !== 0;
    ctx.strokeStyle = light ? "rgba(200,236,248,0.26)" : "rgba(10,60,100,0.28)";
    ctx.lineWidth = 1.2 + rng() * 2.4;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 4) {
      const y = y0 + Math.sin((x / size) * Math.PI * 2 * periods + phase) * amp + Math.sin((x / size) * Math.PI * 2 * (periods * 3) + phase * 2) * 1.2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 2 + rng() * 4;
    wrapped(size, x, y, r * 2, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r * 2);
      g.addColorStop(0, "rgba(255,255,255,0.75)");
      g.addColorStop(0.4, "rgba(220,245,255,0.25)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r * 2, y + dy - r * 2, r * 4, r * 4);
    });
  }
  return el;
}

/** Capa translúcida de ondas finas que se desplaza en otra dirección sobre el agua (solo calidad alta). */
function rippleTexture(rng: () => number): HTMLCanvasElement {
  const size = 256;
  const { el, ctx } = canvas(size);
  ctx.lineCap = "round";
  for (let i = 0; i < 46; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 14 + rng() * 34;
    const bend = (rng() - 0.5) * 10;
    ctx.strokeStyle = `rgba(235,250,255,${0.18 + rng() * 0.3})`;
    ctx.lineWidth = 0.8 + rng() * 1.4;
    wrapped(size, x, y, len, (dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx - len / 2, y + dy);
      ctx.quadraticCurveTo(x + dx, y + dy + bend, x + dx + len / 2, y + dy);
      ctx.stroke();
    });
  }
  return el;
}

function barkTexture(rng: () => number, base: string): HTMLCanvasElement {
  const size = 128;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x = rng() * size;
    ctx.strokeStyle = rng() < 0.5 ? "rgba(20,10,5,0.45)" : "rgba(200,160,110,0.25)";
    ctx.lineWidth = 1 + rng() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (rng() - 0.5) * 8, size * 0.33, x + (rng() - 0.5) * 8, size * 0.66, x, size);
    ctx.stroke();
  }
  return el;
}

function leafTexture(rng: () => number): HTMLCanvasElement {
  const size = 128;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const shade = 150 + Math.floor(rng() * 105);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    const radius = 3 + rng() * 5;
    wrapped(size, x, y, 8, (dx, dy) => {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return el;
}

function stoneTexture(rng: () => number): HTMLCanvasElement {
  const size = 256;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = "#58595b";
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 4;
    const w = size / cols;
    const off = r % 2 ? w / 2 : 0;
    for (let c = -1; c < cols; c++) {
      const v = 120 + Math.floor(rng() * 70);
      ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      ctx.fillRect(c * w + off + 2, r * h + 2, w - 4, h - 4);
    }
  }
  return el;
}

function plasterTexture(rng: () => number): HTMLCanvasElement {
  const size = 128;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = "#e7dcc2";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    const v = 170 + Math.floor(rng() * 70);
    ctx.fillStyle = `rgba(${v},${v - 12},${v - 40},0.35)`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 1 + rng() * 3);
  }
  return el;
}

function planksTexture(rng: () => number): HTMLCanvasElement {
  const size = 128;
  const { el, ctx } = canvas(size);
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    const v = 90 + Math.floor(rng() * 40);
    ctx.fillStyle = `rgb(${v + 30},${v},${v - 40})`;
    ctx.fillRect(0, (r * size) / rows, size, size / rows);
    ctx.fillStyle = "rgba(30,15,5,0.6)";
    ctx.fillRect(0, (r * size) / rows, size, 2);
    for (let g = 0; g < 4; g++) {
      ctx.fillStyle = "rgba(40,20,10,0.25)";
      ctx.fillRect(rng() * size, (r * size) / rows + 3 + rng() * 10, 10 + rng() * 30, 1);
    }
  }
  return el;
}

function roofTexture(rng: () => number, hue: [number, number, number]): HTMLCanvasElement {
  const size = 128;
  const { el, ctx } = canvas(size);
  ctx.fillStyle = `rgb(${hue[0]},${hue[1]},${hue[2]})`;
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 8;
    const w = size / cols;
    const off = r % 2 ? w / 2 : 0;
    for (let c = -1; c < cols; c++) {
      const k = 0.82 + rng() * 0.3;
      ctx.fillStyle = `rgb(${Math.min(255, hue[0] * k)},${Math.min(255, hue[1] * k)},${Math.min(255, hue[2] * k)})`;
      ctx.fillRect(c * w + off + 1, r * h + 1, w - 2, h - 2);
    }
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, r * h + h - 2, size, 2);
  }
  return el;
}

/** Texturas y materiales compartidos por todas las entidades; solo se liberan al cerrar la escena. */
export class AssetLibrary {
  private readonly disposables: { dispose(): void }[] = [];
  readonly textures: {
    grass: THREE.CanvasTexture;
    tone: THREE.CanvasTexture;
    water: THREE.CanvasTexture;
    waterRipple: THREE.CanvasTexture;
    bark: THREE.CanvasTexture;
    barkLight: THREE.CanvasTexture;
    leaf: THREE.CanvasTexture;
    stone: THREE.CanvasTexture;
    plaster: THREE.CanvasTexture;
    planks: THREE.CanvasTexture;
    roofTile: THREE.CanvasTexture;
    roofSlate: THREE.CanvasTexture;
  };

  constructor(readonly quality: Quality) {
    const rng = mulberry32(20261010);
    const t = (el: HTMLCanvasElement, repeat = true): THREE.CanvasTexture => this.track(makeTexture(el, repeat));
    const waterRng = mulberry32(20261011);
    this.textures = {
      grass: t(grassTexture(rng)),
      tone: t(tonePatches(rng), false),
      water: t(waterTexture(waterRng)),
      waterRipple: t(rippleTexture(waterRng)),
      bark: t(barkTexture(rng, "#5b3d27")),
      barkLight: t(barkTexture(rng, "#cfc9bb")),
      leaf: t(leafTexture(rng)),
      stone: t(stoneTexture(rng)),
      plaster: t(plasterTexture(rng)),
      planks: t(planksTexture(rng)),
      roofTile: t(roofTexture(rng, [168, 76, 52])),
      roofSlate: t(roofTexture(rng, [74, 82, 96])),
    };
  }

  track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  lambert(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
    return this.track(new THREE.MeshLambertMaterial(params));
  }

  basic(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    return this.track(new THREE.MeshBasicMaterial(params));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
