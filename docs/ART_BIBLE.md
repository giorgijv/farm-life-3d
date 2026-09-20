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

Crops keep the game's existing three-stage growth model — plotGrowthStage
still returns 0/1/2 — but stage 2 turned out, once actually built in step 11,
to have real models for both "grown but not yet ripe" and "ripe" for two of
the four crops, which this table's first draft did not anticipate. See §19
for the shipped mapping and why carrot and pumpkin only get one model apiece
for stage 2 rather than four crops getting a matched pair:

| Crop | Sprout (0) | Seedling (1) | Growing (2, not ripe) | Ripe (2, ripe) |
|---|---|---|---|---|
| Wheat | `crops_leafsStageA` | `crops_leafsStageB` | `crops_wheatStageA` | `crops_wheatStageB` |
| Corn | `crops_leafsStageA` | `crops_leafsStageB` | `crops_cornStageB` | `crops_cornStageD` |
| Carrot | `crops_leafsStageA` | `crops_leafsStageB` | `crop_carrot` | `crop_carrot` |
| Pumpkin | `crops_leafsStageA` | `crops_leafsStageB` | `crop_pumpkin` | `crop_pumpkin` |

| Entity | Asset |
|---|---|
| Soil tile | `nature/crops_dirtSingle`, `crops_dirtRow` (+ corner/end pieces) |
| Field & pen fence | `nature/fence_simple`, `fence_corner`, `fence_gate` |
| Farmer (f/m) | `blocky-characters/character-{a,b}` — clips `idle`, `walk`, `sprint`, `interact-*`, `pick-up`, `sit`, `emote-yes/no` |
| Cow / chicken / dog / cat | `cube-pets/animal-{cow,chick,dog,cat}` — clips `idle`, `walk`, `run`, `eat` |
| Farmhouse | `city-suburban/building-type-a` |
| Windmill, market stall | ~~`fantasy-town/windmill`, `stall`~~ neither shipped — see the step 7 and step 11 addenda; `stall-green` did |
| Tools, crates, rocks | `survival/tool-hoe`, `barrel`, `box`, `chest`, `rock-a..c` |
| Foliage (instanced) | `nature/grass`, `grass_large`, `plant_bush`, `flower_{red,yellow,purple}A` |
| Trees | `nature/tree_default`, `tree_detailed`, `tree_fat` |

**Seasons come free:** every nature tree ships `_default`, `_dark` and `_fall`
variants. Step 13's autumn is a model swap, not a shader.

*What step 13 found, checked against the pinned Kenney mirror rather than
assumed from this table: true for `tree_default` and `tree_detailed`, not
true for the pines. `tree_pineDefaultA` and `tree_pineRoundA` ship no
`_dark`, `_fall` or `_snow` variant at all — four fetches each, all 404.
Caught before anything was built on top of it, not after. The shipped scope
follows the assets that exist: the six hand-placed `tree_default`/
`tree_detailed` trees in the orchard get a real fall companion and turn
together, as one season changing rather than six trees on separate clocks;
the instanced hillside fringe from step 8 — both species, pines included —
keeps its summer green all year. See §21.*

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
and free movement invalidates it. Step 12 answers it, and step 12 is on the
"never cut" list for exactly this reason.

*What step 12 actually did, once it got there: not replace the grid. Free
movement invalidated three things about it — where its highlight was drawn,
how many tab stops it cost, and its claim on the arrow keys — and all three
were repaired. The grid of labelled plots itself turned out to be the right
interface for the player it exists for, and swapping it for a character to
steer blind would have been the regression, not the fix. See §20.*

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

## 15. Grass, and a fringe of trees on the hills — step 8 addendum

Two `InstancedMesh` grass species scattered across the farm's open ground —
`nature/grass` (220 requested) and `nature/grass_large` (70) — plus a light
fringe of hillside trees just past the flat farm (`tree_default`,
`tree_pineDefaultA`, 14 and 12) to close the gap step 6 opened: once the
camera could see the horizon, the hills behind it turned out to be bare.

**Placement is rejection sampling against shapes the scene already has**, not
a new layout traced by hand: a candidate point is accepted for grass when it
falls outside the tile grid, the pen, the paths and a clearing around each
building, and accepted for the hill fringe when `terrainHeight` says it is
genuinely on the rise (that function returns exactly 0 on the flat farm and
only departs from it past the transition, which is a free "is this the hill"
test already computed for the terrain mesh — no second one needed). Seeded
with a small mulberry32 rather than `Math.random()`, so the same farm loads
the same way twice, which is the only way a screenshot from today can be
compared against one from tomorrow.

**A tree's parts must share one transform, not one each.** Kenney's
low-poly trees are two or three primitives — a trunk and a canopy, sometimes
two canopy colours — each needing its own material and therefore its own
`InstancedMesh`. The first version drew a fresh random rotation and scale per
primitive instead of per point, and every multi-part model came apart:
trunks facing one way, canopies another. Fixed by computing one transform per
scattered point up front and reusing it across every primitive of that
species.

**The default bounding sphere is wrong for a scattered mesh, not just
imprecise.** `InstancedMesh` inherits `Mesh`'s bounding sphere, sized for the
one blade of grass at the geometry's own local origin — not the few hundred
instances spread across the farm. Left alone, that does not make culling
approximate, it makes it incorrect: the renderer culls the whole mesh against
a sphere that never moves with the instances it actually contains, so it
either never culls (the tiny sphere still overlaps the frustum near the
origin) or the whole species vanishes the moment the camera looks anywhere
else. `InstancedMesh.computeBoundingSphere()` — confirmed present in this
build's vendored r169 before relying on it — recomputes the sphere from every
instance's matrix and fixes both failure modes at once. This is the "culling
pass" the step asked for.

**The "LOD" a kit with one detail level per model can actually offer is
fewer instances, not simpler ones.** There is no low-poly-of-the-low-poly to
swap to. `rendererIsSoftware()` — the same check step 4's post-processing
budget reads before building anything, because measuring cost is not free —
gates a flat density multiplier: full counts on a real GPU, 40% of them on a
software rasteriser. It is a function declaration, hoisted, so it can be
called here even though it is written later in the file alongside the budget
it was built for; no logic was duplicated to reach it.

## 16. A walk-timing bug found landing step 8, not caused by it

Step 8's push failed CI on two long-standing tests — "planting a seed costs
coins and fills the plot" and "a ripe crop can be harvested and yields
produce" — both walk-dependent, both timing out waiting on her to arrive.
Checked against a clean pre-step-8 tree before assuming cause: the same pair
failed identically there too, 10 of 12 runs at `--workers=4` on this box's
four cores. Not a regression step 8 introduced; a pre-existing bug it
happened to surface, severely enough to be worth fixing rather than filing
under the contention flakiness this project has otherwise learned to accept.

**The cause was `frame()`'s per-tick walk cap**, `Math.min(dt, 0.1)`, written
to stop a backgrounded tab — where `requestAnimationFrame` genuinely
stops — from making her teleport across the yard on the one large-gapped
frame that fires when it resumes. That reasoning is sound for a tab that was
actually hidden. It is wrong for a tab that is simply slow: under real
four-worker CPU contention, `requestAnimationFrame` starves to a handful of
ticks a second even while the tab stays fully visible throughout, and each of
those rare ticks was still only allowed to credit 100ms of walk. A walk that
should complete in under a second was measured taking upwards of five —
past what the two tests' `expect.poll` were waiting on.

**Fixed by discounting the one gap that actually needs it, at the moment it
closes, instead of capping every tick regardless of cause.** A
`visibilitychange` listener resets the step clock exactly when the page
stops being hidden, so the next `frame()` call — which happens right away,
since that is what resuming visibility means — computes `dt = 0` for that
one tick via the same bootstrap path the very first frame already uses. No
teleport, because nothing between the hide and the resume is credited. Every
other tick, however far apart in wall-clock time, now credits real elapsed
time in full: a slow-but-visible tab catches her up to where she should be
instead of making her walk in slow motion.

Confirmed by the same means the bug was found: the targeted pair went from
2 of 12 to 12 of 12 at `--workers=4`, and a full-suite run at the same
contention went from double digits of failures (13 of 237 was step 4's own
measured baseline) to 2 of 251 — an improvement beyond just the two tests
that made this worth chasing down, since every other walk-dependent test was
paying the same tax to a smaller degree.

**The fix above then broke a different test for a related reason**, worth
recording separately because the mechanism is not the same bug wearing a
different hat — it is what fixing the first bug exposed. Mobile's "the whole
loop is playable by tapping" drives the on-screen stick with real pointer
events, waits for a plot to come into reach, then releases. Releasing is
itself a round trip — `page.mouse.up()` back into the page — and a
`requestAnimationFrame` tick can land in the gap between "reach detected" and
"stick actually let go." With the per-tick cap gone, that one tick now
credits however much real time has passed, which under contention was enough
to carry her past the plot before the release took effect: 9 of 10 runs at
`--workers=4`, tapping a "Pick a seed first" prompt over an overshot empty
tile instead of harvesting the ripe one it meant to land on.

Not a reason to bring the cap back — the cap was wrong for every walk in the
game, and this is one test's interaction with a real device correcting for
it. **Fixed in the test**: after releasing, check whether the target is still
in reach, and if not, nudge back a small fixed amount in the opposite
direction, repeated as needed. A shrink-and-flip correction was tried first
and could send her back past the plot the other way — overshoot only ever
happens moving in the direction just pushed, so the fix has to converge in
one direction, not oscillate. 15 of 15 after.

---

## 17. Water — step 9

The ask was "a pond or an irrigation channel gets an animated Fresnel-plus-
scrolling-normal-map shader", and the delivered thing is a pond with a
hand-written `ShaderMaterial`. Four decisions in it went the other way from
the obvious one, and all four were forced by something measured rather than
preferred.

**No `Water.js` / `Water2.js`.** three's own water objects get their
reflection from a second render of the scene through a mirrored camera, every
frame. This project dropped shadows twice, gated the whole post-processing
chain behind `rendererIsSoftware()` and thinned the foliage on the same
signal, all to keep the software rasteriser in CI inside its budget. A second
scene render is the one thing that budget cannot buy. The sky it would be
reflecting is already in `scene.background`, for nothing.

**No normal map.** Same reasoning that kept a photographic tileable off the
terrain in §10: it would fight the flat-shaded kit models standing around it,
and it is another file to vendor, cache and version. The ripples are three
crossing sine wavelets differentiated on paper — the surface normal is the
exact analytic gradient of the height field, not a sampled approximation —
which costs a dozen lines of arithmetic per pixel and no bytes at all.

**Banked, not dug.** The first version was a bowl sunk half a metre into the
ground, which is what a pond is. It rendered as a faint scratch on the grass:
the terrain is one unbroken sheet at `y = -0.08` across the whole farm, so
everything below that line was simply behind it, and only the couple of
centimetres of rim above the sheet ever showed. Cutting a hole to see through
is the other way and is not affordable — at 1.25 units between terrain
vertices this pond is two cells across, so the hole would be a ragged square
nothing like its outline, and making it fit means an order of magnitude more
terrain vertices on the machine class that is already the binding constraint.
Building the bank upward costs nothing, needs no terrain change, and reads
better from a camera twenty degrees above the ground, where a depression
mostly shows you the grass on its far side. Farms do build stock ponds this
way, out of their own spoil, so nothing has to be explained away.

**Moved into the dooryard.** It was first dug in the quiet north-west corner
between the farmhouse and the orchard — where a farm would put it, and it
cleared every neighbour on paper. The screenshot killed it: from this camera
the farmhouse sits at almost exactly the same bearing and half the distance,
and covered the water completely. Near the camera is also where water most
wants to be, because Fresnel is an angle and not a distance: across two metres
of nearby water the view angle swings far enough to run from sky-mirror at the
far lip to see-through at the near one, which is the entire effect. The same
pond twelve metres off is one flat tone whatever the shader does. Four props
that stood where the water now is were moved onto the bank rather than
deleted, and reeds and a log were added, because a rim of bare mud reads as a
hole.

### Three shader values that are what a render made them

- **The ripple light is not the sun.** Lighting the wave faces by the real sun
  looked right at midday and fell apart at dusk: a sun near the horizon grazes
  them, so the shading term swung nearly its whole range between one ripple
  and the next and the pond came out in hard diagonal bars. The ripple relief
  now uses a fixed direction; the sun still drives the glint and the reflected
  sky colour, which is what actually reads as time of day.
- **The reflection is pulled 30% back toward the water's own colour.** At
  midday sky and pond are close enough that this makes no odds. At dusk a
  saturated orange sky against a teal pond turned every wave crest into a bar
  and the surface looked brushed rather than wet. Real water does glitter like
  that; at this ripple scale and this screen size it just reads as stripes.
- **The specular lobe is exponent 24, not the several hundred water deserves.**
  At that sharpness this pond never glints at all: the ripples tilt about nine
  degrees, and a highlight that narrow needs a face turned two and a half times
  further to catch the sun. Widening the lobe until the slopes the surface
  actually has can reach it is what puts the sheen back.

And one that a render made necessary rather than merely better: **the body
colour is scaled by night**. Every other material in the scene is lit, so it
darkens on its own as the hemisphere light and the sun fade. A hand-written
shader keeps whatever colour it is given, and the first night render had the
pond glowing like a lit pool in an otherwise black farm.

### Where she may and may not walk

The water is blocked in `steer()` — the player-driven path — and deliberately
not in `stepToward()`, which the job queue walks in a straight line to a plot
or a pen. A queue that can be handed a target it can never reach is a farmer
stuck forever, and there is nothing to reach across the pond anyway: every
plot, gate and animal is east of the path spine. The block projects her step
out onto the bank along the ray from the pond's middle rather than refusing it,
so the component of her movement running *along* the bank survives and she
slides round the water instead of sticking to an invisible wall.

---

## 18. Animals that roam — step 10

The boxes and the icosahedron are gone. Every animal in the pen is now the
same Cube Pets glTF the character-scale table in `assets.js` already carried
a target height for — cow, chicken, dog and cat by name; sheep stands in for
`cube-pets/animal-polar`, the kit ships no sheep, and this was already
recorded as a gap before this step gave it a body. Each one is its own
`AnimationMixer` playing `idle`, `walk` or `eat`, not an `InstancedMesh`: an
instanced draw shares one clip clock across every copy, which was fine for a
sine-wave bob that could never fall out of step with itself and is wrong the
moment idle/walk/eat blending means neighbours are meant to be on different
clips at different points in them.

**Lanes, not open ground.** Five different kinds share one enclosure, and the
"simple" in "simple steering" is that there is no collision avoidance between
them — instead each kind keeps to its own band of the pen's depth (the same
`PEN_ROW_Z` the old grid used) and is free to roam the pen's full width
within it. A cow and a chicken can still end up close together at the edge of
adjoining lanes, but they can never be asked to walk through one another,
because the geometry never lets their bands overlap.

**A three-clip loop, not a wander.** Livestock cycle walk → look → eat → walk:
arrive at a random point in the lane, pause and look up, graze a while, pick
a new point. Guardians patrol: walk to one end of the lane, pause and turn,
walk back — the same shape their pre-model sine trot already had, just with a
real walk cycle under it instead of a clamped `Math.sin`. Neither reads a
seed. Nothing about the wander is asserted by a test the way the foliage
scatter's counts are (see §15), so a fixed seed would buy determinism nobody
was going to check for and Math.random is simply less code.

**State drives the pose, not just the tint.** A hungry animal — livestock or
guardian — is left exactly where it stands rather than wandering off toward
grass it cannot reach yet: nothing to graze until it is fed. This is also
now the only place in the 3D scene a player can see, without opening the
Animals tab, which of the herd needs feeding — the ones standing still.
Guardians additionally drop onto their haunches (a Y-scale of 0.55, the same
trick the old squashed box used) since the kit has no dedicated resting pose;
the scale is the one thing here still faked rather than authored.

**One material clone, not per-mesh.** Every Cube Pets model turned out to
share a single textured "colormap" material across all of its meshes — legs,
body and head alike — rather than one per part. Cloning it once per animal
instance and reusing the clone (deduped by identity, not assumed to be
one-mesh-one-material) is what lets the "she's on her way" tint recolour a
single cow without recolouring the clone(true) shares that material with —
the rest of its own herd — and it is cheaper than the naive per-mesh clone
dressFarm's static props get away with, since none of them are ever
recoloured again after they're placed.

**Softer renderers see fewer of them, not smaller ones.** `PEN_CAP` — how
many of each kind are ever drawn — now reads `rendererIsSoftware()` the same
way `FOLIAGE_SCALE` and the post-processing tier do, and for the same reason:
thirty individually animated, multi-mesh models is a real cost this project
has already had to defend its CI budget against once per system that adds
weight to the scene. There is no simpler LOD for a single-detail kit to fall
back to, same as §15's foliage — only fewer instances, not cheaper ones.

**A real bug, not a step-10 one, caught by writing this step's own tests.**
`animalIntent` in script.js — the function the 3D prompt has read since step
6 — checked `animal.state === 'ready'`. Nothing has ever assigned that value;
`animal.state` is only ever `'producing'` or `'hungry'`, and "ready" was
always the derived `animalProgress(...) >= 1` check the Animals tab computed
separately and correctly. The 3D prompt could not offer "Collect" to a ready
animal from the day step 6 shipped it — only "Feed", once the animal later
went hungry, and nothing at all while it sat there full. Confirmed with
`git log -S` against the line before it was touched, so the step responsible
is recorded accurately rather than folded into this one's own commit.
Fixed here because this is the step that finally puts a live, moving target
at the end of that path for a test to walk up to.

**What the test-writing itself found, twice.** The first version of the
walking-up-to-a-live-animal test drove her in a fixed direction and polled
from Node between drive commands. Both were wrong, independently: a straight
line missed the pen entirely, because its lane sits north of where she
spawns, not due east of it; and re-aiming every tick at full stick deflection
overshot a slow-moving target so badly under WALK_SPEED's 4.2 units/second
that the loop mostly saw her fly through REACH and out the other side.
Slowing the stick down inside a settle radius fixed the chase — and then
revealed a second problem: the round trip between "she's in reach" and "so
what does the prompt say" was long enough, and frequent enough across many
short Node-side ticks, to occasionally let the still-roaming cow wander back
out in the gap, and to starve this page's own rAF loop under the two workers
this suite runs at, which is the same class of contention the walk-timing
bug in §16 exists to defend against — a chatty enough test was found to
budge tests it had nothing to do with while it ran alongside them. The fix
was to run the whole chase as a single `page.evaluate` driven by the page's
own `requestAnimationFrame`, so nothing crosses back to Node until the
outcome is already settled — no round-trip gap, and no contention from the
test itself.

---

## 19. Crops as real models, and the market stall — step 11

The cone and the icosahedron are gone from every plot that isn't rotten.
`nature/crops_leafsStageA` and `crops_leafsStageB` cover the sprout and
seedling stages every crop shares — the same beat the 2D grid's 🌱/🌿 swap
keeps, modelled instead of iconified. From there each crop diverges into
what the Nature Kit actually ships for it, and what it ships is uneven on
purpose, not by oversight: wheat and corn each get two stage-2 models,
`...StageA`/`crops_cornStageB` for "grown but not yet ripe" and
`...StageB`/`crops_cornStageD` for ripe — a distinction the 2D grid does not
draw at all, both reading the same emoji until the progress bar underneath
says otherwise (`plotGrowthStage`, script.js). Carrot and pumpkin get one
model apiece for the whole of stage 2, because that is what the kit ships
for them; inventing a halfway carrot to match wheat's pair would be dressing
up a guess as an asset, the same call §18 made about a resting pose for the
guardians. All eight models were vendored back in step 2, anticipating this
step by name — `tools/vendor.mjs`'s own comment already read "the three
growth stages the rules already model."

**Real models needed to be told apart per plot, so the tint moved from the
tile to the crop.** The old system was two InstancedMeshes total, generic
enough that a single material colour could stand for a crop's identity
outright. Eight models, several with two materials each, is closer in shape
to the foliage species of §15 than to the old crop system — one
InstancedMesh per primitive per model, capacity PLOT_COUNT, shown or hidden
per plot per frame. Wilting used to fully replace the head's colour, because
the head had no real colour of its own to protect. A real wheat or pumpkin
model does, so wilting is now a partial lerp toward a sour tint rather than
a swap — the shape and its own texture keep reading through it.

