// water.js — painterly water + drifting speed lane.
//
//   L0 base  — flat-shaded plane, vertex-color HSL noise per face,
//              fragment lerps toward a deeper cyan with distance
//   L1 waves — sin+cos vertex displacement composed into the curve shader
//   L2 foam  — UV-scrolled canvas-noise plane just above L0
//   L3 lane  — drifting bright current the player wants to ride for a speed
//              boost. Replaces the old static sun-glint band.
//
// Group exposes:
//   userData.tick(t, dt)               per-frame uniforms/textures + lane move
//   userData.setSegment(t)             biome palette lerp
//   userData.isInLane(boatX) → bool    true when boat is over the lane (±half-width)
//   userData.laneX(): number           current world x of the lane centre

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=7';

const LANE_HALF_WIDTH = 1.75;       // ±half-width of the boost band, in metres

export function buildWater({ width = 60, length = 700 } = {}) {
  const group = new THREE.Group();

  // ── L0 base ─────────────────────────────────────────────────────────────────
  let geo = new THREE.PlaneGeometry(width, length, 30, 96);
  geo.rotateX(-Math.PI / 2);
  geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0x4cc8d4);
  const tmp = new THREE.Color();
  const hsl = {};
  base.getHSL(hsl);
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
    fog: false,
  });
  applyCurve(waterMat, {
    vertexInsert: `
      float _wave = sin(_wp.x*0.58 + uTime*1.10) * 0.058
                  + cos(_wp.z*0.46 + uTime*0.74) * 0.046
                  + sin((_wp.x+_wp.z)*0.31 + uTime*0.62) * 0.022;
      transformed.y += _wave;
    `,
    // Distance fade — far water gets darker / desaturated so the river reads as
    // receding into atmosphere (instead of one flat cyan tile from foreground
    // to horizon). vCamDist is set by applyCurve's vertex pass (camera-space
    // XZ distance in metres).
    fragmentInsert: `
      vec3 _deepWater = vec3(0.082, 0.262, 0.355);   // deep teal-blue
      float _fade = smoothstep(18.0, 130.0, vCamDist);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, _deepWater, _fade * 0.62);
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
    map: foamTex, transparent: true, opacity: 0.55,
    depthWrite: false, fog: true,
  });
  applyCurve(foamMat);
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.position.y = 0.025;
  group.add(foam);

  // ── L3 speed lane ──────────────────────────────────────────────────────────
  // The lane is a tall narrow plane drifting laterally across the river.
  // Texture animates fast-forward chevrons. Players who row down its middle
  // get a speed boost (queried via group.userData.isInLane).
  const laneTex = makeLaneTexture();
  laneTex.wrapS = laneTex.wrapT = THREE.RepeatWrapping;
  laneTex.repeat.set(1, 14);
  const laneGeo = new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, length, 1, 1);
  laneGeo.rotateX(-Math.PI / 2);
  const laneMat = new THREE.MeshBasicMaterial({
    map: laneTex, transparent: true, opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false, fog: true,
  });
  applyCurve(laneMat);
  const lane = new THREE.Mesh(laneGeo, laneMat);
  lane.position.y = 0.04;
  group.add(lane);

  // ── lane drift state ───────────────────────────────────────────────────────
  // X position lerps smoothly between random hold points so the lane "snakes".
  const LANE_RANGE = width * 0.4;       // keeps lane comfortably inside river half
  let laneX = 0;
  let laneTargetX = 0;
  let laneHoldT = 0;
  // initial offset so it doesn't sit at 0 on load
  laneTargetX = (Math.random() * 2 - 1) * LANE_RANGE;

  group.userData.tick = (t, dt) => {
    foamTex.offset.y += dt * 0.05;
    foamTex.offset.x = Math.sin(t * 0.13) * 0.04;
    laneTex.offset.y -= dt * 0.95;     // fast forward scroll = "current flowing"

    laneHoldT -= dt;
    if (laneHoldT <= 0) {
      laneTargetX = (Math.random() * 2 - 1) * LANE_RANGE;
      laneHoldT = 4.5 + Math.random() * 3.5;
    }
    laneX += (laneTargetX - laneX) * Math.min(1, dt * 0.45);
    lane.position.x = laneX;
  };

  // ── biome palette lerp ─────────────────────────────────────────────────────
  const TINT_TEMPERATE = new THREE.Color(0xffffff);
  const TINT_CANYON    = new THREE.Color(0x9ec6d6);
  group.userData.setSegment = (t) => {
    waterMat.color.copy(TINT_TEMPERATE).lerp(TINT_CANYON, t);
    foamMat.opacity = 0.55 - t * 0.20;
  };

  group.userData.isInLane = (worldX) => Math.abs(worldX - laneX) < LANE_HALF_WIDTH;
  group.userData.laneX = () => laneX;

  return group;
}

function makeFoamTexture() {
  const SIZE = 256;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
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
  for (let i = 0; i < 36; i++) {
    const x = Math.random() * SIZE, y = Math.random() * SIZE;
    const len = 16 + Math.random() * 50;
    const w = 1 + Math.random() * 1.8;
    const a = 0.08 + Math.random() * 0.16;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.25);
    ctx.fillRect(-len/2, -w/2, len, w);
    ctx.restore();
  }
  return new THREE.CanvasTexture(c);
}

function makeLaneTexture() {
  // Vertical strip; bright chevron-streak pattern that scrolls along Y to look
  // like a fast-flowing current. Soft edges so it blends with the water.
  const W = 64, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // soft edge falloff column — base glow
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,   'rgba(180,240,255,0)');
  grad.addColorStop(0.5, 'rgba(220,250,255,0.42)');
  grad.addColorStop(1,   'rgba(180,240,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // chevron streaks pointing forward
  for (let i = 0; i < 14; i++) {
    const y = (i / 14) * H + (i % 2 ? 6 : 0);
    const cx = W / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx - 18, y + 16);
    ctx.lineTo(cx - 12, y + 16);
    ctx.lineTo(cx, y + 6);
    ctx.lineTo(cx + 12, y + 16);
    ctx.lineTo(cx + 18, y + 16);
    ctx.closePath();
    ctx.fill();
  }
  // sparkle dots
  for (let i = 0; i < 70; i++) {
    const x = W * (0.2 + Math.random() * 0.6);
    const y = Math.random() * H;
    const r = 0.7 + Math.random() * 1.8;
    ctx.fillStyle = `rgba(255,255,255,${0.55 + Math.random()*0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
