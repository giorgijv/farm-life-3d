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

/* How far a room's lamps are up, from 0 by day to 1 after dark, for the
   scene's night value (0 at noon, 1 at midnight). Every light in a room is
   a straight line in this one number, which is what lets a shop window
   show the room at any hour from two photographs: see windows.js. */
export function lampsLit(night) {
  return THREE.MathUtils.smoothstep(night, 0.25, 0.65);
}

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
  galv: '#a7adb0',
  galvDark: '#7d8487',
  hose: '#3e8a3a',
  terracotta: '#b65a3a',
  hay: '#d8b85a',
  hayDark: '#a98a3a',
  tyre: '#262626',
  tractorRed: '#b8262b',
  tractorYellow: '#e8c43a',
  jerryGreen: '#2f6b35',
  sprayYellow: '#e3b72a',
  rope: '#c2a26a',
  boxRed: '#c84a3f',
  boxBlue: '#3f6fa8',
  wheat: '#d9b45a',
  crust: '#b97a3c',
  crustDark: '#8a5428',
  flour: '#efe4cc',
  icing: '#fbf3e6',
  pinkIcing: '#f2b8c6',
  chocolate: '#5a3522',
  lemonIcing: '#f4e18a',
  berry: '#b8263a',
  lace: '#fbf8f2',
  china: '#f7f5f0',
  chinaBlue: '#3f5f9a',
  brick: '#8e3b2a',
  brickDark: '#5e2418',
  soot: '#2a201b',
  chrome: '#c9ccce',
  chromeDark: '#7f8487',
  espresso: '#3a2416',
  leather: '#6b3b2a',
  marble: '#ece8e1',
  pot: '#c26a45',
  fig: '#4d7a3c',
  newsprint: '#e7e3d6',
  linen: '#f7f4ec',
  wine: '#4a1020',
  bottle: '#2d4a2a',
  candle: '#f3ead2',
  silver: '#d4d6d8',
  steel: '#9aa0a4',
  mint: '#bfe3cf',
  medGreen: '#1f6f4a',
  pill: '#f2f4f3',
  bottleBrown: '#7a4a22',
  bottleBlue: '#2f5f9a',
  carboyRed: '#c4202f',
  carboyGreen: '#1f8f52',
  carboyBlue: '#2a56b8',
  plaster: '#e8b48f',
  scaleRed: '#a8262b',
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
  // A little unevenness in the plaster — but not on a clean white wall,
  // where the same speckle reads as dirt.
  for (let k = 0; k < (colours.clean ? 0 : 140); k += 1) {
    const a = noise(k * 3.1);
    const b = noise(k * 7.7 + 1);
    ctx.fillStyle = `rgba(0,0,0,${0.025 + a * 0.03})`;
    ctx.fillRect(a * W, b * yOf(1.05), 10 + b * 18, 6 + a * 10);
  }
  /* Or a wallpaper of small flowers in a half-drop repeat: a sprig every
     fifth of a unit, the rows offset by half, so the tile joins itself. */
  if (colours.pattern === 'floral') {
    const cols = 6;
    const sx = W / cols;
    const sy = sx * 1.1;
    for (let r = 0; r * sy < yOf(1.06); r += 1) {
      for (let k = 0; k < cols; k += 1) {
        const x = k * sx + (r % 2 ? sx / 2 : 0) + sx / 4;
        const y = r * sy + sy / 2;
        ctx.fillStyle = colours.leaf ?? '#7a9a6a';
        ctx.fillRect(x - 1, y, 2, 10);
        ctx.fillRect(x, y + 5, 6, 2);
        ctx.fillStyle = (r + k) % 3 ? colours.bloom ?? '#d88aa0' : colours.bloom2 ?? '#8aa3d0';
        for (let p = 0; p < 5; p += 1) {
          const a = (p / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * 3.4, y + Math.sin(a) * 3.4, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#f2d36a';
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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

/* Square tiles, a quarter of FLOOR_TILE each, in two colours. */
function checkerCanvas(a, b) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const n = 4;
  const t = 256 / n;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      ctx.fillStyle = (i + j) % 2 ? a : b;
      ctx.fillRect(i * t, j * t, t, t);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(i * t, j * t, t, 2);
      ctx.fillRect(i * t, j * t, 2, t);
    }
  }
  return c;
}

/* A dining-room carpet: a deep ground, a lattice of diamonds in gold, a
   rosette in each. One repeat is FLOOR_TILE square. */
function carpetCanvas(ground, line) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 900; k += 1) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + noise(k) * 0.05})`;
    ctx.fillRect(noise(k * 3) * 256, noise(k * 7) * 256, 2, 2);
  }
  const n = 4;
  const t = 256 / n;
  ctx.strokeStyle = line;
  ctx.lineWidth = 3;
  for (let i = -1; i <= n; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * t, 0);
    ctx.lineTo(i * t + 256, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * t + 256, 0);
    ctx.lineTo(i * t, 256);
    ctx.stroke();
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const x = i * t + t / 2;
      const y = j * t;
      ctx.fillStyle = line;
      for (let p = 0; p < 4; p += 1) {
        const a = (p / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 5, y + t / 2 + Math.sin(a) * 5, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
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

  // The pharmacist's green cross.
  cross(ctx, c) {
    ctx.fillStyle = '#f2f5f2';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#1f8f52';
    const t = c.w * 0.28;
    ctx.fillRect(c.x + (c.w - t) / 2, c.y + 10, t, c.h - 20);
    ctx.fillRect(c.x + 10, c.y + (c.h - t) / 2, c.w - 20, t);
  },
  rxsign(ctx, c) {
    ctx.fillStyle = '#1f6f4a';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#f2f5f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'PRESCRIPTIONS', 36, c.w - 30, SANS);
    ctx.fillText('PRESCRIPTIONS', c.x + c.w / 2, c.y + c.h / 2 + 1);
  },
  // The side of a box of something from the shelves: white with a band.
  medbox(ctx, c) {
    ctx.fillStyle = '#f2f4f3';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    const bands = ['#2f5f9a', '#c4202f', '#1f8f52', '#e3b72a'];
    for (let k = 0; k < 4; k += 1) {
      ctx.fillStyle = bands[k];
      ctx.fillRect(c.x + k * (c.w / 4) + 4, c.y + c.h * 0.55, c.w / 4 - 8, c.h * 0.2);
      ctx.fillStyle = 'rgba(30,30,30,0.5)';
      ctx.fillRect(c.x + k * (c.w / 4) + 6, c.y + c.h * 0.25, c.w / 4 - 14, 3);
    }
  },
  // The dial of the weighing machine: a white face, a red pointer.
  scaledial(ctx, c) {
    ctx.fillStyle = '#a8262b';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#f6f1e2';
    ctx.beginPath();
    ctx.arc(c.x + c.w / 2, c.y + c.h / 2, c.w * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c.x + c.w / 2 + Math.sin(a) * c.w * 0.32, c.y + c.h / 2 - Math.cos(a) * c.w * 0.32);
      ctx.lineTo(c.x + c.w / 2 + Math.sin(a) * c.w * 0.38, c.y + c.h / 2 - Math.cos(a) * c.w * 0.38);
      ctx.stroke();
    }
    ctx.strokeStyle = '#b22';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x + c.w / 2, c.y + c.h / 2);
    ctx.lineTo(c.x + c.w * 0.3, c.y + c.h * 0.32);
    ctx.stroke();
  },

  /* A painting in a gilt frame: the town's fields, its City Hall, or the
     sea it is a day's drive from. */
  picture(ctx, c, spec, subject) {
    const { x, y, w, h } = c;
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8f7219';
    ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
    const ix = x + 12;
    const iy = y + 12;
    const iw = w - 24;
    const ih = h - 24;
    const sky = ctx.createLinearGradient(0, iy, 0, iy + ih);
    sky.addColorStop(0, subject === 'harbour' ? '#7fa8c9' : '#a9c8de');
    sky.addColorStop(1, '#f1e2c0');
    ctx.fillStyle = sky;
    ctx.fillRect(ix, iy, iw, ih);
    if (subject === 'fields') {
      ctx.fillStyle = '#7a9a4a';
      ctx.beginPath(); ctx.moveTo(ix, iy + ih * 0.55); ctx.quadraticCurveTo(ix + iw * 0.4, iy + ih * 0.4, ix + iw, iy + ih * 0.6); ctx.lineTo(ix + iw, iy + ih); ctx.lineTo(ix, iy + ih); ctx.fill();
      ctx.fillStyle = '#d9b45a';
      ctx.fillRect(ix, iy + ih * 0.72, iw, ih * 0.28);
      ctx.fillStyle = '#8e2b24';
      ctx.fillRect(ix + iw * 0.62, iy + ih * 0.48, iw * 0.16, ih * 0.14);
      ctx.beginPath(); ctx.moveTo(ix + iw * 0.6, iy + ih * 0.49); ctx.lineTo(ix + iw * 0.7, iy + ih * 0.38); ctx.lineTo(ix + iw * 0.8, iy + ih * 0.49); ctx.fill();
    } else if (subject === 'hall') {
      ctx.fillStyle = '#7f9a5a';
      ctx.fillRect(ix, iy + ih * 0.78, iw, ih * 0.22);
      ctx.fillStyle = '#d9d0bd';
      ctx.fillRect(ix + iw * 0.2, iy + ih * 0.42, iw * 0.6, ih * 0.36);
      ctx.fillRect(ix + iw * 0.44, iy + ih * 0.18, iw * 0.12, ih * 0.26);
      ctx.fillStyle = '#5e9e8a';
      ctx.beginPath(); ctx.arc(ix + iw * 0.5, iy + ih * 0.18, iw * 0.06, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#a99f8a';
      for (let k = 0; k < 6; k += 1) ctx.fillRect(ix + iw * (0.25 + k * 0.09), iy + ih * 0.46, iw * 0.03, ih * 0.3);
    } else {
      ctx.fillStyle = '#3f6f9a';
      ctx.fillRect(ix, iy + ih * 0.6, iw, ih * 0.4);
      ctx.fillStyle = '#f4f1ea';
      ctx.beginPath(); ctx.moveTo(ix + iw * 0.3, iy + ih * 0.6); ctx.lineTo(ix + iw * 0.42, iy + ih * 0.22); ctx.lineTo(ix + iw * 0.42, iy + ih * 0.6); ctx.fill();
      ctx.fillStyle = '#6b4a2b';
      ctx.fillRect(ix + iw * 0.22, iy + ih * 0.6, iw * 0.3, ih * 0.06);
      ctx.fillStyle = '#e8c43a';
      ctx.beginPath(); ctx.arc(ix + iw * 0.78, iy + ih * 0.28, iw * 0.07, 0, Math.PI * 2); ctx.fill();
    }
  },
  // The reservations book open on the stand by the door.
  booking(ctx, c) {
    ctx.fillStyle = '#f3ecd8';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#6e2233';
    ctx.fillRect(c.x + c.w / 2 - 1.5, c.y, 3, c.h);
    ctx.fillStyle = 'rgba(40,40,60,0.55)';
    for (let y = c.y + 12; y < c.y + c.h - 4; y += 9) {
      ctx.fillRect(c.x + 6, y, c.w / 2 - 14, 1.5);
      ctx.fillRect(c.x + c.w / 2 + 8, y, c.w / 2 - 14 - (y % 3) * 4, 1.5);
    }
  },
  winelabel(ctx, c) {
    ctx.fillStyle = '#f1e8cf';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#6e2233';
    ctx.fillRect(c.x + 4, c.y + c.h * 0.4, c.w - 8, c.h * 0.2);
  },

  /* The café's menu over its counter, in chalk, with the prices in coins. */
  cafeboard(ctx, c) {
    ctx.fillStyle = '#25302e';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = '#b98a58';
    ctx.lineWidth = 12;
    ctx.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12);
    ctx.fillStyle = '#f4f1e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'Café', 48, c.w - 40, SERIF, 'italic bold');
    ctx.fillText('Café', c.x + c.w / 2, c.y + 42);
    const rows = [['Coffee', 2], ['Tea', 2], ['Hot chocolate', 3], ['Cake', 3], ['Toastie', 4]];
    rows.forEach(([name, price], i) => {
      const y = c.y + 86 + i * 32;
      ctx.textAlign = 'left';
      ctx.font = `bold 24px ${SANS}`;
      ctx.fillStyle = '#f4f1e6';
      ctx.fillText(name, c.x + 36, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f3e07a';
      ctx.fillText(String(price), c.x + c.w - 60, y);
      coin(ctx, c.x + c.w - 40, y, 9);
    });
  },
  // A rack's worth of folded newspapers, mastheads up.
  papers(ctx, c) {
    ctx.fillStyle = '#e7e3d6';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    const names = ['FARM CITY POST', 'THE GAZETTE', 'GROWER WEEKLY'];
    names.forEach((n, i) => {
      const y = c.y + 8 + i * (c.h / 3);
      ctx.fillStyle = '#1d1d1f';
      ctx.font = `bold 15px ${SERIF}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(n, c.x + 8, y);
      ctx.fillStyle = 'rgba(30,30,30,0.35)';
      for (let k = 0; k < 3; k += 1) ctx.fillRect(c.x + 8, y + 20 + k * 6, c.w - 16 - (k % 2) * 30, 2);
    });
  },
  coffeebag(ctx, c) {
    ctx.fillStyle = '#2f2a26';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#d9a441';
    ctx.fillRect(c.x + 10, c.y + c.h * 0.32, c.w - 20, c.h * 0.36);
    ctx.fillStyle = '#2f2a26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'BEANS', 22, c.w - 26, SANS);
    ctx.fillText('BEANS', c.x + c.w / 2, c.y + c.h / 2);
  },

  /* The tea room's menu, in chalk on the back wall. */
  teaboard(ctx, c) {
    ctx.fillStyle = '#2b2f2c';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = '#f1e8cf';
    ctx.lineWidth = 10;
    ctx.strokeRect(c.x + 5, c.y + 5, c.w - 10, c.h - 10);
    ctx.fillStyle = '#f4f1e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'Tea Room', 44, c.w - 40, SERIF, 'italic bold');
    ctx.fillText('Tea Room', c.x + c.w / 2, c.y + 40);
    ctx.font = `bold 24px ${SANS}`;
    ['Pot of tea', 'Scones & cream', 'Cake of the day', 'Toasted teacake'].forEach((line, i) => {
      ctx.fillText(line, c.x + c.w / 2, c.y + 92 + i * 38);
    });
  },

  /* Hardware & Feed's board over the shelves behind its counter. */
  signboard(ctx, c, spec) {
    ctx.fillStyle = spec.colours.paint;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 6;
    ctx.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12);
    ctx.fillStyle = '#f1e2b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = `${spec.name.toUpperCase()}  ·  EST. 1902`;
    fit(ctx, text, 54, c.w - 60, SERIF);
    ctx.fillText(text, c.x + c.w / 2, c.y + c.h / 2 + 2);
  },
  // Brown hardboard with its grid of holes.
  pegboard(ctx, c) {
    ctx.fillStyle = '#8a6340';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#4a3220';
    for (let y = c.y + 6; y < c.y + c.h; y += 10) {
      for (let x = c.x + 6; x < c.x + c.w; x += 10) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
  soldout(ctx, c) {
    ctx.fillStyle = '#b8262b';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#fff6e8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'SOLD OUT', 36, c.w - 20, SANS);
    ctx.fillText('SOLD OUT', c.x + c.w / 2, c.y + c.h / 2 + 1);
  },
  feedsack(ctx, c) {
    ctx.fillStyle = '#e4d3a8';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = 'rgba(90,70,40,0.15)';
    for (let k = 0; k < c.w; k += 5) ctx.fillRect(c.x + k, c.y, 1, c.h);
    ctx.fillStyle = '#9b2d20';
    ctx.fillRect(c.x, c.y + c.h * 0.18, c.w, c.h * 0.12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#3d2a17';
    fit(ctx, 'LAYERS MASH', 28, c.w - 16, SANS);
    ctx.fillText('LAYERS MASH', c.x + c.w / 2, c.y + c.h * 0.5);
    ctx.font = `bold 18px ${SANS}`;
    ctx.fillText('FARM CITY FEED', c.x + c.w / 2, c.y + c.h * 0.74);
  },
  /* A plain printed label: [text, ink, ground]. */
  label(ctx, c, spec, [text, ink, ground]) {
    ctx.fillStyle = ground;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, text, 34, c.w - 16, SANS);
    ctx.fillText(text, c.x + c.w / 2, c.y + c.h / 2 + 1);
  },
  // An open order book: ruled pages, names and figures in ink.
  ledger(ctx, c) {
    ctx.fillStyle = '#f3ecd8';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#7a5530';
    ctx.fillRect(c.x + c.w / 2 - 2, c.y, 4, c.h);
    ctx.fillStyle = 'rgba(60,90,140,0.4)';
    for (let y = c.y + 18; y < c.y + c.h - 6; y += 11) {
      ctx.fillRect(c.x + 8, y, c.w / 2 - 16, 1);
      ctx.fillRect(c.x + c.w / 2 + 8, y, c.w / 2 - 16, 1);
    }
    ctx.fillStyle = '#2a2a3a';
    ctx.font = `italic 11px ${SERIF}`;
    ctx.textAlign = 'left';
    const names = ['Market', 'Mill', 'Dairy', 'Baker', 'Inn', 'Grocer', 'Hall', 'Farm'];
    names.forEach((n, i) => {
      const left = i < 4;
      ctx.fillText(n, c.x + (left ? 10 : c.w / 2 + 10), c.y + 16 + (i % 4) * 22);
    });
    ctx.font = `bold 13px ${SERIF}`;
    ctx.fillText('CONTACTS', c.x + 10, c.y + c.h - 10);
  },
  // A rack's worth of seed packets, each a flower on its own colour.
  seeds(ctx, c) {
    ctx.fillStyle = '#5d3b20';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    const colours = ['#e8c43a', '#d8433b', '#5f8fd0', '#e889b5', '#8cbf3f', '#e8892a'];
    for (let r = 0; r < 2; r += 1) {
      for (let k = 0; k < 6; k += 1) {
        const x = c.x + 6 + k * ((c.w - 12) / 6);
        const y = c.y + 6 + r * ((c.h - 12) / 2);
        const w = (c.w - 12) / 6 - 6;
        const h = (c.h - 12) / 2 - 6;
        ctx.fillStyle = '#f4efe2';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = colours[(k + r * 2) % colours.length];
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h * 0.42, w * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3f7a3a';
        ctx.fillRect(x + w / 2 - 1, y + h * 0.55, 2, h * 0.3);
      }
    }
  },
  /* The card in front of each of the shop's six lines: its name, and three
     sockets for the gold pips that say how many levels have been bought. */
  tag(ctx, c, spec, name) {
    ctx.fillStyle = '#f6efdc';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = spec.colours.paint;
    ctx.lineWidth = 6;
    ctx.strokeRect(c.x + 3, c.y + 3, c.w - 6, c.h - 6);
    ctx.fillStyle = '#2b1d12';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fit(ctx, name, 32, c.w - 30, SANS);
    ctx.fillText(name, c.x + 14, c.y + c.h * 0.34);
    ctx.font = `bold 16px ${SANS}`;
    ctx.fillStyle = '#7a5530';
    ctx.fillText('LEVEL', c.x + 14, c.y + c.h * 0.72);
    for (const sk of TAG_SOCKETS) {
      ctx.fillStyle = '#5a4634';
      ctx.beginPath();
      ctx.arc(c.x + sk.u * c.w, c.y + (1 - sk.v) * c.h, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/* What each shop letters or paints, beyond the swatches every room has.
   A cell is drawn by DRAW[kind]; `key` names it in the atlas when one kind
   is drawn more than once, and `arg` is what that copy says. */
const CELLS = {
  grocer: () => [
    { kind: 'chalk', w: 512, h: 320 },
    { kind: 'poster', w: 256, h: 320 },
    { kind: 'sack', w: 192, h: 160 },
    { kind: 'scale', w: 96, h: 96 },
    { kind: 'till', w: 128, h: 112 },
    { kind: 'bag', w: 128, h: 96 },
  ],
  pharmacy: () => [
    { kind: 'cross', w: 128, h: 128 },
    { kind: 'rxsign', w: 384, h: 64 },
    { kind: 'medbox', w: 128, h: 64 },
    { kind: 'scaledial', w: 96, h: 96 },
  ],
  restaurant: () => [
    { kind: 'picture', key: 'picture:fields', w: 192, h: 144, arg: 'fields' },
    { kind: 'picture', key: 'picture:hall', w: 192, h: 144, arg: 'hall' },
    { kind: 'picture', key: 'picture:harbour', w: 192, h: 144, arg: 'harbour' },
    { kind: 'booking', w: 128, h: 96 },
    { kind: 'winelabel', w: 64, h: 32 },
  ],
  cafe: () => [
    { kind: 'cafeboard', w: 448, h: 256 },
    { kind: 'papers', w: 192, h: 128 },
    { kind: 'coffeebag', w: 96, h: 128 },
  ],
  bakery: () => [
    { kind: 'teaboard', w: 320, h: 256 },
    { kind: 'bag', w: 128, h: 96 },
    { kind: 'till', w: 128, h: 112 },
  ],
  hardware: (spec) => [
    { kind: 'signboard', w: 768, h: 96 },
    { kind: 'pegboard', w: 256, h: 128 },
    { kind: 'soldout', w: 256, h: 48 },
    { kind: 'feedsack', w: 192, h: 160 },
    { kind: 'label', key: 'richfeed', w: 192, h: 96, arg: ['RICH FEED', '#6b3e1f', '#e9d9b0'] },
    { kind: 'label', key: 'jerry', w: 160, h: 96, arg: ['FERTILISER', '#f1e8cf', '#2f6b35'] },
    { kind: 'ledger', w: 192, h: 128 },
    { kind: 'seeds', w: 256, h: 128 },
    { kind: 'scale', w: 96, h: 96 },
    { kind: 'till', w: 128, h: 112 },
    ...spec.upgrades.map((u) => ({ kind: 'tag', key: `tag:${u.id}`, w: 256, h: 112, arg: u.name })),
  ],
};

/* Where a tag's three level sockets are drawn, as fractions of the tag
   across and up — the same numbers place the gold pips on them. */
const TAG_SOCKETS = [0.64, 0.76, 0.88].map((u) => ({ u, v: 0.3 }));

function makeAtlas(spec) {
  const cells = [
    { kind: 'mat', w: 256, h: 160 },
    ...CELLS[spec.kind](spec),
    ...Object.entries({
      ...PAINT, paint: spec.colours.paint, trim: spec.colours.trim,
      ...(spec.colours.shade ? { shade: spec.colours.shade } : {}),
    })
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
    else DRAW[c.kind](ctx, c, spec, c.arg);
    ctx.restore();
  }
  const uvOf = (c) => ({
    u0: (c.x + 0.5) / WIDTH,
    u1: (c.x + c.w - 0.5) / WIDTH,
    v0: 1 - (c.y + c.h - 0.5) / HEIGHT,
    v1: 1 - (c.y + 0.5) / HEIGHT,
  });
  const uv = Object.fromEntries(cells.filter((c) => c.kind !== 'swatch').map((c) => [c.key ?? c.kind, uvOf(c)]));
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
  /* `front` is the street wall and the pavement's kerb, on the atlas like
     everything else but a mesh of its own: the photograph a shop window
     shows is taken from across the road, through where that wall stands. */
  const parts = { atlas: [], front: [], wall: [], floor: [], pave: [], glow: [], glass: [], flame: [] };
  const solids = [];
  const furniture = [];
  const sw = (k) => A.swatch[k];

  /* A box given by its extents rather than its centre and size: the room
     is laid out in edges — this counter runs from here to the wall — and
     stating it that way is what keeps the aisles the widths written down. */
  let into = 'atlas';
  const block = (colour, [x0, x1], [y0, y1], [z0, z1], yaw = 0) => {
    const g = paint(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), sw(colour));
    parts[into].push(placed(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, yaw));
  };
  // Every block built inside `fn` goes on the front rather than the atlas.
  const onFront = (fn) => {
    into = 'front';
    try { fn(); } finally { into = 'atlas'; }
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
  // Something that glows that is not a bulb: an oven's mouth.
  const glowBox = ([x0, x1], [y0, y1], [z0, z1]) => {
    parts.glow.push(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed()
      .translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  };
  // A candle's flame: drawn on its own material, which flickers.
  const flame = (x, y, z) => {
    parts.flame.push(new THREE.ConeGeometry(0.014, 0.05, 6).toNonIndexed().translate(x, y + 0.025, z));
    parts.flame.push(new THREE.IcosahedronGeometry(0.014, 0).translate(x, y + 0.005, z));
  };
  // A sheet of glass, which is drawn see-through.
  const pane = ([x0, x1], [y0, y1], [z0, z1]) => {
    parts.glass.push(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed()
      .translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  };

  return { A, parts, solids, furniture, sw, block, onFront, cylinder, solid, fruitAt, crate, basket, jar, bulb, glowBox, pane, flame };
}

/* -------------------------------------------------------------------- */
/* The shell every room has                                              */
/* -------------------------------------------------------------------- */

/* Openings through a room's back wall, where a shop has a room behind
   it: [from x, to x, top, sill], in the room's frame — a doorway has no
   sill, a serving hatch does. */
const OPENINGS = {
  bakery: { back: [-0.5, 0.3, 2.0] },
  restaurant: { back: [0.55, 1.75, 1.75, 1.0] },
  pharmacy: { back: [0.2, 1.4, 1.8, 1.0] },
};

function buildShell(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const { wall, height, cut } = ROOM;
  const front = -wall; // the street wall's inner face
  const W = kit.parts.wall;
  // Three full-height walls, inner faces only: from the camera's side of
  // the room nothing else of them can be seen. Each wound to face inwards.
  const opening = OPENINGS[spec.kind]?.back;
  if (opening) {
    const [o0, o1, oh, sill = 0] = opening;
    W.push(wallQuad(minX, back, o0, back, 0, height));
    W.push(wallQuad(o1, back, maxX, back, 0, height, o1 - minX));
    W.push(wallQuad(o0, back, o1, back, oh, height, o0 - minX));
    if (sill > 0) W.push(wallQuad(o0, back, o1, back, 0, sill, o0 - minX));
  } else {
    W.push(wallQuad(minX, back, maxX, back, 0, height));           // back, facing +z
  }
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
  kit.onFront(() => {
    for (const [a, b] of [[minX - wall, d0], [d1, maxX + wall]]) {
      if (b - a < 0.01) continue;
      kit.block('paint', [a, b], [0, cut], [front, 0]);
      kit.block('woodLight', [a - 0.01, b + 0.01], [cut, cut + 0.04], [front - 0.03, 0.03]);
    }
    // The door's frame, cut at the same height, and a stone threshold.
    for (const x of [d0, d1]) kit.block('trim', [x - 0.05, x + 0.05], [0, cut + 0.12], [front - 0.02, 0.02]);
    kit.block('stone', [d0, d1], [0, 0.02], [front, 0.04]);
  });
  // A welcome mat inside it.
  kit.parts.atlas.push(placed(
    topLabelled(spec.door.w - 0.1, 0.012, 0.55, kit.A.uv.mat, kit.sw('coir')),
    spec.door.x, 0.006, front - 0.33,
  ));

  kit.parts.floor.push(floorQuad(minX, maxX, back, front, 0, FLOOR_TILE));
  // The pavement outside, at the street's own height.
  kit.parts.pave.push(floorQuad(minX - 0.8, maxX + 0.8, 0, ROOM.apron, ROOM.pave, PAVE_TILE));
  kit.onFront(() => kit.block('stone', [minX - 0.8, maxX + 0.8], [0, ROOM.pave], [0, ROOM.apron]));
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

/* -------------------------------------------------------------------- */
/* Hardware & Feed                                                       */
/* -------------------------------------------------------------------- */

/* A country ironmonger's: a long dark counter across the back with the
   stock on shelves behind it and the shop's board over them, a pegboard
   of tools down one wall, feed and hay stacked down the other, and in the
   middle the six things this shop is the only place to buy — each on show
   with a card in front saying how many of its three levels the farm has.

   The room is 7.2 by 7.3 with its door in the middle of the frontage, so
   the way in is a straight two-unit aisle from the door to the counter,
   with the two islands of the farm's upgrades either side of it. */
function hardware(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const front = -ROOM.wall;
  const { block, cylinder, solid } = kit;

  // The window, left of the door: a wheelbarrow, watering cans and pots.
  block('woodDark', [minX, -0.8], [0, 0.22], [-1.1, front]);
  solid('window-left', [minX, -0.8], [-1.1, front], 1.0);
  {
    const x = -2.55;
    const z = -0.62;
    const tray = paint(new THREE.CylinderGeometry(0.34, 0.24, 0.2, 4, 1, true), kit.sw('jerryGreen'));
    kit.parts.atlas.push(tray.rotateY(Math.PI / 4).scale(1.1, 1, 0.8).translate(x, 0.5, z));
    block('jerryGreen', [x - 0.24, x + 0.24], [0.39, 0.41], [z - 0.17, z + 0.17]);
    const wheel = paint(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12), kit.sw('tyre'));
    kit.parts.atlas.push(wheel.rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(x, 0.35, z + 0.36));
    for (const sx of [-0.14, 0.14]) {
      block('wood', [x + sx - 0.015, x + sx + 0.015], [0.4, 0.43], [z - 0.55, z + 0.36]);
      block('iron', [x + sx - 0.015, x + sx + 0.015], [0.22, 0.4], [z - 0.2, z - 0.17]);
    }
  }
  for (const [x, z, r] of [[-1.55, -0.45, 0.1], [-1.2, -0.75, 0.09], [-1.0, -0.4, 0.08]]) {
    cylinder('galv', r, r * 1.05, r * 1.8, x, 0.22, z, 10);
    const spout = paint(new THREE.CylinderGeometry(0.012, 0.02, r * 2.6, 6), kit.sw('galvDark'));
    kit.parts.atlas.push(spout.rotateZ(-0.9).translate(x + r * 1.3, 0.22 + r * 1.6, z));
    const handle = paint(new THREE.TorusGeometry(r * 0.7, 0.01, 4, 10, Math.PI), kit.sw('galvDark'));
    kit.parts.atlas.push(handle.translate(x - r * 0.2, 0.22 + r * 1.8, z));
  }
  for (let k = 0; k < 4; k += 1) cylinder('terracotta', 0.11, 0.08, 0.13, -3.25, 0.22 + k * 0.07, -0.5, 10, k < 3);

  // The window, right of the door: a barrel of handles, buckets, hose.
  block('woodDark', [0.8, maxX], [0, 0.22], [-1.1, front]);
  solid('window-right', [0.8, maxX], [-1.1, front], 1.0);
  cylinder('wood', 0.2, 0.18, 0.5, 1.4, 0.22, -0.6, 12);
  for (const y of [0.32, 0.6]) cylinder('iron', 0.205, 0.205, 0.03, 1.4, y, -0.6, 12);
  for (let k = 0; k < 5; k += 1) {
    const a = (k / 5) * Math.PI * 2;
    const hx = 1.4 + Math.cos(a) * 0.1;
    const hz = -0.6 + Math.sin(a) * 0.1;
    block('woodLight', [hx - 0.015, hx + 0.015], [0.5, 1.25 + (k % 2) * 0.12], [hz - 0.015, hz + 0.015]);
    block(k % 2 ? 'galv' : 'tyre', [hx - 0.08, hx + 0.08], [1.25 + (k % 2) * 0.12, 1.31 + (k % 2) * 0.12], [hz - 0.02, hz + 0.02]);
  }
  for (let k = 0; k < 3; k += 1) cylinder('galv', 0.14, 0.11, 0.22, 2.3, 0.22 + k * 0.05, -0.55, 12, true);
  for (let k = 0; k < 3; k += 1) {
    const ring = paint(new THREE.TorusGeometry(0.2, 0.025, 5, 14), kit.sw('hose'));
    kit.parts.atlas.push(ring.rotateX(Math.PI / 2).translate(3.05, 0.25 + k * 0.05, -0.6));
  }

  // The two islands down the middle, the shop's six lines on them.
  const islands = [[-2.1, -1.0], [1.0, 2.1]];
  const iz = [-4.4, -2.0];
  for (const ix of islands) {
    block('woodDark', ix, [0, 0.76], iz);
    block('woodLight', [ix[0] - 0.03, ix[1] + 0.03], [0.76, 0.8], [iz[0] - 0.03, iz[1] + 0.03]);
  }
  solid('lines-left', islands[0], iz, 0.9);
  solid('lines-right', islands[1], iz, 0.9);

  /* The cards lean back towards the camera, and are as big as the island
     is wide: the first were half a unit across and could not be read from
     where the camera stands. */
  const TILT = 0.75;
  const TAG = { w: 0.62, h: 0.27, d: 0.012 };
  const up = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT));
  const normal = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));
  const slots = spec.upgrades.map((u, i) => {
    const x = i < 3 ? -1.55 : 1.55;
    const z = [-2.42, -3.18, -3.94][i % 3];
    const top = 0.8;
    /* Each line built at its own size, then half as big again about the
       spot it stands on: at the size things are in a shop they were a
       handful of pixels from the camera. */
    const from = kit.parts.atlas.length;
    (ITEMS[u.id] ?? ITEMS.generic)(kit, x, top, z - 0.1);
    for (let g = from; g < kit.parts.atlas.length; g += 1) {
      kit.parts.atlas[g].translate(-x, -top, -(z - 0.1)).scale(1.5, 1.5, 1.5).translate(x, top, z - 0.1);
    }
    // The card, leaning back on the island's top in front of its item.
    const centre = new THREE.Vector3(x, top + (TAG.h / 2) * Math.cos(TILT), z + 0.36 - (TAG.h / 2) * Math.sin(TILT));
    const card = labelledBox(TAG.w, TAG.h, TAG.d, { front: kit.A.uv[`tag:${u.id}`], back: kit.sw('woodDark') }, kit.sw('woodDark'));
    kit.parts.atlas.push(card.rotateX(-TILT).translate(centre.x, centre.y, centre.z));
    const onCard = (fu, fv, lift) => centre.clone()
      .addScaledVector(new THREE.Vector3(1, 0, 0), (fu - 0.5) * TAG.w)
      .addScaledVector(up, (fv - 0.5) * TAG.h)
      .addScaledVector(normal, TAG.d / 2 + lift);
    return {
      id: u.id,
      max: u.max,
      pips: TAG_SOCKETS.map((sk) => onCard(sk.u, sk.v, 0.008)),
      banner: { at: onCard(0.5, 0.62, 0.006), tilt: TILT },
    };
  });

  // The counter across the back, with a bin of grain at one end and a
  // flap at the other.
  const cx = [-2.8, 2.8];
  const cz = [-6.0, -5.35];
  block('woodDark', cx, [0, 0.92], cz);
  for (let x = cx[0] + 0.12; x < cx[1] - 0.5; x += 0.7) block('wood', [x, x + 0.56], [0.14, 0.78], [cz[1], cz[1] + 0.012]);
  block('wood', [cx[0] - 0.03, cx[1] + 0.03], [0.92, 0.97], [cz[0] - 0.02, cz[1] + 0.05]);
  solid('counter', cx, cz, 0.97);
  for (const [x0, x1, grain] of [[minX, minX + 0.38, 'corn'], [minX + 0.4, cx[0], 'wheat']]) {
    block('wood', [x0, x1], [0, 0.78], cz);
    block(grain, [x0 + 0.04, x1 - 0.04], [0.78, 0.8], [cz[0] + 0.04, cz[1] - 0.04]);
  }
  solid('grain-bins', [minX, cx[0]], cz, 0.8);
  block('woodDark', [cx[1], maxX], [0.86, 0.92], cz);
  block('wood', [cx[1] + 0.05, maxX - 0.05], [0.1, 0.86], [cz[1] - 0.08, cz[1] - 0.04]);
  solid('counter-flap', [cx[1], maxX], cz, 0.92);
  solid('behind-counter', [minX, maxX], [back, cz[0]], 0.97);
  // On it: the till, a scale for nails, a bell, and brown paper on a roll.
  kit.parts.atlas.push(placed(
    labelledBox(0.36, 0.2, 0.3, { front: kit.A.uv.till, back: kit.sw('iron') }, kit.sw('iron')), 1.9, 1.07, -5.7,
  ));
  kit.block('brassDark', [-1.75, -1.45], [0.97, 1.01], [-5.8, -5.55]);
  kit.cylinder('brass', 0.025, 0.025, 0.2, -1.6, 1.01, -5.7, 6);
  kit.cylinder('brass', 0.15, 0.11, 0.03, -1.6, 1.21, -5.7, 12);
  kit.parts.atlas.push(placed(
    labelledBox(0.2, 0.2, 0.025, { front: kit.A.uv.scale, back: kit.sw('brass') }, kit.sw('brass')), -1.6, 1.12, -5.55,
  ));
  kit.cylinder('brass', 0.05, 0.07, 0.07, 0.35, 0.97, -5.55, 10);
  kit.cylinder('iron', 0.012, 0.012, 0.04, 0.35, 1.04, -5.55, 5);
  for (const x of [-0.95, -0.35]) block('iron', [x - 0.015, x + 0.015], [0.97, 1.2], [-5.7, -5.66]);
  const roll = paint(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 10), kit.sw('bag'));
  kit.parts.atlas.push(roll.rotateZ(Math.PI / 2).translate(-0.65, 1.13, -5.68));

  // The stock behind the counter, and the board over it.
  let k = 0;
  for (const y of [1.15, 1.6, 2.05]) {
    block('wood', [minX + 0.1, maxX - 0.1], [y - 0.03, y], [back, back + 0.34]);
    for (let x = minX + 0.25; x < maxX - 0.2; x += 0.24) {
      k += 1;
      const kind = k % 5;
      if (kind === 0) cylinder('galv', 0.07, 0.07, 0.16, x, y, back + 0.17, 10);
      else if (kind === 1) {
        const coil = paint(new THREE.TorusGeometry(0.07, 0.03, 5, 10), kit.sw('rope'));
        kit.parts.atlas.push(coil.translate(x, y + 0.1, back + 0.17));
      } else block(['boxRed', 'boxBlue', 'cream', 'tractorYellow'][k % 4], [x - 0.09, x + 0.09], [y, y + 0.14 + (k % 3) * 0.04], [back + 0.06, back + 0.3]);
    }
  }
  kit.parts.atlas.push(placed(
    labelledBox(3.8, 0.36, 0.03, { front: kit.A.uv.signboard, back: kit.sw('woodDark') }, kit.sw('woodDark')),
    0, 2.42, back + 0.02,
  ));

  // The tool wall: a bench of tins and seeds under a pegboard of tools.
  const tz = [-5.0, -1.4];
  block('woodDark', [minX, minX + 0.45], [0, 0.85], tz);
  solid('tool-wall', [minX, minX + 0.45], tz, 2.4);
  const paints = ['boxRed', 'boxBlue', 'jerryGreen', 'tractorYellow', 'cream', 'boxRed'];
  for (let i = 0; i < 12; i += 1) {
    const z = tz[0] + 0.15 + i * 0.13;
    cylinder(paints[i % paints.length], 0.055, 0.055, 0.1, minX + 0.32, 0.85, z, 10);
    cylinder('galv', 0.056, 0.056, 0.012, minX + 0.32, 0.95, z, 10);
  }
  kit.parts.atlas.push(placed(
    labelledBox(1.1, 0.5, 0.02, { front: kit.A.uv.seeds, back: kit.sw('woodDark') }, kit.sw('woodDark')),
    minX + 0.2, 1.1, -2.1, Math.PI / 2,
  ));
  kit.parts.atlas.push(placed(
    labelledBox(3.6, 1.3, 0.02, { front: kit.A.uv.pegboard, back: kit.sw('woodDark') }, kit.sw('woodDark')),
    minX + 0.012, 1.7, (tz[0] + tz[1]) / 2, Math.PI / 2,
  ));
  const tx = minX + 0.06;
  for (let i = 0; i < 9; i += 1) {
    const z = tz[0] + 0.25 + i * 0.4;
    const kind = i % 4;
    if (kind === 0 || kind === 2) {
      // A long-handled tool hung head down: a rake or a fork.
      block('woodLight', [tx - 0.012, tx + 0.012], [1.25, 2.3], [z - 0.012, z + 0.012]);
      block('galvDark', [tx - 0.015, tx + 0.015], [1.08, 1.25], [z - (kind ? 0.06 : 0.14), z + (kind ? 0.06 : 0.14)]);
    } else if (kind === 1) {
      // A spade.
      block('woodLight', [tx - 0.012, tx + 0.012], [1.35, 2.2], [z - 0.012, z + 0.012]);
      block('galv', [tx - 0.008, tx + 0.008], [1.12, 1.37], [z - 0.09, z + 0.09]);
      block('woodDark', [tx - 0.012, tx + 0.012], [2.2, 2.24], [z - 0.07, z + 0.07]);
    } else {
      // A saw and a hammer.
      block('galv', [tx - 0.006, tx + 0.006], [1.85, 1.97], [z - 0.26, z + 0.16]);
      block('wood', [tx - 0.02, tx + 0.02], [1.84, 1.98], [z + 0.16, z + 0.26]);
      block('woodLight', [tx - 0.012, tx + 0.012], [1.3, 1.62], [z - 0.012, z + 0.012]);
      block('iron', [tx - 0.02, tx + 0.02], [1.62, 1.68], [z - 0.07, z + 0.05]);
    }
  }

  // Feed and hay down the right-hand wall.
  const fx = [maxX - 0.8, maxX];
  block('wood', fx, [0, 0.12], [-4.7, -3.0]);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const z0 = -4.66 + col * 0.55;
      const y0 = 0.12 + row * 0.2;
      const sack = labelledBox(0.5, 0.19, 0.72, { front: kit.sw('sack'), back: kit.sw('sack') }, kit.sw('sack'));
      kit.parts.atlas.push(sack.translate(maxX - 0.4 + ((row + col) % 2) * 0.02, y0 + 0.095, z0 + 0.25));
      // The printed side of each sack turned to the aisle.
      kit.parts.atlas.push(placed(
        labelledBox(0.46, 0.17, 0.006, { front: kit.A.uv.feedsack, back: kit.sw('sack') }, kit.sw('sack')),
        fx[0] - 0.005, y0 + 0.095, z0 + 0.25, -Math.PI / 2,
      ));
    }
  }
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const z0 = -2.8 + col * 0.76;
      const y0 = row * 0.4;
      block('hay', [fx[0] + 0.02, fx[1] - 0.02], [y0, y0 + 0.38], [z0, z0 + 0.72]);
      for (const sz of [0.2, 0.52]) block('hayDark', [fx[0] + 0.01, fx[1] - 0.01], [y0 + 0.37, y0 + 0.385], [z0 + sz, z0 + sz + 0.02]);
    }
  }
  solid('feed-stack', [fx[0] - 0.05, maxX], [-4.75, -1.25], 1.4);

  /* Two workshop lamps, down the middle aisle. Not over the islands or
     the counter, where the camera looks past a hanging shade at the very
     things a shade would hide. From out over the pavement, 56 degrees up,
     a shade 2.17 off the floor hides her head when she stands 0.4 behind
     it and her feet at 1.5 — so the second lamp is not at the counter's
     front, where it stood first and hid her at the till, but far enough
     forward that what it hides is the aisle. */
  const lamps = [[0, -1.9, ROOM.height], [0, -3.1, ROOM.height]];
  for (const [x, z, from] of lamps) {
    block('cord', [x - 0.008, x + 0.008], [2.3, from], [z - 0.008, z + 0.008]);
    cylinder('shade', 0.05, 0.2, 0.14, x, 2.17, z, 12, true);
    kit.bulb(x, 2.18, z);
  }

  return {
    keeper: { x: 0.4, z: -6.65, look: { shirt: 0xc9b48a, apron: 0x9b2d20, trousers: 0x3d3a36, hair: 0x4a3626, beard: true } },
    lamps: lamps.map(([x, z]) => [x, 2.15, z]),
    counter: { x: 0, z: -4.95 },
    // Where she stands to be served: along the counter's front.
    counterZone: { x: [cx[0], cx[1]], z: [cz[1] + 0.2, cz[1] + 1.0] },
    slots,
    greeting: (hour) => `🔧 “${hello(hour)}! Everything the farm needs, and a few things it doesn't.”`,
  };
}

