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

Probe scripts live outside the repo, in the session scratchpad. They were
throwaway; this document is what they were for.
