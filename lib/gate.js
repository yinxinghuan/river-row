// gate.js — natural stone arch spanning the river (biome transition gate).
//
// A wide, low stone bridge built of 3 chunky tiered slabs forming a soft
// arch over the water. Stone is gray-tan so it reads as "old stone bridge"
// against both temperate (moss-green) and canyon (red sandstone) palettes —
// no need to swap textures during transit.
//
// The shape is intentionally cathedral-low: the river passes UNDER the arch.

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=2';

const STONE_BASE = 0x9b8a73;
const STONE_TOP  = 0xc4b59a;
const STONE_TIER = 0xb09c80;
const MOSS_KISS  = 0x6f8e57;     // a touch of moss on the temperate side
const RUST_KISS  = 0xc2754d;     // a touch of rust on the canyon  side

export function buildStoneArch({ z = -110, span = 24, height = 8 } = {}) {
  const g = new THREE.Group();

  // ── arch sides — two big pillar bases left + right (Cyclopean stone)
  const pillarW = 7, pillarH = 6.2, pillarD = 3.6;
  for (const side of [-1, +1]) {
    let geo = new THREE.BoxGeometry(pillarW, pillarH, pillarD, 2, 3, 2);
    const pos0 = geo.attributes.position;
    for (let v = 0; v < pos0.count; v++) {
      const y = pos0.getY(v);
      pos0.setX(v, pos0.getX(v) + (Math.random()-0.5) * 0.7);
      pos0.setZ(v, pos0.getZ(v) + (Math.random()-0.5) * 0.7);
      pos0.setY(v, y + (Math.random()-0.5) * 0.4);
    }
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    paintFacesByHeight(geo, STONE_TOP, STONE_BASE, 0.06);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    applyCurve(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(side * (span * 0.5 + pillarW * 0.5 - 4), pillarH * 0.5 - 0.4, 0);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }

  // ── arch capstone — the spanning lintel above the river
  const capW = span + 2.6, capH = 1.4, capD = 4.2;
  let cap = new THREE.BoxGeometry(capW, capH, capD, 5, 1, 2);
  const cpos = cap.attributes.position;
  // bow the capstone slightly downward at the middle (subtle catenary)
  for (let v = 0; v < cpos.count; v++) {
    const x = cpos.getX(v);
    if (cpos.getY(v) < 0) {
      const sag = Math.cos((x / (capW * 0.5)) * 0.65 * Math.PI * 0.5) * 0.4;
      cpos.setY(v, cpos.getY(v) - sag);
    }
    cpos.setZ(v, cpos.getZ(v) + (Math.random()-0.5) * 0.3);
  }
  cap = cap.toNonIndexed();
  cap.computeVertexNormals();
  paintFacesByHeight(cap, STONE_TOP, STONE_TIER, 0.05);
  const capMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  applyCurve(capMat);
  const capMesh = new THREE.Mesh(cap, capMat);
  capMesh.position.set(0, pillarH + capH * 0.5 - 0.3, 0);
  capMesh.castShadow = true; capMesh.receiveShadow = true;
  g.add(capMesh);

  // ── a second decorative tier on top (the keystone block + flanking smaller blocks)
  const keyW = 4, keyH = 1.6, keyD = 3.2;
  const keyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  applyCurve(keyMat);
  let keyGeo = new THREE.BoxGeometry(keyW, keyH, keyD, 1, 1, 1);
  keyGeo = keyGeo.toNonIndexed();
  keyGeo.computeVertexNormals();
  paintFacesByHeight(keyGeo, STONE_TOP, STONE_TIER, 0.05);
  const key = new THREE.Mesh(keyGeo, keyMat);
  key.position.set(0, pillarH + capH + keyH * 0.5 - 0.3, 0);
  key.castShadow = true; key.receiveShadow = true;
  g.add(key);

  // ── moss kiss on the temperate-facing side of the pillars (z > 0)
  for (const side of [-1, +1]) {
    let mossGeo = new THREE.BoxGeometry(pillarW * 0.96, pillarH * 0.7, 0.12, 2, 2, 1);
    mossGeo = mossGeo.toNonIndexed();
    mossGeo.computeVertexNormals();
    paintFacesUniform(mossGeo, new THREE.Color(MOSS_KISS), 0.08);
    const mossMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mossMat);
    const moss = new THREE.Mesh(mossGeo, mossMat);
    moss.position.set(side * (span * 0.5 + pillarW * 0.5 - 4), pillarH * 0.35, pillarD * 0.5 + 0.06);
    g.add(moss);
  }

  // ── rust kiss on the canyon-facing side (z < 0)
  for (const side of [-1, +1]) {
    let rustGeo = new THREE.BoxGeometry(pillarW * 0.96, pillarH * 0.65, 0.12, 2, 2, 1);
    rustGeo = rustGeo.toNonIndexed();
    rustGeo.computeVertexNormals();
    paintFacesUniform(rustGeo, new THREE.Color(RUST_KISS), 0.10);
    const rustMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(rustMat);
    const rust = new THREE.Mesh(rustGeo, rustMat);
    rust.position.set(side * (span * 0.5 + pillarW * 0.5 - 4), pillarH * 0.32, -pillarD * 0.5 - 0.06);
    g.add(rust);
  }

  g.position.z = z;
  return g;
}

// ── helpers (duplicated here so module is self-contained) ───────────────────
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
