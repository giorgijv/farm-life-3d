/* interiors.js — the inside of Farm City's shops.
 *
 * Each shop is a room of its own: its own THREE.Scene, its own lights, its
 * own collision boxes and the rectangle she may walk in. scene.js draws it
 * instead of the world while she is inside, so the street costs nothing in
 * there and the room costs nothing out here.
 *
 * The room is placed where the shop actually is — inside the block's own
 * footprint, in world coordinates — rather than somewhere convenient. Every
 * rule the game asks of where she is (the distance to a plot, to the car, to
 * the tool counter) then gives the answer it would give in the street, and
 * none of them has to be told she has gone indoors.
 *
 * It is seen as a dollhouse: no ceiling, and the street wall cut down to the
 * height of the stall riser under the shop window, so a camera standing out
 * over the pavement looks down into the whole room. The other three walls
 * stand full height with their tops capped dark, the way a cut-away model
 * shows its walls are walls.
 *
 * Built in the shop's own frame, the same one highstreet.js uses: x along
 * the frontage, +z out of the wall towards the street, the origin at the
 * middle of the frontage on the face of the wall. The room is therefore all
 * at negative z, and one yaw turns the whole of it round for a shop on the
 * other side of the street.
 *
 * Draw calls are the constraint, as everywhere: everything static is merged
 * by material, and there are five — the walls, the floorboards, the pavement
 * outside, one atlas for everything painted or lettered, and the lamps'
 * bulbs, which are the only thing that glows. The shopkeeper is the one
 * thing that moves.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, labelledBox, placed } from './signs.js';
import { buildFarmer } from './farmer.js';

/* Every room's shell. The walls stand 2.7, which is a shop's ground floor
   and a unit clear of her head; the street wall is cut to 0.5, the stall
   riser under a shop window. The pavement outside is drawn 2.4 out, which
   is what the camera's lowest ray reaches over the cut wall. */
export const ROOM = {
  height: 2.7,
  cut: 0.5,
  wall: 0.12,
  apron: 2.4,
  pave: 0.075,
};

/* How far in from the walls her centre is held: her body radius and a
   whisker, so her shoulder stops at the skirting rather than in it. */
const WALK_INSET = 0.27;

const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, "DejaVu Sans", sans-serif';

const PAINT = {
  cut: '#2a211b',
  wood: '#8a5a33',
  woodDark: '#5d3b20',
  woodLight: '#b98a58',
  crate: '#a8794a',
  crateDark: '#7d5530',
  wicker: '#b8925a',
  wickerDark: '#8d6a3c',
  cream: '#f1e8cf',
  white: '#f4f1ea',
  iron: '#1d1d1f',
  brass: '#c9a227',
  brassDark: '#8f7219',
  stone: '#a59f93',
  coir: '#9b7a4c',
  sack: '#d4bd8e',
  bag: '#c9a57a',
  glass: '#d9e6e2',
  jamRed: '#a4232b',
  honey: '#d99a1e',
  pickle: '#6f8a2e',
  marmalade: '#e07b1f',
  gingham: '#c84a3f',
  apple: '#c8302b',
  appleGreen: '#8cbf3f',
  orange: '#e8892a',
  lemon: '#f0d33a',
  tomato: '#d63b2a',
  onion: '#c9975a',
  potato: '#b8935a',
  cabbage: '#7fb04d',
  lettuce: '#a8d067',
  carrot: '#e2702a',
  leaf: '#3f7a3a',
  pumpkin: '#d9771f',
  corn: '#e8c43a',
  husk: '#9fb35a',
  aubergine: '#4b2d5a',
  garlic: '#ece6d6',
  herb: '#4f8a3c',
  shade: '#3f7550',
  cord: '#26211d',
};

/* -------------------------------------------------------------------- */
/* Textures                                                              */
/* -------------------------------------------------------------------- */

const WALL_TILE = 1.2;  // world units across one repeat of the wall
const FLOOR_TILE = 1.6;
const PAVE_TILE = 1.5;

function noise(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/* The wall, top to bottom, at its real heights: painted plaster above a
   dado rail at 1.0, white tongue-and-groove boarding below it, and a
   skirting board. One repeat is WALL_TILE across and the whole ROOM.height
   tall, so the boarding comes out a tenth of a unit to the board. */
function wallCanvas(colours) {
  const W = 256;
  const H = 576;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const yOf = (h) => H - (h / ROOM.height) * H; // canvas y of a height on the wall
  ctx.fillStyle = colours.wall;
  ctx.fillRect(0, 0, W, H);
  // A little unevenness in the plaster.
  for (let k = 0; k < 140; k += 1) {
    const a = noise(k * 3.1);
    const b = noise(k * 7.7 + 1);
    ctx.fillStyle = `rgba(0,0,0,${0.025 + a * 0.03})`;
    ctx.fillRect(a * W, b * yOf(1.05), 10 + b * 18, 6 + a * 10);
  }
  // The boarding.
  const boards = 12;
  const bw = W / boards;
  ctx.fillStyle = colours.dado;
  ctx.fillRect(0, yOf(1.0), W, H - yOf(1.0));
  for (let k = 0; k < boards; k += 1) {
    const t = noise(k * 5 + 2);
    ctx.fillStyle = `rgba(0,0,0,${0.03 + t * 0.03})`;
    ctx.fillRect(k * bw + 2, yOf(1.0), bw - 4, H - yOf(1.0));
    ctx.fillStyle = 'rgba(60,50,40,0.35)';
    ctx.fillRect(k * bw, yOf(1.0), 2, H - yOf(1.0));
  }
  // The dado rail, and the skirting.
  ctx.fillStyle = colours.rail;
  ctx.fillRect(0, yOf(1.06), W, yOf(0.98) - yOf(1.06));
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, yOf(0.98), W, 3);
  ctx.fillStyle = colours.rail;
  ctx.fillRect(0, yOf(0.14), W, H - yOf(0.14));
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, yOf(0.14), W, 3);
  return c;
}

