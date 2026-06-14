// gameplay.js — River Row auto-cruise + steer-only core loop.
//
// State machine:
//   preroll   first frame after load / after restart, boat sits centred.
//             First touch flips → play.
//   play      Boat cruises forward automatically. Touch / drag x position
//             steers the boat left/right (no charge mechanic). Riding the
//             drifting bright "speed lane" gives a boost. Rocks bounce the
//             boat (springy reflection + yaw spin + dip + camera kick) and
//             damage an HP bar that auto-regens slowly. Apples pickup heal HP.
//             0 HP → dying.
//   dying     Physics-driven capsize: boat keeps drifting, rolls under angular
//             momentum, slowly sinks; rower flung from the bench under gravity;
//             water splashes in staggered bursts.
//   dead      HUD shows final score and restart prompt. Next touch → preroll.

import * as THREE from 'three';

const RIVER_HALF = 9;
const BOAT_R = 0.95;

// ── motion (auto-cruise + steer) ──────────────────────────────────────────
const BASE_VZ            = -10.2;   // base forward speed (m/s, -z is forward)
const BOOST_VZ           = -14.2;   // forward speed while riding the speed lane
const VZ_LERP            = 1.8;     // how fast vz tracks the target speed
const STEER_MAX_VX       = 7.0;     // peak lateral m/s when finger is pinned to the edge
const STEER_LERP         = 6.0;     // how quickly vx tracks the steering target
const STEER_DEADZONE     = 0.08;    // fraction of width around centre with zero steer

// ── HP / damage / regen ───────────────────────────────────────────────────
const HP_MAX             = 100;
const HP_REGEN           = 4.5;     // per second
const HP_BASE_DMG        = 9;
const HP_DMG_FACTOR      = 2.4;     // dmg = base + impactSpeed × factor

// ── impact physics (alive boat) ───────────────────────────────────────────
const RESTITUTION        = 0.55;    // energy retained in linear reflection
const TANGENT_FRICTION   = 0.65;    // tangential velocity damping on a hit
const YAW_SPIN_FACTOR    = 1.6;     // tangential speed → angular kick
const BOB_SPRING_K       = 38;      // bob position spring constant (1/s²)
const BOB_DAMP           = 0.05;    // bob velocity damp per second
const ROWER_JOLT_DECAY   = 0.02;    // rower lean returns to neutral fast
const CAM_KICK_DECAY     = 0.012;   // camera kick decays
const INVULN_T           = 0.35;    // post-hit grace before next collision counts
const HIT_SLOMO_T        = 0.10;    // brief slow-mo window on big hits
const HIT_SLOMO_TRIGGER  = 4.0;     // impact mag needed to trigger slow-mo

// ── camera (play) ─────────────────────────────────────────────────────────
const CAM_HEIGHT         = 4.8;
const CAM_BACK           = 8.5;
const CAM_LOOK_AHEAD     = 22.0;
const CAM_LOOK_Y         = 0.5;
const CAM_LERP           = 7.0;

// ── camera (preroll cinematic) ────────────────────────────────────────────
const CAM_PREROLL_HEIGHT     = 4.4;
const CAM_PREROLL_BACK       = 11.5;
const CAM_PREROLL_LOOK_AHEAD = 10.0;
const CAM_PREROLL_LOOK_Y     = 0.6;

const PUSH_IN_T  = 1.0;

// ── death ──────────────────────────────────────────────────────────────────
const DEATH_T_END = 1.9;
const ROWER_GRAVITY = 9.8;

