/* stable.js — the stable, built here for the same reason the barn is.
 *
 * Third building the game builds instead of loading, and the reasoning in
 * barn.js applies unchanged: every model in `city-suburban` is a closed
 * shell with a painted-on door, so a building the player is meant to see
 * into has to be assembled out of slabs. What is new here is *why* it has
 * to be seen into. The barn is a room you walk into and look around; the
 * stable has to show its livestock from across the yard, because the whole
 * point of buying a cow is watching it be there.
 *
 * That single requirement is what makes this a different building rather
 * than a recoloured barn: the east face has no wall at all. It is a row of
 * posts under the eave — a run-in stable, which is a real building type and
 * happens to be exactly the one that solves the problem. From the yard you
 * are looking straight into five open stalls. Walking in needs no door to
 * find and no gap to thread, which also means the walk-to-work queue's
 * straight line from the field arrives at an animal without a wall in it.
 *
 * Shape is deliberately not the barn's. The barn is tall, red and gambrel;
 * this is long, low, limewashed and gabled, with the ridge running the
 * building's length. Two buildings that read as two buildings from the far
 * side of the field is worth more than either of them being individually
 * prettier.
 *
 * The contract back to scene.js matches barn.js's, so the scene can treat
 * both with the same machinery: `walls` are collision rectangles, `inside`
 * is the floor, `shell` carries outward normals for the hide-the-near-wall
 * trick, and `roof` comes off when she is under it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* Sized to the footprint the farmhouse left behind, which is the honest
   constraint: this building replaces it, the farm's flat ground was drawn
   around it, and FARM_LEFT in scene.js exists to hold its west wall. The
   house measured 5.96 by 7.52; 6.0 by 8.6 is the same wall line to within a
   handspan, two thirds of a unit longer, and long is what a stable is.

   Depth is the dimension doing work. Five stalls share it, and each stall
   has to hold an animal *plus* the floor the farmer stands on to reach it —
   the job queue stops her two thirds of a unit short of whatever she walked
   to, so a stall band that used the full interior would put her in the
   gable wall. At 8.6 the interior is 8 deep, the five rows span 5.8 of it,
   and the 1.1 left at each end is the standing room that makes the last row
   reachable rather than notionally reachable.

   Height is the one number chosen by eye against its neighbour rather than
   by arithmetic: 4.4 is three times the farmer and a clear unit and a half
   under the barn, which keeps the barn the tallest thing on the farm. A
   stable that out-topped the barn would have quietly restated which
   building matters. */
export const STABLE_WIDTH = 6.0;
export const STABLE_DEPTH = 8.6;
export const STABLE_HEIGHT = 4.4;

/* Same thickness as the barn's, and for the same reason: this is the
   collision rectangle as well as the visible wall, and anything thinner is
   thin enough for a fast step to cross in one frame. */
export const STABLE_WALL = 0.3;

/* Where the wall stops and the roof starts, as a fraction of the height.
   Higher than the barn's 0.58 — the barn wants a tall roof because a
   gambrel *is* the silhouette, while here the long low wall is, and a roof
   much taller than a quarter of the building starts reading as a cottage. */
const EAVES = 0.72;

/* How far the roof oversails the open east face. Not decoration: a run-in
   stable's eave is what keeps the weather out of the stalls, and without it
   the building reads as a wall that someone forgot to finish. */
const OVERSAIL = 0.55;

/* The interior, in the building's own local frame, as a rectangle.
 *
 * Exported as a constant rather than only returned from buildStable()
 * because scene.js needs it *early* — the animals' grid is laid out beside
 * the rest of the farm's geometry, well before anything is added to the
 * scene — and a second copy of this arithmetic up there is a second place
 * for it to drift. Note the east edge: the front is open, so the interior
 * runs all the way out to the building line on that side with no wall to
 * inset past.
 */
export const STABLE_INSIDE = {
  minX: -STABLE_WIDTH / 2 + STABLE_WALL,
  maxX: STABLE_WIDTH / 2,
  minZ: -STABLE_DEPTH / 2 + STABLE_WALL,
  maxZ: STABLE_DEPTH / 2 - STABLE_WALL,
};

