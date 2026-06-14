// curve.js — shared curved-world shader patch.
//
// Drops every world vertex by d² × CURVE where d is the world-XZ distance from
// the camera. Result: distant geometry sinks below the horizon and "rises" as
// the player approaches, the Animal Crossing / Alto / Tidal Survival trick —
// without ever rendering a real sphere.
//
// Single shared uniform set so every material breathes the same curvature.
// `applyCurve(mat, { vertexInsert, fragmentInsert })` composes additional
// displacement (e.g. water waves) BEFORE the curve drop — so the wavy water
// surface still sinks at the horizon correctly. `fragmentInsert` runs after
// the diffuse colour is read, with the camera-space view distance available
// as `vCamDist` (units).

import * as THREE from 'three';

export const curveUniforms = {
  uCamXZ:  { value: new THREE.Vector2(0, 0) },
  // Flat world — user opted to drop the curved-horizon effect after it kept
  // producing edge-case drift on scaled child meshes ("人物飞上天"). Setting
  // uCurve = 0 zeroes the displacement for every material; the shared shader
  // patches still wire uTime so the water waves keep working.
  uCurve:  { value: 0.0 },
  uTime:   { value: 0 },
};

export function applyCurve(mat, extras = {}) {
  const vInsert = extras.vertexInsert || '';
  const fInsert = extras.fragmentInsert || '';
  const curveStrength = extras.curveStrength !== undefined ? extras.curveStrength : 1.0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCamXZ = curveUniforms.uCamXZ;
    shader.uniforms.uCurve = curveUniforms.uCurve;
    shader.uniforms.uTime  = curveUniforms.uTime;
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec2  uCamXZ;
         uniform float uCurve;
         uniform float uTime;
         varying float vCamDist;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec4 _wp = modelMatrix * vec4(transformed, 1.0);
           ${vInsert}
           float _dx = _wp.x - uCamXZ.x;
           float _dz = _wp.z - uCamXZ.y;
           float _scaleY = length(modelMatrix[1].xyz);
           transformed.y -= (_dx*_dx + _dz*_dz) * uCurve * ${curveStrength.toFixed(4)} / max(_scaleY, 0.0001);
           vCamDist = sqrt(_dx*_dx + _dz*_dz);
         }`
      );
    if (fInsert) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           varying float vCamDist;`
        )
        .replace(
          '#include <dithering_fragment>',
          `${fInsert}
           #include <dithering_fragment>`
        );
    } else {
      // still declare varying so vertex doesn't error
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying float vCamDist;`
      );
    }
  };
  mat.needsUpdate = true;
  return mat;
}

export function updateCurve(camera, t) {
  curveUniforms.uCamXZ.value.set(camera.position.x, camera.position.z);
  curveUniforms.uTime.value = t;
}
