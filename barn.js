/* barn.js — the barn, built here rather than loaded from a kit.
 *
 * The second building the game builds instead of loading, and for a harder
 * reason than the farmer. She was built because no kit in the pinned mirror
 * has a human in it. The barn is built because *no authored building can be
 * walked into*. Every model in `city-suburban` is an exterior: a closed
 * shell with a painted-on door and no volume behind it. Scaling one up and
 * cutting a hole in it is not an option — the geometry has no inside, so a
 * hole in the south wall shows you the back of the north wall's outward
 * face, lit from the wrong side, with nothing in between.
 *
 * Which is fine, because what the building has to be is not really a model
 * problem. An enterable building is four walls that stop her, one gap that
 * does not, a floor, and a roof that gets out of the camera's way when she
 * is under it. That list is short enough to build exactly, and building it
 * exactly is what lets the collision boxes below be the *same* rectangles as
 * the walls you can see, rather than a bounding box that approximates them.
 * A loaded model would have given one box for the whole footprint, and a
 * door you cannot walk through is not a door.
 *
 * Style follows the rest of the farm: flat-shaded, chunky, no texture. It is
 * a red barn with white trim and a gambrel roof, which is a shape that reads
 * as "barn" at fifty metres in a way that a plain gable does not — and
 * reading as a barn at distance is most of the job, because from the yard
 * this is a silhouette against the trees.
 *
 * The parts that matter to scene.js come back alongside the Object3D:
 * `walls` are the collision rectangles in world space, `doorway` is the gap
 * she walks through, `inside` is the floor rectangle, and `shell` is
 * everything the camera has to be able to see past. Nothing here reaches
 * into the scene; scene.js decides what to do with all of it.
 */
import * as THREE from 'three';

/* Sized to the gap it has to live in rather than to a picture of a barn, and
   the gap is narrower than it looks. The farm's flat ground stops at 13.4,
   which sets the east edge. The west edge is set by something less obvious:
   the walk-to-work queue walks a straight line to a plot or an animal and
   finishes when it has covered the distance, so the rectangle holding the
   field and the pasture — out to x 6.5 — has to be clear of anything solid,
   or a job ends with her standing against a wall believing she has arrived.
   The first placement put the barn's west wall at 6.5, which with her body
   radius reached 6.25 and broke exactly that. 6.3 across centred at 10.25
   puts the wall at 7.1 and keeps a third of a unit of daylight between the
   two.

   Depth and height are then chosen against her — an interior of 5.7 by 7.8
   is a room two cows and a winter's produce fit in without the camera having
   to squeeze, and 5.8 tall is three and a half times the farmer, which is
   the ratio the art bible's scale table holds the farmhouse to. */
export const BARN_WIDTH = 6.3;
export const BARN_DEPTH = 8.4;
export const BARN_HEIGHT = 5.8;

/* Wall thickness. Thicker than a real barn's boards by some margin, and
   deliberately: this is also the collision rectangle, and a wall thin enough
   to be accurate is thin enough for a fast walk to step over in one frame.
   At 0.3 it is a third of her body radius, which no step can cross. */
const WALL = 0.3;

/* The doorway, as a fraction of the front wall. Wide enough for the double
   doors a barn actually has, which is also wide enough that walking in does
   not require aiming — she is steered with a thumbstick, and a gap she has
   to thread is a gap the player will bounce off twice before getting in. */
const DOOR_FRACTION = 0.34;
/* The eaves height: where the wall stops and the gambrel starts. A quarter
   short of the full height, so the roof is the tall half of the silhouette.
   That ratio is what makes it a barn rather than a shed with a fancy lid. */
const EAVES = 0.58;

const PAINT = {
  board: 0xa8352b,      // barn red, weathered rather than post-box
  boardDark: 0x8e2a22,  // the alternate plank, so the walls have grain
  trim: 0xe8e2d4,       // bone white, not pure: pure white blows out at noon
  roof: 0x4a4038,       // tarred shingle
  floor: 0x6b5336,      // packed earth, a shade off the field's soil
  post: 0x6b4a2f,       // structural timber, left unpainted
};

const mat = (hex, name) => new THREE.MeshStandardMaterial({
  name,
  color: hex,
  roughness: 0.86,
  metalness: 0,
  flatShading: true,
});

