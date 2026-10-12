import * as THREE from "three";
import type { Quality } from "./assets";
import { SUN_POSITION } from "./water-material";

/** Inclinación de la cámara: la vista cubre en el suelo 1/sin(39,5°) veces su altura. */
const GROUND_STRETCH = 1.57;
const SHADOW_MAP = 2048;
const CLOUD_TILE = 130;
const CLOUD_OPACITY = 0.1;

function cloudTexture(mapWidth: number, mapDepth: number): THREE.CanvasTexture {
  const size = 256;
  const el = document.createElement("canvas");
  el.width = el.height = size;
  const ctx = el.getContext("2d")!;
  let seed = 90210;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 24 + rnd() * 44;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, "rgba(0,0,0,0.5)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(el);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(mapWidth / CLOUD_TILE, mapDepth / CLOUD_TILE);
  return tex;
}

/** Entorno de cielo procedural (degradado y disco solar) filtrado a PMREM para los materiales metálicos. */
function skyEnvironment(renderer: THREE.WebGLRenderer, disposables: { dispose(): void }[]): THREE.Texture {
  const geometry = new THREE.SphereGeometry(10, 24, 12);
  const pos = geometry.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(0x4a86d8);
  const horizon = new THREE.Color(0xdbe6ee);
  const ground = new THREE.Color(0x3f5a2e);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y >= 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.7));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 3));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.2, 4) }));
  sun.position.copy(SUN_POSITION).normalize().multiplyScalar(9);
  const env = new THREE.Scene();
  env.add(sky, sun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.04);
  pmrem.dispose();
  disposables.push(geometry, sky.material, sun.geometry, sun.material, target);
  return target.texture;
}

/** Iluminación de la escena: tono, sol con sombras que sigue a la cámara, entorno y sombras de nubes (P5-H07). */
export class Lighting {
  readonly shadows: boolean;
  private readonly sun: THREE.DirectionalLight;
  private readonly cloud: THREE.Mesh | null = null;
  private readonly cloudMap: THREE.CanvasTexture | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, quality: Quality, shadows: boolean, mapWidth: number, mapDepth: number) {
    const high = quality === "high";
    this.shadows = high && shadows;
    scene.add(new THREE.AmbientLight(0xffffff, high ? 0.2 : 0.5));
    scene.add(new THREE.HemisphereLight(high ? 0xcfe4ff : 0xdfeeff, high ? 0x4a6a34 : 0x3a5a2a, high ? 0.5 : 0.45));
    this.sun = new THREE.DirectionalLight(high ? 0xffe9c6 : 0xfff1d6, high ? 1.6 : 1.15);
    this.sun.position.copy(SUN_POSITION);
    scene.add(this.sun, this.sun.target);
    if (!high) return;

    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    scene.environment = skyEnvironment(renderer, this.disposables);
    scene.environmentIntensity = 0.45;

    if (this.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      const light = this.sun.shadow;
      light.mapSize.set(SHADOW_MAP, SHADOW_MAP);
      light.camera.near = 1;
      light.camera.far = 420;
      light.bias = -0.0004;
      light.normalBias = 0.04;
      light.radius = 2.5;
      this.sun.castShadow = true;
    }

    this.cloudMap = cloudTexture(mapWidth, mapDepth);
    const material = new THREE.MeshBasicMaterial({ map: this.cloudMap, transparent: true, opacity: CLOUD_OPACITY, depthWrite: false, toneMapped: false });
    const geometry = new THREE.PlaneGeometry(mapWidth, mapDepth).rotateX(-Math.PI / 2);
    this.cloud = new THREE.Mesh(geometry, material);
    this.cloud.position.set(mapWidth / 2, 0.02, mapDepth / 2);
    this.cloud.renderOrder = 1;
    scene.add(this.cloud);
    this.disposables.push(this.cloudMap, material, geometry);
  }

  /** Marca qué mallas proyectan y reciben sombra; las translúcidas (barras, sombras de contacto) quedan fuera. */
  mark(root: THREE.Object3D): void {
    if (!this.shadows) return;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
      const solid = !!m && m.visible && !m.transparent;
      mesh.castShadow = solid;
      mesh.receiveShadow = solid;
    });
  }

  /** Centra el mapa de sombras en la vista; `half` es la altura visible en unidades del mundo entre 2. */
  update(x: number, z: number, half: number, aspect: number, animTime: number): void {
    if (this.cloudMap) this.cloudMap.offset.set(animTime * 0.0021, animTime * 0.0012);
    if (!this.shadows) return;
    const extent = half * Math.hypot(aspect, GROUND_STRETCH) * 1.04;
    const texel = (extent * 2) / SHADOW_MAP;
    const tx = Math.round(x / texel) * texel;
    const tz = Math.round(z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + SUN_POSITION.x, SUN_POSITION.y, tz + SUN_POSITION.z);
    const cam = this.sun.shadow.camera;
    if (cam.right !== extent) {
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