/* The six things only this shop sells, each as it would be stood on a
   shop floor: built at (x, y, z) on the island's top. */
const ITEMS = {
  sprinkler(kit, x, y, z) {
    kit.cylinder('iron', 0.1, 0.11, 0.03, x, y, z, 10);
    kit.cylinder('brass', 0.012, 0.012, 0.24, x, y + 0.03, z, 6);
    kit.block('brass', [x - 0.19, x + 0.19], [y + 0.26, y + 0.28], [z - 0.01, z + 0.01]);
    kit.block('brass', [x - 0.01, x + 0.01], [y + 0.26, y + 0.28], [z - 0.19, z + 0.19]);
    const ring = paint(new THREE.TorusGeometry(0.13, 0.022, 5, 14), kit.sw('hose'));
    kit.parts.atlas.push(ring.rotateX(Math.PI / 2).translate(x + 0.2, y + 0.02, z + 0.1));
  },
  feed(kit, x, y, z) {
    const h = 0.36;
    const body = paint(new THREE.CylinderGeometry(0.12, 0.15, h, 8), kit.sw('sack'));
    kit.parts.atlas.push(body.scale(1, 1, 0.75).translate(x, y + h / 2, z));
    const rim = paint(new THREE.TorusGeometry(0.115, 0.022, 4, 8), kit.sw('bag'));
    kit.parts.atlas.push(rim.rotateX(Math.PI / 2).scale(1, 1, 0.75).translate(x, y + h, z));
    for (let k = 0; k < 5; k += 1) kit.block('wheat', [x - 0.08 + k * 0.035, x - 0.06 + k * 0.035], [y + h - 0.02, y + h + 0.01], [z - 0.02, z + 0.02]);
    kit.parts.atlas.push(placed(
      labelledBox(0.2, 0.1, 0.006, { front: kit.A.uv.richfeed, back: kit.sw('sack') }, kit.sw('sack')),
      x, y + h * 0.5, z + 0.15 * 0.75 + 0.004,
    ));
  },
  fertiliser(kit, x, y, z) {
    kit.block('jerryGreen', [x - 0.12, x + 0.12], [y, y + 0.3], [z - 0.07, z + 0.07]);
    kit.block('jerryGreen', [x - 0.06, x + 0.06], [y + 0.3, y + 0.34], [z - 0.02, z + 0.02]);
    kit.cylinder('cream', 0.025, 0.025, 0.05, x + 0.08, y + 0.3, z, 8);
    kit.parts.atlas.push(placed(
      labelledBox(0.18, 0.1, 0.006, { front: kit.A.uv.jerry, back: kit.sw('jerryGreen') }, kit.sw('jerryGreen')),
      x, y + 0.15, z + 0.074,
    ));
  },
  contacts(kit, x, y, z) {
    // An order book open on a little lectern, and the card file beside it.
    const book = topLabelled(0.34, 0.02, 0.22, kit.A.uv.ledger, kit.sw('woodDark'));
    kit.parts.atlas.push(book.rotateX(0.35).translate(x - 0.05, y + 0.12, z));
    kit.block('woodDark', [x - 0.18, x + 0.08], [y, y + 0.1], [z - 0.08, z + 0.08]);
    kit.block('woodLight', [x + 0.12, x + 0.26], [y, y + 0.12], [z - 0.1, z + 0.1]);
    for (let k = 0; k < 6; k += 1) kit.block('white', [x + 0.135, x + 0.245], [y + 0.12, y + 0.17], [z - 0.08 + k * 0.03, z - 0.07 + k * 0.03]);
  },
  tractor(kit, x, y, z) {
    // A model tractor, side on to the aisle: red body, cab, big wheels.
    kit.block('tractorRed', [x - 0.18, x + 0.12], [y + 0.07, y + 0.15], [z - 0.07, z + 0.07]);
    kit.block('tractorRed', [x - 0.18, x - 0.04], [y + 0.15, y + 0.28], [z - 0.07, z + 0.07]);
    kit.block('glass', [x - 0.17, x - 0.05], [y + 0.18, y + 0.26], [z - 0.072, z + 0.072]);
    kit.cylinder('iron', 0.01, 0.01, 0.1, x + 0.06, y + 0.15, z + 0.03, 5);
    for (const [wx, r] of [[-0.12, 0.085], [0.09, 0.05]]) {
      for (const sz of [-0.085, 0.085]) {
        const tyre = paint(new THREE.CylinderGeometry(r, r, 0.04, 12), kit.sw('tyre'));
        kit.parts.atlas.push(tyre.rotateX(Math.PI / 2).translate(x + wx, y + r, z + sz));
        const hub = paint(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.044, 8), kit.sw('tractorYellow'));
        kit.parts.atlas.push(hub.rotateX(Math.PI / 2).translate(x + wx, y + r, z + sz));
      }
    }
  },
  pesticide(kit, x, y, z) {
    // A knapsack sprayer: the tank, its pump, and the lance lying by it.
    kit.cylinder('sprayYellow', 0.09, 0.1, 0.28, x - 0.04, y, z, 10);
    kit.cylinder('iron', 0.03, 0.03, 0.03, x - 0.04, y + 0.28, z, 8);
    kit.block('iron', [x - 0.05, x - 0.03], [y + 0.31, y + 0.42], [z - 0.01, z + 0.01]);
    kit.block('iron', [x - 0.1, x + 0.02], [y + 0.42, y + 0.44], [z - 0.012, z + 0.012]);
    kit.block('galvDark', [x + 0.08, x + 0.12], [y, y + 0.02], [z - 0.2, z + 0.2]);
    const hose = paint(new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI), kit.sw('iron'));
    kit.parts.atlas.push(hose.rotateY(Math.PI / 2).translate(x + 0.04, y + 0.06, z + 0.13));
  },
  generic(kit, x, y, z) {
    kit.block('boxRed', [x - 0.15, x + 0.15], [y, y + 0.25], [z - 0.12, z + 0.12]);
  },
};

