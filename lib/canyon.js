// canyon.js — red sandstone biome props (Image 3 warm palette family).
//
//   buildCanyonBanks      — left + right red sandstone wall ribbons
//   buildCanyonRocks      — flatter sandstone slabs in the river
//   buildMesaRibbon       — distant flat-topped mesa silhouettes
//   buildSagebrush        — sparse desert tufts on bank tops
//
// Uses the same per-face paint helpers as temperate.js (kept local for clarity).

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=2';

const RIVER_HALF = 9.5;

// ── banks ────────────────────────────────────────────────────────────────────
export function buildCanyonBanks({ zStart = -260, zEnd = -100 } = {}) {
  const group = new THREE.Group();
  for (const side of [-1, +1]) group.add(canyonBankRibbon(side, zStart, zEnd));
  return group;
}

function canyonBankRibbon(side, zStart, zEnd) {
  const g = new THREE.Group();
  const length = zEnd - zStart;
  const N = Math.max(8, Math.round(length / 7));
  const seg = length / N;
  for (let i = 0; i < N; i++) {
    const z = zStart + seg * (i + 0.5 + (Math.random()-0.5)*0.4);
    const w = 10 + Math.random() * 5;
    const l = seg * 1.25;
    const low = (Math.random() < 0.20);
    const h = low ? (0.8 + Math.random() * 0.8) : (3.2 + Math.random() * 3.4);
    const slab = canyonSlab(w, h, l);
    slab.position.set(
      side * (RIVER_HALF + w * 0.5 - 1.4 + (Math.random()-0.5)*0.6),
      h * 0.5 - 0.45,
      z,
    );
    slab.rotation.y = (Math.random() - 0.5) * 0.25;
    g.add(slab);

    if (!low && Math.random() < 0.42) {
      const r = 0.7 + Math.random() * 1.2;
      const boulder = sandstoneBoulder(r);
      boulder.position.set(
        side * (RIVER_HALF + 1 + Math.random() * (w - 2)),
        h - 0.05,
        z + (Math.random() - 0.5) * seg * 0.55,
      );
      boulder.rotation.y = Math.random() * Math.PI * 2;
      g.add(boulder);
    }

    if (!low && Math.random() < 0.55) {
      const tuft = sagebrush();
      tuft.position.set(
        side * (RIVER_HALF + 0.3 + Math.random() * 1.4),
        h - 0.45,
        z + (Math.random() - 0.5) * seg * 0.85,
      );
      tuft.rotation.y = Math.random() * Math.PI * 2;
      g.add(tuft);
    }
  }
  return g;
}

