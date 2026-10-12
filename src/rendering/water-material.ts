import * as THREE from "three";
import type { AssetLibrary } from "./assets";

/** Dirección hacia el sol (luz direccional de la escena) y hacia la cámara ortográfica, normalizadas. */
export const SUN_POSITION = new THREE.Vector3(-25, 80, 60);
export const CAMERA_OFFSET = new THREE.Vector3(60, 70, 60);

const vertexShader = /* glsl */ `
attribute vec4 color;
attribute float depth;
varying vec4 vColor;
varying float vDepth;
varying vec2 vWorld;
void main() {
  vColor = color;
  vDepth = depth;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uView;
uniform sampler2D uNormal;
uniform sampler2D uNoise;
varying vec4 vColor;
varying float vDepth;
varying vec2 vWorld;

void main() {
  vec2 p = vWorld;
  // Dos capas de normales que derivan en sentidos opuestos y una onda lenta.
  vec3 n1 = texture2D(uNormal, p * 0.09 + vec2(uTime * 0.013, uTime * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormal, p * 0.23 + vec2(0.37) - vec2(uTime * 0.021, -uTime * 0.016)).xyz * 2.0 - 1.0;
  vec2 swell = 0.05 * vec2(sin(p.x * 0.33 + uTime * 0.55), sin(p.y * 0.29 + uTime * 0.43));
  vec2 g = (n1.xz + 0.65 * n2.xz) * 0.9 + swell;
  vec3 n = normalize(vec3(g.x, 1.0, g.y));

  float depth = clamp(vDepth, 0.0, 1.0);
  vec3 shallow = vec3(0.38, 0.78, 0.74);
  vec3 deep = vec3(0.08, 0.32, 0.52);
  vec3 body = mix(shallow, deep, smoothstep(0.0, 1.0, depth));
  body *= mix(vec3(1.0), vColor.rgb, 0.5);
  body *= 0.82 + 0.18 * dot(n, uSun);

  // Reflejo del cielo con Fresnel.
  vec3 r = reflect(-uView, n);
  vec3 sky = mix(vec3(0.74, 0.84, 0.92), vec3(0.30, 0.55, 0.88), smoothstep(0.0, 1.0, r.y));
  float cosT = max(dot(n, uView), 0.0);
  float fresnel = 0.2 + 1.4 * pow(1.0 - cosT, 3.0);
  vec3 color = mix(body, sky, fresnel);

  // Brillo solar en destellos que parpadean.
  vec3 h = normalize(uSun + uView);
  float spec = pow(max(dot(n, h), 0.0), 70.0);
  float sparkle = 0.6 + 0.4 * sin(uTime * 2.6 + p.x * 5.1 + p.y * 3.7);
  color += vec3(1.0, 0.94, 0.8) * spec * sparkle * 1.1;

  // Caústicas suaves en lo somero.
  float c1 = texture2D(uNoise, p * 0.17 + vec2(uTime * 0.02, -uTime * 0.014)).g;
  float c2 = texture2D(uNoise, p * 0.23 - vec2(uTime * 0.017, uTime * 0.021)).g;
  float caustic = pow(c1 * c2, 0.8);
  color += vec3(0.45, 0.85, 0.78) * caustic * (1.0 - smoothstep(0.0, 0.75, depth)) * 0.35;

  // Espuma de orilla irregular que avanza y retrocede.
  float noise = texture2D(uNoise, p * 0.16 + vec2(uTime * 0.01, 0.0)).r;
  float edge = 0.2 + 0.09 * sin(uTime * 0.8 + noise * 6.2832);
  float band = exp(-pow((depth - edge) / 0.11, 2.0));
  float foam = band * smoothstep(0.38, 0.68, noise + 0.18 * sin(uTime * 1.1 + p.x * 2.0));
  color = mix(color, vec3(0.96, 0.98, 0.98), foam * 0.8);

  float alpha = clamp(vColor.a + foam * 0.5 * step(0.01, vColor.a), 0.0, 1.0);
  gl_FragColor = vec4(pow(color, vec3(2.2)), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Material del agua con shader propio: una sola instancia compartida por todos los lagos. */
export class WaterMaterial extends THREE.ShaderMaterial {
  constructor(assets: AssetLibrary) {
    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSun: { value: SUN_POSITION.clone().normalize() },
        uView: { value: CAMERA_OFFSET.clone().normalize() },
        uNormal: { value: assets.textures.waterNormal },
        uNoise: { value: assets.textures.waterNoise },
      },
    });
  }

  setTime(seconds: number): void {
    this.uniforms.uTime!.value = seconds;
  }
}