export function createGameplay({ boat, camera, scene, water, segments, colliders, pickups, hud, baseRowerRot, particles, wake, world }) {
  const state = {
    phase: 'preroll',
    score: 0,
    best: parseInt(localStorage.getItem('rr.best') || '0', 10),
    deathT: 0,
    hp: HP_MAX,
    pushT: 0,
    boostT: 0,                 // > 0 while riding lane (for HUD smoothing)
    inLane: false,
    // velocity-driven motion
    vx: 0, vz: 0,
    steerTarget: 0,            // -1..+1 — where the finger is relative to centre
    steering: false,
    // angular + spring physics (alive boat)
    yawVel: 0,
    yawOffset: 0,
    bobY: 0,
    bobVel: 0,
    rowerJolt: 0,
    camKickX: 0, camKickZ: 0,
    invulnT: 0,
    slomoT: 0,
    lastImpactNx: 1, lastImpactNz: 0,
    // death physics
    rollVel: 0, rollAcc: 0,
    sinkY: 0,
    dyingVx: 0, dyingVz: 0,
    rowerLocalX: 0, rowerLocalY: 0, rowerLocalZ: 0,
    rowerVx: 0, rowerVy: 0, rowerVz: 0,
    rowerRotX: 0, rowerRotZ: 0, rowerSpinX: 0, rowerSpinZ: 0,
    burstQueue: [],            // [{at, count}, ...]
    // scoring
    _scoreAcc: 0,
  };

  state.RIVER_HALF = RIVER_HALF;

  function reset() {
    state.phase = 'preroll';
    state.score = 0;
    state.deathT = 0;
    state._scoreAcc = 0;
    state.hp = HP_MAX;
    state.pushT = 0;
    state.boostT = 0;
    state.inLane = false;
    state.vx = 0; state.vz = 0;
    state.steerTarget = 0;
    state.steering = false;
    state.yawVel = 0;
    state.yawOffset = 0;
    state.bobY = 0;
    state.bobVel = 0;
    state.rowerJolt = 0;
    state.camKickX = 0;
    state.camKickZ = 0;
    state.invulnT = 0;
    state.slomoT = 0;
    state.lastImpactNx = 1;
    state.lastImpactNz = 0;
    state.rollVel = 0;
    state.rollAcc = 0;
    state.sinkY = 0;
    state.dyingVx = 0;
    state.dyingVz = 0;
    state.rowerLocalX = 0; state.rowerLocalY = 0; state.rowerLocalZ = 0;
    state.rowerVx = 0; state.rowerVy = 0; state.rowerVz = 0;
    state.rowerRotX = 0; state.rowerRotZ = 0;
    state.rowerSpinX = 0; state.rowerSpinZ = 0;
    state.burstQueue.length = 0;
    boat.position.set(0, 0.05, 50);
    camera.position.set(0, CAM_PREROLL_HEIGHT, 50 + CAM_PREROLL_BACK);
    camera.lookAt(0, CAM_PREROLL_LOOK_Y, 50 - CAM_PREROLL_LOOK_AHEAD);
    boat.rotation.set(0, 0, 0);
    boat.userData.skipRowerAnim = false;
    boat.userData.bobY = 0;
    boat.userData.rowerJoltAmt = 0;
    boat.userData.rowFreq = 0.4;
    if (boat.userData.rower) {
      boat.userData.rower.rotation.set(baseRowerRot.x, baseRowerRot.y, baseRowerRot.z);
      boat.userData.rower.position.set(boat.userData.seatPos.x, -0.18, boat.userData.seatPos.z);
    }
    if (pickups) for (const p of pickups) p.group.visible = true;
    if (world) world.reset(boat.position.z);
    hud.setScore(0);
    hud.setBest(state.best);
    hud.setPhase('preroll');
    if (hud.setHp)    hud.setHp(state.hp);
    if (hud.setBoost) hud.setBoost(false);
  }

  function startPlay() {
    state.phase = 'play';
    state.pushT = 0;
    hud.setPhase('play');
  }

  function die(impactNx, impactNz, impactMag) {
    state.phase = 'dying';
    state.deathT = 0;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('rr.best', String(state.best));
    }
    // capture motion so the boat KEEPS drifting and rotating into the death
    state.dyingVx = state.vx;
    state.dyingVz = state.vz;
    // roll AWAY from the impact: nx > 0 → impact on the right side → tip right
    const rollSign = -Math.sign(impactNx || state.lastImpactNx || 1) || 1;
    state.rollVel = rollSign * (1.6 + Math.min(2.0, (impactMag || 4) * 0.18));
    state.rollAcc = boat.rotation.z;
    // rower flies in the direction of impact velocity transfer (away from the rock)
    state.rowerVx = -impactNx * (1.4 + (impactMag || 4) * 0.25);
    state.rowerVy = 3.0 + Math.min(2.5, (impactMag || 4) * 0.15);
    state.rowerVz = -impactNz * (1.0 + (impactMag || 4) * 0.20) + state.dyingVz * 0.35;
    state.rowerLocalX = boat.userData.seatPos.x;
    state.rowerLocalY = -0.18;
    state.rowerLocalZ = boat.userData.seatPos.z;
    state.rowerRotX = baseRowerRot.x;
    state.rowerRotZ = 0;
    state.rowerSpinX = 4.5 + Math.random() * 2.0;
    state.rowerSpinZ = -rollSign * (3.0 + Math.random() * 1.5);
    boat.userData.skipRowerAnim = true;
    // queued splash bursts during the dying animation
    state.burstQueue.length = 0;
    state.burstQueue.push({ at: 0.00, kind: 'capsize', n: 30 });
    state.burstQueue.push({ at: 0.45, kind: 'capsize', n: 18 });
    state.burstQueue.push({ at: 1.05, kind: 'submerge', n: 22 });
    if (particles && particles.ripple) particles.ripple(boat.position.x, boat.position.z, 9, 0.8, 1.4);
  }

  function finishDeath() {
    state.phase = 'dead';
    hud.setPhase('dead');
    hud.setDeath({ score: state.score, best: state.best });
  }

  // ── per-frame tick ─────────────────────────────────────────────────────────
  function tick(dt) {
    if (state.phase === 'preroll') {
      camera.position.x += (0 - camera.position.x) * Math.min(1, dt * CAM_LERP);
      camera.position.y = CAM_PREROLL_HEIGHT;
      camera.position.z += ((boat.position.z + CAM_PREROLL_BACK) - camera.position.z) * Math.min(1, dt * CAM_LERP);
      camera.lookAt(boat.position.x, CAM_PREROLL_LOOK_Y, boat.position.z - CAM_PREROLL_LOOK_AHEAD);
      // idle row at slow cadence while waiting
      boat.userData.rowFreq = 0.3;
      return;
    }

    if (state.phase === 'play') {
      // slow-mo dilation
      const effDt = state.slomoT > 0 ? dt * 0.4 : dt;
      if (state.slomoT > 0) state.slomoT = Math.max(0, state.slomoT - dt);

      // ── speed lane check ────────────────────────────────────────────────
      const inLane = water && water.userData.isInLane
        ? water.userData.isInLane(boat.position.x)
        : false;
      if (inLane !== state.inLane) {
        state.inLane = inLane;
        if (hud.setBoost) hud.setBoost(inLane);
      }

      // ── motion target ───────────────────────────────────────────────────
      const targetVz = inLane ? BOOST_VZ : BASE_VZ;
      state.vz += (targetVz - state.vz) * Math.min(1, effDt * VZ_LERP);

      // lateral: steerTarget in -1..+1 maps to ±STEER_MAX_VX
      const steerVal = state.steering
        ? Math.abs(state.steerTarget) < STEER_DEADZONE ? 0 : state.steerTarget
        : 0;
      const targetVx = steerVal * STEER_MAX_VX;
      state.vx += (targetVx - state.vx) * Math.min(1, effDt * STEER_LERP);

      // integrate
      boat.position.x += state.vx * effDt;
      boat.position.z += state.vz * effDt;

      // clamp lateral
      if (boat.position.x > RIVER_HALF)  { boat.position.x = RIVER_HALF;  if (state.vx > 0) state.vx = 0; }
      if (boat.position.x < -RIVER_HALF) { boat.position.x = -RIVER_HALF; if (state.vx < 0) state.vx = 0; }

      // ── yaw spring + impact-driven angular momentum ─────────────────────
      const bank = THREE.MathUtils.clamp(-state.vx * 0.06, -0.4, 0.4);
      state.yawOffset += state.yawVel * effDt;
      state.yawVel    *= Math.pow(0.08, effDt);
      state.yawOffset *= Math.pow(0.18, effDt);
      boat.rotation.y = bank + state.yawOffset;

      // ── bob spring (vertical dip after impact returns) ──────────────────
      state.bobVel += -state.bobY * BOB_SPRING_K * effDt;
      state.bobVel *= Math.pow(BOB_DAMP, effDt);
      state.bobY   += state.bobVel * effDt;
      boat.userData.bobY = state.bobY;

      // ── rower jolt decay ────────────────────────────────────────────────
      state.rowerJolt *= Math.pow(ROWER_JOLT_DECAY, effDt);
      boat.userData.rowerJoltAmt = state.rowerJolt;

      // ── camera kick decay ───────────────────────────────────────────────
      state.camKickX *= Math.pow(CAM_KICK_DECAY, effDt);
      state.camKickZ *= Math.pow(CAM_KICK_DECAY, effDt);

      // ── invuln decay ────────────────────────────────────────────────────
      if (state.invulnT > 0) state.invulnT = Math.max(0, state.invulnT - dt);

      // ── HP regen ────────────────────────────────────────────────────────
      state.hp = Math.min(HP_MAX, state.hp + HP_REGEN * effDt);
      if (hud.setHp) hud.setHp(state.hp);

      // ── row-cadence scales with speed
      const speedNorm = THREE.MathUtils.clamp((-state.vz - 3) / 12, 0, 1);
      boat.userData.rowFreq = 0.4 + speedNorm * 0.6;

      // ── distance score (only forward motion counts)
      const dz = state.vz * effDt;
      if (dz < 0) state._scoreAcc -= dz;
      state.score = Math.floor(state._scoreAcc);

      // ── bow splash when moving fast
      if (particles) {
        const speed = Math.hypot(state.vx, state.vz);
        if (speed > 4) {
          const bx = boat.position.x;
          const bz = boat.position.z - 1.55;
          particles.bowSpray(bx, 0.12, bz, speed, (speed > 12 || inLane) ? 2 : 1);
        }
      }

      // ── wake scales with speed
      if (wake) {
        const speed = Math.hypot(state.vx, state.vz);
        wake.scale.z = THREE.MathUtils.clamp(speed / 14, 0.5, 1.8);
      }

      // ── collision check — physics-driven bounce + damage ────────────────
      if (state.invulnT <= 0) {
        const bx = boat.position.x, bz = boat.position.z;
        for (const c of colliders) {
          const ddx = bx - c.x;
          const ddz = bz - c.z;
          const rsum = c.r + BOAT_R;
          const d2 = ddx*ddx + ddz*ddz;
          if (d2 < rsum*rsum) {
            const dist = Math.max(0.01, Math.sqrt(d2));
            const nx = ddx / dist, nz = ddz / dist;
            // push out of overlap
            const overlap = rsum - dist + 0.04;
            boat.position.x += nx * overlap;
            boat.position.z += nz * overlap;
            // reflect linear velocity only if heading INTO the rock
            const vDotN = state.vx * nx + state.vz * nz;
            let impactMag = 0;
            if (vDotN < 0) {
              impactMag = -vDotN;
              // reflection
              state.vx -= (1 + RESTITUTION) * vDotN * nx;
              state.vz -= (1 + RESTITUTION) * vDotN * nz;
              // tangential friction along the rock surface
              const tx = -nz, tz = nx;
              const tDotV = state.vx * tx + state.vz * tz;
              state.vx -= tDotV * (1 - TANGENT_FRICTION) * tx;
              state.vz -= tDotV * (1 - TANGENT_FRICTION) * tz;
              // tangential velocity becomes angular kick (boat pivots around the rock)
              state.yawVel += tDotV * YAW_SPIN_FACTOR * 0.06;
            }
            // damage scales with impact speed
            const dmg = HP_BASE_DMG + impactMag * HP_DMG_FACTOR;
            state.hp = Math.max(0, state.hp - dmg);
            if (hud.setHp) hud.setHp(state.hp);
            // bob: punch down into the water then spring back
            state.bobVel -= 0.5 + impactMag * 0.18;
            // rower jolted forward (impact slams them into the prow)
            state.rowerJolt = Math.max(state.rowerJolt, 0.30 + impactMag * 0.04);
            // camera punch INTO the impact (boat-frame: away from rock)
            const kick = 0.18 + impactMag * 0.10;
            state.camKickX += -nx * kick;
            state.camKickZ += -nz * kick;
            // directional water plume + flat ripple
            if (particles) {
              const px = c.x + nx * c.r * 0.9;
              const pz = c.z + nz * c.r * 0.9;
              if (particles.impactPlume) particles.impactPlume(px, pz, nx, nz, impactMag);
              else                       particles.capsizeBurst(px, 0.18, pz, 18);
              if (particles.ripple)      particles.ripple(px, pz, 8, 0.55, 0.7);
            }
            // brief slow-mo on big hits
            if (impactMag >= HIT_SLOMO_TRIGGER) state.slomoT = HIT_SLOMO_T;
            // invuln so we don't double-tag the same rock
            state.invulnT = INVULN_T;
            state.lastImpactNx = nx;
            state.lastImpactNz = nz;
            // death check
            if (state.hp <= 0) {
              die(nx, nz, impactMag);
            }
            break;     // resolve only one collision per frame
          }
        }
      }

      // ── pickup check (apples = heal HP) ─────────────────────────────────
      if (pickups) {
        for (const p of pickups) {
          if (!p.group.visible) continue;
          const ddx = boat.position.x - p.x;
          const ddz = boat.position.z - p.z;
          const rsum = p.r + BOAT_R;
          if (ddx*ddx + ddz*ddz < rsum*rsum) {
            p.group.visible = false;
            if (p.type === 'heal') {
              state.hp = Math.min(HP_MAX, state.hp + p.value);
              if (hud.setHp) hud.setHp(state.hp);
              if (particles && particles.healFlourish) particles.healFlourish(p.x, 0.4, p.z, 20);
            } else {
              state._scoreAcc += p.value;
              if (particles) particles.pickupSparkle(p.x, 0.15, p.z, 12);
            }
          }
        }
      }

      hud.setScore(state.score);
    }

    if (state.phase === 'dying') {
      state.deathT += dt;
      // boat keeps drifting forward but quickly decays linearly
      state.dyingVx *= Math.pow(0.18, dt);
      state.dyingVz *= Math.pow(0.34, dt);
      boat.position.x += state.dyingVx * dt;
      boat.position.z += state.dyingVz * dt;
      // angular momentum: rotation.z rolls under decaying velocity
      state.rollVel *= Math.pow(0.5, dt);
      state.rollAcc += state.rollVel * dt;
      boat.rotation.z = state.rollAcc;
      // bow drops as the hull fills with water
      boat.rotation.x = THREE.MathUtils.clamp(state.deathT * 0.45, 0, 0.6);
      // boat sinks gradually
      state.sinkY = -Math.min(0.45, state.deathT * state.deathT * 0.6);
      boat.position.y = 0.05 + state.sinkY;
      boat.userData.bobY = 0;     // we override Y directly during dying
      // rower: integrate gravity + tumble
      state.rowerVy -= ROWER_GRAVITY * dt;
      state.rowerLocalX += state.rowerVx * dt;
      state.rowerLocalY += state.rowerVy * dt;
      state.rowerLocalZ += state.rowerVz * dt;
      state.rowerRotX += state.rowerSpinX * dt;
      state.rowerRotZ += state.rowerSpinZ * dt;
      const rower = boat.userData.rower;
      if (rower) {
        rower.position.set(state.rowerLocalX, state.rowerLocalY, state.rowerLocalZ);
        rower.rotation.x = baseRowerRot.x + state.rowerRotX;
        rower.rotation.z = state.rowerRotZ;
      }
      // staggered splash bursts
      for (const b of state.burstQueue) {
        if (!b.done && state.deathT >= b.at) {
          b.done = true;
          if (particles) {
            if (b.kind === 'submerge' && particles.submergeBurst) {
              particles.submergeBurst(boat.position.x, 0.1, boat.position.z, b.n);
            } else {
              particles.capsizeBurst(boat.position.x, 0.18, boat.position.z, b.n);
            }
            if (particles.ripple) particles.ripple(boat.position.x, boat.position.z, 7, 0.6, 1.0);
          }
        }
      }
      if (state.deathT >= DEATH_T_END) finishDeath();
    }

    // ── camera follow + push-in (always runs) ─────────────────────────────
    state.pushT = Math.min(PUSH_IN_T, state.pushT + dt);
    const u = THREE.MathUtils.smoothstep(state.pushT / PUSH_IN_T, 0, 1);
    const camHeight    = THREE.MathUtils.lerp(CAM_PREROLL_HEIGHT, CAM_HEIGHT, u);
    const camBack      = THREE.MathUtils.lerp(CAM_PREROLL_BACK, CAM_BACK, u);
    const camLookAhead = THREE.MathUtils.lerp(CAM_PREROLL_LOOK_AHEAD, CAM_LOOK_AHEAD, u);
    const camLookY     = THREE.MathUtils.lerp(CAM_PREROLL_LOOK_Y, CAM_LOOK_Y, u);
    const targetCamX = boat.position.x * 0.55;
    const targetCamZ = boat.position.z + camBack;
    camera.position.x += (targetCamX - camera.position.x) * Math.min(1, dt * CAM_LERP);
    camera.position.y = camHeight;
    camera.position.z += (targetCamZ - camera.position.z) * Math.min(1, dt * CAM_LERP);
    camera.lookAt(boat.position.x, camLookY, boat.position.z - camLookAhead);
    // impact kick layered on top
    camera.position.x += state.camKickX;
    camera.position.z += state.camKickZ;
  }

  // ── input ──────────────────────────────────────────────────────────────────
  function _steerFromX(clientX, viewW) {
    return THREE.MathUtils.clamp((clientX / viewW - 0.5) * 2, -1, 1);
  }

  function onPointerDown(clientX, clientY, viewW) {
    if (state.phase === 'preroll') {
      startPlay();
    } else if (state.phase === 'dead') {
      reset();
      return;
    }
    if (state.phase !== 'play') return;
    state.steering = true;
    state.steerTarget = _steerFromX(clientX, viewW);
  }

  function onPointerMove(clientX, clientY, viewW) {
    if (!state.steering || state.phase !== 'play') return;
    state.steerTarget = _steerFromX(clientX, viewW);
  }

  function onPointerUp() {
    state.steering = false;
    state.steerTarget = 0;
  }

  reset();

  return {
    tick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    state,
    reset,
  };
}
