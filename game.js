// River Row — Phase A scene: water + curved world + temperate biome.
//
// No gameplay yet. Static trailing camera, animated water + foam + glint, no
// hero/boat (placeholder hull only for scale). This pass exists to validate
// the painterly water + curved-horizon visual target before building the
// runner mechanics.
//
// Three.js v0.160 ES module. Single file. CDN importmap (see index.html).

import * as THREE from 'three';
import { applyCurve, updateCurve } from './lib/curve.js?v=3';
import { buildWater } from './lib/water.js?v=7';
import { createSegmentManager, TEMPERATE } from './lib/segments.js?v=2';
import { createWorld } from './lib/world.js?v=1';
import { buildBoat, buildWake, attachRower, tickBoat } from './lib/boat.js?v=3';
import { CHARACTERS } from './builders/characters.js?v=1';
import { createGameplay } from './lib/gameplay.js?v=3';
import { createParticles } from './lib/particles.js?v=1';

export function startGame({ canvas, hud }) {
  // ── renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Match clear colour to the current fog colour so any sky-sphere edge or
  // distance-cull gap reads as horizon haze, not black. We update this each
  // frame as the segment palette lerps.
  renderer.setClearColor(0xc0e3e3);

  // ── scene + fog ────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  // Push fog far so mid-distance water keeps its base colour and reads as
  // a coherent ribbon, not a fade-to-fog haze. Curve still handles "emerging
  // from below the horizon" — fog only kicks in past 150 units.
  scene.fog = new THREE.Fog(TEMPERATE.fog.getHex(), 35, 180);

  // ── camera (perspective trailing) ──────────────────────────────────────────
  // Lower + closer than sky-leap to keep the rower readable in the lower third
  // of the frame (Image 1 composition) while leaving room for distant scenery.
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 320);
  camera.position.set(0, 3.8, 7.0);
  camera.lookAt(0, 0.5, -8);

  // ── sky dome — warm-cool vertical gradient + soft sun spot ─────────────────
  const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: TEMPERATE.skyTop.clone() },
        mid: { value: TEMPERATE.skyMid.clone() },
        bot: { value: TEMPERATE.skyBot.clone() },
        sun: { value: TEMPERATE.sun.clone() },
        sunDir: { value: TEMPERATE.sunDir.clone() },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec3 vP;
        uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        uniform vec3 sun; uniform vec3 sunDir;
        void main(){
          vec3 n = normalize(vP);
          float h = n.y;
          vec3 c = h > 0.0
            ? mix(mid, top, clamp(h*1.55, 0.0, 1.0))
            : mix(mid, bot, clamp(-h*2.6, 0.0, 1.0));
          float s = max(0.0, dot(n, sunDir));
          c = mix(c, sun, pow(s, 5.0) * 0.34);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 28, 16), skyMat);
  scene.add(sky);

  // ── lighting ───────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(TEMPERATE.hemiSky.getHex(), TEMPERATE.hemiGround.getHex(), 0.92);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(TEMPERATE.keyColor.getHex(), 1.05);
  key.position.set(-9, 14, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 60;
  key.shadow.camera.left = -22; key.shadow.camera.right = 22;
  key.shadow.camera.top = 22; key.shadow.camera.bottom = -22;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb6daee, 0.32);  // cool sky bounce
  rim.position.set(6, 5, -12);
  scene.add(rim);

  // ── scene composition ──────────────────────────────────────────────────────
  // Water plane must cover BOTH biomes plus a tail behind the boat AND a
  // visible distance ahead of any in-game camera position. Canyon end is at
  // z=-260, camera looks ~70 units past that — water needs to reach there.
  const water = buildWater({ width: 60, length: 700 });
  scene.add(water);

  const segments = createSegmentManager();

  // ── chunked endless world (handles biome cycling + gate placement) ────────
  const colliders = [];
  const pickups = [];
  const world = createWorld({ scene, colliders, pickups });

  // Real boat + rower (random pick from the CHARACTERS roster — sky-leap pattern)
  const boat = buildBoat();
  const rosterKeys = Object.keys(CHARACTERS).filter(k => k !== 'ghost');   // ghost has no rig
  const pick = rosterKeys[Math.floor(Math.random() * rosterKeys.length)];
  attachRower(boat, pick, CHARACTERS);
  // patch the character's cached StandardMaterials with the curve shader too
  boat.userData.rower && boat.userData.rower.traverse(o => {
    if (o.isMesh && o.material) applyCurve(o.material);
  });
  boat.position.set(0, 0.05, 1.5);
  scene.add(boat);

  const wake = buildWake();
  wake.position.copy(boat.position);
  scene.add(wake);

  // ── particles pool (shared across bow / capsize / pickup) ──────────────────
  const particles = createParticles({ scene });

  // ── capture rower's base rotation for restoration after death animation ────
  const baseRowerRot = boat.userData.rower
    ? boat.userData.rower.rotation.clone()
    : new THREE.Euler(0, Math.PI, 0);

  // ── gameplay loop ──────────────────────────────────────────────────────────
  const gameplay = createGameplay({
    boat, camera, scene, water, segments, colliders, pickups, hud, baseRowerRot, particles, wake, world,
  });

  // ── resize ─────────────────────────────────────────────────────────────────
  function onResize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ── input wiring ───────────────────────────────────────────────────────────
  function eventX(e) { return e.clientX !== undefined ? e.clientX : (e.touches?.[0]?.clientX || 0); }
  function eventY(e) { return e.clientY !== undefined ? e.clientY : (e.touches?.[0]?.clientY || 0); }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    gameplay.onPointerDown(eventX(e), eventY(e), canvas.clientWidth);
  }, { passive: true });
  canvas.addEventListener('pointermove', (e) => {
    gameplay.onPointerMove(eventX(e), eventY(e), canvas.clientWidth);
  }, { passive: true });
  canvas.addEventListener('pointerup', () => gameplay.onPointerUp(), { passive: true });
  canvas.addEventListener('pointercancel', () => gameplay.onPointerUp(), { passive: true });

  // ── tick loop ──────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let t = 0;
  function loop() {
    const dt = Math.min(0.05, clock.getDelta());
    t += dt;
    updateCurve(camera, t);
    if (water.userData.tick) water.userData.tick(t, dt);
    tickBoat(boat, t, dt);
    // gameplay drives boat XZ + camera follow + collision + scoring + particles
    gameplay.tick(dt);
    particles.tick(dt);
    // streaming world: spawn ahead / despawn behind / tick in-chunk content
    world.update(boat.position.z);
    world.tick(t, dt);
    // wake follows boat XZ (always at water level — doesn't bob with boat)
    wake.position.x = boat.position.x;
    wake.position.z = boat.position.z;
    // atmospheric palette comes from whichever biome the boat is currently in
    const segT = world.biomeTAt(boat.position.z);
    segments.apply(segT, { scene, skyMat, hemi, key, water });
    renderer.setClearColor(scene.fog.color);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // expose for debug / screenshot tooling
  window.__rr = { scene, camera, renderer, water, boat, wake, pick, segments, world, gameplay, colliders, pickups, particles };
}
