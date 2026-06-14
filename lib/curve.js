// curve.js — shared curved-world shader patch.
//
// Drops every world vertex by d² × CURVE where d is the world-XZ distance from
// the camera. Result: distant geometry sinks below the horizon and "rises" as
// the player approaches, the Animal Crossing / Alto / Tidal Survival trick —
// without ever rendering a real sphere.
//
// Single shared uniform set so every material breathes the same curvature.
// `applyCurve(mat, { vertexInsert })` composes additional displacement (e.g.
// water waves) BEFORE the curve drop — so the wavy water surface still sinks
// at the horizon correctly.

import * as THREE from 'three';

export const curveUniforms = {
  uCamXZ:  { value: new THREE.Vector2(0, 0) },
  uCurve:  { value: 0.0005 },         // gentle — water still visible at mid-range, banks/pines still sink at far horizon
  uTime:   { value: 0 },
};

export function applyCurve(mat, extras = {}) {
  const vInsert = extras.vertexInsert || '';
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
         uniform float uTime;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec4 _wp = modelMatrix * vec4(transformed, 1.0);
           ${vInsert}
           float _dx = _wp.x - uCamXZ.x;
           float _dz = _wp.z - uCamXZ.y;
           transformed.y -= (_dx*_dx + _dz*_dz) * uCurve;
         }`
      );
  };
  mat.needsUpdate = true;
  return mat;
}

export function updateCurve(camera, t) {
  curveUniforms.uCamXZ.value.set(camera.position.x, camera.position.z);
  curveUniforms.uTime.value = t;
}
