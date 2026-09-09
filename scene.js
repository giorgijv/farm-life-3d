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

  /* How far into night we are, last time the sky was synced. The water below
     needs the same number — its sun glint has to die with the sun rather than
     glittering at midnight — and this is cheaper and less brittle than a
     second bridge.daySkyState() call in the same frame that could, if the
     clock ticked between them, disagree with the sky it is reflecting. */
  let skyNight = 0;

  /* 1 for a clear sky, dimmer as a hurricane closes in — the same
     stormProximity ramp the 2D sky and the day label already key off, so
     the 3D yard never disagrees with the forecast above it. The wobble on
     top is valueNoise sampled by clock time instead of position, the same
     function the terrain and the foliage scatter already use for their own
     texture, so the cloud cover drifts across the three warning days
     instead of snapping to one flat darkness for all of them. */
  function cloudFactor(now, proximity) {
    if (proximity <= 0) return 1;
    const drift = valueNoise(now * 0.00015, 0);
    return 1 - proximity * (0.55 + drift * 0.25);
  }

  function syncSky(now) {
    const { phase, nightFactor } = bridge.daySkyState();
    skyNight = nightFactor;
    const cloud = cloudFactor(now, bridge.stormProximity());

    lerpStops(scene.background, BG_STOPS, nightFactor);
    scene.fog.color.copy(scene.background);
    lerpStops(hemi.color, HEMI_SKY_STOPS, nightFactor);
    lerpStops(hemi.groundColor, HEMI_GROUND_STOPS, nightFactor);
    hemi.intensity = (0.22 + 0.63 * (1 - nightFactor)) * cloud;

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
    sun.intensity = Math.max(0.05, 1.15 * (1 - nightFactor * 0.94)) * cloud;
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

  /* Where the keyboard is looking: a caret hanging over that tile.

     Two things were tried before this one, and both failed for reasons worth
     keeping. A tint on the soil is invisible — at this distance tinted soil
     against soil disappears into the lighting. A bright patch laid flat over
     the tile is invisible for a better reason: this camera sits about twenty
     degrees above the ground, so a one-unit square lying on it foreshortens
     to a bar around eighty pixels wide and eight tall. Drawn in hot magenta
     at full opacity to find out whether it was being drawn at all, it was
     still only a sliver. The same geometry that cost step 4 its horizon
     costs any flat marker its legibility.

     So the marker stands up instead of lying down. A caret above the tile
     keeps its height whatever the camera's pitch, reads at once as "this
     one", and sits clear of whatever is growing rather than over it.
     MeshBasicMaterial, so it takes no light: a focus indicator that dims at
     dusk with everything else stops doing its job for half of every day. */
  const SELECTION_TOP = 1.45; // clears a ripe corn stalk, the tallest crop
  const selectionInk = new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false });
  const selection = new THREE.Group();
  {
    /* A head and a stem, not just a head: hung on its own at a height that
       clears the corn, the caret floats up by the treeline and stops
       obviously belonging to any one tile. The stem is what says which. */
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4).rotateY(Math.PI / 4), selectionInk);
    head.rotation.x = Math.PI; // tipped over, so it points down at its tile
    head.position.y = SELECTION_TOP;
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.035, SELECTION_TOP - 0.3, 0.035), selectionInk);
    stem.position.y = (SELECTION_TOP - 0.3) / 2 + 0.12;
    selection.add(head, stem);
  }
  selection.visible = false;
  scene.add(selection);

  /* -------------------------------------------------------------- */
  /* Crops — the real thing, once there is enough of one to show       */
  /* -------------------------------------------------------------- */

  /* Only "rotten" still has no model of its own — the kit has nothing that
     is a wilted, unharvested crop, and stretching one of its healthy
     stages to mean the opposite would read worse than the abstract shape
     below. A squashed cone and a squashed icosahedron, in the same rotten
     colours the 2D grid's own rotten sprite uses, cover every crop alike:
     what has gone off no longer needs to say which crop it was. */
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

  const ROTTEN_STALK = 0x8a8267;
  const ROTTEN_HEAD = 0x6b6250;
  /* A partial tint, not a full swap: the old headMesh had no real appearance
     of its own to protect — it was a plain icosahedron in whatever colour it
     was told — so wilting could just replace that colour outright. A real
     wheat or pumpkin model has its own authored look, and overwriting it
     entirely would hide the very crop the rest of this step exists to show;
     lerping partway toward this instead lets the shape and its texture keep
     reading while the colour still visibly sours. */
  const WILT_TINT = new THREE.Color(0xb0742a);

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

  /* Every crop starts as the same two generic sprouts regardless of what it
     will become — the same beat the 2D grid's 🌱/🌿 swap keeps, modelled
     instead of iconified. Only once a plot reaches the stage worth telling
     crops apart at does it diverge into what it actually is. */
  const SPROUT_MODEL = ['nature/crops_leafsStageA', 'nature/crops_leafsStageB'];

  /* What a crop looks like from there on — and, for wheat and corn, a
     second look for "grown but not yet ripe" that the kit happens to ship
     and the 2D grid does not distinguish at all (both stay the same emoji
     until the progress bar underneath says otherwise; see plotGrowthStage
     in script.js). Carrot and pumpkin get one model for the whole of that
     stage: the kit ships no half-grown carrot or pumpkin, and inventing one
     would be dressing up a guess as an asset, the same call §18 made about
     a resting pose for the guardians. */
  const CROP_STAGE_MODEL = {
    wheat: { growing: 'nature/crops_wheatStageA', ripe: 'nature/crops_wheatStageB' },
    corn: { growing: 'nature/crops_cornStageB', ripe: 'nature/crops_cornStageD' },
    carrot: { growing: 'nature/crop_carrot', ripe: 'nature/crop_carrot' },
    pumpkin: { growing: 'nature/crop_pumpkin', ripe: 'nature/crop_pumpkin' },
  };

  const CROP_MODEL_IDS = [...new Set([
    ...SPROUT_MODEL,
    ...Object.values(CROP_STAGE_MODEL).flatMap((s) => [s.growing, s.ripe]),
  ])];

  /* A small fixed spin per plot, not a random one re-rolled on every
     rebuild: sixteen identical stalks all facing the same way reads as a
     diagram, and re-rolling it on every state change would make a crop
     visibly spin in place the moment it ripened. Golden-angle spacing is
     what keeps sixteen neighbours from ever landing on the same angle by
     coincidence, the same trick a seeded scatter would reach for if this
     needed to vary by more than a plot's own fixed index. */
  function cropSpin(i) {
    return (i * 2.399963) % (Math.PI * 2);
  }

  /* One InstancedMesh per primitive per model — a stage with two materials
     (wheat's ripe head is grain-colour plus stem-colour) is two meshes
     moving together, same as a foliage species with a trunk and a canopy in
     §15. Capacity is PLOT_COUNT because the worst case is every plot
     showing this exact stage of this exact crop at once. Loaded once, at
     startup, same as the foliage species: fetched here rather than waited
     for, and drawn nowhere until it arrives — a plot just shows nothing at
     that stage for the one frame it might take. */
  const cropMeshes = {}; // model id -> InstancedMesh[]
  function loadCropModel(id) {
    return loadMeshes(id).then(({ meshes }) => {
      cropMeshes[id] = meshes.map(({ geometry, material }) => {
        material.toneMapped = false;
        const mesh = new THREE.InstancedMesh(geometry, material, PLOT_COUNT);
        for (let i = 0; i < PLOT_COUNT; i += 1) hideInstance(mesh, i, 0, 0);
        scene.add(mesh);
        return mesh;
      });
    }).catch((err) => console.warn(`farm: ${id} did not load`, err));
  }
  // Collected so a test can wait on every crop stage having arrived rather
  // than guessing at a delay — same reason foliageReady exists in §15.
  const cropModelsReady = Promise.all(CROP_MODEL_IDS.map(loadCropModel));

  /** Hides every crop-stage model's instance i — the default for a frame
      before whichever one is actually growing there gets shown. */
  function hideCropStage(i) {
    for (const id of CROP_MODEL_IDS) {
      for (const mesh of cropMeshes[id] ?? []) hideInstance(mesh, i, 0, 0);
    }
  }

  /** Shows model id's instance i at (x, y, z) with the plot's own fixed
      spin, tinted by colorHex (0xffffff for "exactly as authored") — always
      passed, never left to the caller's judgement, because InstancedMesh
      lazily allocates its per-instance colour buffer on the first
      setColorAt call and leaves every other instance in it at black until
      it too is told otherwise; skipping the "no tint" case for an instance
      that has never wilted would only go wrong the day a neighbour that
      shares this same mesh finally does. Assumes hideCropStage(i) already
      ran this frame — this only ever turns one stage's visibility back on,
      never off. */
  function showCropStage(id, i, x, y, z, colorHex) {
    const meshes = cropMeshes[id];
    if (!meshes) return; // still being fetched; nothing to draw yet
    const spin = cropSpin(i);
    for (const mesh of meshes) {
      tmpMatrix.compose(
        tmpPos.set(x, y, z),
        tmpQuat.setFromAxisAngle(Y_UP, spin),
        tmpScale.set(1, 1, 1),
      );
      mesh.setMatrixAt(i, tmpMatrix);
      mesh.setColorAt(i, tmpColor.set(colorHex));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Which crop-stage model, if any, currently has a visible (non-zero
      scale) instance at plot i — the honest question a test can ask instead
      of trusting that hideCropStage and showCropStage never disagree about
      whose turn it is. Reads the matrix straight back off the mesh rather
      than re-deriving the answer from game state, so it can catch this
      code lying about itself, not just echo it. */
  function activeCropStage(i) {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const id of CROP_MODEL_IDS) {
      const mesh = (cropMeshes[id] ?? [])[0];
      if (!mesh) continue;
      mesh.getMatrixAt(i, m);
      m.decompose(pos, quat, scale);
      if (scale.x > 0.001) return id;
    }
    return null;
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
    // Null unless the keyboard is actually in the grid — see selectedPlot in
    // script.js for why the highlight lives out here rather than in the DOM.
    const selected = bridge.selectedPlot();

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
      hideCropStage(i);
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
      hideInstance(stalkMesh, i, x, z);
      hideInstance(headMesh, i, x, z);

      const progress = bridge.plotProgress(plot);
      const ripe = progress >= 1;
      const stage = bridge.plotGrowthStage(progress);

      if (!ripe && stage < 2) {
        // Same beat as the 2D sprite swap: a young plot is a generic
        // sprout or seedling, not yet the crop it will become.
        showCropStage(SPROUT_MODEL[stage], i, x, 0, z, 0xffffff);
        continue;
      }

      // Stage 2 (still growing) and ripe both count as "grown" — the 2D
      // grid tells the two apart with the progress bar underneath, not the
      // sprite; the model here can afford to actually change for wheat and
      // corn, since the kit gave those two a growing look distinct from
      // their ripe one (see CROP_STAGE_MODEL above).
      const wilting = ripe && bridge.isWilting(plot);
      const bob = ripe ? Math.sin(now * 0.0022 + i) * 0.045 : 0;
      tmpColor.set(0xffffff);
      if (wilting) tmpColor.lerp(WILT_TINT, 0.6);
      showCropStage(
        CROP_STAGE_MODEL[plot.crop][ripe ? 'ripe' : 'growing'],
        i, x, bob, z, tmpColor.getHex(),
      );
    }

    /* Moved rather than rebuilt, and hidden the moment the grid gives up
       focus — a highlight left behind on a tile nobody is looking at any
       more would be a worse lie than the one this step came to fix. */
    selection.visible = selected !== null;
    if (selected !== null) {
      const spot = tileWorldPos(selected);
      selection.position.set(spot.x, 0, spot.z); // the pin carries its own height
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
  /* Shown per kind; a bigger herd just crowds the last column. Each visible
     animal is its own model with its own AnimationMixer now, not one shared
     instance draw the way the tile grid and the old boxes were — see the pen
     below — so this is also the software rasteriser's usual say in how much
     it has to keep up with, same as FOLIAGE_SCALE and the post-processing
     tier read the same rendererIsSoftware() signal for the same reason. */
  const PEN_CAP = rendererIsSoftware() ? 3 : 6;

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

  /* Step 13's three seasonal tints, blended into the same grass-and-dirt
     mix rather than replacing it — a field is still visibly a field under
     frost or fallen leaves, not a different material. */
  const SPRING_TINT = new THREE.Color(0x9fd66a); // a touch brighter, fresher green
  const AUTUMN_TINT = new THREE.Color(0xb97a3a); // dry grass and fallen leaves
  const SNOW_TINT = new THREE.Color(0xeef3f6);

  /* Even on the flat yard, a single flat green would still read as a green
     rectangle up close — the thing step 3 existed to stop being true. So
     every vertex, flat ground included, mixes in a little of a second grass
     tone from the same noise function at a different frequency; slopes
     further out mix toward bare dirt, standing in for the "blended
     textures" ask without needing a photographic tileable texture the
     low-poly kit assets were never going to match anyway.

     season, added in step 13, blends one more tint on top of that same
     base — never a replacement for it, so the ground under snow or fallen
     leaves still reads as the same field. rockAmount already answers "how
     bare is this ground", computed a line above, and both seasonal tints
     reuse it rather than asking the question twice: autumn leaves do not
     collect on scree, and neither does snow. Winter goes further and reuses
     slope directly too — flatter ground holds more of what falls on it,
     which is the same physical fact snow and scree already agree on. */
  function terrainVertexColor(target, x, z, normalY, season) {
    const mottle = valueNoise(x * 0.35 + 100, z * 0.35 + 100);
    target.copy(GRASS_A).lerp(GRASS_B, mottle * 0.5);
    const slope = THREE.MathUtils.clamp(1 - normalY, 0, 1);
    const rockAmount = THREE.MathUtils.smoothstep(slope, 0.18, 0.55);
    target.lerp(TERRAIN_DIRT, rockAmount);

    const bare = 1 - rockAmount;
    if (season === 'spring') {
      target.lerp(SPRING_TINT, 0.16 * bare);
    } else if (season === 'autumn') {
      target.lerp(AUTUMN_TINT, 0.35 * bare);
    } else if (season === 'winter') {
      const coverage = bare * (1 - slope * 0.6);
      target.lerp(SNOW_TINT, THREE.MathUtils.clamp(coverage, 0, 1) * 0.85);
    }
    // summer: the plain grass-and-dirt mix above, unchanged since step 3.
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

  /* Repaints the terrain's own vertex colours for a season, in place —
     buildTerrain's geometry, index and normals never change with the
     seasons, only what colour each vertex reads as, so this walks the same
     loop buildTerrain used to fill the color attribute the first time
     rather than rebuilding the mesh. syncSeason calls it once per season
     change, not per frame — the same "rebuild on change" idiom the plot
     tiles already use for buildPlotCell. */
  function applySeasonToTerrain(season) {
    const geo = terrain.geometry;
    const posAttr = geo.getAttribute('position');
    const normalAttr = geo.getAttribute('normal');
    const colorAttr = geo.getAttribute('color');
    for (let i = 0; i < posAttr.count; i += 1) {
      terrainVertexColor(terrainColorTmp, posAttr.getX(i), posAttr.getZ(i), normalAttr.getY(i), season);
      colorAttr.setXYZ(i, terrainColorTmp.r, terrainColorTmp.g, terrainColorTmp.b);
    }
    colorAttr.needsUpdate = true;
  }

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
  /* The pond                                                          */
  /* -------------------------------------------------------------- */

  /* Water is the one surface in this scene that cannot be a flat colour and
     still read as itself. A green rectangle is a field; a blue rectangle is
     not a pond, it is a hole in the ground with paint in it. What makes water
     look wet is that it disagrees with itself across the frame: nearly a
     mirror where you see it edge-on, nearly its own colour where you look
     straight down into it, with the boundary between the two moving. That is
     Fresnel plus ripples, and it is what the shader below does.

     Not three's own Water.js/Water2.js, which were the obvious answer and are
     the wrong one here: they get their reflection from a second render of the
     whole scene through a mirrored camera every frame. This project has
     already dropped shadows twice, gated the whole post-processing chain
     behind rendererIsSoftware(), and thinned the foliage on the same signal,
     for exactly the reason a second scene render is unaffordable — and a
     ninety-centimetre pond seen at a glancing angle would spend that budget
     reflecting a sky it can get from scene.background for free.

     Not a photographic normal map either, for the same reason the terrain
     never got a tileable ground texture (see buildTerrain above): it would
     fight the flat-shaded kit models standing around it, and it is another
     file to vendor and cache. The ripples below are three crossing sine
     wavelets differentiated analytically — the normal is the exact slope of
     the height field, not a sampled approximation of one — which is a dozen
     lines of arithmetic per pixel and no bytes at all. */

  /* The dooryard, south-west of the field, near the camera.

     It was first dug in the quiet north-west corner between the farmhouse and
     the orchard, which is where a farm would actually put a pond and which
     cleared every neighbour on paper. The screenshot killed it: from this
     camera the farmhouse sits at almost exactly the same bearing as that
     corner and only half the distance, so it covered the water completely.
     A pond nobody can see is not worth shading.

     Here it is in the open foreground the default view had nothing in — and
     near the camera is where water most wants to be anyway, because the
     Fresnel term below is an angle, not a distance: across two metres of
     nearby water the view angle swings far enough to run the whole way from
     sky-mirror at the far lip to see-through at the near one, which is the
     entire effect. The same pond twelve metres off would have been one flat
     tone whatever the shader did.

     The neighbours, measured: the path spine stops at x = -3.15 and the
     pond's widest point at -2.75; the branch out to the pasture gate ends at
     z = 3.95 against the pond's northern lip at 4.13; she spawns at z = 2.44,
     in front of it, not in it. It is well inside the flat farm, so
     terrainHeight is exactly 0 under all of it — which is why the bowl below
     is a mesh laid on top rather than a dent in the terrain: at 1.25 units
     between terrain vertices, a pond this size would have had two of them to
     be carved out of. */
  const POND = { x: -1.25, z: 5.4, rx: 1.35, rz: 1.15 };
  const POND_RINGS = 14;
  const POND_SEGMENTS = 48;

  /* An embanked pond — a ring of earth thrown up around a shallow pool —
     rather than a hole dug into the ground, and the reason is the terrain
     mesh rather than agriculture.

     The first version was the obvious one: a bowl sunk half a metre into the
     ground. It rendered as a faint scratch on the grass, because the terrain
     is a single unbroken sheet at y = -0.08 across the whole farm, and every
     part of the bowl below that line was simply behind it. Only the couple of
     centimetres of rim above the sheet ever showed.

     Cutting a hole in the terrain to see through is the other way, and it is
     not affordable here: at 1.25 units between terrain vertices this pond is
     two cells across, so the hole would be a ragged square nothing like the
     outline of the pond, and making it fit means an order of magnitude more
     terrain vertices — on a project that has already had to drop shadows,
     gate post-processing and thin its foliage to keep the software rasteriser
     in CI inside its budget.

     Building upward costs nothing and needs no terrain change at all, and it
     is the better read from a camera twenty degrees above the ground: a
     raised bank catches the light and casts its own shading, where a
     depression at this angle mostly shows you the grass on its far side.
     Farms do build them this way — a stock pond banked out of its own spoil —
     so it is not a compromise anyone has to be told about. */
  const FLOOR_Y = -0.075; // the pool bottom, a hair above the terrain sheet
  const CREST_Y = 0.16;   // the top of the bank
  const SKIRT_Y = -0.072; // where the bank's outer slope meets the grass

  // Positions along the radius, 0 at the middle and 1 at the outer foot of
  // the bank: flat pool floor, then up the inner face, then down the skirt.
  const POOL_T = 0.7;
  const CREST_T = 0.86;
  /* Where the water meets the bank. Stating it as a position on the profile
     and reading the height off it, rather than picking a height and solving
     for the radius that matches, means the water's edge lands exactly on the
     bank's inner face by construction — no arithmetic to get wrong, and no
     gap opening up if the bank is ever retuned. */
  const WATER_T = 0.755;

  /* A perfect ellipse reads as a swimming pool. This is the same trick the
     terrain's noise plays, in one dimension and without the lattice: two low
     harmonics on the radius, so the outline bulges and pinches by about a
     tenth of its width. Deterministic and closed-form because the walk
     exclusion below has to agree with the geometry exactly — a seeded random
     edge would mean storing it. */
  function pondEdge(theta) {
    return 1 + 0.07 * Math.sin(theta * 3 + 0.7) + 0.035 * Math.sin(theta * 5 - 2.1);
  }

  function bankY(t) {
    if (t <= POOL_T) return FLOOR_Y;
    if (t <= CREST_T) {
      return FLOOR_Y + (CREST_Y - FLOOR_Y) * THREE.MathUtils.smoothstep(t, POOL_T, CREST_T);
    }
    return CREST_Y + (SKIRT_Y - CREST_Y) * THREE.MathUtils.smoothstep(t, CREST_T, 1);
  }
  const WATER_Y = bankY(WATER_T);

  /* One centre vertex and POND_RINGS rings of POND_SEGMENTS around it, out to
     tMax of the bank's outer foot. Both the bank and the water surface are
     this shape at different radii and heights, so it is built once and handed
     back with each vertex's own t — the caller needs that to colour mud
     against grass, or to fade the water from deep to shallow, without working
     out a second time where the vertex came from. */
  function radialDisc(tMax, yFn) {
    const position = [POND.x, yFn(0), POND.z];
    const ts = [0];
    const index = [];

    for (let ring = 1; ring <= POND_RINGS; ring += 1) {
      /* Rings bunched toward the outside rather than spread evenly. All the
         shape is in the outer third — the floor is flat, and everything that
         has a silhouette is the bank — so evenly spaced rings would spend
         most of themselves on the featureless middle and leave the crest to
         be described by three of them. The square root is just the cheapest
         curve that does it. */
      const t = Math.sqrt(ring / POND_RINGS) * tMax;
      for (let seg = 0; seg < POND_SEGMENTS; seg += 1) {
        const theta = (seg / POND_SEGMENTS) * Math.PI * 2;
        const r = t * pondEdge(theta);
        position.push(
          POND.x + Math.cos(theta) * r * POND.rx,
          yFn(t),
          POND.z + Math.sin(theta) * r * POND.rz,
        );
        ts.push(t);
      }
    }

    // Wound so the faces point up: with theta running from +x toward +z, that
    // means going the other way round each triangle than it reads.
    for (let seg = 0; seg < POND_SEGMENTS; seg += 1) {
      index.push(0, 1 + ((seg + 1) % POND_SEGMENTS), 1 + seg);
    }
    for (let ring = 1; ring < POND_RINGS; ring += 1) {
      const inner = 1 + (ring - 1) * POND_SEGMENTS;
      const outer = inner + POND_SEGMENTS;
      for (let seg = 0; seg < POND_SEGMENTS; seg += 1) {
        const next = (seg + 1) % POND_SEGMENTS;
        index.push(inner + seg, inner + next, outer + seg);
        index.push(inner + next, outer + next, outer + seg);
      }
    }

    return { position, ts, index };
  }

  const POND_MUD = new THREE.Color(0x6a5334);

  // The bank's own vertices' shore-distance, 0 at the waterline to 1 at the
  // outer edge — kept alongside the mesh so applySeasonToPondBank can redo
  // the wet/dry mud blend below without re-walking radialDisc for it.
  let pondBankTs = null;

  function buildPondBank() {
    const { position, ts, index } = radialDisc(1, bankY);
    pondBankTs = ts;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();

    /* Coloured by the terrain's own function at the outer edge, so where the
       bank's skirt meets the ground it is literally the same green as the
       grass it interrupts and the seam between the two meshes disappears
       without anything being matched by hand. The normalY passed is 1, i.e.
       "flat", rather than the bank's real slope: the terrain mixes dirt into
       steep ground, and the wet part of this mesh is being painted mud on
       purpose two lines later, so letting slope do it as well would darken the
       waterline twice over. The dry/wet crossover is put a little above the
       waterline because a pond's bank is muddy for a hand's width above the
       water, not exactly to it. */
    const colors = new Float32Array(ts.length * 3);
    for (let i = 0; i < ts.length; i += 1) {
      terrainVertexColor(terrainColorTmp, position[i * 3], position[i * 3 + 2], 1);
      const dry = THREE.MathUtils.smoothstep(ts[i], WATER_T, WATER_T + 0.09);
      terrainColorTmp.lerp(POND_MUD, 1 - dry);
      colors[i * 3] = terrainColorTmp.r;
      colors[i * 3 + 1] = terrainColorTmp.g;
      colors[i * 3 + 2] = terrainColorTmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  const pondBank = new THREE.Mesh(
    buildPondBank(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  scene.add(pondBank);

  // Same idea as applySeasonToTerrain, and the same reason it exists: the
  // geometry buildPondBank built is fine forever, only the paint changes.
  function applySeasonToPondBank(season) {
    const geo = pondBank.geometry;
    const posAttr = geo.getAttribute('position');
    const colorAttr = geo.getAttribute('color');
    for (let i = 0; i < pondBankTs.length; i += 1) {
      terrainVertexColor(terrainColorTmp, posAttr.getX(i), posAttr.getZ(i), 1, season);
      const dry = THREE.MathUtils.smoothstep(pondBankTs[i], WATER_T, WATER_T + 0.09);
      terrainColorTmp.lerp(POND_MUD, 1 - dry);
      colorAttr.setXYZ(i, terrainColorTmp.r, terrainColorTmp.g, terrainColorTmp.b);
    }
    colorAttr.needsUpdate = true;
  }

  function buildWaterSurface() {
    const { position, ts, index } = radialDisc(WATER_T, () => WATER_Y);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    // 0 in the middle, 1 where it meets the bank. The shader reads it as "how
    // shallow" — no depth-buffer trick needed for a pond whose floor is known.
    geo.setAttribute('shore', new THREE.Float32BufferAttribute(ts.map((t) => t / WATER_T), 1));
    geo.setIndex(index);
    /* The shader below never reads these — its normals are the ripples',
       computed per pixel. They are here for SSAOPass, which draws the whole
       scene a second time with MeshNormalMaterial swapped in to build its
       normal buffer, and which would be reading an attribute that does not
       exist. A flat disc's computed normals are all straight up, so this is
       one array and no judgement calls. */
    geo.computeVertexNormals();
    return geo;
  }

  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff3d6) },
    uSkyColor: { value: new THREE.Color(0x7ec8f0) },
    uDeep: { value: new THREE.Color(0x2a6273) },
    uShallow: { value: new THREE.Color(0x6fb0ad) },
    uNight: { value: 0 },
  };

  const WATER_VERT = /* glsl */`
    attribute float shore;
    varying vec3 vWorld;
    varying float vShore;
    void main() {
      vShore = shore;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const WATER_FRAG = /* glsl */`
    uniform float uTime;
    uniform float uNight;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform vec3 uDeep;
    uniform vec3 uShallow;

    varying vec3 vWorld;
    varying float vShore;

    // Three wavelet directions that share no common angle, so the pattern
    // never lines up into visible stripes the way two crossing sets do — and
    // three amplitudes close enough together that no one of them dominates,
    // which is the other way stripes appear.
    const vec2 D1 = vec2(0.94, 0.34);
    const vec2 D2 = vec2(-0.37, 0.93);
    const vec2 D3 = vec2(0.62, -0.78);

    /* A fixed direction for the ripple shading below, deliberately not the
       sun's. Lighting the ripples by the real sun looked right at midday and
       fell apart at dusk: a sun near the horizon grazes the wave faces, so
       the shading term swung nearly its whole range between one ripple and
       the next and the pond came out in hard diagonal bars. The sun still
       drives the glint and the reflected sky colour, which is what actually
       reads as the time of day; the ripple texture itself just needs a light
       to have relief against. */
    const vec3 RIPPLE_LIGHT = vec3(0.4, 0.8199, -0.4099); // already unit length

    /* The height field is a sum of a_i * sin(k_i * (D_i . p) + w_i * t), and
       this is its gradient, term by term: d/dp of that sum is
       a_i * k_i * cos(...) * D_i. Differentiating on paper rather than
       sampling a normal map is why there is no texture to load, and why the
       ripples stay exactly as sharp however close the camera gets. */
    vec3 rippleNormal(vec2 p) {
      float c1 = 0.065 * cos(17.0 * dot(D1, p) + 2.2 * uTime);
      float c2 = 0.055 * cos(27.0 * dot(D2, p) - 3.1 * uTime);
      float c3 = 0.040 * cos(41.0 * dot(D3, p) + 4.4 * uTime);
      vec2 slope = c1 * D1 + c2 * D2 + c3 * D3;
      return normalize(vec3(-slope.x, 1.0, -slope.y));
    }

    void main() {
      vec3 n = rippleNormal(vWorld.xz);
      vec3 viewDir = normalize(cameraPosition - vWorld);

      /* Schlick's cheap Fresnel, without even the F0 term: at a glancing
         angle this goes to 1 and the surface becomes the sky, looked straight
         down into it goes to ~0 and the surface becomes the water. The whole
         reason the pond reads as a surface rather than a coloured hole is
         that this number is different at the near lip than the far one. */
      float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 2.0);

      vec3 body = mix(uDeep, uShallow, vShore * vShore);
      // The ripples shade the body as well as bending the reflection, so the
      // surface still has texture in the middle of the pond where the view is
      // steep and the Fresnel term is nearly nothing.
      body *= 0.86 + 0.28 * max(dot(n, RIPPLE_LIGHT), 0.0);
      /* Nothing else in this shader knows the sun has gone down. Every other
         material in the scene is lit, so it darkens on its own as the
         hemisphere light and the sun fade; a hand-written one keeps whatever
         colour it was given, and the first night render had the pond glowing
         like a lit pool in an otherwise black farm. The reflected sky needs
         no such help — it is already the night sky's own colour. */
      body *= mix(1.0, 0.16, uNight);
      /* The reflection is pulled a little back toward the water's own
         colour rather than being the raw sky. At midday the two are close
         enough that it makes no odds, but at dusk the sky is a saturated
         orange against a teal pond, and a full-strength reflection turned
         every wave crest into a hard bar — the pond came out looking brushed
         rather than wet. Real water does glitter like that; at this ripple
         scale and this screen size it just reads as stripes. */
      vec3 reflected = mix(uSkyColor, body, 0.3);
      vec3 col = mix(body, reflected, clamp(fres * 0.72, 0.0, 1.0));

      // A tight Blinn-Phong glint, faded out as the sun goes down: a pond
      // still sparkling at midnight is the giveaway that nothing is lighting
      // it, only painting it.
      vec3 halfDir = normalize(uSunDir + viewDir);
      /* A broad lobe, not a tight one. The obvious exponent for water is in
         the hundreds, and at that sharpness this pond never glints at all:
         these ripples tilt about nine degrees, and a highlight that narrow
         needs a face turned two and a half times further than that to catch
         the sun. Widening the lobe until the slopes the surface actually has
         can reach it is what puts the sheen back, and it varies ripple to
         ripple rather than sitting flat, which is the point of it. */
      float spec = pow(max(dot(n, halfDir), 0.0), 24.0) * (1.0 - uNight);
      col += uSunColor * spec * 0.9;

      // Clearer at the bank, where the mud below is close enough to see
      // through to, and near-opaque over the deep middle.
      gl_FragColor = vec4(col, mix(0.97, 0.8, vShore));
    }
  `;

  const water = new THREE.Mesh(buildWaterSurface(), new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false, // the bank underneath is opaque and already drawn
  }));
  scene.add(water);

  const pondCentre = new THREE.Vector3(POND.x, WATER_Y, POND.z);
  const waterSunDir = new THREE.Vector3();

  /* Everything the shader cannot know for itself, refreshed per drawn frame.
     The sky colour and the sun are taken from the same scene objects syncSky
     just set rather than re-derived from the clock, so the pond reflects the
     sky that is actually behind it at dusk instead of a second guess at it. */
  function syncWater(now) {
    waterUniforms.uTime.value = now / 1000;
    waterUniforms.uNight.value = skyNight;
    waterUniforms.uSunColor.value.copy(sun.color);
    waterUniforms.uSkyColor.value.copy(scene.background);
    waterUniforms.uSunDir.value.copy(waterSunDir.copy(sun.position).sub(pondCentre).normalize());
  }

  /* Is this point over the pond? The margin is what pushes grass back from
     the water's edge; the walk exclusion further down asks for more of it, to
     keep her off the wet slope rather than merely out of the water. */
  function inPondFootprint(x, z, margin = 0) {
    const u = (x - POND.x) / POND.rx;
    const v = (z - POND.z) / POND.rz;
    const r = Math.hypot(u, v);
    return r <= pondEdge(Math.atan2(v, u)) + margin;
  }

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

    /* --- the dooryard, south: knee-high only, so nothing blocks the view ---
       Everything here is also arranged around the pond, which the step that
       dug it moved into this yard. Four entries changed: the two barrels and
       the yellow flower stood where the water now is, and one box was close
       enough to the rim to argue about. They were moved onto the bank rather
       than deleted, which is what a farm looks like — things get put down
       near the water, not cleared away from it — and the reeds and the log
       below are new, because a rim of bare mud reads as a hole. */
    { id: 'survival/signpost', x: -3.0, z: 4.3, ry: 0.4 },
    { id: 'survival/barrel', x: 1.35, z: 6.15, ry: 0.2 },
    { id: 'survival/barrel', x: 1.65, z: 6.45, ry: 1.1 },
    { id: 'survival/box', x: -2.8, z: 5.25, ry: -0.3 },
    { id: 'survival/box', x: -2.75, z: 5.65, ry: 0.6 },
    { id: 'survival/chest', x: 0.75, z: 4.6, ry: -0.2 },
    /* The market stall — step 11's, not step 7's leftover windmill site.
       fantasy-town/stall-green checked out where the windmill didn't: one
       mesh, a real assembled stall rather than a modular piece of one. It
       is not the 2D Market tab's counter — nothing in this game ever walks
       her to it, since that tab has no seat in the 3D world at all, the
       same as Achievements or Dream — just what a dooryard already thick
       with crates and a chest would plausibly also have standing in it. */
    { id: 'fantasy-town/stall-green', x: 2.2, z: 4.85, ry: -0.5 },
    { id: 'nature/plant_bush', x: -2.2, z: 4.5 },
    { id: 'nature/plant_bush', x: 0.3, z: 6.2 },
    { id: 'nature/flower_redA', x: -2.6, z: 4.1 },
    { id: 'nature/flower_yellowA', x: -2.4, z: 6.5 },
    { id: 'nature/stump_round', x: 1.9, z: 5.4, ry: 0.9 },
    // Reeds on the west bank, a log rolled down to the south one.
    { id: 'nature/grass_large', x: -2.7, z: 6.05 },
    { id: 'nature/grass_large', x: 0.55, z: 4.75 },
    { id: 'nature/log', x: -0.4, z: 6.75, ry: 1.5 },

    /* --- the orchard, north: rows that loosen toward the hills ---
       Two of these were tree_default_fall permanently, for variety, before
       this step gave the orchard a real autumn of its own. Turning the
       whole orchard together, all six trees at once, reads as a season
       changing; two trees fixed in fall colour year-round would have argued
       with it instead of joining in. See syncSeason and orchardTrees. */
    { id: 'nature/tree_default', x: -2.6, z: -4.6, ry: 0.3, h: 2.9 },
    { id: 'nature/tree_detailed', x: -0.6, z: -4.8, ry: 1.2, h: 3.1 },
    { id: 'nature/tree_default', x: 1.4, z: -4.7, ry: 2.1, h: 2.7 },
    { id: 'nature/tree_default', x: 3.3, z: -4.9, ry: 0.8, h: 2.8 },
    { id: 'nature/tree_detailed', x: -3.1, z: -6.4, ry: 2.6, h: 3.0 },
    { id: 'nature/tree_default', x: -1.1, z: -6.6, ry: 1.6, h: 2.8 },
    { id: 'nature/tree_pineDefaultA', x: 1.0, z: -6.8, ry: 0.4, h: 3.4 },
    { id: 'nature/tree_pineDefaultA', x: 3.6, z: -7.0, ry: 2.2, h: 3.2 },
    { id: 'nature/tree_default', x: -2.2, z: -8.0, ry: 1.0, h: 2.6 },
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
  /* The six hand-placed orchard trees, plus the fall companion each one gets
     loaded alongside — see the PROPS comment above and syncSeason, below,
     for why the whole orchard turns together rather than each tree keeping
     its own clock. Only tree_default and tree_detailed are orchard entries;
     grep confirmed it before this leaned on that fact — the hillside fringe
     scattered by scatterInstanced is a different population and keeps its
     summer green year-round, a scope cut recorded in docs/ART_BIBLE.md. */
  const ORCHARD_TREE_IDS = new Set(['nature/tree_default', 'nature/tree_detailed']);
  const orchardTrees = []; // { base, fall } pairs, toggled by syncSeason

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

        if (!ORCHARD_TREE_IDS.has(prop.id)) return;
        loadModel(`${prop.id}_fall`, prop.h).then(({ object: fall }) => {
          fall.position.copy(object.position);
          fall.rotation.y = object.rotation.y;
          fall.traverse((obj) => {
            for (const mat of [obj.material ?? []].flat()) mat.toneMapped = false;
          });
          // Asked directly rather than left at the object's own default and
          // waiting for the next syncSeason tick: a tree that finishes
          // loading mid-autumn should not spend even one frame in summer
          // colour, the same reasoning hideIfWinter applies to grass below.
          const showFall = bridge.currentSeason() === 'autumn';
          object.visible = !showFall;
          fall.visible = showFall;
          scene.add(fall);
          orchardTrees.push({ base: object, fall });
        }).catch((err) => console.warn(`farm: ${prop.id}_fall did not load`, err));
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
    // Grass does not grow in the pond, and the margin keeps a tuft from
    // standing in the shallows at the bank either.
    if (inPondFootprint(x, z, 0.1)) return true;
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
    if (n <= 0) return [];
    const { meshes, height: authoredHeight } = await loadMeshes(id);
    if (!authoredHeight || meshes.length === 0) return [];

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

    const instances = [];
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
      instances.push(mesh);
    }
    // Read by the tests, which have no other way to ask a canvas how many
    // grass tufts it just decided to draw.
    foliageCounts[id] = transforms.length;
    // Handed back so a caller — winter's grass, in syncSeason — can hide
    // exactly the meshes this call created, instead of hunting the scene
    // graph for them after the fact.
    return instances;
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

  /* The two grass populations' own InstancedMeshes, collected as they land —
     syncSeason hides them under snow rather than styling grass blades that
     have no winter texture to switch to. Trees stay off this list on
     purpose: bare branches read as winter well enough on their own, and the
     kit has no snow variant for them either (checked, not assumed — see
     docs/ART_BIBLE.md). */
  const grassMeshes = [];

  // Grass fetched mid-winter should not flash in green before the next
  // syncSeason tick catches it — same reason the fall companion loader
  // below checks the season itself rather than waiting to be told.
  function hideIfWinter(meshes) {
    if (bridge.currentSeason() === 'winter') meshes.forEach((m) => { m.visible = false; });
    return meshes;
  }

  /* Collected so a test can wait on all of it finishing rather than on a
     fixed delay, and so a page that never got a network reply still resolves
     rather than leaving a caller waiting on a promise that was never going to
     settle — every call is already caught above. */
  const foliageReady = Promise.all([
    scatterInstanced('nature/grass', 220, {
      heightRange: [0.22, 0.34], seed: 1, bounds: FARM_BOUNDS, accept: onFarmGround,
    }).then((meshes) => grassMeshes.push(...hideIfWinter(meshes)))
      .catch((err) => console.warn('farm: grass did not load', err)),

    scatterInstanced('nature/grass_large', 70, {
      heightRange: [0.34, 0.5], seed: 2, bounds: FARM_BOUNDS, accept: onFarmGround,
    }).then((meshes) => grassMeshes.push(...hideIfWinter(meshes)))
      .catch((err) => console.warn('farm: grass_large did not load', err)),

    scatterInstanced('nature/tree_default', 14, {
      heightRange: [2.1, 3.1], seed: 10, bounds: HILL_BOUNDS, accept: onHillside,
    }).catch((err) => console.warn('farm: hillside trees did not load', err)),

    scatterInstanced('nature/tree_pineDefaultA', 12, {
      heightRange: [2.4, 3.6], seed: 11, bounds: HILL_BOUNDS, accept: onHillside,
    }).catch((err) => console.warn('farm: hillside pines did not load', err)),
  ]);

  /* -------------------------------------------------------------- */
  /* Seasons — the calendar script.js already keeps, read here once     */
  /* a day rather than driving a second clock of its own                */
  /* -------------------------------------------------------------- */

  // Repaint and re-dress only on the day the season actually turns, not
  // every frame — the same guard plotSignature uses to gate buildPlotCell.
  let lastSeason = null;

  function syncSeason() {
    const season = bridge.currentSeason();
    if (season === lastSeason) return;
    lastSeason = season;

    applySeasonToTerrain(season);
    applySeasonToPondBank(season);

    const showFall = season === 'autumn';
    for (const { base, fall } of orchardTrees) {
      base.visible = !showFall;
      fall.visible = showFall;
    }

    // Grass has no winter texture of its own to switch to — see
    // grassMeshes' own comment — so winter hides it instead of drawing a
    // summer-green tuft through ground that just went white around it.
    const hideGrass = season === 'winter';
    for (const mesh of grassMeshes) mesh.visible = !hideGrass;
  }

  /* -------------------------------------------------------------- */
  /* Weather — rain, building in on the hurricane's own forecast       */
  /* -------------------------------------------------------------- */

  // Halved on the software path for the same reason PEN_CAP and
  // FOLIAGE_SCALE are: swiftshader/llvmpipe pays for every instance drawn,
  // not just every one visible, and this scene already has plenty of those.
  const RAIN_COUNT = rendererIsSoftware() ? 150 : 500;
  const RAIN_BOUNDS = { xMin: FARM_LEFT - 1, xMax: FARM_RIGHT + 1, zMin: FARM_NORTH - 1, zMax: FARM_SOUTH + 1 };
  const RAIN_TOP = 6.5;
  const RAIN_FLOOR = -0.15;
  const RAIN_FALL_SPEED = 11; // units/sec

  /* A stretched box, not a sprite: no texture to load, and it reads as a
     falling streak from any angle this camera reaches, where a flat quad
     turned edge-on to the camera would vanish the way the selection marker's
     first, flat attempt did. Unlit and additive-ish translucency, the same
     toneMapped opt-out every other unlit material here uses, so rain never
     dims with the storm's own light drop — the drop already reads in how
     much of it there is. */
  const rainGeo = new THREE.BoxGeometry(0.02, 0.35, 0.02);
  const rainMat = new THREE.MeshBasicMaterial({
    color: 0xcfe3ee, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false,
  });
  const rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
  rainMesh.visible = false;

  /* Seeded once, like every other scatter in this file — makeRng and the
     same "rebuild on change" spirit, not scatterPoints itself, since rain
     wants a free column anywhere in the box rather than rejection-sampled
     open ground. x and z never move once picked; only y falls and wraps,
     which is what keeps a computeBoundingSphere taken once, right after
     these initial matrices are set, valid for the rest of the game — the
     drops never leave the box it was measured from. */
  const rainRng = makeRng(99);
  const rainDrops = Array.from({ length: RAIN_COUNT }, () => ({
    x: RAIN_BOUNDS.xMin + rainRng() * (RAIN_BOUNDS.xMax - RAIN_BOUNDS.xMin),
    z: RAIN_BOUNDS.zMin + rainRng() * (RAIN_BOUNDS.zMax - RAIN_BOUNDS.zMin),
    y: RAIN_FLOOR + rainRng() * (RAIN_TOP - RAIN_FLOOR),
    speed: RAIN_FALL_SPEED * (0.85 + rainRng() * 0.3),
  }));
  rainDrops.forEach((drop, i) => {
    tmpMatrix.compose(tmpPos.set(drop.x, drop.y, drop.z), tmpQuat.set(0, 0, 0, 1), tmpScale.set(1, 1, 1));
    rainMesh.setMatrixAt(i, tmpMatrix);
  });
  rainMesh.instanceMatrix.needsUpdate = true;
  rainMesh.computeBoundingSphere();
  scene.add(rainMesh);

  // The clock the fall loop below advances by, in real elapsed seconds
  // rather than a fixed per-frame step — the same reasoning poseFarmer and
  // the water shader already time themselves by `now` instead of by tick.
  let rainLastNow = null;
  // Read back by the tests, the same way foliageCounts is: the honest
  // question of how many columns are actually falling right now, rather
  // than a re-derivation of the ramp formula at assertion time.
  let rainActiveCount = 0;

  function syncWeather(now) {
    const proximity = bridge.stormProximity();
    rainMesh.visible = proximity > 0;
    if (proximity <= 0) {
      rainLastNow = null; // next storm starts clean, not with a huge dt
      rainActiveCount = 0;
      return;
    }

    const dt = rainLastNow === null ? 0 : Math.min((now - rainLastNow) / 1000, 0.1);
    rainLastNow = now;

    /* How many of the seeded columns are actually falling, out of the
       fixed pool above — proximity itself, not a curve of its own, so the
       rain thickens across exactly the three days the forecast in
       updateHurricane already warns across. The *1.4 lets it reach full
       density a little before the hurricane actually lands rather than
       right on the doorstep. */
    const active = Math.min(RAIN_COUNT, Math.round(RAIN_COUNT * Math.min(proximity * 1.4, 1)));
    rainActiveCount = active;

    for (let i = 0; i < RAIN_COUNT; i += 1) {
      const drop = rainDrops[i];
      const falling = i < active;
      if (falling) {
        drop.y -= drop.speed * dt;
        if (drop.y < RAIN_FLOOR) drop.y += RAIN_TOP - RAIN_FLOOR;
      }
      tmpPos.set(drop.x, drop.y, drop.z);
      // Idle columns are scaled to nothing rather than left out of the
      // instance count: RAIN_COUNT is fixed at construction, so "how many
      // are falling" has to be told through the matrices already there.
      tmpScale.setScalar(falling ? 1 : 0);
      tmpMatrix.compose(tmpPos, tmpQuat.set(0, 0, 0, 1), tmpScale);
      rainMesh.setMatrixAt(i, tmpMatrix);
    }
    rainMesh.instanceMatrix.needsUpdate = true;
  }

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

  /* Real, animated Kenney models rather than a box or an icosahedron — the
     same Cube Pets kit assets.js already has a target height for. Sheep
     stands in for cube-pets/animal-polar: the kit ships no sheep, and a
     polar bear is the closest four-legged silhouette it has at this scale.
     Already recorded as a gap in the art bible; not new to this step, just
     finally on screen instead of only in the 2D tab. */
  const ANIMAL_MODEL = {
    cow: 'cube-pets/animal-cow',
    chicken: 'cube-pets/animal-chick',
    sheep: 'cube-pets/animal-polar',
    dog: 'cube-pets/animal-dog',
    cat: 'cube-pets/animal-cat',
  };

  /* Where an animal is drawn when it has not taken a step of its own yet —
     the same grid the old boxes stood in permanently. Roaming, below, moves
     an animal away from this point and never puts it back; it exists only
     as everyone's first frame, so buying a fresh cow still has it appear
     where the pen's own layout would put it rather than at the origin. */
  function penGridSlot(kind, index) {
    return {
      x: PEN_CX - PEN_HALF_X + 0.15 + Math.min(index, PEN_CAP - 1) * PEN_COL_STEP,
      z: PEN_ROW_Z[kind],
    };
  }

  /* Each kind keeps to a band of the pen's depth rather than the whole of
     it, so five different herds sharing one enclosure never have to walk
     through each other — the "simple" in simple steering is exactly this:
     no collision avoidance between kinds, just lanes that cannot overlap.
     Within its own lane an animal is free to use the pen's whole width. */
  const PEN_LANE_HALF_Z = PEN_ROW_STEP / 2 - 0.16;
  const PEN_ROAM_MARGIN_X = 0.16;
  const roamXMin = PEN_CX - PEN_HALF_X + PEN_ROAM_MARGIN_X;
  const roamXMax = PEN_CX + PEN_HALF_X - PEN_ROAM_MARGIN_X;

  // Ground covered per second while wandering or on patrol. Cube Pets are
  // small, and these are well under the farmer's own WALK_SPEED — tuned to
  // look unhurried in a pen this size by eye, not measured against
  // anything the kit itself claims, the way WALK_SPEED once was.
  const ANIMAL_SPEED = {
    cow: 0.5, chicken: 0.85, sheep: 0.55, dog: 0.95, cat: 0.9,
  };
  const ANIMAL_CLIP_FADE = 0.2;

  /* One independently animated model per pen slot, loaded once and reused —
     not the InstancedMesh the boxes used, which shares a single clip clock
     across every instance. That is fine for a bob that can never fall out
     of step with itself, and wrong for idle/walk/eat blending, where every
     animal in the pen needs to be free to be on a different clip at a
     different point in it from its neighbours. */
  const animalPool = {};
  PEN_ROWS.forEach((kind) => {
    animalPool[kind] = Array.from({ length: PEN_CAP }, (_, i) => {
      const start = penGridSlot(kind, i);
      return {
        object: null, mixer: null, actions: null, clip: null, materials: null, baseColors: null,
        x: start.x, z: start.z, heading: 0,
        mode: 'idle', until: 0, targetX: start.x, targetZ: start.z,
      };
    });
  });

  function loadAnimalSlot(kind, i) {
    const slot = animalPool[kind][i];
    if (slot.object || slot.loading) return;
    slot.loading = true;
    loadModel(ANIMAL_MODEL[kind]).then(({ object, animations }) => {
      const mixer = new THREE.AnimationMixer(object);
      const actions = {};
      for (const clip of animations) actions[clip.name] = mixer.clipAction(clip);

      /* Every mesh in a Cube Pets model shares one material — a single
         textured "colormap", not per-part colours — so cloning it once and
         reusing the clone across this instance's meshes is enough, and
         cheaper than the naive per-mesh clone dressFarm's props get away
         with because none of them ever need to be recoloured again. This
         one does: it is what lets the "she's on her way" tint recolour a
         single cow without recolouring the clone(true) shares its material
         with — the rest of its own herd. */
      const materials = [];
      const cloned = new Map();
      object.traverse((obj) => {
        if (!obj.isMesh) return;
        let mat = cloned.get(obj.material);
        if (!mat) {
          mat = obj.material.clone();
          mat.toneMapped = false;
          cloned.set(obj.material, mat);
          materials.push(mat);
        }
        obj.material = mat;
      });

      object.visible = false;
      scene.add(object);
      slot.object = object;
      slot.mixer = mixer;
      slot.actions = actions;
      slot.materials = materials;
      slot.baseColors = materials.map((m) => m.color.clone());
    }).catch((err) => console.warn(`farm: ${kind} could not be loaded`, err));
  }
  // Fetched now rather than waited for: fetchModel's own cache means five
  // network requests total, one per kind, however many times this loop
  // calls loadAnimalSlot for it — the same dedupe preload() relies on.
  PEN_ROWS.forEach((kind) => { for (let i = 0; i < PEN_CAP; i += 1) loadAnimalSlot(kind, i); });

  function playAnimalClip(slot, name) {
    if (!slot.actions || slot.clip === name) return;
    const next = slot.actions[name];
    if (!next) return;
    next.reset().fadeIn(ANIMAL_CLIP_FADE).play();
    const previous = slot.clip && slot.actions[slot.clip];
    if (previous) previous.fadeOut(ANIMAL_CLIP_FADE);
    slot.clip = name;
  }

  /** Moves a pool slot toward a point at a given speed; true once it arrives. */
  function stepSlotToward(slot, tx, tz, speed, dt) {
    const dx = tx - slot.x;
    const dz = tz - slot.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const step = Math.min(speed * dt, dist);
    slot.x += (dx / dist) * step;
    slot.z += (dz / dist) * step;
    slot.heading = Math.atan2(dx, dz);
    return step >= dist;
  }

  const randomBetween = (lo, hi) => lo + Math.random() * (hi - lo);

  /* Livestock: walk to a spot in their own lane, pause to look up, graze a
     while, then pick another spot — three clips, three modes, and the loop
     between them is the whole of the steering. Not seeded: nothing here is
     asserted by a test the way the foliage scatter's counts are, so there is
     nothing a fixed seed would buy that Math.random doesn't do more simply.

     A hungry animal is left exactly where it stands, playing idle rather
     than eat. It has nothing to graze until it is fed, so it has no business
     wandering off looking for something that is not there — and freezing it
     is also the only place in this pass where a player can see which of the
     herd needs feeding without opening the Animals tab. */
  function stepLivestock(slot, kind, animal, dt, now) {
    if (animal.state !== 'producing') {
      slot.mode = 'idle';
      playAnimalClip(slot, 'idle');
      return;
    }

    if (slot.mode === 'walk') {
      playAnimalClip(slot, 'walk');
      if (stepSlotToward(slot, slot.targetX, slot.targetZ, ANIMAL_SPEED[kind], dt)) {
        slot.mode = 'look';
        slot.until = now + randomBetween(300, 900);
      }
    } else if (slot.mode === 'look') {
      playAnimalClip(slot, 'idle');
      if (now >= slot.until) { slot.mode = 'eat'; slot.until = now + randomBetween(1800, 3600); }
    } else if (slot.mode === 'eat') {
      playAnimalClip(slot, 'eat');
      if (now >= slot.until) {
        slot.targetX = randomBetween(roamXMin, roamXMax);
        slot.targetZ = PEN_ROW_Z[kind] + randomBetween(-PEN_LANE_HALF_Z, PEN_LANE_HALF_Z);
        slot.mode = 'walk';
      }
    } else {
      // Bootstrapping out of the initial 'idle', or coming off a hungry
      // spell: pause first rather than setting off immediately, so being
      // fed reads as a moment of relief before she gets moving again.
      slot.mode = 'look';
      slot.until = now;
    }
  }

  /* Guardians already had a state to key off before this step existed: on
     duty they patrol, hungry they wait to be fed. This keeps exactly that
     shape and only replaces what patrolling and waiting look like — a real
     walk cycle back and forth along the lane instead of a sine wave, and a
     real idle pose lowered onto its haunches instead of a squashed box,
     because the squash was standing in for a resting pose no model existed
     to give it yet. */
  function stepGuardian(slot, kind, animal, dt, now) {
    if (animal.state !== 'producing') {
      slot.mode = 'idle';
      playAnimalClip(slot, 'idle');
      slot.object.scale.y = 0.55; // still resting, low to the ground
      return;
    }
    slot.object.scale.y = 1;

    if (slot.mode === 'walk') {
      playAnimalClip(slot, 'walk');
      if (stepSlotToward(slot, slot.targetX, PEN_ROW_Z[kind], ANIMAL_SPEED[kind], dt)) {
        slot.mode = 'turn';
        slot.until = now + randomBetween(250, 500);
      }
    } else if (slot.mode === 'turn') {
      playAnimalClip(slot, 'idle');
      if (now >= slot.until) {
        slot.targetX = slot.targetX <= PEN_CX ? roamXMax : roamXMin;
        slot.mode = 'walk';
      }
    } else {
      slot.targetX = roamXMax;
      slot.mode = 'walk';
    }
  }

  let lastAnimalStepAt = 0;

  function syncAnimals(now) {
    const state = bridge.getState();
    // Drawing time, not simulation time — the same reason poseFarmer keeps
    // its own clock below rather than trusting the walk-timing dt: this only
    // needs to move when someone is looking, and a gap spanning a spell on
    // the Market tab must not be spent crossing the whole pen in one stride.
    const dt = lastAnimalStepAt ? Math.min((now - lastAnimalStepAt) / 1000, 0.2) : 0;
    lastAnimalStepAt = now;

    PEN_ROWS.forEach((kind) => {
      const def = bridge.ANIMALS[kind];
      const list = state[def.stateKey];
      const guardian = !!def.guards;
      const pool = animalPool[kind];

      for (let i = 0; i < PEN_CAP; i += 1) {
        const slot = pool[i];
        const animal = list[i];
        if (!slot.object) continue; // still being fetched; nothing to draw yet
        if (!animal) {
          slot.object.visible = false;
          continue;
        }

        slot.object.visible = true;
        if (guardian) stepGuardian(slot, kind, animal, dt, now);
        else stepLivestock(slot, kind, animal, dt, now);

        /* No equivalent of the farmer's CLIP_WALK_SPEED here — matching a
           clip's own foot-fall to the ground it is meant to cover needs
           watching it play, not the single frames a screenshot gives this
           pass to check by. Left at 1:1 with ANIMAL_SPEED, on the working
           assumption that the kit authors a walk clip at close to one world
           unit per second, roughly what the farmer's own clip turned out to
           keep. If a played build ever shows a visible foot-slide, this is
           the number to correct, the same way CLIP_WALK_SPEED was. */
        const walkAction = slot.actions.walk;
        if (walkAction) walkAction.timeScale = ANIMAL_SPEED[kind];
        slot.mixer.update(dt);

        slot.object.position.set(slot.x, 0, slot.z);
        slot.object.rotation.y = slot.heading;

        const targeted = isAnimalSpokenFor(kind, animal.id);
        slot.materials.forEach((mat, mi) => {
          tmpColor.copy(slot.baseColors[mi]);
          if (targeted) tmpColor.lerp(TARGETED_TILE, 0.55);
          mat.color.copy(tmpColor);
        });
      }
    });
  }

  /* The position an animal is walked to and rests at — never necessarily the
     position it is drawn at a frame from now, since roaming keeps that
     moving. index beyond the pool's own length clamps to its last slot: an
     eighth cow when only six are ever drawn still resolves to somewhere real
     — wherever the sixth one currently is — rather than to a position
     nothing occupies. */
  function animalSlot(kind, index) {
    const pool = animalPool[kind];
    const slot = pool[Math.min(index, pool.length - 1)];
    return { x: slot.x, z: slot.z };
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

  /* How far past the water's edge she is held, in the pond's own normalised
     units — about 18cm of bank, enough that she stands on level ground rather
     than halfway down the wet slope with her feet at y=0 and the mud below
     them. */
  const POND_BANK = 0.12;

  /* Pushed straight out to the bank along the ray from the pond's middle,
     rather than refusing the step outright. The difference is what it feels
     like to walk the shore: a refused step means walking into an invisible
     wall and stopping dead, while projecting the step onto the rim lets the
     component of her movement that runs *along* the bank survive, so she
     slides round the water instead of sticking to it.

     Only steering is blocked, deliberately — not stepToward, which the job
     queue walks in a straight line to a plot or a pen. A queue that could be
     given a target it can never reach because something is in the way is a
     farmer stuck forever, and there is nothing to reach across the pond
     anyway: every plot, gate and animal is east of the path spine. */
  function keepOutOfPond(x, z, out) {
    const u = (x - POND.x) / POND.rx;
    const v = (z - POND.z) / POND.rz;
    const r = Math.hypot(u, v);
    const rim = pondEdge(Math.atan2(v, u)) + POND_BANK;
    if (r >= rim) {
      out.x = x;
      out.z = z;
      return;
    }
    // Dead centre has no ray to push along; unreachable in practice, but it
    // is a divide by zero rather than a rounding error, so it gets an answer.
    const push = r > 1e-6 ? rim / r : 0;
    out.x = POND.x + (push ? u * push : rim) * POND.rx;
    out.z = POND.z + (push ? v * push : 0) * POND.rz;
  }

  function steer(dt) {
    const mag = Math.min(1, Math.hypot(drive.x, drive.z));
    const step = WALK_SPEED * mag * dt;
    const x = Math.max(ROAM.minX, Math.min(ROAM.maxX, at.x + (drive.x / mag) * step));
    const z = Math.max(ROAM.minZ, Math.min(ROAM.maxZ, at.z + (drive.z / mag) * step));
    keepOutOfPond(x, z, at);
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

  /* Who the arrows belong to. Typing in a field was always excluded; step 12
     added the plot grid, which navigates itself with them, and a select,
     which opens itself with them.

     Everything else — a seed button, the prompt, a tab — keeps driving her,
     on purpose: clicking a seed and then walking off to plant it is one
     gesture, and making the player click the background first to "give the
     keys back" would be a tax on the common case to fix an uncommon one.
     What was wrong before this step was narrower than "buttons": the arrows
     drove her from *inside the grid*, where they were also supposed to be
     moving between tiles — measured at 2.87 units of walking while a plot
     button held focus, in a probe written for this step. */
  const arrowsBelongToUi = (el) => !!el && (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || el.isContentEditable
    || (typeof el.closest === 'function' && el.closest('#plotsGrid') !== null)
  );

  window.addEventListener('keydown', (event) => {
    if (arrowsBelongToUi(event.target)) return;
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
    /* The pond, as numbers. A test cannot look at a canvas and say whether
       that is water, but it can ask whether she is standing in it, and it can
       watch the shader's clock to know the ripples are actually running
       rather than frozen at t=0 — which is the difference between water and a
       painting of water. */
    pond: () => ({ x: POND.x, z: POND.z, rx: POND.rx, rz: POND.rz, surfaceY: WATER_Y }),
    inPond: (x, z) => inPondFootprint(x, z),
    waterPhase: () => waterUniforms.uTime.value,
    /* Where the nth animal of a kind is actually standing right now, not
       where the pen's grid would put it — the honest question for something
       that roams, in the same way farmerAt is the honest question for her.
       A test drives on this rather than waiting out a wander on a stopwatch. */
    animalAt: (kind, index) => animalSlot(kind, index),
    /* A way to wait for every crop growth stage to have arrived, same
       reason foliageReady exists — and the honest question of which one,
       if any, a plot is actually showing right now, read back off the mesh
       itself rather than re-derived from state. */
    cropModelsReady: () => cropModelsReady,
    cropStageAt: (plotIndex) => activeCropStage(plotIndex),
    /* Step 13. The season the ground and the orchard are actually painted
       for right now — bridge.currentSeason() directly, the live source,
       rather than lastSeason's change-gated cache, so a test asking early
       gets today's real answer instead of null. orchardReady lets a test
       wait for both fall companions to have finished their own network
       fetch before asking whether they're showing, the same shape
       cropModelsReady already gives crops. rainVisible and rainActive read
       the weather system the same honest way foliageCounts reads the
       scatter: off the thing itself, not a re-derivation of its formula. */
    season: () => bridge.currentSeason(),
    orchardReady: () => orchardTrees.length >= PROPS.filter((p) => ORCHARD_TREE_IDS.has(p.id)).length,
    orchardAutumn: () => orchardTrees.length > 0 && orchardTrees.every(({ fall }) => fall.visible),
    grassShowing: () => grassMeshes.length > 0 && grassMeshes.every((m) => m.visible),
    rainVisible: () => rainMesh.visible,
    rainActive: () => rainActiveCount,
    // The same honest question the pond's water asks of its own shader
    // clock: is this actually falling, or a field of streaks frozen in
    // place. Index 0 is always among the first to fall once any are —
    // syncWeather's active count only ever grows from the front of the
    // seeded array.
    rainDropY: (i) => rainDrops[i]?.y ?? null,
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
    syncSeason();
    syncSky(now);
    syncWeather(now);
    syncWater(now); // after syncSky: it reflects the sky that pass just set
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