/* Floorboards running back from the street, a little under a sixth of a
   unit wide, their ends staggered and each a shade of its own. */
function floorCanvas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a3c22';
  ctx.fillRect(0, 0, 256, 256);
  const boards = 10;
  const bw = 256 / boards;
  for (let k = 0; k < boards; k += 1) {
    const off = noise(k * 9 + 4) * 256;
    for (let seg = -1; seg < 2; seg += 1) {
      const t = noise(k * 13 + seg * 7 + 3);
      const r = 138 + Math.round(t * 28);
      ctx.fillStyle = `rgb(${r},${Math.round(r * 0.68)},${Math.round(r * 0.42)})`;
      ctx.fillRect(k * bw + 1, off + seg * 200 + 1, bw - 2, 198);
      // The grain.
      ctx.fillStyle = 'rgba(70,40,20,0.18)';
      for (let g = 0; g < 4; g += 1) ctx.fillRect(k * bw + 4 + g * 6, off + seg * 200 + 10, 1, 180);
    }
  }
  return c;
}

function paveCanvas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8f8b83';
  ctx.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 4; r += 1) {
    const off = r % 2 ? 48 : 0;
    for (let k = -1; k < 3; k += 1) {
      const t = noise(r * 5 + k);
      const v = 176 + Math.round(t * 20);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
      ctx.fillRect(k * 96 + off + 2, r * 64 + 2, 92, 60);
    }
  }
  return c;
}

function tiled(canvas, anisotropy, repeatT = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = repeatT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/* -------------------------------------------------------------------- */
/* The atlas: everything lettered or painted, and the swatches           */
/* -------------------------------------------------------------------- */

function fit(ctx, text, start, room, family, weight = 'bold') {
  let size = start;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > 8 && ctx.measureText(text).width > room) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

/* A gold coin, drawn rather than typed: the game's coin is an emoji, and a
   headless browser's canvas has no emoji font to draw it with. */
function coin(ctx, x, y, r) {
  ctx.fillStyle = '#e8b923';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a77d10';
  ctx.lineWidth = Math.max(1, r * 0.25);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
}

const DRAW = {
  /* The price board over the counter, in chalk. Its prices are the farm's
     own: what the market pays for each crop, which is what a shop selling
     this farm's produce would have to beat. */
  chalk(ctx, c, spec) {
    ctx.fillStyle = '#2b2f2c';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let k = 0; k < 30; k += 1) ctx.fillRect(c.x + noise(k) * c.w, c.y + noise(k + 50) * c.h, 40, 8);
    ctx.strokeStyle = '#7a5530';
    ctx.lineWidth = 14;
    ctx.strokeRect(c.x + 7, c.y + 7, c.w - 14, c.h - 14);
    ctx.fillStyle = '#f4f1e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, spec.chalkTitle, 46, c.w - 60, SERIF, 'italic bold');
    ctx.fillText(spec.chalkTitle, c.x + c.w / 2, c.y + 48);
    ctx.fillRect(c.x + c.w * 0.2, c.y + 76, c.w * 0.6, 3);
    const rows = spec.prices;
    const top = c.y + 108;
    const step = (c.h - 130) / Math.max(rows.length, 1);
    rows.forEach(([name, price], i) => {
      const y = top + i * step + step / 2 - 6;
      ctx.textAlign = 'left';
      ctx.font = `bold 30px ${SANS}`;
      ctx.fillStyle = '#f4f1e6';
      ctx.fillText(name, c.x + 40, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f3e07a';
      ctx.fillText(String(price), c.x + c.w - 74, y);
      coin(ctx, c.x + c.w - 52, y, 11);
    });
  },
  /* On the side wall over the produce stand. */
  poster(ctx, c, spec) {
    ctx.fillStyle = '#f1e8cf';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = spec.colours.paint;
    ctx.fillRect(c.x, c.y, c.w, 54);
    ctx.fillRect(c.x, c.y + c.h - 20, c.w, 20);
    ctx.fillStyle = '#f1e8cf';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, spec.posterTitle, 34, c.w - 24, SERIF);
    ctx.fillText(spec.posterTitle, c.x + c.w / 2, c.y + 28);
    ctx.fillStyle = '#3a2c1c';
    const lines = spec.posterLines;
    lines.forEach((line, i) => {
      fit(ctx, line, 24, c.w - 24, SANS);
      ctx.fillText(line, c.x + c.w / 2, c.y + 84 + i * 32);
    });
    // A sheaf and a carrot, the town's and the shop's.
    ctx.fillStyle = '#e2702a';
    ctx.beginPath();
    ctx.moveTo(c.x + c.w * 0.38, c.y + c.h - 70);
    ctx.lineTo(c.x + c.w * 0.62, c.y + c.h - 78);
    ctx.lineTo(c.x + c.w * 0.4, c.y + c.h - 50);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3f7a3a';
    ctx.fillRect(c.x + c.w * 0.6, c.y + c.h - 90, 8, 18);
    ctx.fillRect(c.x + c.w * 0.63, c.y + c.h - 86, 8, 16);
  },
  mat(ctx, c) {
    ctx.fillStyle = '#9b7a4c';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < c.h; k += 4) ctx.fillRect(c.x, c.y + k, c.w, 1);
    ctx.strokeStyle = '#5d4426';
    ctx.lineWidth = 8;
    ctx.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12);
    ctx.fillStyle = '#4b3520';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'WELCOME', 40, c.w - 40, SERIF);
    ctx.fillText('WELCOME', c.x + c.w / 2, c.y + c.h / 2);
  },
  sack(ctx, c) {
    ctx.fillStyle = '#d4bd8e';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = 'rgba(90,70,40,0.15)';
    for (let k = 0; k < c.w; k += 5) ctx.fillRect(c.x + k, c.y, 1, c.h);
    ctx.fillStyle = '#6b4a2b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'POTATOES', 30, c.w - 16, SANS);
    ctx.fillText('POTATOES', c.x + c.w / 2, c.y + c.h * 0.45);
    ctx.font = `bold 18px ${SANS}`;
    ctx.fillText('FARM CITY', c.x + c.w / 2, c.y + c.h * 0.72);
  },
  scale(ctx, c) {
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#f6f1e2';
    ctx.beginPath();
    ctx.arc(c.x + c.w / 2, c.y + c.h / 2, c.w * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c.x + c.w / 2 + Math.sin(a) * c.w * 0.34, c.y + c.h / 2 - Math.cos(a) * c.w * 0.34);
      ctx.lineTo(c.x + c.w / 2 + Math.sin(a) * c.w * 0.4, c.y + c.h / 2 - Math.cos(a) * c.w * 0.4);
      ctx.stroke();
    }
    ctx.strokeStyle = '#b22';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x + c.w / 2, c.y + c.h / 2);
    ctx.lineTo(c.x + c.w * 0.72, c.y + c.h * 0.3);
    ctx.stroke();
  },
  till(ctx, c) {
    ctx.fillStyle = '#2b2b2e';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#9fd18b';
    ctx.fillRect(c.x + 10, c.y + 8, c.w - 20, 20);
    for (let r = 0; r < 3; r += 1) {
      for (let k = 0; k < 4; k += 1) {
        ctx.fillStyle = k === 3 ? '#c84a3f' : '#e9e4d8';
        ctx.fillRect(c.x + 12 + k * ((c.w - 24) / 4), c.y + 38 + r * 22, (c.w - 24) / 4 - 6, 16);
      }
    }
  },
  /* The shop's name on its paper bags, the same green as its fascia. */
  bag(ctx, c, spec) {
    ctx.fillStyle = '#c9a57a';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = spec.colours.paint;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, spec.name.toUpperCase(), 22, c.w - 10, SERIF);
    ctx.fillText(spec.name.toUpperCase(), c.x + c.w / 2, c.y + c.h * 0.55);
  },
};

