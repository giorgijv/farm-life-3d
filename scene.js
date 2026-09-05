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
 * What this file owns, for now (build steps 4-7 of the weekend plan):
 *   - the render loop: a lit ground plane, a fence, sixteen soil tiles;
 *   - crop meshes on those tiles, grown from state the same way the 2D
 *     sprite swap was — a generic sprout/seedling early, a crop-coloured
 *     head once it is close to ripe, a bob once it's ripe, a grey slump
 *     once it rots;
 *   - the farmer, and the queue that walks her to a plot before the rules
 *     for that plot run at all. That is the one part of this file the rest
 *     of the game can feel, and it has a long comment of its own below.
 *
 * This file does not touch #plotsGrid at all — it is still a plain CSS
 * grid, invisible, sitting over the canvas exactly as before this scene
 * existed. See the long comment on `.plots-grid` in styles.css for why an
 * earlier version of this file that positioned each button from a camera
 * projection was wrong, not just more complicated.
 */
import * as THREE from 'three';

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
  // would otherwise ask for nine times the pixels for no visible gain. The
  // full performance pass is step 9; this is the cheap, obvious part of it
  // done early so the first frame is never the slow one.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe4f5);
  scene.fog = new THREE.Fog(0xbfe4f5, 15, 28);

  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 100);
  /* Looking down at roughly 40° over the yard from the south, close enough
     that the fence line nearly fills the frame — at any more distance the
     farmer is a speck and the whole point of the walk is lost. */
  camera.position.set(0, 5.5, 5.3);
  camera.lookAt(0, 0.2, 0);

  scene.add(new THREE.HemisphereLight(0xdcefff, 0x3d5a2c, 0.85));

  // No shadow map yet — deliberately. It's a real cost (its own shader
  // variant per shadow-casting mesh, plus a full extra depth pass every
  // frame), it bought this scene nothing steps 4-6 asked for, and it was the
  // one part of this file heavy enough to visibly slow down the rest of the
  // page under CI's software-rendered Chromium: a genuinely unrelated test
  // elsewhere started missing its 5-second timing window once this scene's
  // render loop was competing for the same CPU core. Step 9 is where shadows
  // earn their keep (the plan wants "long shadows at dusk" from there), and
  // the render loop it needs is the one with an actual performance pass
  // behind it, not this one.
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.15);
  sun.position.set(5, 9, 4);
  scene.add(sun);

  /* -------------------------------------------------------------- */
  /* Ground and fence — static dressing, built once                    */
  /* -------------------------------------------------------------- */

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x5a9142, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  scene.add(ground);

  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a6135, roughness: 0.9 });
  const yardHalf = SPAN / 2 + 0.55;
  const railGeo = new THREE.BoxGeometry(1, 0.5, 0.12);
  [
    { pos: [0, 0.25, yardHalf], rotY: 0 },
    { pos: [0, 0.25, -yardHalf], rotY: 0 },
    { pos: [yardHalf, 0.25, 0], rotY: Math.PI / 2 },
    { pos: [-yardHalf, 0.25, 0], rotY: Math.PI / 2 },
  ].forEach(({ pos, rotY }) => {
    const rail = new THREE.Mesh(railGeo, fenceMat);
    rail.position.set(...pos);
    rail.scale.x = SPAN + 1.1;
    rail.rotation.y = rotY;
    scene.add(rail);
  });

  const postGeo = new THREE.BoxGeometry(0.14, 0.7, 0.14);
  const postMesh = new THREE.InstancedMesh(postGeo, fenceMat, 4);
  const m4 = new THREE.Matrix4();
  [
    [yardHalf, yardHalf], [yardHalf, -yardHalf], [-yardHalf, yardHalf], [-yardHalf, -yardHalf],
  ].forEach(([x, z], i) => {
    m4.makeTranslation(x, 0.35, z);
    postMesh.setMatrixAt(i, m4);
  });
  scene.add(postMesh);

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
     the one she is on now. Declared up here only so a tile can show that it
     has been spoken for; everything that fills and drains them is in "The
     farmer, and the walk to work" below. */
  const jobQueue = [];
  let activeJob = null;

  function isSpokenFor(idx) {
    if (activeJob && activeJob.plot === idx) return true;
    return jobQueue.some((job) => job.plot === idx);
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
      if (isSpokenFor(i)) tmpColor.lerp(TARGETED_TILE, 0.55);
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

  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    if (!isSpokenFor(idx)) jobQueue.push({ plot: idx, kind });
    return true;
  });

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
    if (bridge.plotIntent(job.plot) === job.kind) bridge.runPlotIntent(job.plot, job.kind);
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
      const tile = tileWorldPos(activeJob.plot);
      if (stepToward(tile.x, tile.z + STAND_OFF, dt)) {
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
    syncPlots(now);
    poseFarmer();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