**Rotten still has no model, on purpose.** The kit ships nothing that is a
wilted, unharvested crop of any kind, and there is no version of "which
crop" for it to distinguish — what has gone off no longer needs to say what
it used to be. The old cone and icosahedron were kept, squashed, in their
same rotten colours, covering every crop alike; a real WILT_TINT lerp exists
for the one case that still has a real look to sour, not for this one.

**The market stall is set dressing, not a destination.** `fantasy-town/stall`
turned out to be a small sub-piece — 0.365 units tall, table-height, clearly
one part of a modular assembly the way the windmill was a sail assembly on
its own. `stall-green` checked out where it didn't: one mesh, one material,
a 1 × 1.24 × 1 footprint, a real assembled stall. It stands in the dooryard
because that is where a farm's other commerce-adjacent clutter — the chest,
the crates — already was, not because anything walks her to it: the Market
tab is a flat screen with no seat in the 3D world at all, the same as
Achievements and Dream (see `field-screen` in index.html, present on Farm
and Animals, absent on the other three).

**A stray file, found while adding a real one.** `fantasy-town/windmill.glb`
was still sitting in the repo, tracked in git since step 2, orphaned since
step 7 dropped it from `KENNEY_MODELS` and never removed the file itself —
70 KB of dead weight the service worker was never even precaching, since
the manifest is generated from the same list that no longer named it.
Deleted alongside the stall-green addition, not left for a future pass to
notice a second time.

---

## 20. The keyboard plays the same game — step 12

This is the step the plan marked never-cut, and the one where the plan's own
wording had to be checked before it was followed. It called for "world-space
prompts and a genuine keyboard path through free movement, rather than a grid
of invisible buttons that no longer matches how the game is played." Two
thirds of that was right. The last third was not, and following it literally
would have shipped a regression under this step's name.

**What was actually wrong, measured.** A probe written before any code:

- Focusing plot 1 painted its flat 2D face into **the sky above the farmhouse
  roof** — the CSS grid sits at a fixed box that lined up with the field
  until step 6 pointed the camera at the horizon, and has lined up with
  nothing since. There is a screenshot of it. The rule that did this was
  added for a good reason (a sighted keyboard user should see which tile they
  are on) and had simply outlived the layout it was written for.
- The Farm tab had **twenty-one focusable controls, sixteen of them tiles**,
  all sitting between the seed bar and everything past it.
- A held arrow key **walked her 2.87 units while a plot button had focus**.
  The drive keys were bound at the window with only text fields excluded, so
  the same press both moved between tiles and moved her.

**What was not wrong: the grid itself.** The obvious reading of the plan is
to delete sixteen invisible buttons and tell a keyboard player to drive.
For a player who cannot see the canvas that is strictly worse — steering a
character around a field they cannot see, hunting for tiles by proximity, in
place of sixteen labelled plots in a stable order they can move through
directly. The grid is not scaffolding for that player; it is the interface.
So it stayed, and what got fixed is the three things above.

- **One tab stop, not sixteen.** A roving tabindex: one tile holds the stop,
  the arrows move between the sixteen, Home and End jump to the ends. Locked
  tiles cannot hold the stop, since a disabled element takes no focus and the
  grid would vanish from the tab order behind it.
- **The arrows belong to whoever is using them.** They navigate the grid
  while it has focus and drive her when it does not — which makes them mean
  one consistent thing either way, "move what I am paying attention to". A
  seed button or the prompt still keeps them driving, on purpose: clicking a
  seed and walking off to plant it is one gesture.
- **The highlight moved into the scene**, where the tile actually is.

**The marker took three attempts, and the failures are the useful part.**
Tinting the tile's soil is invisible: at this distance tinted soil against
soil disappears into the lighting. A bright patch laid flat over the tile is
invisible for a better reason — the camera sits about twenty degrees above
the ground, so a one-unit square lying on it foreshortens to a bar about
eighty pixels wide and eight tall. Rendered in hot magenta at full opacity,
purely to establish whether it was being drawn at all, it was still a sliver.
The same geometry that cost step 4 its horizon costs any flat marker its
legibility. What works is a marker that stands up: a caret on a stem, hung
over the tile, tall enough to clear a ripe corn stalk. The stem is not
decoration — the caret alone, at a height that clears the corn, floats up by
the treeline and stops obviously belonging to any one tile.

It is `MeshBasicMaterial`, so it takes no light. A focus indicator that dims
at dusk with the rest of the scene is one that stops doing its job for half
of every day.

**And the part free movement was missing: it said nothing.** The prompt
button has always carried a proper label, but a button's text changing is
silent to a screen reader unless that button happens to be focused, and it
never is while she is being driven. So walking her about — the actual game
since step 6 — told a player who could not see the canvas absolutely nothing.
A polite live region now says what has come into reach. Arrivals only:
"nothing in reach" every time she steps off a tile is chatter, and the
silence says it just as well.

---

## 21. Weather, seasons, and a UI that matches — step 13

The plan's own wording for this step was "weather, seasons, and a UI that
matches" — the last three words asking, by the same phrasing §20 opened
with, for "world-space prompts." §20 already answered that question once,
for a different feature: the DOM grid and its prompt button are the
interface, not scaffolding standing in for one. Nothing in this step
reopens that finding, so nothing here draws text in the 3D world either.
"A UI that matches" turned out to mean the day label already on screen
learning to say what season it is and whether a storm is coming — a glyph
change, not a new layer.

**The calendar was already there.** Four seasons cycling every four weeks is
just `WEEK_LENGTH_DAYS` read a second way — `SEASON_LENGTH_DAYS` is the same
seven, `SEASON_ORDER` cycles spring/summer/autumn/winter through it, and
`seasonIndex()` is the same `Math.floor((state.day - 1) / N) % length` shape
`weeksElapsed`-style helpers already use elsewhere in script.js. No new
clock, no new field on `state` — a season is a pure function of the day
already being counted for the subsidy.

**The storm was already there too.** Rather than invent a second weather RNG
for rain to key off, `stormProximity()` reads the same forecast
`updateHurricane()` already warns the player with: 0 outside
`HURRICANE_WARNING_DAYS`, ramping to 1 on the day itself. The sky's cloud
cover, the light level's dip, and the rain's own density all read this one
number, so a player who sees the sky start to grey and rain start to fall is
seeing the same three-day window the toast already told them about, not a
second forecast that might disagree with the first.

**The orchard's fall colour is real, and scoped to what the kit actually
has.** §5 records what checking the mirror found: `tree_default` and
`tree_detailed` each ship a `_fall` variant, the two pine species ship
neither. The six hand-placed orchard trees — all `tree_default` or
`tree_detailed`, confirmed by grep against `PROPS` before relying on it —
each get their fall companion loaded alongside the summer one and swap
together in autumn, which reads as one season arriving rather than six
trees on independent clocks. The instanced hillside fringe from step 8,
pines included, keeps its summer green in every season; there is nothing to
swap it to, and a fringe that greyed toward a texture it does not have would
have looked worse than a fringe that simply held its colour.

**The ground repaints; the geometry does not rebuild.** `terrainVertexColor`
already mixed grass, dirt and slope into one colour per vertex — steps 3 and
9's own function, extended with a fifth `season` argument rather than
replaced, so summer's look is exactly what it always was, reached by falling
through every seasonal branch untaken. Spring and autumn lerp a tint over
the existing mix, weighted by the same "how bare is this ground"
(`rockAmount`) the slope blend already computed; winter goes one step further
and reuses slope a second time, so snow gathers less on a scree slope than
on flat ground, which is the same physical fact steep ground already got
credit for. `applySeasonToTerrain` and `applySeasonToPondBank` repaint the
`color` attribute in place on a season change — the same "rebuild on
change, not per frame" idiom the plot tiles already use for
`buildPlotCell` — rather than reconstructing geometry that never actually
moves.

**Grass disappears in winter; trees do not.** The Nature Kit's grass tufts
have no winter texture to switch to, and a summer-green tuft standing in
snow-tinted ground would have read as a bug rather than a season. Hidden
instead, by toggling the `InstancedMesh`es `scatterInstanced` now hands back
to its caller rather than swallowing internally — a caller-visible return
value it never needed before this step. Trees, orchard and hillside alike,
keep their leaves: bare branches are what winter usually asks a tree to do,
but this kit's canopies are not built to hide, and a wall of leafless trunks
across the whole tree line was a worse trade than the small dishonesty of a
green tree in the snow. Recorded here rather than silently decided.

**The storm darkens the sky twice, on purpose, by two different paths.**
The 3D yard's `hemi` and `sun` lights are scaled by a `cloudFactor` — mostly
`stormProximity` itself, with a little `valueNoise` sampled by clock time
laid on top so the cloud cover drifts across the three warning days instead
of arriving as one flat dimmer switch. The 2D strip above the UI darkens
independently, by blending `skyColorAt`'s three gradient stops toward a flat
grey. The two were kept apart rather than driven off one shared number: the
2D sky already had a `--night` custom property doing double duty as the
star field's opacity switch (see `styles.css`), and blending storm gloom
into it would have put stars in a daytime sky the moment a hurricane got
close — caught while writing the darkening, not after a screenshot showed
it, by reading what else `--night` already drove before reusing it.

**What a test can hold onto, same question the pond and the crops already
asked of themselves:** not whether the ramp looks right — that is what the
screenshots in "Verified, not assumed" below are for — but that nothing
here is frozen. `rainDropY` gives a test the same "moving, not painted"
check `waterPhase` already gives the pond.

**A regression the full suite caught, not a screenshot.** Widening
`#dayLabel` with a season glyph pushed the topbar's `.stats` row over its
available width at a 360px viewport, and flexbox's default shrink behaviour
spread the deficit evenly across every child in that row — including the
help and mute buttons, which lost 5 of their 48px down to 43. Caught by the
mobile suite's own existing "touch targets hold up at 360px" test, confirmed
as this step's regression rather than a pre-existing one by reproducing it
against a clean pre-step-13 tree and watching it pass there. The fix keeps
the accessibility floor non-negotiable rather than shrinking the label back
down: `.mute-btn` now carries `flex-shrink: 0`, so a narrow row gives ground
from the coin and day badges — text that can afford to lose a few pixels —
before it ever touches a tap target.

---

## 22. Performance, at ten times the scene — step 14

This step's plan asked for LOD, draw-call budgeting, texture compression and
a real-phone GPU pass. What it got first was a measurement, because three of
those four are answers and nobody had yet established the question.

**How it was measured.** The counts below come from patching
`drawElements`/`drawArrays` and their instanced forms on the GL context
prototypes before the page loads, so the game is measured exactly as it
ships with nothing added to it. A second, independent instrument —
`renderer.info`, now exposed as `Farm3DScene.drawCost()` — agrees with it to
the call and to the triangle, which is the only reason either is trusted
here.

**What this box cannot tell you, stated plainly.** There is no GPU in this
sandbox. Every run is swiftshader, which means `rendererIsSoftware()` is
true, the scene starts at its PLAIN tier, and foliage, pen and rain all come
up at their reduced counts. So every *frame time* measured here — 183ms at
1280×800, 217ms and 250ms under 4× and 6× CPU throttling on a phone
viewport — describes this box's software rasteriser and says nothing
whatever about a phone. **The plan's "holds 30fps on your own phone" was not
verified and cannot be from here.** What is portable is what the scene asks
the driver to do, which is the same on every machine; that is what the
numbers below are, and what the tests hold to.

To get the counts for the settings real hardware gets, the
`UNMASKED_RENDERER_WEBGL` string is spoofed so `rendererIsSoftware()`
answers no — the same hint the scene itself reads — giving PEN_CAP 6,
FOLIAGE_SCALE 1 and RAIN_COUNT 500. Swiftshader still rasterises, so only
the counts from that configuration mean anything, not its timings.

**What was found.** One drawn frame, hardware-path settings:

| state | before | after |
|---|---|---|
| opening farm, nothing planted | 114 calls / 96,796 tris | 95 / 66,012 |
| worst case, summer | 234 / 108,684 | 216 / 79,116 |
| worst case, winter + rain at full | 233 / 69,964 | 215 / 40,396 |

Two of those rows are the finding. **Planting all sixteen plots cost exactly
zero extra draw calls and exactly zero extra triangles** — 114 and 67,442 on
an empty farm, 114 and 67,442 on a full one, identical. A cost that does not
move when the thing it is drawing changes is a cost being paid for nothing.
The cause is that crop stages hide by scaling an instance to nothing, which
leaves it in the draw: all eight stage models were submitting all sixteen
instances every frame regardless. Read straight out of the vendored `.glb`
files, the eight models are 1,924 triangles and 19 primitives per set, so
that is 30,784 triangles and 19 draw calls on a farm with nothing in it.
Capping each mesh's `count` to how far the frame actually reached — three.js
skips a zero-count instanced draw outright — gave back exactly 30,784
triangles and 19 calls, prediction and measurement agreeing to the triangle.
The instance index deliberately stays the plot index rather than being
packed down, which is what keeps `cropSpin`, the wilt tint and
`activeCropStage` all addressing the plot they mean; the saving is therefore
largest on an empty or early farm and smallest with a crop on the last plot.

The third row is step 13 paying a dividend nobody designed: winter draws
40,396 triangles against summer's 79,116, because hiding the grass under
snow hides half the farm's geometry.

**LOD: already answered, in step 8.** The Nature Kit ships one detail level
per model. The only LOD available to a single-detail kit is fewer instances,
not simpler ones, which is exactly what FOLIAGE_SCALE, PEN_CAP and now
RAIN_COUNT already do off the same `rendererIsSoftware()` signal. There is
nothing to add here that is not already there under a different name.

**Texture compression: measured, and refused.** Every texture the game ships
is a shared kit colormap: six PNGs totalling **76 KB** across the whole
game, inside a 1.8 MB asset set whose weight is geometry, not pixels. A
KTX2/Basis transcoder is several hundred kilobytes of WASM and JavaScript —
*larger than the entire payload it would compress* — and would need the
build step this project deliberately does not have (decision 01). Compressing
76 KB by adding 200 KB is not an optimisation. Recorded as declined with the
number, not skipped quietly.

**What the scene actually costs, and whether that is a problem.** 216 draw
calls and 79,116 triangles in the worst state the game can reach. For any
real GPU, including a mid-range phone, neither figure is near where trouble
starts. The honest conclusion is that this scene was not draw-call bound or
triangle bound before this step and is not after it; what it had was one
unconditional cost, now conditional. The frame budget from step 4 remains
the thing that copes with a machine that genuinely cannot keep up, and it
still has the last word.

**So the lasting deliverable is the instrument and its ceiling.** Today's
numbers being fine is not a property that stays true by itself — step 16
adding thirty props, or a later hand at the foliage un-instancing something,
is exactly the regression nobody notices. `Farm3DScene.drawCost()` makes the
cost askable, and three tests hold it: a ceiling on the worst case (260
calls, 100,000 triangles — above both paths with room, tight enough that
putting the crop instances back would breach it), the conditional-cost
property that was broken here, and that a farm behind another tab draws
nothing at all. That last one is not a micro-optimisation: it is the
difference between a phone spending its battery on a 3D scene nobody is
looking at and not. `renderer.info.autoReset` had to be turned off and reset
by hand in `frame()` for any of it to be true at the composer tiers, where
the renderer's own per-`render()` reset would otherwise have reported a
frame's cost as the three calls of its last fullscreen pass.

**The four-worker stress, and what it actually showed.** The plan's "done
when" for this step names it, so it was run — and then run again against a
clean pre-step-14 tree, because a stress run's failures mean nothing until
you know what the same stress does to the same box without your change:

| full suite, `--workers=4`, no retries | failed | passed |
|---|---|---|
| clean tree, step 13 as shipped | 12 | 256 |
| with step 14 | 6 | 265 |

Every failure in the step 14 run was a timeout or a timing assertion, and
the two most incriminating — `crops, modelled`, which exercises the exact
instance counts this step changed, and the farmer's walk cycle — **fail on
the clean tree too**. So they are the four-worker contention this project
has been documenting since step 8, not a regression. Four workers on this
box with no GPU is past what the environment sustains; CI itself runs the
default worker count with one retry, which is the number that has to be
green, and is.

The step 14 run failing half as often as the clean one is consistent with
30,000 fewer triangles a frame leaving more CPU for everything else, since
on the software rasteriser every one of those triangles is main-thread work.
That is stated as consistent-with rather than proven: variance this deep
into contention is large, and one pair of runs is not a measurement of an
improvement in flakiness. What the pair does establish is the direction of
blame, which is what it was run for.

---

## 23. Tests and the playtest bot, re-armed — step 15

Three things were asked for here. Two of them had already happened, and
saying so is more useful than doing them twice. The third was true, and
considerably worse than the plan knew.

**"Rebuild the Playwright suite around free movement."** Already done, not
as a rebuild but as a habit: every step since 6 brought its own tests for
its own mechanic as it landed — the stick, the keys and the prompt in step
6, roaming animals in 10, modelled crops in 11, the keyboard's own path
through the game in 12, seasons and rain in 13, what the scene costs to
draw in 14. There is no separate pile of old-mechanic tests waiting to be
replaced, because none was ever allowed to accumulate. Rebuilding working
tests to satisfy the wording would have been churn, and §20 already
established what this project does when a plan's instruction and the code
disagree.

**"Redesign the accessibility test story around the reachability
prompts."** Step 12 did this, and §20 records it: the roving tabindex, the
arrows belonging to whoever has focus, the marker drawn on the real tile,
and the live region that finally gave free movement a voice. The six older
accessibility tests still describe the game as it is played now — plots
are still labelled buttons, a crop can still be planted from the keyboard
alone — so they stayed.

**"Update `tools/playtest.js` to drive a walking character instead of
tapping a grid."** True. And what looking found was not a bot testing the
wrong mechanic — it was a bot testing *nothing at all*, and saying so in
the affirmative.

`.plots-grid` has been `pointer-events: none` since step 6; that is the
whole reason the camera could turn to the horizon (§13). The bot drove the
farm with real mouse clicks on those tiles, every one wrapped in
`.catch(() => {})`. So every click went through to the scene behind the
grid, did nothing, threw nothing, and was swallowed. Run for eight steps,
the bot's verdict was:

```
relaxed #1  day 1  coins 60  earned 0  harvested 0  plots 8
farmer  #1  day 1  coins  0  earned 0  harvested 0  plots 8
hard    #1  day 1  coins 10  earned 0  harvested 0  plots 8

NO PROBLEMS FOUND
```

Not one seed planted, not one crop harvested, not one coin earned, not one
plot unlocked, on any tier — and a clean bill of health, because **a farm
that nothing happens to cannot break an invariant.** The animals column
was the tell that something still worked: those are ordinary DOM buttons,
which is why they alone kept being pressed.

The fix is the one the suite had already found for itself: activate a tile
the way a keyboard does, through the element's own handler, rather than
with a mouse press that now lands on the scene. Same call and same reason
as `tapPlot`. On top of that the bot now also plays the mechanic step 6
actually shipped — driving her by hand and taking whatever the prompt
offers when she arrives somewhere — because no sweep of tiles reaches
that, and a fuzzer's whole value is being somewhere no scripted path
thought to go. After it:

```
relaxed #1  day 2  coins 38  earned 156  harvested 36  plots 10
farmer  #1  day 1  coins 13  earned 144  harvested 24  plots 8
hard    #1  day 1  coins 30  earned  72  harvested 18  plots 8
```

**The part worth keeping is the guard, not the fix.** A fuzzer that stops
reaching the game reports no problems, which is indistinguishable from
good news — that is the failure mode, and it will recur the next time the
UI moves under it. So the bot now holds an invariant about *itself*: a run
that ends without a single crop in the ground has not exercised the loop
it exists for, and says so instead of printing a row of zeroes nobody
reads. Getting a seed into the ground is the signal rather than harvesting
one, deliberately — planting is the first thing the loop does and happens
at any run length, while a harvest also needs the crop to grow and the
farmer to walk back to it, which a twenty-second run can honestly miss. A
watchdog that cries wolf on short runs is one nobody reads either. Checked
both ways: it fires on the broken bot, and is silent on the fixed one.

