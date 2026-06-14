// particles.js — pooled voxel-cube splash + golden sparkle bursts.
//
// Two pools, prebuilt at startup:
//   • splash (white)  — bow + capsize water spray
//   • sparkle (gold)  — lily-pad pickups
//
// Each particle is a tiny BoxGeometry (low-poly, matches the painterly
// style — no Points/billboards). Shared geometry; individual materials so we
// can fade opacity per-particle.
//
// Gravity drags particles back down; once their y dips below 0 they snap to
// inactive. Lifetime fades opacity to zero linearly.

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=4';

const GRAVITY = 16;            // m/s² downward

export function createParticles({ scene, splashCount = 80, sparkleCount = 32 }) {
  const splashGeo  = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const sparkleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);

  function makePool(count, geo, color) {
    const pool = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true,
      });
      applyCurve(mat);                     // particles must sink with the world
      const m = new THREE.Mesh(geo, mat);
      m.position.y = -100;                 // park below the world when idle
      m.visible = false;
      scene.add(m);
      pool.push({ mesh: m, life: 0, maxLife: 0, vel: new THREE.Vector3() });
    }
    return pool;
  }

  const splash = makePool(splashCount, splashGeo, 0xffffff);
  const sparkle = makePool(sparkleCount, sparkleGeo, 0xffd86a);

  function _acquire(pool) {
    for (const p of pool) if (p.life <= 0) return p;
    return null;
  }

  function _emit(pool, x, y, z, vx, vy, vz, life, scale = 1) {
    const p = _acquire(pool);
    if (!p) return;
    p.mesh.position.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.life = life; p.maxLife = life;
    p.mesh.scale.setScalar(scale);
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
  }

  // Continuous bow trickle — called every frame, only emits N per call.
  function bowSpray(x, y, z, speed, n = 2) {
    if (speed < 4) return;                 // boat moving too slow → no spray
    for (let i = 0; i < n; i++) {
      const spread = 0.6 + Math.random() * 0.4;
      const vx = (Math.random() - 0.5) * spread * 2.0;
      const vy = 1.6 + Math.random() * 1.6;
      const vz = 1.0 + Math.random() * 1.5;    // particles fly BACKWARD (camera ward)
      _emit(splash, x + (Math.random() - 0.5) * 0.7, y + 0.05, z, vx, vy, vz,
            0.35 + Math.random() * 0.25,
            0.7 + Math.random() * 0.35);
    }
  }

  // One big radial burst — for capsize impact
  function capsizeBurst(x, y, z, count = 24) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = 2.5 + Math.random() * 2;
      const vx = Math.cos(angle) * r;
      const vy = 3 + Math.random() * 3.5;
      const vz = Math.sin(angle) * r;
      _emit(splash, x, y + 0.1, z, vx, vy, vz,
            0.55 + Math.random() * 0.35,
            0.9 + Math.random() * 0.5);
    }
  }

  // Pickup sparkle — small gold flutter, slower & longer fade
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

  function _tickPool(pool, dt) {
    for (const p of pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= GRAVITY * dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;
      const t = Math.max(0, p.life / p.maxLife);
      p.mesh.material.opacity = t * 0.95;
      p.mesh.rotation.x += dt * 3;          // tumble
      p.mesh.rotation.z += dt * 2.4;
      if (p.life <= 0 || p.mesh.position.y < 0) {
        p.life = 0;
        p.mesh.visible = false;
        p.mesh.position.y = -100;
      }
    }
  }

  function tick(dt) {
    _tickPool(splash, dt);
    _tickPool(sparkle, dt);
  }

  return { bowSpray, capsizeBurst, pickupSparkle, tick };
}
