/* signs.js — the road signs: fingerposts at the junctions, and the boards
 * that say you have arrived in Farm City.
 *
 * Built here rather than loaded, and the reason is the lettering. The kit
 * has a signpost and a highway sign, and both are blank — painted shapes
 * with nothing on them — and a sign with nothing on it is the one thing a
 * sign cannot be. What makes these signs is text a player can read from
 * the driving seat, and text means a texture drawn for the purpose.
 *
 * Fingerposts rather than flat boards with arrows, for two reasons that
 * happen to agree. A fingerpost is what a junction in farm country actually
 * has — a black post with white arms, each arm pointing down its own road —
 * so it suits the place. And because each arm physically points, whether a
 * sign is *right* is a geometric question with an answer: the arm's angle
 * against the road it claims to lead down. A flat board with an arrow on it
 * can only be checked by looking.
 *
 * Every sign on the map is one mesh with one material. The lettering for
 * all of them is drawn into a single canvas atlas, and every surface of
 * every sign — the white of an arm, the black of a post, the gold of a
 * finial — samples it, either a label or a small swatch of flat paint. The
 * stable's first build cost forty-seven draw calls and taught the lesson
 * this file starts from: the whole sign network costs one.
 *
 * Nothing here reaches into the scene. buildSigns takes the specs and a
 * ground-height function and hands back an Object3D, the collision boxes,
 * and a description of what it built that a test can hold to account.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* An arm: long enough to carry "Country House" in letters that read from
   the chase camera, and the height that decides that. The camera sits 8.5
   behind and 3.6 above the car with a 48-degree field; at nine units a
   world unit is about 80 pixels on a 700-pixel-high view, so the 0.2 of
   cap height the lettering gets is some sixteen pixels — legible, and
   asserted by a test rather than hoped.

   The first build was 2.2 by 0.44 and came out at 0.17: the long names set
   the letter size, and at that aspect "Country House" only fits at 0.17.
   A real fingerpost arm is smaller than this; this one is drawn for a
   camera eight units back, and a sign that is accurate and illegible is a
   sign that is neither. */
const ARM = { length: 2.5, height: 0.5, thick: 0.07, point: 0.38, root: 0.1 };

/* Arms stack up the post, lowest first. The lowest clears the farmer's
   head — she is 1.6 tall and only the post stops her, so an arm she could
   walk into would be a thing she walked through — and the spacing leaves a
   hand's breadth between arms so each reads as its own. */
const ARM_LEVELS = [2.1, 2.66, 3.22, 3.78];

/* Arms pointing well apart share a level, the way real fingerposts carry
   two arms on one collar. Arms pointing within this of each other never
   do, because two arms at one height pointing the same way are one arm
   with two names fused together. */
const SHARE_LEVEL_APART = THREE.MathUtils.degToRad(60);

const POST = { width: 0.15 };
const BOARD = { width: 3.8, height: 1.8, thick: 0.12, bottom: 1.05 };

/* The colours, as swatches in the atlas. A post is black, an arm white
   with black lettering, the finial gold; the town's boards are a deep
   green with white lettering — the heritage palette, chosen because it is
   the one people already read as "official sign" before they read a word. */
const PAINT = {
  white: '#f4f2ea',
  black: '#1b1b1b',
  gold: '#c79a2b',
  concrete: '#9c968a',
  green: '#1d5236',
  greenDark: '#143b27',
  cream: '#efe6c8',
};

/* Atlas cells, in canvas pixels. A label is drawn at the arm's own aspect
   so the lettering is never stretched; the board at its own.

   Sized against the screen rather than for luxury. The first atlas was
   2048 by 4096 — forty-odd megabytes of GPU memory once mipmapped, for some
   signs — because each cell was a power of two wide and the padding pushed
   every second one onto a row of its own. A label is 160 texels to the
   world unit here and the screen shows it at about 80 from the driving
   seat, so twice what the eye can use is what is spent, and the whole atlas
   comes out 2048 by 512. */