What this step deliberately did **not** do is put the bot in CI. It is a
nondeterministic fuzzer that plays for minutes; CI already sits at about
fourteen minutes against a twenty-minute budget (see `ci.yml`, and the
step 7 run that was cancelled mid-stride at 10.3). Adding a fuzzer to that
buys flaky failures rather than coverage. The liveness check is the guard
appropriate to a tool a person runs on purpose.

One thing fixed in passing: the launcher's `executablePath` was hardcoded
to this sandbox's Chromium, so the tool ran here and nowhere a contributor
would run it. It now reads `CHROMIUM_PATH` and otherwise takes Playwright's
own browser, the same escape hatch `playwright.config.js` already uses.

### The flake that took CI down, and what was actually wrong with it

Step 15's own push went red, on a test it had not touched: *a keyboard-only
player can plant and harvest without touching the plot grid*, step 12's
acceptance test. It lost its attempt and its retry, which is how a
one-in-three flake eventually spends a CI run. It had been failing on a
clean tree since at least step 13 — noticed then, attributed to contention,
and left. Leaving it was the mistake; a step called "tests, re-armed" is
where that debt comes due.

Three distinct faults, each found by measurement rather than by reading:

1. **Reading a position that was still moving.** It held ArrowUp, waited
   *in the page* for a tile to come into reach, then released the key and
   asked *from Node* what that tile was. She kept walking for the width of
   that round trip, frequently past the tile the wait had just seen, so
   `reachable()` returned null and the next line read `.intent` off
   nothing. Exactly the race §18's roaming-cow test was rewritten for.
   Fixed by stopping first and looking second.
2. **Walking at all was the wrong default.** The replacement pushed the key
   in short bursts and checked between them — better, and still wrong,
   because under contention rAF starves to a few ticks a second while
   `advanceFarmer` still credits real elapsed time (deliberately: see the
   visibility-handler note in scene.js). One starved frame can carry her
   most of the way across the farm, so a version that always walked first
   overshot the field entirely. She spawns within reach of a tile — the
   live-region test above turns on precisely that — so it now looks before
   it walks, and usually never moves.
3. **A single keypress is not guaranteed to land on anything.** Under the
   same starvation a press can arrive while she is mid-stride between one
   job and the next and find nothing to act on. `worked()` looked like the
   fix and is not — it waits for the action queue to drain, and immediately
   after a press that queue is still empty because the press has not been
   handled, so it returns at once having proved nothing. What works is what
   a person does: check, and press again if nothing happened. The check
   comes before the press, so the extra presses cost nothing when the first
   one worked.

Measured at four workers, twelve repeats, which is the load that shows it:

| | failed | passed |
|---|---|---|
| as it stood | 4 | 8 |
| after fault 1 fixed | 2 | 10 |
| all three fixed | **0** | **36** (three runs) |

At the worker count CI actually uses it is ten of ten, about five seconds
apiece. The test is also marked `test.slow()`, because it honestly is —
a plant, a growth and a harvest, each waiting on the farmer rather than a
stopwatch — and was being guillotined at the default thirty seconds
mid-harvest, which was the second of the two ways it failed rather than a
separate bug.

---

## 24. Ship — step 16

The last step, and mostly a matter of making the writing catch up with the
game. Two things were found by looking rather than by assuming they were
fine.

**The README described a game that no longer existed.** It said, in the
paragraph introducing the whole 3D half: *"Tapping a plot sends her there,
and the crop is worked when she arrives rather than when you tap."* That has
not been how this game works since step 6 — `.plots-grid` is
`pointer-events: none`, and the field is driven and acted on through the
prompt. It is the same staleness the playtest bot had in §23, in prose
instead of code, and it had sat at the top of the file for ten steps.
Three other claims went with it: "tap a ripe plot to harvest"; a promise of
"a high-contrast focus ring" on plots, which step 12 replaced with a marker
drawn in the scene; and a phone layout that "reflows from a three-column
field in portrait to six columns in landscape", which is a leftover from the
2D game — `.plots-grid` is a fixed four columns with no landscape rule at
all, checked before it was rewritten rather than after. What replaced them
describes driving, the prompt, the pond, the seasons, the rain, the modelled
crops and animals, the one-tab-stop grid and the reachability live region.

**A cross-device look, at six configurations.** Desktop, phone, landscape,
360px, plus autumn and winter on the large screen, each mid-game with a
worked farm rather than an empty one. No console errors anywhere, no
sideways scroll anywhere, and draw costs between 144 and 150 calls — well
inside §22's ceiling, and a reminder that winter is the cheapest season to
draw (29,364 triangles against summer's 47,252) because the snow takes the
grass with it.

That pass found one real blemish, and it was step 13's doing: the season
glyph had made the day badge wide enough to fold "Day 10" onto two lines
inside its own pill on a narrow phone. The first fix — letting the whole
stats row wrap — worked and was worse, because at 360px it spent an entire
extra topbar row and pushed the farm further down the page, which is the
opposite of what a small screen needs. What shipped instead is a notch off
the badge's own font and padding below 480px, so the row stays one row and
the label stays one line. Both versions were screenshotted before choosing;
the mobile suite's touch-target test was re-run afterwards, since the last
time this badge changed width it cost two controls their 44px floor (§21).

**What ships, and what does not.** CI green, Pages deploying on every push
to `main`. The live site itself could not be fetched from this sandbox —
`giorgijv.github.io` is outside what the egress policy in §1 allows, the
same wall that shaped the asset pipeline in the first place — so
"deployed" here means the deployment ran and succeeded, not that the page
was loaded and looked at. And the phone frame rate from §22 remains
unverified for the same reason it was then: there is no GPU here to measure
one on. Those are the two things a person with a phone and a browser can
confirm in a minute and this environment cannot confirm at all.

---

## 25. A post-ship bug hunt, and two real flakes it found

Asked, after step 16, to go looking for bugs the shipped game might still
have. Two rounds of scripted exploratory testing — the playtest bot across
all three tiers plus its stress phase, then fifteen hand-written scenarios
covering game-over and restart, the dream-home ending, rotten crops, raids,
a mid-game difficulty switch, a corrupted save, rapid tab switching,
achievements, a hurricane against a Large Barn, buying every upgrade and
selling every good, affordability at zero coins, feeding a dog, the
save-download round trip, and a wilting-but-not-rotten harvest.

**Seven apparent findings, all of them the test scripts' own bugs, not the
game's — proven, not asserted.** Each was chased down and reproduced clean
once fixed, the same discipline as every "verified, not assumed" entry
above: a missing `page.on('dialog', ...)` handler read `restartGame`'s
`window.confirm()` as declined; two scenarios read state right after a tap
without waiting on the walk-to-work queue, the exact race §18's roaming-cow
test and §23's keyboard test were both rewritten for; a `spoilsAt` was set
in seconds where the game stores milliseconds, aging a crop a thousandfold
in an instant; and a rapid loop of DOM clicks with no wait between them
silently dropped several — confirmed a test artifact by calling `sellAll`
directly and by re-running the same clicks one at a time with a wait, both
of which sold everything correctly.

**The full suite, re-run clean, surfaced two further flakes — real ones,
just older than this bug hunt.** A `--workers=4` run of the shipped tree
failed two tests neither the exploratory pass nor CI had ever caught.
Checked against the step-12 tree, from before this overhaul's last four
steps, before either was touched: comparable failure rates on both (2–3 in
23 repeats each), which is what pins them to code that predates this
session's work rather than to anything it shipped.

- *`harvesting and replanting never leaves the old crop's model standing`*
  read `stageAt()` — the 3D scene's own instance matrices — with a bare
  `expect()` immediately after a mutation. The save updates synchronously
  inside `runPlotIntent`; the mesh only catches up on `syncPlots`' next
  drawn frame. Fixed by polling `stageAt()` the same way the save read
  beside it already was. 25 of 25 afterward, up from roughly 1 in 8.
- *`the offer keeps up with a change of seed`* took longer to place: the
  bare-`expect()` explanation didn't fit, since `toHaveText` already polls
  for five seconds and still never saw the update. Instrumented instead of
  guessed at — a try/catch around the failing assertion that dumped
  `reachable()`, the prompt text, and the frame budget's own tier and EMA
  on failure — and every capture showed the same shape: `reach: null`,
  `quality: 0` (already stepped down to PLAIN), an EMA of 300–380ms against
  a 55ms budget. She had drifted out of reach entirely. The cause was
  `driveUntilReachable`: a `page.waitForFunction` resolving in-page,
  followed by a *separate* `drive(0, 0)` round trip to actually stop her —
  and `advanceFarmer` credits real elapsed time to a starved frame by
  design (see scene.js), so under the contention the diagnostics had just
  shown, she kept walking for the width of that round trip and overshot.
  The same race as the keyboard test in §23, reached this time through the
  stick. Fixed the same way: the wait and the stop happen inside one
  `page.evaluate`, driven by the page's own `requestAnimationFrame`, so
  nothing has to survive a trip back to Node in between. A second test in
  the same describe block, `the offer follows her, and goes away when
  nothing is in reach`, turned out to share the identical shape for the
  opposite condition (waiting for reach to become null rather than
  non-null) — found by re-running the whole block under heavy repeats
  rather than declaring the one fix finished, and folded into the same
  helper rather than patched separately. 271 of 271 at CI's own worker
  count afterward.

Both fixes were measured before and after, not just written and trusted:
the failing rate under contention, then the same command clean, then the
full suite at CI's actual settings — the bar that matters, since 4 workers
on this box's 4 cores with no GPU is past what it sustains and both step
14's and step 15's addenda already say so.

---

## 26. A road and a car at the market — a post-ship addition

Asked for, after ship: a route and cars at the market, where the farmer
sells the harvest. Scoped down on the way in, the same way §21's "a UI that
matches" was — pure set dressing beside the stall, nothing that drives or
is driven, matching what the stall itself already is (§19's own words:
"nothing in this game ever walks her to it, since that tab has no seat in
the 3D world at all"). A road with traffic on it, or a delivery mechanic
with its own timing, would be a different, much larger ask than what a
market stall standing alone in the grass was actually missing.

**Neither kit already vendored has a road or a vehicle.** Checked before
being declared, the same way every gap in this document has been: probed
against the pinned mirror rather than inferred from a kit's name.
`city-suburban` and `fantasy-town` were the two candidates that sound like
they might, and neither does. What exists, at this same commit, is a
dedicated `city-roads` kit (`road-straight`, `road-bend`, `road-crossroad`,
`road-split`, `road-end`, each exactly 1×0.02×1 — the Nature Kit's own
1-unit grid, with no conversion needed) and a `car` kit (`sedan`, `taxi`,
`van`, `truck`, `delivery`, `tractor`, `police`, `ambulance`, `firetruck`,
and more, each roughly 1,900–2,300 triangles across five or six primitives).
Both need the same `Textures/colormap.png` atlas pattern as `survival` and
`fantasy-town` already do.

**Placement:** a three-tile pull-in off the dooryard's open south-east
corner — `road-straight`, `road-straight`, `road-end` capping the far
side — with a parked `car/sedan` at the near end, beside the stall. Nothing
else stood there; the dooryard's own props (the pond, the chest, the
barrels, the stump) all sit west of the stall, and `FARM_SOUTH`/`FARM_RIGHT`
leave the flat ground east and south of it genuinely empty.

**The car's rotation was chosen by rendering it, not by guessing a plausible
number.** Six candidates — nose-on, both broadside directions, rear-on, and
two arbitrary diagonals — were screenshotted side by side from the same
follow-camera angle a player actually gets. Broadside read best in both
directions; only one of the two also pointed the car's own nose back down
the road it arrived by rather than into the crop fence behind the stall,
which is the one that shipped. The three-tile road itself was confirmed the
same way, from three separate camera positions including a drag-orbit, to
be one continuous run rather than a visible seam at the join between the
two kit pieces.

**Cost:** nine more draw calls, on the order of 2,300 more triangles — a
car's five or six primitives plus three single-primitive road tiles.
Checked against §22's instrument rather than assumed trivial: 90 calls and
37,506 triangles measured with these added, against a 260-call,
100,000-triangle ceiling that already had room to spare. `sw.js`'s
`CACHE_VERSION` bumped for the two new kits.

---

## 27. The scale pass — a bigger farm, honest sizes, and walls that stop her

Asked for, after ship, in one sentence with three demands in it: enlarge the
playing ground, make the farmer and the environment adequate relative to
each other ("now the farmer is much larger than the house"), and stop her
walking through house walls and trees.

**The complaint was right, and the measurement is worse than it sounds.**
The farmer is scaled to 1.45 units. The farmhouse was placed at `h: 2.3` and
the barn at `h: 2.5` — 1.6 and 1.7 times her. She was not literally larger
than the house, but she stood two-thirds the height of her own front door,
which is what the eye reports as "larger". Measured, not eyeballed: every
figure in this section came from loading the model through `assets.js` in a
real page and reading its `Box3`.

**The cause was recorded in this document before the symptom was.** §14 and
the `PROPS` comment both explain that buildings had to be sized by *width*,
because "a 1.3 × 0.83 model asked to stand 3 units tall comes out 4.7 wide,
and put the barn through the pen". That constraint was real. What it was
actually measuring, though, was that the farm was too small — 15.2 by 16.2
units — not that the buildings were too big. So the ground had to grow
before the scale could be fixed, which is why one request had three parts.

### What changed size

| | was | now | against a 1.45 farmer |
|---|---|---|---|
| flat farm | 15.2 × 16.2 | 25.3 × 25.5 | 2.6× the area |
| farmhouse | 2.30 tall | 4.80 (7.5 × 6.0 footprint) | 3.3× |
| barn | 2.50 | 5.60 (9.0 × 5.6) | 3.9× |
| orchard trees | 2.6–3.1 | 4.2–5.0 | 2.9–3.4× |
| orchard pines | 3.2–3.4 | 5.8–6.2 | 4.0–4.3× |
| hillside fringe | 2.1–3.6 | 3.6–6.6 | — |
| market stall | 1.24 (authored) | 2.50 | 1.7× |
| pond | 2.7 × 2.3 | 4.3 × 3.9 | — |
| survival props | 0.25–0.46 (authored) | 0.5–1.7 | — |
| pen | 2.1 × 4.4 | 3.0 × 5.8 | — |
| camera | 3.9 up, 9.2 back | 4.8 up, 14.0 back | — |

Two of those were not in the request and are here because the same ruler
condemned them. The **market stall** at its authored 1.24 was shorter than
the farmer, so she could not stand under her own awning. The **pond**, at
two and a half metres across, was a puddle beside a seven-metre house — the
last thing in the dooryard still at doll's-house scale. Enlarging it meant
moving six dooryard props that were standing where the water now is, which
is what the "nothing is standing in the pond" test exists to keep true. The
`sedan` and the Cube Pets animals were checked against the same ruler and
left alone: a 1.3-unit car roof just under a 1.45-unit farmer's head is
correct, and the chicken at 0.4 is a chicken.

The **road** was widened from one lane to two at the same time, for a reason
that only became visible once everything else was right: the tiles are a
metre square and the sedan is 1.5 across, so §26's single-lane strip was
narrower than the car standing on it. With a real road under it the car's
rotation stopped being a judgement call — it faces along the lane, which is
what §26's broadside compromise was reaching for when there was no lane to
face along.

**Things that had to move with the ground**, each because it was derived
from a number that changed: the terrain mesh (`TERRAIN_HALF` 30 → 46, and
`TERRAIN_SEGMENTS` 48 → 72 so the vertex spacing stayed near 1.25 rather
than stretching the same grid over half again the distance), the fog (16/34
→ 30/64, which had begun *inside* the farm), the camera's far plane (100 →
200) and the sky dome (80 → 130, which the terrain had grown past), the
orbit controls' `maxDistance` (14 → 26), the foliage counts (scaled by area,
or the grass would have thinned to two-fifths of what §14 tuned), and the
paths.

**One thing that had to stop moving with it.** Rain was scattered over the
whole farm; at 25 units across, against a default shot holding about ten of
them, most of the drops were being paid for behind the barn. The rain box is
now drawn around the camera's own subject instead — same count over less
ground, which is also why the rain did not thin out when everything else
grew.

**A hillside pine grew in front of the lens.** Not a rule that existed
before, because it did not need to: the camera used to sit 1.6 units past
the southern fence, barely into the terrain's transition band, where the
ground has not risen enough for the hillside scatter's own height test to
admit a tree. Pulling the camera back to five units out put it in the middle
of that band, and the first render after the enlargement had a pine a unit
in front of the camera hiding half the farm. Fixed by excluding a disc of
the orbit controls' own `minDistance` around wherever `camera.position`
actually is — read off the camera rather than recomputed from `CAM_BACK`, so
it tracks the shot rather than what the file last said about it.

**The farmhouse was not rotated, and that was checked rather than assumed.**
Standing next to it, the east face reads as a blank gable in a screenshot,
and the obvious conclusion is that the door faces the wrong way. Rendering
the model at all four quarter-turns, and then the shipped rotation from due
east, showed the door and both windows already facing the field: what looks
blank is the raking camera angle plus the farmer standing in front of the
door. Nothing changed.

### Collision

`BUILDING_CLEARINGS` — two hand-written circles that kept grass out of the
buildings — is gone. Its replacement is `SOLIDS`, built by measuring each
prop's `Box3` *as it lands in the scene*, and used for both jobs: the grass
exclusion and the farmer's collision. A hand-written footprint is a second
copy of a number that is already in the model file, and the old circles
(r = 1.7 and 1.9) were exactly the kind of copy that goes quietly wrong —
they were already too small for buildings a third of the present size.

Two shapes, because two questions are being asked. A building, a stall or a
car is a **box**: its footprint is its bounding box, and walking into one
should feel like a wall. A tree is a **post** — the trunk stops her, the
canopy does not, because a farmer who cannot stand under her own apple tree
is a farmer in a maze. The trunk radius is 0.085 × the tree's height, which
is measured: sampling each kit species' geometry below knee height gives
0.086 of model height for `tree_default` and 0.069 for the pine.

Because `SOLIDS` is filled by the props arriving, the foliage scatter now
waits on them. That ordering is the price of having one source of truth
instead of two, and it is cheap: measured at 2.7s to the footprints and 3.7s
to the last grass tuft, against 2.5s for the scene itself.

**Collision applies to the job queue's walk as well as to the stick**, which
is where this parts company with §17's pond. The pond is deliberately left
out of the queue's path, because a queue given a target it cannot reach is a
farmer stuck forever. The same argument would apply here — but "she does not
walk through walls" is a promise to the player, and one that lapses whenever
she is on an errand is not a promise. What makes it safe is that nothing
solid stands in the yard, in the pen, or on the ground between them, and
there is now a test that sweeps that whole rectangle and holds it.

**Two collider bugs, both found by the tests and neither by reading the
code.** They are worth recording because they share a root that is not
obvious.

`advanceFarmer` credits the real elapsed time to a starved frame on purpose
(§16). On four contending software-rendered workers that means a single
frame can ask for a step several units long — and every textbook collision
resolver quietly assumes steps shorter than the things they hit.

1. *Ejected out the back of the barn.* The first resolver pushed the
   destination out through whichever face was nearest. A long step that
   landed past the middle of the building found the far face nearer, and put
   her down outside the back wall. Reported by the test as "expected < 7.39,
   received 13.26" — which is `barn.maxX + BODY_RADIUS` to the centimetre.
2. *Pinned to a tree for good.* The fix for (1) was a swept test against the
   whole step. It held for boxes and broke trunks: a farmer already standing
   on a trunk's rim has the nearest point of her next step at its own start,
   so every frame discarded the entire step. She stood at (−4.02, −6.79),
   0.648 units from a trunk with a 0.65 rim, for twenty-five seconds. This is
   the exact failure §17 refused to risk on the queue, arrived at from the
   other direction.