function makeAtlas(spec) {
  const cells = [
    { kind: 'chalk', w: 512, h: 320 },
    { kind: 'poster', w: 256, h: 320 },
    { kind: 'mat', w: 256, h: 160 },
    { kind: 'sack', w: 192, h: 160 },
    { kind: 'scale', w: 96, h: 96 },
    { kind: 'till', w: 128, h: 112 },
    { kind: 'bag', w: 128, h: 96 },
    ...Object.entries({ ...PAINT, paint: spec.colours.paint, trim: spec.colours.trim })
      .map(([key, colour]) => ({ kind: 'swatch', key, colour, w: 16, h: 16 })),
  ];
  const WIDTH = 1024;
  const PAD = 4;
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of cells) {
    if (x + c.w + PAD > WIDTH) { x = 0; y += rowH + PAD; rowH = 0; }
    c.x = x; c.y = y;
    x += c.w + PAD;
    rowH = Math.max(rowH, c.h);
  }
  const HEIGHT = 2 ** Math.ceil(Math.log2(y + rowH));
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAINT.cream;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const c of cells) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    if (c.kind === 'swatch') { ctx.fillStyle = c.colour; ctx.fillRect(c.x, c.y, c.w, c.h); }
    else DRAW[c.kind](ctx, c, spec);
    ctx.restore();
  }
  const uvOf = (c) => ({
    u0: (c.x + 0.5) / WIDTH,
    u1: (c.x + c.w - 0.5) / WIDTH,
    v0: 1 - (c.y + c.h - 0.5) / HEIGHT,
    v1: 1 - (c.y + 0.5) / HEIGHT,
  });
  const uv = Object.fromEntries(cells.filter((c) => c.kind !== 'swatch').map((c) => [c.kind, uvOf(c)]));
  const swatch = Object.fromEntries(cells.filter((c) => c.kind === 'swatch').map((c) => [c.key, uvOf(c)]));
  return { canvas, uv, swatch, width: WIDTH, height: HEIGHT };
}

/* -------------------------------------------------------------------- */
/* Pieces                                                                */
/* -------------------------------------------------------------------- */

/* A vertical quad from (x0, z0) to (x1, z1) along the floor, y0 to y1 up,
   facing whichever side the corners wind towards — passed in that order
   it faces the viewer standing on the left of the line looking along it.
   UVs in world units along the wall over WALL_TILE, and up the wall over
   the room's whole height, so every wall's dado rail is at the same 1.0. */
function wallQuad(x0, z0, x1, z1, y0, y1, along0 = 0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.BufferGeometry();
  const p = [
    x0, y0, z0, x1, y0, z1, x1, y1, z1,
    x0, y0, z0, x1, y1, z1, x0, y1, z0,
  ];
  const u0 = along0 / WALL_TILE;
  const u1 = (along0 + len) / WALL_TILE;
  const v0 = y0 / ROOM.height;
  const v1 = y1 / ROOM.height;
  const uv = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/* A horizontal quad at height y, its UVs in world units over `tile`. */
function floorQuad(x0, x1, z0, z1, y, tile) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
  return g;
}

/* A box with a picture on its top face — a doormat, a label lying flat.
   BoxGeometry's +y face is the third of its six. */
function topLabelled(w, h, d, faceUV, edgeUV) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const attr = g.getAttribute('uv');
  for (let face = 0; face < 6; face += 1) {
    const uv = face === 2 ? faceUV : edgeUV;
    for (let k = 0; k < 6; k += 1) {
      const i = face * 6 + k;
      attr.setXY(i, uv.u0 + attr.getX(i) * (uv.u1 - uv.u0), uv.v0 + attr.getY(i) * (uv.v1 - uv.v0));
    }
  }
  return g;
}