const LABEL_W = 400;
const LABEL_H = Math.round(LABEL_W * (ARM.height / ARM.length));
const BOARD_W = 704;
const BOARD_H = Math.round(BOARD_W * (BOARD.height / BOARD.width));
const SWATCH = 16;
const PAD = 4;

/* Lettering. A plain bold sans for the arms because that is what a road
   sign is set in; a serif for the town's name because a town's name on its
   own sign is the one place a road allows itself some ceremony. Fallbacks
   all the way down to the generic family, so a headless CI machine with no
   fonts installed still draws letters rather than boxes. */
const ARM_FONT = '"Helvetica Neue", Helvetica, Arial, "DejaVu Sans", sans-serif';
const TITLE_FONT = 'Georgia, "Times New Roman", "DejaVu Serif", serif';

/* -------------------------------------------------------------------- */
/* The atlas                                                             */
/* -------------------------------------------------------------------- */

/* Lays out every cell the signs need, then draws them. Two passes because
   the canvas has to be sized before anything is drawn on it, and its size
   depends on how many labels there are. Cells are packed row by row;
   nothing cleverer is needed for a few dozen rectangles. */
function makeAtlas(labels, boards) {
  const cells = [];
  const swatches = Object.keys(PAINT).map((key) => ({ kind: 'swatch', key, w: SWATCH, h: SWATCH }));
  const labelCells = labels.map((text) => ({ kind: 'label', text, w: LABEL_W, h: LABEL_H }));
  /* One pair of cells per distinct board, not per board. Both roads into
     town carry the same welcome, and drawing it twice was half the reason
     the first atlas was the size it was. */
  const designKey = (b) => `${b.title}\u0000${b.motto}`;
  const designs = [...new Map(boards.map((b) => [designKey(b), b])).values()];
  const boardCells = designs.flatMap((b) => [
    { kind: 'board', side: 'front', design: designKey(b), title: b.title, motto: b.motto, w: BOARD_W, h: BOARD_H },
    { kind: 'board', side: 'back', design: designKey(b), title: b.title, motto: b.motto, w: BOARD_W, h: BOARD_H },
  ]);
  const ordered = [...boardCells, ...labelCells, ...swatches];

  const WIDTH = 2048;
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of ordered) {
    if (x + c.w + PAD > WIDTH) { x = 0; y += rowH + PAD; rowH = 0; }
    c.x = x; c.y = y;
    x += c.w + PAD;
    rowH = Math.max(rowH, c.h);
    cells.push(c);
  }
  const used = y + rowH;
  // A power of two tall, so mipmapping behaves on every GPU this runs on.
  const HEIGHT = 2 ** Math.ceil(Math.log2(Math.max(used, 64)));

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAINT.white;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  /* One letter size for every arm on the map: the largest at which the
     longest name still fits. A real sign system sets every name at one
     size, and the alternative — each label as large as it can be — makes
     "Farm" twice the height of "Country House" on the same post, which
     reads as two different signs bolted together. */
  const size = sharedLabelSize(ctx, labels);
  const fit = {}; // label text -> the font size it was drawn at
  for (const c of cells) {
    if (c.kind === 'swatch') {
      ctx.fillStyle = PAINT[c.key];
      ctx.fillRect(c.x, c.y, c.w, c.h);
    } else if (c.kind === 'label') {
      fit[c.text] = drawLabel(ctx, c, size);
    } else {
      drawBoard(ctx, c);
    }
  }

  /* UV rectangle for a cell, inset by half a pixel so bilinear filtering
     never reaches into the neighbouring cell. canvas y runs down, texture v
     runs up, hence the flip. */
  const uvOf = (c) => ({
    u0: (c.x + 0.5) / WIDTH,
    u1: (c.x + c.w - 0.5) / WIDTH,
    v0: 1 - (c.y + c.h - 0.5) / HEIGHT,
    v1: 1 - (c.y + 0.5) / HEIGHT,
  });
  const swatchUV = {};
  for (const c of cells) if (c.kind === 'swatch') swatchUV[c.key] = uvOf(c);
  const labelUV = {};
  for (const c of cells) if (c.kind === 'label') labelUV[c.text] = uvOf(c);
  const byDesign = new Map();
  for (const c of cells) {
    if (c.kind !== 'board') continue;
    if (!byDesign.has(c.design)) byDesign.set(c.design, {});
    byDesign.get(c.design)[c.side] = uvOf(c);
  }
  const boardUV = (b) => byDesign.get(designKey(b));
  return { canvas, swatchUV, labelUV, boardUV, fit, width: WIDTH, height: HEIGHT };
}