/* -------------------------------------------------------------------- */
/* The Bakery & Tea Room                                                 */
/* -------------------------------------------------------------------- */

/* A bakery with a tea room in it, the way market towns keep both under one
   roof: a glass counter of cakes across the back on the door's side, loaves
   on sloping racks behind it and the bakehouse through a doorway beyond,
   and on the other side — the side the table outside is on — two little
   tables with lace cloths and a dresser of china. Floral paper over white
   boarding, a navy and cream tiled floor in the shop's own blue.

   The room is 5.0 by 5.45, the door on the left of the frontage, the
   window to its right with a celebration cake in it. The way in is the
   open floor between the window and the counter, which the tea room opens
   off. Lit by wall lamps rather than hanging ones: a shade hung anywhere
   in a room this size hides a table or the counter from the camera. */
function bakery(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const front = -ROOM.wall;
  const { block, cylinder, solid, pane } = kit;

  // A loaf, a roll, a baguette: crust on a squashed or stretched solid.
  const loaf = (x, y, z, kind, seed) => {
    const shapes = {
      cob: { r: 0.09, s: [1, 0.7, 1] },
      roll: { r: 0.045, s: [1, 0.7, 1] },
      bloomer: { r: 0.07, s: [2.0, 0.75, 1] },
      baguette: { r: 0.035, s: [6.5, 0.8, 1] },
    }[kind];
    const g = paint(new THREE.IcosahedronGeometry(shapes.r, 1), kit.sw(seed % 3 ? 'crust' : 'crustDark'));
    g.scale(...shapes.s).rotateY((noise(seed) - 0.5) * 0.4);
    kit.parts.atlas.push(g.translate(x, y + shapes.r * shapes.s[1] * 0.8, z));
  };
  // A cake: a sponge, its icing, and a ring of piping on top.
  const cake = (x, y, z, r, h, icing, seed = 0) => {
    cylinder('flour', r, r, h * 0.7, x, y, z, 14);
    cylinder(icing, r * 1.02, r * 1.02, h * 0.3, x, y + h * 0.7, z, 14);
    const piping = paint(new THREE.TorusGeometry(r * 0.85, r * 0.08, 4, 12), kit.sw('icing'));
    kit.parts.atlas.push(piping.rotateX(Math.PI / 2).translate(x, y + h, z));
    if (seed % 2) kit.fruitAt('tomato', x, y + h, z, seed); // a cherry on top
  };

  // The window: a lace runner on a low shelf, baskets of bread, and a
  // three-tier cake on a stand in the middle.
  block('paint', [-0.85, maxX], [0, 0.42], [-0.74, front]);
  block('lace', [-0.82, maxX - 0.02], [0.42, 0.43], [-0.7, front - 0.02]);
  solid('window-display', [-0.85, maxX], [-0.76, front], 1.0);
  cylinder('china', 0.03, 0.05, 0.08, 0.85, 0.43, -0.42, 8);
  cylinder('china', 0.2, 0.2, 0.015, 0.85, 0.51, -0.42, 16);
  cake(0.85, 0.525, -0.42, 0.17, 0.14, 'icing');
  cake(0.85, 0.665, -0.42, 0.12, 0.12, 'pinkIcing');
  cake(0.85, 0.785, -0.42, 0.075, 0.1, 'icing', 1);
  for (const [x, kind] of [[-0.4, 'cob'], [1.7, 'bloomer'], [2.2, 'roll']]) {
    kit.cylinder('wicker', 0.2, 0.16, 0.12, x, 0.43, -0.4, 10, true);
    for (let k = 0; k < (kind === 'roll' ? 5 : 3); k += 1) {
      loaf(x + (k - 1) * (kind === 'roll' ? 0.07 : 0.1), 0.48, -0.4 + (k % 2) * 0.05, kind, k + 3);
    }
  }

  // Bread on a three-tier wicker stand down the left wall.
  const bz = [-3.3, -1.25];
  for (let t = 0; t < 3; t += 1) {
    const y = 0.45 + t * 0.35;
    const x0 = minX + 0.02 + t * 0.12;
    block('wood', [x0, minX + 0.42], [y - 0.03, y], bz);
    for (let z = bz[0] + 0.12; z < bz[1] - 0.08; z += t === 1 ? 0.3 : 0.2) {
      loaf(x0 + 0.17, y, z, ['cob', 'bloomer', 'roll'][t], Math.round(z * 31) + t);
    }
  }
  for (const z of bz) block('woodDark', [minX, minX + 0.42], [0, 1.2], [z - 0.02, z + 0.02]);
  solid('bread-stand', [minX, minX + 0.44], bz, 1.3);

  // The glass counter of cakes, across the back on the door's side.
  const cx = [minX, 0.55];
  const cz = [-4.05, -3.45];
  block('paint', cx, [0, 0.6], cz);
  for (let x = cx[0] + 0.1; x < cx[1] - 0.4; x += 0.6) block('cream', [x, x + 0.48], [0.1, 0.5], [cz[1], cz[1] + 0.012]);
  block('wood', [cx[0], cx[1]], [0.6, 0.63], cz);
  // Cakes in the case, then the glass over them.
  const caseX = [cx[0] + 0.04, cx[1] - 0.55];
  let k = 0;
  for (let x = caseX[0] + 0.16; x < caseX[1] - 0.1; x += 0.34) {
    k += 1;
    const icing = ['chocolate', 'pinkIcing', 'lemonIcing', 'icing'][k % 4];
    if (k % 3 === 0) {
      // A tray of iced buns.
      block('iron', [x - 0.13, x + 0.13], [0.63, 0.64], [-3.95, -3.6]);
      for (let b = 0; b < 4; b += 1) {
        const bx = x - 0.07 + (b % 2) * 0.14;
        const bz2 = -3.86 + Math.floor(b / 2) * 0.16;
        loaf(bx, 0.64, bz2, 'roll', b);
        cylinder(icing, 0.035, 0.04, 0.012, bx, 0.69, bz2, 8);
      }
    } else cake(x, 0.63, -3.75, 0.12, 0.11, icing, k);
  }
  pane([caseX[0], caseX[1]], [0.63, 1.02], [cz[1] - 0.02, cz[1]]);
  pane([caseX[0], caseX[1]], [1.0, 1.02], [cz[0] + 0.05, cz[1]]);
  for (const x of caseX) block('brass', [x - 0.012, x + 0.012], [0.63, 1.02], [cz[1] - 0.025, cz[1]]);
  // The till end of the counter, and a cake under a dome on it.
  block('wood', [caseX[1], cx[1]], [0.63, 0.95], cz);
  block('woodDark', [caseX[1] - 0.01, cx[1] + 0.01], [0.95, 0.98], [cz[0] - 0.01, cz[1] + 0.02]);
  kit.parts.atlas.push(placed(
    labelledBox(0.32, 0.18, 0.26, { front: kit.A.uv.till, back: kit.sw('iron') }, kit.sw('iron')), cx[1] - 0.22, 1.07, -3.8,
  ));
  solid('counter', cx, cz, 1.05);
  // A screen from the counter's end back to the wall, and behind it the
  // baker's side of the shop.
  block('woodDark', [0.68, 0.74], [0, 1.45], [back, cz[0]]);
  block('woodDark', [0.62, 0.8], [1.45, 1.5], [back, cz[0]]);
  solid('behind-counter', [minX, 0.76], [back, cz[0]], 1.5);

  // Loaves on sloping racks on the back wall, either side of the doorway.
  const racks = [[minX + 0.1, -0.65], [0.38, 0.62]];
  for (const [x0, x1] of racks) {
    for (const y of [0.95, 1.4, 1.85]) {
      const shelf = paint(new THREE.BoxGeometry(x1 - x0, 0.03, 0.36), kit.sw('wicker'));
      kit.parts.atlas.push(shelf.rotateX(0.32).translate((x0 + x1) / 2, y, back + 0.2));
      for (let x = x0 + 0.12; x < x1 - 0.06; x += 0.2) {
        loaf(x, y + 0.02, back + 0.22, y > 1.6 ? 'baguette' : (y > 1.2 ? 'cob' : 'bloomer'), Math.round(x * 17 + y * 5));
      }
    }
  }

  /* The bakehouse through the doorway: a brick oven with its mouth alight.
     Its walls are low on purpose. From the camera's 56 degrees, a ray
     over the top of the shop's back wall comes down to 0.9 by the time it
     is 1.2 behind it, and through the doorway it sees no higher than 0.2
     there — so anything taller at the back of the bakehouse stood up
     above the shop like a chimney, and none of it could be seen through
     the door anyway. */
  const [o0, o1, oh] = OPENINGS.bakery.back;
  block('woodDark', [o0 - 0.06, o0], [0, oh], [back - 0.02, back + 0.03]);
  block('woodDark', [o1, o1 + 0.06], [0, oh], [back - 0.02, back + 0.03]);
  block('woodDark', [o0 - 0.06, o1 + 0.06], [oh, oh + 0.08], [back - 0.02, back + 0.03]);
  block('soot', [o0 - 0.4, o1 + 0.4], [0, 0.01], [back - 1.2, back]);
  block('brickDark', [o0 - 0.4, o1 + 0.4], [0, 0.9], [back - 1.24, back - 1.2]);
  block('brick', [o0 - 0.25, o1 + 0.25], [0, 1.4], [back - 1.2, back - 0.75]);
  block('soot', [o0 + 0.05, o1 - 0.05], [0.5, 0.9], [back - 0.76, back - 0.74]);
  kit.glowBox([o0 + 0.12, o1 - 0.12], [0.55, 0.82], [back - 0.775, back - 0.755]);
  for (const x of [o0 - 0.4, o1 + 0.4]) block('brickDark', [x - 0.02, x + 0.02], [0, 0.9], [back - 1.2, back]);

  /* The tea room: two tables with lace cloths, two chairs at each, one by
     the window and one against the back wall under the menu, with the
     dresser between them on the side wall. The first layout had both
     tables in the middle of the floor and the dresser behind the second,
     and the second table's chairs met the counter's screen: the corner in
     front of the dresser was floor nobody could reach, which the test that
     floods every room from its door found. */
  const tables = [[1.5, -1.68], [1.65, -5.0]];
  tables.forEach(([x, z], i) => {
    cylinder('iron', 0.18, 0.2, 0.03, x, 0, z, 10);
    cylinder('iron', 0.025, 0.025, 0.7, x, 0.03, z, 6);
    cylinder('lace', 0.38, 0.38, 0.02, x, 0.72, z, 16);
    cylinder('lace', 0.385, 0.4, 0.16, x, 0.57, z, 16, true);
    for (const side of [-1, 1]) {
      const chx = x + side * 0.6;
      cylinder('woodDark', 0.17, 0.17, 0.04, chx, 0.44, z, 12);
      for (const [lx, lz] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]]) {
        block('woodDark', [chx + lx - 0.012, chx + lx + 0.012], [0, 0.44], [z + lz - 0.012, z + lz + 0.012]);
      }
      const bx = chx + side * 0.16;
      block('woodDark', [bx - 0.015, bx + 0.015], [0.48, 0.86], [z - 0.14, z + 0.14]);
      const hoop = paint(new THREE.TorusGeometry(0.13, 0.014, 4, 12, Math.PI), kit.sw('woodDark'));
      kit.parts.atlas.push(hoop.rotateY(Math.PI / 2).translate(bx, 0.86, z));
    }
    // Tea for two.
    const teapot = paint(new THREE.IcosahedronGeometry(0.075, 1), kit.sw(i ? 'chinaBlue' : 'china'));
    kit.parts.atlas.push(teapot.scale(1, 0.85, 1).translate(x - 0.06, 0.8, z - 0.08));
    const spout = paint(new THREE.CylinderGeometry(0.01, 0.018, 0.1, 6), kit.sw(i ? 'chinaBlue' : 'china'));
    kit.parts.atlas.push(spout.rotateZ(-0.9).translate(x + 0.03, 0.82, z - 0.08));
    for (const side of [-1, 1]) {
      cylinder('china', 0.055, 0.055, 0.008, x + side * 0.2, 0.74, z + 0.06, 10);
      cylinder('chinaBlue', 0.03, 0.025, 0.045, x + side * 0.2, 0.748, z + 0.06, 8);
    }
    if (i === 1) {
      // A cake stand: three plates on a rod, cakes and scones on them.
      cylinder('brass', 0.008, 0.008, 0.34, x + 0.12, 0.74, z + 0.12, 5);
      [0.1, 0.08, 0.06].forEach((r, t) => {
        const y = 0.76 + t * 0.12;
        cylinder('china', r, r, 0.008, x + 0.12, y, z + 0.12, 12);
        for (let c = 0; c < 3; c += 1) {
          const a = (c / 3) * Math.PI * 2 + t;
          loaf(x + 0.12 + Math.cos(a) * r * 0.55, y + 0.008, z + 0.12 + Math.sin(a) * r * 0.55, 'roll', c + t * 3);
        }
      });
    } else {
      cylinder('china', 0.02, 0.025, 0.08, x + 0.14, 0.74, z + 0.1, 6);
      kit.fruitAt('tomato', x + 0.14, 0.82, z + 0.1, 3);
    }
    solid(`tea-table-${i + 1}`, [x - 0.8, x + 0.8], [z - 0.4, z + 0.4], 0.9);
  });

  // The dresser on the right-hand wall, between the tables: a cupboard,
  // and open shelves of plates and cups above it.
  const dz = [-3.9, -2.7];
  const dx = [maxX - 0.44, maxX];
  block('paint', dx, [0, 0.85], dz);
  block('wood', [dx[0] - 0.02, dx[1]], [0.85, 0.89], [dz[0] - 0.02, dz[1] + 0.02]);
  block('paint', [dx[1] - 0.04, dx[1]], [0.89, 2.1], dz);
  for (const z of dz) block('paint', [dx[0] + 0.12, dx[1]], [0.89, 2.1], [z - 0.02, z + 0.02]);
  block('paint', [dx[0] + 0.1, dx[1]], [2.1, 2.16], [dz[0] - 0.03, dz[1] + 0.03]);
  for (const y of [1.3, 1.7]) block('wood', [dx[0] + 0.14, dx[1]], [y - 0.02, y], dz);
  for (const y of [0.89, 1.3, 1.7]) {
    for (let z = dz[0] + 0.15; z < dz[1] - 0.1; z += 0.2) {
      const plate = paint(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 14), kit.sw('china'));
      kit.parts.atlas.push(plate.rotateZ(Math.PI / 2 - 0.25).translate(dx[1] - 0.09, y + 0.1, z));
      const rim = paint(new THREE.TorusGeometry(0.075, 0.008, 3, 14), kit.sw('chinaBlue'));
      kit.parts.atlas.push(rim.rotateY(Math.PI / 2).rotateZ(-0.25).translate(dx[1] - 0.085, y + 0.1, z));
    }
  }
  solid('dresser', [dx[0] - 0.02, maxX], [dz[0] - 0.02, dz[1] + 0.02], 2.16);

  // The tea room's menu on the back wall.
  kit.parts.atlas.push(placed(
    labelledBox(0.95, 0.76, 0.03, { front: kit.A.uv.teaboard, back: kit.sw('woodDark') }, kit.sw('woodDark')),
    1.35, 1.75, back + 0.02,
  ));

  // Wall lamps: one by each table, one by the bread.
  const sconces = [[maxX, -1.68, -1], [maxX, -4.55, -1], [minX, -2.3, 1]];
  for (const [x, z, side] of sconces) {
    const lx = x + side * 0.16;
    block('brass', [Math.min(x, x + side * 0.12), Math.max(x, x + side * 0.12)], [1.86, 1.89], [z - 0.015, z + 0.015]);
    cylinder('pinkIcing', 0.05, 0.1, 0.12, lx, 1.84, z, 10, true);
    kit.bulb(lx, 1.86, z, 0.04);
  }

  return {
    keeper: {
      x: -1.2, z: -4.75, figure: 'female',
      look: { shirt: 0xf4f1ea, apron: 0x2a3f6b, trousers: 0x3a3a3e, hair: 0xc9a25a },
    },
    /* Each wall lamp's light a long step out from its wall rather than at
       the bulb, and dimmer than a hanging lamp's: at the bulb, a third of
       a unit off the paper, it burned a white disc into the wallpaper. */
    lamps: [...sconces.map(([x, z, side]) => [x + side * 0.8, 1.9, z]), [(o0 + o1) / 2, 0.75, back - 0.5]],
    lampPower: 0.6,
    counter: { x: -1.0, z: -3.15 },
    greeting: (hour) => `🥐 “${hello(hour)}! The bread's still warm — and there's a pot of tea on, if you'd like to sit.”`,
  };
}

