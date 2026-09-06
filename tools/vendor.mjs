/* Fetches the third-party files the game ships: three.js's own jsm modules,
 * and the CC0 models from the Kenney mirror.
 *
 * Why a script rather than npm and a bundler: the game has no build step, and
 * keeping it that way is worth more here than tree-shaking would be. The whole
 * model set measures under 2 MB, so there is nothing to compress, and the two
 * things a bundler would genuinely earn us — resolving jsm's relative imports
 * and pinning versions — are the twenty lines below.
 *
 * Everything it writes is committed. This is not a build step: you run it when
 * you want to add a model or move to a new three.js release, and the working
 * tree it produces is what ships. Run with no arguments:
 *
 *     node tools/vendor.mjs
 *
 * Pins live at the top of this file. Bump THREE_REF or KENNEY_COMMIT, re-run,
 * and bump CACHE_VERSION in sw.js so the service worker re-caches.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */

const THREE_REF = 'r169'; // must match vendor/three.module.js
const THREE_BASE = `https://raw.githubusercontent.com/mrdoob/three.js/${THREE_REF}/examples/jsm`;

/* A CC0 mirror of Kenney's library, pinned to a commit rather than a branch:
   the paths are the game's asset ids, and a moving target would silently
   change art under a released build. See docs/ART_BIBLE.md. */
const KENNEY_COMMIT = '3694c6879e487c108f55677be7dd2ca75b07cc3b';
const KENNEY_BASE = `https://raw.githubusercontent.com/shorepine/kenney/${KENNEY_COMMIT}/3d`;

/* jsm entry points. Their own relative imports are followed and fetched too,
   so adding "postprocessing/EffectComposer.js" here in step 4 brings its
   whole dependency tree with it. */
const JSM_ENTRIES = [
  'controls/OrbitControls.js',
  'loaders/GLTFLoader.js',
];

/* The models, by the kit they come from. Kept to what the art bible's entity
   map actually names — every file here is one the game will place. */
const KENNEY_MODELS = {
  nature: [
    // Crops, in the three growth stages the rules already model.
    'crops_leafsStageA', 'crops_leafsStageB',
    'crops_wheatStageA', 'crops_wheatStageB',
    'crops_cornStageB', 'crops_cornStageD',
    'crop_carrot', 'crop_pumpkin',
    // The ground they grow in, and what fences it.
    'crops_dirtSingle', 'crops_dirtRow',
    'fence_simple', 'fence_corner', 'fence_gate',
    // Set dressing, all instanced later.
    'grass', 'grass_large', 'plant_bush',
    'flower_redA', 'flower_yellowA',
    'tree_default', 'tree_detailed', 'tree_default_fall',
    'stump_round',
  ],
  'cube-pets': ['animal-cow', 'animal-chick', 'animal-dog', 'animal-cat', 'animal-polar'],
  'blocky-characters': ['character-a', 'character-b'],
  survival: ['barrel', 'box', 'chest', 'tool-hoe', 'signpost', 'rock-a'],
  'city-suburban': ['building-type-a'],
  'fantasy-town': ['windmill'],
};

/* Kits whose models reference a shared texture atlas by a relative URI
   ("Textures/colormap.png"), which therefore has to land beside them. The
   Nature Kit is absent on purpose: its models carry their own materials. */
const KIT_TEXTURES = {
  'cube-pets': ['Textures/colormap.png'],
  survival: ['Textures/colormap.png'],
  'city-suburban': ['Textures/colormap.png'],
  'fantasy-town': ['Textures/colormap.png'],
  // Blocky characters are textured per character rather than per kit.
  'blocky-characters': ['Textures/texture-a.png', 'Textures/texture-b.png'],
};

/* ------------------------------------------------------------------ */

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function write(relPath, buf) {
  const dest = join(ROOT, relPath);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return { path: `./${relPath}`, bytes: buf.length };
}

/* Follows the relative imports out of a jsm module, so callers name an entry
   point rather than a file list. three.js's own "three" imports resolve
   through the import map in index.html and are left alone. */
async function vendorJsm(entry, seen, written) {
  if (seen.has(entry)) return;
  seen.add(entry);

  const src = (await get(`${THREE_BASE}/${entry}`)).toString('utf8');
  written.push(await write(`vendor/jsm/${entry}`, Buffer.from(src)));

  const deps = [...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  for (const dep of deps) {
    // posix.normalize keeps "../utils/x.js" resolving the way the browser will.
    await vendorJsm(posix.normalize(posix.join(posix.dirname(entry), dep)), seen, written);
  }
}

async function main() {
  const written = [];

  const seen = new Set();
  for (const entry of JSM_ENTRIES) await vendorJsm(entry, seen, written);
  const jsmCount = written.length;

  const assets = [];
  for (const [kit, models] of Object.entries(KENNEY_MODELS)) {
    for (const name of models) {
      const rel = `assets/models/${kit}/${name}.glb`;
      const buf = await get(`${KENNEY_BASE}/${kit}/${name}.glb`);
      if (buf.subarray(0, 4).toString() !== 'glTF') throw new Error(`not a glb: ${rel}`);
      assets.push(await write(rel, buf));
    }
    for (const tex of KIT_TEXTURES[kit] ?? []) {
      assets.push(await write(`assets/models/${kit}/${tex}`, await get(`${KENNEY_BASE}/${kit}/${tex}`)));
    }
  }

  /* The manifest is what the service worker precaches from, so the asset list
     lives in one place instead of being duplicated into sw.js by hand. */
  const total = assets.reduce((n, a) => n + a.bytes, 0);
  await write('assets/manifest.json', Buffer.from(`${JSON.stringify({
    source: { kenney: KENNEY_COMMIT, three: THREE_REF },
    bytes: total,
    files: assets.map((a) => a.path),
  }, null, 2)}\n`));

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`jsm modules : ${jsmCount} files (${kb(written.slice(0, jsmCount).reduce((n, f) => n + f.bytes, 0))})`);
  console.log(`models      : ${assets.length} files (${kb(total)})`);
  console.log(`manifest    : assets/manifest.json`);
}

const prev = await readFile(join(ROOT, 'assets/manifest.json'), 'utf8').catch(() => null);
await main();
if (prev) {
  const now = await readFile(join(ROOT, 'assets/manifest.json'), 'utf8');
  if (prev !== now) console.log('\nmanifest changed — bump CACHE_VERSION in sw.js');
}
