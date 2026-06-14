// gameplay.js — River Row stroke-driven core loop.
//
// State machine:
//   preroll   first frame after load / after restart, boat sits centred.
//             First touch flips → play.
//   play      Player must press-and-hold to charge a stroke, release to fire.
//             Stroke = impulse on velocity (forward + lateral by tap-x). Water
//             friction drags velocity to zero between strokes. Rocks bounce
//             the boat (no instant death) and damage an HP bar that auto-
//             regens slowly. 0 HP → dying.
//   dying     Short capsize animation. After T seconds → dead.
//   dead      HUD shows final score and restart prompt. Next touch → preroll.

import * as THREE from 'three';

const RIVER_HALF = 9;
const BOAT_R = 0.95;

// ── stroke physics ──────────────────────────────────────────────────────────
const MAX_CHARGE_T   = 0.8;        // seconds to full charge
const MIN_CHARGE_T   = 0.08;       // tap floor — anything quicker fires a tap stroke
const STROKE_FORWARD = 11.0;       // forward impulse (m/s added to vz) at full charge
const STROKE_LATERAL = 5.5;        // lateral impulse at full charge × tapDir
const STROKE_ANIM_T  = 0.45;       // visual stroke length

// ── water friction (per-second multiplier) ─────────────────────────────────
const VEL_FRICTION   = 0.55;       // v *= VEL_FRICTION ^ dt — about 1.2s half-life

// ── HP / damage / regen ────────────────────────────────────────────────────
const HP_MAX         = 100;
const HP_REGEN       = 4.5;        // per second
const HP_BASE_DMG    = 12;
const HP_DMG_FACTOR  = 3.0;        // dmg = base + impactSpeed × factor

// ── collision physics ──────────────────────────────────────────────────────
const RESTITUTION    = 0.62;       // energy retained on bounce

// ── camera (play) ──────────────────────────────────────────────────────────
const CAM_HEIGHT     = 3.8;
const CAM_BACK       = 6.0;
const CAM_LOOK_AHEAD = 18.0;
const CAM_LOOK_Y     = 0.6;
const CAM_LERP       = 8.0;

// ── camera (preroll cinematic) ─────────────────────────────────────────────
const CAM_PREROLL_HEIGHT     = 2.6;
const CAM_PREROLL_BACK       = 8.5;
const CAM_PREROLL_LOOK_AHEAD = 6.0;
const CAM_PREROLL_LOOK_Y     = 0.7;

// ── push-in transition ─────────────────────────────────────────────────────
const PUSH_IN_T  = 1.0;

// ── camera shake on bump ───────────────────────────────────────────────────
const CAM_SHAKE_T = 0.4;

// ── death ──────────────────────────────────────────────────────────────────
const DEATH_T_END = 1.4;

