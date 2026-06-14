// gameplay.js — River Row runner core loop.
//
// State machine:
//   preroll   first frame after load / after restart, boat sits centred and
//             rower just paddles in place. First touch flips → play.
//   play      boat auto-advances along -z, lateral drag steers it. Rocks are
//             checked for collision; collision flips → dying.
//   dying     short capsize animation (boat rolls + character tossed + splash).
//             After T seconds → dead.
//   dead      HUD shows final score and restart prompt. Next touch → preroll.
//
// Trailing camera follows the boat's XZ; height + look-ahead are fixed.
//
// Forward motion is in world space (boat.position.z decreases). Once boat
// passes the end of the demo arc (z < -340), we wrap the boat back to z=+220
// (well into temperate) — this is the simplest infinite loop for v1; later we
// can swap in a real biome-cycle if needed.

import * as THREE from 'three';

const RIVER_HALF = 9;                  // playable lateral half-width

// Boat collider — a circle around the boat for cheap rock collision
const BOAT_R = 0.95;

// Forward motion
const START_SPEED = 12;                // m/s at the first frame of play
const MAX_SPEED   = 26;                // m/s plateau
const RAMP        = 0.45;              // m/s² (added per second of play)

// Lateral steering — lerp boat.x toward the touch target
const STEER_LERP  = 6.0;               // higher = snappier

// Camera trailing offsets
const CAM_HEIGHT     = 3.8;
const CAM_BACK       = 6.0;
const CAM_LOOK_AHEAD = 18.0;
const CAM_LOOK_Y     = 0.6;
const CAM_LERP       = 8.0;

// Death animation
const DEATH_T_END = 1.4;               // seconds before dead state

// Hit-points / forgiveness
const HP_MAX = 3;
const INVULN_T = 0.95;                 // seconds of i-frames after a bump
const BUMP_SLOW = 0.55;                // speed multiplier on bump
const BUMP_PUSH = 1.4;                 // lateral push (world units)
const CAM_SHAKE_T = 0.4;

