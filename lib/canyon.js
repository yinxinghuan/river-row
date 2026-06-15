// canyon.js — red sandstone biome props (Image 3 warm palette family).
//
//   buildCanyonBanks      — left + right red sandstone wall ribbons
//   buildCanyonRocks      — flatter sandstone slabs in the river
//   buildMesaRibbon       — distant flat-topped mesa silhouettes
//   buildSagebrush        — sparse desert tufts on bank tops
//
// Uses the same per-face paint helpers as temperate.js (kept local for clarity).

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=8';

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
      side * (RIVER_HALF + w * 0.5 - 0.6 + (Math.random()-0.5)*0.4),
      h * 0.5 - 0.45,
      z,
    );
    slab.rotation.y = (Math.random() - 0.5) * 0.12;
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
  // Tiered stacked-box sandstone — same crack-free recipe as rocks/boulders.
  // Each box is a clean BoxGeometry with single-colour quad faces; tiers
  // step inward + upward to read as an eroded canyon wall, no vertex jitter
  // (which previously produced visible facet seams).
  const g = new THREE.Group();
  const TOP  = new THREE.Color(0xb05a3a);
  const SIDE = new THREE.Color(0xd7935f);
  const tiers = 3 + Math.floor(Math.random() * 3);
  let yCursor = -h * 0.5;
  for (let i = 0; i < tiers; i++) {
    const taper = i / Math.max(1, tiers - 1);
    const tw = w * (1.0 - taper * 0.18 + (Math.random()-0.5) * 0.10);
    const th = h / tiers * (0.85 + Math.random() * 0.35);
    const td = l * (0.90 + Math.random() * 0.18);
    const geo = new THREE.BoxGeometry(tw, th, td).toNonIndexed();
    paintBoxByFace(geo, TOP, SIDE, 0.05);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const box = new THREE.Mesh(geo, mat);
    box.position.set(
      (Math.random() - 0.5) * w * 0.18,
      yCursor + th * 0.5,
      (Math.random() - 0.5) * l * 0.08,
    );
    box.rotation.y = (Math.random() - 0.5) * 0.20;
    box.castShadow = true; box.receiveShadow = true;
    g.add(box);
    yCursor += th * 0.90;
  }
  return g;
}

function sandstoneBoulder(r) {
  // Stacked-box approach — Crossy Road / shelf-it style. Flat quad faces
  // mean no facet edges and no apparent "cracks" between triangles.
  const g = new THREE.Group();
  const n = 3 + Math.floor(Math.random() * 3);
  const TOP = new THREE.Color(0xa0533a);     // rust top
  const SIDE = new THREE.Color(0xc77b54);    // warm sandstone tan
  for (let i = 0; i < n; i++) {
    const w = r * (0.60 + Math.random() * 0.50);
    const h = r * (0.40 + Math.random() * 0.28);
    const d = r * (0.60 + Math.random() * 0.50);
    let geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    paintBoxByFace(geo, TOP, SIDE, 0.04);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const box = new THREE.Mesh(geo, mat);
    box.position.set(
      (Math.random() - 0.5) * r * 0.5,
      (i === 0 ? h * 0.5 - 0.02 : h * 0.4 + Math.random() * r * 0.25),
      (Math.random() - 0.5) * r * 0.5,
    );
    box.rotation.y = Math.random() * Math.PI * 2;
    box.rotation.x = (Math.random() - 0.5) * 0.15;
    box.rotation.z = (Math.random() - 0.5) * 0.15;
    box.castShadow = true;
    g.add(box);
  }
  return g;
}

function paintBoxByFace(geo, topColor, sideColor, jitter) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let f = 0; f < pos.count; f += 6) {
    const faceIdx = f / 6;
    const isTop = (faceIdx === 2);
    tmp.copy(isTop ? topColor : sideColor);
    const n = (Math.random() - 0.5) * jitter;
    tmp.r = clamp01(tmp.r + n); tmp.g = clamp01(tmp.g + n); tmp.b = clamp01(tmp.b + n);
    for (let k = 0; k < 6; k++) {
      col[(f+k)*3+0] = tmp.r;
      col[(f+k)*3+1] = tmp.g;
      col[(f+k)*3+2] = tmp.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
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

// Irregular soft-blob splash texture (shared) — matches Tidal Survival's
// "rock sitting in water" feel, not a mechanical circle.
let _canyonSplashTex = null;
function getCanyonSplashTex() {
  if (_canyonSplashTex) return _canyonSplashTex;
  const SIZE = 128;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 7; i++) {
    const cx = SIZE * 0.5 + (Math.random() - 0.5) * SIZE * 0.35;
    const cy = SIZE * 0.5 + (Math.random() - 0.5) * SIZE * 0.35;
    const r  = SIZE * 0.18 + Math.random() * SIZE * 0.22;
    const a  = 0.55 + Math.random() * 0.35;
    const g  = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,    `rgba(255,255,255,${a})`);
    g.addColorStop(0.45, `rgba(255,255,255,${a*0.4})`);
    g.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  _canyonSplashTex = new THREE.CanvasTexture(c);
  return _canyonSplashTex;
}

function canyonContactFoam(r) {
  const tex = getCanyonSplashTex();
  const geo = new THREE.PlaneGeometry(r * 2.8, r * 2.8, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: tex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: true,
  });
  applyCurve(mat);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = Math.random() * Math.PI * 2;
  return m;
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