/* -------------------------------------------------------------------- */
/* The Café                                                              */
/* -------------------------------------------------------------------- */

/* The café takes the single-storey half of the dining block, the
   Restaurant the taller half; a party wall runs between them halfway
   across the gap between their frontages, so this room is 4.6 by 5.45.
   The door is in the middle. Its tables stand along the windows either
   side of it, the way its tables outside do, a third by a leather
   banquette down the left wall; the counter is across the back with the
   espresso machine and the cakes under a glass dome, the menu over it.

   Lit by bare bulbs on long cords: a bulb is a few centimetres across, so
   unlike a shade it hides nothing from the camera. */
function cafe(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const front = -ROOM.wall;
  const { block, cylinder, solid } = kit;

  // A café table for two: a marble top on an iron stand, a bentwood chair
  // either side across it.
  const table = (x, z, id, chairs = [-1, 1]) => {
    cylinder('iron', 0.17, 0.2, 0.03, x, 0, z, 10);
    cylinder('iron', 0.022, 0.022, 0.7, x, 0.03, z, 6);
    cylinder('marble', 0.3, 0.3, 0.03, x, 0.72, z, 16);
    for (const side of chairs) {
      const cx = x + side * 0.5;
      cylinder('woodDark', 0.16, 0.16, 0.04, cx, 0.44, z, 12);
      for (const [lx, lz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) {
        block('woodDark', [cx + lx - 0.012, cx + lx + 0.012], [0, 0.44], [z + lz - 0.012, z + lz + 0.012]);
      }
      const bx = cx + side * 0.15;
      block('woodDark', [bx - 0.015, bx + 0.015], [0.48, 0.84], [z - 0.13, z + 0.13]);
      const hoop = paint(new THREE.TorusGeometry(0.12, 0.013, 4, 12, Math.PI), kit.sw('woodDark'));
      kit.parts.atlas.push(hoop.rotateY(Math.PI / 2).translate(bx, 0.84, z));
    }
    // A cup and saucer at each place, and a sugar bowl.
    for (const side of chairs) {
      cylinder('china', 0.05, 0.05, 0.006, x + side * 0.14, 0.75, z, 10);
      cylinder('china', 0.03, 0.024, 0.05, x + side * 0.14, 0.756, z, 8);
      cylinder('espresso', 0.026, 0.026, 0.004, x + side * 0.14, 0.802, z, 8);
    }
    cylinder('chromeDark', 0.03, 0.03, 0.05, x, 0.75, z - 0.12, 8);
    const reach = chairs.length > 1 ? 0.7 : 0.35;
    const x0 = chairs.includes(-1) ? x - reach : x - 0.33;
    const x1 = chairs.includes(1) ? x + reach : x + 0.33;
    solid(id, [x0, x1], [z - 0.33, z + 0.33], 0.9);
  };

  // At the windows, either side of the door.
  table(-1.35, -0.95, 'window-table-left');
  table(1.45, -0.95, 'window-table-right');
  // A leather banquette down the left wall, and the third table at it.
  const bz = [-3.55, -2.05];
  block('woodDark', [minX, minX + 0.5], [0, 0.42], bz);
  block('leather', [minX, minX + 0.48], [0.42, 0.5], [bz[0] + 0.02, bz[1] - 0.02]);
  block('leather', [minX, minX + 0.1], [0.5, 1.0], [bz[0] + 0.02, bz[1] - 0.02]);
  for (let z = bz[0] + 0.25; z < bz[1]; z += 0.5) block('woodDark', [minX + 0.1, minX + 0.12], [0.5, 1.0], [z - 0.01, z + 0.01]);
  solid('banquette', [minX, minX + 0.52], bz, 1.0);
  table(minX + 0.88, -2.8, 'banquette-table', [1]);

  // The counter across the back, with the barista behind it.
  const cx = [-0.85, maxX];
  const cz = [-4.6, -4.0];
  block('paint', cx, [0, 0.92], cz);
  for (let x = cx[0] + 0.1; x < cx[1] - 0.45; x += 0.6) block('cream', [x, x + 0.48], [0.12, 0.8], [cz[1], cz[1] + 0.012]);
  block('marble', [cx[0] - 0.03, cx[1]], [0.92, 0.96], [cz[0] - 0.02, cz[1] + 0.05]);
  solid('counter', cx, cz, 0.96);
  solid('behind-counter', [cx[0], maxX], [back, cz[0]], 0.96);
  // The espresso machine: a chrome body, two group heads, cups warming on
  // top, and the grinder beside it.
  {
    const x = 1.25;
    const z = -4.4;
    block('chrome', [x - 0.3, x + 0.3], [0.96, 1.32], [z - 0.17, z + 0.15]);
    block('paint', [x - 0.3, x + 0.3], [1.1, 1.2], [z + 0.15, z + 0.16]);
    for (const gx of [-0.13, 0.13]) {
      block('chromeDark', [x + gx - 0.04, x + gx + 0.04], [1.02, 1.06], [z + 0.15, z + 0.24]);
      cylinder('china', 0.03, 0.025, 0.05, x + gx, 0.96, z + 0.22, 8);
    }
    for (let k = 0; k < 5; k += 1) cylinder('china', 0.03, 0.025, 0.045, x - 0.22 + k * 0.11, 1.32, z - 0.02, 8);
    cylinder('chromeDark', 0.07, 0.08, 0.2, x + 0.48, 0.96, z, 10);
    const hopper = paint(new THREE.CylinderGeometry(0.09, 0.04, 0.16, 10), kit.sw('glass'));
    kit.parts.atlas.push(hopper.translate(x + 0.48, 1.24, z));
    cylinder('espresso', 0.075, 0.035, 0.08, x + 0.48, 1.2, z, 10);
  }
  // Cakes under a glass dome at the counter's end, and a stack of cups.
  cylinder('china', 0.02, 0.05, 0.06, -0.45, 0.96, -4.3, 8);
  cylinder('china', 0.2, 0.2, 0.012, -0.45, 1.02, -4.3, 16);
  cylinder('flour', 0.15, 0.15, 0.08, -0.45, 1.032, -4.3, 14);
  cylinder('chocolate', 0.152, 0.152, 0.03, -0.45, 1.112, -4.3, 14);
  const dome = new THREE.SphereGeometry(0.2, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  kit.parts.glass.push(dome.translate(-0.45, 1.032, -4.3));
  for (let k = 0; k < 4; k += 1) cylinder('china', 0.045, 0.035, 0.05, 0.25, 0.96 + k * 0.05, -4.35, 10, true);
  // Bags of beans on a shelf behind, and the menu over it all.
  block('wood', [cx[0] + 0.2, maxX - 0.05], [1.45, 1.48], [back, back + 0.28]);
  for (let x = cx[0] + 0.32; x < maxX - 0.15; x += 0.26) {
    kit.parts.atlas.push(placed(
      labelledBox(0.15, 0.22, 0.1, { front: kit.A.uv.coffeebag, back: kit.sw('espresso') }, kit.sw('espresso')),
      x, 1.59, back + 0.12,
    ));
  }
  kit.parts.atlas.push(placed(
    labelledBox(1.75, 1.0, 0.03, { front: kit.A.uv.cafeboard, back: kit.sw('woodDark') }, kit.sw('woodDark')),
    0.75, 2.12, back + 0.02,
  ));

  // The corner left of the counter: a tall fig in a pot, and a shelf of
  // jars of biscuits.
  cylinder('pot', 0.2, 0.15, 0.36, minX + 0.4, 0, back + 0.42, 12);
  for (let k = 0; k < 7; k += 1) {
    const a = (k / 7) * Math.PI * 2;
    const leaf = paint(new THREE.IcosahedronGeometry(0.17, 0), kit.sw(k % 2 ? 'fig' : 'leaf'));
    kit.parts.atlas.push(leaf.scale(1, 1.3, 1).translate(minX + 0.4 + Math.cos(a) * 0.14, 0.95 + (k % 3) * 0.3, back + 0.42 + Math.sin(a) * 0.14));
  }
  kit.cylinder('woodDark', 0.02, 0.025, 0.9, minX + 0.4, 0.36, back + 0.42, 5);
  solid('fig', [minX, minX + 0.7], [back, back + 0.75], 1.8);
  block('wood', [minX + 0.8, cx[0] - 0.1], [0.8, 0.84], [back, back + 0.3]);
  for (const x of [minX + 0.95, minX + 1.2]) {
    cylinder('glass', 0.06, 0.06, 0.18, x, 0.84, back + 0.15, 10);
    cylinder('crust', 0.05, 0.05, 0.08, x, 0.86, back + 0.15, 10);
  }
  block('woodDark', [minX + 0.8, cx[0] - 0.1], [0, 0.8], [back, back + 0.3]);
  solid('biscuit-shelf', [minX + 0.78, cx[0] - 0.08], [back, back + 0.32], 0.9);

  // The newspaper rack on the right-hand wall, and a plant by it.
  block('woodDark', [maxX - 0.12, maxX], [0.3, 1.2], [-2.75, -2.05]);
  for (const y of [0.45, 0.75, 1.05]) {
    block('woodDark', [maxX - 0.2, maxX - 0.12], [y - 0.1, y], [-2.75, -2.05]);
    kit.parts.atlas.push(placed(
      labelledBox(0.6, 0.18, 0.02, { front: kit.A.uv.papers, back: kit.sw('newsprint') }, kit.sw('newsprint')),
      maxX - 0.17, y + 0.04, -2.4, -Math.PI / 2,
    ));
  }
  solid('papers', [maxX - 0.22, maxX], [-2.75, -2.05], 1.2);
  cylinder('pot', 0.16, 0.12, 0.3, maxX - 0.25, 0, -3.2, 12);
  for (let k = 0; k < 5; k += 1) {
    const leaf = paint(new THREE.ConeGeometry(0.05, 0.5, 4), kit.sw(k % 2 ? 'fig' : 'leaf'));
    kit.parts.atlas.push(leaf.rotateZ((k - 2) * 0.25).rotateX((k % 2 ? 0.2 : -0.2)).translate(maxX - 0.25, 0.52, -3.2));
  }
  solid('plant', [maxX - 0.45, maxX], [-3.42, -2.98], 0.8);

  // Bare bulbs on long cords: over each table, and over the counter.
  const bulbs = [[-1.35, -0.95, 2.05], [1.45, -0.95, 2.05], [minX + 0.88, -2.8, 1.95], [0.2, -3.6, 2.1], [1.4, -3.4, 2.15]];
  for (const [x, z, y] of bulbs) {
    block('cord', [x - 0.006, x + 0.006], [y + 0.06, ROOM.height], [z - 0.006, z + 0.006]);
    block('brass', [x - 0.02, x + 0.02], [y + 0.04, y + 0.08], [z - 0.02, z + 0.02]);
    kit.bulb(x, y, z, 0.045);
  }

  return {
    keeper: {
      x: 0.6, z: -5.0, figure: 'female',
      look: { shirt: 0x2b2b2e, apron: 0x165550, trousers: 0x2b2b2e, hair: 0x2a1c14 },
    },
    lamps: [[-0.2, 2.0, -1.4], [0.9, 2.05, -3.6]],
    counter: { x: 0.6, z: -3.65 },
    greeting: (hour) => `☕ “${hello(hour)}! Coffee's on — sit anywhere you like.”`,
  };
}

/* -------------------------------------------------------------------- */
/* The Restaurant                                                        */
/* -------------------------------------------------------------------- */

/* The taller half of the dining block, the other side of the Café's party
   wall: 4.9 by 5.45, the door in the middle. A dining room in the shop's
   burgundy and gold over dark panelling, on a patterned carpet: four
   tables for two with white cloths, down either side of an aisle from the
   door to a little bar at the back. Behind the bar a hatch through to the
   kitchen, where a pot is on and the steam climbs out over the wall; a rack
   of wine in the corner; paintings of the town round the walls; a stand by
   the door with the bookings in it.

   The candles on the tables are lit at dusk and flicker. The chandelier
   hangs over the aisle near the door, which is the one place a light that
   size can hang in here without hiding a table from the camera: what it
   hides is the aisle behind it. */
function restaurant(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const front = -ROOM.wall;
  const { block, cylinder, solid } = kit;
  const candles = [];

  // A table for two: a white cloth to the floor, two chairs facing across
  // it, a candle, two places laid.
  const table = (x, z, id) => {
    block('linen', [x - 0.36, x + 0.36], [0.72, 0.75], [z - 0.36, z + 0.36]);
    block('linen', [x - 0.37, x + 0.37], [0.1, 0.72], [z - 0.37, z + 0.37]);
    for (const side of [-1, 1]) {
      const cz = z + side * 0.56;
      block('woodDark', [x - 0.19, x + 0.19], [0.44, 0.49], [cz - 0.18, cz + 0.18]);
      block('paint', [x - 0.17, x + 0.17], [0.49, 0.52], [cz - 0.16, cz + 0.16]);
      for (const [lx, lz] of [[-0.16, -0.15], [0.16, -0.15], [-0.16, 0.15], [0.16, 0.15]]) {
        block('woodDark', [x + lx - 0.015, x + lx + 0.015], [0, 0.44], [cz + lz - 0.015, cz + lz + 0.015]);
      }
      const bz = cz + side * 0.17;
      block('woodDark', [x - 0.19, x + 0.19], [0.49, 1.05], [bz - 0.02, bz + 0.02]);
      block('paint', [x - 0.14, x + 0.14], [0.6, 0.95], [bz - side * 0.025, bz - side * 0.02]);
      // A place laid: plate, napkin, glass.
      const pz = z + side * 0.2;
      cylinder('china', 0.11, 0.11, 0.008, x, 0.75, pz, 14);
      block('paint', [x - 0.04, x + 0.04], [0.758, 0.77], [pz - 0.06, pz + 0.06]);
      cylinder('glass', 0.025, 0.02, 0.09, x + 0.15, 0.75, pz, 8);
    }
    // The candle, in a silver stick, and its flame.
    cylinder('silver', 0.03, 0.04, 0.02, x, 0.75, z, 10);
    cylinder('silver', 0.012, 0.012, 0.06, x, 0.77, z, 6);
    cylinder('candle', 0.012, 0.012, 0.14, x, 0.83, z, 8);
    kit.flame(x, 0.97, z);
    candles.push([x, 0.97, z]);
    solid(id, [x - 0.4, x + 0.4], [z - 0.78, z + 0.78], 1.05);
  };
  table(-1.45, -1.75, 'table-1');
  table(1.45, -1.75, 'table-2');
  table(-1.45, -3.5, 'table-3');
  table(1.45, -3.5, 'table-4');

  // The booking stand, just inside the door on the left.
  block('woodDark', [-0.95, -0.6], [0, 1.0], [-0.55, -0.25]);
  const book = topLabelled(0.34, 0.02, 0.24, kit.A.uv.booking, kit.sw('paint'));
  kit.parts.atlas.push(book.rotateX(0.3).translate(-0.775, 1.04, -0.4));
  cylinder('brass', 0.02, 0.02, 0.2, -0.66, 1.0, -0.3, 6);
  kit.bulb(-0.66, 1.24, -0.3, 0.03);
  solid('booking-stand', [-0.97, -0.58], [-0.57, front], 1.25);

  // The bar at the back, from the aisle to the wall, the hatch behind it.
  const cx = [-0.35, maxX];
  const cz = [-4.95, -4.4];
  block('woodDark', cx, [0, 1.0], cz);
  for (let x = cx[0] + 0.1; x < cx[1] - 0.45; x += 0.6) block('paint', [x, x + 0.48], [0.14, 0.86], [cz[1], cz[1] + 0.012]);
  block('brass', [cx[0], cx[1]], [0.12, 0.15], [cz[1] + 0.05, cz[1] + 0.08]);
  block('wood', [cx[0] - 0.03, cx[1]], [1.0, 1.05], [cz[0] - 0.02, cz[1] + 0.05]);
  solid('bar', cx, cz, 1.05);
  solid('behind-bar', [cx[0], maxX], [back, cz[0]], 1.05);
  // Bottles and glasses along the bar's back shelf, either side of the hatch.
  const [h0, h1, hTop, hSill] = OPENINGS.restaurant.back;
  for (const [x0, x1] of [[cx[0] + 0.1, h0 - 0.08], [h1 + 0.08, maxX - 0.05]]) {
    if (x1 - x0 < 0.2) continue;
    for (const y of [1.15, 1.55]) {
      block('woodDark', [x0, x1], [y - 0.03, y], [back, back + 0.22]);
      for (let x = x0 + 0.07; x < x1 - 0.04; x += 0.1) {
        cylinder(['bottle', 'wine', 'bottle'][((Math.round(x * 10) % 3) + 3) % 3], 0.03, 0.03, 0.2, x, y, back + 0.11, 8);
        cylinder('bottle', 0.012, 0.012, 0.06, x, y + 0.2, back + 0.11, 6);
      }
    }
  }
  // The hatch: a frame, a pass shelf with plates going out, and the
  // kitchen behind — a stove with a pot on it, steaming.
  block('woodDark', [h0 - 0.05, h1 + 0.05], [hSill - 0.03, hSill + 0.02], [back - 0.15, back + 0.12]);
  block('woodDark', [h0 - 0.05, h1 + 0.05], [hTop, hTop + 0.06], [back - 0.02, back + 0.03]);
  for (const x of [h0, h1]) block('woodDark', [x - 0.05, x], [hSill, hTop], [back - 0.02, back + 0.03]);
  for (const x of [h0 + 0.3, h0 + 0.7]) {
    cylinder('china', 0.11, 0.11, 0.01, x, hSill + 0.02, back - 0.02, 14);
    kit.fruitAt('tomato', x, hSill + 0.03, back - 0.02, Math.round(x * 9));
  }
  block('soot', [h0 - 0.3, h1 + 0.3], [0, 0.01], [back - 1.1, back]);
  block('steel', [h0 - 0.1, h1 + 0.1], [0, 0.88], [back - 0.75, back - 0.3]);
  block('iron', [h0, h1], [0.88, 0.9], [back - 0.7, back - 0.35]);
  const potX = (h0 + h1) / 2;
  const potZ = back - 0.52;
  cylinder('steel', 0.14, 0.13, 0.2, potX, 0.9, potZ, 12);
  kit.glowBox([potX - 0.12, potX + 0.12], [0.89, 0.9], [potZ - 0.12, potZ + 0.12]);
  for (const x of [h0 - 0.3, h1 + 0.3]) block('brickDark', [x - 0.02, x + 0.02], [0, 0.9], [back - 1.1, back]);
  block('brickDark', [h0 - 0.3, h1 + 0.3], [0, 0.9], [back - 1.14, back - 1.1]);

  // Wine in a rack in the back-left corner: bottles lying in a lattice.
  const wx = [minX + 0.05, cx[0] - 0.35];
  block('woodDark', wx, [0, 1.7], [back, back + 0.3]);
  for (let y = 0.12; y < 1.6; y += 0.16) {
    for (let x = wx[0] + 0.08; x < wx[1] - 0.05; x += 0.13) {
      const bottle = paint(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 8), kit.sw(Math.round(x * 7 + y * 11) % 3 ? 'bottle' : 'wine'));
      kit.parts.atlas.push(bottle.rotateX(Math.PI / 2).translate(x, y + 0.04, back + 0.26));
    }
  }
  solid('wine-rack', [wx[0] - 0.05, wx[1] + 0.02], [back, back + 0.33], 1.7);

  // Paintings round the walls: the fields and the hall on the left, the
  // sea on the right.
  const frame = kit.sw('brass');
  kit.parts.atlas.push(placed(
    labelledBox(0.72, 0.54, 0.03, { front: kit.A.uv['picture:fields'], back: frame }, frame), minX + 0.015, 1.75, -1.75, Math.PI / 2,
  ));
  kit.parts.atlas.push(placed(
    labelledBox(0.72, 0.54, 0.03, { front: kit.A.uv['picture:hall'], back: frame }, frame), minX + 0.015, 1.75, -3.5, Math.PI / 2,
  ));
  kit.parts.atlas.push(placed(
    labelledBox(0.72, 0.54, 0.03, { front: kit.A.uv['picture:harbour'], back: frame }, frame), maxX - 0.015, 1.75, -2.6, -Math.PI / 2,
  ));

  // The chandelier: a brass ring of candles and drops of glass, over the
  // aisle by the door.
  const chX = 0;
  const chZ = -1.3;
  const chY = 2.2;
  block('brass', [chX - 0.01, chX + 0.01], [chY + 0.05, ROOM.height], [chZ - 0.01, chZ + 0.01]);
  const ring = paint(new THREE.TorusGeometry(0.3, 0.02, 5, 20), kit.sw('brass'));
  kit.parts.atlas.push(ring.rotateX(Math.PI / 2).translate(chX, chY, chZ));
  cylinder('brass', 0.05, 0.02, 0.12, chX, chY - 0.04, chZ, 8);
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * Math.PI * 2;
    const x = chX + Math.cos(a) * 0.3;
    const z = chZ + Math.sin(a) * 0.3;
    cylinder('candle', 0.014, 0.014, 0.1, x, chY + 0.02, z, 6);
    kit.bulb(x, chY + 0.15, z, 0.025);
    kit.pane([x - 0.012, x + 0.012], [chY - 0.12, chY - 0.02], [z - 0.012, z + 0.012]);
  }

  return {
    keeper: { x: 0.9, z: -5.2, look: { shirt: 0xf4f1ea, apron: 0x1d1d1f, trousers: 0x1d1d1f, hair: 0x2a1c14, beard: false } },
    // The chandelier first: it is the room's lamp, steady, and the one the
    // tests compare day and night by.
    lamps: [[chX, chY + 0.1, chZ], [0.6, 2.0, -4.0]],
    candles,
    steam: [potX, 1.1, potZ],
    counter: { x: 0.25, z: -4.1 },
    greeting: (hour) => `🍷 “${hello(hour)}! A table for one? Right this way.”`,
  };
}