export function createGameplay({ boat, camera, scene, water, segments, colliders, pickups, hud, baseRowerRot, particles, wake, world }) {
  const state = {
    phase: 'preroll',
    speed: 0,
    targetX: 0,
    score: 0,
    best: parseInt(localStorage.getItem('rr.best') || '0', 10),
    deathT: 0,
    combo: 1,
    comboTimer: 0,
    hp: HP_MAX,
    invulnT: 0,
    shakeT: 0,
    // input
    drag: { active: false, downX: 0, baseX: 0 },
  };

  // expose for screenshots / debug
  state.RIVER_HALF = RIVER_HALF;

  function reset() {
    state.phase = 'preroll';
    state.speed = 0;
    state.targetX = 0;
    state.score = 0;
    state.deathT = 0;
    state._scoreAcc = 0;
    state.combo = 1;
    state.comboTimer = 0;
    state.hp = HP_MAX;
    state.invulnT = 0;
    state.shakeT = 0;
    boat.position.set(0, 0.05, 50);             // start well within first temperate chunk
    boat.rotation.set(0, 0, 0);
    // restore rower posture (we'll have rolled it during dying)
    if (boat.userData.rower) {
      boat.userData.rower.rotation.set(baseRowerRot.x, baseRowerRot.y, baseRowerRot.z);
      boat.userData.rower.position.set(boat.userData.seatPos.x, 0.37, boat.userData.seatPos.z);
    }
    // tear down all spawned chunks + re-prime around the new boat z
    if (world) world.reset(boat.position.z);
    hud.setScore(0);
    hud.setBest(state.best);
    hud.setPhase('preroll');
    if (hud.setCombo) hud.setCombo(1);
    if (hud.setHp) hud.setHp(state.hp);
  }

  function startPlay() {
    state.phase = 'play';
    state.speed = START_SPEED;
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
  }

  function finishDeath() {
    state.phase = 'dead';
    hud.setPhase('dead');
    hud.setDeath({ score: state.score, best: state.best });
  }

  function tick(dt) {
    if (state.phase === 'preroll') {
      // boat sits, rower idle (boat.js tickBoat handles bob + row)
      return;
    }

    if (state.phase === 'play') {
      // ── forward motion + speed ramp
      state.speed = Math.min(MAX_SPEED, state.speed + RAMP * dt);
      boat.position.z -= state.speed * dt;
      // ── lateral lerp toward target
      const lerp = Math.min(1, dt * STEER_LERP);
      boat.position.x += (state.targetX - boat.position.x) * lerp;
      // gentle yaw so boat banks into the turn
      const dx = state.targetX - boat.position.x;
      boat.rotation.y = THREE.MathUtils.clamp(-dx * 0.18, -0.35, 0.35);
      // ── distance score (accumulates forward metres forever — endless world)
      state._scoreAcc = (state._scoreAcc || 0) + state.speed * dt;
      state.score = Math.floor(state._scoreAcc);
      // ── bow continuous splash (speed-gated)
      if (particles) {
        const bx = boat.position.x;
        const bz = boat.position.z - 1.55;      // bow tip is at -z of boat origin
        const emitN = state.speed > 18 ? 2 : 1;
        particles.bowSpray(bx, 0.12, bz, state.speed, emitN);
      }
      // ── wake length scales with speed
      if (wake) {
        const k = THREE.MathUtils.clamp(state.speed / 18, 0.6, 1.7);
        wake.scale.z = k;
      }
      // ── combo timer countdown
      if (state.combo > 1) {
        state.comboTimer -= dt;
        if (state.comboTimer <= 0) {
          state.combo = 1;
          if (hud.setCombo) hud.setCombo(1);
        }
      }
      // ── i-frames + camera shake decay
      if (state.invulnT > 0) state.invulnT -= dt;
      if (state.shakeT  > 0) state.shakeT  -= dt;
      // ── collision check (rocks) — bump-on-hit; only die when HP runs out
      const bx = boat.position.x, bz = boat.position.z;
      let crashed = false;
      if (state.invulnT <= 0) {
        for (const c of colliders) {
          const ddx = bx - c.x;
          const ddz = bz - c.z;
          const rsum = c.r + BOAT_R;
          if (ddx*ddx + ddz*ddz < rsum*rsum) {
            state.hp -= 1;
            if (hud.setHp) hud.setHp(state.hp);
            if (state.hp <= 0) {
              die();
              crashed = true;
            } else {
              // BUMP — kick boat away from rock, slow it, splash, i-frames
              const dist = Math.max(0.01, Math.sqrt(ddx*ddx + ddz*ddz));
              const nx = ddx / dist;
              boat.position.x = c.x + nx * (rsum + 0.4);
              state.targetX = THREE.MathUtils.clamp(boat.position.x, -RIVER_HALF, RIVER_HALF);
              state.speed *= BUMP_SLOW;
              state.invulnT = INVULN_T;
              state.shakeT  = CAM_SHAKE_T;
              // break combo on hit
              state.combo = 1;
              state.comboTimer = 0;
              if (hud.setCombo) hud.setCombo(1);
              if (particles) particles.capsizeBurst(c.x + nx*c.r, 0.18, c.z, 14);
            }
            break;
          }
        }
      }
      // ── pickup check (lily pads)
      if (!crashed && pickups) {
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
      // capsize: roll boat to one side, decelerate fast
      state.speed *= Math.pow(0.04, dt);     // strong drag
      boat.position.z -= state.speed * dt;
      boat.rotation.z = THREE.MathUtils.clamp(state.deathT * 2.4, 0, 1.6);
      boat.rotation.x = THREE.MathUtils.clamp(state.deathT * 0.6, 0, 0.4);
      // toss the rower up + sideways
      const rower = boat.userData.rower;
      if (rower) {
        rower.position.y = 0.37 + state.deathT * 2.5 - 4.5 * state.deathT * state.deathT;
        rower.position.x = boat.userData.seatPos.x + state.deathT * 1.2;
        rower.rotation.z = -state.deathT * 4;
        rower.rotation.x = baseRowerRot.x + state.deathT * 2;
      }
      if (state.deathT >= DEATH_T_END) finishDeath();
    }

    // ── camera follow (always tracks boat XZ, smoothed)
    const targetCamX = boat.position.x * 0.6;            // mild lateral follow (so the world doesn't whip)
    const targetCamZ = boat.position.z + CAM_BACK;
    camera.position.x += (targetCamX - camera.position.x) * Math.min(1, dt * CAM_LERP);
    camera.position.y = CAM_HEIGHT;
    camera.position.z += (targetCamZ - camera.position.z) * Math.min(1, dt * CAM_LERP);
    camera.lookAt(boat.position.x, CAM_LOOK_Y, boat.position.z - CAM_LOOK_AHEAD);
    // ── camera shake on bump (decaying random offset)
    if (state.shakeT > 0) {
      const amp = (state.shakeT / CAM_SHAKE_T) * 0.18;
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
    }
    // ── flicker boat during i-frames so the player sees they're protected
    if (state.invulnT > 0) {
      const blink = Math.sin(state.invulnT * 40) > 0;
      boat.visible = blink || (state.invulnT < 0.1);
    } else if (!boat.visible) {
      boat.visible = true;
    }
  }

  // ── input ────────────────────────────────────────────────────────────────
  function onPointerDown(clientX, clientY, viewW) {
    if (state.phase === 'preroll') {
      startPlay();
    } else if (state.phase === 'dead') {
      reset();
      return;
    }
    state.drag.active = true;
    state.drag.downX = clientX;
    state.drag.baseX = boat.position.x;
  }
  function onPointerMove(clientX, clientY, viewW) {
    if (!state.drag.active || state.phase !== 'play') return;
    // pixel delta → world lateral delta. Map full viewport width to ~2.4×RIVER_HALF
    const dxPx = clientX - state.drag.downX;
    const dxWorld = (dxPx / viewW) * (RIVER_HALF * 2.6);
    state.targetX = THREE.MathUtils.clamp(state.drag.baseX + dxWorld, -RIVER_HALF, RIVER_HALF);
  }
  function onPointerUp() {
    state.drag.active = false;
  }

  reset();

  return {
    tick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    state,            // expose for debugging
    reset,
  };
}
