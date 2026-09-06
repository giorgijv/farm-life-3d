# Art bible — Farm Life 3D overhaul

Step 1 of the two-week overhaul. Everything after this step inherits these
decisions, so each one below is *verified* rather than assumed: every asset
named here was downloaded, parsed, and rendered before it was written down.

Pinned: **2026-09-06**.

---

## 1. What the network allows (the constraint that reshaped the plan)

The overhaul plan named Kenney.nl, Quaternius and Mixamo as asset sources.
None of them are reachable from this environment. Measured:

| Host | Result |
|---|---|
| `raw.githubusercontent.com` | ✅ 200 |
| `registry.npmjs.org` | ✅ 200 |
| `github.com` (git clone/push) | ✅ works |
| `kenney.nl`, `quaternius.com` | ❌ egress-blocked |
| `cdn.jsdelivr.net`, `unpkg.com` | ❌ egress-blocked |
| `api.github.com`, `codeload.github.com` | ❌ 403 |
| `poly.pizza`, Mixamo, YouTube | ❌ blocked |

**Consequence:** assets come from GitHub raw or npm, and get vendored into the
repo. That was going to be true anyway — the game precaches its shell and must
run with the network off, so a runtime CDN was never an option.

## 2. Asset source

**[`shorepine/kenney`](https://github.com/shorepine/kenney)** @ commit
`3694c6879e487c108f55677be7dd2ca75b07cc3b` — a CC0 mirror of Kenney's library,
4,812 glTF-binary models across 49 kits, textures beside the models they belong
to. All art is Kenney's, released **CC0** (`LICENSE.txt` in that repo).

Fetch pattern, one file at a time, no tarball needed:

```
https://raw.githubusercontent.com/shorepine/kenney/<commit>/3d/<kit>/<model>.glb
```

Secondary source, for engine pieces rather than art —
**[`mrdoob/three.js`](https://github.com/mrdoob/three.js) @ r169** (MIT):
`examples/jsm/objects/Sky.js` (procedural physical sky, drives the day/night
cycle), `objects/Water.js` + `textures/waternormals.jpg` (step 9),
`jsm/loaders/GLTFLoader.js`, `jsm/postprocessing/*` (step 4).

> `GLTFLoader.js` imports `../utils/BufferGeometryUtils.js`, so vendoring a jsm
> module means vendoring its dependency tree. Step 2 read this as an argument
> for npm and a bundler; it turned out to be twenty lines of `tools/vendor.mjs`
> instead, and the game kept its zero-build-step property. See that file.

## 3. Kits in, kits out

**In:**

| Kit | Models | What it gives us |
|---|---|---|
| `nature` | 329 | Crops *with growth stages*, tilled dirt rows, fences, trees, bushes, flowers, grass, logs, stumps, cliffs, bridges |
| `cube-pets` | 24 | The herd — animated (`idle`/`walk`/`run`/`eat`) |
| `blocky-characters` | 18 | The farmer — 27 clips, verified working |
| `survival` | 80 | Tools (hoe, axe, shovel), barrels, boxes, chest, signposts, rocks |
| `city-suburban` | 40 | Farmhouse candidates, paths, driveways, garden fences |
| `fantasy-town` | 167 | Windmill, market stalls, roof/wall pieces to assemble a barn |
| `food` | 200 | Produce for inventory and market UI |

**Out, with reasons:**

- **`mini-characters`** — looked ideal (6 female + 6 male, 32 clips including
  `pick-up` and `interact-right`, plus wheelchair and mobility-aid clips). It is
  **broken in this export**: 10 nodes and 2 skins for a whole humanoid, with only
  7 nodes actually animated. Rendered, it stands with its arms splayed
  horizontally in every clip including bind pose. Verified against a known-good
  control (three.js `Soldier.glb`, 68 nodes / 52 animated) that renders
  perfectly through the identical code path — so this is the asset, not us.
- **`Soldier.glb` / `RobotExpressive.glb`** — technically excellent, wrong
  world. A photoreal soldier in a cozy farm is a worse mismatch than a blocky
  farmer.
- **Mixamo** — needs a login, host unreachable.

## 4. The scale contract

The kits do **not** share a world scale. Measured bounding boxes:

| Asset | Authored size (units) |
|---|---|
| `nature/fence_simple` | 1.00 w × 0.35 h |
| `nature/crops_dirtRow` | 1.00 × 0.62 |
| `nature/tree_default` | 1.71 h |
| `nature/crop_pumpkin` | 0.44 |
| `blocky-characters/character-a` | **2.70 h** |
| `cube-pets/animal-cow` | **1.65 h** |
| `cube-pets/animal-chick` | **2.23 w** (bigger than the cow) |

**Rule: the Nature Kit is the reference.** It is authored on a clean 1-unit grid
that already matches this game's 1-unit plot tiles, so it maps onto the existing
world with no conversion. Everything else is normalised to it on load:

Cube Pets are authored at a uniform "pet" size regardless of the real animal, so
each species needs its own correction to restore relative size.

**Implemented as target heights, not multipliers.** `assets.js` measures the
model on load and scales it to a stated height, so the table reads as what it
means and survives an asset being swapped for one of a different authored size:

| Model | Target height |
|---|---|
| `nature/*` | as authored — the reference |
| `blocky-characters/character-{a,b}` | 1.7 |
| `cube-pets/animal-cow` | 0.9 |
| `cube-pets/animal-polar` (sheep stand-in) | 0.75 |
| `cube-pets/animal-dog` | 0.45 |
| `cube-pets/animal-chick` | 0.4 |
| `cube-pets/animal-cat` | 0.35 |

One table, in `assets.js`, applied at load — never per-instance magic numbers.

## 5. Entity → asset map

Crops keep the game's existing three-stage growth model. The Nature Kit
supplies real stage models, including a generic sprout that matches the "young
plot is a generic sprout, not yet the crop it will become" beat the 2D game
already had:

| Crop | Sprout | Growing | Ripe |
|---|---|---|---|
| Wheat | `crops_leafsStageA` | `crops_wheatStageA` | `crops_wheatStageB` |
| Corn | `crops_leafsStageA` | `crops_cornStageB` | `crops_cornStageD` |
| Carrot | `crops_leafsStageA` | `crops_leafsStageB` | `crop_carrot` |
| Pumpkin | `crops_leafsStageA` | `crops_leafsStageB` | `crop_pumpkin` |

| Entity | Asset |
|---|---|
| Soil tile | `nature/crops_dirtSingle`, `crops_dirtRow` (+ corner/end pieces) |
| Field & pen fence | `nature/fence_simple`, `fence_corner`, `fence_gate` |
| Farmer (f/m) | `blocky-characters/character-{a,b}` — clips `idle`, `walk`, `sprint`, `interact-*`, `pick-up`, `sit`, `emote-yes/no` |
| Cow / chicken / dog / cat | `cube-pets/animal-{cow,chick,dog,cat}` — clips `idle`, `walk`, `run`, `eat` |
| Farmhouse | `city-suburban/building-type-a` |
| Windmill, market stall | `fantasy-town/windmill`, `stall`, `stall-green` |
| Tools, crates, rocks | `survival/tool-hoe`, `barrel`, `box`, `chest`, `rock-a..c` |
| Foliage (instanced) | `nature/grass`, `grass_large`, `plant_bush`, `flower_{red,yellow,purple}A` |
| Trees | `nature/tree_default`, `tree_detailed`, `tree_fat` |

**Seasons come free:** every nature tree ships `_default`, `_dark` and `_fall`
variants. Step 13's autumn is a model swap, not a shader.

## 6. Two gaps, and what to do about them

**There is no sheep.** Not in Cube Pets, not anywhere in 4,812 models (the only
hit in the whole library is a hexagon terrain tile). The game's economy needs
sheep for wool, so swapping the species would break it.

- Default: `cube-pets/animal-polar` at ×0.5, tinted cream. It is a white,
  rounded quadruped and reads as woolly at play distance.
- Fallback: keep the existing hand-built faceted sheep. It already reads well,
  and one procedural model among kit models is a smaller cost than a bear.
- Decide in step 11, by looking at both. Do not spend longer than that on it.

**There is no barn or silo,** and the game sells Small Barn / Large Barn as
hurricane shelters. Assemble one from `fantasy-town` roof and wall pieces, or
use a second `city-suburban/building-type-*` at a larger scale. Step 7.

## 7. Budget

A complete 44-asset shortlist covering every entity above: **1.75 MB**, largest
single file 267 KB. For comparison the current shell already ships a 670 KB
`three.module.js`.

That is small enough to **precache the whole asset set in the service worker**.
No lazy-loading, no streaming, no loading-screen machinery — step 2 keeps the
offline-first promise with the same precache-on-install approach the game uses
today. Anything that pushes this past ~4 MB should be reconsidered rather than
lazily loaded.

## 8. Palette

Sampled from the kits rather than invented, so the UI and the scene agree:

| Role | Hex |
|---|---|
| Grass / ground | `#7FAE55` |
| Sky, day | `#9ED0F0` |
| Tilled soil | `#8A6A47` |
| Fence / timber | `#9E6B43` |
| Foliage, mid | `#3E7A46` |
| Sun / warm light | `#FFF3D6` |

Day/night colour ramps stay as they are: the 2D sky strip and the 3D scene
already read the same clock through `daySkyState()`, and that stays the single
source of truth.

## 9. Movement model

Confirmed, per decision 02 of the overhaul plan: **direct control with a
following third-person camera.** The tap-to-queue-a-walk mechanic retires in
step 6. Interaction becomes proximity plus a prompt — walk up to a plot, press
the button.

The accessibility consequence is not optional and is not deferred: the invisible
`#plotsGrid` button layer is the game's entire keyboard and screen-reader story,
and free movement invalidates it. Step 12 replaces it, and step 12 is on the
"never cut" list for exactly this reason.

---

## 10. Sky, terrain and tone mapping — step 3 addendum

Step 1 called for "an HDRI sky". What shipped is
[`three.js`'s own `Sky.js`](https://github.com/mrdoob/three.js/blob/r169/examples/jsm/objects/Sky.js)
— a real-time Preetham atmospheric scattering shader, not a baked `.hdr` file —
and that turned out to be the better fit, not a fallback: a static HDRI would
need a different capture per time of day, or fading between several; Sky.js
takes nothing but a sun direction and produces the whole day/dusk/night range
on its own, already in sync with `daySkyState()` through `syncSky()`. No new
asset to license or vendor beyond the module itself (MIT, same as three.js
core).

**It does not work without tone mapping.** Sky.js's shader outputs unclamped
HDR radiance by design; without a tone-mapping curve, every pixel above 1.0
clips to flat white — confirmed by screenshot before this was understood,
hills in silhouette against a blown-out sheet instead of a sky. `renderer.
toneMapping = THREE.ACESFilmicToneMapping` (exposure `0.5`, matching three.js's
own Sky.js example) fixes it, but it is not free: applied globally, it also
recompressed the day/night lighting curve step 9 tuned — night went darker
than the double-darkening bug that step 9 itself found and fixed, confirmed by
sweeping exposure from 0.5 to 2.4 and watching night stay black regardless,
because ACES crushes near-black input toward zero independent of exposure.

**The fix was `material.toneMapped = false`** on every material except the
sky's, set in one pass over the finished scene rather than at each material's
own construction. Nothing but the sky dome needed ACES in the first place, so
nothing else pays for it, and step 9's lighting curve is provably untouched —
confirmed by screenshot, pixel for pixel, before and after. **Anything step 4
adds — bloom, SSAO, colour grading — needs the same check**: verify it doesn't
also reach into materials that were tuned for a different renderer state.

**Terrain is a hand-built heightfield, not a Kenney model**: flat under the
field and pen (a rounded rectangle, margined so no fence post sits in the
transition band), rising into gentle hills beyond via a two-octave value noise
(hashed lattice, smooth-interpolated — not gradient/Perlin noise, deliberately
the cheapest thing that isn't a flat plane, since it only ever runs once at
load). Vertex-coloured rather than textured: a mottled two-tone grass blended
toward dirt by slope, standing in for "blended textures" without a photographic
tileable that would have clashed with the kit models' flat-shaded look anyway.

**Deliberately not done: a PMREM environment map for image-based lighting**,
the other half of step 1's ask. A captured environment needs to track day/night
like everything else here, and re-rendering one on any real cadence is the
same class of per-frame cost steps 4-6 and step 9 both found this scene's
CI path has no patience for; a single fixed capture would just paint a
permanent noon-bright sheen across materials through midnight. It would also
duplicate the hemisphere light's own job. Fog already ties distant surfaces to
the horizon colour, which is most of what "something to reflect" was for.

---

## Verified, not assumed

Everything above was checked before it was written:

- Every named asset was downloaded and its glTF JSON parsed for meshes, nodes,
  skins and animation clips.
- Nature Kit props, Cube Pets animals and a character were rendered together in
  one scene to confirm the kits read as a single visual language. They do.
- The character was rendered in bind pose, `idle` and `walk`, beside a
  known-good control, which is how `mini-characters` was caught and
  `blocky-characters` chosen.
- Sizes are measured bounding boxes, not estimates. The shortlist total is
  measured `content-length`, not a guess.
- Sky.js's need for tone mapping, and tone mapping's effect on the existing
  lighting, were both found by screenshot before being written down here —
  the first from a render that was visibly wrong, the second from an exposure
  sweep (0.5 to 2.4) that showed night staying black regardless, which is what
  ruled out "just raise the exposure" as a fix.
- The full test suite (237 tests, including every walk-queue and interaction
  test) passes unchanged with the new terrain and sky in place, and a 4-worker
  contention stress run was compared against a clean pre-step-3 baseline
  rather than assumed safe — both show the same pre-existing flakiness in the
  same two tests, not a new one.

Probe scripts live outside the repo, in the session scratchpad. They were
throwaway; this document is what they were for.
