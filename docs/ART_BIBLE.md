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

## 11. Post-processing, and the camera that blocks it — step 4 addendum

Step 4 asked for bloom, ambient occlusion and ACES grading through an
`EffectComposer`, on a measured frame budget. The composer, the budget and the
two effects all ship. **What does not ship is the visible payoff, and the
reason is the camera, not the effects.**

**The tone-mapping trap section 10 warned about is real, and avoided.** A
composer chain normally ends in `OutputPass`, which applies
`renderer.toneMapping` to the whole finished image — which would have
overruled the per-material `toneMapped = false` that keeps ACES on the sky and
off everything else, re-crushing night exactly as step 3 found. The chain
therefore ends in `ShaderPass(GammaCorrectionShader)`: sRGB conversion and
nothing else. Verified by rendering the default view at midday, dusk and
midnight against a step-3 baseline — the only differences are contact shading
where geometry meets geometry, which is the AO doing its job.

**Ambient occlusion is the contact shadow this scene has been missing.**
Shadow mapping was tried and dropped twice on CI cost. AO gets most of what
they were for — objects sitting on the ground rather than floating — for a
pass that does not scale with the number of casters. Two numbers matter and
they are in *different units*: `kernelRadius` is world units (metres), while
`minDistance`/`maxDistance` are compared against a depth difference normalised
across the camera's near and far planes (0.1 and 100), so one of those units is
about a hundred metres and a centimetre is `0.0001`. The first attempt used
`0.0015`/`0.06` — 15cm to 6m — which rejected every sample a 28cm kernel could
produce and rendered a pure white, entirely absent AO buffer that looks exactly
like a pass that isn't running.

**Bloom is tuned far below a first guess** (`0.15` strength, `0.3` radius,
`0.8` threshold) because the sky is a third of the frame once it *is* in
frame, and bloom spreads brightness outward: at `0.32`/`0.62` it poured milk
over the hills until they vanished, at midday and dusk alike.

**The camera is the blocker, and it is an interaction problem.** The default
view sits at about 44 degrees of downward pitch against a 48-degree vertical
FOV, which puts the horizon roughly 20 degrees above the top of the picture —
so the terrain and sky section 10 describes are, in ordinary play, never on
screen, and step 3's own test of itself ("reads as a place with a horizon, not
a green rectangle") is not met by the view the game opens on. Post-processing
cannot help a frame with nothing bright or distant in it, which is why both
effects measured as near-invisible before this was understood.

Framing the horizon needs the pitch under about 24 degrees. Measured, at that
pitch the sixteen tiles foreshorten into a band **21% of the frame tall**. The
invisible plot buttons layered over the canvas (`.plots-grid`) have to stay
about **59% tall**, because that is what keeps sixteen of them above the 44px
touch-target floor on a phone — already an overshoot of the field's current
43%, tolerable only because it is roughly right. Against a 21% band it would
not be: you would tap a tile you could see and plant in a different row.

So the horizon cannot be framed while sixteen screen-space buttons stand in
for the field. **Step 6 replaces them with proximity prompts and step 12
rebuilds the accessibility path around that; the camera opens up there, and
that is when the bloom already sitting in the scene starts earning its cost.**

**The budget measures the gap between draws, not the time the draw call
takes.** Timing the call was tried first and is worthless: GL queues the work
and returns, so all three tiers measured one to two milliseconds and the most
expensive one came out *fastest*. Two further mistakes worth not repeating —
the first version discarded any interval over 500ms as "we weren't drawing",
which went blind at exactly the frame times it exists to catch (the software
rasteriser here draws at ~800ms, so the average never moved off zero); and
judging a tier only after a fixed twenty draws takes sixteen seconds at those
frame times, which is longer than most CI test pages live. The rule now
forgets `lastDrawAt` whenever it skips a draw, so a long gap can only mean a
slow frame, and acts after three draws when the verdict is more than 3x over
budget while still making a marginal one survive the full window.

**And measuring is not free, so the driver is asked first.** Even with a fast
step-down, starting every page at the top tier means every page pays several
800ms frames to reach the same conclusion. Across a suite that loads the game
a few hundred times that took the run from **6.7 minutes to 20.2**, against a
CI timeout of ten — the measurement cost more than the feature was worth. So
`WEBGL_debug_renderer_info` is checked before the first draw, and a renderer
naming itself SwiftShader, llvmpipe or software starts at the plain tier with
nothing wasted. The string is a hint, not a contract: the measured budget
still runs underneath it, and still has the last word on hardware that
reports itself as real and then fails to keep up.

