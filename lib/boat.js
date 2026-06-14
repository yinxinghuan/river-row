// boat.js — wooden rowboat + paddle oars + wake ribbons + bow splash.
//
// Hull is 5 box pieces (floor, two side rims, bow wedge, stern, bench). The
// bow's far-end vertices are pinched inward to give the prow a soft V shape.
//
// Oars are NOT physically attached to the rower's hands — they pivot at the
// rowlock pegs on each side of the boat. The rower's arms swing in the same
// row cycle phase as a visual hint; with chunky low-poly proportions the eye
// reads the motion as a connected pull. Saves an IK/parenting tangle.
//
// All materials run through applyCurve() so the boat sinks with the world.

import * as THREE from 'three';
import { applyCurve } from './curve.js?v=4';

// Warm honey-wood palette — Image 1's boat reads as toasted-pine, not burnt.
const WOOD_HULL = 0xb7824c;
const WOOD_RIM  = 0x9a6232;
const WOOD_SEAT = 0xd49960;
const WOOD_PEG  = 0x5a3d22;
const WAKE_W    = 0.12;

export function buildBoat() {
  const g = new THREE.Group();

  // ── floor plank
  const floor = boxFaceted(1.5, 0.10, 2.8, WOOD_HULL);
  floor.position.y = 0.08;
  g.add(floor);

  // ── side rims
  const sideL = boxFaceted(0.10, 0.30, 2.8, WOOD_RIM);
  sideL.position.set(-0.78, 0.28, 0);
  g.add(sideL);
  const sideR = sideL.clone();
  sideR.material = sideR.material.clone();
  applyCurve(sideR.material);
  sideR.position.x = 0.78;
  g.add(sideR);

  // ── bow wedge — pinched prow toward -z (forward)
  const bow = boxFacetedTaper(1.5, 0.30, 0.7, WOOD_RIM, { tipZ: -0.35, tipScaleX: 0.15 });
  bow.position.set(0, 0.28, -1.55);
  g.add(bow);

  // ── stern back panel
  const stern = boxFaceted(1.5, 0.30, 0.18, WOOD_RIM);
  stern.position.set(0, 0.28, 1.45);
  g.add(stern);

  // ── bench (rower's seat)
  const seat = boxFaceted(1.25, 0.06, 0.55, WOOD_SEAT);
  seat.position.set(0, 0.34, 0.30);
  g.add(seat);

  // ── footboard (so the rower's feet have something to push against, also a
  //    bit of detail at the bow end)
  const foot = boxFaceted(1.2, 0.04, 0.45, WOOD_SEAT);
  foot.position.set(0, 0.18, -0.55);
  g.add(foot);

  // ── rowlock pegs
  const pegL = boxFaceted(0.16, 0.18, 0.18, WOOD_PEG);
  pegL.position.set(-0.84, 0.52, 0);
  g.add(pegL);
  const pegR = pegL.clone();
  pegR.material = pegR.material.clone();
  applyCurve(pegR.material);
  pegR.position.x = 0.84;
  g.add(pegR);

  // ── oars — pivot at rowlock peg; oarGroup.rotation.x = row phase
  // buildOar() builds an oar extending in +X (shaft 0→2.4, blade at 1.6).
  // Right oar (starboard) uses default orientation → extends to +X outward.
  // Left  oar (port) yaws 180° → extends to -X outward over the port water.
  // (scale.x = -1 would also work but inverts winding and disrupts shadows.)
  const oarL = buildOar();
  oarL.position.copy(pegL.position);
  oarL.rotation.y = Math.PI;
  g.add(oarL);
  const oarR = buildOar();
  oarR.position.copy(pegR.position);
  g.add(oarR);

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});

  g.userData.oarL = oarL;
  g.userData.oarR = oarR;
  g.userData.seatPos = new THREE.Vector3(0, 0.34, 0.30);   // where the rower sits
  return g;
}

function buildOar() {
  // The oar pivots around its rowlock peg (this group's origin). The shaft
  // extends OUTWARD (positive local X — toward the water on the left side; the
  // right oar will be mirrored with scale.x = -1). The blade is the wide flat
  // paddle at the outer end.
  const g = new THREE.Group();
  // shaft: length 2.4 from rowlock peg outward, slight downward tilt baked into
  // the group rotation, with the grip extending inward (negative X) past the peg
  const shaft = boxFaceted(2.4, 0.07, 0.10, 0xb7824c);
  shaft.position.x = 0.5;
  shaft.rotation.z = -0.10;        // slight downward tilt (outward end dips into water)
  g.add(shaft);
  // grip — inward stub
  const grip = boxFaceted(0.45, 0.07, 0.10, 0x9a6232);
  grip.position.x = -0.5;
  g.add(grip);
  // blade — wide flat paddle at far end
  const blade = boxFaceted(0.30, 0.05, 0.65, 0x9a6232);
  blade.position.set(1.6, -0.04, 0);
  blade.rotation.z = -0.10;
  g.add(blade);
  // default rest rotation: blades just above the water surface, slightly forward
  g.rotation.x = -0.16;
  return g;
}

