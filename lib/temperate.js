// temperate.js — temperate river biome props.
//
//   buildBanks(length)     — left + right organic-edge mossy bank ribbons +
//                            grass tufts + occasional "low" bank pockets so
//                            the pine ribbon behind shows through
//   buildRocks(count, len) — scattered mossy river rocks + contact-foam ring
//   buildLilyPads(count)   — pastel pad clusters floating on the water
//   buildPineRibbon(side)  — distant pine silhouette layer (cones, low-poly)
//
// All materials go through applyCurve() so they sink with the world.

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=7';
import { duck as duckBuilder } from '../builders/animals.js';

const RIVER_HALF = 9.5;

// ── banks ────────────────────────────────────────────────────────────────────
export function buildBanks({ zStart = -130, zEnd = 130 } = {}) {
  const group = new THREE.Group();
  for (const side of [-1, +1]) {
    const ribbon = bankRibbon(side, zStart, zEnd);
    group.add(ribbon);
  }
  return group;
}

function bankRibbon(side, zStart, zEnd) {
  const g = new THREE.Group();
  const length = zEnd - zStart;
  const N = Math.max(8, Math.round(length / 7));
  const seg = length / N;
  for (let i = 0; i < N; i++) {
    const z = zStart + seg * (i + 0.5 + (Math.random()-0.5)*0.4);
    const w = 10 + Math.random() * 5;
    const l = seg * 1.25;
    // every ~5th segment becomes a "low pocket" so the pine ribbon shows
    const low = (Math.random() < 0.22);
    const h = low ? (0.6 + Math.random() * 0.6) : (2.6 + Math.random() * 2.6);
    const slab = bankSlab(w, h, l);
    slab.position.set(
      side * (RIVER_HALF + w * 0.5 - 1.4 + (Math.random()-0.5)*0.6),
      h * 0.5 - 0.45,
      z,
    );
    slab.rotation.y = (Math.random() - 0.5) * 0.35;
    g.add(slab);

    // mossy boulder on top
    if (!low && Math.random() < 0.45) {
      const r = 0.7 + Math.random() * 1.1;
      const boulder = mossyBoulder(r);
      boulder.position.set(
        side * (RIVER_HALF + 1 + Math.random() * (w - 2)),
        h - 0.05,
        z + (Math.random() - 0.5) * seg * 0.55,
      );
      boulder.rotation.y = Math.random() * Math.PI * 2;
      g.add(boulder);
    }

    // grass tufts along the upper bank edge facing the river — small green cones
    if (!low) {
      const tufts = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < tufts; k++) {
        const tuft = grassTuft();
        tuft.position.set(
          side * (RIVER_HALF + 0.1 + Math.random() * 1.4),
          h - 0.45,
          z + (Math.random() - 0.5) * seg * 0.85,
        );
        tuft.rotation.y = Math.random() * Math.PI * 2;
        g.add(tuft);
      }
    }
  }
  return g;
}

function grassTuft() {
  // 3-cone bundle, varying heights, light grass green — non-indexed for clean facets
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = 0.18 + Math.random() * 0.12;
    const h = 0.5 + Math.random() * 0.55;
    let geo = new THREE.ConeGeometry(r, h, 5);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    paintFacesUniform(geo, new THREE.Color().setHSL(0.27 + Math.random()*0.06, 0.52, 0.46 + Math.random()*0.08), 0.05);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((Math.random()-0.5)*0.3, h*0.5, (Math.random()-0.5)*0.3);
    m.rotation.z = (Math.random()-0.5)*0.18;
    g.add(m);
  }
  return g;
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