/** A box, positioned by its centre. The workhorse; everything here is one. */
function slab(material, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

/* One pitch of the gambrel, as a flat slab rotated into place. Built from a
   box rather than from a shaped prism because a box takes a material and a
   shadow correctly with no vertex work, and at this size the open triangle
   at each end is closed by the gable walls below it. */
function pitch(material, length, thickness, depth, x, y, z, tilt) {
  const m = slab(material, length, thickness, depth, x, y, z);
  m.rotation.z = tilt;
  return m;
}

/**
 * Builds the barn at the origin, facing +Z — the doorway is in the south
 * wall, which is the one the default camera is looking at.
 *
 * Returns the object plus everything scene.js needs to treat it as a place
 * rather than a prop: the wall rectangles to collide against, the doorway to
 * leave open, the floor rectangle that counts as "inside", and the shell
 * meshes to hide when she is in there.
 */
export function buildBarn() {
  const W = BARN_WIDTH;
  const D = BARN_DEPTH;
  const H = BARN_HEIGHT;
  const wallTop = H * EAVES;
  const doorW = W * DOOR_FRACTION;
  const doorH = wallTop * 0.82;

  const board = mat(PAINT.board, 'barn-board');
  const boardDark = mat(PAINT.boardDark, 'barn-board-dark');
  const trim = mat(PAINT.trim, 'barn-trim');
  const roofMat = mat(PAINT.roof, 'barn-roof');
  const floorMat = mat(PAINT.floor, 'barn-floor');
  const postMat = mat(PAINT.post, 'barn-post');

  const root = new THREE.Group();
  root.name = 'barn';

  /* The floor, a hair above ground so it wins the depth fight with the
     terrain mesh underneath rather than flickering against it. */
  const floor = slab(floorMat, W, 0.08, D, 0, 0.04, 0);
  floor.name = 'barn-floor';
  root.add(floor);

  const halfW = W / 2;
  const halfD = D / 2;

  /* The four walls. The south one is two piers with the doorway between
     them, plus a lintel over the top — which is why it is built as three
     pieces rather than one, and why the collision list below has five
     rectangles and not four. */
  const shell = [];
  const addWall = (mesh) => { root.add(mesh); shell.push(mesh); return mesh; };

  const north = addWall(slab(board, W, wallTop, WALL, 0, wallTop / 2, -halfD + WALL / 2));
  const east = addWall(slab(boardDark, WALL, wallTop, D - WALL * 2, halfW - WALL / 2, wallTop / 2, 0));
  const west = addWall(slab(boardDark, WALL, wallTop, D - WALL * 2, -halfW + WALL / 2, wallTop / 2, 0));

  const pierW = (W - doorW) / 2;
  const pierX = doorW / 2 + pierW / 2;
  const southZ = halfD - WALL / 2;
  const pierL = addWall(slab(board, pierW, wallTop, WALL, -pierX, wallTop / 2, southZ));
  const pierR = addWall(slab(board, pierW, wallTop, WALL, pierX, wallTop / 2, southZ));
  // The lintel spans the gap above head height, so it is not a wall she can
  // hit — it is shell to be hidden, but never a collision box.
  const lintel = addWall(
    slab(board, doorW, wallTop - doorH, WALL, 0, doorH + (wallTop - doorH) / 2, southZ),
  );

  /* Trim: the white bands that make it read as painted rather than moulded.
     Cheap — a handful of thin slabs — and they do more for the silhouette
     than any amount of extra geometry in the walls would.

     Parented to the wall each one sits on rather than to the root, which is
     not tidiness: the shell hiding below works by turning a wall invisible,
     and trim held by the root survives its own wall going away. The first
     build did exactly that and left a white rectangle hanging in the air
     over the doorway with nothing under it. A child goes with its parent. */
  const band = (parent, w, d, x, y, z) => {
    parent.add(slab(trim, w, 0.16, d, x - parent.position.x, y - parent.position.y,
      z - parent.position.z));
  };
  band(north, W, WALL + 0.04, 0, wallTop - 0.08, -halfD + WALL / 2);
  band(east, WALL + 0.04, D, halfW - WALL / 2, wallTop - 0.08, 0);
  band(west, WALL + 0.04, D, -halfW + WALL / 2, wallTop - 0.08, 0);
  band(pierL, pierW, WALL + 0.04, -pierX, wallTop - 0.08, southZ);
  band(pierR, pierW, WALL + 0.04, pierX, wallTop - 0.08, southZ);

  /* Door surround, which is the one piece of trim doing a job beyond
     decoration: it tells the player where the gap is from across the yard.
     Each upright belongs to the pier beside it, and the head belongs to the
     lintel, for the same parenting reason. */
  const surround = (parent, w, h, x, y) => {
    parent.add(slab(trim, w, h, WALL + 0.05, x - parent.position.x, y - parent.position.y, 0));
  };
  surround(pierL, 0.2, doorH, -doorW / 2, doorH / 2);
  surround(pierR, 0.2, doorH, doorW / 2, doorH / 2);
  surround(lintel, doorW + 0.4, 0.2, 0, doorH);

  /* The gambrel: two pitches a side, the lower one steep and the upper one
     shallow, meeting at a break two-thirds of the way up. Four slabs and a
     ridge cap. */
  const roofH = H - wallTop;
  const breakY = wallTop + roofH * 0.55;
  const breakX = halfW * 0.56;
  const roof = new THREE.Group();
  roof.name = 'barn-roof';

  const lowerLen = Math.hypot(halfW - breakX, breakY - wallTop);
  const lowerTilt = Math.atan2(breakY - wallTop, halfW - breakX);
  const upperLen = Math.hypot(breakX, H - breakY);
  const upperTilt = Math.atan2(H - breakY, breakX);

  /* Negated, and the sign is the whole of it. A pitch runs from the eave
     *inward and upward* — on the right-hand side that is up and to the
     left — so the slab's axis leans back over the building, not out away
     from it. Signed the other way the two sides splayed outward from the
     ridge like a pair of opened shutters, which is what the first build drew
     and what the screenshot caught. (A box is symmetric end to end, so the
     angle wanted here and the one that is formally correct differ by exactly
     pi and either draws the same roof.) */
  for (const side of [1, -1]) {
    roof.add(pitch(roofMat, lowerLen + 0.3, 0.2, D + 0.5,
      side * (halfW + breakX) / 2, (wallTop + breakY) / 2, 0, -side * lowerTilt));
    roof.add(pitch(roofMat, upperLen + 0.2, 0.2, D + 0.5,
      side * breakX / 2, (breakY + H) / 2, 0, -side * upperTilt));
  }
  roof.add(slab(trim, 0.3, 0.2, D + 0.6, 0, H, 0));

  /* The gable ends, filling the triangle between the wall top and the roof
     line so the barn is not open at both ends when seen from the side. Built
     as a stack of slabs following the gambrel's profile — crude, and
     invisible as such once the roof sits on it. */
  for (const z of [-halfD + WALL / 2, halfD - WALL / 2]) {
    const steps = 5;
    for (let i = 0; i < steps; i += 1) {
      const y0 = wallTop + (H - wallTop) * (i / steps);
      const y1 = wallTop + (H - wallTop) * ((i + 1) / steps);
      const mid = (y0 + y1) / 2;
      // Half-width of the roof profile at this height, following the break.
      const w = mid < breakY
        ? halfW - (halfW - breakX) * ((mid - wallTop) / (breakY - wallTop))
        : breakX * (1 - (mid - breakY) / (H - breakY));
      roof.add(slab(board, Math.max(0.2, w * 2), y1 - y0 + 0.02, WALL, 0, mid, z));
    }
  }
  root.add(roof);

  /* Two structural posts inside, which exist for the eye rather than for the
     roof: an empty rectangular room reads as a box, and a room with
     something in it reads as a space. They stand clear of the walking area
     and out of the stock's way. */
  for (const side of [1, -1]) {
    root.add(slab(postMat, 0.26, wallTop, 0.26, side * (halfW - 1.1), wallTop / 2, -halfD + 2.2));
  }

  /* World-space collision rectangles, in the barn's own local frame — the
     caller offsets and (if it must) rotates them. Note what is missing: the
     lintel over the door, which is above her head, and the posts, which she
     is allowed to walk through because being stopped by a post you cannot
     see coming is worse than clipping one. */
  const walls = [
    { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: -halfD + WALL },
    { minX: halfW - WALL, maxX: halfW, minZ: -halfD, maxZ: halfD },
    { minX: -halfW, maxX: -halfW + WALL, minZ: -halfD, maxZ: halfD },
    { minX: -halfW, maxX: -doorW / 2, minZ: halfD - WALL, maxZ: halfD },
    { minX: doorW / 2, maxX: halfW, minZ: halfD - WALL, maxZ: halfD },
  ];

  return {
    object: root,
    walls,
    /* The gap, as a point and a width — scene.js aims her at this when she
       takes the prompt, rather than at the middle of the building, which is
       behind a wall. */
    doorway: { x: 0, z: halfD, width: doorW },
    /* The floor rectangle, inset by the walls. "Inside" is a question asked
       every frame, so it is a rectangle rather than anything cleverer. */
    inside: {
      minX: -halfW + WALL, maxX: halfW - WALL,
      minZ: -halfD + WALL, maxZ: halfD - WALL,
    },
    /* Everything between an outside camera and a farmer standing in here.
       Each carries the outward normal of the face it belongs to, so the
       scene can hide only the walls actually in the way rather than all of
       them — a barn with every wall hidden is a floating roof. */
    shell: [
      { mesh: north, normal: { x: 0, z: -1 } },
      { mesh: east, normal: { x: 1, z: 0 } },
      { mesh: west, normal: { x: -1, z: 0 } },
      { mesh: pierL, normal: { x: 0, z: 1 } },
      { mesh: pierR, normal: { x: 0, z: 1 } },
      { mesh: lintel, normal: { x: 0, z: 1 } },
    ],
    roof,
    /* The usable floor, for whatever wants to lay stock out on it. */
    floorY: 0.08,
    wallTop,
  };
}