// ── wake ribbons (4 fading streaks behind the boat) ─────────────────────────
export function buildWake() {
  const g = new THREE.Group();
  const N = 4;
  const lanes = [-0.36, -0.12, 0.12, 0.36];   // four trailing lanes
  for (let i = 0; i < N; i++) {
    const len = 7.0 - i * 0.4;
    const geo = makeWakeRibbon(WAKE_W, len);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    applyCurve(mat);
    const m = new THREE.Mesh(geo, mat);
    // place behind boat: head at z=+1 (just behind stern), tail extends to +z
    m.position.set(lanes[i], 0.045, 1.0 + len * 0.5);
    g.add(m);
  }
  return g;
}

function makeWakeRibbon(w, l) {
  const geo = new THREE.PlaneGeometry(w, l, 1, 12);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const t = (pos.getZ(v) + l/2) / l;    // 0 at head (closer to boat), 1 at tail
    const a = (1 - t) * 0.85;
    col[v*3] = a; col[v*3+1] = a; col[v*3+2] = a;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ── per-face faceted box helper ─────────────────────────────────────────────
function boxFaceted(w, h, d, baseHex, jitter = 0.06) {
  let geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  paintFaces(geo, baseHex, jitter);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCurve(mat);
  return new THREE.Mesh(geo, mat);
}

function boxFacetedTaper(w, h, d, baseHex, { tipZ = 0, tipScaleX = 0.2 } = {}, jitter = 0.06) {
  let geo = new THREE.BoxGeometry(w, h, d, 1, 1, 2);
  const pos = geo.attributes.position;
  // pinch vertices whose z is most negative (the bow tip) toward x=0
  for (let v = 0; v < pos.count; v++) {
    const z = pos.getZ(v);
    if (z < tipZ - 0.001) {
      pos.setX(v, pos.getX(v) * tipScaleX);
    }
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  paintFaces(geo, baseHex, jitter);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCurve(mat);
  return new THREE.Mesh(geo, mat);
}

function paintFaces(geo, baseHex, jitter) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(baseHex);
  const tmp = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    tmp.copy(base);
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

// ── rower: attach a CHARACTERS roster pick to the seat with a sitting pose ──
//
// Characters are built standing, facing +z, with leg/arm pivots in
// `userData.rig`. To row in our coordinate system (boat moves toward -z):
//   1. Yaw 180° so the rower faces the bow
//   2. Recline body slightly + tip forward (over the oars)
//   3. Fold legs forward at the hips → seated knee-up posture
//   4. Pre-lower arms — armSwing applied each frame on top
export function attachRower(boat, characterKey, CHARACTERS) {
  if (!CHARACTERS[characterKey]) return null;
  const rower = CHARACTERS[characterKey]();
  // CHARACTERS builders use whole-unit voxel scale (~2 high) — too big for the
  // 1.5-wide boat. Shrink to a believable boatful proportion (chunky in seat).
  const SCALE = 0.50;
  rower.scale.setScalar(SCALE);
  rower.rotation.y = Math.PI;      // face the bow (forward direction = -z)
  // Sit ON the boat's bench. The seat top is at boat-local y = 0.37; the
  // character is built with the HIP at local y = (shoeH+legH) × SCALE = 0.55,
  // so anchoring origin at -0.18 plants the hip on the seat top. Legs are
  // folded 90° forward → cartoony "knees out" rowing pose, butt on bench.
  rower.position.set(boat.userData.seatPos.x, -0.18, boat.userData.seatPos.z);
  // body tilt forward over the oars
  rower.rotation.x = 0.12;

  const rig = rower.userData.rig;
  if (rig) {
    // ── fold legs forward 90° from the hip — original sit-on-seat pose
    const FOLD = -Math.PI / 2;
    if (rig.legL) rig.legL.rotation.x = FOLD + 0.08;
    if (rig.legR) rig.legR.rotation.x = FOLD - 0.08;
    // ── base arm forward droop (gripping oars). Frame loop animates on top.
    if (rig.armL) {
      rig.armL.rotation.x = -0.55;        // forward & down
      rig.armL.rotation.z = -0.18;        // out toward the oarlock
    }
    if (rig.armR) {
      rig.armR.rotation.x = -0.55;
      rig.armR.rotation.z = 0.18;
    }
  }

  boat.add(rower);
  boat.userData.rower = rower;
  boat.userData.rowerRig = rig;
  boat.userData._baseRowerX = 0.12;       // base forward lean over the oars
  return rower;
}

// ── per-frame bob + continuous row cycle. ──
//
// Inputs come via boat.userData (gameplay sets these each frame):
//   rowFreq         0..1   — how fast the row cycle advances (0 = idle, 1 = full boost)
//   rowerJoltAmt    rad    — additional forward lean from a recent impact (decays)
//   bobY            metres — vertical offset on top of the idle bob (impact dip)
//
// Arm pose convention (rotation.x on arm pivot):
//   -1.0  arms thrust toward stern (finish — pulled back to chest)
//   -0.55 neutral
//    0.1  arms extended toward bow (catch — reaching forward)
// Oar pose conventions:
//   rotation.y  STROKE YAW — sweeps the blade through water from catch to
//               finish. Locked to arm phase so the oar handle visually
//               follows the rower's hands.
//   rotation.x  blade dip — slight up/down feather, max-deep at mid-drive.
const ROW_CYCLE_BASE  = 1.0;         // baseline row cadence (cycles/sec at rowFreq=0.5)
const ROW_CYCLE_MAX   = 3.2;         // max cadence when rowFreq=1
const OAR_STROKE_AMP  = 0.55;        // peak yaw radians (~31°) per stroke half-cycle

export function tickBoat(boat, t, dt) {
  // During capsize the gameplay loop owns boat.position.y / rotation / rower
  // pose entirely — early-return so we don't fight it.
  if (boat.userData.skipRowerAnim) return;

  const freq = boat.userData.rowFreq != null ? boat.userData.rowFreq : 0.5;
  // advance a phase variable scaled by freq so the row tempo varies with speed
  const cadence = ROW_CYCLE_BASE + (ROW_CYCLE_MAX - ROW_CYCLE_BASE) * freq;
  boat.userData._rowPhase = (boat.userData._rowPhase || 0) + dt * cadence;
  const phase = boat.userData._rowPhase * Math.PI * 2;     // radians per cycle

  // Gentle boat bob + impact-driven dip
  const bobExtra = boat.userData.bobY || 0;
  boat.position.y = 0.05 + Math.sin(t * 1.4) * 0.025 + bobExtra;

  // Continuous catch-drive-finish-recovery loop, all driven from `sw`:
  //   sw = -1  catch (arms extended toward bow, oar blade just dipping in)
  //   sw =  0  mid-drive (arms swinging fastest, blade deepest)
  //   sw = +1  finish (arms pulled to chest, blade lifting out)
  // The OAR yaw uses the SAME sw so the handle visually swings with the hand,
  // not a quarter-cycle behind it. Blade dip uses cos(phase) so the blade is
  // deepest at mid-drive (sw=0 rising) and highest at mid-recovery.
  const sw = Math.sin(phase);
  const cw = Math.cos(phase);
  const armX = -0.45 - sw * 0.55;
  // Stroke yaw: oar handle swings through OAR_STROKE_AMP radians around the
  // rowlock peg, locked in phase with the arm pull.
  // Right oar baseline rotation.y = 0; positive yaw rotates the handle toward
  // the stern (the "finish" side). Left oar baseline = π; same visible effect
  // requires SUBTRACTING the same delta from π.
  const strokeYaw = sw * OAR_STROKE_AMP;
  // Blade dip — small in-water tilt; we add a steeper out-of-water feather
  // during recovery so the blades visibly clear the surface.
  const oarX = -0.16 + cw * 0.42;
  const oarRoll = Math.max(0, cw) * 0.14;

  const rig = boat.userData.rowerRig;
  if (rig) {
    if (rig.armL) rig.armL.rotation.x = armX;
    if (rig.armR) rig.armR.rotation.x = armX;
    if (boat.userData.rower) {
      const jolt = boat.userData.rowerJoltAmt || 0;
      boat.userData.rower.rotation.x = (boat.userData._baseRowerX || 0) + jolt;
    }
  }
  if (boat.userData.oarL) {
    boat.userData.oarL.rotation.x = oarX;
    boat.userData.oarL.rotation.y = Math.PI - strokeYaw;
    boat.userData.oarL.rotation.z = oarRoll;
  }
  if (boat.userData.oarR) {
    boat.userData.oarR.rotation.x = oarX;
    boat.userData.oarR.rotation.y = strokeYaw;
    boat.userData.oarR.rotation.z = -oarRoll;
  }
}