One consequence worth stating plainly: **CI never exercises the composer's
own passes**, because CI is exactly the environment this drops to plain. The
passes are covered by screenshot comparison during development instead, and
the tests assert only that the budget is measuring and that the tier is one
of the three — never which one, since which tier a machine can afford is the
whole question, and pinning it would be a test that fails precisely when the
feature works.

---

## 12. The farmer — step 5 addendum

The boxes-and-cones rig is gone. She is a Kenney *Blocky Characters* model
driven by an `AnimationMixer`, and the hand-authored limb swing —
`sin(walkPhase)` on four rotations, plus a 24% squash along Y to fake a
crouch — retires with it.

**Three of the kit's twenty-seven clips are used**: `idle`, `walk`, and
`pick-up` for the beat at the tile. `pick-up` is a real bend-and-lift, which
is exactly what the squash was imitating. One-shots are stretched with
`setDuration` to the beat the rules already keep (`CROUCH_MS`), rather than
the rules being made to wait however long the animator's version runs.

**The two farmers are two authored characters, not one recoloured.** The old
rig distinguished them with a skirt, a longer fringe and two shirt colours,
which was the whole of the difference. The picker offers "Female farmer" and
"Male farmer" by name, so the models have to read that way — and most of this
pack does not: four of the eight are robots and several of the rest are
androgynous. `character-e` reads as the former and `character-a`, bearded, as
the latter. Found by rendering the whole cast into the scene and looking, not
from the file names; `character-b`, the obvious second file, is androgynous
and no longer shipped.

**They are 1.45 units, not the 1.7 a person stands.** These characters are
chibi — the head is close to a third of the height — so a "realistic" farmer
stands beside a 1-unit plot tile with a head half a tile wide and reads as a
giant. 1.45 keeps her clearly a character without competing with the field;
judged against 1.7 and 1.25. The rule for anything with human proportions is
still its real height.

**Two things that a wrong guess hides rather than breaks.** The model's
forward is +Z, matching `facing = atan2(dx, dz)`, so the rotation offset is
zero — but it is kept as a named constant, because the first guess of `π` was
wrong and produced a farmer who walked to work backwards, which reads as a
deliberate style choice for exactly as long as it takes to notice. And the
walk clip carries no ground speed of its own: `timeScale` is set from
`WALK_SPEED / CLIP_WALK_SPEED` so her feet stay planted instead of skating.

**The body is fetched, so the scene has to cope with not having one.** The
mixer is fed drawing time rather than simulation time — the walk is stepped
every frame whether or not the field is on screen, but feeding the mixer a
gap that spans a spell on the Market tab would teleport her through half a
stride. A model that fails to load leaves the farm entirely playable and the
farmer invisible: worth a console complaint, but not a fallback rig, since
every model here is precached and an absent one means a broken install.

---

## 13. Driving her, and the camera that came with it — step 6 addendum

**The field is driven now, not tapped.** A stick in the bottom-left corner and
WASD/arrows both feed one `drive` vector; a single prompt in the bottom-right
offers whatever is within `REACH` (0.95 units — generous enough not to demand
a tile centre, tighter than the 1.15 between tiles so the answer is never
ambiguous). Space runs it, or tap the button.

**This is what unblocked the camera, which is the real prize.** Sections 11
and 12 record the deadlock: framing the horizon needs the pitch under about
24°, at which the sixteen tiles foreshorten to a 21%-tall band, while the
invisible plot buttons had to stay ~59% tall to keep sixteen touch targets
above 44px. Nothing tapped through that grid any more, so `.plots-grid` became
`pointer-events: none` and the pitch went to ~21°. **The terrain from step 3,
the sky from step 3 and the bloom from step 4 are all on screen for the first
time**, in the view the game opens on rather than one a player has to go
looking for.

**The camera follows by moving OrbitControls' target, not by replacing it.**
The target slides to wherever she is and the camera moves by the same vector,
so drag still orbits and pinch still zooms — the follow never touches the
offset between the two, so the two cannot fight. Eased at 0.12 rather than
locked: at walking pace a hard lock reads as the world sliding under a fixed
farmer, which on a scene that now has a horizon in it is faintly seasick.