/* One arm's face: white, a black rule inset from the edge, the place name
   in black. Drawn at the largest size that fits, and the size it settled
   on is handed back — a label too long for its arm gets smaller letters,
   and a test checks that no label got so small it stopped being readable. */
const labelInset = (h) => Math.round(h * 0.09);
const labelRoom = (w, h) => w - labelInset(h) * 2 - h * 0.45;

function sharedLabelSize(ctx, labels) {
  let size = Math.round(LABEL_H * 0.62);
  const room = labelRoom(LABEL_W, LABEL_H);
  const widest = () => Math.max(...labels.map((t) => ctx.measureText(t).width), 0);
  ctx.font = `bold ${size}px ${ARM_FONT}`;
  while (size > 10 && widest() > room) {
    size -= 1;
    ctx.font = `bold ${size}px ${ARM_FONT}`;
  }
  return size;
}

function drawLabel(ctx, c, size) {
  ctx.fillStyle = PAINT.white;
  ctx.fillRect(c.x, c.y, c.w, c.h);
  const inset = labelInset(c.h);
  ctx.strokeStyle = PAINT.black;
  ctx.lineWidth = Math.max(2, Math.round(c.h * 0.045));
  ctx.strokeRect(c.x + inset, c.y + inset, c.w - inset * 2, c.h - inset * 2);
  ctx.font = `bold ${size}px ${ARM_FONT}`;
  ctx.fillStyle = PAINT.black;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(c.text, c.x + c.w / 2, c.y + c.h / 2 + size * 0.04);
  return size;
}

/* A sheaf of wheat, the town's emblem — a dozen stalks gathered at a band
   and fanning at the top, each ear a run of grains. Drawn with paths rather
   than loaded as an image, so the sign carries no asset of its own. */