/* The shapes of the produce, each a low-poly solid a few centimetres
   across. Round fruit is an icosahedron, squashed or stretched to its kind;
   twenty triangles is round enough at the distance the camera sits. */
const PRODUCE = {
  apple: { colour: 'apple', r: 0.045 },
  appleGreen: { colour: 'appleGreen', r: 0.045 },
  orange: { colour: 'orange', r: 0.05 },
  lemon: { colour: 'lemon', r: 0.038, stretch: [1.3, 1, 1] },
  tomato: { colour: 'tomato', r: 0.04, stretch: [1, 0.8, 1] },
  onion: { colour: 'onion', r: 0.042 },
  potato: { colour: 'potato', r: 0.045, stretch: [1.3, 0.75, 1] },
  cabbage: { colour: 'cabbage', r: 0.085 },
  lettuce: { colour: 'lettuce', r: 0.08, stretch: [1, 0.7, 1] },
  pumpkin: { colour: 'pumpkin', r: 0.11, stretch: [1, 0.72, 1], stem: true },
  aubergine: { colour: 'aubergine', r: 0.04, stretch: [2.0, 0.9, 0.9] },
  garlic: { colour: 'garlic', r: 0.035 },
};

/* -------------------------------------------------------------------- */
/* The kit a room is built with                                          */
/* -------------------------------------------------------------------- */

function makeKit(A) {
  const parts = { atlas: [], wall: [], floor: [], pave: [], glow: [] };
  const solids = [];
  const furniture = [];
  const sw = (k) => A.swatch[k];

  /* A box given by its extents rather than its centre and size: the room
     is laid out in edges — this counter runs from here to the wall — and
     stating it that way is what keeps the aisles the widths written down. */
  const block = (colour, [x0, x1], [y0, y1], [z0, z1], yaw = 0) => {
    const g = paint(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), sw(colour));
    parts.atlas.push(placed(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, yaw));
  };
  const cylinder = (colour, rTop, rBot, h, x, y, z, seg = 10, open = false) => {
    parts.atlas.push(paint(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), sw(colour)).translate(x, y + h / 2, z));
  };
  /* Somewhere she cannot walk, in the room's own frame. `id` names the
     piece of furniture for the report and the tests. */
  const solid = (id, [x0, x1], [z0, z1], h) => {
    solids.push({ id, x0, x1, z0, z1, h });
    furniture.push(id);
  };

  const fruitAt = (kind, x, y, z, seed = 0) => {
    const p = PRODUCE[kind];
    const g = paint(new THREE.IcosahedronGeometry(p.r, 0), sw(p.colour));
    const [sx, sy, sz] = p.stretch ?? [1, 1, 1];
    g.scale(sx, sy, sz);
    g.rotateY(noise(seed) * Math.PI * 2);
    parts.atlas.push(g.translate(x, y + p.r * sy * 0.8, z));
    if (p.stem) cylinder('leaf', 0.012, 0.016, 0.05, x, y + p.r * sy * 1.5, z, 5);
  };

  /* A crate of something: slatted wooden sides to `h`, and the produce
     heaped in it — a grid at the fruit's own spacing, each one nudged a
     little and the middle of the heap a little higher than its edges. */
  const crate = ([x0, x1], y, [z0, z1], kind, h = 0.16) => {
    block('crate', [x0, x1], [y, y + h], [z0, z1]);
    block('crateDark', [x0 - 0.005, x1 + 0.005], [y + h * 0.45, y + h * 0.55], [z0 - 0.005, z1 + 0.005]);
    if (kind === 'carrot') {
      for (let z = z0 + 0.04; z < z1 - 0.02; z += 0.045) {
        const g = paint(new THREE.ConeGeometry(0.022, x1 - x0 - 0.08, 5), sw('carrot'));
        g.rotateZ(Math.PI / 2 + (noise(z * 31) - 0.5) * 0.2);
        parts.atlas.push(g.translate((x0 + x1) / 2, y + h + 0.02, z));
        block('leaf', [x1 - 0.06, x1 - 0.01], [y + h + 0.01, y + h + 0.04], [z - 0.012, z + 0.012]);
      }
      return;
    }
    const p = PRODUCE[kind];
    const step = p.r * 2.1;
    let seed = x0 * 13 + z0 * 7;
    for (let x = x0 + p.r + 0.02; x <= x1 - p.r - 0.01; x += step) {
      for (let z = z0 + p.r + 0.02; z <= z1 - p.r - 0.01; z += step) {
        seed += 1;
        const mid = 1 - Math.hypot((x - (x0 + x1) / 2) / (x1 - x0), (z - (z0 + z1) / 2) / (z1 - z0));
        fruitAt(kind,
          x + (noise(seed) - 0.5) * p.r * 0.4,
          y + h - p.r * 0.6 + mid * p.r * 0.7,
          z + (noise(seed + 9) - 0.5) * p.r * 0.4, seed);
      }
    }
  };

  /* A wicker basket on a table: an open drum, a darker rim, and fruit. */
  const basket = (x, y, z, r, kind) => {
    cylinder('wicker', r, r * 0.82, r * 0.7, x, y, z, 10, true);
    cylinder('wickerDark', r * 0.86, r * 0.86, 0.02, x, y, z, 10);
    const g = paint(new THREE.TorusGeometry(r, 0.018, 4, 12), sw('wickerDark'));
    parts.atlas.push(g.rotateX(Math.PI / 2).translate(x, y + r * 0.7, z));
    const p = PRODUCE[kind];
    let seed = x * 17 + z * 5;
    for (let a = 0; a < 7; a += 1) {
      seed += 1;
      const th = (a / 7) * Math.PI * 2;
      const rr = a === 0 ? 0 : r * 0.5;
      fruitAt(kind, x + Math.cos(th) * rr, y + r * 0.45 + (a === 0 ? p.r * 0.6 : 0), z + Math.sin(th) * rr, seed);
    }
  };

  /* A jar on a shelf: glass, its contents showing through, and a lid. */
  const jar = (x, y, z, contents, lid = 'gingham') => {
    cylinder(contents, 0.04, 0.04, 0.1, x, y, z, 8);
    cylinder(lid, 0.043, 0.043, 0.025, x, y + 0.1, z, 8);
  };

  /* The bulb of a lamp: on its own material, which is the one that glows. */
  const bulb = (x, y, z, r = 0.05) => {
    parts.glow.push(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
  };

  return { A, parts, solids, furniture, sw, block, cylinder, solid, fruitAt, crate, basket, jar, bulb };
}