export function createGameplay({ boat, camera, scene, water, segments, colliders, pickups, hud, baseRowerRot, particles, wake, world }) {
  const state = {
    phase: 'preroll',
    score: 0,
    best: parseInt(localStorage.getItem('rr.best') || '0', 10),
    deathT: 0,
    combo: 1,
    comboTimer: 0,
    hp: HP_MAX,
    shakeT: 0,
    pushT: 0,
    // velocity-driven motion
    vx: 0, vz: 0,
    // charge state
    charging: false,
    chargeT: 0,
    tapDir: 0,
    tapDownX: 0, tapDownY: 0,
    // stroke animation timer (counts UP to STROKE_ANIM_T after fire)
    strokeT: 0,
    // yaw shake timer
    yawShakeT: 0,
    yawShakeAmp: 0,
    // score accumulator
    _scoreAcc: 0,
  };

  state.RIVER_HALF = RIVER_HALF;

  // ── reset ──────────────────────────────────────────────────────────────────
  function reset() {
    state.phase = 'preroll';
    state.score = 0;
    state.deathT = 0;
    state._scoreAcc = 0;
    state.combo = 1;
    state.comboTimer = 0;
    state.hp = HP_MAX;
    state.shakeT = 0;
    state.pushT = 0;
    state.vx = 0; state.vz = 0;
    state.charging = false;
    state.chargeT = 0;
    state.tapDir = 0;
    state.strokeT = 0;
    state.yawShakeT = 0;
    state.yawShakeAmp = 0;
    boat.position.set(0, 0.05, 50);
    camera.position.set(0, CAM_PREROLL_HEIGHT, 50 + CAM_PREROLL_BACK);
    camera.lookAt(0, CAM_PREROLL_LOOK_Y, 50 - CAM_PREROLL_LOOK_AHEAD);
    boat.rotation.set(0, 0, 0);
    if (boat.userData.rower) {
      boat.userData.rower.rotation.set(baseRowerRot.x, baseRowerRot.y, baseRowerRot.z);
      boat.userData.rower.position.set(boat.userData.seatPos.x, -0.18, boat.userData.seatPos.z);
    }
    boat.userData.charging = false;
    boat.userData.chargeProgress = 0;
    boat.userData.strokeProgress = null;
    if (pickups) for (const p of pickups) p.group.visible = true;
    if (world) world.reset(boat.position.z);
    hud.setScore(0);
    hud.setBest(state.best);
    hud.setPhase('preroll');
    if (hud.setCombo) hud.setCombo(1);
    if (hud.setHp)    hud.setHp(state.hp);
    if (hud.setCharge) hud.setCharge(0, 0, 0);
  }

  function startPlay() {
    state.phase = 'play';
    state.pushT = 0;
    hud.setPhase('play');
  }

  function die() {
    state.phase = 'dying';
    state.deathT = 0;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('rr.best', String(state.best));
    }
    if (particles) particles.capsizeBurst(boat.position.x, 0.2, boat.position.z, 28);
    if (hud.setCharge) hud.setCharge(0, 0, 0);
  }

  function finishDeath() {
    state.phase = 'dead';
    hud.setPhase('dead');
    hud.setDeath({ score: state.score, best: state.best });
  }

  // ── fire the held-up stroke ────────────────────────────────────────────────
  function fireStroke() {
    if (!state.charging) return;
    state.charging = false;
    const chargeT = Math.max(MIN_CHARGE_T, state.chargeT);
    const power = Math.min(1.0, chargeT / MAX_CHARGE_T);
    state.vz -= STROKE_FORWARD * power;
    state.vx += STROKE_LATERAL * power * state.tapDir;
    state.chargeT = 0;
    state.strokeT = STROKE_ANIM_T;
    if (hud.setCharge) hud.setCharge(0, 0, 0);
    // splash at the stroke side (left tap → splash on the left oar etc.)
    if (particles) {
      const sx = boat.position.x + (state.tapDir < 0 ? -1.7 : 1.7);
      const sz = boat.position.z + 0.2;
      particles.bowSpray(sx, 0.12, sz, 14, 3);
    }
  }

  // ── per-frame tick ─────────────────────────────────────────────────────────
  function tick(dt) {
    if (state.phase === 'preroll') {
      const targetX = 0;
      const targetZ = boat.position.z + CAM_PREROLL_BACK;
      camera.position.x += (targetX - camera.position.x) * Math.min(1, dt * CAM_LERP);
      camera.position.y = CAM_PREROLL_HEIGHT;
      camera.position.z += (targetZ - camera.position.z) * Math.min(1, dt * CAM_LERP);
      camera.lookAt(boat.position.x, CAM_PREROLL_LOOK_Y, boat.position.z - CAM_PREROLL_LOOK_AHEAD);
      return;
    }

    if (state.phase === 'play') {
      // ── charge accumulation
      if (state.charging) {
        state.chargeT = Math.min(MAX_CHARGE_T, state.chargeT + dt);
        if (hud.setCharge) hud.setCharge(state.chargeT / MAX_CHARGE_T, state.tapDownX, state.tapDownY);
      }
      // ── stroke animation timer
      if (state.strokeT > 0) state.strokeT = Math.max(0, state.strokeT - dt);

      // expose state to boat for animation
      boat.userData.charging = state.charging;
      boat.userData.chargeProgress = state.chargeT / MAX_CHARGE_T;
      boat.userData.strokeProgress = state.strokeT > 0
        ? (1 - state.strokeT / STROKE_ANIM_T)
        : null;

      // ── friction + integrate
      const fric = Math.pow(VEL_FRICTION, dt);
      state.vx *= fric;
      state.vz *= fric;
      boat.position.x += state.vx * dt;
      boat.position.z += state.vz * dt;

      // ── clamp lateral to river half-width
      if (boat.position.x > RIVER_HALF)  { boat.position.x = RIVER_HALF;  if (state.vx > 0) state.vx = 0; }
      if (boat.position.x < -RIVER_HALF) { boat.position.x = -RIVER_HALF; if (state.vx < 0) state.vx = 0; }

      // ── boat yaw: bank into lateral motion + decaying shake from impacts
      const baseYaw = THREE.MathUtils.clamp(-state.vx * 0.06, -0.4, 0.4);
      let shakeYaw = 0;
      if (state.yawShakeT > 0) {
        state.yawShakeT = Math.max(0, state.yawShakeT - dt);
        const k = state.yawShakeT / 0.4;            // 1 → 0
        shakeYaw = Math.sin(state.yawShakeT * 22) * state.yawShakeAmp * k;
      }
      boat.rotation.y = baseYaw + shakeYaw;

      // ── HP regen
      state.hp = Math.min(HP_MAX, state.hp + HP_REGEN * dt);
      if (hud.setHp) hud.setHp(state.hp);

      // ── distance score (only forward motion counts)
      const dz = state.vz * dt;
      if (dz < 0) state._scoreAcc -= dz;
      state.score = Math.floor(state._scoreAcc);

      // ── bow splash when moving fast
      if (particles) {
        const speed = Math.hypot(state.vx, state.vz);
        if (speed > 4) {
          const bx = boat.position.x;
          const bz = boat.position.z - 1.55;
          particles.bowSpray(bx, 0.12, bz, speed, speed > 14 ? 2 : 1);
        }
      }

      // ── wake scales with speed
      if (wake) {
        const speed = Math.hypot(state.vx, state.vz);
        wake.scale.z = THREE.MathUtils.clamp(speed / 16, 0.4, 1.7);
      }

      // ── combo timer
      if (state.combo > 1) {
        state.comboTimer -= dt;
        if (state.comboTimer <= 0) {
          state.combo = 1;
          if (hud.setCombo) hud.setCombo(1);
        }
      }

      // ── camera shake decay
      if (state.shakeT > 0) state.shakeT -= dt;

      // ── collision check — bounce physics + damage
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
          const overlap = rsum - dist + 0.02;
          boat.position.x += nx * overlap;
          boat.position.z += nz * overlap;
          // velocity reflection (only if heading INTO the rock)
          const vDotN = state.vx * nx + state.vz * nz;
          let impactMag = 0;
          if (vDotN < 0) {
            impactMag = -vDotN;
            state.vx -= 2 * vDotN * nx;
            state.vz -= 2 * vDotN * nz;
            state.vx *= RESTITUTION;
            state.vz *= RESTITUTION;
          }
          // damage scales with impact speed
          const dmg = HP_BASE_DMG + impactMag * HP_DMG_FACTOR;
          state.hp = Math.max(0, state.hp - dmg);
          if (hud.setHp) hud.setHp(state.hp);
          // visual feedback
          state.shakeT = CAM_SHAKE_T;
          state.yawShakeT = 0.4;
          state.yawShakeAmp = THREE.MathUtils.clamp(impactMag * 0.05, 0.15, 0.5);
          if (particles) particles.capsizeBurst(c.x + nx * c.r * 0.7, 0.18, c.z + nz * c.r * 0.7, 14);
          // break combo
          state.combo = 1;
          state.comboTimer = 0;
          if (hud.setCombo) hud.setCombo(1);
          // death check
          if (state.hp <= 0) {
            die();
          }
          break;     // resolve only one collision per frame
        }
      }

      // ── pickup check
      if (pickups) {
        for (const p of pickups) {
          if (!p.group.visible) continue;
          const ddx = bx - p.x;
          const ddz = bz - p.z;
          const rsum = p.r + BOAT_R;
          if (ddx*ddx + ddz*ddz < rsum*rsum) {
            p.group.visible = false;
            state._scoreAcc += p.value * state.combo;
            state.combo = Math.min(8, state.combo + 1);
            state.comboTimer = 2.0;
            if (hud.setCombo) hud.setCombo(state.combo);
            if (particles) particles.pickupSparkle(p.x, 0.15, p.z, 12);
          }
        }
      }

      hud.setScore(state.score);
    }

    if (state.phase === 'dying') {
      state.deathT += dt;
      state.vz *= Math.pow(0.04, dt);
      state.vx *= Math.pow(0.04, dt);
      boat.position.x += state.vx * dt;
      boat.position.z += state.vz * dt;
      boat.rotation.z = THREE.MathUtils.clamp(state.deathT * 2.4, 0, 1.6);
      boat.rotation.x = THREE.MathUtils.clamp(state.deathT * 0.6, 0, 0.4);
      const rower = boat.userData.rower;
      if (rower) {
        rower.position.y = -0.18 + state.deathT * 2.5 - 4.5 * state.deathT * state.deathT;
        rower.position.x = boat.userData.seatPos.x + state.deathT * 1.2;
        rower.rotation.z = -state.deathT * 4;
        rower.rotation.x = baseRowerRot.x + state.deathT * 2;
      }
      if (state.deathT >= DEATH_T_END) finishDeath();
    }

    // ── camera follow + push-in (always runs)
    state.pushT = Math.min(PUSH_IN_T, state.pushT + dt);
    const u = THREE.MathUtils.smoothstep(state.pushT / PUSH_IN_T, 0, 1);
    const camHeight    = THREE.MathUtils.lerp(CAM_PREROLL_HEIGHT, CAM_HEIGHT, u);
    const camBack      = THREE.MathUtils.lerp(CAM_PREROLL_BACK, CAM_BACK, u);
    const camLookAhead = THREE.MathUtils.lerp(CAM_PREROLL_LOOK_AHEAD, CAM_LOOK_AHEAD, u);
    const camLookY     = THREE.MathUtils.lerp(CAM_PREROLL_LOOK_Y, CAM_LOOK_Y, u);
    const targetCamX = boat.position.x * 0.6;
    const targetCamZ = boat.position.z + camBack;
    camera.position.x += (targetCamX - camera.position.x) * Math.min(1, dt * CAM_LERP);
    camera.position.y = camHeight;
    camera.position.z += (targetCamZ - camera.position.z) * Math.min(1, dt * CAM_LERP);
    camera.lookAt(boat.position.x, camLookY, boat.position.z - camLookAhead);
    if (state.shakeT > 0) {
      const amp = (state.shakeT / CAM_SHAKE_T) * 0.18;
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
    }
  }

  // ── input ──────────────────────────────────────────────────────────────────
  function onPointerDown(clientX, clientY, viewW) {
    if (state.phase === 'preroll') {
      startPlay();
    } else if (state.phase === 'dead') {
      reset();
      return;
    }
    if (state.phase !== 'play') return;
    state.charging = true;
    state.chargeT = 0;
    state.tapDir = THREE.MathUtils.clamp((clientX / viewW - 0.5) * 2, -1, 1);
    state.tapDownX = clientX;
    state.tapDownY = clientY;
  }

  function onPointerMove(clientX, clientY, viewW) {
    if (!state.charging || state.phase !== 'play') return;
    state.tapDir = THREE.MathUtils.clamp((clientX / viewW - 0.5) * 2, -1, 1);
    state.tapDownX = clientX;
    state.tapDownY = clientY;
  }

  function onPointerUp() {
    if (state.charging) fireStroke();
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
