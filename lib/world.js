// world.js — endless chunked biome cycle.
//
// CYCLE: a fixed sequence of "recipes" the world walks through repeatedly.
//   T → T → gate(T→C) → C → C → gate(C→T) → loop
//
// As the boat advances in -z, the world maintains 4-6 active chunks: a tail
// behind the boat for wake/grace and 2-3 ahead for visible horizon. Anything
// past +100m behind the boat is despawned (geo/mat disposed) and the global
// colliders/pickups arrays are pruned to match.
//
// biomeTAt(z) replaces the old single-gate segment logic — it returns a
// smoothly interpolated 0..1 (temperate → canyon) by reading whichever
// chunk currently contains the boat's z position.

import * as THREE from 'three';
import {
  buildBanks as buildTempBanks,
  buildRocks as buildTempRocks,
  buildLilyPads,
  buildPineRibbon,
  buildDucks,
  buildApples,
} from './temperate.js?v=10';
import {
  buildCanyonBanks,
  buildCanyonRocks,
  buildMesaRibbon,
} from './canyon.js?v=5';
import { buildStoneArch } from './gate.js?v=2';

// Length tunings — chunks are ~big enough to contain meaningful obstacle play
// without being so big that two seconds of distraction misses a biome shift.
const LEN_BIOME = 90;
const LEN_GATE  = 28;

const CYCLE = [
  { biome: 'temperate',        length: LEN_BIOME },
  { biome: 'temperate',        length: LEN_BIOME },
  { biome: 'gate-to-canyon',   length: LEN_GATE  },
  { biome: 'canyon',           length: LEN_BIOME },
  { biome: 'canyon',           length: LEN_BIOME },
  { biome: 'gate-to-temperate',length: LEN_GATE  },
];

const SPAWN_AHEAD = 280;    // keep chunks until at least this far ahead of boat
const DESPAWN_BEHIND = 100; // remove chunks more than this far behind boat

