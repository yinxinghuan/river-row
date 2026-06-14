// water.js — temperate painterly water surface stack.
//
//   L0 base  — flat-shaded plane, vertex-color HSL noise per face
//   L1 waves — sin+cos vertex displacement (composed into the curve shader)
//   L2 foam  — UV-scrolled canvas-noise plane just above L0
//   L3 sun   — additive long thin sun-glint band drifting along river
//
// Group exposes `userData.tick(t, dt)` for per-frame uniforms / texture offsets.

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=1';

export function buildWater({ width = 60, length = 260 } = {}) {
  const group = new THREE.Group();

  // ── L0 base ─────────────────────────────────────────────────────────────────
  // Lower segment density → bigger triangles → the per-face HSL noise reads
  // as chunky painterly facets (Image 1/2 signature). toNonIndexed() + per-face
  // colour ensures the three vertices of each triangle share the same colour,
  // so flat-shaded faces read as distinct blocks of colour (not gradients).
  //
  // The plane is built around its OWN origin (-length/2 … +length/2); game.js
  // slides the whole water group to follow the boat z so we never run off
  // the edge of the tile.
  let geo = new THREE.PlaneGeometry(width, length, 30, 96);
  geo.rotateX(-Math.PI / 2);
  geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0x4cc8d4);   // brighter cyan-teal — matches the Tidal Survival reference
  const tmp = new THREE.Color();
  const hsl = {};
  base.getHSL(hsl);
  // every 3 consecutive vertices = one face — paint them identically.
  // Higher-freq noise + smaller delta = visible faceting that doesn't read
  // as a tiled pattern.
  for (let f = 0; f < pos.count; f += 3) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(f+k); cz += pos.getZ(f+k); }
    cx /= 3; cz /= 3;
    const n = (Math.sin(cx * 0.62 + 1.3) * Math.cos(cz * 0.51 - 0.7)) * 0.48
            + (Math.sin(cx * 0.18 - 2.1) * Math.cos(cz * 0.21 + 1.1)) * 0.28
            + (Math.random() - 0.5) * 0.20;
    tmp.setHSL(
      hsl.h + n * 0.025,
      Math.max(0, Math.min(1, hsl.s + n * 0.08)),
      Math.max(0, Math.min(1, hsl.l + n * 0.07))
    );
    for (let k = 0; k < 3; k++) {
      colors[(f+k)*3+0] = tmp.r;
      colors[(f+k)*3+1] = tmp.g;
      colors[(f+k)*3+2] = tmp.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const waterMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    fog: false,            // user reported "水消失" — at d > 80 the canyon warm fog washed water to sky-peach. Disabling fog on the water layer keeps the river readable all the way to where the curve drops it under the horizon.
  });
  // Water curves with the rest of the world (球形 horizon — the banks and
  // rocks sink into the distance together with the water surface, so
  // distant land naturally pokes through above the water "horizon line").
  // fog:false on the material keeps the foreground water reading as TRUE
  // water colour even in canyon's warm fog, instead of melting to peach.
  applyCurve(waterMat, {
    vertexInsert: `
      float _wave = sin(_wp.x*0.58 + uTime*1.10) * 0.058
                  + cos(_wp.z*0.46 + uTime*0.74) * 0.046
                  + sin((_wp.x+_wp.z)*0.31 + uTime*0.62) * 0.022;
      transformed.y += _wave;
    `,
  });
  const water = new THREE.Mesh(geo, waterMat);
  water.receiveShadow = true;
  group.add(water);

  // ── L2 foam overlay ────────────────────────────────────────────────────────
  const foamTex = makeFoamTexture();
  foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
  foamTex.repeat.set(7, 22);
  const foamGeo = new THREE.PlaneGeometry(width, length, 1, 1);
  foamGeo.rotateX(-Math.PI / 2);
  const foamMat = new THREE.MeshBasicMaterial({
    map: foamTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    fog: true,
  });
  applyCurve(foamMat);
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.position.y = 0.025;
  group.add(foam);

  // ── L3 sun glint band ──────────────────────────────────────────────────────
  const glintTex = makeGlintTexture();
  glintTex.wrapS = glintTex.wrapT = THREE.RepeatWrapping;
  glintTex.repeat.set(1, 3);
  const glintGeo = new THREE.PlaneGeometry(width * 0.085, length, 1, 1);
  glintGeo.rotateX(-Math.PI / 2);
  const glintMat = new THREE.MeshBasicMaterial({
    map: glintTex,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });
  applyCurve(glintMat);
  const glint = new THREE.Mesh(glintGeo, glintMat);
  glint.position.y = 0.045;
  glint.position.x = width * -0.06;  // slight off-centre to the left (sun is upper-left)
  group.add(glint);

  group.userData.tick = (t, dt) => {
    foamTex.offset.y += dt * 0.05;                  // foam drifts toward camera
    foamTex.offset.x = Math.sin(t * 0.13) * 0.04;
    glintTex.offset.y = (t * 0.025) % 1;
  };

  // ── segment palette hook ──────────────────────────────────────────────────
  // setSegment(t) lerps the water look across biomes (t=0 temperate teal,
  // t=1 deeper canyon river with churning foam streaks).
  //
  // Canyon water must read as a DARKER MUDDY RIVER (so it visibly contrasts
  // with warm sandstone banks) and the foam must be VISIBLE but not opaque —
  // we want to see river beneath, with white-cream rapids on top.
  const TINT_TEMPERATE = new THREE.Color(0xffffff);            // identity
  const TINT_CANYON    = new THREE.Color(0x9ec6d6);            // light steel blue — keeps canyon water readable but bright
  const FOAM_C_TEMP    = new THREE.Color(0xffffff);
  const FOAM_C_CANYON  = new THREE.Color(0xffffff);            // keep foam neutral white (warm cream tint was washing the whole surface)
  group.userData.setSegment = (t) => {
    waterMat.color.copy(TINT_TEMPERATE).lerp(TINT_CANYON, t);
    foamMat.opacity = 0.55 - t * 0.20;             // 0.55 → 0.35 — fewer foam patches in canyon, more dark river shows
    foamMat.color.copy(FOAM_C_TEMP).lerp(FOAM_C_CANYON, t);
  };

  return group;
}

function makeFoamTexture() {
  const SIZE = 256;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  // soft round speckles
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * SIZE, y = Math.random() * SIZE;
    const r = 1 + Math.random() * 3.2;
    const a = 0.05 + Math.random() * 0.22;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(x - r*3, y - r*3, r*6, r*6);
  }
  // thin streaky strokes (current)
  for (let i = 0; i < 36; i++) {
    const x = Math.random() * SIZE, y = Math.random() * SIZE;
    const len = 16 + Math.random() * 50;
    const w = 1 + Math.random() * 1.8;
    const a = 0.08 + Math.random() * 0.16;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.25);   // mostly aligned with flow
    ctx.fillRect(-len/2, -w/2, len, w);
    ctx.restore();
  }
  return new THREE.CanvasTexture(c);
}

function makeGlintTexture() {
  const W = 64, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // soft warm vertical column
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,   'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,247,210,0.6)');
  grad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // sparkle dots
  for (let i = 0; i < 58; i++) {
    const x = W * (0.18 + Math.random() * 0.64);
    const y = Math.random() * H;
    const r = 0.8 + Math.random() * 2.2;
    ctx.fillStyle = `rgba(255,253,225,${0.5 + Math.random()*0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