/* How much of the interior's width is walkway rather than stall: the strip
   inside the open face that the partitions and the bedding stop short of,
   and that the farmer walks down to reach a stall.

   0.96 rather than the 1.8 the first build used, and the difference is not
   taste. The building is only 6 across, so every unit of walkway is a unit
   the stalls do not get, and at 1.8 the animals ended up in a 3-unit band —
   exactly the width of the pen this replaced, which makes the whole move
   pointless on the one measure that started it. The farmer is 0.7 across,
   so 0.96 is a walkway she passes down comfortably and the widest thing the
   stalls can afford to give up. */
const WALKWAY = STABLE_WIDTH * 0.16;

/* The stalls themselves — the interior less that walkway. Exported for the
   same reason STABLE_INSIDE is, and needed for a sharper one: this is where
   the livestock may stand, and an animal placed on the interior rather than
   on this rectangle is an animal standing in the aisle. */
export const STABLE_STALLS = {
  ...STABLE_INSIDE,
  maxX: STABLE_INSIDE.maxX - WALKWAY,
};

const PAINT = {
  lime: 0xd7cdb6,      // limewashed daub, warm rather than white
  limeShade: 0xc3b89f, // the same wash on the shaded gable, so corners read
  timber: 0x5b4530,    // the frame, oiled dark
  roof: 0x5a534b,      // slate, cooler than the barn's tarred shingle
  floor: 0x6f5c3e,     // swept earth
  straw: 0xc9a94e,     // bedding, only once the stable has been paid for
  trough: 0x7a6242,    // feed trough timber, lighter than the frame
};

const mat = (hex, name) => new THREE.MeshStandardMaterial({
  name,
  color: hex,
  roughness: 0.88,
  metalness: 0,
  flatShading: true,
});

/* A box, positioned by its centre — the workhorse, same as the barn's, with
   one difference that turned out to matter: these are collected rather than
   added, and each batch is merged into one mesh per material before it goes
   into the scene.

   The barn gets away with a mesh per slab. This building does not, and the
   draw-budget test is what said so: the stable is forty-seven slabs against
   the farmhouse's one loaded model, and the worst case the game can reach
   went from 223 draw calls to 285 against a ceiling of 260. That ceiling's
   own note says it exists to catch exactly this — "un-instancing the
   foliage or the sixty-odd hand-placed props would blow through the call
   ceiling immediately" — so raising it to fit a building that did not need
   forty-seven calls would have been arguing with the instrument.

   Merged, the same geometry is fourteen: two per wall, three for the roof,
   three for the fabric, two for the bedding. The walls stay separate
   because each one has to be able to hide on its own; everything else that
   shares a material shares a draw.

   The cost of this is that nothing merged can be moved or hidden
   individually afterwards, which is fine here — every slab in this building
   is nailed down, and the things that do move (the roof, the bedding) are
   whole batches of their own. */
function batch(name) {
  const group = new THREE.Group();
  group.name = name;
  const byMaterial = new Map();
  const axis = new THREE.Vector3(0, 0, 1);
  const spin = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const m4 = new THREE.Matrix4();

  return {
    group,
    /* Same signature the old slab() had, plus the tilt the roof pitches and
       the gable braces need. The transform is baked into the geometry here
       rather than carried on a mesh, because a merged geometry has nowhere
       to put a per-slab transform afterwards. */
    add(material, w, h, d, x, y, z, tilt = 0) {
      const g = new THREE.BoxGeometry(w, h, d);
      spin.setFromAxisAngle(axis, tilt);
      g.applyMatrix4(m4.compose(pos.set(x, y, z), spin, scale));
      const list = byMaterial.get(material);
      if (list) list.push(g);
      else byMaterial.set(material, [g]);
    },
    /* Merge and hand back the group. The source geometries are disposed as
       they are folded in — they were scratch, and three.js will not collect
       a BufferGeometry on its own. */
    seal() {
      for (const [material, list] of byMaterial) {
        group.add(new THREE.Mesh(mergeGeometries(list, false), material));
        for (const g of list) g.dispose();
      }
      byMaterial.clear();
      return group;
    },
  };
}

/**
 * Builds the stable at the origin with its open face towards +X.
 *
 * `rowZ` is where the animals stand and `dividerZ` the midpoints between
 * them, both worked out by scene.js from its own pen layout and passed in
 * rather than recomputed here. The rows are the truth and everything drawn
 * inside follows them; computing the two independently is how you end up
 * with a cow standing astride a partition.
 */
