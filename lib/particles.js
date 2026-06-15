// particles.js — pooled voxel-cube splash + golden sparkle bursts.
//
// Pools, prebuilt at startup:
//   • splash (white)  — bow + impact + capsize water spray
//   • sparkle (gold)  — score sparkle (legacy)
//   • heal    (green) — HP pickup green flutter
//   • ring    (white) — flat water-level disks that expand outward (impact / capsize ripples)
//
// Splash + sparkle + heal particles fly with gravity. Ring particles stay
// at water level and grow in scale while fading.

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=8';

const GRAVITY = 16;            // m/s² downward

export function createParticles({ scene, splashCount = 220, sparkleCount = 24, healCount = 40, ringCount = 14 }) {
  const splashGeo  = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const sparkleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const healGeo    = new THREE.BoxGeometry(0.16, 0.16, 0.16);

  function makePool(count, geo, color) {
    const pool = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, depthWrite: false, fog: true,
      });
      applyCurve(mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = -100; m.visible = false;
      scene.add(m);
      pool.push({ mesh: m, life: 0, maxLife: 0, vel: new THREE.Vector3(), gravity: GRAVITY });
    }
    return pool;
  }

  const splash  = makePool(splashCount,  splashGeo,  0xffffff);
  const sparkle = makePool(sparkleCount, sparkleGeo, 0xffd86a);
  const heal    = makePool(healCount,    healGeo,    0x6ee37a);

  // ── water-level ring pool (flat disks that expand) ────────────────────────
  const ringGeo = new THREE.RingGeometry(0.6, 0.78, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < ringCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    applyCurve(mat);
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.y = -100; m.visible = false;
    scene.add(m);
    rings.push({ mesh: m, life: 0, maxLife: 0, growRate: 0 });
  }

  function _acquire(pool) {
    for (const p of pool) if (p.life <= 0) return p;
    return null;
  }

  function _emit(pool, x, y, z, vx, vy, vz, life, scale = 1, gravity = GRAVITY) {
    const p = _acquire(pool);
    if (!p) return;
    p.mesh.position.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.life = life; p.maxLife = life;
    p.gravity = gravity;
    p.mesh.scale.setScalar(scale);
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
  }

  // Continuous bow trickle — called every frame, emits a small splash.
  function bowSpray(x, y, z, speed, n = 2) {
    if (speed < 4) return;
    for (let i = 0; i < n; i++) {
      const spread = 0.6 + Math.random() * 0.4;
      const vx = (Math.random() - 0.5) * spread * 2.0;
      const vy = 1.6 + Math.random() * 1.6;
      const vz = 1.0 + Math.random() * 1.5;     // backward (camera-ward)
      _emit(splash, x + (Math.random() - 0.5) * 0.7, y + 0.05, z, vx, vy, vz,
            0.35 + Math.random() * 0.25,
            0.7 + Math.random() * 0.35);
    }
  }

  // Directional plume — for boat-rock impacts. Particles fly UP and AWAY from
  // the rock along (nx, nz), with sideways scatter. Scales with impactMag.
  function impactPlume(x, z, nx, nz, mag, count = 28) {
    // perpendicular for scatter
    const px = -nz, pz = nx;
    const power = Math.max(2, Math.min(7, mag * 0.7 + 2.5));
    for (let i = 0; i < count; i++) {
      const lateral = (Math.random() - 0.5) * 1.8;
      const forward = 0.6 + Math.random() * 1.4;
      const vx = nx * power * forward + px * lateral;
      const vz = nz * power * forward + pz * lateral;
      const vy = 2.4 + Math.random() * power * 0.8;
      _emit(splash, x + nx * 0.4, 0.18, z + nz * 0.4,
            vx, vy, vz,
            0.5 + Math.random() * 0.4,
            0.85 + Math.random() * 0.45);
    }
  }

  // Slow, heavy fountains for capsize moments. Use multiple times during the
  // dying animation for staggered bursts.
  function capsizeBurst(x, y, z, count = 24) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = 2.5 + Math.random() * 2.4;
      const vx = Math.cos(angle) * r;
      const vy = 2.8 + Math.random() * 3.6;
      const vz = Math.sin(angle) * r;
      _emit(splash, x, y + 0.1, z, vx, vy, vz,
            0.6 + Math.random() * 0.4,
            0.9 + Math.random() * 0.55);
    }
  }

  // Slow heavy "glug" — bubbles + droplets for boat going under.
  function submergeBurst(x, y, z, count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 1.0;
      const vx = Math.cos(angle) * r;
      const vy = 0.6 + Math.random() * 1.4;
      const vz = Math.sin(angle) * r;
      _emit(splash, x + (Math.random()-0.5)*0.6, y, z + (Math.random()-0.5)*0.6,
            vx, vy, vz,
            0.8 + Math.random() * 0.4,
            0.5 + Math.random() * 0.5,
            8);              // softer gravity = bubbles floating up briefly
    }
  }

  // Flat ring at water level — emanates from a point.
  function ripple(x, z, growRate = 6, life = 0.55, startScale = 0.8) {
    let p = null;
    for (const r of rings) if (r.life <= 0) { p = r; break; }
    if (!p) return;
    p.mesh.position.set(x, 0.03, z);
    p.mesh.scale.setScalar(startScale);
    p.mesh.material.opacity = 0.85;
    p.life = life; p.maxLife = life;
    p.growRate = growRate;
    p.mesh.visible = true;
  }

  // Pickup sparkle — small gold flutter (legacy)
  function pickupSparkle(x, y, z, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.8;
      const vx = Math.cos(angle) * r;
      const vy = 1.8 + Math.random() * 1.4;
      const vz = Math.sin(angle) * r;
      _emit(sparkle, x, y + 0.15, z, vx, vy, vz,
            0.55 + Math.random() * 0.30,
            0.6 + Math.random() * 0.4);
    }
  }

  // HP-heal sparkle — green flutter from a pickup.
  function healFlourish(x, y, z, count = 18) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 1.0;
      const vx = Math.cos(angle) * r;
      const vy = 2.2 + Math.random() * 2.0;
      const vz = Math.sin(angle) * r;
      _emit(heal, x, y + 0.18, z, vx, vy, vz,
            0.7 + Math.random() * 0.35,
            0.65 + Math.random() * 0.45,
            10);   // slightly softer gravity for floatier feel
    }
  }

  function _tickPool(pool, dt) {
    for (const p of pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;
      const t = Math.max(0, p.life / p.maxLife);
      p.mesh.material.opacity = t * 0.95;
      p.mesh.rotation.x += dt * 3;
      p.mesh.rotation.z += dt * 2.4;
      if (p.life <= 0 || p.mesh.position.y < 0) {
        p.life = 0;
        p.mesh.visible = false;
        p.mesh.position.y = -100;
      }
    }
  }

  function _tickRings(dt) {
    for (const r of rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const cur = r.mesh.scale.x + r.growRate * dt;
      r.mesh.scale.setScalar(cur);
      const t = Math.max(0, r.life / r.maxLife);
      r.mesh.material.opacity = t * 0.85;
      if (r.life <= 0) {
        r.mesh.visible = false;
        r.mesh.position.y = -100;
      }
    }
  }

  function tick(dt) {
    _tickPool(splash,  dt);
    _tickPool(sparkle, dt);
    _tickPool(heal,    dt);
    _tickRings(dt);
  }

  return {
    bowSpray, impactPlume, capsizeBurst, submergeBurst, ripple,
    pickupSparkle, healFlourish, tick,
  };
}