/* -------------------------------------------------------------------- */
/* The Pharmacy                                                          */
/* -------------------------------------------------------------------- */

/* The one shop on the south side of High Street, so the one room built
   turned round: its street is to the north, and the camera looks in from
   there. 4.8 by 4.8, the door on the left of the frontage as the shop
   sees it, between the two planters outside.

   A chemist's as they were: white over pale mint boarding on a mint and
   white tiled floor; shelves of boxes and bottles floor to ceiling down
   both walls; a long white counter at the back with the pharmacist behind
   it, a hatch through to the dispensary under PRESCRIPTIONS and the green
   cross; the big coloured glass carboys in the window; a weighing machine
   in the corner, a spinner of plasters and a gondola of soap down the
   middle. Lit bright and cool by tubes along the tops of the walls, which
   hang in nobody's way. */
function pharmacy(kit, spec) {
  const { minX, maxX, back } = spec.room;
  const front = -ROOM.wall;
  const { block, cylinder, solid } = kit;

  // The window: a white plinth, three carboys of coloured liquid in clear
  // glass on stands, a pestle and mortar, boxes of scent.
  block('pill', [-0.8, maxX], [0, 0.4], [-0.7, front]);
  block('medGreen', [-0.8, maxX], [0.38, 0.4], [-0.72, front + 0.02]);
  solid('window-display', [-0.8, maxX], [-0.72, front], 1.2);
  [[-0.2, 'carboyRed'], [0.85, 'carboyGreen'], [1.9, 'carboyBlue']].forEach(([x, colour], i) => {
    const z = -0.38;
    cylinder('brass', 0.06, 0.1, 0.08, x, 0.4, z, 10);
    const liquid = paint(new THREE.IcosahedronGeometry(0.17, 1), kit.sw(colour));
    kit.parts.atlas.push(liquid.scale(1, 1.15 - i * 0.05, 1).translate(x, 0.67, z));
    const shell = new THREE.IcosahedronGeometry(0.2, 2);
    kit.parts.glass.push(shell.scale(1, 1.15 - i * 0.05, 1).translate(x, 0.68, z));
    kit.pane([x - 0.04, x + 0.04], [0.88, 1.02], [z - 0.04, z + 0.04]);
    cylinder('cream', 0.05, 0.04, 0.04, x, 1.02, z, 8);
  });
  cylinder('stone', 0.08, 0.06, 0.08, 0.35, 0.4, -0.45, 10, true);
  block('woodLight', [0.33, 0.37], [0.42, 0.6], [-0.45, -0.41]);
  for (const x of [1.35, 1.45, 1.55]) block(x === 1.45 ? 'carboyRed' : 'pill', [x - 0.04, x + 0.04], [0.4, 0.55], [-0.5, -0.42]);

  // Shelves floor to ceiling down both walls.
  const shelfZ = [-3.2, -0.95];
  for (const [x0, x1, face] of [[minX, minX + 0.36, 1], [maxX - 0.36, maxX, -1]]) {
    block('pill', [x0, x1], [0, 0.3], shelfZ);
    for (const z of shelfZ) block('pill', [x0, x1], [0, 2.35], [z - 0.02, z + 0.02]);
    block('pill', face > 0 ? [x0, x0 + 0.03] : [x1 - 0.03, x1], [0.3, 2.35], shelfZ);
    let k = 0;
    for (const y of [0.3, 0.72, 1.14, 1.56, 1.98]) {
      block('pill', [x0, x1], [y - 0.03, y], shelfZ);
      for (let z = shelfZ[0] + 0.12; z < shelfZ[1] - 0.08; z += 0.16) {
        k += 1;
        const cx = (x0 + x1) / 2 + face * 0.03;
        if (k % 3 === 0) {
          cylinder(k % 2 ? 'bottleBrown' : 'bottleBlue', 0.045, 0.045, 0.16, cx, y, z, 8);
          cylinder('pill', 0.02, 0.02, 0.04, cx, y + 0.16, z, 6);
        } else {
          kit.parts.atlas.push(placed(
            labelledBox(0.12, 0.2 + (k % 2) * 0.04, 0.14, { front: kit.A.uv.medbox, back: kit.sw('pill') }, kit.sw('pill')),
            cx, y + 0.1 + (k % 2) * 0.02, z, face > 0 ? Math.PI / 2 : -Math.PI / 2,
          ));
        }
      }
    }
    solid(face > 0 ? 'shelves-left' : 'shelves-right', [x0, x1], shelfZ, 2.35);
  }

  // A spinner of plasters, and a gondola of soap and toiletries.
  cylinder('silver', 0.2, 0.22, 0.04, -0.9, 0, -2.1, 12);
  cylinder('silver', 0.02, 0.02, 1.4, -0.9, 0.04, -2.1, 6);
  for (const y of [0.6, 0.95, 1.3]) {
    for (let k = 0; k < 6; k += 1) {
      const a = (k / 6) * Math.PI * 2 + y;
      const box = paint(new THREE.BoxGeometry(0.1, 0.14, 0.02), kit.sw(k % 2 ? 'plaster' : 'pill'));
      kit.parts.atlas.push(box.rotateY(a).translate(-0.9 + Math.sin(a) * 0.14, y, -2.1 + Math.cos(a) * 0.14));
    }
  }
  solid('plaster-spinner', [-1.15, -0.65], [-2.35, -1.85], 1.5);
  const gx = [0.35, 1.3];
  const gz = [-2.7, -1.65];
  block('pill', gx, [0, 1.1], [(gz[0] + gz[1]) / 2 - 0.03, (gz[0] + gz[1]) / 2 + 0.03]);
  for (const y of [0.15, 0.5, 0.85]) {
    block('pill', gx, [y - 0.02, y], gz);
    for (let x = gx[0] + 0.08; x < gx[1] - 0.04; x += 0.12) {
      for (const side of [-1, 1]) {
        const z = (gz[0] + gz[1]) / 2 + side * 0.25;
        block(['carboyBlue', 'mint', 'pinkIcing', 'lemonIcing'][Math.round(x * 13 + y * 7) % 4], [x - 0.04, x + 0.04], [y, y + 0.1], [z - 0.06, z + 0.06]);
      }
    }
  }
  solid('gondola', gx, gz, 1.1);

  // The weighing machine in the back corner, on the door's side.
  const sx = minX + 0.38;
  const sz = back + 0.36;
  block('scaleRed', [sx - 0.25, sx + 0.25], [0, 0.1], [sz - 0.25, sz + 0.25]);
  block('iron', [sx - 0.2, sx + 0.2], [0.1, 0.12], [sz - 0.2, sz + 0.2]);
  block('scaleRed', [sx - 0.06, sx + 0.06], [0.1, 1.4], [sz - 0.24, sz - 0.12]);
  kit.parts.atlas.push(placed(
    labelledBox(0.32, 0.32, 0.06, { front: kit.A.uv.scaledial, back: kit.sw('scaleRed') }, kit.sw('scaleRed')), sx, 1.55, sz - 0.15,
  ));
  solid('weighing-machine', [minX, sx + 0.27], [back, sz + 0.27], 1.75);

  // The counter across the back, the pharmacist behind it.
  const cx = [minX + 0.9, maxX];
  const cz = [-3.9, -3.35];
  block('pill', cx, [0, 0.95], cz);
  block('medGreen', cx, [0.1, 0.18], [cz[1], cz[1] + 0.012]);
  block('medGreen', [cx[0] - 0.02, cx[1]], [0.95, 0.99], [cz[0] - 0.02, cz[1] + 0.04]);
  solid('counter', cx, cz, 0.99);
  solid('behind-counter', [sx + 0.27, maxX], [back, cz[0]], 0.99);
  // A till, a basket of lozenges, a stand of leaflets.
  kit.parts.atlas.push(placed(
    labelledBox(0.3, 0.12, 0.24, { front: kit.A.uv.medbox, back: kit.sw('pill') }, kit.sw('pill')), 1.8, 1.05, -3.65,
  ));
  kit.basket(-0.5, 0.99, -3.6, 0.12, 'lemon');
  block('medGreen', [0.3, 0.5], [0.99, 1.25], [-3.62, -3.58]);
  for (let k = 0; k < 3; k += 1) block('pill', [0.31 + k * 0.06, 0.36 + k * 0.06], [1.02, 1.2], [-3.58, -3.57]);

  // The dispensary through the hatch: a shelf of bottles on its far wall,
  // low enough that only the hatch shows it.
  const [h0, h1, hTop, hSill] = OPENINGS.pharmacy.back;
  block('pill', [h0 - 0.05, h1 + 0.05], [hSill - 0.03, hSill + 0.02], [back - 0.12, back + 0.1]);
  block('medGreen', [h0 - 0.05, h1 + 0.05], [hTop, hTop + 0.05], [back - 0.02, back + 0.03]);
  for (const x of [h0, h1]) block('medGreen', [x - 0.05, x], [hSill, hTop], [back - 0.02, back + 0.03]);
  block('pill', [h0 - 0.3, h1 + 0.3], [0, 1.4], [back - 0.6, back - 0.55]);
  for (const y of [0.55, 0.85]) {
    block('pill', [h0 - 0.2, h1 + 0.2], [y - 0.02, y], [back - 0.55, back - 0.38]);
    for (let x = h0 - 0.12; x < h1 + 0.15; x += 0.1) {
      cylinder(Math.round(x * 10) % 2 ? 'bottleBrown' : 'bottleBlue', 0.03, 0.03, 0.12, x, y, back - 0.47, 8);
    }
  }
  for (const x of [h0 - 0.3, h1 + 0.3]) block('pill', [x - 0.02, x + 0.02], [0, 1.4], [back - 0.6, back]);
  // PRESCRIPTIONS over it, and the green cross beside.
  kit.parts.atlas.push(placed(
    labelledBox(1.3, 0.22, 0.03, { front: kit.A.uv.rxsign, back: kit.sw('medGreen') }, kit.sw('medGreen')), (h0 + h1) / 2, 2.05, back + 0.02,
  ));
  kit.parts.atlas.push(placed(
    labelledBox(0.45, 0.45, 0.04, { front: kit.A.uv.cross, back: kit.sw('pill') }, kit.sw('pill')), 1.95, 1.9, back + 0.03,
  ));

  // Tube lights along the tops of the side walls.
  for (const x of [minX + 0.06, maxX - 0.06]) {
    block('pill', [x - 0.04, x + 0.04], [2.48, 2.52], [-3.6, -0.9]);
    kit.glowBox([x - 0.025, x + 0.025], [2.45, 2.48], [-3.55, -0.95]);
  }

  return {
    keeper: {
      x: 0.8, z: -4.4, figure: 'female',
      look: { shirt: 0xf6f7f6, apron: 0xf6f7f6, trousers: 0x55595c, hair: 0x3a2618 },
    },
    lamps: [[0, 2.4, -1.6], [0.4, 2.4, -3.1]],
    lampColour: 0xeaf3ff,
    counter: { x: 0.6, z: -3.05 },
    greeting: (hour) => `💊 “${hello(hour)}! Something for the aches of a long day in the fields?”`,
  };
}

