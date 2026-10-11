import type * as THREE from "three";

/** Tiempo de viento compartido por todos los materiales; lo avanza la vista del terreno con el reloj de animación. */
export const WIND = { value: 0 };

/** Balanceo de vegetación en el shader de vértices: crece con la altura local y se desfasa por posición de instancia. */
export function applyWind(material: THREE.Material, amplitude: number, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uWind"] = WIND;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 windOrigin = vec3(modelMatrix[3].x, 0.0, modelMatrix[3].z);
        #ifdef USE_INSTANCING
        windOrigin += vec3(instanceMatrix[3].x, 0.0, instanceMatrix[3].z);
        #endif
        float windPhase = windOrigin.x * 0.7 + windOrigin.z * 0.9;
        float windSway = max(position.y, 0.0) * ${amplitude.toFixed(4)};
        transformed.x += sin(uWind * 1.7 + windPhase) * windSway;
        transformed.z += cos(uWind * 1.3 + windPhase * 1.3) * windSway * 0.7;`,
      );
  };
  material.customProgramCacheKey = () => `wind-${key}`;
  material.needsUpdate = true;
}