The fix for both is that steps are now short by construction:
`moveWithCollision` cuts any step into pieces of at most 0.25 units — under
the narrowest trunk's 0.61 rim, over a normal frame's 0.07, so the loop runs
once in the ordinary case — and every move she makes goes through it. The
box resolver keeps its swept test, which is strictly more correct than
nearest-face; the trunk resolver went back to the pond's plain radial push,
which cannot stall.

### What this cost, measured

§22's instrument, re-run on the worst case the game can reach:

| | before | after |
|---|---|---|
| software path (what CI runs) | 168 calls, 44,992 tris | 174 calls, 48,426 tris |
| full density, no post-processing | 216 calls, 79,116 tris | 223 calls, 57,530 tris |

Both still clear the 260-call, 100,000-triangle ceiling with room to spare,
so the ceiling is unchanged. While re-measuring, a claim in that test's own
comment turned out to be wrong and has been corrected: it read as though the
ceiling covered "real hardware" generally, and it does not. With bloom and
SSAO on, the same worst case measures **479 calls and 121,381 triangles** —
over the ceiling — because SSAO gets its occlusion by rendering the scene a
second time, so any tier with it on costs about twice the scene by
construction. The ceiling covers the density dimension, which is where a
regression would come from; the post-processing dimension has its own
governor in §22's frame budget, and CI cannot reach that tier at all because
this box has no GPU. (The 479 figure was taken by forcing both switches
locally, not from a run that ships.)

### One more race, found by CI and not by this box

The first push of this work went red on a test nothing here had touched:
"the crop is picked when she arrives, not when the plot is tapped", failing
on both the attempt and the retry, once reporting the harvested inventory
and once the emptied plot. Both are the same thing — she had already
finished the walk before the assertion ran.

**Checked before being attributed, the same way §25's flakes were.** The
window in which "nothing has happened yet" is true is the length of her walk
to plot 0, and that was measured on both trees, ten runs each: 1.0–1.2
seconds before the enlargement and 1.0–1.2 seconds after. (The frame *count*
dropped from nine to seven, because each frame now carries slightly more
work — but the wall-clock is identical, which is exactly what crediting real
elapsed time to a starved frame means.) So the race is not this pass's
doing. It is a test that asked three separate questions over three Node
round trips inside a 1.1-second window, and a loaded CI runner is entirely
capable of taking longer than that.

Fixed at the root rather than padded: the click is now dispatched from
inside the page and all three answers read in the same synchronous turn, so
the window is not narrowed but closed — the walk cannot advance until the
next animation frame.

### Known gaps, still

- The barn is still `city-suburban/building-type-b` — a second suburban
  block, not a barn. Making it four times the size has, if anything, made
  that read more clearly. The mirror has no barn and no silo in any kit
  (§14), and that is unchanged.
- The hillside fringe still keeps its summer green through autumn (§21).
  There are 48 of those trees now rather than 26, so the scope cut is
  proportionally larger than it was.
- `tree_detailed`'s canopy starts low enough that the measured "below knee
  height" radius (0.377 of a 1.33-unit model) is canopy, not trunk. It gets
  the same 0.085 × height figure as the others, deliberately: brushing past
  low branches should not stop a farmer.
- Frame rate on a real phone is still unmeasured here, for the reason §22
  gives — this box has no GPU. What is measured is what the scene asks the
  driver for, which is the part that means the same thing on every machine.

---

## 28. Making it look like somewhere — the graphics pass

Asked for, after the scale pass: better graphics, and a more realistic
farmer and farm.

The largest wins here were not new features. Three of the four were defects
in data the game had been loading correctly and rendering faithfully for
twenty-seven sections — the kits describe themselves wrongly, three.js
believes them, and the result had been reviewed by eye and accepted more
than once. Reading the glTF JSON took ten minutes and found all three.

### What the files were actually saying

**Every Nature Kit material declares `metallicFactor: 1`**, with no
metallic-roughness texture and a plain coloured base. That is not a
description of metal; it is a default nobody overrode. It is also ruinous,
because a fully metallic surface has no diffuse response whatsoever: with no
environment map to reflect, every tree, bush, tuft of grass, log and rock in
the game was lit by one broad specular lobe and nothing else. That is why
the orchard read as a row of near-black blobs and the grass as dark spikes.
Rendered side by side at 1 and at 0, the same `leafsGreen` goes from murky
bottle-green to the sage its base colour actually is.

**Every Nature Kit colour is a pastel of the thing it is called.** glTF
defines `baseColorFactor` as linear; this kit's numbers are the sRGB values
written straight into the linear slot. It is diagnosable from the material
names alone, with no appeal to taste:

| material | as loaded | corrected |
|---|---|---|
| `colorRed` | `#f19398` pink | a red |
| `dirt` | `#f2be9e` peach | a brown |
| `woodBark` | `#f2be9e` peach | a brown |
| `stone` | `#ddf2f5` near-white | a grey |
| `corn` | `#fbdfa8` cream | a corn yellow |

A material called `dirt` that is the colour of a peach is not a stylistic
choice.

**The characters declare `KHR_materials_unlit`**, so `GLTFLoader` correctly
gives them a `MeshBasicMaterial`. Correct to the letter of the file, and
wrong for a game with a day/night cycle: the farmer took no light at all.
She stayed noon-bright through dusk and midnight, ignored the sun every
other object answers to, and — once there were shadows — could neither cast
one nor receive one. She is the thing the player looks at most and she was
the only thing in the scene not lit by the scene. Rebuilt as a standard
material carrying the same texture, which is what puts her in the same world
as her own cows.

All three are corrected once per parse in `assets.js`, before any clone is
handed out, so every placement and every `InstancedMesh` gets the corrected
version. They apply on **every** path, including the software rasteriser CI
runs — which is why the low-end look improved as much as the high-end one.

### Shadows, on the third attempt

§9 and an earlier step both tried shadows and both abandoned them on
measurement: even one 512px caster with nothing receiving cost an unrelated
test its timing window under contention. Both measurements were taken on the
software rasteriser — which is what CI runs, and what nobody plays on.

The scene already answers that question separately for the two kinds of
machine. `rendererIsSoftware()` gates the post-processing chain, the foliage
density, the pen's head count and the rain; a shadow map is the same sort of
cost and now sits behind the same gate. On the software path nothing changes
at all — the map is never enabled, never rendered, never sampled, and both
earlier measurements stand untouched. There is a test asserting exactly that.

One 2048 map, `PCFSoftShadowMap`, an orthographic box of half-extent 22 over
the whole farm — about 2.1cm a texel. Three things had to change with it:

- **The sun had to move out.** It sat 9 units from its target, which is
  irrelevant to a directional light's shading and fatal to its shadow
  camera: anything further from the target than the light itself falls
  behind the near plane and stops casting. That was most of the farm. It is
  pushed to 60 along the identical direction.
- **The sun had to come down.** The arc put midday at about 75° — roughly
  where the real one goes, and fine while nothing cast, since elevation only
  changed how square-on the light struck each face. With shadows it lays
  every shadow underneath the thing casting it, so at the hour the player
  sees the farm most there was nothing to see. Flattened to a peak near 55°
  and leaned south, behind the default camera's shoulder, so lit faces turn
  toward the player and shadows run away up the field.
- **The fill had to come down and the key up.** With no shadow and no
  occlusion, ambient was the *only* light on every surface the sun did not
  face, so a wall in sun and a wall in shade differed by very little. The
  hemisphere drops from 0.85 to 0.58 and the sun rises from 1.15 to 1.75;
  the night floor is re-derived to land on 0.22, exactly where it was, since
  turning the ambient down is a daylight decision and at night there is no
  sun to take over.

### The sky was blown out on two of the three tiers, and had been for ages

`Sky.js` ends its fragment shader with `#include <tonemapping_fragment>`,
and **three.js compiles that chunk out when rendering into a render target**
— on the reasoning that a composer chain will tone-map at the end. This
chain deliberately does not: §10 chose `GammaCorrectionShader` over
`OutputPass` precisely so ACES is not applied to the whole image.

So on the direct path the sky was tone-mapped and looked right, and on both
composer tiers Sky.js's unclamped Preetham radiance went into the buffer raw
and clipped to flat white. The same pixel, measured:

| | before | after |
|---|---|---|
| direct path (what CI and every screenshot use) | (210, 222, 227) | (219, 228, 233) |
| composer path (what a real GPU gets) | **(255, 255, 255)** | (214, 225, 229) |

It had been that way since the composer was added, and survived because the
direct path is the one every software-rendered screenshot uses. The fix is
to give the sky three.js's own ACES curve inside its own shader, under
private names so the renderer's copy cannot collide with it, and turn
`toneMapped` off so it cannot be applied twice. The two tiers now agree to
within 5/255, and the direct path is preserved to within 9.

### Wind

The farm was completely still: a photograph of a field. Displacement is
proportional to each vertex's height above its model's origin, which is what
makes it read as bending rather than sliding — and it is why the *trunk*
materials are on the list, because bending only the leaves slides a canopy
off its own tree. Phase is sampled from world position, through
`instanceMatrix`, so neighbours lean together and 540 grass tufts do not
beat in unison. Strength reads the same hurricane forecast the rain does, so
the air gets restless in the days before a storm.

Verified as motion, not assumed from the code: with the day phase pinned and
wind strength forced to 0 against 9, **37.4% of the pixels in the orchard
band change**. The band deliberately excludes the pond, whose shader
animates on its own clock and would have proved nothing.

### Two smaller things

**Per-instance colour variation on the scatter.** A field where every blade
is the same colour is the giveaway that a computer put it there. Each
instance is jittered on the same deterministic rng everything else uses, so
today's screenshot still matches tomorrow's.

**Ground grain in the fragment shader.** `buildTerrain` mottles vertex
colours, which is right for the broad patchiness of a field seen from across
it, but at 1.28 units between vertices it was the only variation there was —
so closer than about eight metres the ground read as painted card. Two
octaves of the same value noise, per pixel, modulating brightness by about a
tenth. Doing it in the mesh instead would take the terrain from 10,368
triangles to roughly 68,000 for information that only ever changes colour.

### What it costs

Measured on the worst case the game can reach, at full quality with
post-processing — the tier only a real GPU reaches:

| | calls | triangles |
|---|---|---|
| before this pass | 349 | 319,929 |
| shadows added, naively | 685 | 614,681 |
| shipped | 515 | 357,945 |

Two findings closed most of that gap, and neither was visible by reading the
code:

1. **The shadow map was being drawn twice a frame.** Left on `autoUpdate`,
   three.js rebuilds it at the top of *every* `renderer.render()` call, and
   on the composer tiers there are several — `RenderPass` renders the scene
   and `SSAOPass` renders it again for depth and normals. The instrument
   caught it as an exactly doubled count: 234,768 triangles charged to
   casters whose geometry adds up to 117,384. Now asked for once a frame by
   hand.
2. **Grass was casting shadows.** 540 tufts at 132 triangles and 170 at 224
   is 109,360 triangles a frame, to draw shadows the size of a thumbnail
   under blades that are themselves a thumbnail. Grass receives and no
   longer casts; the hillside fringe — 48 trees, 8,024 triangles between
   them — still does both, because a missing shadow on a tree that size
   would be noticed.

The software path is unchanged in structure and costs 166 calls and 89,526
triangles, comfortably inside §22's 260/100,000 ceiling, which is the one
the test can actually reach.

### The reach tests, and a 33% flake rate older than this pass

The first push of this work went red on three tests that drive the farmer
until something comes into reach. **Checked before being attributed**, the
same way §25 and §27's were: 4 workers, 10 repeats, the identical selection
run against the untouched tree and against this one. **10 failed and 20
passed on both.** The graphics pass does cost about 5% on the software path
(a frame interval of 174ms against 166ms, split evenly between the ground
grain and the wind), and it moved that rate not at all.

Two false starts on the way to the measurement, both worth recording
because both produced a confident wrong number:

- An A/B that "proved" the ground grain cost 128ms a frame. The patch had
  assigned `false` to `onBeforeCompile`, so the terrain stopped rendering
  altogether — the largest mesh on screen vanishing is not a saving. A
  result three times better than the baseline is a broken experiment, not a
  discovery.
- A "baseline" comparison run against a tree that was already clean at
  HEAD, so `git stash` had nothing to stash and the current code was
  compared with itself.

**The real cause, instrumented rather than reasoned about.** Under four
contending pages the frame interval sits near 328ms. She walks at
wall-clock speed, so that is 1.38 units between two consecutive reads of
`reachable()`, against plot rows 1.16 apart. Every captured failure had her
stopped at `z = -14.7` — `ROAM.minZ`, the far wall of the farm — having
walked past all sixteen plots without one sample landing near any of them.

She spawns 0.76 units from plot 12 and `REACH` is 0.95, so for these tests
the honest answer to "drive until something is in reach" was that something
already was. The helper now checks before it touches the stick: 20/30
became 30/30.

**The mobile tapping test needed more, and its first fix was wrong in an
instructive way.** That test walks her onto one *particular* tile, so
checking first does not help. Bounding each push by milliseconds looks like
the answer and is not: `advanceFarmer` credits a starved frame with the
real time that elapsed and reads the stick at frame time, so a 1.5-second
stall straddling a held stick carries her six units however brief the push
was meant to be. That version oscillated and left her *south* of where she
started, which is exactly what a time-bounded push looks like when time is
not what bounds it.

What does bound it is distance, checked inside the page where it can be
acted on without a round trip: each push releases the drive the moment she
has covered its allowance. Corrections also push the stick *gently* — the
knob's offset sets her speed against a 44px radius, so a 9px nudge walks
her at a fifth of full pace and a stall during one moves her a fifth as
far. 0/8 became 8/8 at the contention that had failed CI twice.

The same test is now `test.slow()`. It plays the whole loop by touch on a
software rasteriser and measures 37-41 seconds; the 30-second default was
the wrong number, not the test, and the original had been timing out there
too.

### Known gaps, still

- The barn is still a suburban house (§14, §27). No lighting fixes that.
- Nothing here touches the character models themselves. "More realistic
  farmer" is answered by lighting her, shadowing her and grounding her, not
  by replacing a blocky kit character with something from a different visual
  language — the kits reading as one language is the thing §2 established
  and every section since has protected.
- The pond's water is still a custom `ShaderMaterial` and therefore neither
  casts nor receives shadows. Threading the shadow chunks through it by hand
  is real work for a surface already doing its own lighting.
- Frame *rate* on real hardware remains unmeasured here, for §22's reason:
  this box has no GPU. What is measured is what the scene asks the driver
  for, which means the same thing on every machine.

---

## 29. The phone screen, and a place the game got stuck

Two things asked for together, and they turned out to be unrelated: give the
playing area the phone screen, and find out why the game sometimes stops
responding.

### The yard was getting a quarter of the phone

Measured at 393x852 before anything changed: the 3D scene came out **325x244
— 28.6% of the viewport — and started 571px down**, which on a shorter phone
is below the fold. You had to scroll to see the farm you were playing.

Three things were eating it, and the fix for each is dull:

| | was | now |
|---|---|---|
| tab bar | 158px (three rows of two) | 53px (one row of five) |
| top bar | 107px (two rows) | 70px (one row) |
| farm scene | 4:3 box, cannot grow | fills what is left |

The tab bar was `flex: 1 1 calc(50% - 7px)` — two per row, so five tabs made
three rows. Stacking the icon over the label makes each tab a squat square
that fits five across a 360px screen. The top bar gives up the words "Farm
Life" and keeps the tractor: the title is the only thing in that row which
is decoration rather than information, so it is the thing that yields.

**The structural change is that `#farmTab` became a column that fills the
screen, with the scene taking whatever the rest does not want** — scoped to
that one tab, because the others are lists that are *meant* to run past the
bottom and be scrolled. `100dvh` rather than `100vh`: on a phone browser
`100vh` is measured as if the address bar were hidden, which would have
sized the farm to a screen that is not all there.

**The footer had to move out of `#app`.** This is the part that would not
have been found by reading the CSS. With the fill in place the scene still
would not grow, and the reason was a 158px slab of credits sitting in the
same flex column: `flex-grow` distributes *free* space, and with the footer
inside there was none — the content already overflowed. Moving it outside
`#app`, where a site footer belongs anyway, is what let the yard take the
room. The scene went from 244px to 414px on the same phone.

| profile | before | after |
|---|---|---|
| 393 x 852 | 244px, 28.6% | **414px, 48.6%** |
| 360 x 640 | 219px, 34.2% | **266px, 41.6%** |
| 740 x 360 landscape | 166px, 46.1% | unchanged |

Landscape is left alone deliberately. There is genuinely no spare height on
a phone lying down, and `mobile.spec.js` caps the scene there on purpose so
it cannot push the tab bar off the screen.

One thing the narrow layout cost, found by measuring rather than by eye: at
360px the top bar row no longer wraps, so the pressure moved sideways and
`.stats` came out 322px wide in a 286px slot. The two pills take a size
smaller below 400px. The help and mute buttons deliberately do not — they
are thumb targets and the 44px floor is asserted.

### The stuck spot was where two exclusion zones overlapped

"Every now and then" is the hard part of a bug report like this, so the
answer had to come from a sweep rather than from reproducing it by hand.

Every exclusion in this scene is individually correct and convex. The pond
pushes her out to its bank; a solid pushes her out to its nearest face.
**Neither knows the other exists.** Where two of them overlap, one
resolver's answer lands inside the other's, and the point that comes out the
end of `moveWithCollision` satisfies neither. The player feels that as the
game getting stuck, in one particular place, with nothing on screen to
explain it.

Found by scanning the walkable farm at 4cm and asking which points are
inside both the pond and a solid: **249 of them, in a band at x 1.00-1.32,
z 5.46-6.82** — the seam between the enlarged pond's east rim and the market
stall's collision box. §28 enlarged the pond; §27 placed the stall. Each was
fine on its own.

Worth noting against my own words: §27's comment claimed "there is no
concave pocket anywhere in SOLIDS for her to get caught in". That was true
of SOLIDS and false of the scene, because the pond is not in SOLIDS. A
convexity argument is only as good as the set it ranges over.

Fixed at both levels:

- **The cause.** The stall moved north-east off the water, and the car south
  along its own road so the two of them stop overlapping as well. A test now
  holds that no solid may overlap the pond, and that no two solids may
  overlap each other — so the next time either the pond or a prop moves,
  this fails rather than shipping.
- **The class.** `moveWithCollision` now refuses a step whose resolved
  position is still inside the water or a wall, keeping her where she was —
  which is always somewhere she legitimately stood. The farmer who is
  *already* somewhere invalid is let through, because for her moving is the
  only way out. The next overlap costs a refused step rather than a stuck
  farmer.

And the invariant a stuck player actually cares about, swept rather than
spot-checked: for all **7,526** points she can stand on, at least one of
sixteen directions leads somewhere she can also stand. Zero fail.

### What was checked and found innocent

The queue was the other obvious suspect and it is not guilty: 40 errands
tapped from random positions, with random wanders in between, all drained to
zero. Recorded because "we looked and it was fine" is worth as much as a
fix when the next report comes in.

## 30. A second graphics pass — the sky, the water's edge, the ground, the finish

§28 lit the farm. This pass is about what §28's own screenshots still showed
once the lighting stopped being the thing you noticed, and it started by
writing that list down honestly rather than by picking something to improve:

1. **The top quarter of every frame was a featureless pale wash.** Sky.js was
   drawing a physically-derived gradient and nothing else. Biggest gap by
   area, by a wide margin.
2. **The pond was a cyan disc with a cut edge.** Not a pond — a shape of
   paint dropped on the grass.
3. **The ground was one flat green.** There was already a two-octave grain on
   it, and it had not helped.
4. The distant hills are a flat mauve band.
5. Shadows are soft and low-resolution.
6. Everything is perfectly matte.

Items 1, 2, 3 and 6 are done. Items 4 and 5 are not — see the gap list at the
end of this section for why each was left.

### 1. Clouds, and the projection that was wrong for this game

Clouds are fbm noise injected into Sky.js's fragment shader through the same
`onBeforeCompile` hook that already carries §28's private tone map, and mixed
in **after** it, in display space, for the reason §28 records: Sky.js emits
unclamped radiance, so a cloud painted at 1.0 into a sky sitting at 9.0 comes
out as a dark smudge.

