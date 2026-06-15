// segments.js — distance-based biome palette manager.
//
// Each biome has a palette: { fog, skyTop, skyMid, skyBot, sun, sunDir }.
// The segment manager tracks boat z position, computes a 0..1 t value across
// the "gate zone" (the 70m around the stone arch), and lerps every uniform
// shared by the sky + scene fog. Biome assets themselves don't change colour
// — they're spatially placed (temperate at z > -100, canyon at z < -100), so
// the world they're in just *atmosphere-tints* as the boat passes through.
//
// Result: smooth transition without any pop-in or hard cut. The player passes
// through a stone arch and the sky simply shifts hue around them.

import * as THREE from 'three';

// Three-stop sky for the temperate biome. skyBot is the horizon glow band
// at h≈0; we set fog EXACTLY to skyBot so distant water + bank ribbons
// dissolve into the sky's horizon colour with no visible seam.
const TEMPERATE_HORIZON = 0xdce8e3;
export const TEMPERATE = {
  fog:     new THREE.Color(TEMPERATE_HORIZON),
  skyTop:  new THREE.Color(0x4ea2c2),     // deeper clean zenith blue
  skyMid:  new THREE.Color(0x8ccadf),     // mid daytime sky band
  skyBot:  new THREE.Color(TEMPERATE_HORIZON), // horizon glow == fog colour
  sun:     new THREE.Color(0xfff2c4),
  sunDir:  new THREE.Vector3(-0.35, 0.42, -1).normalize(),
  hemiSky: new THREE.Color(0xcfe4ec),
  hemiGround: new THREE.Color(0x9bcab1),
  keyColor:  new THREE.Color(0xfff3e0),
};

// Canyon palette — desert noon: deep copper zenith → warm peach band →
// pale warm cream horizon. fog == skyBot so the water/banks dissolve into
// the horizon glow seamlessly.
const CANYON_HORIZON = 0xf2deba;
export const CANYON = {
  fog:     new THREE.Color(CANYON_HORIZON),
  skyTop:  new THREE.Color(0xb87248),     // warm copper / dusty deep
  skyMid:  new THREE.Color(0xe8b88a),     // mid daytime warm peach
  skyBot:  new THREE.Color(CANYON_HORIZON), // horizon glow == fog colour
  sun:     new THREE.Color(0xffe8c2),
  sunDir:  new THREE.Vector3(-0.30, 0.36, -1).normalize(),
  hemiSky: new THREE.Color(0xefd5b0),
  hemiGround: new THREE.Color(0xc88b6e),
  keyColor:  new THREE.Color(0xffe1bb),
};

const _tmpC = new THREE.Color();
const _tmpV = new THREE.Vector3();

export function createSegmentManager({ gateZ = -110, gateHalf = 35 } = {}) {
  // gateZ: world Z of arch center.  gateHalf: half-width of the transit zone
  // (so the lerp covers z ∈ [gateZ + gateHalf, gateZ - gateHalf] = 70m total).

  return {
    /**
     * Compute t ∈ [0, 1] given boat world Z.
     *   0 = fully temperate (boat upstream of gate)
     *   1 = fully canyon    (boat downstream past gate)
     * Linear inside the gate zone.
     */
    tFromZ(boatZ) {
      const head = gateZ + gateHalf;    // start of lerp (boat hasn't reached gate)
      const tail = gateZ - gateHalf;    // end of lerp (boat is past gate)
      if (boatZ >= head) return 0;
      if (boatZ <= tail) return 1;
      return (head - boatZ) / (head - tail);
    },

    /**
     * Apply the interpolated palette to scene.fog + sky uniforms + lights.
     * Pass the references collected from game.js once at startup.
     */
    apply(t, { scene, skyMat, hemi, key, water }) {
      const T = TEMPERATE, C = CANYON;
      _tmpC.copy(T.fog).lerp(C.fog, t);
      scene.fog.color.copy(_tmpC);

      _tmpC.copy(T.skyTop).lerp(C.skyTop, t);
      skyMat.uniforms.top.value.copy(_tmpC);
      _tmpC.copy(T.skyMid).lerp(C.skyMid, t);
      skyMat.uniforms.mid.value.copy(_tmpC);
      _tmpC.copy(T.skyBot).lerp(C.skyBot, t);
      skyMat.uniforms.bot.value.copy(_tmpC);
      _tmpC.copy(T.sun).lerp(C.sun, t);
      skyMat.uniforms.sun.value.copy(_tmpC);
      _tmpV.copy(T.sunDir).lerp(C.sunDir, t).normalize();
      skyMat.uniforms.sunDir.value.copy(_tmpV);

      // hemisphere + key light tint
      _tmpC.copy(T.hemiSky).lerp(C.hemiSky, t);
      hemi.color.copy(_tmpC);
      _tmpC.copy(T.hemiGround).lerp(C.hemiGround, t);
      hemi.groundColor.copy(_tmpC);
      _tmpC.copy(T.keyColor).lerp(C.keyColor, t);
      key.color.copy(_tmpC);

      if (water && water.userData.setSegment) water.userData.setSegment(t);
    },
  };
}
