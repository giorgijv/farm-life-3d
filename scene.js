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
 * What this file owns, for now (build steps 4-6 of the weekend plan):
 *   - the render loop: a lit ground plane, a fence, sixteen soil tiles;
 *   - crop meshes on those tiles, grown from state the same way the 2D
 *     sprite swap was — a generic sprout/seedling early, a crop-coloured
 *     head once it is close to ripe, a bob once it's ripe, a grey slump
 *     once it rots.
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

  /* Grid geometry in world units. Column-major-by-row, matching the plot
     array's own order (row 0 = plots 0-3, nearest the camera) so tabbing
     through the DOM grid still moves the way it used to visually. */
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe4f5);
  scene.fog = new THREE.Fog(0xbfe4f5, 15, 28);

  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 100);
  // Looking down at roughly 40° over the yard from the south.
  camera.position.set(0, 6.4, 6.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xdcefff, 0x3d5a2c, 0.85));

  const sun = new THREE.DirectionalLight(0xfff3d6, 1.15);
  sun.position.set(5, 9, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 20,
  });
  sun.shadow.bias = -0.002;
  scene.add(sun);
  scene.add(sun.target);

  /* -------------------------------------------------------------- */
  /* Ground and fence — static dressing, built once                    */
  /* -------------------------------------------------------------- */

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x5a9142, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
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
    rail.castShadow = true;
    scene.add(rail);
  });

  const postGeo = new THREE.BoxGeometry(0.14, 0.7, 0.14);
  const postMesh = new THREE.InstancedMesh(postGeo, fenceMat, 4);
  postMesh.castShadow = true;
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
  tileMesh.receiveShadow = true;
  for (let i = 0; i < PLOT_COUNT; i++) {
    const { x, z } = tileWorldPos(i);
    m4.makeTranslation(x, 0, z);
    tileMesh.setMatrixAt(i, m4);
  }
  scene.add(tileMesh);

  const LOCKED_TILE = new THREE.Color(0x3d3a34);
  const UNLOCKABLE_TILE = new THREE.Color(0x8a6a3a);
  const SOIL_TILE = new THREE.Color(0x5a3d22);

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
  stalkMesh.castShadow = true;
  scene.add(stalkMesh);

  const headMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.3, 0), // faceted, deliberately low-poly
    new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    PLOT_COUNT,
  );
  headMesh.castShadow = true;
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

  function syncPlots(now) {
    const state = bridge.getState();
    const plots = state.plots;
    const unlocked = state.unlockedPlots;

    for (let i = 0; i < PLOT_COUNT; i++) {
      const { x, z } = tileWorldPos(i);
      const locked = i >= unlocked;

      tileMesh.setColorAt(
        i,
        tmpColor.set(locked ? (i === unlocked ? UNLOCKABLE_TILE : LOCKED_TILE) : SOIL_TILE),
      );

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

  function frame(now) {
    requestAnimationFrame(frame);
    // Backgrounded tab, or a different in-game tab open: nothing to draw,
    // so skip the GPU work entirely rather than render an invisible scene.
    if (document.hidden || !farmTabVisible()) return;
    syncPlots(now);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