function drawSheaf(ctx, cx, cy, s) {
  ctx.save();
  ctx.strokeStyle = PAINT.gold;
  ctx.fillStyle = PAINT.gold;
  ctx.lineWidth = Math.max(2, s * 0.035);
  ctx.lineCap = 'round';
  const stalks = 11;
  for (let i = 0; i < stalks; i += 1) {
    const t = i / (stalks - 1) - 0.5;
    const topX = cx + t * s * 0.95;
    const topY = cy - s * 0.55 + Math.abs(t) * s * 0.25;
    const footX = cx + t * s * 0.5;
    const footY = cy + s * 0.6;
    ctx.beginPath();
    ctx.moveTo(footX, footY);
    ctx.quadraticCurveTo(cx + t * s * 0.15, cy + s * 0.05, topX, topY);
    ctx.stroke();
    // The ear: grains up the last stretch of the stalk.
    const ang = Math.atan2(topY - cy, topX - cx + 1e-6) + Math.PI / 2;
    for (let g = 0; g < 4; g += 1) {
      const gx = topX - Math.sin(ang) * g * s * 0.05;
      const gy = topY + Math.cos(ang) * g * s * 0.05 + g * s * 0.045;
      ctx.beginPath();
      ctx.ellipse(gx, gy, s * 0.028, s * 0.055, t * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // The band that ties it.
  ctx.fillRect(cx - s * 0.2, cy + s * 0.08, s * 0.4, s * 0.09);
  ctx.restore();
}

/* The town's board. Front for arriving, back for leaving — a board that is
   blank from behind is a board somebody forgot to finish, and the drive
   out of town passes the back of it every time. */
function drawBoard(ctx, c) {
  const { x, y, w, h } = c;
  const lines = c.side === 'front'
    ? { over: 'WELCOME TO', title: c.title, under: c.motto }
    : { over: 'THANK YOU FOR VISITING', title: c.title, under: 'Please come back soon' };

  ctx.fillStyle = PAINT.green;
  ctx.fillRect(x, y, w, h);
  // A white border and a gold rule inside it: the frame is what makes a
  // board read as a sign rather than a painted wall.
  const b = Math.round(h * 0.045);
  ctx.strokeStyle = PAINT.white;
  ctx.lineWidth = b;
  ctx.strokeRect(x + b * 1.4, y + b * 1.4, w - b * 2.8, h - b * 2.8);
  ctx.strokeStyle = PAINT.gold;
  ctx.lineWidth = Math.max(2, Math.round(b * 0.35));
  ctx.strokeRect(x + b * 2.6, y + b * 2.6, w - b * 5.2, h - b * 5.2);

  const sheaf = h * 0.42;
  drawSheaf(ctx, x + w * 0.13, y + h * 0.53, sheaf);
  drawSheaf(ctx, x + w * 0.87, y + h * 0.53, sheaf);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mid = x + w / 2;
  const room = w * 0.62;

  const fitText = (text, start, family, weight) => {
    let size = start;
    ctx.font = `${weight} ${size}px ${family}`;
    while (size > 10 && ctx.measureText(text).width > room) {
      size -= 2;
      ctx.font = `${weight} ${size}px ${family}`;
    }
    return size;
  };

  ctx.fillStyle = PAINT.cream;
  fitText(lines.over, Math.round(h * 0.1), ARM_FONT, 'bold');
  ctx.fillText(lines.over, mid, y + h * 0.24);

  ctx.fillStyle = PAINT.white;
  fitText(lines.title, Math.round(h * 0.3), TITLE_FONT, 'bold');
  ctx.fillText(lines.title, mid, y + h * 0.5);

  ctx.fillStyle = PAINT.cream;
  fitText(lines.under, Math.round(h * 0.085), TITLE_FONT, 'italic');
  ctx.fillText(lines.under, mid, y + h * 0.77);
}

/* -------------------------------------------------------------------- */
/* Geometry, with every UV pointed into the atlas                        */
/* -------------------------------------------------------------------- */

/* Points every vertex of a geometry at one swatch of flat paint. The
   centre of the swatch rather than its corners, and that matters for one
   geometry in particular: ExtrudeGeometry does not make 0-to-1 UVs, it
   makes them in the shape's own units, so stretching them across a swatch
   would have sampled the cells either side of it. A flat colour needs no
   mapping at all, only a place to sample, and the middle of the swatch is
   the place no filter can reach out of. */
function paint(geometry, uv) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const attr = g.getAttribute('uv');
  const u = (uv.u0 + uv.u1) / 2;
  const v = (uv.v0 + uv.v1) / 2;
  for (let i = 0; i < attr.count; i += 1) attr.setXY(i, u, v);
  return g;
}

/* A box whose two big faces carry a label and whose other four are a
   swatch. BoxGeometry builds its faces in a fixed order — +x, -x, +y, -y,
   +z, -z, four vertices each — and builds each so it reads correctly from
   outside, so the front and back both read left to right from their own
   side with no mirroring. That is the property a fingerpost needs: the
   same name, the right way round, from either direction of travel. */
function labelledBox(w, h, d, faceUV, edgeUV) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const attr = g.getAttribute('uv');
  for (let face = 0; face < 6; face += 1) {
    const uv = face >= 4 ? (face === 4 ? faceUV.front : faceUV.back) : edgeUV;
    // toNonIndexed expands each face to six vertices (two triangles).
    for (let k = 0; k < 6; k += 1) {
      const i = face * 6 + k;
      attr.setXY(i, uv.u0 + attr.getX(i) * (uv.u1 - uv.u0), uv.v0 + attr.getY(i) * (uv.v1 - uv.v0));
    }
  }
  return g;
}

/* The arrowhead at the end of an arm: a triangle in the arm's plane,
   extruded to its thickness. */
function armPoint(uv) {
  const shape = new THREE.Shape();
  const h = ARM.height / 2;
  shape.moveTo(0, -h);
  shape.lineTo(ARM.point, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: ARM.thick, bevelEnabled: false });
  g.translate(0, 0, -ARM.thick / 2);
  return paint(g, uv);
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function placed(g, x, y, z, yaw = 0) {
  tmpQ.setFromAxisAngle(UP, yaw);
  g.applyMatrix4(tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS));
  return g;
}

