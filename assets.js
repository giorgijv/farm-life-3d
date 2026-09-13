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

/* Two things the kits get wrong about their own materials, corrected once
   per parse — before any clone is handed out, so every copy and every
   InstancedMesh built from loadMeshes below gets the corrected version.
   Both were found by reading the glTF JSON, not guessed from how the scene
   looked; the fix for each is the one line the file should have contained.

   1. The Nature Kit declares metallicFactor: 1 on every material, with no
      metallic-roughness texture and a plain coloured base. That is not a
      description of metal, it is a default nobody overrode — and it is
      ruinous, because a fully metallic surface has no diffuse response at
      all. With no environment map to reflect, every tree, bush, tuft of
      grass, log and rock in the game was being lit by a single broad
      specular lobe and nothing else, which is why the orchard read as a
      row of near-black blobs and the grass as dark spikes. Rendered side
      by side at 1 and at 0, the difference is not subtle: the same
      leafsGreen goes from murky bottle-green to the sage the base colour
      actually is. Only materials that claim to be fully metallic while
      carrying no metalness map are touched, which is exactly the Nature
      Kit and nothing else — the Cube Pets, city and fantasy kits all
      declare 0 already.

   2. The characters declare KHR_materials_unlit, so GLTFLoader correctly
      builds them a MeshBasicMaterial. Correct to the letter of the file,
      and wrong for this game: an unlit farmer takes no light at all, so
      she stayed noon-bright through dusk and midnight, ignored the sun
      that every other object in the yard responds to, and — once there
      were shadows — could neither cast nor receive one. She is the thing
      the player looks at most and the only thing in the scene not lit by
      the scene. Rebuilt as a standard material carrying the same texture,
      which is what puts her in the same world as her own cows. */
/* The third thing the Nature Kit gets wrong, and the one that needed
   evidence rather than an eye. glTF defines baseColorFactor as *linear*.
   This kit's numbers are not linear; they are the sRGB values written
   straight into the linear slot, which is a colour-space bug an exporter
   makes and nobody notices in a viewer that also gets it wrong.

   It is diagnosable from the material names alone, without deciding
   anything about taste — every one of them renders as a pastel of the
   thing it is called:

     colorRed   #f19398  pink          -> corrected  a red
     dirt       #f2be9e  pale peach    -> corrected  a brown
     woodBark   #f2be9e  pale peach    -> corrected  a brown
     stone      #ddf2f5  near-white    -> corrected  a grey
     corn       #fbdfa8  cream         -> corrected  a corn yellow

   A material called "dirt" that is the colour of a peach is not a stylistic
   choice. Reading the stored numbers as sRGB and converting them properly
   puts every one of them back on its own name.

   Only untextured materials are touched. Anything with a baseColorTexture
   (the buildings, the animals, the characters) carries its colour in the
   texture, whose colour space GLTFLoader already sets correctly, and its
   factor is plain white — so this would be a no-op there even if it ran. */
function correctBaseColor(mat) {
  mat.color.copySRGBToLinear(mat.color);
}

/* One place where the *scene* gets to disagree with a kit about a colour,
   as opposed to the three corrections above, where the kit is simply wrong
   about its own file.

   The distinction matters. Metalness, unlit characters and the colour-space
   slip are defects: the file says one thing and means another, and fixing
   them is what makes the model render as its author drew it. A palette
   override is not a defect, it is art direction — this farm wants its
   ground cover a particular green — and it is applied by name, once per
   parse, so that every model sharing that material agrees. The Nature Kit's
   `grass` material is shared by the tufts, the bushes, the flower stems and
   the pumpkin's leaves; without this they would have to be tinted one by
   one at every placement, and the next prop added would quietly miss out.

   Registered by the scene before it loads anything, so that the decision
   lives with the rest of the palette rather than in the loader. */
const paletteOverrides = new Map();

/** Repaints a named kit material for the whole game. `hex` is sRGB. */
export function overrideKitColor(materialName, hex) {
  paletteOverrides.set(materialName, hex);
}

function conditionMaterials(gltf) {
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    const fixed = materials.map((mat) => {
      if (mat.isMeshBasicMaterial && mat.map) {
        const lit = new THREE.MeshStandardMaterial({
          map: mat.map,
          color: mat.color,
          side: mat.side,
          transparent: mat.transparent,
          opacity: mat.opacity,
          alphaTest: mat.alphaTest,
          // Cloth and skin, not plastic: no sheen worth speaking of, and
          // nothing here is metal.
          roughness: 0.9,
          metalness: 0,
        });
        lit.name = mat.name;
        mat.dispose();
        return lit;
      }
      if (mat.isMeshStandardMaterial && mat.metalness === 1 && !mat.metalnessMap) {
        mat.metalness = 0;
      }
      if (mat.isMeshStandardMaterial && !mat.map) correctBaseColor(mat);
      // After the correction, so an override is read as the colour it looks
      // like rather than as a value that still has to be un-mangled.
      if (paletteOverrides.has(mat.name)) mat.color.setHex(paletteOverrides.get(mat.name));
      return mat;
    });
    obj.material = Array.isArray(obj.material) ? fixed : fixed[0];
  });
  return gltf;
}

/** Parses a model once; repeat calls share the parse. */
function fetchModel(id) {
  if (!cache.has(id)) {
    cache.set(id, new Promise((resolve, reject) => {
      loader.load(`${BASE}${id}.glb`, (gltf) => resolve(conditionMaterials(gltf)), undefined, reject);
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

/**
 * Loads a model's raw meshes for instancing — the geometries and materials
 * as authored, not wrapped in a fresh clone. An InstancedMesh is built to
 * share one geometry and one material across many placements; handing it a
 * clone of each would defeat the reason it exists.
 *
 * Resolves to `{ meshes, height }`. `meshes` is one entry per primitive in
 * the model — a tree's trunk and its canopy are two separate meshes with two
 * materials, and both are needed to draw one tree. `height` is the model's
 * authored bounding-box height, for a caller computing its own scale the way
 * scaleToHeight does above; foliage generally wants many differently-sized
 * instances of one species rather than the single fixed height TARGET_HEIGHT
 * gives a cow or a farmer.
 */
export async function loadMeshes(id) {
  const gltf = await fetchModel(id);
  const meshes = [];
  gltf.scene.traverse((obj) => {
    if (obj.isMesh) meshes.push({ geometry: obj.geometry, material: obj.material });
  });
  const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
  return { meshes, height };
}