The interesting part is the projection, because the obvious one is wrong here
in a way that does not show up in a screenshot taken by the person who wrote
it. The textbook way to put clouds on a slab is `dir.xz / dir.y`. It diverges
at the horizon: a ray a hair above level lands kilometres out, so the low band
of sky smears one noise cell across the screen or, once clamped, goes flat.

**That band is the only sky this game frames.** The camera sits near head
height looking level; the top of the frame is about six degrees up. The first
implementation was invisible in the game and looked correct the moment the
camera was orbited skyward — which is exactly the screenshot that got taken.

Softening the divisor to `dir.xz / (dir.y + 0.22)` bends the slab into a dome.
It is bounded — at the horizon the divisor is still 0.22, so the coordinate
tops out near 4.5 instead of running away — which leaves resolvable structure
in the few degrees above the treeline and compresses it toward the horizon the
way distance does.

The rest falls out of signals that already existed. Cover is the hurricane
forecast that already dims the sun and thickens the rain, so the sky fills in
over the three warning days. The tint runs off the sun's own colour, so the
clouds go gold at dusk — but only 45% of the way there, because taking that
colour neat gave a midday sky full of peach.

**Night was the one real bug, and it took two corrections to measure.** The
first tuning put the midnight sky at 142/255 against a cloudless baseline of
35: a bank of cloud blazing over a farm lit by nothing.

- Comparing one pixel between two renders is comparing two different parts of
  the sky, because the clouds drift. The figures here are the 99th percentile
  of the whole sky band.
- The number that matters is **post-bloom**. The same shader measures 72 with
  no post-processing and 113 through the FULL tier's bloom pass, because a
  wide soft bright region is precisely what bloom is built to find. Tuned
  against what the player sees; the software path therefore comes out a
  little darker still, which is the right way round for a path that has no
  shadows either.

Midnight now reads 103 against that 35 — a moonlit overcast, not a lit one.

One thing this did **not** establish, and worth saying because the obvious
reading of the numbers is wrong: removing the sun floor measured *brighter*
than leaving it in — 113 against 91. The 99th percentile still tracks which
cloud masses happen to be in frame, so that pair is noise, not a result. The
floor is gone on the argument, not on a measurement: no sun falls on a
midnight cloud, and two independent moonlight terms is a thing that cannot be
tuned, because lowering either one leaves the other holding the brightness
up.

**The drift moved off the wall clock.** It ran on `performance.now()`, which
meant the same farm on the same morning drew a different sky depending on how
long the tab had been open, and made one screenshot of the sky impossible to
compare with another. It now runs on `state.day + phase` — neither half works
alone, because `dayElapsedMs` saws back to its remainder every rollover and
`state.day` only moves in whole steps. Summed, they climb smoothly. The sky is
a function of the save.

### 2. The pond, and the difference between radius and depth

The shoreline stopped dead on a hard line because **the shader was keyed to
radial position and a shoreline is made of depth**.

The pond's floor was flat at `FLOOR_Y` all the way out to a steep inner face.
Counted on the surface's own vertices through the bank profile, that put **86%
of the water at full depth** — the same 86% by area — and left the entire run
from full depth to nothing in the **outer 7% of the radius**. About ten
centimetres. A handful of pixels. Nothing that narrow survives being drawn.

So the fix is a change of shape, not of shader. The floor is now a dish —
deepest in the middle, shelving up to the foot of the face — which is how
ponds are actually dug, so this is the geometry being made right rather than
bent to suit a shader. **A quarter of the surface now stands in the shallow
end**, and a test asserts that fraction so the shape cannot quietly go flat
again.

On top of that shape:

| | before | after |
|---|---|---|
| colour | `mix(deep, shallow, shore²)` | keyed to depth, so the gradient crowds into the last hand's width |
| opacity | 0.97 → 0.80 at the rim | fades to zero over the shallows; the water dissolves into wet mud |
| bank mud | a 0.09-wide band outside the water | 0.16 wide, and mostly seen *through* water now |
| ripples | three straight wave trains | domain-warped, so crests curve |
| ripple amplitude | uniform across the pond | patches of breeze; calm in the shallows, where there is no fetch |

Two notes on the ripples. The straight trains read as soft diagonal bars
however many were added — straight crests stay straight — so the plane is bent
before they are sampled. The gradient is then the *un-warped* one: doing it
properly costs a 2x2 Jacobian per pixel for at most a quarter of the slope, on
a surface whose whole job is to shimmer. That is a deliberate approximation,
not an oversight. And a pond ruffled identically edge to edge was half of why
it read as painted — the eye catches the uniformity long before it catches the
ripples.

### 3. The ground, and why two octaves of grain never fixed it

The existing grain scales all three channels by the same number, so a uniform
green comes out a **noisier uniform green**. At arm's length a brightness
grain is texture; what a field reads by from across the farm is patches —
dried in the sun, lush in a hollow — and those are hue differences, metres
wide.

A third octave, thirty times broader than the other two and the only one that
touches hue, pulls one end of a low-frequency field toward straw and the other
toward a cooler green, leaving the middle as whatever the terrain was already
painted. Both act on the vertex colours rather than replacing them, so a worn
path crossed by a patch still reads as a worn path.

The pond bank now shares the terrain's compile hook. It is painted by the same
function and butted straight against the terrain sheet, and without this it
was the one patch of ground in the farm with no grain and no patchwork — which
the new octave would only have made more obvious.

### 6. Nothing could catch the light

This one was a measurement, not an impression. Dumping the
`pbrMetallicRoughness` of every material in every `.glb` the game loads:

```
_defaultMat  r=1  colormap  r=undefined   grass  r=1   woodBark  r=1
colorRed     r=1  texture-a r=undefined   stone  r=1   leafsGreen r=1
```

**Every material ships roughness 1**, stated on the untextured ones and
omitted — which glTF defines as 1 — on the seventeen textured files that
carry the buildings, animals, vehicles and the farmer. Roughness 1 at
metalness 0 is a Lambertian surface: no specular response at all. "Everything
in the farm is matte" was not taste. Nothing in the farm was *able* to catch
the light, and no amount of relighting was going to change that.

`overrideKitFinish(name, roughness)` mirrors §28's `overrideKitColor` — the
same name-keyed, once-per-parse route, registered by the scene because this is
art direction rather than a defect being repaired. Values run 0.55 (painted
metal) to 0.94 (bark); dirt stays at 1, because dirt genuinely is matte. They
are deliberately timid: at metalness 0 the Fresnel reflectance at normal
incidence is 0.04, so nothing in this range turns the farm to plastic. And the
only specular light in the scene is the sun — three.js's hemisphere light
contributes irradiance and nothing else — so the sheen follows the time of day
for free, as the pond's glint already did.

The test for this enumerates the scene rather than reading the table back, and
that is not pedantry: it immediately found `_defaultMat` missing from a table
written by hand from the asset dump.

### Cost

| | calls | triangles |
|---|---|---|
| FULL tier, before | 498 | 355,811 |
| FULL tier, after | 498 | 357,347 |

No new draw calls: the clouds and the ground patchwork are fragment work
inside shaders that were already compiled, and the finish table changes
uniforms. The 1,536 extra triangles are the pond's four extra rings, which
are what keep the new shoreline a gradient rather than a staircase.

The clouds are the one thing here whose cost scales with how much of the frame
you can see, so they run five octaves of fbm where there is a GPU and three
where there is not, on the same `rendererIsSoftware()` gate that already
decides shadows, foliage density and rain.

### The CI budget, which this pass ran out

The first push of this work came back **cancelled, not failed** — twenty
minutes into a job with `timeout-minutes: 20`, with nothing having failed.

That is worth recording as a finding rather than as a footnote, because the
five tests added here are not really the cause. The previous run, at 290
tests, took **nineteen minutes of the twenty**. The margin was about a
minute, which is another way of saying the next test added to this suite —
anywhere, testing anything — was going to cancel the run. These five were
simply the ones that arrived.

Both halves of the fix are in this commit:

- The most expensive of the new tests did two full page loads to compare two
  saves. It now does one, setting `state.day` in the page and reading the
  uniform back on the next drawn frame, which asks exactly the same question
  — six minutes of drift cannot come from a wall clock because a variable was
  assigned. Locally that took it from 11s to 6s.
- `timeout-minutes` goes to 30. Not to buy back the minute that ran out — to
  restore a margin, so the next person to add a test is not paying for this.

A cancelled run reads as a red build and says nothing at all about the code,
which is the least useful thing a CI signal can do. The number to watch from
here is the run's own duration: if it climbs toward thirty, the answer is a
cheaper suite, not a third raise.

### What this pass did not do

- **The distant hills are still a flat mauve band.** That band is correct
  atmospheric perspective — it is the fog colour, reached because everything
  at that distance is fully fogged. Making it graded means changing the fog
  range, which is load-bearing for how the whole farm sits in its landscape,
  and is a bigger change than it looks. Left deliberately, not missed.
- **Shadows are still soft.** A view-following or distance-scaled shadow
  frustum would sharpen them, and it is the right fix. It is also a change to
  the one subsystem §28 measured as the most expensive thing in the frame,
  on a project whose CI runs on a software rasteriser — so it wants its own
  pass with its own before-and-after numbers, not a corner of this one.
- **No environment map**, for the reasons §28 already recorded. The new
  finish table makes that omission slightly more visible in principle: a
  glossier surface has more to reflect and still nothing to reflect it from.
  In practice at these roughness values the sun and the hemisphere light
  carry it, which is what the screenshots show.

## 31. The blank playing field

Reported as: "every now and then the game play ground gets blank and cannot do
with the game anything", with a screenshot.

### What the screenshot already said

The scene box was a plain blue-to-green vertical gradient. That gradient is not
a rendering of anything — it is `.farm-scene`'s own CSS `background`, which
exists to fill the box before the first frame lands. Sitting on top of it, fully
drawn, were the drive stick and the Harvest button, because those are DOM
siblings of the canvas rather than pixels in it. The tab bar, the seed row and
a "a wolf took one of your chickens" toast were all working.

So: the page was alive, the DOM was alive, the game logic was alive, and the
canvas was drawing nothing. That is one specific failure, not a general hang.

The other half of the screenshot was the browser saying so out loud. Across the
top, Microsoft Edge on Android: *"Originalinhalt anzeigen? Um Speicherplatz zu
sparen, hat Microsoft Edge einige Inhalte entfernt."* — the browser had removed
page content to save storage.

### Reproduced, not inferred

`WEBGL_lose_context` is the real event, not a stand-in for it. Losing the
context on a healthy farm:

| | draw calls | farmer z |
|---|---|---|
| before | 154 | 2.44 |
| after `loseContext()` | **0** | walks to −1.41 |

Draw calls to zero and stay there; the canvas screenshot is the user's
screenshot, gradient, stick, Harvest button and all. And **she still walks** —
the frame loop keeps running, the clock keeps turning, wolves keep taking
chickens. The game was never hung. It was invisible.

That is what "cannot do anything with the game" means from the player's side:
the farm is being played, and they cannot see it.

### What three.js already does, and the two things it cannot

The renderer is not passive here. It listens for `webglcontextlost`, calls
`preventDefault()` — which is the call that permits a restore at all — stops
rendering, and on `webglcontextrestored` rebuilds every buffer and texture.
That last part works completely: losing and restoring the context returns
**123 calls and 74,284 triangles, identical either side**.

What a renderer cannot do is the two things that actually left the player
stuck:

1. **Say anything.** A lost context is silent. `console.log` is not a player.
2. **Cope with a restore that never arrives.** `preventDefault()` permits a
   restore; it does not compel one. A phone that dropped the context because
   it was short of memory is under no obligation to hand it back, and Edge
   discarding page content is exactly that situation. The only way out was a
   reload nobody had been told to perform.

### The fix

A panel over the scene box — not the page, because the market, the animals and
the awards are all still working and taking the whole screen would be a bigger
claim than the truth.

- On `webglcontextlost`: stop the per-frame sync work (three.js's `render()` is
  already a no-op, so this is about not animating water and wind for a surface
  that cannot show them, on a device that just said it is short of resources),
  and say that the view paused and is coming back. No button yet — on a desktop
  the restore is usually immediate and a button would be a flash of alarm.
- She keeps walking, for the same reason she keeps walking on the Market tab: a
  job taken before the outage has to finish or the tap that started it is lost.
- On `webglcontextrestored`: clear the panel, clear `lastDrawAt` so the outage
  is not charged to the frame budget as one catastrophically slow frame, and
  ask for a fresh shadow map. Automatic — the player does nothing.
- After six seconds with no restore: the message changes and a **Reload the
  farm** button appears. The save is committed by hand first rather than
  trusting the `pagehide` handler a reload also fires — it costs one write, and
  this is the one recovery path in the game, reached on a device that has
  already demonstrated it is low on resources.

### The bug in the fix, caught by looking rather than asking

The first build of the panel shipped a worse bug than the one it explained: the
farm came back and **the panel stayed up over it, permanently**.

An author `display: flex` beats the user agent's `[hidden] { display: none }`
regardless of specificity, so the panel ignored its own `hidden` attribute. The
DOM said what you would want to hear the whole time — `el.hidden === true` —
and the screen showed an overlay welded across a working farm. Screenshotting
the restore is what found it; reading the property back never would have. The
rule is now `.scene-lost[hidden] { display: none; }` and the test asks the
layout (`toBeVisible`) rather than the attribute.

### The CI failure that followed, which was not this