**The walk queue is still there, deliberately.** It is what a keyboard and a
screen reader use: tab still reaches all sixteen plots, and activating one
still sends her walking to it. Deleting it here — before step 12 has built the
replacement — would have been shipping a regression dressed as a feature. The
two models coexist cleanly because taking hold of the stick drops whatever
round she was on; a player steering is a player who has changed their mind,
and resuming the old errand when they let go would feel haunted. What did go
is the trudge home when the queue ran dry: where she stands is now the
player's decision, and undoing it would be undoing their last instruction.

**Two things the tests had to change shape for, and one worth not repeating.**
The plot buttons take no pointer input, so the suite activates them the way a
keyboard does (`dispatchEvent('click')`) rather than with a synthesised mouse
press that would now land on the canvas behind them. And the mobile "playable
by tapping" test drives the stick with real pointer events — which is why the
stick listens for pointer rather than touch events, and is also why a laptop
can use it. The mistake worth remembering: the prompt was first refreshed only
when the target or its intent changed, and picking a different seed changes
neither while changing what the button must say, so it went on offering a crop
the player had stopped choosing. Whether anything needs repainting is a
question about the label, so it is now answered where the label is written.

---

## 14. Four rooms, and where the tall things go — step 7 addendum

The farm is four places now: the **crop field** and the **pasture** where they
were, an **orchard** north, and the **dooryard** south that she comes out
into. Two paths join them — a spine down the west side and a branch east to
the pasture gate, plus a spur to the farmhouse door.

**Where the tall props go is a camera question before it is a farm one.** The
follow camera sits about nine units behind her, which for a farmer facing up
the field means it stands in the dooryard — so the farmhouse put there, the
obvious place for it, spent most of the game between the camera and the
player's own character. The buildings now flank the field east and west,
where they are seen past her rather than through, and the dooryard keeps
nothing taller than a barrel.

**Buildings are sized by width, not the height the loader normalises to.** A
1.3 x 0.83 model asked to stand 3 units tall comes out 4.7 wide; the first
attempt put the barn straight through the pasture fence. `loadModel` now takes
a per-placement height override, because an orchard of identically sized trees
reads as wallpaper while a cow still has exactly one right size.

**Paths are a ribbon of geometry, not vertex colours and not tiles.** The kit
does ship path tiles, and vertex-colouring the terrain was the cheaper idea —
until the numbers were checked: the terrain is 48 segments across 60 units, so
its vertices are 1.25 apart and a path 0.8 wide would not have registered in
its colours at all, while tiling real meshes along two routes is dozens of
draw calls for something nobody looks at directly. Three rectangles in one
mesh, one draw call.

**Props are placed by hand, one entry each.** A seeded scatter would give the
even, sourceless spread that makes procedural dressing read as procedural.
Nothing collides — she walks through a tree trunk if she insists; collision is
a step-14 question about a scene ten times this size, and building it now for
thirty props would be building it twice.

**Gaps, checked rather than assumed.** The mirror has **no barn and no silo**
in any kit — probed directly, across `fantasy-town`, `holiday`, `farm`,
`castle` and `survival`. The barn is a second `city-suburban` block standing
in. And `fantasy-town/windmill` is **not a windmill**: it is the sail assembly
alone, meant to be pinned to a building, so at every scale it hangs in the air
beside the farmhouse looking like a fallen gate. Dropped, and the kit is left
in `tools/vendor.mjs` as an empty entry so the next person can see it was
tried.

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
- Step 4's claim that the composer leaves the existing image alone is a pixel
  comparison against a step-3 baseline at midday, dusk and midnight, not an
  argument from how the passes are wired.
- The 21%-versus-59% figures that rule the camera out are projected from the
  live camera through `Vector3.project`, and the 44px floor they run into is
  the measured button size at a 390px viewport — neither is an estimate.
- The AO tuning was found by rendering `SSAOPass`'s own AO buffer rather than
  inferring it from the composited frame, which is what showed the first
  attempt producing no occlusion at all.
- Every screenshot comparing one setting against another pins
  `state.dayElapsedMs` immediately before the shutter. An earlier round did
  not, and the in-game clock moving a few seconds between shots read
  convincingly as "this effect darkened everything".

Probe scripts live outside the repo, in the session scratchpad. They were
throwaway; this document is what they were for.