export function createWorld({ scene, colliders, pickups, initialZ = 130 }) {
  const chunks = [];
  let nextChunkEndZ = initialZ;       // chunks build leftward (toward -z)
  let nextCycleIdx = 0;

  const _tmpV = new THREE.Vector3();

  function spawnNext() {
    const recipe = CYCLE[nextCycleIdx % CYCLE.length];
    const zEnd = nextChunkEndZ;
    const zStart = zEnd - recipe.length;
    const group = new THREE.Group();
    const ticks = [];

    if (recipe.biome === 'temperate') {
      group.add(buildTempBanks({ zStart, zEnd }));
      group.add(buildTempRocks({ count: Math.round(recipe.length / 8), zStart, zEnd }));
      group.add(buildLilyPads({ count: Math.round(recipe.length / 9), zStart, zEnd }));
      const apples = buildApples({ count: Math.max(2, Math.round(recipe.length / 28)), zStart, zEnd });
      group.add(apples);
      if (apples.userData.tick) ticks.push(apples.userData.tick);
      const ducks = buildDucks({ count: 2, zStart, zEnd });
      group.add(ducks);
      ticks.push(ducks.userData.tick);
      const pineCount = Math.round(recipe.length * 0.27);
      group.add(buildPineRibbon({ side: -1, distance: 30, zStart, zEnd, count: pineCount }));
      group.add(buildPineRibbon({ side: +1, distance: 30, zStart, zEnd, count: pineCount }));
      group.add(buildPineRibbon({ side: -1, distance: 52, zStart, zEnd, count: Math.round(pineCount * 0.6) }));
      group.add(buildPineRibbon({ side: +1, distance: 52, zStart, zEnd, count: Math.round(pineCount * 0.6) }));
    } else if (recipe.biome === 'canyon') {
      group.add(buildCanyonBanks({ zStart, zEnd }));
      group.add(buildCanyonRocks({ count: Math.round(recipe.length / 8), zStart, zEnd }));
      // apples also drift through the canyon — gives the player something to chase
      // between rapids; sandstone biome doesn't need its own visual variant.
      const apples = buildApples({ count: Math.max(2, Math.round(recipe.length / 28)), zStart, zEnd });
      group.add(apples);
      if (apples.userData.tick) ticks.push(apples.userData.tick);
      const mesaCount = Math.round(recipe.length * 0.16);
      group.add(buildMesaRibbon({ side: -1, distance: 34, zStart, zEnd, count: mesaCount }));
      group.add(buildMesaRibbon({ side: +1, distance: 34, zStart, zEnd, count: mesaCount }));
      group.add(buildMesaRibbon({ side: -1, distance: 58, zStart, zEnd, count: Math.round(mesaCount * 0.6) }));
      group.add(buildMesaRibbon({ side: +1, distance: 58, zStart, zEnd, count: Math.round(mesaCount * 0.6) }));
    } else if (recipe.biome === 'gate-to-canyon' || recipe.biome === 'gate-to-temperate') {
      // gate chunk: stone arch in the middle, no banks (adjacent biome chunks
      // provide their own bank lines on either side).
      group.add(buildStoneArch({ z: (zStart + zEnd) / 2 }));
    }

    // collect colliders + pickups from this chunk
    const localColliders = [];
    const localPickups = [];
    group.traverse(o => {
      if (o.userData && o.userData.collide) {
        o.getWorldPosition(_tmpV);
        const c = { x: _tmpV.x, z: _tmpV.z, r: o.userData.collide.r };
        localColliders.push(c);
        colliders.push(c);
      }
      if (o.userData && o.userData.pickup) {
        o.getWorldPosition(_tmpV);
        const p = {
          x: _tmpV.x, z: _tmpV.z,
          r: o.userData.pickup.r,
          value: o.userData.pickup.value,
          type: o.userData.pickup.type || 'score',
          group: o,
        };
        localPickups.push(p);
        pickups.push(p);
      }
    });

    scene.add(group);
    chunks.push({
      group, zStart, zEnd, recipe,
      colliders: localColliders, pickups: localPickups,
      ticks,
    });

    nextChunkEndZ = zStart;
    nextCycleIdx++;
  }

  function despawn(chunk) {
    scene.remove(chunk.group);
    chunk.group.traverse(o => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material.dispose?.();
      }
    });
    for (const c of chunk.colliders) {
      const idx = colliders.indexOf(c);
      if (idx >= 0) colliders.splice(idx, 1);
    }
    for (const p of chunk.pickups) {
      const idx = pickups.indexOf(p);
      if (idx >= 0) pickups.splice(idx, 1);
    }
  }

  function update(boatZ) {
    // spawn ahead until we have enough runway
    let safety = 0;
    while (nextChunkEndZ > boatZ - SPAWN_AHEAD && safety++ < 12) spawnNext();
    // despawn far-behind chunks
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (chunks[i].zEnd > boatZ + DESPAWN_BEHIND) {
        despawn(chunks[i]);
        chunks.splice(i, 1);
      }
    }
  }

  function tick(t, dt) {
    for (const c of chunks) for (const fn of c.ticks) fn(t, dt);
  }

  // What biome is the boat in right now?  Used by segments.apply to set the
  // atmospheric palette.
  function biomeTAt(z) {
    for (const c of chunks) {
      if (z >= c.zStart && z <= c.zEnd) {
        const r = c.recipe;
        if (r.biome === 'temperate') return 0;
        if (r.biome === 'canyon') return 1;
        if (r.biome === 'gate-to-canyon') {
          // boat enters from +z side (zEnd) → leaves at -z side (zStart)
          // lerp 0→1 as it crosses
          return THREE.MathUtils.clamp((c.zEnd - z) / (c.zEnd - c.zStart), 0, 1);
        }
        if (r.biome === 'gate-to-temperate') {
          return THREE.MathUtils.clamp(1 - (c.zEnd - z) / (c.zEnd - c.zStart), 0, 1);
        }
      }
    }
    // boat outside any chunk (between updates): fall back to nearest neighbour
    let nearest = null, ndist = Infinity;
    for (const c of chunks) {
      const d = Math.min(Math.abs(c.zStart - z), Math.abs(c.zEnd - z));
      if (d < ndist) { ndist = d; nearest = c; }
    }
    if (!nearest) return 0;
    const r = nearest.recipe;
    if (r.biome === 'temperate') return 0;
    if (r.biome === 'canyon') return 1;
    return 0;
  }

  function reset(boatZ) {
    // Tear down everything and re-prime around the new boatZ
    for (const c of chunks) despawn(c);
    chunks.length = 0;
    nextChunkEndZ = boatZ + 150;
    nextCycleIdx = 0;
    update(boatZ);
  }

  // prime initial chunks
  update(0);

  return { update, tick, biomeTAt, reset, chunks };
}