function bankSlab(w, h, l) {
  let geo = new THREE.BoxGeometry(w, h, l, 2, 1, 3);
  const pos0 = geo.attributes.position;
  for (let v = 0; v < pos0.count; v++) {
    const y = pos0.getY(v);
    if (y > 0) {                                   // jitter only the top — under-water bottom stays flat
      pos0.setX(v, pos0.getX(v) + (Math.random()-0.5) * 1.3);
      pos0.setZ(v, pos0.getZ(v) + (Math.random()-0.5) * 1.3);
      pos0.setY(v, y + Math.random() * 0.5);
    }
  }
  geo = geo.toNonIndexed();                        // crack-free: each face gets one solid colour
  geo.computeVertexNormals();
  paintFacesByHeight(geo, 0x84b075, 0xb59465, 0.07);   // moss top, tan side
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCurve(mat);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function mossyBoulder(r) {
  // Crossy Road / shelf-it approach: a cluster of 3-5 chunky boxes at random
  // positions and small rotations. Each box face is one flat quad → no facet
  // edges, no seam lines, no "cracks" — what you see is what the user wanted.
  const g = new THREE.Group();
  const n = 3 + Math.floor(Math.random() * 3);
  const TOP = new THREE.Color(0x7eb476);     // moss
  const SIDE = new THREE.Color(0x959990);    // stone gray
  for (let i = 0; i < n; i++) {
    const w = r * (0.55 + Math.random() * 0.45);
    const h = r * (0.42 + Math.random() * 0.30);
    const d = r * (0.55 + Math.random() * 0.45);
    let geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    paintBoxByFace(geo, TOP, SIDE, 0.05);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const box = new THREE.Mesh(geo, mat);
    // first box at the bottom centre, the rest stack/scatter around it
    box.position.set(
      (Math.random() - 0.5) * r * 0.5,
      (i === 0 ? h * 0.5 - 0.02 : h * 0.4 + Math.random() * r * 0.25),
      (Math.random() - 0.5) * r * 0.5,
    );
    box.rotation.y = Math.random() * Math.PI * 2;
    box.rotation.x = (Math.random() - 0.5) * 0.20;
    box.rotation.z = (Math.random() - 0.5) * 0.20;
    box.castShadow = true;
    g.add(box);
  }
  return g;
}

// Paint a BoxGeometry (toNonIndexed) so the TOP face (+Y normal) is one
// colour and every other face shares the SIDE colour. BoxGeometry's
// non-indexed vertex order is: +X, -X, +Y, -Y, +Z, -Z faces, 6 vertices
// each (two triangles per face).
function paintBoxByFace(geo, topColor, sideColor, jitter) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let f = 0; f < pos.count; f += 6) {
    const faceIdx = f / 6;                 // 0..5 → +X -X +Y -Y +Z -Z
    const isTop = (faceIdx === 2);         // +Y face = top
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

// ── river rocks ──────────────────────────────────────────────────────────────
export function buildRocks({ count = 16, zStart = -130, zEnd = 130 } = {}) {
  const group = new THREE.Group();
  const length = zEnd - zStart;
  for (let i = 0; i < count; i++) {
    const r = 0.6 + Math.random() * 1.4;
    const rock = mossyBoulder(r);
    // keep rocks away from the very centre lane so a fresh start has a clean path
    const x = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * (RIVER_HALF - 2.4));
    const z = zStart + Math.random() * length;
    rock.position.set(x, 0.05, z);
    rock.rotation.y = Math.random() * Math.PI * 2;
    rock.userData.collide = { r: r * 0.85 };       // collider radius (slightly inside the mesh)
    group.add(rock);

    // contact foam ring on water surface
    const ring = contactFoam(r);
    ring.position.set(x, 0.04, z);
    group.add(ring);
  }
  return group;
}

// Shared splash texture — irregular soft white cloud shape (Tidal Survival
// style). Replaces the previous concentric foam ring which felt mechanical.
let _splashTex = null;
function getSplashTex() {
  if (_splashTex) return _splashTex;
  const SIZE = 128;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  // Several overlapping soft blobs at random offsets → cloud-like irregular alpha
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
  _splashTex = new THREE.CanvasTexture(c);
  return _splashTex;
}

function contactFoam(r) {
  const tex = getSplashTex();
  const geo = new THREE.PlaneGeometry(r * 2.7, r * 2.7, 1, 1);
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
  m.rotation.y = Math.random() * Math.PI * 2;     // random orientation per rock
  return m;
}