The push CI'd red on a test this work never touched — `the stick and the
prompt stay reachable in landscape`, failing on `boundingBox()` returning null
for a button that was still hidden.

Two things had to be separated before anything was changed. The first was a
genuine defect this work *had* introduced, found while looking: the frame
loop's new "context is gone" early return sat above `syncPrompt()`, so
`reachable()` — which answers live — and the prompt button, which only updates
on a drawn frame, could contradict each other for as long as an outage
lasted. That is fixed by keeping `syncPrompt()` running through the outage; it
writes to a DOM button, and that button is the only thing telling a screen
reader what is in reach, which no visual panel replaces.

The second was whether that defect was the failure. It was not. Run at
`--workers=4 --repeat-each=12`:

| | failures |
|---|---|
| this commit | 5 of 12 |
| the commit before it | **8 of 12** |

Worse on the build without any of this in it, so pre-existing, and CI simply
drew the short straw. Recorded because "the build went red right after my
change" is the most inviting wrong answer available.

The real cause is the hazard this project has written up twice before.
`advanceFarmer` credits a starved frame the whole wall-clock time it lasted,
by design — so a step taken under load is not a small step, it is a long one.
The test waited for `reachable()` from the test process and then sent a
separate `drive(0, 0)`, putting a full round-trip between noticing she had
arrived and telling her to stop, and at four workers she crossed the tile and
came out the far side inside that gap. The stale `aria-label` on a
still-hidden button is the fingerprint: she *was* in reach, for a moment.

Fixed by stopping her on the page's own frames, in the same frame the target
comes into reach, which is the shape `driveOnto` in that file already uses.
16 of 16 afterwards at the contention that failed 8 of 12.

## 32. A person, a road, and somewhere to drive it

Three asks together: make the farmer human rather than Lego, lay a road to the
market, and let her load the harvest and drive it there like a country drive in
GTA.

### The farmer had to be built, because no kit has a person in it

The pinned CC0 mirror has exactly two character kits, and both were checked
rather than assumed.

| kit | what it is |
|---|---|
| `blocky-characters` (in use) | a Lego minifigure — slab body, peg arms, cube head, no neck |
| `mini-characters` | real limbs, hair, faces, **and a ready-made `drive` clip** |

`mini-characters` looked like the answer and is not. It renders with its arms
fragmented and splayed — **width 1.10 against height 0.78** in its own bind
pose, before any code here touches it. That was run down properly before it was
abandoned: the raw glTF has one `JOINTS_0` set, joint indices in range (max 5 of
7), and weights normalised to 1.0000 on every vertex; `skeleton.pose()` changes
nothing; playing `static` — the only clip with a track for all seven joints —
changes nothing. The breakage is authored into the file. It is also a Funko: a
third of its height is head, which is not much less Lego than what it replaces.

So she is built from primitives in `farmer.js`. That buys the one thing no kit
here offers: **proportions**.

|  | minifigure | built |
|---|---|---|
| head as a fraction of height | ~⅓ | **~⅙** |
| neck | none | yes |
| joints that bend | shoulder, hip | shoulder, elbow, wrist, hip, knee, ankle |

Six and a half heads, not the seven and a half a life-drawing class measures.
The first build used 7.5 and it was wrong in a way only the render showed: at
the distance this game is played at, an anatomically correct head is a handful
of pixels and she came out pin-headed — the failure mode at the far end from
the one being fixed.

Three other things were wrong and found by looking rather than by reasoning:

- **The legs ran through the floor.** The thigh bone hangs 0.35 heads below the
  pelvis centre and the thigh's *length* was computed from the pelvis, so both
  boots sat 8.6cm under the field. Found by printing every mesh's world extent,
  not by looking at the screen — the grass hid it.
- **The hair was a motorcycle helmet.** A hemisphere of hair comes down to the
  equator of the skull, which is eye height. Tilting the opening forward lifts
  the front rim off the brow and drops the back one over the nape in one move;
  a cap short enough to clear the eyes left a bare patch at the back of her
  head, which is the view this game is mostly played from.
- **She had no face.** Two dark chips for eyes, three pixels each at playing
  distance, and still the difference between a person and a mannequin.

The rig is a plain `Object3D` hierarchy with a ball at each joint rather than a
`SkinnedMesh`. Nothing here needs vertices to follow bones smoothly, and the
ball fills the wedge that opens on the inside of a bend — which is how a
low-poly figure gets away without skinning at all. Clips are built as ordinary
`AnimationClip`s on the ordinary mixer, so `poseFarmer`'s crossfades, its clip
speed scaling and its once-through crouch all drove the new figure untouched.

**One test had to be restated rather than satisfied.** The orchard asserted
`tree.height / farmer > 2.7`, and that threshold was calibrated against the
1.45-unit farmer. She is 1.6 now, so the same 4.2-unit tree comes out at 2.6.
Nothing about the orchard changed — the yardstick did, and it moved *toward*
the truth: a four-metre tree over a person really is about two and a half times
their height. The ratio is restated against the figure actually standing there,
with the tree's absolute height asserted alongside it so the pair cannot both
be met by a mistake.

### The road is one mesh, not a hundred tiles

The kit's road pieces are a metre square. Sixty-odd units of road would have
been well over a hundred models and a hundred draw calls, laid on a grid that
cannot bend — a road made of squares turns in right angles, which is a street.

So it is a ribbon generated along a Catmull-Rom spline: **one geometry, one draw
call, 63.6 units long**, curving as smoothly as it is sampled and rolling over
the hills it crosses. The markings are drawn in the shader from the ribbon's own
along-the-road coordinate — a dashed centre line and two solid edges, no second
mesh and no texture to load.

Two rendering bugs, both found in screenshots and both fixed at the cause:

- **Black patches on the tarmac.** `computeVertexNormals` on a ribbon whose
  inner edge barely advances through a tight bend produces triangles with
  flipped winding, whose normals point into the hill. Every point of a road
  lying on a hillside has a normal that is knowable without reference to any
  triangle — it is the hill's gradient — so that is what it uses now.
- **Grass punching up through the road.** The ribbon was laid at
  `terrainHeight` plus a few centimetres, and that is the height of the
  *function*, not of the *mesh*: the terrain only samples that function at its
  own grid vertices 1.28 units apart and draws flat triangles between them, so
  on every rise the drawn ground sits above the curve. Interpolating bilinearly
  across the four corners fixed most of it and left smaller patches;
  `buildTerrain` splits each cell on the anti-diagonal, so the fix is to ask
  which of the two triangles the point is actually standing on.

### Driving

Handling deliberately unlike a tank. The steering is scaled by speed and falls
to nothing as the car stops, because a vehicle that turns on the spot is a
turret with wheels; reverse steers the other way for the reason it does in
life. Top speed is 12 units a second on tarmac and 5.5 off it, which is what
keeps the road worth staying on.

| | |
|---|---|
| turn radius at full lock, full speed | ~8 units |
| tightest bend on the route | ~6 units |

Those two numbers are the drive. You cannot take that corner flat out; you lift
off. The test bot in `game.spec.js` brakes for bends for exactly this reason,
and the first version of it — which held the throttle down and steered at the
destination — drove into the hills and wedged against a tree. That was the bot
being a bad driver, not the car being wrong.

**She is not drawn at the wheel.** A driving pose was written, seated, and
deleted: the sedan is a solid body with a painted-on windscreen and no cabin,
so her head came out through the roof and her left arm through the door. The
car is the thing you are driving, which is what a chase camera behind a vehicle
shows anyway.

**Nothing about the Market tab changed**, which was the explicit decision: it
sells at the same prices over the same counter, and the drive is a longer way
round to the same coins. The two cannot double up because the sale on arrival
runs the tab's own `sellAll` over the live inventory — the crates in the back
are a picture of what she set off with, not a second copy of it. A load that
never arrives costs nothing, and there is a test for that.

The market itself is built entirely from kits already vendored. The obvious
move was to pull the `mini-market` kit the mirror does have; it would have
meant a new texture atlas, a new manifest entry and a new set of colour
corrections to check, to arrive at a row of stalls this game can already build.

### What this cost

No new assets were fetched, and the draw budget is unchanged — the road is one
mesh and the roadside scenery is instanced, so the worst-case test passes at
the same ceilings it did before.

## 33. The shop moved to the market

Buying now costs a journey: upgrades and barns can only be bought while she is
standing in the market square, which she can only reach by car.

Selling did not move. Goods leave the farm exactly as they always did, over the
same counter at the same prices — §32 committed to that and this does not take
it back. The asymmetry is the point: a buyer comes to you, a shop does not.

### What is gated, and what is not

| | where |
|---|---|
| Sell Goods | the farm, as before |
| 🔧 Upgrades | **the market** |
| 🌪️ Barns | **the market** |
| Difficulty, Farmer, Sound, Save Data | anywhere — settings, not purchases |
| Animals, plots | their own tabs, untouched |

Scoped to the Market tab because that is what "buy stuff in the market" names.
Animals are bought on the Animals tab and plots on the Farm; neither moved.

### The default is open, and that is load-bearing

`marketOpen` starts **true** in script.js, and the scene sets it false on its
first frame. That direction is deliberate and it is the most important line in
the change: on any build where there is no scene to own the value — WebGL
refused, the module failed to load, a browser that cannot run it — the shop
stays open and the game stays playable. A gate whose *closed* state is also its
failure mode eventually locks somebody out of their own save.

The scene's own flag starts at `null` rather than `false` for the matching
reason. Starting it false would have matched the real state at the farm gate
and therefore pushed nothing, leaving script.js on its open-by-default and the
shop trading happily until she drove to the market and back. `null` guarantees
the first frame counts as a change.

### Three bugs, none of them in the rule

The rule itself was ten lines. Everything that went wrong was in the wiring.

- **Getting out at the market threw her home.** Her walk is clamped to the farm
  and the clamp was one box applied to every step — so parking at the market,
  which §32 shipped, left her standing twenty-seven units outside it and her
  first step snapped her back to the southern fence. This was already broken
  before this section; nothing had reported it because getting out at the
  market is the last thing anyone does, and the shop is what finally gave her a
  reason to. She now has two places she may stand, the farm and the square,
  chosen by where she *is* so there is no edge to cross.
- **The barn cards never redrew.** `renderBarns` skips a card whose signature
  is unchanged, and the signature is `status:price` — driving to the market
  changes neither, so the Build button kept whatever it was first drawn as.
  Arriving visibly did nothing.
- **Refreshing the market tab was not enough.** The barns are rendered from
  `render()`'s market branch rather than from inside `renderMarket`, so opening
  the shop refreshed the upgrades and left the barns alone.

### The tests that had to move

Two whole describes — `barns` and `upgrades` — buy things while standing at the
farm, because they are about what a purchase *costs*. They now open the shop
through the bridge first, with a comment saying why: making each of them drive
sixty metres would be slower, flakier, and would test the road over and over
instead of the pricing rule it came to check. Where a purchase can be made has
its own describe, with the drive in it.

That helper has to **wait for the scene's first frame** before overriding.
Setting it earlier is silently undone by that frame, which is what happened,
and which read as a Build button greyed out for no reason. `atMarket()` answers
null until the scene has reported, so the wait is for that frame specifically
rather than for a guessed delay.

### The fence inside the boundary

The square's walk clamp is half a unit *inside* the radius the shop is tested
at, and that half unit is a fix rather than a margin of taste.

Equal was the first version, and a clamp to a radius puts her exactly on the
circle. The distance back came out **10.000000000000002** — two ulp over — and
`<= MARKET_RADIUS` is false for that number, so walking to the edge of the
square closed the shop while she was standing in it. The answer is not a
tolerance bolted onto the comparison; it is a fence set inside the boundary, so
no float can land on the wrong side of it.

Found by a test asserting she was still inside the square after a walk, which
failed on the fifteenth decimal place. The assertion was right and the code was
wrong, which is the less common way round.

### The consequence worth stating

A hurricane that arrives while she is at the farm can no longer be answered by
buying a barn on the spot — the barn is at the market, and the round trip is
about twelve seconds of driving. That is a real difficulty change and it
follows directly from the rule as asked for, rather than being an oversight.

---

## 34. Two passes: making them look real, then making them comfortable to move

Two jobs done in order, because the second one is only worth doing once the
first has settled: detail on the farmer and the car, then the controls that
move them.

### The car was a shape, not a vehicle

The sedan was already a good model. What it was not was a car: it slid across
the ground with four welded wheels, no lamps, and a shell that stayed perfectly
level through a corner taken at twelve units a second. None of that is a
modelling problem — every part needed was already in the glTF, named, and
sitting unused.

`dressFarm` now keeps hold of five of those nodes (`body`, and the four
`wheel-*`), and `animateCar` drives them each frame:

| Part | Driven by | Number |
|---|---|---|
| Wheel spin | road speed ÷ wheel radius | `WHEEL_RADIUS = 0.3` |
| Front steer | stick, eased | `MAX_STEER = 0.42` rad |
| Body roll | lateral acceleration | `ROLL_PER_G = 0.085` |
| Body pitch | along-axis acceleration | `PITCH_PER_G = 0.05` |

The rear wheels are pointedly *not* steered. It is a detail nobody would
consciously notice and everybody would feel: four-wheel steering reads as a
shopping trolley.

The lamps are four emissive planes rather than lights, because four lights on
a moving object is a real cost on a phone and the effect wanted is the lamp
being *lit*, not the ground being lit by it. Rear lamps sit at 0.15 and go to
2.4 under brake or reverse; front lamps sit at 0 and come up to 2.2 once the
sky is past `skyNight > 0.45`, so the car turns its headlights on when the
player would.

Their positions are measured, not placed by eye: the body's local bounding box
is x ±0.75, y 0 to 1.15, z ±1.275, so the lamps go at z ±1.285 — just proud of
the bodywork. The first attempt guessed ±1.0 and buried all four inside the
shell, which renders as nothing at all and looks exactly like code that does
not work.

### The farmer, closer up

She is built from primitives (see §32 for why), and the gap between "built from
primitives" and "a person" is mostly seams. Added here: a belt band at the
torso join, a collar ring at the neck, cuffs at the elbows, soles under the
boots, and two brow chips above the eyes. Limbs went from 6-sided to 8-sided,
which at her on-screen size is the difference between a rounded arm and a
visible flat.

The brows are the cheapest thing in the list and did the most. A face with eyes
and no brows reads as blank in a way that is hard to name until it is fixed.

### Then: four things that made her uncomfortable to move

With the models settled, the controls. Four problems, found by playing rather
than by reading:

1. **The stick moved her in world directions.** Push up and she walked toward
   −Z — regardless of where the camera was, and the camera is the player's to
   orbit freely. A quarter turn of the shot and up walked her sideways; a half
   turn and up walked her toward the viewer. Nothing was broken and it was
   exactly as uncomfortable as broken would have been, because the only model
   anyone brings to a third-person view is *that way on the stick is that way
   on the screen*. Fixed by rotating the input by the camera's own yaw before
   it becomes a step. At the default shot the yaw is zero and the rotation is
   the identity, which is why every existing walk test still describes the same
   walk.

2. **She pivoted on the spot.** The heading was assigned, not turned, so a
   change of direction was a single-frame snap with the walk cycle continuing
   underneath it. Now eased — and rate-capped, which is its own story below.

3. **The walk clip ran at 2.8×.** `CLIP_WALK_SPEED` is a contract: it says how
   fast the authored clip's feet move, so the player can be moved at
   `WALK_SPEED` without the legs skating. The authored clip was a stroll and
   she moves at 4.2, so it was being played at nearly three times speed —
   frantic little legs under a body gliding along. Re-authored as an actual
   running stride (longer reach, a real shin kick, arms swinging from the
   shoulder) and the constant raised 1.5 → 2.6 to match what was drawn.

4. **The camera was locked while driving.** The chase camera took the controls
   away entirely, so a player who wanted to look at where they were going
   could not. Now the orbit stays live: a drag is honoured immediately, and
   the chase eases back in `LOOK_ASIDE_MS = 1400` after the player lets go.

### The turn that was only a turn on a fast machine

Item 2 was written as the obvious ease:

```js
facing += delta * Math.min(1, dt * TURN_EASE);   // TURN_EASE = 14
```

which is wrong, and wrong in a way that hides. `dt * 14` reaches 1 the moment a
frame takes 1/14 of a second, and this frame loop hands out **real elapsed time,
unclamped** — so at 12fps the ease evaluates to `delta * 1` and is precisely the
assignment it was written to replace. The turn was smooth on a desktop and a
snap on a phone: it degraded on exactly the hardware where a snap is most
jarring, and no amount of playing it on a fast machine would ever have shown it.

It was caught by a test, and only because the test ran somewhere slow. The
suite draws on a software rasteriser at around six frames a second; the first
version of the test watched two animation frames and asserted the turn was only
part-done, and it failed with a turn of exactly π. Exactly π is not a wobble, it
is an assignment.

The fix is a ceiling in radians per second, which does not care how the frames
fall:

```js
const cap = TURN_RATE * dt;                      // TURN_RATE = 10
const eased = delta * Math.min(1, dt * TURN_EASE);
facing += Math.max(-cap, Math.min(cap, eased));
```

Both numbers earn their place. For the bulk of a large turn the cap is smaller
and she comes round at a steady rate; inside the last ~40° the ease is smaller
and lands her softly instead of stopping dead. A half turn takes π/10 of a
second of simulated time whether that is three frames or thirty.

### Testing a rate from outside the page

Two honest attempts failed before the third worked, and the failures are the
useful part.

*Counting frames* — "she should not have finished after two animation frames" —
is false here. At six frames a second a half turn genuinely does fit in two,
and the assertion fails on a correct implementation.

*Timing it from outside* — "a half turn cannot take less than π/10 seconds" —
measured **2.7ms**. The scene's `dt` runs from its own previous step, not from
the moment the stick moved, so the first frame after the input carries a slice
of time that elapsed before the input existed. The turn really did complete
within three milliseconds of wall clock, while respecting a 10 rad/s cap in the
scene's own accounting. Both numbers are true.

What is actually being claimed is *radians per second*, and both halves have to
come from the same frame for it to be checkable at all. So the scene now
exposes `frameDt()` alongside `facing()`, and the test asserts the thing the
code promises: **no single frame turns her further than `TURN_RATE * dt`.** That
holds at six frames a second and at six hundred.

The test was then run against the old unclamped ease to confirm it fails —
a regression guard that does not fail on the regression is decoration.

### The sibling bug that turned out not to exist

Having found one per-frame constant doing damage, the obvious move is to
suspect the others. There are two: `CHASE_EASE = 0.10` on the driving camera
and `SUSPENSION_EASE = 0.12` on the car's springs, both applied per frame with
no `dt` in sight.

The arithmetic says the camera one should be ruinous. A lerp at factor α toward
a target moving at speed v settles at a lag of `v·Δt·(1−α)/α`, which at 60fps
and 12 units a second is 1.8 units and at six frames a second is **eighteen** —
the car would drive off and leave the shot behind.

Measured, the worst distance over a full-throttle run at six frames a second
was **10.8 units**, against a chase point set 8.5 back. There is no runaway,
and the reason is in how the follow is built rather than in the lerp: the
camera's position is rebuilt by `controls.update()` every frame from
`controls.target` plus the spherical offset. The target is what is following
the car, so the camera is carried along with it rigidly, and the lerp only ever
has the *offset* to correct — a bounded quantity, not an accumulating one. The
formula was being applied to the wrong thing.

So `CHASE_EASE` stays as it is, and the measurement is now a test, because the
argument that makes it safe is subtle enough to be broken by a refactor that
looks harmless.

`SUSPENSION_EASE` was a real, if small, frame-rate dependence — the same spring
settling in a fifth of a second on a desktop and a second and a half on a
phone — and is now written as `1 - (1 - ease) ** (dt * 60)`, which is the same
decay expressed in seconds instead of frames. It is cosmetic either way; it is
fixed because it was two lines and because leaving a known one in place
immediately after writing this section down would be an odd thing to do.

### A mistake worth recording

Both car tests failed for a while against code that was working. The cause was
a leftover debugging copy of the `carParts` test accessor left in the returned
object literal below the real one — and in JavaScript the later key wins
silently. The tests were reading a probe's shape (bounding boxes, a nested
`lamps` object) and finding no `brakeLamp` or `rearSteer` on it.

No error, no warning, and the failure looked exactly like broken car code. The
habit that would have caught it instantly: after any session of probing, grep
the test surface for duplicate keys before believing a failure.

---

## 35. A building with an inside, and a field with a price

Two changes asked for together, and they turn out to be the same change seen
twice: the farm had things on it that were scenery, and both of these make one
of them into somewhere you go or something you own.

### The barn had to be built, and not for the usual reason

The farmer is built from primitives because no kit in the mirror has a human
in it (§32). The barn is built for a harder reason: **no authored building can
be walked into.** Every model in `city-suburban` is an exterior — a closed
shell with a painted-on door and no volume behind it. Cutting a hole in the
south wall does not reveal a room; it reveals the back of the north wall's
outward face, lit from the wrong side, with nothing in between.

Which turns out not to matter, because an enterable building is a short list:
four walls that stop her, one gap that does not, a floor, and a roof that gets
out of the camera's way. Building it exactly is also what lets the collision
rectangles *be* the walls you can see, rather than the one bounding box a
loaded model would have given — and a door you cannot walk through is not a
door.

So the east building is now `barn.js`: red boards, white trim, a gambrel roof,
and a doorway two and a third units wide. Gambrel rather than gable because
that profile reads as "barn" against the treeline at fifty metres, which is
most of the job — from the yard this is a silhouette.

It is sized to the gap it lives in rather than to a picture of a barn. The
pasture fence ends at x 6.19 and the farm's flat ground stops at 13.4, so 6.8
across centred at 9.9 fills that strip with a hand's breadth either side.

### Seeing in

This is the part that is actually hard, and it is a camera problem rather than
a geometry one. The shot is the player's to orbit freely, so *which* wall is
between the camera and the room changes every frame and cannot be decided once
at build time.

Each shell piece carries the outward normal of the face it belongs to, so the
test is one dot product: a wall whose outward normal points back toward the
camera is one the camera is looking at the outside of, and therefore the one in
the way. Hiding exactly those — plus the roof — leaves the far walls standing,
which is what keeps the interior reading as a room rather than as a floor with
furniture on it.

**Visibility only, never collision.** The walls stay in `SOLIDS` the whole
time. Being able to stroll out through a wall you cannot see would be a worse
bug than not being able to see in, and there is a test that drives her hard at
the hidden back wall and requires her to still be indoors afterwards.

### Three things the first build got wrong

All three were caught by screenshot, and none would have been caught by
reading the code.

**The roof splayed open like a pair of shutters.** A sign. A gambrel pitch runs
from the eave *inward and upward* — on the right-hand side that is up and to
the left — so `rotation.z` wants `-side * tilt`, not `side * tilt`. (A box is
symmetric end to end, so the angle that is formally correct and the one used
here differ by exactly pi and draw the same roof.)

**Grass grew across the threshing floor.** The foliage scatter keeps clear of
`SOLIDS`, and the barn's solids are five *walls* — so the room between them is
open ground as far as the scatter is concerned. The clearing test needed the
interior rectangle added explicitly. This is the standing cost of modelling a
building as walls instead of a footprint, and it will catch the next thing that
reasons about buildings from `SOLIDS` too.

**A white rectangle hung in the air over the doorway.** The trim was parented
to the root rather than to the wall it sits on, so hiding a wall left its trim
behind. A child goes with its parent; the bands and the door surround are now
children of the boards they are painted on.

### The stores, as objects

The Market tab can already tell you that you have eleven wheat, and a tab that
tells you that is not a barn. Crops stack in crates and animal produce in
barrels — which is both what those containers are for and a way to read the two
halves of the harvest apart from the doorway.

Three to a container, six containers to a bay, so a bay fills at eighteen: a
decent wheat run reaches it and a first harvest does not. The numbers shown are
presentation and the save is the truth — nothing here rounds anything — but the
bay answers to the save, and a test sells the lot and watches it empty.

**One bug worth recording, because the cache invited it.** The stock is redrawn
only when a signature over the stores changes. The stores are readable long
before the crate models are, so the first sync ran against an empty mesh table,
recorded the signature it had drawn nothing for, and then skipped every frame
after the crates arrived. The barn stood empty with eighteen wheat in the save.
The signature is now cleared when the models land.

### Where the barn could stand, which was narrower than it looked

The east edge is the farm's flat ground at 13.4. The west edge is set by
something much less obvious, and the first placement got it wrong.

The walk-to-work queue walks a **straight line** to a plot or an animal and
finishes when it has covered the distance — it does not ask collision whether
it arrived. That is safe only while the rectangle holding the field and the
pasture is clear of anything solid, and there is a test that holds it to be,
scanning out to x 6.5. The first barn put its west wall at exactly 6.5, which
with the farmer's body radius reached 6.25 and put 806 blocked points inside
that rectangle. A job sent to the pen's east edge would have ended with her
standing against a wall believing she had arrived.

So the barn is 6.3 across rather than 6.8, centred at 10.25 rather than 9.9,
which puts the wall at 7.1 and keeps a third of a unit of daylight. The
interior lost half a unit and nothing else changed.

### Two tests that had to change, and why that is not the same as weakening them

**"Walking east stops her at the barn wall"** looked up its target by the model
id `building-type-b`. The barn is not that any more — but the market village
has one of those standing in it, so the query did not fail. It quietly measured
a building sixty metres away and asserted against it. Now it asks for the boxes
called `barn`, requires there to be five of them, and takes the westmost face.

**"No exclusion zone overlaps another"** flagged four `barn and barn` pairs, and
it was right to: the walls of a room are within half a unit of each other by
construction, and no geometry for an enclosed building can satisfy that check.
The invariant was written when every solid was a separate object, and "there is
no reason to have an overlap" was true then. There is a reason now.

Same-id pairs are exempt, and the exemption is worth being careful about,
because exempting the thing your new feature broke is how a suite stops meaning
anything. What makes it legitimate here: the concern behind the invariant —
that two resolvers' answers land inside each other and the player gets stuck —
is covered directly by the escape test next to it, which walks the whole farm
and requires every point she can stand on to be one she can get out of. That
test was **not** relaxed, it runs over the barn's inside corners, and it passes.
The overlap test is a proxy; the escape test is the property.

### The pasture is bought; the field is not

The crop field comes with the farm, because a farm game that opens with nothing
to do is not a farm game. The pasture does not. That turns "should I keep
animals at all?" into a decision with a price on it (120 coins — a little over
two plot unlocks, well under a small barn) rather than a tab that is simply
there from the first minute.

The fence is not built until it is paid for, and the ground under it stays flat
and walkable either way. An unbought pasture is a corner of the farm with
nothing on it, not a hole she falls into — making it impassable would mean a
player who wanders east before buying hits an invisible wall for reasons the
game never explained.

The gate is checked twice on purpose: the buy button is disabled *and*
`buyAnimal` refuses. The button is a courtesy to the player; the check in the
action is the rule, because a keyboard, a stale render or a queued walk can all
reach the action without passing through a button drawn a moment ago. The
button also says **"needs a pasture"** rather than showing a price — a greyed
-out control displaying a sum the player can plainly afford is a bug report
waiting to be filed.

### The migration that matters

`pasture` is a new field, so **every save in the wild is missing it, and a
missing boolean reads as false.** Shipped naively, that takes the pen away from
somebody mid-game and leaves their herd standing in a field they no longer own.
Nothing else in the save would be wrong; the cows would simply have nowhere to
be.

So: anybody whose save shows animals already has a pasture. Anybody with none
starts without one and buys it, which is the point of the change. Both
directions have a test, because this is the kind of rule that is easy to write
and easy to get backwards.

---

## 36. Two lanes, and somewhere to want

The farm has always had two endings — a country house at twenty thousand and a
grand villa at forty — and until now they were cards. You saved for years and
bought one sight unseen. This gives each of them a road, a place at the end of
it, and a rule: you cannot buy a house you have never been to see.

### Three roads where there was one

The road was a single Catmull-Rom curve with a module-level `roadSamples`
array, and every question about tarmac went through it. It is now a list of
routes built by one `makeRoute`, and the interesting part is which callers
wanted which question:

| Question | Answers from |
|---|---|
| Is there tarmac here? (grip, foliage) | **any** route |
| How far along the errand am I? | the **market** route only |

That split is not tidiness. `nearestOnRoad` returns an `along` that the car's
steering reads, and a car sitting on a T-junction is within a few centimetres
of two routes at once — so a "nearest of the three" answer would have handed
the steering an `along` belonging to whichever branch won by a hair, and swung
it onto the wrong lane at the junction. The market route keeps its own
function; `nearestOnAnyRoad` is the new one, and only the surface questions
use it.

Both lanes start on a waypoint the market road already passes through, so they
meet it as T-junctions and the whole network is drivable from the pull-in. A
branch that starts anywhere else is a ribbon lying in a field.

### Where the buildings could go, measured twice

Both placements were wrong first time, both in the same way, and the way is
worth stating because it will happen again: **a kit building's collision box is
much bigger than it looks.**

The villa is `building-type-b` at 7.5 units tall. Measured, its box is **13.5
across by 10.2 deep** — roughly twice what the eye gives it from the road. The
cottage lane's last few metres ran *inside* the cottage's box, so the car would
have hit a wall at the end of its own drive, and the villa's fountain was first
placed where the house's box already was.

The fix in both cases was the same: measure the box, then decide. The cottage
moved back and its lane stops short; the villa's lane was shortened to open a
five-unit forecourt, and the fountain sits in it.

### The fountain, and a claim I had to withdraw

No kit in the mirror has a fountain, and the villa's card has promised one
since long before there was anywhere to stand and look for it — so it is built:
a basin, a plinth, an upper bowl, water in both.

The first version's comment said the water used the pond's own shader, "so it
ripples on the same clock". **It did not, and it should not.** The pond's
material is a `ShaderMaterial` whose uniforms are bound to that mesh's own
radial geometry and centre; reusing it here would mean a second set of uniforms
and a second centre to keep in step, for ripples on a disc two and a half
metres across seen from the far side of a turning circle. It is a plain
standard material, the comment now says so, and the trade is recorded rather
than left looking like the pond shader failing to reach it.

Two other things the first fountain got wrong, both caught by screenshot:
it had **no collider**, so the car parked inside the basin and out the other
side; and its upper bowl was half the width of the basin on a short plinth,
which from the drive read as a parasol.

### The rule: nobody buys a house sight unseen

This is what makes the lanes part of the game rather than scenery you may
optionally drive down.

Each dream card gains a viewing state. Unseen, it carries the directions to the
place and its button reads **"🚗 Drive out and see it first"**, disabled. Seen,
it carries a line about what she found there and the ordinary buy button
returns. Driving the car inside the site's radius is what records it.

The button is deliberately not a greyed-out "Buy the Grand Villa" beside a
price the player has just earned — that reads as a bug, and they would be right
to think so. It says what is actually in the way.

Checked twice, as every gate in this codebase is: the button is a courtesy
drawn from a render that may be stale, and the refusal inside `buyDreamHome` is
the rule. This one earns the belt and braces more than most — it is the
purchase that ends the run, and it is irreversible.

### No amnesty, and why that is not inconsistent

`seenHomes` is a new save field, and unlike the pasture in §35 there is **no
migration granting it to existing saves**. The difference is what is at stake.

The pasture migration exists because shipping it naively would have *taken
something away* — a herd left standing in a field its owner no longer owned.
This takes nothing away. Both properties are still for sale at the same prices;
what is new is a drive, to a place that did not exist before, ending at a
building that did not exist before. Asking a player who was about to buy to go
and look at it first **is the feature**, not a regression of it.

### One thing the tests had to learn

The walk helper in the new tests rotates its world direction into camera space
before it touches the stick, and nothing else in the suite does. That is
because §34 made the stick camera-relative, and this is the only walk in the
file that happens *after a drive* — which leaves the camera swung round behind
the car rather than at its default yaw of zero. Fed a raw world direction, she
sets off at whatever angle the shot happens to be at. The older helpers are
correct only because the camera has not moved when they run.

---

## 37. The city, and one shop becoming two

The farm's shop sold everything: your harvest went over the same counter the
sprinklers came back across, and both were in the market village. That is one
shop with two jobs, and the drive to it meant the same thing whichever you
were doing. Now there are two places, and they sell different things.

| | Where | Sells |
|---|---|---|
| **Market village** | south, 64 units of road | farming goods — it buys the harvest, it sells barns |
| **The city** | north, about 75 units | tools and chemicals — every productivity upgrade |

### One gate function, called twice

`syncShop` used to ask one question. It asks the same question of two places
now, and the check is written once and called twice rather than copied:

```js
function atPlace(place, radius) {
  const carThere = ...;
  const sheIsThere = inCar || ...;
  return carThere && sheIsThere;
}
```

Two copies would have drifted, and the way that failure shows up is a player
standing in a square wondering why the buttons are grey. `cityOpen` starts
`null` in the scene and `true` in the page for exactly the reasons `shopOpen`
and `marketOpen` do — see §33; the argument is unchanged and now load-bearing
in two places.

### Making it read as a city, with two building models

The market hamlet and the city are built from the same two suburban blocks,
and the first draft of the city was the same composition at a different
address: four buildings, two stalls, some crates. It read as another village.

Three things changed that, and only one of them is masonry.

**Height.** Everything in town is 6.2 to 7.0 against the market's 4.8 and 5.4,
so the smallest building in the city is taller than the farmhouse.

**A cross street.** This is the one that did the work, and it is the cheapest
thing in the section: a second ribbon through the square, built with the same
machinery as the roads out. Buildings around a crossroads read as a place with
a plan; the same buildings with one road past them read as a hamlet. Standing
in the street with buildings crowding both sides is the first view of the city
that actually looked like one.

**Fewer buildings than the draft wanted.** Seven became four, and the reason
is measurement. These blocks are much larger than they look — type-b at 7
units tall measures 11 by 7, type-a at 6.6 measures 8 by 10 — so seven of them
on a ring either overlapped each other or ran off the edge of the terrain, and
the road went straight through one. Four well-spaced buildings with the stalls
filling the square between them reads as a town; seven overlapping ones read
as a bug.

### The pines in the square

The hillside fringe scatters trees up to thirteen units past the farm, which
reaches z −28. The city starts at −22. So the first build sowed pines between
the buildings and turned the town straight back into a village with taller
houses — caught by looking at it, and fixed by adding the city's radius to the
clearing test the barn floor already uses.

Worth noting which places needed this and which did not: the market and both
properties sit outside the fringe's own bounds and need no such line. The city
is the only one inside them. A blanket "no trees near any destination" rule
would have been three-quarters dead code.

### Two new things to buy, and why they hook into old numbers

The city could have been the upgrades tab at a new address. Two new items make
it a place worth the drive, and both were chosen because the game already had
the number they change:

- **🚜 Tractor** — 15% a level off the time it takes to cross the farm. This
  turned `WALK_SPEED` from a constant into `walkSpeed()`, read fresh every
  step so buying one in town makes the walk home different. Both the movement
  *and the walk cycle's playback rate* read it — those two agreeing is what
  keeps her feet planted, and a tractor that sped up one and not the other
  would look worse than no tractor at all.
- **🧴 Pesticide** — 25% a level onto the window a ripe crop has before it
  spoils, multiplied into `cropSpoilMs()` alongside the difficulty's own
  factor. Multiplicative because a chemical that helped more on Relaxed than
  on Hard would be an odd thing to sell.

No save migration was needed and none was written: the upgrade sanitiser walks
`UPGRADE_ORDER`, so a key an old save has never heard of defaults to zero on
its own. There is a test holding that true rather than fixing anything. The
*default state* did need a change — it listed the four upgrade keys by hand,
which would have left the two new ones undefined, so it is derived from
`UPGRADE_ORDER` now.

### Three tests that had to move rather than bend

The upgrades were the market's, so the market's describe tested them. They are
the city's now, and the tests followed the subject rather than being relaxed
where they stood:

- The `upgrades` describe opens the **City** tab and a new `openCity` helper,
  the exact mirror of `openShop`.
- *"Nothing can be bought from the farm"* was about upgrades in a describe
  called "the shop is at the market". It now tests the barn — the thing the
  market still sells — and the upgrades' version of the same rule lives in
  the city's describe.
- *"Driving there opens the shop"* bought a sprinkler to prove the counter had
  opened. It buys a barn now, for the same reason.

### Five more tests the city broke, and what each was really saying

None was relaxed; each was repaired by correcting a fact that had changed.

**The reset test listed four upgrades.** `expect(s.upgrades).toEqual({...})`
on a new farm. It now lists six, and listing them is the right shape: adding
a seventh should fail this until somebody confirms a new farm really does
start without it. That is precisely what it did here.

**The "adrift" check needed the city.** Same repair as the two properties in
§36, for the same reason: the invariant is "everything is somewhere", and a
new somewhere is named rather than excused.

**The solid-overlap check found three real clashes** among the city's own
props — two stalls clipping the buildings behind them and the two eastern
blocks 0.45 apart against a 0.5 margin. The square is four and a half units
between the street and the buildings, and a stall is three across needing
half a unit off masonry and two and a half off tarmac. The street moved north
to make the room rather than the stalls being squeezed into a gap that was
not there.

**"Driving there opens the shop" failed twice, for two different reasons that
looked identical.** It used to buy a sprinkler; retargeted to a barn, the
button was disabled — because the describe's fixture has 9,000 coins and a
small barn is 10,000. *A button disabled for the price reads exactly like a
button disabled for the distance*, which is the thing the test exists to
check. Then, with money, the click did nothing: buying a barn asks for
confirmation and an unhandled dialog is dismissed. An upgrade never asked.

**The sun-and-moon test started timing out**, and it is not broken: sixteen
seconds alone against a thirty-second budget, over the line once the rest of
the suite is competing. The city's props made every scene load a little
heavier and this was the test with the least headroom. Marked slow, like the
three before it. Worth saying plainly: that is now five tests carried by
`test.slow()`, and the next feature to add props should expect to find a
sixth rather than treat it as a surprise.

### A locator that became ambiguous

`getByRole('button', { name: /Market/ })` had been the way to click the Market
tab all through the suite. The City tab's list contains a **Market Contacts**
upgrade, so that query matches two elements the moment the City tab has been
rendered once — which only happens in the tests that visit both. Those use
`.tab-btn[data-tab="market"]`. The rest are untouched and safe, because
`#upgradeList` is empty until the City tab is opened.