const DESIGNS = { grocer, hardware, bakery, cafe, restaurant, pharmacy };

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
    floor: material('floor', {
      map: tiled({
        checker: () => checkerCanvas(spec.colours.tileA, spec.colours.tileB),
        carpet: () => carpetCanvas(spec.colours.carpet, spec.colours.carpetLine),
      }[spec.floor]?.() ?? floorCanvas(), anisotropy),
      roughness: { checker: 0.5, carpet: 0.98 }[spec.floor] ?? 0.78,
    }),
    pave: material('pave', { map: tiled(paveCanvas(), anisotropy), roughness: 0.95 }),
    atlas: material('atlas', { map: atlasTex, roughness: 0.74, side: THREE.DoubleSide }),
    glow: material('glow', { color: 0xfff1d6, emissive: 0xffc77a, emissiveIntensity: 1 }),
    glass: material('glass', {
      color: 0xe6f2f2, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false,
    }),
    flame: material('flame', { color: 0xffd27a, emissive: 0xff9a2a, emissiveIntensity: 2 }),
  };
  mats.front = mats.atlas;
  let triangles = 0;
  let flameMesh = null;
  const meshes = {};
  for (const [key, list] of Object.entries(kit.parts)) {
    if (!list.length) continue;
    const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(geos, false);
    for (const g of list) g.dispose();
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.name = `interior-${spec.id}-${key}`;
    mesh.receiveShadow = key !== 'glass';
    mesh.castShadow = key === 'atlas' || key === 'front';
    if (key === 'glass') mesh.renderOrder = 1;
    if (key === 'flame') flameMesh = mesh;
    meshes[key] = mesh;
    group.add(mesh);
    triangles += merged.getAttribute('position').count / 3;
  }

  /* The shopkeeper, behind the counter, idling. The same figure as the
     farmer in the shop's colours, so the town's people are the farm's. */
  const keeper = buildFarmer(design.keeper.figure ?? 'male', design.keeper.look);
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
    const l = new THREE.PointLight(design.lampColour ?? 0xffcf8a, 3, 8, 2);
    l.position.set(x, y - 0.05, z);
    group.add(l);
    return l;
  });

  /* What the shop has sold the farm, shown on its cards: a gold pip in
     each of a line's three sockets for each level bought, and a SOLD OUT
     band across the card when there are no more. Instanced, one mesh for
     every pip in the shop and one for every band, and shown or hidden by
     scaling each to nothing — so buying a level changes a matrix, not the
     scene. */
  const slots = design.slots ?? [];
  let stock = () => {};
  const shown = {};
  if (slots.length) {
    const gold = material('pips', { color: 0xe8b923, roughness: 0.35, metalness: 0.6 });
    const pips = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.028, 1), gold, slots.length * 3);
    pips.name = `interior-${spec.id}-pips`;
    const bandGeo = labelledBox(0.58, 0.095, 0.008, { front: A.uv.soldout, back: A.swatch.iron }, A.swatch.iron);
    const bands = new THREE.InstancedMesh(bandGeo, mats.atlas, slots.length);
    bands.name = `interior-${spec.id}-sold-out`;
    // Culled as one box from the start: their extents change as levels sell.
    pips.frustumCulled = false;
    bands.frustumCulled = false;
    group.add(pips, bands);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const none = new THREE.Vector3(0, 0, 0);
    let last = '';
    stock = (levels = {}) => {
      const key = slots.map((sl) => levels[sl.id] ?? 0).join(',');
      if (key === last) return;
      last = key;
      slots.forEach((sl, i) => {
        const level = Math.max(0, Math.min(3, levels[sl.id] ?? 0));
        sl.pips.forEach((p, k) => {
          pips.setMatrixAt(i * 3 + k, m.compose(p, q.identity(), k < level ? one : none));
        });
        const sold = level >= sl.max;
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -sl.banner.tilt);
        bands.setMatrixAt(i, m.compose(sl.banner.at, q, sold ? one : none));
        shown[sl.id] = { pips: level, soldOut: sold };
      });
      pips.instanceMatrix.needsUpdate = true;
      bands.instanceMatrix.needsUpdate = true;
    };
    stock({});
  }

  /* Candles, where a room has them: a small warm light each, lit with the
     lamps after dark and never quite steady. And steam, where a room has a
     kitchen: a handful of puffs climbing from a pot, swelling as they go
     and gone at the top — instanced, one draw for all of them. */
  const candleLights = (design.candles ?? []).map(([x, y, z]) => {
    const l = new THREE.PointLight(0xffb060, 0, 3.2, 2);
    l.position.set(x, y + 0.12, z);
    group.add(l);
    return l;
  });
  let steam = null;
  if (design.steam) {
    /* A little light of its own: lit like everything else, steam against
       the dark beyond the wall came out as grey lumps, which is smoke. */
    const steamMat = material('steam', {
      color: 0xffffff, emissive: 0xb8b8b8, emissiveIntensity: 1, roughness: 1,
      transparent: true, opacity: 0.32, depthWrite: false,
    });
    steam = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 1), steamMat, 8);
    steam.name = `interior-${spec.id}-steam`;
    steam.frustumCulled = false;
    steam.renderOrder = 2;
    group.add(steam);
  }
  const puff = new THREE.Matrix4();
  const puffAt = new THREE.Vector3();
  const puffQ = new THREE.Quaternion();
  const puffS = new THREE.Vector3();
  let clock = 0;
  let candleLit = 0;
  const flicker = (t, i) => 0.78 + 0.22 * (Math.sin(t * 13.7 + i * 2.1) * 0.6 + Math.sin(t * 23.3 + i * 5.7) * 0.4);

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
  /* Where she stands to be served, if this shop serves anything: a strip
     along the front of its counter, in the room's frame. */
  const zone = design.counterZone ?? null;
  const atCounter = (x, z) => {
    if (!zone) return false;
    const l = toLocal(x, z);
    return l.x >= zone.x[0] && l.x <= zone.x[1] && l.z >= zone.z[0] && l.z <= zone.z[1];
  };

  let lit = 0;
  /* night: 0 by day, 1 at midnight, the scene's skyNight. dt: seconds. */
  function update(night, dt) {
    lit = lampsLit(night);
    sun.intensity = 0.25 + 1.45 * (1 - lit);
    hemi.intensity = 0.55 + 0.5 * (1 - lit);
    for (const l of lamps) l.intensity = (2.5 + 7 * lit) * (design.lampPower ?? 1);
    mats.glow.emissiveIntensity = 0.8 + 2.2 * lit;
    keeper.mixer.update(Math.min(dt, 0.1));
    clock += Math.min(dt, 0.25);
    // Candles are lit at dusk, not before: a candle burning at noon is a
    // restaurant that has forgotten it is open for lunch.
    candleLit = THREE.MathUtils.smoothstep(night, 0.2, 0.5);
    if (flameMesh) {
      flameMesh.visible = candleLit > 0.01;
      mats.flame.emissiveIntensity = candleLit * 2.4 * flicker(clock, 0);
    }
    candleLights.forEach((l, i) => { l.intensity = candleLit * 1.1 * flicker(clock, i + 1); });
    if (steam) {
      const [sx, sy, sz] = design.steam;
      for (let i = 0; i < 8; i += 1) {
        const ph = (clock * 0.32 + i / 8) % 1;
        puffAt.set(sx + Math.sin(ph * 6 + i) * 0.08, sy + ph * 1.9, sz + Math.cos(ph * 5 + i) * 0.06);
        const k = (0.5 + ph * 1.4) * (ph > 0.8 ? (1 - ph) / 0.2 : 1);
        steam.setMatrixAt(i, puff.compose(puffAt, puffQ, puffS.set(k, k, k)));
      }
      steam.instanceMatrix.needsUpdate = true;
    }
  }
  update(0, 0);

  return {
    scene, solids, walk, door, toLocal, update, atCounter, stock,
    /* The room as its shop window shows it: without the street wall and
       the pavement, which stand between the window's photograph and the
       room. Put back with false. */
    forPhoto: (on) => {
      for (const key of ['front', 'pave']) if (meshes[key]) meshes[key].visible = !on;
    },
    stockShown: () => JSON.parse(JSON.stringify(shown)),
    greeting: design.greeting, // (hour 0-24) => what the shopkeeper says
    view: { box, centre: { x: centre.x, y: 0.9, z: centre.z }, out: door.out },
    state: () => ({
      lit,
      sun: sun.intensity,
      lamps: lamps.map((l) => l.intensity),
      glow: mats.glow.emissiveIntensity,
      candles: candleLights.map((l) => l.intensity),
      flame: flameMesh ? (flameMesh.visible ? mats.flame.emissiveIntensity : 0) : null,
      steam: !!steam,
    }),
    report: {
      id: spec.id,
      name: spec.name,
      floor: { width: maxX - minX, depth: front - back, ...worldRect([minX, maxX], [back, front]) },
      door,
      walk,
      counter: toWorld(design.counter.x, design.counter.z),
      counterZone: zone ? worldRect(zone.x, zone.z) : null,
      lines: slots.map((sl) => sl.id),
      keeper: toWorld(design.keeper.x, design.keeper.z),
      furniture: [...new Set(kit.furniture)],
      // Where each piece stands, as world rectangles, by its name.
      pieces: Object.fromEntries(kit.solids.map((b) => [b.id, worldRect([b.x0, b.x1], [b.z0, b.z1])])),
      triangles,
      atlas: { width: A.width, height: A.height },
    },
  };
}