/* -------------------------------------------------------------------- */
/* The shell every room has                                              */
/* -------------------------------------------------------------------- */

function buildShell(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const { wall, height, cut } = ROOM;
  const front = -wall; // the street wall's inner face
  const W = kit.parts.wall;
  // Three full-height walls, inner faces only: from the camera's side of
  // the room nothing else of them can be seen. Each wound to face inwards.
  W.push(wallQuad(minX, back, maxX, back, 0, height));             // back, facing +z
  W.push(wallQuad(minX, front, minX, back, 0, height, 0));          // left, facing +x
  W.push(wallQuad(maxX, back, maxX, front, 0, height, 0));          // right, facing -x
  // Their tops, cut and capped dark, and the side walls' front ends above
  // the street wall, where the cut runs down them.
  kit.block('cut', [minX - wall, maxX + wall], [height, height + 0.03], [back - wall, back]);
  kit.block('cut', [minX - wall, minX], [height, height + 0.03], [back - wall, 0]);
  kit.block('cut', [maxX, maxX + wall], [height, height + 0.03], [back - wall, 0]);
  kit.block('cut', [minX - wall, minX], [cut, height], [front, 0]);
  kit.block('cut', [maxX, maxX + wall], [cut, height], [front, 0]);

  // The street wall, cut down to the riser, with the doorway through it.
  const d0 = spec.door.x - spec.door.w / 2;
  const d1 = spec.door.x + spec.door.w / 2;
  for (const [a, b] of [[minX - wall, d0], [d1, maxX + wall]]) {
    if (b - a < 0.01) continue;
    kit.block('paint', [a, b], [0, cut], [front, 0]);
    kit.block('woodLight', [a - 0.01, b + 0.01], [cut, cut + 0.04], [front - 0.03, 0.03]);
  }
  // The door's frame, cut at the same height, and a stone threshold.
  for (const x of [d0, d1]) kit.block('trim', [x - 0.05, x + 0.05], [0, cut + 0.12], [front - 0.02, 0.02]);
  kit.block('stone', [d0, d1], [0, 0.02], [front, 0.04]);
  // A welcome mat inside it.
  kit.parts.atlas.push(placed(
    topLabelled(spec.door.w - 0.1, 0.012, 0.55, kit.A.uv.mat, kit.sw('coir')),
    spec.door.x, 0.006, front - 0.33,
  ));

  kit.parts.floor.push(floorQuad(minX, maxX, back, front, 0, FLOOR_TILE));
  // The pavement outside, at the street's own height.
  kit.parts.pave.push(floorQuad(minX - 0.8, maxX + 0.8, 0, ROOM.apron, ROOM.pave, PAVE_TILE));
  kit.block('stone', [minX - 0.8, maxX + 0.8], [0, ROOM.pave], [0, ROOM.apron]);
}

/* -------------------------------------------------------------------- */
/* The Greengrocer                                                       */
/* -------------------------------------------------------------------- */

/* A greengrocer as a market town has one: produce heaped in crates behind
   the window, more down the side wall, baskets on a table in the middle,
   and a counter at the back with the scale and the till. Green paint above
   white boarding, worn floorboards, strings of garlic from a rail, one
   lamp. The room is 5.0 by 5.3; the door is at the right of the frontage,
   so the way in runs down the right-hand side and the counter faces it.

   Every aisle was laid out at a width first and the furniture placed to
   keep it: the door to the counter is 1.2 clear, the crossing between the
   window display and the table 1.1, the front of the counter 0.9. */