### A claim measured after being asserted

The first version of the road test said the city lane should be longer than
the market road, and it is not: 59 units against 64. The lane *branches off*
the market road a third of the way along, so the journey is the sum — about
75 — and comparing the branch to the whole road says the opposite of the
truth. The test computes the junction's position along the market road and
adds. The code comment had guessed "forty-odd units" and was corrected to the
measured figures at the same time.

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
- `InstancedMesh.computeBoundingSphere()` was confirmed to exist on this
  build's vendored three.js — not assumed present from a version number —
  by constructing one in the running page and checking the method directly,
  before any code was written to depend on it.
- The multi-primitive transform risk in step 8's foliage (a tree's trunk and
  canopy each needing their own `InstancedMesh`, and so a fresh random
  rotation per primitive instead of per point would have drawn them coming
  apart) was caught by reading the code while writing it, before it was ever
  run broken — there is no before-screenshot of a farm full of split trees,
  because the fix went in ahead of the first render. What was checked by
  screenshot afterward is that the fringe renders correctly at all, not that
  a bug it never shipped with used to be visible.
- Every claim in §17 about how the pond looks is a render, not an intention.
  The sunk bowl being invisible behind the terrain sheet, the farmhouse
  covering the north-west site, the dusk banding, the night glow and the
  missing glint were each found by looking at a screenshot of the thing, at
  midday, dusk and midnight, with `state.dayElapsedMs` pinned before each
  shutter. Every one of them was a design that read fine in the code.
- The pond's neighbours — the path spine, the branch out to the pasture gate,
  her spawn point, and each prop within reach of the water — were checked as
  arithmetic against the pond's own edge function, not judged from the
  screenshot, because a prop half in the water at one camera angle is out of
  frame at another.
- The step 8 CI failure was checked against a clean pre-step-8 tree before it
  was attributed to step 8 — the same failure there ruled step 8 out as the
  cause before any fix was written. The fix was then measured, not assumed
  effective: the targeted pair at 2 of 12, then 12 of 12; the full suite at
  4-worker contention before and after, not just after.
- Every Cube Pets model's material structure — one shared "colormap" per
  model, not one per mesh — was read out of the glTF JSON directly rather
  than assumed from how the kit's other models (props, the terrain) happened
  to be authored, before the per-instance cloning in §18 was written to rely
  on it.
- The `animalIntent` bug in §18 was traced to the exact commit that
  introduced it with `git log -S` against the offending line, rather than
  assumed to belong to whichever step happened to be shipping when it was
  found — it predates step 10 by four steps, and the record above says so.
- The animal-roaming tests were not trusted at their first green run. Each
  new test in §18 was repeated 8-12 times, at the default two workers, before
  being called reliable — which is what caught both the moving-target chase
  overshooting its target and the Node-side round-trip gap that occasionally
  let a still-roaming cow drift back out of reach between one check and the
  next, neither of which showed up on a single pass.
- `fantasy-town/stall` and `stall-green` were both fetched and their glTF
  JSON read for a real bounding box before either was judged — `stall` at
  0.365 units tall is table-height, not a stall, and `stall-green` at 1.24
  units is — rather than assuming a plausible-sounding filename meant a
  complete model the way `windmill` turned out not to.
- §19's own crop-stage test found a real timing bug in itself before it ever
  reached this document: fixtures written with secondsAgo, resolved at page
  boot, put wheat's 5.25-second seedling window up against this sandbox's
  own page-load and asset-fetch overhead, and lost a plot to the next stage
  over on the very first run. Fixed by writing state.plots directly, in the
  page's own clock, immediately before each check, rather than by widening
  the margin and hoping — confirmed with five repeats, not one green run.

- Step 12 changed nothing until the thing it was sent to fix had been
  measured: the tile face drawn in the sky is a screenshot, the twenty-one
  focusable controls are a count off the live page, and the 2.87 units of
  walking under a held arrow with a plot button focused is a reading, not an
  estimate. The same probe re-run afterwards is what says they are fixed —
  0.000 units, one Tab into the grid and one Tab out of it.
- The selection marker's two dead ends in §20 were established the same way,
  and the second one only by drawing it in hot magenta at full opacity: a
  flat marker that could not be seen might have been a marker that was never
  drawn, and those two have entirely different fixes. It was being drawn.

- §5's "seasons come free" claim was checked against the pinned Kenney
  mirror before step 13 built anything on it, not after: every candidate
  tree variant URL was fetched directly, which is what found the pines
  shipping neither `_dark` nor `_fall` nor `_snow` while `tree_default` and
  `tree_detailed` shipped both of the first two. The orchard's scope in §21
  follows from that fetch, not from the table it corrects.
- Screenshots at midday, for spring, summer, autumn, winter, and a storm two
  days out, with `state.day` set directly and `state.dayElapsedMs` pinned
  before each shutter — the same discipline every earlier lighting claim in
  this document was held to. Autumn showed the orchard's two species in
  fall colour against the still-green pine fringe; winter showed the ground
  and pond bank pass genuinely white and the grass tufts gone; the storm
  shot showed visible falling streaks over a sky perceptibly greyer than
  the same day without one.
- The rain system's `computeBoundingSphere` call was reasoned through
  rather than left to chance: every seeded drop's x and z are fixed for the
  life of the page and only y moves, wrapped inside a known range, so a
  sphere computed once from the initial scatter — before any drop has ever
  fallen — already bounds everywhere a drop can ever be. The alternative,
  recomputing it every frame the way §16's moving parts sometimes must, was
  checked and found unnecessary rather than assumed unnecessary.
- The first pass at testing the season/orchard/grass hooks was itself wrong,
  and caught before being trusted: polling `season()` — a live, un-lagged
  read of script.js's own calendar — and then asserting `orchardAutumn()`
  or `grassShowing()` with a plain read right after looked reasonable and
  flaked under four-worker contention, because the thing worth waiting for
  was the 3D scene's own next animation frame, not the calendar. Fixed by
  polling the lagged, rAF-driven value directly; confirmed with five
  repeated runs at four workers, 20 of 20, after the fix.
- The day-label touch-target regression above was pinned to step 13, not
  assumed to be it, by running the failing test against a `git stash`ed
  clean pre-step-13 tree first — it passed there — before writing the fix.
  The full suite was then run twice more in full: once at 268 tests to
  confirm the fix with nothing else broken, matching 264 from step 12 plus
  the four new season/weather tests exactly.

- Step 14 measured before it changed anything, and measured again to check
  that what it changed did what it claimed. The saving was predicted from
  the vendored `.glb` files' own accessor counts — 1,924 triangles across 19
  primitives per crop-stage set, times sixteen instances — and the frame
  afterwards gave back exactly 30,784 triangles and exactly 19 calls. Two
  independent instruments were used and cross-checked against each other
  before either was believed: GL context prototypes patched from outside the
  page, and `renderer.info` from inside it. They agree exactly.
- The one thing step 14 could not verify, it says so about rather than
  claiming: **this sandbox has no GPU**, so "holds 30fps on a phone" is
  untested. Every frame time measurable here is swiftshader's. The
  hardware-path *counts* were obtained by spoofing the renderer string the
  scene itself reads, which is honest about being a configuration change
  rather than a hardware one — the timings under it are meaningless and are
  not quoted.
- Texture compression was declined against a measurement rather than a
  feeling: 76 KB of PNG across the entire game, against a transcoder several
  times that size.
- Step 14's own four-worker failures were checked against a clean
  pre-step-14 tree before any of them were called flakes — the same
  discipline step 8 used on the walk-timing bug and step 13 used on the
  touch-target regression, and the same discipline that would have caught
  the opposite answer had the clean tree come back green.

- Step 15 did not take the plan's word for the playtest bot being stale, nor
  its own reading of the CSS for the bot being broken: it ran the bot, and
  the zeroes in every column of its own summary line are the evidence. The
  fix was then confirmed the same way — the same command, the same three
  tiers, harvests and earnings in every row — rather than by arguing from
  the diff. Both halves of the new liveness check were exercised too: it
  fires against the broken bot and stays quiet against the fixed one, which
  is the only way to know a watchdog is wired to anything.
- The step 15 flake fix was measured at every stage rather than declared:
  the failure rate at four workers went 4-in-12, then 2-in-12, then 0-in-36
  across three runs, with each of the three faults fixed in turn. The
  pre-fix number was taken by stashing the fix and re-running the same
  command, not remembered from earlier. Both worker counts were checked,
  because the one that matters is the one CI uses and the one that shows
  the bug is not it.