export function buildStable({ rowZ = [], dividerZ = [] } = {}) {
  const W = STABLE_WIDTH;
  const D = STABLE_DEPTH;
  const H = STABLE_HEIGHT;
  const wallTop = H * EAVES;
  const halfW = W / 2;
  const halfD = D / 2;

  const lime = mat(PAINT.lime, 'stable-lime');
  const limeShade = mat(PAINT.limeShade, 'stable-lime-shade');
  const timber = mat(PAINT.timber, 'stable-timber');
  const roofMat = mat(PAINT.roof, 'stable-roof');
  const floorMat = mat(PAINT.floor, 'stable-floor');
  const strawMat = mat(PAINT.straw, 'stable-straw');
  const troughMat = mat(PAINT.trough, 'stable-trough');

  const root = new THREE.Group();
  root.name = 'stable';

  /* One batch per thing that has to be able to hide on its own, and one for
     everything nailed down that does not. See batch() for why. */
  const fabric = batch('stable-fabric');
  const west = batch('stable-west');
  const north = batch('stable-north');
  const south = batch('stable-south');

  /* Floor, a hair proud of the terrain for the same depth-fight reason the
     barn's is. It runs out past the building line under the open face, so
     the threshold is swept earth rather than a seam onto grass. */
  const floorY = 0.08;
  fabric.add(floorMat, W + 0.3, 0.08, D, 0.15, 0.04, 0);

  /* Three walls and an opening. The west wall is the long one the stalls
     back onto; north and south are the gable ends, and they stop at the
     building line rather than reaching out under the eave, so the open face
     is genuinely open across its whole width. */
  west.add(lime, STABLE_WALL, wallTop, D, -halfW + STABLE_WALL / 2, wallTop / 2, 0);
  north.add(limeShade, W - STABLE_WALL, wallTop, STABLE_WALL,
    STABLE_WALL / 2, wallTop / 2, -halfD + STABLE_WALL / 2);
  south.add(limeShade, W - STABLE_WALL, wallTop, STABLE_WALL,
    STABLE_WALL / 2, wallTop / 2, halfD - STABLE_WALL / 2);

  /* The frame: dark timber banding over the limewash. Added to the wall's
     own batch rather than to the building's — the barn learned this one the
     hard way, and a band left hanging in the air after its wall is hidden
     is exactly as wrong here. Batching gets it right by construction: trim
     in the wall's batch is in the wall's group, and a group hides whole. */
  west.add(timber, STABLE_WALL + 0.05, 0.18, D, -halfW + STABLE_WALL / 2, wallTop - 0.09, 0);
  north.add(timber, W - STABLE_WALL, 0.18, STABLE_WALL + 0.05,
    STABLE_WALL / 2, wallTop - 0.09, -halfD + STABLE_WALL / 2);
  south.add(timber, W - STABLE_WALL, 0.18, STABLE_WALL + 0.05,
    STABLE_WALL / 2, wallTop - 0.09, halfD - STABLE_WALL / 2);
  // Uprights down the west wall, on the stall lines, so the long blank
  // elevation has some rhythm to it when seen from the lane.
  for (const z of dividerZ) {
    west.add(timber, STABLE_WALL + 0.06, wallTop, 0.2, -halfW + STABLE_WALL / 2, wallTop / 2, z);
  }

  /* Timber framing on the gable ends, which is the one piece of this
     building that is here purely because a screenshot said so. The opening
     shot frames the farm from the south, and what it put on the left was
     four and a half metres of blank limewash — a building-shaped panel
     rather than a building. Daub-and-timber construction hangs its frame on
     the outside, so a pair of braces and a post per end is both the honest
     detail and the cheap one: six slabs, no new material, and the elevation
     reads as built rather than extruded.

     Each brace goes in its own gable's batch, same as every other band, so
     it goes when that wall goes. */
  for (const [wall, outward] of [[north, -1], [south, 1]]) {
    /* Proud of the wall's outer face rather than centred in it. Centred, the
       0.35-deep brace poked five millimetres through to the inside and
       z-fought the limewash there — visible in the close shot as a diagonal
       scar across the inside of both gables. The frame belongs outside, on
       the elevation it was added to fix. */
    const faceZ = outward * (halfD - STABLE_WALL / 2 + 0.12);
    wall.add(timber, 0.22, wallTop, STABLE_WALL + 0.06, STABLE_WALL / 2, wallTop / 2, faceZ);
    for (const side of [1, -1]) {
      // Leaning up towards the centre post from each corner, which is the
      // direction a brace actually carries load and the one that reads.
      wall.add(timber, W * 0.42, 0.2, STABLE_WALL + 0.05,
        STABLE_WALL / 2 + side * W * 0.22, wallTop * 0.62, faceZ, side * 0.52);
    }
  }

  /* The open face: posts carrying the eave, and the head beam across them.
     Four posts at the building's corners and on the outer stall lines,
     which is both structurally plausible and the spacing that leaves the
     three middle bays wide enough to see a cow through.

     None of these are collision boxes. A post you cannot see coming that
     stops you walking into your own stable is worse than clipping one —
     the barn's own interior posts are exempted for the identical reason. */
  const postX = halfW - 0.16;
  const postZ = [-halfD + 0.16, ...dividerZ.filter((_, i) => i === 0 || i === dividerZ.length - 1),
    halfD - 0.16];
  for (const z of postZ) {
    fabric.add(timber, 0.24, wallTop, 0.24, postX, wallTop / 2, z);
  }
  fabric.add(timber, 0.26, 0.22, D, postX, wallTop - 0.11, 0);

  /* Stall partitions — low, so you see over them into every stall at once,
     and not collision either: the farmer walks the length of the stable to
     reach whichever animal she was sent to, and a partition that stopped
     her would mean five separate rooms with no way between them. They exist
     to say "five stalls" to the eye, which is the whole of their job.

     They stop short of the open face, which the first build did not do and
     a screenshot caught: partitions running the full depth turned the front
     of the stable into five separate mouths and left the farmer stepping
     over a beam every time she walked along it. Ending them short of it
     gives the building what a real stable has — a walkway down the open
     side, stalls off it — and it is the same walkway the job queue already
     sends her down. How short is WALKWAY's business, and it is narrower
     than this first tried: see the note there for what a too-generous aisle
     costs the animals behind it.

     Lighter timber than the posts, too. Dark on dark made the interior read
     as a cave in the close shot; against the straw these recede, which is
     what a partition should do next to the cow standing behind it. */
  // Counted as they are built rather than taken from dividerZ.length, so
  // the stall count the test surface reports is the number of partitions
  // actually standing in the building.
  let partitions = 0;
  for (const z of dividerZ) {
    fabric.add(troughMat, W - STABLE_WALL - WALKWAY, 0.5, 0.14,
      -halfW + STABLE_WALL + (W - STABLE_WALL - WALKWAY) / 2, 0.25 + floorY, z);
    partitions += 1;
  }

  /* The gable roof: ridge along the building's length, pitches falling east
     and west. The east pitch oversails the open face; the west one stops at
     its own wall. Built as two rotated slabs, same as the barn's gambrel,
     for the same "a box takes a material and a shadow with no vertex work"
     reason. */
  const roofH = H - wallTop;
  const roofBatch = batch('stable-roof');

  /* The pitch's run differs per side because the east eave oversails, so
     each is measured rather than mirrored — mirroring was the first build,
     and it left the ridge off-centre with a strip of sky along the top of
     the west wall. */
  for (const side of [1, -1]) {
    const run = halfW + (side > 0 ? OVERSAIL : 0.18);
    const len = Math.hypot(run, roofH);
    const tilt = Math.atan2(roofH, run);
    // Negated for the reason spelled out in barn.js: a pitch leans back over
    // the building, not out away from it.
    roofBatch.add(roofMat, len + 0.1, 0.18, D + 0.5,
      side * run / 2, (wallTop + H) / 2, 0, -side * tilt);
  }
  roofBatch.add(timber, 0.26, 0.2, D + 0.6, 0, H, 0);

  /* The gable triangles, filling between wall top and roof line at each
     end. A stack of slabs following the pitch — crude, and invisible as
     such once the roof sits on it, exactly as in the barn. */
  for (const z of [-halfD + STABLE_WALL / 2, halfD - STABLE_WALL / 2]) {
    const steps = 4;
    for (let i = 0; i < steps; i += 1) {
      const y0 = wallTop + roofH * (i / steps);
      const y1 = wallTop + roofH * ((i + 1) / steps);
      const mid = (y0 + y1) / 2;
      const w = W * (1 - (mid - wallTop) / roofH);
      roofBatch.add(limeShade, Math.max(0.2, w), y1 - y0 + 0.02, STABLE_WALL, 0, mid, z);
    }
  }
  const roof = roofBatch.seal();

  /* What the purchase actually buys, visually: bedding down and a feed
     trough in every stall.

     The pasture this replaces announced itself by putting a fence up, and
     something had to take that job — a purchase with no effect on the world
     is a purchase the player has no reason to believe in. Bedding was
     chosen over stall gates because gates are the obvious answer and the
     wrong one: they would sit across the open face, in the one sightline
     the entire building exists to keep clear, and she would be walking
     through them every time she went to milk a cow.

     The building itself is never hidden. It stands on an unbought farm the
     way an empty stable stands on a real one — swept, and waiting. Hiding
     it would have meant either an invisible wall where its walls are or a
     building that pops into existence on a button press, and the pasture's
     own note already recorded why neither is acceptable. */
  const beddingBatch = batch('stable-bedding');
  // One bed and one trough per row, sized to the gap between rows so the
  // bedding stops short of the partitions rather than running under them.
  // It stops short of the walkway too, for the same reason the partitions
  // do: straw laid across the path she walks is straw in the wrong place.
  const stallDepth = rowZ.length > 1 ? rowZ[1] - rowZ[0] : D / 5;
  const bedW = W - STABLE_WALL - WALKWAY - 0.5;
  for (const z of rowZ) {
    beddingBatch.add(strawMat, bedW, 0.07, stallDepth - 0.3,
      -halfW + STABLE_WALL + 0.25 + bedW / 2, floorY + 0.035, z);
    /* The trough goes against the back wall, where a trough goes, and where
       it cannot end up between the camera and an animal. Tall enough to
       clear the bedding by a clear margin — at 0.3 it stood eight
       centimetres proud of the straw and read as a lump in it rather than
       as a trough, which the close shot showed and the arithmetic should
       have predicted. */
    beddingBatch.add(troughMat, 0.34, 0.5, stallDepth - 0.75,
      -halfW + STABLE_WALL + 0.17, floorY + 0.25, z);
  }
  const bedding = beddingBatch.seal();

  /* Everything sealed and hung on the building, in the order it was built.
     The three walls stay their own groups so revealInterior can hide them
     one at a time; the rest is two groups that move as units and one that
     never moves at all. */
  root.add(fabric.seal(), west.seal(), north.seal(), south.seal(), roof, bedding);

  return {
    object: root,
    /* Three rectangles, not four: the east face is the opening. Everything
       downstream treats these as ordinary solids, which is what makes the
       open front open to the collision system as well as to the eye. */
    walls: [
      { minX: -halfW, maxX: -halfW + STABLE_WALL, minZ: -halfD, maxZ: halfD },
      { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: -halfD + STABLE_WALL },
      { minX: -halfW, maxX: halfW, minZ: halfD - STABLE_WALL, maxZ: halfD },
    ],
    /* The opening, as a point and a width — the whole east face, so anything
       aiming her at the stable aims her at the middle of it and cannot miss. */
    opening: { x: halfW, z: 0, width: D - STABLE_WALL * 2 },
    inside: { ...STABLE_INSIDE },
    /* Only the three walls carry normals; the roof is handled separately
       because it is in the way from every angle, not just from one.

       `mesh` is a Group rather than a Mesh now — a wall and its trim merged
       down to one draw each. Nothing downstream cares: revealInterior only
       ever sets .visible, and a Group hides its children with it, which is
       the same property that keeps the trim attached to its wall. */
    shell: [
      { mesh: west.group, normal: { x: -1, z: 0 } },
      { mesh: north.group, normal: { x: 0, z: -1 } },
      { mesh: south.group, normal: { x: 0, z: 1 } },
    ],
    roof,
    bedding,
    stallCount: partitions + 1,
    floorY,
    wallTop,
  };
}