function grocer(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const front = -ROOM.wall;

  // The window display: three stepped tiers across the window, the lowest
  // nearest the glass, crates on every step.
  const dx0 = minX;
  const dx1 = 0.88;
  const tiers = [
    { z: [front - 0.36, front], top: 0.42 },
    { z: [front - 0.7, front - 0.36], top: 0.62 },
    { z: [front - 1.03, front - 0.7], top: 0.82 },
  ];
  const rows = [
    ['apple', 'orange', 'lemon', 'appleGreen', 'tomato', 'apple'],
    ['cabbage', 'carrot', 'lettuce', 'aubergine', 'onion', 'cabbage'],
    ['pumpkin', 'pumpkin', 'potato', 'pumpkin', 'pumpkin', 'potato'],
  ];
  tiers.forEach((t, i) => {
    kit.block('woodDark', [dx0, dx1], [0, t.top], t.z);
    const n = 6;
    const w = (dx1 - dx0 - 0.04) / n;
    for (let k = 0; k < n; k += 1) {
      const x0 = dx0 + 0.02 + k * w;
      kit.crate([x0 + 0.015, x0 + w - 0.015], t.top, [t.z[0] + 0.03, t.z[1] - 0.03], rows[i][k]);
    }
  });
  kit.solid('window-display', [minX, dx1], [front - 1.05, front], 1.0);

  // Down the left wall: a two-step stand of the farm's own crops.
  const sz0 = -4.05;
  const sz1 = -1.45;
  kit.block('woodDark', [minX + 0.34, minX + 0.67], [0, 0.5], [sz0, sz1]);
  kit.block('woodDark', [minX, minX + 0.34], [0, 0.8], [sz0, sz1]);
  const standKinds = [['carrot', 'potato', 'onion', 'carrot', 'potato'], ['cabbage', 'pumpkin', 'cabbage', 'lettuce', 'pumpkin']];
  for (let k = 0; k < 5; k += 1) {
    const z0 = sz0 + 0.03 + k * ((sz1 - sz0 - 0.06) / 5);
    const z1 = z0 + (sz1 - sz0 - 0.06) / 5 - 0.03;
    kit.crate([minX + 0.37, minX + 0.64], 0.5, [z0, z1], standKinds[0][k]);
    kit.crate([minX + 0.03, minX + 0.31], 0.8, [z0, z1], standKinds[1][k]);
  }
  kit.solid('side-stand', [minX, minX + 0.67], [sz0, sz1], 1.0);
  // The poster over it.
  kit.parts.atlas.push(placed(
    labelledBox(0.72, 0.9, 0.02, { front: kit.A.uv.poster, back: kit.sw('cream') }, kit.sw('cream')),
    minX + 0.012, 1.85, (sz0 + sz1) / 2, Math.PI / 2,
  ));

  // The table in the middle, with three baskets.
  const tx = [-1.0, 0.3];
  const tz = [-3.2, -2.3];
  kit.block('woodLight', tx, [0.72, 0.77], tz);
  for (const x of [tx[0] + 0.06, tx[1] - 0.06]) {
    for (const z of [tz[0] + 0.06, tz[1] - 0.06]) kit.block('wood', [x - 0.04, x + 0.04], [0, 0.72], [z - 0.04, z + 0.04]);
  }
  kit.basket(-0.72, 0.77, -2.75, 0.2, 'lemon');
  kit.basket(-0.32, 0.77, -2.6, 0.17, 'tomato');
  kit.basket(0.04, 0.77, -2.85, 0.19, 'appleGreen');
  kit.solid('table', tx, tz, 0.8);

  // The counter across the back, from the gate to the right-hand wall.
  const cx = [-0.2, maxX];
  const cz = [-4.7, -4.1];
  kit.block('paint', cx, [0, 0.9], cz);
  for (let x = cx[0] + 0.1; x < cx[1] - 0.45; x += 0.62) {
    kit.block('cream', [x, x + 0.5], [0.14, 0.76], [cz[1], cz[1] + 0.012]);
  }
  kit.block('wood', [cx[0] - 0.04, cx[1]], [0.9, 0.95], [cz[0] - 0.02, cz[1] + 0.05]);
  // The brass scale, facing the customer.
  kit.block('brassDark', [0.25, 0.55], [0.95, 0.99], [-4.55, -4.3]);
  kit.cylinder('brass', 0.025, 0.025, 0.2, 0.4, 0.99, -4.45, 6);
  kit.cylinder('brass', 0.16, 0.12, 0.03, 0.4, 1.19, -4.45, 12);
  kit.parts.atlas.push(placed(
    labelledBox(0.2, 0.2, 0.025, { front: kit.A.uv.scale, back: kit.sw('brass') }, kit.sw('brass')),
    0.4, 1.1, -4.3,
  ));
  // The till.
  kit.parts.atlas.push(placed(
    labelledBox(0.36, 0.2, 0.3, { front: kit.A.uv.till, back: kit.sw('iron') }, kit.sw('iron')),
    1.85, 1.05, -4.42,
  ));
  kit.block('white', [1.78, 1.92], [1.15, 1.2], [-4.55, -4.45]);
  // Paper bags with the shop's name on them, stacked and standing.
  for (let k = 0; k < 4; k += 1) kit.block('bag', [0.95 + k * 0.01, 1.3 + k * 0.01], [0.95 + k * 0.012, 0.962 + k * 0.012], [-4.55, -4.32]);
  for (const x of [1.42, 1.56]) {
    kit.parts.atlas.push(placed(
      labelledBox(0.12, 0.18, 0.08, { front: kit.A.uv.bag, back: kit.sw('bag') }, kit.sw('bag')),
      x, 1.04, -4.3,
    ));
  }
  // The counter flap at its left end, shut, so the room behind it is the
  // shopkeeper's.
  kit.block('wood', [-0.6, -0.2], [0.88, 0.93], [-4.7, -4.45]);
  kit.block('paint', [-0.58, -0.22], [0.1, 0.88], [-4.62, -4.55]);
  kit.solid('counter', cx, cz, 0.95);
  kit.solid('counter-flap', [-0.6, -0.2], [-4.7, -4.45], 0.95);
  /* And the floor behind it, which is the shopkeeper's: shut off by the
     counter and its flap anyway, and said so here, so that no part of the
     room is floor she could stand on but never get to. */
  kit.solid('behind-counter', [-0.6, maxX], [back, cz[0]], 0.95);

  // Sacks of potatoes in the back-left corner, open at the top: a soft
  // eight-sided body narrowing a little to a rolled-down rim, the shop's
  // label on the front, and potatoes showing in the mouth.
  for (const [x, z, s] of [[-2.2, -5.05, 1], [-1.7, -5.08, 0.92], [-1.0, -5.06, 0.96], [-1.95, -4.75, 0.85]]) {
    const h = 0.58 * s;
    const body = paint(new THREE.CylinderGeometry(0.17 * s, 0.21 * s, h, 8), kit.sw('sack'));
    body.scale(1, 1, 0.78);
    kit.parts.atlas.push(body.translate(x, h / 2, z));
    const rim = paint(new THREE.TorusGeometry(0.165 * s, 0.03 * s, 4, 8), kit.sw('bag'));
    kit.parts.atlas.push(rim.rotateX(Math.PI / 2).scale(1, 1, 0.78).translate(x, h, z));
    kit.parts.atlas.push(placed(
      labelledBox(0.26 * s, 0.2 * s, 0.01, { front: kit.A.uv.sack, back: kit.sw('sack') }, kit.sw('sack')),
      x, h * 0.48, z + 0.19 * s * 0.78 + 0.004,
    ));
    for (let k = 0; k < 4; k += 1) kit.fruitAt('potato', x - 0.09 + k * 0.06, h - 0.05, z + (k % 2) * 0.05 - 0.025, x * 9 + k);
  }
  kit.solid('sacks', [minX, -0.6], [back, -4.55], 0.7);

  // Shelves of preserves on the back wall over the sacks.
  for (const y of [1.25, 1.7]) {
    kit.block('wood', [minX + 0.05, -0.35], [y - 0.03, y], [back, back + 0.26]);
    let k = 0;
    for (let x = minX + 0.15; x < -0.45; x += 0.13) {
      kit.jar(x, y, back + 0.13, ['jamRed', 'honey', 'pickle', 'marmalade'][k % 4], k % 3 ? 'gingham' : 'brass');
      k += 1;
    }
  }
  // The chalkboard over the counter.
  kit.parts.atlas.push(placed(
    labelledBox(2.0, 1.25, 0.04, { front: kit.A.uv.chalk, back: kit.sw('woodDark') }, kit.sw('woodDark')),
    1.28, 1.95, back + 0.025,
  ));

  // A rack of jars and bottles on the right-hand wall, between the door
  // and the counter.
  const rz = [-3.65, -1.25];
  kit.block('woodDark', [maxX - 0.42, maxX - 0.39], [0, 1.8], [rz[0], rz[0] + 0.04]);
  kit.block('woodDark', [maxX - 0.42, maxX - 0.39], [0, 1.8], [rz[1] - 0.04, rz[1]]);
  for (const y of [0.35, 0.85, 1.35]) {
    kit.block('wood', [maxX - 0.42, maxX], [y - 0.03, y], rz);
    let k = 0;
    for (let z = rz[0] + 0.12; z < rz[1] - 0.08; z += 0.14) {
      kit.jar(maxX - 0.2, y, z, ['marmalade', 'pickle', 'jamRed', 'honey', 'lemon'][(k + Math.round(y * 3)) % 5]);
      k += 1;
    }
  }
  kit.solid('preserves', [maxX - 0.44, maxX], rz, 1.8);

  // A rail across the room above the table, hung with garlic and herbs.
  const railY = 2.38;
  kit.block('wood', [-1.6, 0.9], [railY - 0.025, railY + 0.025], [-2.78, -2.72]);
  for (const x of [-1.5, 0.8]) kit.block('cord', [x - 0.01, x + 0.01], [railY, ROOM.height], [-2.76, -2.74]);
  let s = 0;
  for (let x = -1.42; x < 0.85; x += 0.27) {
    s += 1;
    const drop = 0.32 + noise(s) * 0.12;
    kit.block('cord', [x - 0.006, x + 0.006], [railY - drop, railY], [-2.756, -2.744]);
    if (s % 2) {
      for (let k = 0; k < 5; k += 1) kit.fruitAt('garlic', x + (k % 2 ? 0.025 : -0.025), railY - drop + k * 0.06 - 0.02, -2.75, s * 10 + k);
    } else {
      const g = paint(new THREE.ConeGeometry(0.06, 0.2, 6), kit.sw('herb'));
      kit.parts.atlas.push(g.rotateX(Math.PI).translate(x, railY - drop + 0.02, -2.75));
    }
  }

  // Two pendant lamps: one over the table, one over the counter's front.
  for (const [x, z] of [[-0.35, -2.25], [1.1, -3.7]]) {
    kit.block('cord', [x - 0.008, x + 0.008], [2.32, ROOM.height], [z - 0.008, z + 0.008]);
    kit.cylinder('shade', 0.05, 0.18, 0.15, x, 2.17, z, 12, true);
    kit.cylinder('shade', 0.05, 0.06, 0.02, x, 2.32, z, 8);
    kit.bulb(x, 2.16, z);
  }

  return {
    keeper: { x: 1.1, z: -5.0, look: { shirt: 0xe9e1cf, apron: 0x2f5d3a, trousers: 0x3a3a3e, hair: 0x8f8b84, beard: false } },
    lamps: [[-0.35, 2.12, -2.25], [1.1, 2.12, -3.7]],
    counter: { x: 1.1, z: -3.75 },
    greeting: (hour) => `🥕 “${hello(hour)}! All grown round Farm City — some of it on yours.”`,
  };
}