- That flake was also, honestly, known and left: it had been failing on a
  clean tree since step 13 and was written off as contention at the time.
  It is recorded here as debt that came due rather than as a discovery.

- Step 16 checked the README's claims against the code rather than reading
  them for plausibility, which is the only reason the four stale ones were
  found — the tap mechanic, the harvest instruction, the focus ring and the
  phone column counts. The last of those looked entirely reasonable and was
  simply false: `.plots-grid` is `repeat(4, 1fr)` with no landscape override,
  read out of the stylesheet before a word was changed.
- The day-badge fix was chosen between two working versions by screenshot at
  360px, not by argument, and the losing one is recorded above with why. The
  touch-target test was re-run after it, because the last change to that
  badge's width is what broke the 44px floor in §21.
- "Pages deployed" is stated as what was actually verified — the deployment
  workflow ran and succeeded on every push — and explicitly not as "the live
  page was loaded", which this sandbox's egress policy makes impossible.
- The post-ship bug hunt's seven false positives were each individually
  disproved rather than waved off as "probably the test" — every one was
  re-run clean after fixing the actual script bug, with the fix identified
  from reading the game's own code (units, dialog handling, the walk-to-work
  queue) rather than from pattern-matching against earlier flakes.
- The two real flakes were pinned to pre-existing code, not claimed to be,
  by running the identical repeat count against the step-12 tree and finding
  comparable failure rates on both. The `driveUntilReachable` diagnosis in
  particular was reached by instrumenting the actual failure (reach, prompt
  text, frame tier, budget EMA) rather than by reasoning from the code alone
  — the first theory tried (a stale prompt-label cache) did not match what
  the numbers showed once captured, and was dropped for one that did.
- The road and car kits in §26 were found by probing the pinned mirror with
  real HTTP requests before either was written into `tools/vendor.mjs`, the
  same discipline §5 and §13 already established for this project — a
  plausible-sounding kit name (`city-suburban`, `fantasy-town`) was checked
  and ruled out before the one that actually exists was. The car's rotation
  is a screenshot decision, not a guess written down as if it were one: six
  candidates rendered, compared, and the losing five discarded.
- §27's scale complaint was measured before anything was changed in response
  to it, by loading each model through `assets.js` in a real page and reading
  its `Box3` — which is how "the farmer is much larger than the house" turned
  into "the farmhouse is 1.6 times her, and the constraint that made it so is
  written down three sections up".
- The trunk radius the collider uses is sampled from each tree's own geometry
  rather than picked to look right: the vertices below knee height were walked
  and their maximum distance from the centre line taken.
- The farmhouse's orientation was *not* changed, and that is a checked result
  rather than an oversight. All four quarter-turns were rendered side by side,
  and then the shipped one from due east, which showed the door already facing
  the field — what reads as a blank wall in the follow-camera shot is the
  raking angle plus the farmer standing in front of the door.
- Both §27 collider bugs were reproduced and instrumented before being fixed:
  the ejection through the barn's back wall was read off the failing
  assertion's own numbers, and the farmer pinned to a trunk was reproduced
  four times in a row locally with her position sampled every 250ms, which is
  what showed her stationary to the centimetre rather than merely slow.
- The three §27 draw-cost figures are three separate measured runs, not one
  measurement and two extrapolations. The full-density and full-quality rows
  were taken by forcing `rendererIsSoftware()` and the frame budget's
  step-down off in a local copy — triangle and call counts do not depend on
  the rasteriser, only on what is submitted, which is what makes a software
  box a valid place to measure them.
- The new driving failures that appeared alongside §27's work were checked
  against the untouched tree at the same contention (4 workers, 3 repeats)
  before being attributed: the baseline fails the same two tests with the
  same "nothing came into reach" error at the same rate, so they are the
  pre-existing flakiness recorded above and not this pass's doing.

- §28's three material defects were each read out of the glTF JSON before
  anything was changed in response to them — `metallicFactor`, the
  `baseColorFactor` values against their own material names, and
  `KHR_materials_unlit` in `extensionsUsed`. The metalness fix was then
  confirmed by rendering the same models at 1 and at 0 side by side, which
  is also how the first attempt at that probe was caught being worthless:
  `Object3D.clone()` shares materials, so all three columns had quietly
  shown the same state.
- The sky blowout was isolated by elimination rather than guessed at:
  bloom off, SSAO off, gamma pass off and the composer bypassed entirely,
  four runs, sampling the same pixel each time. Only bypassing the composer
  fixed it, which is what pointed at the render-target rule rather than at
  any one pass. Both the before and after figures in §28's table are
  measured pixels, not impressions.
- §28's wind is verified as actual movement: day phase pinned, wind forced
  to 0 and then to 9, 37.4% of the pixels in a foliage-only band changed.
  The band excludes the pond on purpose — its shader animates on its own
  clock and a whole-frame diff would have "passed" with the wind disabled.
- §28's three draw-cost rows are three measured runs on the same worst-case
  save, and the two cost findings behind them (the doubled shadow pass, the
  grass casting) were each isolated by disabling one thing at a time and
  re-measuring, not by reasoning about which ought to be expensive.
- The claim that the graphics pass left the direct path's sky alone is a
  pixel comparison against a pre-change screenshot, not an assumption from
  the shape of the change: (210, 222, 227) before, (219, 228, 233) after.

- §29's phone measurements are element bounding boxes read from a real
  layout at three viewport profiles, before and after, not estimates from
  the CSS. The footer being what blocked the fill was found the same way —
  by printing every child of `#app` with its height — after the fill was in
  place and the scene stubbornly refused to grow.
- §29's stuck spot was found by sweeping the walkable farm and asking which
  points are inside two exclusions at once, not by trying to reproduce "every
  now and then" by hand. The 249 points and their extent are what that sweep
  printed.
- The walk-to-work queue was cleared by measurement rather than by argument:
  40 errands from random positions, none of which failed to drain.
- One probe here is reported as inconclusive rather than dressed up: an
  attempt to demonstrate the wedge dynamically, by walking her into the seam
  on the pre-fix build, hung instead of returning. That is consistent with
  her being unable to move — the probe's inner wait had no deadline — but it
  was not instrumented to distinguish "wedged" from "very slow", so it
  proves nothing on its own. The static sweep is the evidence.

- §30's list of what was still wrong was written from the previous pass's own
  screenshots before anything was changed in response to it, and two of its
  six items are recorded above as deliberately not done rather than quietly
  dropped.
- §30's first cloud implementation was invisible in the game and looked
  correct in the screenshot taken to check it, because that screenshot had
  the camera orbited skyward. The default camera's top-of-frame elevation was
  then worked out from CAM_HEIGHT, CAM_BACK, CAM_LOOK_Y and the fov — about
  six degrees — which is what identified the projection as the fault rather
  than the tuning.
- The night-cloud brightness figures are the 99th percentile of the whole sky
  band, not one pixel, because the clouds drift and one pixel compared across
  two renders is comparing two different parts of the sky. That the first
  comparisons were per-pixel is why they came out incoherent — brightness
  appearing to *rise* when the shader's dark end was lowered.
- Bloom was identified as the amplifier by rendering the identical shader on
  the un-post-processed software path: 72 there against 113 through the FULL
  tier. The night tuning is against the post-bloom number, which is the one a
  player sees.
- §30's "86% of the pond is at full depth" is counted on the water surface's
  own vertices through the bank profile, and agrees with the area figure the
  radii give independently. It is in this list because the first draft of that
  sentence said 96% across the last 4% of the radius, which was eyeballed off
  a ring count rather than computed — the real numbers are 86% and 7%. The
  shallow fraction after the reshape is asserted by a test, so the shape
  cannot go flat again without something failing.
- The claim that every kit material is matte is the `pbrMetallicRoughness` of
  every material in every `.glb` the game loads, dumped from the glTF JSON.
  The finish table written from that dump was then checked by a test that
  enumerates the live scene instead of reading the table back — which found a
  material the hand-written table had missed.
- The CI timeout above was diagnosed from the workflow file and the two runs'
  timestamps, not assumed from "CI went red": the conclusion was `cancelled`
  rather than `failure`, the cancel landed exactly on the `timeout-minutes`
  boundary, and the previous run's own 19 minutes is what showed the budget
  was already spent before this pass touched it.
- One measurement in this pass was thrown out after being made: the pond was
  twice judged by eye to be glowing at night and at dusk, and twice the
  sampled pixels said otherwise — 37 against grass at 27 on the *pre-change*
  build. It is a contrast illusion in a dark frame and it is pre-existing, so
  nothing was changed for it.

- §31 was diagnosed from the reporter's screenshot before any code was read:
  the blank area is `.farm-scene`'s CSS gradient exactly, and the controls
  still drawn on top of it are DOM siblings of the canvas rather than pixels
  in it. The browser's own notice in the same screenshot — Edge saying it had
  removed page content to save storage — named the cause.
- The reproduction is the real event via `WEBGL_lose_context`, not a
  simulation of the theory: draw calls 154 to 0, the canvas screenshot
  matching the reporter's, and the farmer still walking from z 2.44 to −1.41
  while nothing was drawn. That last number is what proved the game was
  invisible rather than hung.
- That three.js recovers completely on restore was measured, not assumed:
  123 draw calls and 74,284 triangles on both sides of a lose/restore cycle.
  The claim in §31 that the two remaining gaps are "saying anything" and "a
  restore that never comes" rests on that — the renderer's own half is fine.
- One early suspicion was dropped after measuring: the pond looked black in
  the first restored screenshot, which read as damage. Sampling the same
  pixel with the day phase pinned gave (19, 51, 70) before and (19, 49, 67)
  after. The first screenshot was simply taken at a later hour.
- The `[hidden]` bug in §31 was found by screenshotting the restore. Three
  separate readings of `el.hidden` said `true` while the panel was on screen,
  so no amount of asking the DOM would have caught it. The test that guards
  it now asks the layout.
- The CI failure that arrived with §31 was checked against the previous commit
  before being attributed to anything: 8 failures in 12 there against 5 in 12
  on the new build, at the same `--workers=4`. Pre-existing, and worse without
  the change than with it. The separate defect the investigation did turn up —
  the prompt going unsynced during an outage — was fixed on its own merits
  rather than being allowed to stand in as the explanation.
- Three versions of the restore test's "is the scene loaded yet" helper are
  recorded in that test's own comment rather than quietly replaced. Two of
  them watched the draw-call count go quiet and both returned early — 119,
  then 121, for a scene that settles at 123 — because a pause between two
  models arriving looks exactly like the end of loading. The helper now
  awaits the scene's three readiness promises, and the comparison is an
  inequality pointing the way real damage would move it.

- §32's claim that no kit in the mirror has a human-proportioned character is
  a probe of the mirror, not an impression of it: `mini-characters` was found
  by probing, downloaded, and rejected on measurements — 1.10 wide against
  0.78 tall in its own bind pose, with the glTF's weights, joint indices and
  attribute sets all checked as valid first. A dozen other plausible kit names
  were probed; the ones that exist (`mini-market`, `food`, `castle` and the
  rest) have no characters in them.
- The farmer's proportions were fixed against printed world extents rather
  than against the screen. That is how the boots were found 8.6cm under the
  field — the grass hid it in every screenshot, and the total height being
  1.665 instead of 1.6 was the only visible symptom.
- §32's road bugs were each fixed at the cause rather than papered over: the
  black patches by deriving normals from the terrain gradient instead of from
  triangle winding, and the grass-through-tarmac by interpolating on the
  terrain's actual triangle. Raising the road's clearance would have hidden
  both and was not done.
- The drive was measured end to end before it was called working: 63.6 units
  of road, twelve units a second on tarmac, arriving in about six seconds, and
  the inventory emptied into coins on arrival.
- One suspicious number was chased and found innocent: the test fixture's
  coins read 1100 against a save that says 900. Checked against the previous
  commit with this work stashed — same 1100, same two achievements unlocking
  on load. Pre-existing achievement rewards, nothing to do with this pass.
- The market's collision boxes were spaced by measuring them, after the
  overlap test rejected a layout placed by eye: `building-type-a`'s footprint
  is 8 by 9 units, about twice what it was guessed at.
- Three existing tests had to be restated for §32, and each is recorded rather
  than quietly widened. The orchard's height ratio was calibrated against a
  shorter farmer (above). The foliage species list grew because the roadside
  scatter uses the same instancer, so a new ordering assertion was added with
  it rather than the list merely being extended. And the check that the farmer
  is not perfectly matte was asserted through `texture-a`, a kit texture that
  no longer exists now she is built here — it is asked of every material she
  is made of instead, which is a stronger form of the same claim.
- One process mistake, recorded because it produced numbers that were nearly
  believed: a targeted test run was started while the full suite was already
  running in the background, and both were read as results. They were
  contending for four cores and neither meant anything. Both were discarded
  and a single clean run taken.

- §33's three wiring bugs were each found by printing the live state rather
  than by reading the code: the shop reported open while its buttons rendered
  shut, which is what pointed at the render-skip signature; and `marketOpen`
  read true in the page while the barn card still said otherwise, which is
  what separated "the value is wrong" from "the value never reached the DOM".
- §33's boundary bug is in this list rather than in the section alone because
  it is the kind that reads as test flake and is not: a walk to the edge of
  the market square really did shut the shop with her standing in it, and the
  only symptom was an assertion failing by two parts in a quadrillion.
- One test in §33 was fixed rather than its subject: "leaving shuts it again"
  reversed for a fixed four seconds and failed one run in three, because how
  long it takes to back out of the square depends on what is in the way. It
  waits for her to be out instead.
- The open-by-default is asserted by argument rather than by test, and that is
  said plainly here because it is the one claim in §33 without one: a build
  with no scene at all is not something this suite can stand up. What is
  tested is that the value only ever changes through the bridge, which is the
  property the argument rests on.

- §34's lamp positions are the car body's measured local bounding box (x ±0.75,
  y 0–1.15, z ±1.275), printed from the loaded geometry. The first placement
  was estimated and put all four lamps inside the shell.
- §34's turning defect was found by a test failing, not by playing: the ease
  looks and feels correct at 60fps and is an assignment below 14fps, and this
  machine is slow enough to show it. The value that gave it away was a turn of
  exactly π.
- The rate cap's test was run against the code it replaced and confirmed to
  fail there. A regression test that passes on the regression proves nothing,
  and the only way to know which kind you have written is to try it.
- §34's camera-relative walk was confirmed by driving the stick at two
  different camera yaws and comparing where she went: at yaw 0 she walked
  dz −4.13, and at yaw −158° the same push sent her dx 1.37, dz 3.9 — a
  different world direction, the same screen direction.
- The two failed approaches to testing the turn are written up in §34 rather
  than quietly deleted, because each produced a confident number that was
  true and useless: a turn of exactly π, and a half turn measured at 2.7ms.
- The chase camera's supposed eighteen-unit lag is in §34 as a **non**-result.
  The arithmetic was sound and the conclusion was wrong, because it was
  applied to a lerp that corrects an offset rather than one that chases a
  position. Measured worst case: 10.8 units against a target of 8.5. Had it
  been "fixed" on the strength of the formula, the change would have been
  written up here as an improvement and nobody would have been the wiser.
- Two tests in §34 time out on the default thirty seconds when the rest of the
  suite is running beside them, and pass in nineteen and twenty-six seconds
  alone. They are marked slow rather than trimmed: the time is in loading the
  scene and driving sixty metres, not in anything that could be asserted less
  carefully.
- A third — the turn test — was marked slow *and* fixed, because its cost was
  waste rather than work. It sampled until it had collected six frames of
  movement or run forty frames, and she finishes the turn in two or three:
  the remaining thirty-odd frames were spent watching a heading that had
  stopped changing. It now stops when she arrives, and went from 17.4s to
  4.1s. This shipped and failed CI, having passed locally every time — the
  waste fitted inside the budget on this machine and did not on the runner.
  The tell was in the timing all along: seventeen seconds is an absurd price
  for one half-turn, and a green suite is not a reason to stop reading the
  numbers beside the ticks. Rewriting the loop also meant the earlier
  "confirmed it fails on the old code" no longer covered the test that
  shipped, so that check was run again against the rewrite.

- §35's three defects were each caught by a screenshot and none by reading
  the code: a roof splayed open by a sign error, grass growing across the
  barn floor, and a white trim rectangle hanging in the air with its wall
  hidden. The pattern is worth naming — geometry built from numbers is
  exactly the kind of code that reads correctly and draws wrongly.
- §35's crate cache bug was found by looking at the barn with eighteen wheat
  in the save and seeing nothing in it, not by suspecting the signature. The
  fix is one line; the lesson is that a render-skip cache keyed on data that
  is ready before the meshes are will always skip the first real draw.
- The pasture migration is asserted in both directions — a pre-existing save
  with a herd keeps its pen, one without animals does not get a free one.
  One direction passing proves nothing about the other, and this is a rule
  that is as easy to write backwards as forwards.
- §35's barn placement was corrected by a test finding 806 blocked points
  inside the rectangle the job queue assumes is clear — not by anything
  visible on screen. The barn looked perfect where it first stood.
- §35 exempts same-id pairs from the solid-overlap check, which is the kind
  of change that can quietly gut a suite. It is recorded here so it can be
  argued with: the property that matters is the escape test beside it, which
  was not touched, runs over the barn's corners and passes. If that ever
  starts failing, the exemption is the first thing to look at.
- One assertion in §35 was corrected rather than the code: the refused-purchase
  test compared coins against the fixture's 9000 and measured 9100, because a
  save is reconciled on open. It reads the balance after loading and asserts
  the refusal changed nothing, which is the claim that was meant.

- §36's building placements were both corrected by measurement, not by eye.
  The villa's collision box is 13.5 by 10.2 at the scale it is placed —
  about twice what it reads as from the road — and the cottage lane's last
  metres were inside the cottage's own box until that was measured.
- §36's road layout was checked on a plan view rendered from the scene's own
  route samples, not from a screenshot. Three attempts at an in-game
  overhead shot all ended with the camera at ground level, because dragging
  the orbit vertically lowers it; plotting the polylines answered the
  question in one go and answered it exactly.
- A comment in §36 claimed the fountain used the pond's water shader. It did
  not. The claim was removed and replaced with the reason not to, which is
  the only honest repair for a comment that describes code that was never
  written.
- §36 broke seven existing tests and every one was repaired by stating a
  fact rather than by relaxing an assertion: six `dream homes` fixtures now
  say both properties have been viewed (those tests are about the purchase
  and the ending, not the gate), and the "nothing is adrift" check had the
  two new places added to its list of places. That check's own comment says
  adrift means "in none of the places" — so the repair for a new somewhere
  is to name it, never to widen the margin until the hills count as the farm.
- The villa's grounds are 13 units where the cottage's are 9, and that
  asymmetry was forced by measurement: the villa block's middle sits 10.06
  from where its lane puts you down, so at radius 10 the villa stood outside
  its own grounds. Found by the adrift test, which is exactly the job it was
  written for.
- §36's purchase gate has no migration, and that is a deliberate asymmetry
  with §35's pasture rather than an oversight — recorded because the two
  sit next to each other in the save and the inconsistency would otherwise
  look like one of them was forgotten.

- §37's city layout was measured into place, not composed by eye. A probe
  reported every city prop's collision box and its clearance from both
  streets in one table, and four iterations of that table are what moved the
  buildings off the road, the stalls off the kerb and the count from seven
  to four.
- §37's "longest drive" claim was asserted before it was measured and was
  false as first written — the branch is shorter than the market road; the
  journey is longer. Both the test and the code comment now carry the
  measured figures.
- The pines growing in the city square were caught by looking at a
  screenshot, not by reasoning about scatter bounds. The bounds were obvious
  once the trees were there and invisible beforehand.

- One process mistake in §37, and the third of its kind in this document:
  the help panel was edited while a full suite run was in flight, so some
  tests ran against the old page and some against the new one. The run was
  killed rather than read. The rule that keeps being relearned is simply
  *finish every edit before starting the run*, and the reason it keeps
  being broken is that a documentation-shaped change does not feel like a
  code change until it turns out the help text has a test.

Probe scripts live outside the repo, in the session scratchpad. They were
throwaway; this document is what they were for.
