/* scene.js — the 3D farm scene.
 *
 * A module, not a classic script, purely so the import map in index.html can
 * resolve the bare "three" specifier without a bundler. That has one
 * consequence worth knowing before reading the rest of this file: a module's
 * top level cannot see script.js's top-level `const`s and `let`s — those
 * live in the classic-script global lexical scope, which is a different
 * thing from `window` and which modules don't share. So everything this
 * file needs from the rules and the save comes through one deliberate
 * handle, `window.Farm3DBridge`, set up at the bottom of script.js. Read
 * that comment for what it does and — just as importantly — doesn't expose.
 *
 * What this file owns, for now (the weekend plan's steps 4-9, plus the
 * two-week overhaul's step 3):
 *   - the render loop: rolling terrain, a fence, sixteen soil tiles;
 *   - crop meshes on those tiles, grown from state the same way the 2D
 *     sprite swap was — a generic sprout/seedling early, a crop-coloured
 *     head once it is close to ripe, a bob once it's ripe, a grey slump
 *     once it rots;
 *   - the farmer, and the queue that walks her to a plot before the rules
 *     for that plot run at all. That is the one part of this file the rest
 *     of the game can feel, and it has a long comment of its own below;
 *   - a pen beside the field with the herd in it, on the same walk queue;
 *   - the sun and a real atmospheric sky, on the same clock the 2D sky
 *     reads, and a camera the player can orbit and pan by hand.
 *
 * This file does not touch #plotsGrid at all — it is still a plain CSS
 * grid, invisible, sitting over the canvas exactly as before this scene
 * existed. See the long comment on `.plots-grid` in styles.css for why an
 * earlier version of this file that positioned each button from a camera
 * projection was wrong, not just more complicated.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { loadModel, loadMeshes, preload } from './assets.js';

const bridge = window.Farm3DBridge;

if (!bridge) {
  // script.js failed to load, or somehow ran after this module — either way
  // there is nothing to read state from, so fail quietly rather than throw
  // into what would otherwise be a blank canvas.
  console.error('Farm3D: window.Farm3DBridge is missing — the 3D scene cannot start.');
} else {
  startScene(bridge);
}

function startScene(bridge) {
  const container = document.getElementById('farmScene');
  const canvas = document.getElementById('farmCanvas');
  const grid = document.getElementById('plotsGrid');
  if (!container || !canvas || !grid) return;

  const PLOT_COUNT = bridge.PLOT_COUNT;

  // Read in three places that all run before the farmer section below is
  // reached at load time (the plot/animal tap handlers, and the OrbitControls
  // setup in the camera section), so it is declared up here rather than
  // alongside the rest of the farmer's own setup.
  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Grid geometry in world units, laid out in the plot array's own order:
     plots 0-3 are the back row, plot 0 the far left. The field then reads
     top-left to bottom-right on screen exactly as the flat grid did, so
     tabbing through the DOM buttons still walks it the way it looks. The
     camera sits to the south (+z), so later rows are the nearer ones. */
  const GRID = 4;
  const TILE = 1;
  const GAP = 0.16;
  const STEP = TILE + GAP;
  const SPAN = GRID * TILE + (GRID - 1) * GAP;

  function tileWorldPos(idx) {
    const col = idx % GRID;
    const row = Math.floor(idx / GRID);
    return {
      x: (col - (GRID - 1) / 2) * STEP,
      z: (row - (GRID - 1) / 2) * STEP,
    };
  }

  /* -------------------------------------------------------------- */
  /* Renderer, scene, camera, lights                                   */
  /* -------------------------------------------------------------- */

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Capped rather than left at the device's real ratio: a 3x phone screen
  // would otherwise ask for nine times the pixels for no visible gain.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  /* Not an early start on step 4's post-processing pass — this is here
     because the sky below does not work without it. Sky.js's atmospheric
     model outputs unclamped HDR radiance by design (the same Preetham
     model most engines use it for); with the default NoToneMapping every
     pixel above 1.0 just clips to flat white, which is exactly what an
     early screenshot here showed before this line existed — hills in
     silhouette against a blown-out sheet, not a sky. three.js's own Sky.js
     example pairs it with this same tone mapping and exposure for that
     reason, not as a style choice. Step 4 still has real work of its own —
     bloom, SSAO, colour grading through EffectComposer — layered on top of
     a tone-mapped render, not overlapping with what makes this render
     tone-mapped in the first place. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  /* Tried again for step 9, and dropped again: even pared all the way down
     to one low-res (512px) caster — just the farmer — with nothing set to
     receive her shadow at all, so the map was rendered but never sampled,
     a stress test pinning this scene against three other Chromium instances
     (mirroring how loaded CI actually runs) still cost an unrelated test its
     five-second timing window on the same software-rendered path steps 4-6
     first hit. Throttling the shadow map to a handful of redraws a second
     instead of every frame did not rescue it either. Below the cost that's
     worth paying here, twice now — shadowMap.enabled stays at its default
     false; the sun still moves and dims correctly for day and night, see
     syncSky() below, it just doesn't paint anything onto the ground for it. */

  const scene = new THREE.Scene();
  // Mutated in place each frame by syncSky() rather than reassigned, so
  // this is the day colour only until the first frame runs.
  scene.background = new THREE.Color(0xbfe4f5);
  // Reaches a little further than steps 4-9 needed: fog's only job used to be
  // hiding a flat plane's featureless edge, and hiding it early cost nothing.
  // Now there is real relief out there worth letting fade into haze instead
  // of vanishing outright — see the terrain section, below.
  scene.fog = new THREE.Fog(0xbfe4f5, 16, 34);

  // Aimed once the pen's position is known, below — it needs to frame both
  // the field and the pen at once, off to one side of this constructor.
  const camera = new THREE.PerspectiveCamera(48, 4 / 3, 0.1, 100);

  const hemi = new THREE.HemisphereLight(0xdcefff, 0x3d5a2c, 0.85);
  scene.add(hemi);

  /* The sun: colour, intensity and position all driven from daySkyState()
     each frame, below, rather than fixed here. No mesh of its own, and (see
     the renderer, above) nothing it casts is ever drawn — its low angle at
     dawn and dusk still reads, just as dimmer, warmer light rather than a
     shadow stretching across the yard. */
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.15);
  scene.add(sun);
  scene.add(sun.target);

  /* -------------------------------------------------------------- */
  /* Sky — the same clock the 2D strip reads, driving colour, light    */
  /* level, and where the sun sits over the yard                       */
  /* -------------------------------------------------------------- */

  /* The same three stops SKY_COLORS in script.js fades the 2D strip
     between, as THREE.Colors instead of rgb() strings — reusing the
     palette rather than inventing a second one is what keeps the yard from
     ever reading as a different time of day than the UI above it. */
  const BG_STOPS = {
    day: new THREE.Color(0x7ec8f0), dusk: new THREE.Color(0xf7814a), night: new THREE.Color(0x0c1636),
  };
  /* The hemisphere light's own two colours get their own, much shallower
     stops than the background above — the falloff from day to night is
     already carried by hemi.intensity, below, so tinting its colour all the
     way down to the background's near-black night stop too would darken the
     ambient light twice over: once by colour, once by intensity, compounding
     into a scene that reads as flat black well before intensity alone would
     have. These stay moon-bright at every phase; only the hue shifts. */
  const HEMI_SKY_STOPS = {
    day: new THREE.Color(0xdcefff), dusk: new THREE.Color(0xffd7ad), night: new THREE.Color(0x8fa4d9),
  };
  const HEMI_GROUND_STOPS = {
    day: new THREE.Color(0x3d5a2c), dusk: new THREE.Color(0x5a4a34), night: new THREE.Color(0x2c3550),
  };
  const SUN_STOPS = { day: new THREE.Color(0xfff3d6), dusk: new THREE.Color(0xff9d5c) };
  const sunColorTmp = new THREE.Color();
  const skySunDir = new THREE.Vector3();

  // Both stop sets fade the same way: day to dusk across the first half of
  // nightFactor's climb, dusk to night across the second — the dusk band is
  // the midpoint of the ramp, not a separate timer of its own.
  function lerpStops(target, stops, t) {
    if (t < 0.5) target.copy(stops.day).lerp(stops.dusk, t * 2);
    else target.copy(stops.dusk).lerp(stops.night, (t - 0.5) * 2);
  }

  function syncSky() {
    const { phase, nightFactor } = bridge.daySkyState();

    lerpStops(scene.background, BG_STOPS, nightFactor);
    scene.fog.color.copy(scene.background);
    lerpStops(hemi.color, HEMI_SKY_STOPS, nightFactor);
    lerpStops(hemi.groundColor, HEMI_GROUND_STOPS, nightFactor);
    hemi.intensity = 0.22 + 0.63 * (1 - nightFactor);

    /* A single continuous circle driven straight off `phase`, rather than
       the 2D moon/sun icon's day/night-split arc above — that formula
       exists to place a flat sprite within a visible sky strip, which is a
       different problem. `elevation` below is just cos(2*pi*phase),
       reached through nightFactor's own definition (nightFactor =
       (1-cos(2*pi*phase))/2) instead of a second cosine call that could
       drift out of step with it: 1 at midday, 0 at each twilight, -1 at
       midnight. Below the ground at midnight is harmless for a light with
       no mesh of its own, and at that point intensity has already faded
       low enough that its exact position doesn't read anyway. The sweep
       moves the sun east-to-west (or back) through the day; direction is
       still all a light with no shadow of its own (see the renderer, above)
       has to say — it changes which faces catch the warm, low-angle light
       at dawn and dusk, just not a shadow's length or where it falls. */
    const angle = phase * Math.PI * 2;
    const elevation = 1 - 2 * nightFactor;
    sun.position.set(VIEW_CX + Math.sin(angle) * 9, elevation * 8 + 3, 3);
    sun.intensity = Math.max(0.05, 1.15 * (1 - nightFactor * 0.94));
    sun.color.copy(sunColorTmp.copy(SUN_STOPS.day).lerp(SUN_STOPS.dusk, Math.min(nightFactor * 2.2, 1)));

    /* The sky dome (below) wants a unit direction, not a lit position, so
       this is the same angle/elevation turned into a point on a sphere
       rather than reaching for a second formula. At elevation 1 (midday)
       that's straight up; at 0 (either twilight) it's level with the
       horizon, sweeping with `angle` exactly as the light above does; at -1
       (midnight) it's straight down. Everything else about the dome —
       turbidity, rayleigh, the warm horizon band at dusk — falls out of
       Preetham's own atmospheric model just from knowing where the sun is,
       which is the whole reason to reach for a real sky shader instead of
       hand-tuning a third gradient to match the two above. */
    const elevRad = elevation * (Math.PI / 2);
    skySunDir.set(
      Math.cos(elevRad) * Math.sin(angle),
      Math.sin(elevRad),
      Math.cos(elevRad) * Math.cos(angle),
    ).normalize();
    sky.material.uniforms.sunPosition.value.copy(skySunDir);
  }

  /* -------------------------------------------------------------- */
  /* Fence — static dressing, built once. The ground itself is built    */
  /* further down, once the pen's extent is known too: it needs both     */
  /* the field's and the pen's footprint to know where "flat" ends.      */
  /* -------------------------------------------------------------- */

  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a6135, roughness: 0.9 });
  const yardHalf = SPAN / 2 + 0.55;
  const railGeo = new THREE.BoxGeometry(1, 0.5, 0.12);
  const postGeo = new THREE.BoxGeometry(0.14, 0.7, 0.14);
  const m4 = new THREE.Matrix4();

  /* One rectangular fence, reused for the field and (below) the pen: four
     rails scaled to the box's width or depth, a post InstancedMesh at each
     corner. `cx`/`cz` is the box's centre, not the world origin — the pen
     sits well off to one side of it. */
  function buildFence(cx, cz, halfX, halfZ) {
    [
      { pos: [cx, 0.25, cz + halfZ], scaleX: halfX * 2, rotY: 0 },
      { pos: [cx, 0.25, cz - halfZ], scaleX: halfX * 2, rotY: 0 },
      { pos: [cx + halfX, 0.25, cz], scaleX: halfZ * 2, rotY: Math.PI / 2 },
      { pos: [cx - halfX, 0.25, cz], scaleX: halfZ * 2, rotY: Math.PI / 2 },
    ].forEach(({ pos, scaleX, rotY }) => {
      const rail = new THREE.Mesh(railGeo, fenceMat);
      rail.position.set(...pos);
      rail.scale.x = scaleX;
      rail.rotation.y = rotY;
      scene.add(rail);
    });

    const posts = new THREE.InstancedMesh(postGeo, fenceMat, 4);
    [
      [cx + halfX, cz + halfZ], [cx + halfX, cz - halfZ],
      [cx - halfX, cz + halfZ], [cx - halfX, cz - halfZ],
    ].forEach(([x, z], i) => {
      m4.makeTranslation(x, 0.35, z);
      posts.setMatrixAt(i, m4);
    });
    scene.add(posts);
  }

  buildFence(0, 0, yardHalf, yardHalf);

  /* -------------------------------------------------------------- */
  /* Soil tiles — one instance per plot                                */
  /* -------------------------------------------------------------- */

  const tileMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE, 0.16, TILE),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    PLOT_COUNT,
  );
  for (let i = 0; i < PLOT_COUNT; i++) {
    const { x, z } = tileWorldPos(i);
    m4.makeTranslation(x, 0, z);
    tileMesh.setMatrixAt(i, m4);
  }
  scene.add(tileMesh);

  const LOCKED_TILE = new THREE.Color(0x3d3a34);
  const UNLOCKABLE_TILE = new THREE.Color(0x8a6a3a);
  const SOIL_TILE = new THREE.Color(0x5a3d22);
  const TARGETED_TILE = new THREE.Color(0xb59a5c); // a tile the farmer is on her way to

  /* -------------------------------------------------------------- */
  /* Crops — a generic sprout/seedling while young, a crop-coloured    */
  /* head once a plot nears ripe. Two InstancedMeshes cover all         */
  /* sixteen plots and every crop; which plots are lit up, and in what */
  /* colour, is entirely driven by state each frame.                    */
  /* -------------------------------------------------------------- */

  const stalkGeo = new THREE.ConeGeometry(0.09, 1, 6);
  stalkGeo.translate(0, 0.5, 0); // pivot at the base, so scale.y grows it up from the soil
  const stalkMesh = new THREE.InstancedMesh(
    stalkGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    PLOT_COUNT,
  );
  scene.add(stalkMesh);

  const headMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.3, 0), // faceted, deliberately low-poly
    new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    PLOT_COUNT,
  );
  scene.add(headMesh);

  const SPROUT_COLOR = 0x74b750;
  const CROP_HEAD_COLOR = {
    wheat: 0xd9b64a,
    corn: 0xf2c94c,
    carrot: 0xe0672c,
    pumpkin: 0xdb7a1f,
  };
  const WILT_COLOR = 0xe0a233;
  const ROTTEN_STALK = 0x8a8267;
  const ROTTEN_HEAD = 0x6b6250;

  const tmpColor = new THREE.Color();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMatrix = new THREE.Matrix4();

  function setInstance(mesh, i, x, y, z, scaleXZ, scaleY, colorHex) {
    tmpMatrix.compose(
      tmpPos.set(x, y, z),
      tmpQuat.identity(),
      tmpScale.set(scaleXZ, scaleY, scaleXZ),
    );
    mesh.setMatrixAt(i, tmpMatrix);
    if (colorHex !== undefined) mesh.setColorAt(i, tmpColor.set(colorHex));
  }

  function hideInstance(mesh, i, x, z) {
    setInstance(mesh, i, x, 0, z, 0, 0);
  }

  /* The jobs the farmer has been given but not yet done, oldest first, and
     the one she is on now. Declared up here only so a tile or a pen slot can
     show that it has been spoken for; everything that fills and drains them
     is in "The farmer, and the walk to work" below. A job is one of:
       { type: 'plot', plot, kind }
       { type: 'animal', kind, id, action, extra }
     kind means two different things across those — a plot's harvest/plant/
     clear/unlock versus an animal's stateKey — because both are just
     whatever plotIntent or the tap handler already decided the job was. */
  const jobQueue = [];
  let activeJob = null;

  function isPlotSpokenFor(idx) {
    const matches = (job) => job.type === 'plot' && job.plot === idx;
    if (activeJob && matches(activeJob)) return true;
    return jobQueue.some(matches);
  }

  function isAnimalSpokenFor(kind, id) {
    const matches = (job) => job.type === 'animal' && job.kind === kind && job.id === id;
    if (activeJob && matches(activeJob)) return true;
    return jobQueue.some(matches);
  }

  function syncPlots(now) {
    const state = bridge.getState();
    const plots = state.plots;
    const unlocked = state.unlockedPlots;

    for (let i = 0; i < PLOT_COUNT; i++) {
      const { x, z } = tileWorldPos(i);
      const locked = i >= unlocked;

      tmpColor.set(locked ? (i === unlocked ? UNLOCKABLE_TILE : LOCKED_TILE) : SOIL_TILE);
      /* A tap no longer does anything on the spot, so the tile it landed on
         has to say that it was heard — otherwise the half-second before the
         farmer arrives reads as a dropped tap. */
      if (isPlotSpokenFor(i)) tmpColor.lerp(TARGETED_TILE, 0.55);
      tileMesh.setColorAt(i, tmpColor);

      const plot = plots[i];
      if (locked || !plot.crop) {
        hideInstance(stalkMesh, i, x, z);
        hideInstance(headMesh, i, x, z);
        continue;
      }

      if (plot.rotten) {
        setInstance(stalkMesh, i, x, 0, z, 1, 0.35, ROTTEN_STALK);
        // Squashed wide and low: the slump the 2D grid's wilted-then-rotten
        // sprite implies, rendered instead of read.
        setInstance(headMesh, i, x, 0.1, z, 1.25, 0.35, ROTTEN_HEAD);
        continue;
      }

      const progress = bridge.plotProgress(plot);
      const ripe = progress >= 1;
      const stage = bridge.plotGrowthStage(progress);

      if (!ripe && stage < 2) {
        // Same beat as the 2D sprite swap: a young plot is a generic
        // sprout or seedling, not yet the crop it will become.
        const height = stage === 0 ? 0.3 : 0.65;
        setInstance(stalkMesh, i, x, 0, z, 1, height, SPROUT_COLOR);
        hideInstance(headMesh, i, x, z);
        continue;
      }

      // Stage 2 (still growing) and ripe both show the full crop head —
      // the 2D grid does the same, telling them apart with the progress
      // bar underneath rather than the sprite itself.
      setInstance(stalkMesh, i, x, 0, z, 1, 0.28, SPROUT_COLOR);
      const wilting = ripe && bridge.isWilting(plot);
      const bob = ripe ? Math.sin(now * 0.0022 + i) * 0.045 : 0;
      setInstance(
        headMesh, i, x, 0.34 + bob, z, 1, 1,
        wilting ? WILT_COLOR : CROP_HEAD_COLOR[plot.crop],
      );
    }

    tileMesh.instanceMatrix.needsUpdate = true;
    if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
    stalkMesh.instanceMatrix.needsUpdate = true;
    if (stalkMesh.instanceColor) stalkMesh.instanceColor.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
  }

  /* -------------------------------------------------------------- */
  /* The pen — animals beside the field                                */
  /* -------------------------------------------------------------- */

  /* A second, smaller fenced rectangle east of the field, close enough that
     both read as one yard rather than two separate scenes — the camera
     below is framed to hold both, which is the only reason it no longer
     matches the field-only shot steps 4-7 tuned. Each of the five kinds gets
     one row, oldest animal in the leftmost column, so buying and selling
     shuffles the row rather than the animal you were looking at jumping
     somewhere new (a small, accepted imperfection — worth it against the
     cost of tracking stable per-animal slots for something purely visual).

     The pen is deep rather than wide on purpose. Width costs the camera —
     every extra unit of PEN_HALF_X pushes the frame that has to hold both
     fences wider still, shrinking the farmer and the crops along with it —
     but depth is close to free, because the camera already pulls back far
     enough to fit the field's own depth. Given the choice, the five rows
     get that free dimension: keeping them apart is what makes a cow read
     as a cow and not a paler chicken standing next to it. */
  const PEN_GAP = 0.4;
  const PEN_HALF_X = 1.05;
  const PEN_HALF_Z = 2.2;
  const PEN_CX = yardHalf + PEN_GAP + PEN_HALF_X;
  const PEN_CAP = 6; // shown per kind; a bigger herd just crowds the last column

  buildFence(PEN_CX, 0, PEN_HALF_X, PEN_HALF_Z);

  /* -------------------------------------------------------------- */
  /* The ground — flat under the yard, rolling into hills beyond it     */
  /* -------------------------------------------------------------- */

  /* Now that the field's and the pen's footprints both exist, here is
     where "flat" stops: a rectangle enclosing both fences plus enough
     margin that a post never sits in the transition band. Outside it the
     ground is free to rise — the tile grid, the pen floor and the farmer's
     walk all assume y=0, so nothing gameplay touches may tilt. */
  /* The farm is four rooms now, not one field and a pen, so the flat ground
     has to reach all of them: the crop field and the pasture where they
     already were, an orchard to the north and the dooryard she comes out
     into to the south. These bounds are the whole of the working farm — what
     stays level, what she may walk on, and what the hills start beyond. */
  const FARM_LEFT = -7.4;  // the farmhouse stands out here
  const FARM_RIGHT = 7.8;  // and the barn out here, past the pasture
  const FARM_NORTH = -8.6; // orchard
  const FARM_SOUTH = 7.6;  // dooryard

  const FLAT_LEFT = FARM_LEFT;
  const FLAT_RIGHT = FARM_RIGHT;
  const FLAT_CENTER_X = (FLAT_LEFT + FLAT_RIGHT) / 2;
  const FLAT_HALF_X = (FLAT_RIGHT - FLAT_LEFT) / 2;
  const FLAT_CENTER_Z = (FARM_NORTH + FARM_SOUTH) / 2;
  const FLAT_HALF_Z = (FARM_SOUTH - FARM_NORTH) / 2;

  const TRANSITION_WIDTH = 5; // how far beyond the flat rectangle the rise ramps in over
  const HILL_AMPLITUDE = 2.2;
  const TERRAIN_HALF = 30; // comfortably past the fog below, so its own edge is never seen
  const TERRAIN_SEGMENTS = 48;

  /* A cheap value noise — hash the integer lattice, smooth-interpolate
     between corners — not Perlin, not gradient noise, just enough to break
     up a grid without a library. It only ever runs while building this
     mesh once at load, never per frame, so "cheap" matters more than
     "textbook". */
  function hash2(x, z) {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  function valueNoise(x, z) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = THREE.MathUtils.smoothstep(x - x0, 0, 1);
    const fz = THREE.MathUtils.smoothstep(z - z0, 0, 1);
    const a = hash2(x0, z0);
    const b = hash2(x0 + 1, z0);
    const c = hash2(x0, z0 + 1);
    const d = hash2(x0 + 1, z0 + 1);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(a, b, fx),
      THREE.MathUtils.lerp(c, d, fx),
      fz,
    );
  }
  // Two octaves — one broad, one finer on top — so the hills have some
  // texture to them rather than reading as one smooth blob each.
  function terrainNoise(x, z) {
    return valueNoise(x * 0.08, z * 0.08) * 0.7 + valueNoise(x * 0.19, z * 0.19) * 0.3;
  }

  function terrainHeight(x, z) {
    const dx = Math.max(0, Math.abs(x - FLAT_CENTER_X) - FLAT_HALF_X);
    const dz = Math.max(0, Math.abs(z - FLAT_CENTER_Z) - FLAT_HALF_Z);
    const distOut = Math.hypot(dx, dz);
    if (distOut <= 0) return 0;
    const t = THREE.MathUtils.smoothstep(distOut, 0, TRANSITION_WIDTH);
    const n = (terrainNoise(x, z) - 0.5) * 2; // recenter to roughly [-1, 1]
    return t * n * HILL_AMPLITUDE;
  }

  const GRASS_A = new THREE.Color(0x6fa04a);
  const GRASS_B = new THREE.Color(0x82ae57); // a second grass tone, mottled in below
  const TERRAIN_DIRT = new THREE.Color(0x8a7256);
  const terrainColorTmp = new THREE.Color();

  /* Even on the flat yard, a single flat green would still read as a green
     rectangle up close — the thing this whole step exists to stop being
     true. So every vertex, flat ground included, mixes in a little of a
     second grass tone from the same noise function at a different
     frequency; slopes further out mix toward bare dirt, standing in for
     the "blended textures" ask without needing a photographic tileable
     texture the low-poly kit assets were never going to match anyway. */
  function terrainVertexColor(target, x, z, normalY) {
    const mottle = valueNoise(x * 0.35 + 100, z * 0.35 + 100);
    target.copy(GRASS_A).lerp(GRASS_B, mottle * 0.5);
    const slope = THREE.MathUtils.clamp(1 - normalY, 0, 1);
    const rockAmount = THREE.MathUtils.smoothstep(slope, 0.18, 0.55);
    target.lerp(TERRAIN_DIRT, rockAmount);
  }

  function buildTerrain() {
    const verts = TERRAIN_SEGMENTS + 1;
    const step = (TERRAIN_HALF * 2) / TERRAIN_SEGMENTS;
    const positions = new Float32Array(verts * verts * 3);

    let p = 0;
    for (let iz = 0; iz <= TERRAIN_SEGMENTS; iz++) {
      const z = -TERRAIN_HALF + iz * step;
      for (let ix = 0; ix <= TERRAIN_SEGMENTS; ix++) {
        const x = -TERRAIN_HALF + ix * step;
        positions[p++] = x;
        positions[p++] = terrainHeight(x, z);
        positions[p++] = z;
      }
    }

    const indices = [];
    for (let iz = 0; iz < TERRAIN_SEGMENTS; iz++) {
      for (let ix = 0; ix < TERRAIN_SEGMENTS; ix++) {
        const a = iz * verts + ix;
        const b = a + 1;
        const c = a + verts;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals(); // needed below, to know how steep each vertex is

    const normalAttr = geo.getAttribute('normal');
    const posAttr = geo.getAttribute('position');
    const colors = new Float32Array(verts * verts * 3);
    for (let i = 0; i < verts * verts; i++) {
      terrainVertexColor(terrainColorTmp, posAttr.getX(i), posAttr.getZ(i), normalAttr.getY(i));
      colors[i * 3] = terrainColorTmp.r;
      colors[i * 3 + 1] = terrainColorTmp.g;
      colors[i * 3 + 2] = terrainColorTmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return geo;
  }

  const terrain = new THREE.Mesh(
    buildTerrain(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  terrain.position.y = -0.08; // the same offset the flat ground used to sit at
  scene.add(terrain);

  /* -------------------------------------------------------------- */
  /* The paths between the rooms                                       */
  /* -------------------------------------------------------------- */

  /* Worn ground rather than laid stones: a ribbon of geometry just above the
     terrain, in one mesh and one draw call. The kit does have path tiles, and
     they were the obvious answer until the numbers were checked — the terrain
     is 48 segments across 60 units, so a vertex is 1.25 units apart and a
     path 0.8 wide would not have registered in its colours at all, while
     tiling actual meshes along two routes is dozens of draw calls for
     something nobody looks at directly. Two rectangles is what it takes.

     They are laid where a farm would wear them: a spine down the west side of
     the field joining the dooryard to the orchard, and a branch east across
     to the pasture gate. */
  const PATH_Y = -0.065; // above the terrain's -0.08, below anything standing on it
  const PATH_RECTS = [
    { x0: -3.95, x1: -3.15, z0: FARM_NORTH + 1.1, z1: FARM_SOUTH - 0.9 }, // the spine
    { x0: -3.95, x1: PEN_CX - PEN_HALF_X, z0: 3.15, z1: 3.95 },           // out to the pen
    { x0: -5.4, x1: -3.15, z0: 1.1, z1: 1.75 },                           // to the farmhouse door
  ];

  function buildPaths() {
    const positions = [];
    const indices = [];
    for (const r of PATH_RECTS) {
      const base = positions.length / 3;
      positions.push(r.x0, PATH_Y, r.z0, r.x1, PATH_Y, r.z0, r.x1, PATH_Y, r.z1, r.x0, PATH_Y, r.z1);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const paths = new THREE.Mesh(
    buildPaths(),
    new THREE.MeshStandardMaterial({ color: 0x9c8663, roughness: 1 }),
  );
  scene.add(paths);

  /* -------------------------------------------------------------- */
  /* Dressing the rooms                                                */
  /* -------------------------------------------------------------- */

  /* Placed by hand, one entry per object, because this is the step where the
     farm stops being a diagram and becomes somewhere — and a scatter function
     with a seed would give the even, sourceless spread that makes procedural
     set dressing read as procedural. The rules for where things went: the
     dooryard faces the path she comes out onto, the orchard thins toward the
     hills so the edge of the flat ground is never a visible line, and nothing
     stands where she has to walk between the field and the pen.

     Nothing here collides — she walks through a tree trunk if she insists.
     Collision is a step-14 question about a scene ten times this size, and
     inventing it now for thirty props would be building it twice. */
  /* Where the tall things go is a camera question before it is a farm one.
     The camera sits about nine units behind her, which for a farmer facing up
     the field means it is standing in the dooryard — so a farmhouse put
     there, the obvious place for it, spends most of the game between the
     camera and the player's own character. Measured that way once and moved:
     the buildings flank the field, west and east, where they are seen past
     her rather than through. What is left in the dooryard is all knee-high.

     Buildings are also sized by width here, not by the height the loader
     normalises to — a 1.3 x 0.83 model asked to stand 3 units tall comes out
     4.7 wide, which is how the first attempt put the barn through the pen. */
  const PROPS = [
    // --- the farmhouse, west: the farm's front door, seen across the field ---
    { id: 'city-suburban/building-type-a', x: -5.8, z: 1.4, ry: Math.PI / 2, h: 2.3 },
    { id: 'nature/plant_bush', x: -4.5, z: 0.5 },
    { id: 'nature/plant_bush', x: -4.4, z: 2.3 },
    { id: 'nature/flower_redA', x: -4.6, z: 1.4 },
    { id: 'survival/box', x: -4.7, z: 3.2, ry: -0.3 },

    // --- the barn, east: past the pasture, closing that side of the farm ---
    { id: 'city-suburban/building-type-b', x: 6.7, z: -0.6, ry: -Math.PI / 2, h: 2.5 },
    { id: 'survival/barrel', x: 5.6, z: 1.5, ry: 0.9 },
    { id: 'survival/barrel', x: 5.9, z: 1.8, ry: 0.2 },
    { id: 'nature/log', x: 6.2, z: 2.6, ry: 0.7 },

    /* No windmill. fantasy-town/windmill turns out to be the sail assembly
       on its own — a ladder of blades meant to be pinned to a building, not a
       standalone mill — so at any scale it hangs in the air beside the
       farmhouse looking like a fallen gate. Dropped rather than dressed
       around; the gap is recorded in the art bible with the missing barn and
       silo. */

    // --- the dooryard, south: knee-high only, so nothing blocks the view ---
    { id: 'survival/signpost', x: -3.0, z: 4.3, ry: 0.4 },
    { id: 'survival/barrel', x: -0.35, z: 5.0, ry: 0.2 },
    { id: 'survival/barrel', x: -0.05, z: 5.35, ry: 1.1 },
    { id: 'survival/box', x: -2.55, z: 5.3, ry: -0.3 },
    { id: 'survival/box', x: -2.75, z: 5.65, ry: 0.6 },
    { id: 'survival/chest', x: 0.75, z: 4.6, ry: -0.2 },
    { id: 'nature/plant_bush', x: -2.2, z: 4.5 },
    { id: 'nature/plant_bush', x: 0.3, z: 6.2 },
    { id: 'nature/flower_redA', x: -2.6, z: 4.1 },
    { id: 'nature/flower_yellowA', x: -0.9, z: 4.35 },
    { id: 'nature/stump_round', x: 1.9, z: 5.4, ry: 0.9 },

    // --- the orchard, north: rows that loosen toward the hills ---
    { id: 'nature/tree_default', x: -2.6, z: -4.6, ry: 0.3, h: 2.9 },
    { id: 'nature/tree_detailed', x: -0.6, z: -4.8, ry: 1.2, h: 3.1 },
    { id: 'nature/tree_default', x: 1.4, z: -4.7, ry: 2.1, h: 2.7 },
    { id: 'nature/tree_default_fall', x: 3.3, z: -4.9, ry: 0.8, h: 2.8 },
    { id: 'nature/tree_detailed', x: -3.1, z: -6.4, ry: 2.6, h: 3.0 },
    { id: 'nature/tree_default', x: -1.1, z: -6.6, ry: 1.6, h: 2.8 },
    { id: 'nature/tree_pineDefaultA', x: 1.0, z: -6.8, ry: 0.4, h: 3.4 },
    { id: 'nature/tree_pineDefaultA', x: 3.6, z: -7.0, ry: 2.2, h: 3.2 },
    { id: 'nature/tree_default_fall', x: -2.2, z: -8.0, ry: 1.0, h: 2.6 },
    { id: 'nature/tree_default', x: 2.0, z: -8.2, ry: 2.8, h: 2.7 },
    { id: 'nature/stump_round', x: 0.2, z: -5.6, ry: 0.5 },
    { id: 'nature/stump_round', x: 4.6, z: -6.1, ry: 1.9 },
    { id: 'nature/log', x: -0.2, z: -7.5, ry: 1.3 },
    { id: 'nature/rock_largeA', x: 4.9, z: -4.4, ry: 0.6 },
    { id: 'nature/rock_smallA', x: -4.0, z: -5.2, ry: 1.4 },
    { id: 'nature/rock_smallA', x: 2.7, z: -5.9, ry: 0.2 },
    { id: 'nature/plant_bush', x: -3.6, z: -7.2 },
    { id: 'nature/plant_bush', x: 4.2, z: -8.0 },
    { id: 'nature/grass_large', x: -1.9, z: -5.4 },
    { id: 'nature/grass_large', x: 3.0, z: -6.5 },
  ];

  /* Loaded after the scene is standing, like the farmer, so nothing waits on
     the network to start playing. Failures are per-prop and silent beyond a
     warning: a farm missing its windmill is still a farm, and a rejected
     promise here must not take the rest of the dressing down with it. */
  function dressFarm() {
    for (const prop of PROPS) {
      loadModel(prop.id, prop.h).then(({ object }) => {
        object.position.set(prop.x, 0, prop.z);
        object.rotation.y = prop.ry ?? 0;
        /* Materials that arrive after the scene-wide pass have to opt out of
           tone mapping themselves — see that pass for why only the sky wants
           it. */
        object.traverse((obj) => {
          for (const mat of [obj.material ?? []].flat()) mat.toneMapped = false;
        });
        scene.add(object);
      }).catch((err) => console.warn(`farm: ${prop.id} did not load`, err));
    }
  }
  dressFarm();

  /* -------------------------------------------------------------- */
  /* Foliage, instanced                                                */
  /* -------------------------------------------------------------- */

  /* A deterministic scatter rather than Math.random(): the same seed on every
     load means a screenshot taken today matches one taken tomorrow, which is
     the only way this step's own tests can assert on it, and the only way a
     bug report ("there's a bush growing out of the barrel") points at a
     reproducible spot rather than a re-roll. Same hash-and-mix shape as the
     terrain's valueNoise above, just walked forward as a stream instead of
     sampled by position — a standard mulberry32, small enough to read in
     five lines rather than pull in a library for. */
  function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Where grass may not stand: the tile grid and the pen it would otherwise
     grow through, the paths it would otherwise cover, and a clearing around
     each building. Reuses the same shapes buildFence, the pen and PATH_RECTS
     already defined rather than tracing new ones. */
  const BUILDING_CLEARINGS = [
    { x: -5.8, z: 1.4, r: 1.7 }, // the farmhouse
    { x: 6.7, z: -0.6, r: 1.9 }, // the barn
  ];
  function inFarmClearing(x, z) {
    if (Math.abs(x) <= yardHalf + 0.35 && Math.abs(z) <= yardHalf + 0.35) return true;
    if (Math.abs(x - PEN_CX) <= PEN_HALF_X + 0.3 && Math.abs(z) <= PEN_HALF_Z + 0.3) return true;
    for (const r of PATH_RECTS) {
      if (x >= r.x0 - 0.35 && x <= r.x1 + 0.35 && z >= r.z0 - 0.35 && z <= r.z1 + 0.35) return true;
    }
    for (const b of BUILDING_CLEARINGS) {
      if (Math.hypot(x - b.x, z - b.z) <= b.r) return true;
    }
    return false;
  }

  /* Rejection sampling over a box, kept to whatever the caller decides counts
     as open ground — grass wants the flat farm itself, the tree fringe below
     wants the hillside just past it. Capped by attempts rather than trusting
     the count to land: a farm this cluttered can reject a lot of candidates
     before finding open ground, and an unlucky seed must still terminate. */
  function scatterPoints(rng, count, xMin, xMax, zMin, zMax, accept) {
    const points = [];
    let attempts = 0;
    const maxAttempts = count * 50;
    while (points.length < count && attempts < maxAttempts) {
      attempts += 1;
      const x = xMin + rng() * (xMax - xMin);
      const z = zMin + rng() * (zMax - zMin);
      if (accept(x, z)) points.push({ x, z });
    }
    return points;
  }

  /* Software rendering is the same signal the post-processing budget below
     reads before drawing anything: measuring cost is not free, and a machine
     that has already said it cannot afford the effects chain is not a
     machine to spend extra instances on either (rendererIsSoftware is a
     function declaration, hoisted, so it can be called here even though it
     is written further down with the budget it was built for). This is the
     "LOD" a kit of single-detail low-poly models can actually offer: there is
     no simpler mesh to fall back to per species, only fewer of them. */
  const FOLIAGE_SCALE = rendererIsSoftware() ? 0.4 : 1;

  const instMatrix = new THREE.Matrix4();
  const instScale = new THREE.Vector3();
  const Y_UP = new THREE.Vector3(0, 1, 0);

  /* One species, scattered and built. `accept` decides where it may stand;
     everything else — the random height within heightRange, the random spin,
     the shared transform across a multi-mesh model's parts — is the same
     regardless of what or where. Async because the model has to be fetched,
     and fire-and-forget for the same reason dressFarm is: nothing here should
     hold up a scene that is otherwise ready to play. */
  async function scatterInstanced(id, count, { heightRange, seed, bounds, accept }) {
    const n = Math.round(count * FOLIAGE_SCALE);
    if (n <= 0) return;
    const { meshes, height: authoredHeight } = await loadMeshes(id);
    if (!authoredHeight || meshes.length === 0) return;

    const rng = makeRng(seed);
    const points = scatterPoints(rng, n, bounds.xMin, bounds.xMax, bounds.zMin, bounds.zMax, accept);

    /* One transform per point, computed once and shared by every primitive of
       this model — a tree's trunk and its canopy are separate meshes with
       separate materials, each becoming its own InstancedMesh below, and a
       fresh random rotation drawn per primitive instead of per point would
       land the trunk one way and the canopy another. Caught reading this
       code before it was ever run, not after. */
    const transforms = points.map((p) => {
      const [lo, hi] = heightRange;
      const h = lo + rng() * (hi - lo);
      return {
        position: new THREE.Vector3(p.x, terrainHeight(p.x, p.z) - 0.08, p.z),
        quaternion: new THREE.Quaternion().setFromAxisAngle(Y_UP, rng() * Math.PI * 2),
        scale: h / authoredHeight,
      };
    });

    for (const { geometry, material } of meshes) {
      // Arrives after the scene-wide tone-mapping opt-out pass below, so —
      // like every other prop loaded after the scene stands — it opts out
      // for itself. See that pass for why only the sky wants ACES.
      material.toneMapped = false;
      const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
      transforms.forEach((t, i) => {
        instMatrix.compose(t.position, t.quaternion, instScale.setScalar(t.scale));
        mesh.setMatrixAt(i, instMatrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      /* The default bounding sphere is the geometry's own — sized for one
         blade of grass at the origin, not the scatter of a few hundred across
         the whole farm. Left alone, that is not a smaller optimisation, it is
         wrong: the renderer culls the whole InstancedMesh against a sphere
         that never moves with the instances, so it either never culls (the
         tiny sphere still overlaps the frustum near the origin) or vanishes
         outright the moment the camera looks anywhere else. computeBoundingSphere
         on an InstancedMesh knows about every instance's matrix and fixes
         both. */
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
    // Read by the tests, which have no other way to ask a canvas how many
    // grass tufts it just decided to draw.
    foliageCounts[id] = transforms.length;
  }

  const foliageCounts = {};

  const FARM_BOUNDS = { xMin: FARM_LEFT - 0.5, xMax: FARM_RIGHT + 0.5, zMin: FARM_NORTH - 0.5, zMax: FARM_SOUTH + 0.5 };
  const onFarmGround = (x, z) => !inFarmClearing(x, z);

  /* A fringe of trees on the hillside just past the farm, so the transition
     from flat ground to hill is not a bare green slope — the gap left after
     the camera opened up onto the horizon in step 6. terrainHeight is 0
     exactly on the flat farm and only departs from it once a point is
     genuinely on the rise, which is a free, already-computed "is this the
     hill" test rather than a new one traced by hand. */
  const HILL_BOUNDS = { xMin: FARM_LEFT - 13, xMax: FARM_RIGHT + 13, zMin: FARM_NORTH - 13, zMax: FARM_SOUTH + 13 };
  const onHillside = (x, z) => Math.abs(terrainHeight(x, z)) > 0.15 && !inFarmClearing(x, z);

  /* Collected so a test can wait on all of it finishing rather than on a
     fixed delay, and so a page that never got a network reply still resolves
     rather than leaving a caller waiting on a promise that was never going to
     settle — every call is already caught above. */
  const foliageReady = Promise.all([
    scatterInstanced('nature/grass', 220, {
      heightRange: [0.22, 0.34], seed: 1, bounds: FARM_BOUNDS, accept: onFarmGround,
    }).catch((err) => console.warn('farm: grass did not load', err)),

    scatterInstanced('nature/grass_large', 70, {
      heightRange: [0.34, 0.5], seed: 2, bounds: FARM_BOUNDS, accept: onFarmGround,
    }).catch((err) => console.warn('farm: grass_large did not load', err)),

    scatterInstanced('nature/tree_default', 14, {
      heightRange: [2.1, 3.1], seed: 10, bounds: HILL_BOUNDS, accept: onHillside,
    }).catch((err) => console.warn('farm: hillside trees did not load', err)),

    scatterInstanced('nature/tree_pineDefaultA', 12, {
      heightRange: [2.4, 3.6], seed: 11, bounds: HILL_BOUNDS, accept: onHillside,
    }).catch((err) => console.warn('farm: hillside pines did not load', err)),
  ]);

  /* -------------------------------------------------------------- */
  /* Sky — a real atmospheric dome, not a flat colour                  */
  /* -------------------------------------------------------------- */

  /* Preetham's scattering model, the same one most engines reach for —
     given nothing but where the sun is, it produces the warm horizon band
     at dusk and the deep blue overhead at noon on its own, which is the
     whole reason to use it instead of hand-tuning a third gradient to sit
     alongside BG_STOPS and HEMI_SKY_STOPS above. Scaled to sit well inside
     the camera's far plane (100) and outside anywhere the orbit camera can
     reach (its own maxDistance tops out around 15 from a target near the
     origin), so it always fills the background with no visible edge. */
  const sky = new Sky();
  sky.scale.setScalar(80);
  scene.add(sky);
  sky.material.uniforms.turbidity.value = 3;
  sky.material.uniforms.rayleigh.value = 1.2;
  sky.material.uniforms.mieCoefficient.value = 0.006;
  sky.material.uniforms.mieDirectionalG.value = 0.8;

  /* What this deliberately doesn't do: generate a PMREM environment map
     from the dome for image-based lighting, the other half of what this
     step's plan asked for. Tried and backed out of, for two reasons found
     before it shipped rather than after. First, a captured environment
     would need to track day/night the way everything else here does, and
     doing that by re-rendering a cubemap on any real cadence is exactly
     the class of per-frame cost steps 4-6 and step 9 both found this
     scene's software-rendered CI path has no patience for — a single
     capture at load wouldn't cost that, but it also wouldn't update, so
     materials would carry a fixed noon-bright sheen straight through
     midnight. Second, it would be fighting the hemisphere light already
     tuned in step 9 for the same job — both are ambient fill colour tied
     to the sky, and stacking a second one risks a wash rather than a
     visible improvement. The dome still does real work without it: fog
     already ties every distant surface to its horizon colour, which is
     most of what "something to reflect" was asking for. */

  /* The camera the constructor left unaimed: centred on the midpoint between
     the field's west fence and the pen's east fence, pulled back and widened
     (48° rather than steps 4-7's tighter 40°) just far enough that both
     fences still fit the frame with room to spare. Everything in it reads
     a little smaller than the field-only shot did — the trade for a farmer
     who visibly has two places to be, not one. */
  const VIEW_CX = (-yardHalf + (PEN_CX + PEN_HALF_X)) / 2;
  /* Step 4 measured why this could not be lowered: framing the horizon needs
     the pitch under about 24 degrees, and at that pitch the sixteen tiles
     foreshorten into a band 21% of the frame tall, against a grid of
     invisible plot buttons that had to stay about 59% tall to keep sixteen
     touch targets above the 44px floor. You would have tapped a tile you
     could see and planted in a different row.

     Step 6 removes the reason: the field is no longer tapped through that
     grid at all (see .plots-grid in styles.css, now keyboard-only), so the
     pitch is free. About 21 degrees now, which finally puts step 3's terrain
     and sky, and step 4's bloom, in the picture the game opens on. */
  const CAM_HEIGHT = 3.9;   // above her feet
  const CAM_BACK = 9.2;     // and behind her
  camera.position.set(VIEW_CX, CAM_HEIGHT, CAM_BACK);
  camera.lookAt(VIEW_CX, 1.1, 0);
  // The sun's own aim point, set now that VIEW_CX exists — syncSky(), above,
  // only ever moves the light's position around this fixed target.
  sun.target.position.set(VIEW_CX, 0, 0);

  /* Free-look on top of that same framing: one finger orbits, two fingers
     pinch-zoom or pan — OrbitControls' default touch mapping already, with
     nothing to customise there. Clamped so a player can't drag the camera
     under the ground or all the way to a flat top-down view, and damped for
     everyone except a player who has asked for reduced motion, for whom the
     coast-after-release drift is exactly the kind of motion they turned off. */
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(VIEW_CX, 1.1, 0);
  controls.enableDamping = !reducedMotion();
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 14;
  controls.minPolarAngle = Math.PI / 6;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.update();

  const PEN_ROWS = ['cow', 'chicken', 'sheep', 'dog', 'cat'];
  // A wide margin, not the tile grid's tight 0.15-0.16: a short animal in
  // the end row sitting close to a 0.5-tall rail was getting lost behind
  // it from this camera's shallow angle, not just crowded by it.
  const PEN_ROW_MARGIN = 0.45;
  const PEN_ROW_STEP = (PEN_HALF_Z * 2 - PEN_ROW_MARGIN * 2) / (PEN_ROWS.length - 1);
  const PEN_ROW_Z = {};
  PEN_ROWS.forEach((kind, i) => { PEN_ROW_Z[kind] = -PEN_HALF_Z + PEN_ROW_MARGIN + i * PEN_ROW_STEP; });
  const PEN_COL_STEP = (PEN_HALF_X * 2 - 0.3) / (PEN_CAP - 1);

  // The position an animal is walked to, and rests at — never the position
  // it is drawn at; idle motion (the bob, the trot) is layered on top of
  // this at render time and never moves the point the farmer is aiming for.
  function animalSlot(kind, index) {
    return {
      x: PEN_CX - PEN_HALF_X + 0.15 + Math.min(index, PEN_CAP - 1) * PEN_COL_STEP,
      z: PEN_ROW_Z[kind],
    };
  }

  const ANIMAL_COLOR = {
    cow: 0xe8ded0, chicken: 0xf2ecd0, sheep: 0xefe9da, dog: 0x8a6a45, cat: 0x707680,
  };
  // Half the geometry's own height, so each block's underside rests on the
  // ground instead of the block being centred through it.
  const ANIMAL_BASE_Y = { cow: 0.11, chicken: 0.075, sheep: 0.2, dog: 0.08, cat: 0.07 };
  const ANIMAL_GEO = {
    cow: new THREE.BoxGeometry(0.34, 0.22, 0.5),
    chicken: new THREE.BoxGeometry(0.15, 0.15, 0.15),
    sheep: new THREE.IcosahedronGeometry(0.2, 0), // faceted "fleece", same low-poly language as a crop head
    dog: new THREE.BoxGeometry(0.22, 0.16, 0.36),
    // Smaller than the dog, but not so small it vanishes at this camera
    // distance the way an accurately cat-sized block did.
    cat: new THREE.BoxGeometry(0.17, 0.14, 0.28),
  };

  const animalMesh = {};
  PEN_ROWS.forEach((kind) => {
    const mesh = new THREE.InstancedMesh(
      ANIMAL_GEO[kind],
      new THREE.MeshStandardMaterial({ color: ANIMAL_COLOR[kind], roughness: 0.85 }),
      PEN_CAP,
    );
    scene.add(mesh);
    animalMesh[kind] = mesh;
  });

  /* Guardians are the cheap win: the state a trot or a sleeping pose needs —
     hungry versus producing — already exists on every animal, so a dog on
     duty gets a short patrol and a hungry one goes flat and still, no new
     game state anywhere for it. Livestock get a slower, universal graze
     bob — the only idle motion that has to work identically for a shape as
     different as a boxy cow and a faceted sheep. */
  function syncAnimals(now) {
    const state = bridge.getState();

    PEN_ROWS.forEach((kind) => {
      const def = bridge.ANIMALS[kind];
      const list = state[def.stateKey];
      const mesh = animalMesh[kind];
      const baseY = ANIMAL_BASE_Y[kind];
      const guardian = !!def.guards;

      for (let i = 0; i < PEN_CAP; i++) {
        const slot = animalSlot(kind, i);
        const animal = list[i];
        if (!animal) {
          setInstance(mesh, i, slot.x, 0, slot.z, 0, 0);
          continue;
        }

        const seed = i * 1.7;
        let x = slot.x;
        let y = baseY;
        let scaleXZ = 1;
        let scaleY = 1;

        if (guardian) {
          if (animal.state === 'producing') {
            // On duty: a short trot along its row. Clamped rather than just
            // a small amplitude, because the leftmost column sits close
            // enough to the pen's own west rail that an unclamped trot
            // could carry a dog behind it — out of the pen fence's bounds
            // and out of the camera's view of it, not merely a clipped
            // model but a Now You See It vanishing act.
            const reach = Math.min(0.4, PEN_HALF_X - 0.12);
            x = Math.max(
              PEN_CX - PEN_HALF_X + 0.12,
              Math.min(PEN_CX + PEN_HALF_X - 0.12, x + Math.sin(now * 0.0026 + seed) * reach),
            );
            y = baseY + Math.abs(Math.sin(now * 0.009 + seed)) * 0.03;
          } else {
            // Hungry: asleep, low and still, waiting to be fed.
            scaleY = 0.45;
            y = baseY * scaleY;
          }
        } else {
          // Livestock graze in place: a slow, gentle bob, nothing that
          // would carry them off the spot the farmer is about to visit.
          y = baseY + Math.sin(now * 0.0015 + seed) * 0.02;
        }

        setInstance(mesh, i, x, y, slot.z, scaleXZ, scaleY);
        tmpColor.set(ANIMAL_COLOR[kind]);
        if (isAnimalSpokenFor(kind, animal.id)) tmpColor.lerp(TARGETED_TILE, 0.55);
        mesh.setColorAt(i, tmpColor);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  /* -------------------------------------------------------------- */
  /* The farmer, and the walk to work                                  */
  /* -------------------------------------------------------------- */

  /* This is the one place the scene is allowed to stand between a tap and
     the rules, and the order it does that in is the whole design:

         queue  ->  walk  ->  fire on arrival

     Until she reaches the tile, nothing about the farm has changed. That is
     what makes a reload mid-walk harmless: the queue lives here, in the
     scene, never in the save, so refreshing the page drops it and the crop
     is still standing. The save never heard about the tap, and never needs
     to. The tempting alternative — run the rules on tap and animate the walk
     afterwards — is the broken one: the crop would vanish before she reached
     it, and a reload halfway would leave the farm in a state no tap explains.

     The cost of the delay is that the world can move while she walks. A crop
     can ripen or rot, a hurricane can flatten the field, the player can pick
     a different seed. So a job carries the intent it was created with, and on
     arrival we ask the rules what that same tile would mean *now*: same
     answer, do it; different answer, drop it. That way a walk can be wasted,
     but a player is never charged for something they did not ask for. */

  const WALK_SPEED = 4.2;                       // world units per second
  const CROUCH_MS = 450;                        // the beat at the tile before the crop pops
  const STAND_OFF = 0.66;                       // she stops this far south of a tile's centre
  /* How fast the authored walk cycle looks right at 1x, in the same units as
     WALK_SPEED. Measured by eye against the clip rather than read off the
     file, because a glTF clip carries no ground speed of its own — the
     animator moved the legs, not the character. */
  const CLIP_WALK_SPEED = 1.5;
  /* Which way the model faces at rotation 0. facing is atan2(dx, dz), so the
     scene's forward is +Z — towards the camera — and the kit's characters are
     authored looking that way already, so there is nothing to correct. Kept
     as a named zero rather than dropped: it is the first thing to reach for
     if a future model turns out to have been authored facing the other way,
     and a wrong guess here reads as a farmer who moonwalks to work. */
  const MODEL_FACING_OFFSET = 0;
  /* Where she waits: inside the gate, off to one side of the field so she is
     not standing in front of the front row, and far enough from the corner
     to stay inside the frame. */
  const HOME = { x: -1.45, z: SPAN / 2 + 0.2 };

  /* One model per farmer the player can choose. These are two authored
     characters rather than one model recoloured, which is what the boxes and
     cones this replaces had to do — a skirt, a longer fringe and two shirt
     colours were the whole of the difference between them. */
  const FARMER_MODEL = {
    female: 'blocky-characters/character-e',
    male: 'blocky-characters/character-a',
  };

  /* Which authored clip stands in for each thing she can be doing. The kit
     ships twenty-seven; these are the three this game has any use for, and
     "pick-up" is a real bend-and-lift, which is exactly the beat the old rig
     faked by squashing her whole body 24% along Y. */
  const FARMER_CLIP = { idle: 'idle', walking: 'walk', returning: 'walk', crouching: 'pick-up' };
  const CLIP_FADE = 0.16; // seconds of crossfade between two of them

  /* The group is the thing that gets moved and turned; the body hangs inside
     it and is swapped when the player changes farmer. Keeping them separate
     means the walk below never has to know whether a body has arrived yet. */
  const farmer = new THREE.Group();
  farmer.visible = false;
  scene.add(farmer);

  /* Both of them, warmed now rather than when the player picks one: the pick
     happens on the welcome screen, so the fetch has the whole of that screen
     to finish in and she is standing in the yard by the time it closes. */
  preload(Object.values(FARMER_MODEL));

  /** gender -> { object, mixer, actions } once its model has loaded. */
  const bodies = new Map();
  let body = null;
  let bodyGender = null;
  let clipPlaying = null;

  /* The rules never wait for this. A tap queues a job, the job walks and
     fires, and all of that runs whether or not there is anything on screen to
     see doing it — which is the same separation that lets the queue live
     outside the save. So the model is fetched in the background and dropped
     in when it arrives; until then she is simply not drawn. A failed fetch
     leaves the farm playable and the farmer invisible, which is worth a
     complaint in the console but not a fallback rig: every model here is
     precached by the service worker (see sw.js), so an absent one means a
     broken install rather than a slow network. */
  async function ensureBody(gender) {
    if (bodies.has(gender)) return bodies.get(gender);

    const pending = loadModel(FARMER_MODEL[gender]).then(({ object, animations }) => {
      const mixer = new THREE.AnimationMixer(object);
      const actions = {};
      for (const clip of animations) actions[clip.name] = mixer.clipAction(clip);
      /* Materials arriving after the scene-wide pass below have to opt out of
         tone mapping themselves, or she alone would be graded by a curve
         nothing else in the scene is using — see that pass for why. */
      object.traverse((obj) => {
        for (const mat of [obj.material ?? []].flat()) mat.toneMapped = false;
      });
      return { object, mixer, actions };
    }).catch((err) => {
      console.warn('farm: the farmer could not be loaded', err);
      return null;
    });

    bodies.set(gender, pending);
    return pending;
  }

  /** Crossfades to a clip, restarting it only when it is not already the one. */
  function playClip(name, { once = false, seconds = null } = {}) {
    if (!body || clipPlaying === name) return;
    const next = body.actions[name];
    if (!next) return;

    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    // A one-shot is stretched to the beat the rules keep, rather than the
    // rules being made to wait however long the animator's version runs.
    if (seconds) next.setDuration(seconds);
    next.fadeIn(CLIP_FADE).play();

    const previous = clipPlaying && body.actions[clipPlaying];
    if (previous) previous.fadeOut(CLIP_FADE);
    clipPlaying = name;
  }

  /* Where she is and which way she is looking. Deliberately not in the save:
     this is somebody's position in a yard, not something the farm depends on,
     and it starts at the gate again on every load. */
  const at = { x: HOME.x, z: HOME.z };
  let facing = 0;
  let stance = 'idle'; // idle | walking | crouching | returning
  let crouchLeft = 0;

  /* The handler script.js calls on a tap. Returning true means this scene has
     taken the job on and will run the rules itself, later. Returning false
     leaves the tap to fire immediately, exactly as it did before there was a
     farmer to walk anywhere — which is what happens with no farmer chosen
     yet, and for a player who has asked for reduced motion, for whom a
     journey across the yard is precisely the thing they turned off. */
  bridge.setPlotActionHandler((idx, kind) => {
    if (reducedMotion()) return false;
    if (!bridge.getState().farmer) return false;
    // A second tap on a tile already on the list is the player being
    // impatient, not a second job.
    if (!isPlotSpokenFor(idx)) jobQueue.push({ type: 'plot', plot: idx, kind });
    return true;
  });

  // Same contract, for the pen: which action a tap meant is already known
  // (it came from a specific button on a specific animal's card), so there
  // is nothing to infer here beyond whether it has already been queued.
  bridge.setAnimalActionHandler((kind, id, action, extra) => {
    if (reducedMotion()) return false;
    if (!bridge.getState().farmer) return false;
    if (!isAnimalSpokenFor(kind, id)) jobQueue.push({ type: 'animal', kind, id, action, extra });
    return true;
  });

  // Where a queued animal currently sits — its index can shift as animals
  // are bought and sold, so this is asked fresh each time rather than
  // captured once when the job was queued. An animal that no longer exists
  // (sold, or lost while she was on her way) falls back to its row's first
  // column: she still walks and crouches, and finishJob's re-check is what
  // actually drops a job for an animal that is not there any more.
  function animalWorldPos(kind, id) {
    const def = bridge.ANIMALS[kind];
    const idx = bridge.getState()[def.stateKey].findIndex((a) => a.id === id);
    return animalSlot(kind, idx === -1 ? 0 : idx);
  }

  function jobTarget(job) {
    const spot = job.type === 'plot' ? tileWorldPos(job.plot) : animalWorldPos(job.kind, job.id);
    return { x: spot.x, z: spot.z + STAND_OFF };
  }

  function stepToward(tx, tz, dt) {
    const dx = tx - at.x;
    const dz = tz - at.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const step = Math.min(WALK_SPEED * dt, dist);
    at.x += (dx / dist) * step;
    at.z += (dz / dist) * step;
    facing = Math.atan2(dx, dz);
    return step >= dist;
  }

  function finishJob() {
    const job = activeJob;
    activeJob = null;
    stance = 'idle';
    if (job.type === 'plot') {
      if (bridge.plotIntent(job.plot) === job.kind) bridge.runPlotIntent(job.plot, job.kind);
    } else if (bridge.animalActionValid(job.kind, job.id, job.action, job.extra)) {
      bridge.runAnimalAction(job.kind, job.id, job.action, job.extra);
    }
  }

  /* Starting over, and picking up a newer save from another tab, both swap
     the whole world for a different one. A job queued against the old farm
     means nothing against the new one — plot 3 is a different plot now — so
     the round is dropped rather than carried over. The object identity is the
     signal: the rules replace `state` wholesale in both cases. */
  let worldRef = bridge.getState();

  /* -------------------------------------------------------------- */
  /* Driving her yourself                                              */
  /* -------------------------------------------------------------- */

  /* Two ways to move her, on purpose, and the reason is not indecision.
     Driving is the better game — it is what the reference tier does, and it
     is what step 6 is for. But the queue underneath it is the path a keyboard
     and a screen reader take, and deleting it before step 12 has built the
     replacement would be shipping a regression dressed as a feature. So the
     stick moves her, and anything that queues a job still works; taking hold
     of the stick simply drops whatever round she was on, because a player
     steering is a player who has changed their mind. */
  const drive = { x: 0, z: 0 };
  const DRIVE_DEADZONE = 0.12;

  /** Set from the keyboard and the on-screen stick, in the range -1..1. */
  function setDrive(x, z) {
    drive.x = Math.max(-1, Math.min(1, x || 0));
    drive.z = Math.max(-1, Math.min(1, z || 0));
  }

  const driving = () => Math.hypot(drive.x, drive.z) > DRIVE_DEADZONE;

  /* The whole farm, now that there is one: orchard to the north, dooryard to
     the south, pasture east. She stops at the flat ground's edge rather than
     wandering up the hills, which are scenery and have nothing on them. */
  const ROAM = {
    minX: FARM_LEFT + 0.3,
    maxX: FARM_RIGHT - 0.3,
    minZ: FARM_NORTH + 0.3,
    maxZ: FARM_SOUTH - 0.3,
  };

  function steer(dt) {
    const mag = Math.min(1, Math.hypot(drive.x, drive.z));
    const step = WALK_SPEED * mag * dt;
    at.x = Math.max(ROAM.minX, Math.min(ROAM.maxX, at.x + (drive.x / mag) * step));
    at.z = Math.max(ROAM.minZ, Math.min(ROAM.maxZ, at.z + (drive.z / mag) * step));
    facing = Math.atan2(drive.x, drive.z);
  }

  function advanceFarmer(dt) {
    const world = bridge.getState();
    if (world !== worldRef) {
      worldRef = world;
      jobQueue.length = 0;
      activeJob = null;
      stance = 'idle';
    }

    if (driving()) {
      // Hands on the stick win: the round she was walking is abandoned rather
      // than resumed the moment she is let go of, which would feel haunted.
      jobQueue.length = 0;
      activeJob = null;
      steer(dt);
      stance = 'walking';
      return;
    }

    if (!activeJob && jobQueue.length > 0) activeJob = jobQueue.shift();

    if (activeJob) {
      if (stance === 'crouching') {
        crouchLeft -= dt * 1000;
        if (crouchLeft <= 0) finishJob();
        return;
      }
      const target = jobTarget(activeJob);
      if (stepToward(target.x, target.z, dt)) {
        stance = 'crouching';
        crouchLeft = CROUCH_MS;
      } else {
        stance = 'walking';
      }
      return;
    }

    /* She no longer trudges back to the gate on her own. Under the queue that
       was the only way to know where she would be next time; now the player
       decides, and putting her back would be undoing their last instruction. */
    stance = 'idle';
  }

  /* -------------------------------------------------------------- */
  /* What she could do from where she is standing                      */
  /* -------------------------------------------------------------- */

  /* Reach, in world units. Generous enough that a player does not have to
     land on a tile centre, tight enough that the answer is never ambiguous:
     tiles are 1.15 apart, so this cannot straddle two of them. */
  const REACH = 0.95;

  /** The nearest thing worth offering, or null. Recomputed as she moves. */
  function nearestTarget() {
    const world = bridge.getState();
    if (!world.farmer) return null;

    let best = null;
    const consider = (candidate, pos) => {
      const d = Math.hypot(pos.x - at.x, pos.z - at.z);
      if (d > REACH || (best && d >= best.distance)) return;
      best = { ...candidate, distance: d };
    };

    for (let i = 0; i < bridge.PLOT_COUNT; i += 1) {
      const intent = bridge.plotIntent(i);
      // plotIntent is null for a tile there is nothing useful to do to.
      if (intent) consider({ type: 'plot', plot: i, intent }, tileWorldPos(i));
    }

    for (const kind of bridge.LIVESTOCK_ORDER) {
      const def = bridge.ANIMALS[kind];
      world[def.stateKey].forEach((animal, index) => {
        const intent = bridge.animalIntent(kind, animal.id);
        if (intent) consider({ type: 'animal', kind, id: animal.id, intent }, animalSlot(kind, index));
      });
    }

    return best;
  }

  /* Reported to the UI rather than drawn here: the prompt is a real button in
     the DOM, so it is reachable by tab, announced by a screen reader and
     styled with the rest of the interface, none of which a label painted into
     the canvas would be.

     Sent every drawn frame, unconditionally. An earlier version only sent
     changes, keyed on the target and its intent, and that key was wrong in a
     way worth remembering: picking a different seed changes what the button
     should say without changing either, so the prompt went on offering to
     plant a crop the player had stopped choosing. Whether anything needs
     repainting is a question about the label, so it is answered where the
     label is written — see showPrompt in script.js. */
  function syncPrompt() {
    bridge.showPrompt(nearestTarget());
  }

  /* The camera keeps her in the middle of the picture without taking the look
     of the place away from the player: OrbitControls still owns the angle and
     the distance, and all this does is slide its target — and the camera with
     it, by the same vector — to wherever she is. Drag still orbits, pinch
     still zooms, and neither fights the follow, because the follow never
     touches the offset between the two.

     Eased rather than snapped. At a walking pace a hard lock reads as the
     world sliding under a fixed farmer, which is both uglier and, on a scene
     with a horizon in it, faintly seasick. */
  const FOLLOW_EASE = 0.12;
  const followTmp = new THREE.Vector3();

  function followFarmer() {
    if (!bridge.getState().farmer) return;
    followTmp.set(at.x, 1.1, at.z).sub(controls.target).multiplyScalar(FOLLOW_EASE);
    controls.target.add(followTmp);
    camera.position.add(followTmp);
  }

  /* Drawing time, not simulation time: the walk is stepped by advanceFarmer on
     every frame whether or not the field is on screen, but the limbs only need
     to move when someone is looking, and feeding the mixer a gap that spans a
     spell on the Market tab would teleport her through half a stride. */
  let lastPoseAt = 0;

  function poseFarmer(now) {
    const gender = bridge.getState().farmer;
    const poseDt = lastPoseAt ? Math.min((now - lastPoseAt) / 1000, 0.1) : 0;
    lastPoseAt = now;

    if (!gender) {
      farmer.visible = false;
      return;
    }

    if (gender !== bodyGender) {
      bodyGender = gender;
      // Resolves immediately once cached, so switching back is not a reload.
      ensureBody(gender).then((loaded) => {
        if (bodyGender !== gender || !loaded) return;
        if (body) farmer.remove(body.object);
        body = loaded;
        clipPlaying = null;
        farmer.add(body.object);
      });
    }

    farmer.visible = !!body;
    if (!body) return;

    const moving = stance === 'walking' || stance === 'returning';
    if (stance === 'crouching') playClip(FARMER_CLIP.crouching, { once: true, seconds: CROUCH_MS / 1000 });
    else playClip(moving ? FARMER_CLIP.walking : FARMER_CLIP.idle);

    /* The walk cycle is played at the speed she is actually covering ground,
       so her feet stay planted instead of skating: the clip is authored for
       CLIP_WALK_SPEED, and anything else is that much faster or slower. */
    const walkAction = body.actions[FARMER_CLIP.walking];
    if (walkAction) walkAction.timeScale = WALK_SPEED / CLIP_WALK_SPEED;

    body.mixer.update(poseDt);
    farmer.position.set(at.x, 0, at.z);
    farmer.rotation.y = facing + MODEL_FACING_OFFSET;
  }

  /* Every material but the sky's opts out of the tone mapping the renderer
     turned on above. That mapping exists because Sky.js's HDR output clips
     to white without it — nothing else in this scene has that problem,
     and everything else was tuned, carefully, entirely without it (the
     day/night lighting curve is step 9's, and ACES's toe crushes toward
     black hard enough at low intensity that reaching for it there would
     mean re-deriving that whole curve rather than trusting what already
     shipped and was already verified). One pass over everything already
     built, instead of setting the flag at each material's own
     construction, is what keeps this true as the farmer and the herd —
     built above but never named here — join the scene without each one
     having to remember to opt out. */
  scene.traverse((obj) => {
    if (obj === sky || !obj.material) return;
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      mat.toneMapped = false;
    }
  });

  /* -------------------------------------------------------------- */
  /* Post-processing, and the budget that decides how much of it runs  */
  /* -------------------------------------------------------------- */

  /* Three tiers, because this scene has to look like a game on a desktop GPU
     and still not starve a software-rendered Chromium sharing a CI box with
     three of its siblings. That is not a hypothetical: shadows were tried and
     dropped twice on exactly that path (see the note by the renderer above),
     both times discovered by a red CI run rather than by measurement. So the
     budget below is wired in from the start, and the scene steps itself down
     rather than being told what a machine can afford. */
  const QUALITY = { FULL: 2, BLOOM: 1, PLAIN: 0 };

  /* Ask the driver what it is before drawing anything, because finding out by
     measurement is not free. A software rasteriser draws this scene's full
     chain at about 800ms a frame, so the budget below needs several draws —
     five seconds or so — to reach the obvious conclusion, and it pays that on
     every page load. Across a test suite that loads the page a few hundred
     times it took the run from under seven minutes to over twenty, against a
     CI timeout of ten: the measurement was costing far more than the feature
     was worth. The string is a hint rather than a contract, which is why the
     measured budget still runs underneath it and still has the last word on
     hardware that reports itself as real and then doesn't keep up. */
  function rendererIsSoftware() {
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|softwarerasterizer|software/i.test(name);
    } catch {
      return false; // Refused the question: fall back to measuring.
    }
  }

  let quality = rendererIsSoftware() ? QUALITY.PLAIN : QUALITY.FULL;

  /* Nothing below is built at all when the answer was already "plain". The
     chain is not free to merely exist: two half-float render targets for the
     composer, three more for the ambient occlusion, five mip levels for the
     bloom, and every one of their shaders compiled — all of it allocated at
     load, on a machine that has already said it cannot afford to draw any of
     it. Building it anyway kept the suite 46% slower than baseline even after
     the tier itself was being chosen correctly. Since the budget only ever
     steps down, starting at the bottom means these are never wanted, so the
     honest thing is not to make them.

     Everything after this therefore has to cope with `post` being null, which
     is exactly the set of places that would otherwise have to cope with a
     composer that is built but must not be used. */
  const post = quality === QUALITY.PLAIN ? null : buildPostProcessing();

  function buildPostProcessing() {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    /* Contact shadows in all but name, and the one effect here that pays for
       itself in the view the game actually opens on. With shadow mapping ruled
       out twice on cost, this is what grounds a crop or a fence post on the
       terrain it stands on instead of leaving it floating, and unlike a shadow
       map it costs the same whatever the scene is lit by or how many things
       are casting.

       The three numbers are not in the same units, which is worth stating
       because getting it wrong produces a pure white — entirely absent — AO
       buffer that looks exactly like a pass that isn't running. kernelRadius
       is world units (metres here). minDistance and maxDistance are compared
       against a depth difference normalised across the camera's near and far
       planes, 0.1 and 100 — so one of *those* units is about a hundred metres,
       and a centimetre of contact shadow is 0.0001, not 0.01. The first
       attempt read them as the same thing and used 0.0015 and 0.06, i.e. 15cm
       to 6m, which rejected every sample a 28cm kernel could produce. */
    const ssao = new SSAOPass(scene, camera, 1, 1);
    ssao.kernelRadius = 0.6;
    ssao.minDistance = 0.0001; // ~1cm
    ssao.maxDistance = 0.008;  // ~80cm
    composer.addPass(ssao);

    /* Bloom has almost nothing to do from the camera the game opens on, which
       frames no sky at all (see the long note by camera.position above): only
       the sky is tone-mapped, so it is effectively the one surface here that
       ever gets near this threshold, and it is out of shot. What this pass is
       for is the view a player reaches by dragging the camera up to the
       horizon, and the default view step 6 can finally afford once the plot
       buttons stop having to cover the field.

       Strength and radius are far below a first guess for that reason in
       reverse: with the sky in frame it is about a third of the picture, and
       bloom spreads brightness outward, so 0.32 strength at 0.62 radius did
       not read as a glow at all — it poured milk over the hills until they
       vanished, at midday and dusk alike. At a tight 0.15/0.3 the sky keeps
       its warmth and the hills keep their edges. Verified by screenshot from
       the step-6 framing, not from this one, where it would have looked like
       a no-op either way. */
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.3, 0.8);
    composer.addPass(bloom);

    /* sRGB conversion and nothing else, which is the whole reason this is
       GammaCorrectionShader and not the OutputPass that would normally close a
       composer chain. OutputPass also applies renderer.toneMapping to the
       finished image, and this scene's tone mapping is a per-material
       decision, not a per-image one: the sky needs ACES because its HDR output
       clips to white without it, and everything else must not have ACES
       because step 9's day/night curve was tuned without it and its toe
       crushes night to black. That is enforced by material.toneMapped just
       above, which a pass over the composited image would silently overrule —
       the exact trap the art bible flagged for this step. */
    composer.addPass(new ShaderPass(GammaCorrectionShader));

    return { composer, ssao, bloom };
  }

  /* What the budget measures is how far apart the draws actually land, not
     how long the draw call takes to return. Timing the call was tried first
     and is worthless here: GL queues the work and returns, so all three tiers
     measured one to two milliseconds and the most expensive one came out
     *fastest*. The gap between frames, by contrast, is the thing the player
     and the test runner both actually feel, and it counts GPU time, driver
     time and the rest of the page's main thread along with it. */
  // FRAME_INTERVAL_MS below asks for 30fps; this is the point below ~18fps
  // where the scene is judged to be costing the page more than it is worth.
  const BUDGET_INTERVAL_MS = 55;
  const BUDGET_SETTLE = 20;       // draws at a tier before a marginal verdict
  const BUDGET_WARMUP = 3;        // the first draws compile shaders; ignore them
  /* How far over budget counts as past arguing about. A machine three times
     over is not having a bad moment, it is the wrong machine for this tier,
     and waiting out the full window to say so is its own bug: at the 800ms
     frames measured on the software rasteriser CI uses, twenty draws is
     sixteen seconds, and most test pages do not live that long. So a verdict
     that extreme is acted on after three draws, while a marginal one still
     has to survive the full window before costing anyone their bloom. */
  const BUDGET_OBVIOUS = 3;
  let drawsSeen = 0;
  let drawsAtTier = 0;
  let intervalEma = 0;

  /* A moving average rather than a bucket that empties: a bucket has no
     answer at all for most of its life, which makes it useless both to the
     rule below and to anything asking what this scene is costing. */
  function chargeFrame(intervalMs) {
    drawsSeen += 1;
    drawsAtTier += 1;
    intervalEma = intervalEma ? intervalEma * 0.9 + intervalMs * 0.1 : intervalMs;
    if (drawsSeen <= BUDGET_WARMUP) return;
    if (quality === QUALITY.PLAIN || intervalEma <= BUDGET_INTERVAL_MS) return;
    const settle = intervalEma > BUDGET_INTERVAL_MS * BUDGET_OBVIOUS ? 3 : BUDGET_SETTLE;
    if (drawsAtTier <= settle) return;

    /* Steps down only, never back up. An oscillating quality setting is worse
       to look at than the lower tier it keeps returning to, and the thing
       being measured — how much machine this page is being given — does not
       usually improve mid-session. */
    quality = quality === QUALITY.FULL ? QUALITY.BLOOM : QUALITY.PLAIN;
    post.ssao.enabled = quality >= QUALITY.FULL;
    post.bloom.enabled = quality >= QUALITY.BLOOM;
    drawsAtTier = 0;
    intervalEma = 0; // the old tier's cost says nothing about the new one
  }

  /* -------------------------------------------------------------- */
  /* The controls a player actually touches                            */
  /* -------------------------------------------------------------- */

  /* Held keys rather than key events: a key that is down should keep her
     walking, and keydown repeat is a text-entry cadence, not a movement one.
     Both WASD and the arrows, because both are what people try. */
  const held = new Set();
  const KEY_VECTORS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };

  function applyHeldKeys() {
    let x = 0;
    let z = 0;
    for (const code of held) {
      const v = KEY_VECTORS[code];
      if (v) { x += v[0]; z += v[1]; }
    }
    setDrive(x, z);
  }

  /* Typing in a field, or tabbing around the panels, must not walk her into a
     fence. Only the canvas and the body itself count as "playing". */
  const typingTarget = (el) => !!el && (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
  );

  window.addEventListener('keydown', (event) => {
    if (typingTarget(event.target)) return;
    if (KEY_VECTORS[event.code]) {
      held.add(event.code);
      applyHeldKeys();
      // Arrows scroll the page otherwise, which fights the farm for the view.
      event.preventDefault();
      return;
    }
    /* Space acts on whatever is in reach — but only when the player is not
       on a button, where space is already that button's own job. */
    if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
      if (bridge.runPrompt()) event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (!held.delete(event.code)) return;
    applyHeldKeys();
  });

  // A tab switch or a lost window leaves keys stuck down otherwise, and she
  // walks into the fence for as long as nobody is looking.
  const releaseAll = () => { held.clear(); setDrive(0, 0); };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  /* The on-screen stick. Pointer events rather than touch events so a mouse
     drag on it works too, which is the only way it can be tested and a
     convenience on a laptop besides. */
  const stick = document.getElementById('driveStick');
  const knob = document.getElementById('driveKnob');
  if (stick && knob) {
    const RADIUS = 44; // matches the CSS; the knob travels this far from centre
    let pointerId = null;

    const move = (event) => {
      const box = stick.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(dist, RADIUS);
      knob.style.transform = `translate(${(dx / dist) * clamped}px, ${(dy / dist) * clamped}px)`;
      setDrive((dx / dist) * (clamped / RADIUS), (dy / dist) * (clamped / RADIUS));
    };

    const release = () => {
      pointerId = null;
      knob.style.transform = '';
      setDrive(0, 0);
    };

    stick.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      stick.setPointerCapture(pointerId);
      move(event);
      event.preventDefault();
    });
    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointerId) move(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      stick.addEventListener(type, release);
    }
  }

  /* How much work is outstanding. The tests wait on this rather than on a
     stopwatch, and it is the honest question to ask when debugging: has the
     tap been taken, and has it been carried out? */
  window.Farm3DScene = {
    pendingActions: () => jobQueue.length + (activeJob ? 1 : 0),
    /* What the budget above settled on, so a test can assert the scene
       degrades rather than dying on a machine that cannot afford it. */
    quality: () => quality,
    frameIntervalMs: () => intervalEma,
    /* Which authored clip is driving the farmer, or null before her model has
       arrived — the honest question to ask of the animation, in the same way
       pendingActions is the honest question to ask of the queue. */
    farmerClip: () => clipPlaying,
    /* Where she is standing, and what is in reach of it. The tests drive her
       with these rather than by waiting out a walk on a stopwatch. */
    farmerAt: () => ({ x: at.x, z: at.z }),
    reachable: () => nearestTarget(),
    /* How many instances of each foliage species got scattered, and a way to
       wait for that to be settled rather than guessing at a delay — the
       scatter runs after loadMeshes resolves, same as the props above, and
       there is otherwise nothing in the DOM to say it happened at all. */
    foliageCounts: () => ({ ...foliageCounts }),
    foliageReady: () => foliageReady,
    /* Steering from a test, in the same units the stick reports. Left in
       rather than hidden behind a debug flag: it is the only way to exercise
       free movement without synthesising a drag on every assertion, and it is
       the same call the stick and the keys already make. */
    drive: (x, z) => setDrive(x, z),
  };

  /* -------------------------------------------------------------- */
  /* Resize and the render loop                                        */
  /* -------------------------------------------------------------- */

  /* #plotsGrid stays a plain CSS grid (see styles.css) rather than being
     positioned from this camera — deliberately. An earlier version of this
     file projected each tile's corners to lay the accessibility buttons out
     pixel-for-pixel under the perspective view, and it was wrong in a way
     that only showed up under real touch input: at this grid's on-screen
     size a tile's natural spacing is smaller than the 44px touch-target
     floor, so neighbouring buttons' hit areas overlapped, and which one won
     depended on a hit-test race between the compositor and the DOM — a tap
     square in the middle of one tile could resolve to its neighbour. A CSS
     grid's cells can't overlap each other, so that failure mode is gone
     entirely; what's lost is pixel-perfect alignment between an invisible
     button and its receding tile, which costs nothing since neither is ever
     seen at the same time (see the opacity rule on .plot). */

  const resizeObserver = new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    // The composer keeps its own render targets, which are useless at the
    // wrong size — a resize that skipped this would stretch the last frame.
    if (post) post.composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);

  function farmTabVisible() {
    const tab = document.getElementById('farmTab');
    return !!tab && !tab.classList.contains('hidden');
  }

  // Nothing in this scene needs 60fps — the fastest thing in it is a farmer
  // walking — so drawing is paced to 30 rather than however fast
  // requestAnimationFrame wants to run. Halving the render calls halves the
  // main thread time this scene takes from everything else on the page.
  const FRAME_INTERVAL_MS = 1000 / 30;
  let lastDrawAt = 0;
  let lastStepAt = 0;

  /* A backgrounded tab is where rAF genuinely stops — the browser simply
     never calls frame() again until the tab is visible, at which point the
     one call that does land carries a real-world gap that can be minutes
     long. Catching that here, at the instant it closes, means the walk step
     below can credit real elapsed time unconditionally: this is the only
     place a gap needs discounting, so it is the only place that does it,
     rather than a per-frame cap that cannot tell why a gap happened.

     A version of this used to live as Math.min(dt, 0.1) inside frame() —
     capping every tick's step, not just the one after a real background gap.
     That is wrong for a tab that is merely slow rather than hidden: under
     four-worker CI contention on this box's four cores, rAF itself starves
     to a handful of ticks a second while the tab stays fully visible the
     whole time, and each of those rare ticks was still only allowed to credit
     100ms — so a walk that should finish in under a second was measured
     taking upwards of five, well past what "planting a seed costs coins and
     fills the plot" and its neighbours were waiting on, and that pair failed
     10 of 12 runs at --workers=4 with the cap in place. Removing the cap and
     discounting only the one real gap fixed it: the same stress run held
     12 of 12. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lastStepAt = 0;
  });

  function frame(now) {
    requestAnimationFrame(frame);

    // She keeps walking whether or not the field is on screen. A job taken
    // on the Farm tab has to finish even if the player flicks over to the
    // Market a moment later, or the tap would be quietly lost — so only the
    // drawing below is skipped, never the walking.
    const dt = lastStepAt ? (now - lastStepAt) / 1000 : 0;
    lastStepAt = now;
    advanceFarmer(dt);

    /* Backgrounded tab, or a different in-game tab open: nothing to draw, so
       skip the GPU work entirely rather than render an invisible scene.
       Forgetting when we last drew is what keeps the gap spent on the Market
       from being charged to the budget below as a very slow frame — the first
       draw after coming back has nothing to be measured against.

       This is deliberately not a "ignore any gap longer than X" rule, which
       is what it was first written as. That version could not tell a slow
       frame from a tab that wasn't drawing, so it went blind at exactly the
       frame times the budget exists to catch: on the software rasteriser here
       every interval sat above the threshold and the average never moved off
       zero, quietly disabling the step-down on the machines that need it. */
    if (document.hidden || !farmTabVisible()) {
      lastDrawAt = 0;
      return;
    }
    if (now - lastDrawAt < FRAME_INTERVAL_MS) return;
    if (lastDrawAt) chargeFrame(now - lastDrawAt);
    lastDrawAt = now;
    syncSky();
    syncPlots(now);
    syncAnimals(now);
    poseFarmer(now);
    syncPrompt();
    followFarmer();
    controls.update();

    if (post && quality !== QUALITY.PLAIN) post.composer.render();
    else renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