// ── lily pads (small clusters floating on water — decoration only) ───────────
export function buildLilyPads({ count = 14, zStart = -130, zEnd = 130 } = {}) {
  const group = new THREE.Group();
  const length = zEnd - zStart;
  for (let i = 0; i < count; i++) {
    // Bias clusters near banks so the centre of the river reads clean — apples
    // (the real pickup) sit in the play lane instead.
    const cx = (Math.random() < 0.5 ? -1 : 1) * (RIVER_HALF * 0.6 + Math.random() * 1.6);
    const cz = zStart + Math.random() * length;
    const cluster = padCluster(2 + Math.floor(Math.random()*3));
    cluster.position.set(cx, 0.03, cz);
    cluster.rotation.y = Math.random() * Math.PI * 2;
    group.add(cluster);
  }
  return group;
}

// ── floating apples (HP pickup — heal +25 on collect) ────────────────────────
//
// Distinct visual signature: shiny red sphere, brown stem nub, single green
// leaf, soft cyan halo under the water. Each apple gently bobs + sways so it
// reads as "alive" / collectable on a glance.
export function buildApples({ count = 5, zStart = -130, zEnd = 130 } = {}) {
  const group = new THREE.Group();
  const length = zEnd - zStart;
  for (let i = 0; i < count; i++) {
    const apple = makeApple();
    const cx = (Math.random() * 2 - 1) * (RIVER_HALF - 2.5);
    const cz = zStart + (i + 0.5 + (Math.random() - 0.5) * 0.6) * (length / count);
    apple.position.set(cx, 0.32, cz);
    apple.rotation.y = Math.random() * Math.PI * 2;
    apple.userData.pickup = { r: 1.0, value: 25, type: 'heal' };
    apple.userData.bobPhase = Math.random() * Math.PI * 2;
    group.add(apple);
  }
  // tick all apples gently (bob + sway)
  group.userData.tick = (t, dt) => {
    for (const apple of group.children) {
      const ph = apple.userData.bobPhase || 0;
      apple.position.y = 0.32 + Math.sin(t * 2.2 + ph) * 0.12;
      apple.rotation.z = Math.sin(t * 1.4 + ph) * 0.08;
      apple.rotation.y += dt * 0.35;
    }
  };
  return group;
}

function makeApple() {
  const g = new THREE.Group();
  // body — slightly squashed icosahedron (already non-indexed by Three's PolyhedronGeometry)
  const bodyGeo = new THREE.IcosahedronGeometry(0.45, 1);
  bodyGeo.scale(1, 0.92, 1);
  bodyGeo.computeVertexNormals();
  paintFacesUniform(bodyGeo, new THREE.Color(0xe83a3a), 0.10);
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCurve(bodyMat);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  g.add(body);
  // stem nub
  const stemGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.18, 6);
  stemGeo.translate(0, 0.42, 0);
  const stemMat = new THREE.MeshLambertMaterial({ color: 0x6b3b1f, flatShading: true });
  applyCurve(stemMat);
  g.add(new THREE.Mesh(stemGeo, stemMat));
  // single leaf
  const leafGeo = new THREE.IcosahedronGeometry(0.16, 0);
  leafGeo.scale(1.4, 0.35, 0.55);
  leafGeo.translate(0.22, 0.46, 0);
  leafGeo.computeVertexNormals();
  paintFacesUniform(leafGeo, new THREE.Color(0x4fb35a), 0.06);
  const leafMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCurve(leafMat);
  g.add(new THREE.Mesh(leafGeo, leafMat));
  // soft glow disk under the apple — reads as "this is collectable"
  const glowGeo = new THREE.CircleGeometry(0.85, 24);
  glowGeo.rotateX(-Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x9bf2a8, transparent: true, opacity: 0.32,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });
  applyCurve(glowMat);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.y = -0.30;
  g.add(glow);
  return g;
}