/* Which level each arm goes on: greedily, lowest first, sharing a level
   only with arms pointing well away from it. Deterministic in the order
   the arms are given, so the post a test measures is the post that was
   built. */
function assignLevels(arms) {
  const levels = [];
  return arms.map((arm) => {
    for (let i = 0; i < ARM_LEVELS.length; i += 1) {
      const there = levels[i] ?? [];
      const clash = there.some((other) => {
        let d = Math.abs(other - arm.yaw) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d < SHARE_LEVEL_APART;
      });
      if (!clash) {
        there.push(arm.yaw);
        levels[i] = there;
        return i;
      }
    }
    return ARM_LEVELS.length - 1;
  });
}

/* -------------------------------------------------------------------- */
/* The signs                                                             */
/* -------------------------------------------------------------------- */

/**
 * Builds every sign. `fingerposts` are { id, x, z, arms: [{ label, dx, dz }] }
 * where (dx, dz) is the direction the arm points; `boards` are
 * { id, x, z, yaw, title, motto }, facing along their yaw. `groundAt`
 * gives the terrain height, since country junctions stand on the hills.
 *
 * Returns the mesh, the collision boxes, and a report of what was built.
 */
export function buildSigns({ fingerposts = [], boards = [], groundAt = () => 0, anisotropy = 1 }) {
  const labels = [...new Set(fingerposts.flatMap((f) => f.arms.map((a) => a.label)))];
  const atlas = makeAtlas(labels, boards);
  const sw = atlas.swatchUV;

  const parts = [];
  const solids = [];
  const report = { fingerposts: [], boards: [], fontPx: atlas.fit, labelPxHigh: LABEL_H };

  /* World units of cap height a label of a given font size comes out at.
     Cap height is about 0.7 of the em in the families above. */
  const capUnits = (px) => (px * 0.7) * (ARM.height / LABEL_H);

  for (const f of fingerposts) {
    const g0 = groundAt(f.x, f.z);
    const arms = f.arms.map((a) => ({ ...a, yaw: Math.atan2(-a.dz, a.dx) }));
    const levelOf = assignLevels(arms);
    const top = ARM_LEVELS[Math.max(...levelOf)] + ARM.height / 2 + 0.3;

    // Plinth, post, cap and finial.
    parts.push(placed(paint(new THREE.BoxGeometry(0.42, 0.18, 0.42), sw.concrete), f.x, g0 + 0.09, f.z));
    parts.push(placed(paint(new THREE.BoxGeometry(POST.width, top, POST.width), sw.black), f.x, g0 + top / 2, f.z));
    parts.push(placed(paint(new THREE.BoxGeometry(0.22, 0.06, 0.22), sw.black), f.x, g0 + top + 0.03, f.z));
    parts.push(placed(paint(new THREE.IcosahedronGeometry(0.09, 1), sw.gold), f.x, g0 + top + 0.14, f.z));
    // A white band near the foot, which is what makes a black post visible
    // at dusk against dark hedges — and what the real ones have for it.
    parts.push(placed(paint(new THREE.BoxGeometry(POST.width + 0.012, 0.18, POST.width + 0.012), sw.white),
      f.x, g0 + 0.55, f.z));

    const built = [];
    arms.forEach((arm, i) => {
      const y = g0 + ARM_LEVELS[levelOf[i]];
      const uv = atlas.labelUV[arm.label];
      // The plank, along the arm's local +x from just off the post…
      const plank = labelledBox(ARM.length, ARM.height, ARM.thick, { front: uv, back: uv }, sw.white);
      plank.translate(ARM.root + ARM.length / 2, 0, 0);
      // …and the point beyond it, which is what does the pointing.
      const point = armPoint(sw.white);
      point.translate(ARM.root + ARM.length, 0, 0);
      parts.push(placed(plank, f.x, y, f.z, arm.yaw));
      parts.push(placed(point, f.x, y, f.z, arm.yaw));
      built.push({
        label: arm.label, dx: Math.cos(arm.yaw), dz: -Math.sin(arm.yaw), level: levelOf[i], y,
        capHeight: capUnits(atlas.fit[arm.label]),
      });
    });

    /* The collision box: generous for the size of the post, on purpose. The
       foliage scatter keeps a trunk's *centre* a little way off any solid,
       not its bark, so a box drawn tight to a 0.15 post would let a 0.5
       trunk grow through it. Still well under a unit, so it counts as
       dressing to the overlap test. */
    solids.push({
      id: 'sign', minX: f.x - 0.4, maxX: f.x + 0.4, minZ: f.z - 0.4, maxZ: f.z + 0.4,
      minY: g0, maxY: g0 + top,
    });
    report.fingerposts.push({ id: f.id, x: f.x, z: f.z, ground: g0, height: top, arms: built });
  }

  for (const b of boards) {
    const g0 = groundAt(b.x, b.z);
    const uv = atlas.boardUV(b);
    const yMid = g0 + BOARD.bottom + BOARD.height / 2;
    /* The board's local +z is its face, and it is turned to face along
       its yaw — towards the traffic arriving. */
    const panel = labelledBox(BOARD.width, BOARD.height, BOARD.thick, uv, sw.green);
    parts.push(placed(panel, b.x, yMid, b.z, b.yaw));
    // A cap rail along the top, and the two posts it stands on.
    const cap = paint(new THREE.BoxGeometry(BOARD.width + 0.16, 0.08, BOARD.thick + 0.08), sw.greenDark);
    parts.push(placed(cap, b.x, yMid + BOARD.height / 2 + 0.04, b.z, b.yaw));
    const postH = BOARD.bottom + BOARD.height + 0.1;
    for (const side of [-1, 1]) {
      const lx = side * (BOARD.width / 2 - 0.25);
      const px = b.x + lx * Math.cos(b.yaw);
      const pz = b.z - lx * Math.sin(b.yaw);
      const pg = groundAt(px, pz);
      parts.push(placed(paint(new THREE.BoxGeometry(0.14, postH, 0.14), sw.greenDark), px, pg + postH / 2, pz));
    }

    /* Collision as a row of small boxes along the board rather than one
       box round it. The board turns to face the road at whatever angle the
       road arrives at, and an axis-aligned box round a turned board is
       mostly air — enough of it, the first time, to have stood in the
       carriageway. Spaced so no gap is as wide as she is. */
    for (let lx = -BOARD.width / 2 + 0.2; lx <= BOARD.width / 2 - 0.2 + 1e-6; lx += 0.45) {
      const px = b.x + lx * Math.cos(b.yaw);
      const pz = b.z - lx * Math.sin(b.yaw);
      solids.push({
        id: 'sign', minX: px - 0.2, maxX: px + 0.2, minZ: pz - 0.2, maxZ: pz + 0.2,
        minY: g0, maxY: g0 + postH,
      });
    }
    report.boards.push({
      id: b.id, x: b.x, z: b.z, ground: g0,
      // The direction its lettered face looks.
      faceX: Math.sin(b.yaw), faceZ: Math.cos(b.yaw),
      title: b.title,
    });
  }

  const texture = new THREE.CanvasTexture(atlas.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  /* The atlas is its own emissive map, faintly. Road-sign paint is
     retroreflective — that is why a white sign reads as white rather than
     the grey any other painted surface goes in shade — and the first look
     showed exactly that grey: lit like everything else, the arms came out
     the colour of the barn's shadow side. A little self-light from the same
     texture brings the white back without lifting the black lettering,
     which stays black because black times anything is black. */
  const material = new THREE.MeshStandardMaterial({
    name: 'signs', map: texture, roughness: 0.62, metalness: 0,
    emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.22,
  });

  const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
  for (const g of parts) g.dispose();
  mesh.name = 'signs';

  report.atlas = { width: atlas.width, height: atlas.height };
  return { object: mesh, solids, report };
}