const DESIGNS = { grocer };

/* Good morning, by the farm's own clock: the day is ninety seconds long,
   and a shopkeeper who says morning at midnight has not been looking out
   of the window. */
function hello(hour) {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 18) return 'Afternoon';
  return 'Evening';
}

/* -------------------------------------------------------------------- */
/* Building one                                                          */
/* -------------------------------------------------------------------- */

/**
 * spec: { id, kind, name, x, z, yaw, room: { minX, maxX, back },
 *         door: { x, w }, colours: { paint, trim, wall, dado, rail },
 *         chalkTitle, prices: [[name, price]], posterTitle, posterLines }
 * — (x, z, yaw) the shop's frontage, as highstreet.js has it; room and door
 * in the shop's own frame.
 *
 * Returns { scene, solids, walk, door, view, update, report, greeting,
 *           toLocal }, everything that leaves here in world coordinates.
 */
export function buildInterior(spec, { anisotropy = 1, shadows = false } = {}) {
  const A = makeAtlas(spec);
  const kit = makeKit(A);
  buildShell(kit, spec);
  const design = DESIGNS[spec.kind](kit, spec);

  const group = new THREE.Group();
  group.name = `interior:${spec.id}`;
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.yaw;

  const material = (name, opts) => {
    const m = new THREE.MeshStandardMaterial({ name: `interior-${name}`, roughness: 0.82, metalness: 0, ...opts });
    m.toneMapped = false;
    return m;
  };
  const atlasTex = new THREE.CanvasTexture(A.canvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = anisotropy;
  const mats = {
    wall: material('wall', { map: tiled(wallCanvas(spec.colours), anisotropy, false), roughness: 0.92 }),
    floor: material('floor', { map: tiled(floorCanvas(), anisotropy), roughness: 0.78 }),
    pave: material('pave', { map: tiled(paveCanvas(), anisotropy), roughness: 0.95 }),
    atlas: material('atlas', { map: atlasTex, roughness: 0.74, side: THREE.DoubleSide }),
    glow: material('glow', { color: 0xfff1d6, emissive: 0xffc77a, emissiveIntensity: 1 }),
  };
  let triangles = 0;
  for (const [key, list] of Object.entries(kit.parts)) {
    if (!list.length) continue;
    const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(geos, false);
    for (const g of list) g.dispose();
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.name = `interior-${spec.id}-${key}`;
    mesh.receiveShadow = true;
    mesh.castShadow = key === 'atlas';
    group.add(mesh);
    triangles += merged.getAttribute('position').count / 3;
  }

  /* The shopkeeper, behind the counter, idling. The same figure as the
     farmer in the shop's colours, so the town's people are the farm's. */
  const keeper = buildFarmer('male', design.keeper.look);
  keeper.object.traverse((o) => {
    for (const m of [o.material ?? []].flat()) m.toneMapped = false;
  });
  keeper.object.position.set(design.keeper.x, 0, design.keeper.z);
  keeper.object.name = `shopkeeper:${spec.id}`;
  group.add(keeper.object);
  keeper.actions.idle?.play();

  /* The light. A sky-and-floor fill for the whole room; daylight through
     the shop window, which is the street side and the side the camera
     looks from; and a warm point at each lamp, which is what the room is
     lit by after dark. */
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0x5a4330, 1.0);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3df, 1.4);
  sun.position.set(1.2, 5.5, 4.5);
  sun.target.position.set(0, 0, (spec.room.back) / 2);
  group.add(sun, sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cam = sun.shadow.camera;
    cam.left = -4; cam.right = 4; cam.top = 4; cam.bottom = -4; cam.near = 0.5; cam.far = 14;
    sun.shadow.bias = -0.0008;
  }
  const lamps = design.lamps.map(([x, y, z]) => {
    const l = new THREE.PointLight(0xffcf8a, 3, 8, 2);
    l.position.set(x, y - 0.05, z);
    group.add(l);
    return l;
  });

  const scene = new THREE.Scene();
  scene.name = `interior-scene:${spec.id}`;
  scene.background = new THREE.Color(0x15110e);
  scene.add(group);
  group.updateMatrixWorld(true);

  // Room to world, and back.
  const c = Math.cos(spec.yaw);
  const s = Math.sin(spec.yaw);
  const toWorld = (lx, lz) => ({ x: spec.x + lx * c + lz * s, z: spec.z - lx * s + lz * c });
  const toLocal = (x, z) => {
    const dx = x - spec.x;
    const dz = z - spec.z;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  };
  const worldRect = ([x0, x1], [z0, z1]) => {
    const pts = [toWorld(x0, z0), toWorld(x1, z0), toWorld(x0, z1), toWorld(x1, z1)];
    return {
      minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
      minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)),
    };
  };
  const { minX, maxX, back } = spec.room;
  const front = -ROOM.wall;
  const solids = {
    boxes: kit.solids.map((b) => ({ id: b.id, ...worldRect([b.x0, b.x1], [b.z0, b.z1]), minY: 0, maxY: b.h })),
    posts: [{ id: 'shopkeeper', ...toWorld(design.keeper.x, design.keeper.z), r: 0.3 }],
  };
  const walk = worldRect([minX + WALK_INSET, maxX - WALK_INSET], [back + WALK_INSET, front - WALK_INSET]);
  const door = {
    inside: toWorld(spec.door.x, front - 0.45),
    outside: toWorld(spec.door.x, 0.7),
    // Where the doorway is, across the frontage, in the room's frame.
    x0: spec.door.x - spec.door.w / 2 + 0.1,
    x1: spec.door.x + spec.door.w / 2 - 0.1,
    // The front edge of where she can walk, in the room's frame.
    frontZ: front - WALK_INSET,
    out: { x: s, z: c },
  };
  const box = new THREE.Box3();
  for (const [lx, lz] of [[minX, back], [maxX, back], [minX, 0], [maxX, 0]]) {
    const p = toWorld(lx, lz);
    box.expandByPoint(new THREE.Vector3(p.x, 0, p.z));
    box.expandByPoint(new THREE.Vector3(p.x, ROOM.height, p.z));
  }
  const centre = toWorld((minX + maxX) / 2, back / 2);

  let lit = 0;
  /* night: 0 by day, 1 at midnight, the scene's skyNight. dt: seconds. */
  function update(night, dt) {
    lit = THREE.MathUtils.smoothstep(night, 0.25, 0.65);
    sun.intensity = 0.25 + 1.45 * (1 - lit);
    hemi.intensity = 0.55 + 0.5 * (1 - lit);
    for (const l of lamps) l.intensity = 2.5 + 7 * lit;
    mats.glow.emissiveIntensity = 0.8 + 2.2 * lit;
    keeper.mixer.update(Math.min(dt, 0.1));
  }
  update(0, 0);

  return {
    scene, solids, walk, door, toLocal, update,
    greeting: design.greeting, // (hour 0-24) => what the shopkeeper says
    view: { box, centre: { x: centre.x, y: 0.9, z: centre.z }, out: door.out },
    state: () => ({ lit, sun: sun.intensity, lamps: lamps.map((l) => l.intensity), glow: mats.glow.emissiveIntensity }),
    report: {
      id: spec.id,
      name: spec.name,
      floor: { width: maxX - minX, depth: front - back },
      door,
      walk,
      counter: toWorld(design.counter.x, design.counter.z),
      keeper: toWorld(design.keeper.x, design.keeper.z),
      furniture: [...new Set(kit.furniture)],
      triangles,
      atlas: { width: A.width, height: A.height },
    },
  };
}