function padCluster(n) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const r = 0.35 + Math.random() * 0.35;
    let geo = new THREE.CylinderGeometry(r, r * 0.94, 0.04, 8);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    paintFacesUniform(geo, new THREE.Color().setHSL(0.30 + Math.random()*0.05, 0.55, 0.42 + Math.random()*0.06), 0.06);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const pad = new THREE.Mesh(geo, mat);
    pad.position.set((Math.random()-0.5)*1.0, 0, (Math.random()-0.5)*1.0);
    pad.rotation.y = Math.random() * Math.PI * 2;
    g.add(pad);

    // every 2-3 pads, a tiny pink or cream blossom on top
    if (Math.random() < 0.42) {
      const bg = new THREE.IcosahedronGeometry(0.12 + Math.random()*0.05, 0);
      bg.computeVertexNormals();
      const bc = Math.random() < 0.5
        ? new THREE.Color(0xffe6cf)
        : new THREE.Color(0xffc4d6);
      paintFacesUniform(bg, bc, 0.05);
      const bmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      applyCurve(bmat);
      const bud = new THREE.Mesh(bg, bmat);
      bud.position.set(pad.position.x, 0.09, pad.position.z);
      g.add(bud);
    }
  }
  return g;
}

// ── ducks (cosmetic NPC, paddle softly on water) ─────────────────────────────
export function buildDucks({ count = 7, zStart = -130, zEnd = 130 } = {}) {
  const group = new THREE.Group();
  const length = zEnd - zStart;
  const ducks = [];
  for (let i = 0; i < count; i++) {
    const d = duckBuilder();
    d.scale.setScalar(0.55);
    // place near a bank for safety; offset 0.5–2 from bank inward
    const side = Math.random() < 0.5 ? -1 : +1;
    const inset = 0.6 + Math.random() * 2.2;
    const x = side * (RIVER_HALF - inset);
    const z = zStart + Math.random() * length;
    d.position.set(x, -0.06, z);
    d.rotation.y = Math.random() * Math.PI * 2;
    // curve every material — animals.js uses cached StandardMaterials via prims.M()
    d.traverse(o => { if (o.isMesh && o.material) applyCurve(o.material); });
    group.add(d);
    ducks.push({
      mesh: d,
      basePhase: Math.random() * Math.PI * 2,
      baseY: -0.06,
      baseRotY: d.rotation.y,
      driftSpeed: 0.04 + Math.random() * 0.08,
    });
  }
  group.userData.tick = (t, dt) => {
    for (const dk of ducks) {
      const ph = t * 1.3 + dk.basePhase;
      dk.mesh.position.y = dk.baseY + Math.sin(ph) * 0.04;
      dk.mesh.rotation.z = Math.sin(ph * 0.6) * 0.04;
      // very slow drift toward camera (riverflow)
      dk.mesh.position.z += dk.driftSpeed * dt;
      if (dk.mesh.position.z > zEnd) dk.mesh.position.z = zStart;
    }
  };
  return group;
}

// ── pine ribbon (distant) ────────────────────────────────────────────────────
export function buildPineRibbon({ side = -1, distance = 32, zStart = -130, zEnd = 130, count = 70 } = {}) {
  const group = new THREE.Group();
  const length = zEnd - zStart;
  const seg = length / count;
  for (let i = 0; i < count; i++) {
    const z = zStart + seg * (i + 0.5 + (Math.random()-0.5)*0.6);
    const x = side * (distance + (Math.random() - 0.5) * 14);
    const h = 5 + Math.random() * 9;
    const r = 1.2 + Math.random() * 0.9;
    let geo = new THREE.ConeGeometry(r, h, 6);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    paintFacesByHeight(geo, 0x4f8865, 0x305c47, 0.05);  // light at top, dark at base
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applyCurve(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, h * 0.5 - 0.7, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    group.add(m);
  }
  return group;
}

// ── helpers ──────────────────────────────────────────────────────────────────
// Per-face painter: geometry must already be non-indexed. For each triangle
// (3 consecutive vertices) computes a face-centroid Y → blend ratio, samples
// a colour from sideHex (low) to topHex (high), adds per-face jitter, then
// writes that ONE colour to all three vertices of the triangle. Result with
// flatShading = clean painterly facet blocks, no inter-face colour gradients
// (the "cracks").
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

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