function canyonSlab(w, h, l) {
  let geo = new THREE.BoxGeometry(w, h, l, 2, 2, 3);
  const pos0 = geo.attributes.position;
  for (let v = 0; v < pos0.count; v++) {
    const y = pos0.getY(v);
    if (y > -h*0.3) {
      // jitter top + upper portion → tiered, eroded look
      pos0.setX(v, pos0.getX(v) + (Math.random()-0.5) * 1.2);
      pos0.setZ(v, pos0.getZ(v) + (Math.random()-0.5) * 1.2);
      pos0.setY(v, y + (Math.random()-0.4) * 0.55);
    }
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  // top = rust red, side = warm sandstone tan — low jitter so neighbouring
  // facets don't read as cracks against the warm canyon sky
  paintFacesByHeight(geo, 0xb05a3a, 0xd7935f, 0.04);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCurve(mat);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function sandstoneBoulder(r) {
  let geo = new THREE.IcosahedronGeometry(r, 1);   // 80 faces (vs 20) — softer facet edges
  const pos0 = geo.attributes.position;
  for (let v = 0; v < pos0.count; v++) {
    pos0.setY(v, pos0.getY(v) * 0.5 + r * 0.05);
    pos0.setX(v, pos0.getX(v) + (Math.random()-0.5) * 0.08);
    pos0.setZ(v, pos0.getZ(v) + (Math.random()-0.5) * 0.08);
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  paintFacesByHeight(geo, 0xa0533a, 0xc77b54, 0.025);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCurve(mat);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// scattered sandstone rocks in the river
export function buildCanyonRocks({ count = 16, zStart = -260, zEnd = -100 } = {}) {
  const group = new THREE.Group();
  const length = zEnd - zStart;
  for (let i = 0; i < count; i++) {
    const r = 0.7 + Math.random() * 1.3;
    const rock = sandstoneBoulder(r);
    const x = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * (RIVER_HALF - 2.4));
    const z = zStart + Math.random() * length;
    rock.position.set(x, 0.04, z);
    rock.rotation.y = Math.random() * Math.PI * 2;
    rock.userData.collide = { r: r * 0.85 };
    group.add(rock);

    // contact foam ring (same kind as temperate)
    const ring = canyonContactFoam(r);
    ring.position.set(x, 0.04, z);
    group.add(ring);
  }
  return group;
}

function canyonContactFoam(r) {
  // Wider + brighter ring than temperate so the rock's waterline is unambiguous
  // against warm fog — the foam is the visual cue that "this is in water".
  const inner = r * 0.78;
  const outer = r * 1.95;
  const geo = new THREE.RingGeometry(inner, outer, 24);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v);
    const d = Math.sqrt(x*x + z*z);
    const t = (d - inner) / (outer - inner);
    const a = 1 - t;
    col[v*3+0] = a; col[v*3+1] = a; col[v*3+2] = a;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
  applyCurve(mat);
  return new THREE.Mesh(geo, mat);
}

function sagebrush() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = 0.16 + Math.random() * 0.10;
    const h = 0.32 + Math.random() * 0.36;
    let geo = new THREE.IcosahedronGeometry(r * 1.6, 0);
    geo = geo.toNonIndexed();
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      pos.setY(v, pos.getY(v) * 0.6 + h * 0.6);
    }
    geo.computeVertexNormals();
    paintFacesUniform(geo, new THREE.Color().setHSL(0.18 + Math.random()*0.07, 0.36, 0.45 + Math.random()*0.08), 0.06);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((Math.random()-0.5)*0.4, 0, (Math.random()-0.5)*0.4);
    g.add(m);
  }
  return g;
}

// ── distant mesa silhouettes (flat-topped buttes) ────────────────────────────
export function buildMesaRibbon({ side = -1, distance = 36, zStart = -260, zEnd = +30, count = 38 } = {}) {
  const group = new THREE.Group();
  const length = zEnd - zStart;
  const seg = length / count;
  for (let i = 0; i < count; i++) {
    const z = zStart + seg * (i + 0.5 + (Math.random()-0.5)*0.6);
    const x = side * (distance + (Math.random() - 0.5) * 14);
    const h = 3 + Math.random() * 6.5;
    const w = 4 + Math.random() * 4;
    const d = 3 + Math.random() * 4;
    let geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    paintFacesByHeight(geo, 0xb16041, 0xd99668, 0.03);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, h * 0.5 - 1.2, z);
    m.rotation.y = (Math.random()-0.5) * 0.3;
    group.add(m);
  }
  return group;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function paintFacesByHeight(geo, topHex, sideHex, jitter = 0.07) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(topHex);
  const sid = new THREE.Color(sideHex);
  let yMin = Infinity, yMax = -Infinity;
  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const span = Math.max(0.001, yMax - yMin);
  const tmp = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const cy = (pos.getY(f) + pos.getY(f+1) + pos.getY(f+2)) / 3;
    const t = (cy - yMin) / span;
    tmp.copy(sid).lerp(top, t);
    const n = (Math.random() - 0.5) * jitter;
    tmp.r = clamp01(tmp.r + n); tmp.g = clamp01(tmp.g + n); tmp.b = clamp01(tmp.b + n);
    for (let k = 0; k < 3; k++) {
      col[(f+k)*3+0] = tmp.r;
      col[(f+k)*3+1] = tmp.g;
      col[(f+k)*3+2] = tmp.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function paintFacesUniform(geo, baseColor, jitter = 0.05) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    tmp.copy(baseColor);
    const n = (Math.random() - 0.5) * jitter;
    tmp.r = clamp01(tmp.r + n); tmp.g = clamp01(tmp.g + n); tmp.b = clamp01(tmp.b + n);
    for (let k = 0; k < 3; k++) {
      col[(f+k)*3+0] = tmp.r;
      col[(f+k)*3+1] = tmp.g;
      col[(f+k)*3+2] = tmp.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
