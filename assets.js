/* assets.js — loading the vendored models.
 *
 * Everything the scene puts on the ground comes through here. The files are
 * fetched and parsed once per id and handed out as clones, so placing sixteen
 * bushes costs one network read and one parse.
 *
 * The models come from several Kenney kits that do not share a world scale —
 * a Cube Pets chicken is authored larger than a Cube Pets cow, and the farmer
 * is taller than a tree. Rather than carry a table of per-kit multipliers,
 * which is only as right as the measurements behind it, this module scales by
 * a *target height*: say how tall the thing should be in world units and the
 * loader measures the model and works out the factor. The numbers below are
 * therefore readable as what they are — a cow is 0.9 units at the shoulder,
 * the farmer is 1.7 — and stay correct if an asset is ever swapped for
 * another one of a different authored size.
 *
 * See docs/ART_BIBLE.md for where the models come from and why these ones.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = './assets/models/';

/* World scale: 1 unit ≈ 1 metre, anchored on the Nature Kit, whose props are
   authored on a 1-unit grid that already matches the game's plot tiles. A
   model with no entry here is placed at its authored size, which is what the
   Nature Kit wants. */
export const TARGET_HEIGHT = {
  /* Not the 1.7 a person actually stands. These characters are chibi —
     the head is close to a third of the total — so a "realistic" 1.7-unit
     farmer stands beside a 1-unit plot tile with a head half a tile wide and
     reads as a giant rather than a person. 1.45 is where she stops competing
     with the field for attention while still being clearly a character, and
     not the 1.26 of boxes and cones she replaced. Judged by screenshot
     against 1.7 and 1.25. Anything with human proportions still gets its
     real height. */
  'blocky-characters/character-a': 1.45,
  'blocky-characters/character-e': 1.45,
  'cube-pets/animal-cow': 0.9,
  'cube-pets/animal-chick': 0.4,
  'cube-pets/animal-dog': 0.45,
  'cube-pets/animal-cat': 0.35,
  // Stands in for a sheep — the library has none. See the art bible's gap list.
  'cube-pets/animal-polar': 0.75,
};

const loader = new GLTFLoader();
const cache = new Map();

/** Parses a model once; repeat calls share the parse. */
function fetchModel(id) {
  if (!cache.has(id)) {
    cache.set(id, new Promise((resolve, reject) => {
      loader.load(`${BASE}${id}.glb`, resolve, undefined, reject);
    }));
  }
  return cache.get(id);
}

/* Scaling a group rather than baking it into the geometry keeps the clone
   cheap, and keeps the authored model untouched for anything that wants it
   at its original size. */
function scaleToHeight(object3d, height) {
  const size = new THREE.Box3().setFromObject(object3d).getSize(new THREE.Vector3());
  if (!(size.y > 0)) return; // a flat model has no height to normalise to
  object3d.scale.setScalar(height / size.y);
}

/**
 * Loads a model by id — the path under assets/models without the extension,
 * e.g. "nature/tree_default". Resolves to a fresh clone plus its animation
 * clips, so callers can place and animate it without disturbing anyone else's
 * copy.
 */
export async function loadModel(id, height = TARGET_HEIGHT[id]) {
  const gltf = await fetchModel(id);
  const object = gltf.scene.clone(true);

  /* The override is per-placement rather than per-model because an orchard of
     identically sized trees reads as wallpaper. Everything with one right
     answer — a cow, the farmer — still gets it from the table above. */
  if (height !== undefined) scaleToHeight(object, height);

  /* Clips bind to nodes by name, and clone(true) preserves names, so the
     clips returned here drive the clone. None of the kits in use are skinned
     — they animate node transforms — which is why a plain clone is enough
     and SkeletonUtils is not needed. */
  return { object, animations: gltf.animations ?? [] };
}

/** Warms the cache for ids that would otherwise pop in mid-play. */
export function preload(ids) {
  return Promise.all(ids.map((id) => fetchModel(id).catch(() => null)));
}
