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
  const FLAT_MARGIN = 0.6;
  const FLAT_LEFT = -yardHalf - FLAT_MARGIN;
  const FLAT_RIGHT = PEN_CX + PEN_HALF_X + FLAT_MARGIN;
  const FLAT_HALF_Z = Math.max(yardHalf, PEN_HALF_Z) + FLAT_MARGIN;
  const FLAT_CENTER_X = (FLAT_LEFT + FLAT_RIGHT) / 2;
  const FLAT_HALF_X = (FLAT_RIGHT - FLAT_LEFT) / 2;

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
    const dz = Math.max(0, Math.abs(z) - FLAT_HALF_Z);
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
  camera.position.set(VIEW_CX, 6.5, 6.3);
  camera.lookAt(VIEW_CX, 0.2, 0);
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
  controls.target.set(VIEW_CX, 0.4, 0);
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
  const FARMER_SCALE = 1.05;                     // big enough to read at this camera distance
  /* Where she waits: inside the gate, off to one side of the field so she is
     not standing in front of the front row, and far enough from the corner
     to stay inside the frame. */
  const HOME = { x: -1.45, z: SPAN / 2 + 0.2 };

  const SKIN = 0xe8b98a;
  const STRAW = 0xd8b25e;
  const HAIR = 0x4a3220;
  const SHIRT = { female: 0xd46a92, male: 0x4f86c6 };
  const LEGS = { female: 0x8c4f6d, male: 0x3f5d80 };

  const farmer = new THREE.Group();
  farmer.visible = false;
  scene.add(farmer);

  const shirtMat = new THREE.MeshStandardMaterial({ color: SHIRT.female, roughness: 0.85 });
  const legMat = new THREE.MeshStandardMaterial({ color: LEGS.female, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 1 });
  const strawMat = new THREE.MeshStandardMaterial({ color: STRAW, roughness: 1 });

  /* A limb pivots at the shoulder or hip, so its geometry is shifted to hang
     below the origin and the mesh is placed at the joint. */
  function limb(w, h, d, material) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    return new THREE.Mesh(geo, material);
  }

  const legL = limb(0.13, 0.44, 0.14, legMat);
  const legR = limb(0.13, 0.44, 0.14, legMat);
  legL.position.set(-0.1, 0.44, 0);
  legR.position.set(0.1, 0.44, 0);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.24), shirtMat);
  torso.position.y = 0.65;

  const armL = limb(0.1, 0.36, 0.11, shirtMat);
  const armR = limb(0.1, 0.36, 0.11, shirtMat);
  armL.position.set(-0.22, 0.83, 0);
  armR.position.set(0.22, 0.83, 0);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.145, 0), skinMat);
  head.position.y = 1.0;

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.16), hairMat);
  hair.position.set(0, 0.95, -0.09);

  /* A straw hat says "farmer" at this distance better than any detail on a
     face four pixels across — but the camera looks down at 40°, so a wide
     brim becomes a disc with a person hidden under it. Narrow enough that
     the shoulders still read. */
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.15, 8), strawMat);
  hat.position.y = 1.12;

  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.36, 8), legMat);
  skirt.position.y = 0.34;

  farmer.add(legL, legR, torso, armL, armR, head, hair, hat, skirt);

  let dressedAs = null;

  function dressFarmer(gender) {
    shirtMat.color.set(SHIRT[gender] || SHIRT.female);
    legMat.color.set(LEGS[gender] || LEGS.female);
    // The only two silhouette changes: the skirt, and how far the hair falls.
    skirt.visible = gender === 'female';
    hair.scale.y = gender === 'female' ? 1.35 : 1;
    hair.position.y = gender === 'female' ? 0.9 : 0.95;
    dressedAs = gender;
  }

  /* Where she is and which way she is looking. Deliberately not in the save:
     this is somebody's position in a yard, not something the farm depends on,
     and it starts at the gate again on every load. */
  const at = { x: HOME.x, z: HOME.z };
  let facing = 0;
  let stance = 'idle'; // idle | walking | crouching | returning
  let crouchLeft = 0;
  let walkPhase = 0;

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
    // Tied to distance rather than time, so the legs cannot windmill on a
    // frame that took too long.
    walkPhase += step * 7;
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

  function advanceFarmer(dt) {
    const world = bridge.getState();
    if (world !== worldRef) {
      worldRef = world;
      jobQueue.length = 0;
      activeJob = null;
      stance = 'idle';
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

    stance = stepToward(HOME.x, HOME.z, dt) ? 'idle' : 'returning';
  }

  function poseFarmer() {
    const gender = bridge.getState().farmer;
    farmer.visible = !!gender;
    if (!gender) return;
    if (gender !== dressedAs) dressFarmer(gender);

    const moving = stance === 'walking' || stance === 'returning';
    const swing = moving ? Math.sin(walkPhase) * 0.5 : 0;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;

    // Down and back up across the crouch, so the crop pops as she rises.
    const crouch = stance === 'crouching'
      ? 1 - 0.24 * Math.sin(Math.PI * (1 - Math.max(crouchLeft, 0) / CROUCH_MS))
      : 1;
    farmer.scale.set(FARMER_SCALE, FARMER_SCALE * crouch, FARMER_SCALE);
    farmer.position.set(at.x, moving ? Math.abs(Math.sin(walkPhase)) * 0.035 : 0, at.z);
    farmer.rotation.y = facing;
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

  /* How much work is outstanding. The tests wait on this rather than on a
     stopwatch, and it is the honest question to ask when debugging: has the
     tap been taken, and has it been carried out? */
  window.Farm3DScene = {
    pendingActions: () => jobQueue.length + (activeJob ? 1 : 0),
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

  function frame(now) {
    requestAnimationFrame(frame);

    /* She keeps walking whether or not the field is on screen. A job taken
       on the Farm tab has to finish even if the player flicks over to the
       Market a moment later, or the tap would be quietly lost — so only the
       drawing below is skipped, never the walking. The step is capped so
       that coming back to a backgrounded tab, where rAF stops entirely,
       resumes at walking pace instead of teleporting her across the yard. */
    const dt = lastStepAt ? Math.min((now - lastStepAt) / 1000, 0.1) : 0;
    lastStepAt = now;
    advanceFarmer(dt);

    // Backgrounded tab, or a different in-game tab open: nothing to draw,
    // so skip the GPU work entirely rather than render an invisible scene.
    if (document.hidden || !farmTabVisible()) return;
    if (now - lastDrawAt < FRAME_INTERVAL_MS) return;
    lastDrawAt = now;
    syncSky();
    syncPlots(now);
    syncAnimals(now);
    poseFarmer();
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
