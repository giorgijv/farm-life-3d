/* civic.js — Farm City's two public buildings, and the square in front of
 * one of them.
 *
 * Neither is in any kit. The mirror has houses, shops, towers and a fountain
 * nowhere; it has no town hall and no police station. So both are built
 * here, from boxes, cylinders and a handful of extruded shapes, the way the
 * barn and the stable were.
 *
 * The City Hall is the town's landmark and is built to be one: a stone
 * block on a podium, a portico of six columns under a pediment with the
 * town's wheat-sheaf in it, CITY HALL cut into the frieze, and a clock tower
 * rising behind with a domed belfry and a weathervane. The clock works — its
 * hands show the farm's own time of day, which runs a whole day every
 * ninety seconds, so the minute hand visibly sweeps.
 *
 * The Police Station is the opposite kind of building on purpose: red brick,
 * two storeys, plain and square, with stone quoins at its corners, a blue
 * lamp over the door, POLICE STATION across its front and a roller-shuttered
 * garage. The two police cars outside it are the kit's, placed by scene.js.
 *
 * The square across the street from the City Hall is paved, with a tiered
 * fountain in the middle, benches round it, flower beds at its corners and
 * the town's flag on a pole.
 *
 * Seen from outside, never entered: the doors are painted, the buildings
 * solid.
 *
 * Draw calls are the constraint, and the lesson the stable's first build
 * (forty-seven of them) taught is applied from the start. Everything static
 * is merged by material, and there are three: stone and brick, each a small
 * texture tiled at its real coursing so no wall is a stretched picture, and
 * one atlas for everything with lettering or a painted face — windows,
 * doors, the clock dial, the frieze, the lamp, the flag. The water, the flag
 * (which moves) and the clock's hands (which turn) are their own meshes.
 *
 * Nothing here reaches into the scene. buildCivic takes where each thing
 * goes and returns the meshes, the collision boxes, a report, and an update
 * function for the clock and the flag.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, labelledBox, placed } from './signs.js';

const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, "DejaVu Sans", sans-serif';

const PAINT = {
  stone: '#d9d0bd',
  stoneDark: '#a99f8a',
  stoneShadow: '#8c8371',
  copper: '#5e9e8a',
  copperDark: '#3f7666',
  gold: '#c9a227',
  iron: '#232427',
  white: '#f4f2ec',
  navy: '#1c2d55',
  police: '#1f3f8f',
  glass: '#2f3d4a',
  wood: '#7a5230',
  woodDark: '#4e321b',
  soil: '#4d3a28',
  leaf: '#3f7a3a',
  red: '#d8433b',
  yellow: '#efc23a',
  pink: '#e889b5',
  purple: '#8b5fbf',
  tarmac: '#3b3d40',
  line: '#e9e6dc',
  slate: '#5a6068',
};

/* -------------------------------------------------------------------- */
/* Tiled materials: stone and brick                                      */
/* -------------------------------------------------------------------- */

/* World units one repeat of each texture covers. The stone's courses come
   out a little under 0.4 high, which is what dressed ashlar on a civic
   building is; the bricks at the size of real bricks. */
const STONE_TILE = 1.6;
const BRICK_TILE = 1.2;

function noise(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function stoneCanvas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b8af9b';
  ctx.fillRect(0, 0, 256, 256);
  const rows = 4;
  const h = 256 / rows;
  for (let r = 0; r < rows; r += 1) {
    const cols = 2;
    const w = 256 / cols;
    const off = r % 2 ? w / 2 : 0;
    for (let k = -1; k <= cols; k += 1) {
      const x = k * w + off;
      const t = noise(r * 7 + k * 3 + 1);
      const v = 205 + Math.round(t * 22);
      ctx.fillStyle = `rgb(${v},${v - 7},${v - 20})`;
      ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4);
      // A little weathering on each block, so the wall is not a grid of
      // identical rectangles.
      for (let s = 0; s < 18; s += 1) {
        const a = noise(r * 100 + k * 17 + s);
        const b = noise(r * 31 + k * 7 + s * 3);
        ctx.fillStyle = `rgba(90,80,60,${0.04 + a * 0.06})`;
        ctx.fillRect(x + 4 + a * (w - 12), r * h + 4 + b * (h - 12), 6 + a * 10, 3 + b * 5);
      }
    }
  }
  return c;
}

function brickCanvas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cfc3b0'; // mortar
  ctx.fillRect(0, 0, 256, 256);
  const rows = 16;
  const h = 256 / rows;
  const cols = 5;
  const w = 256 / cols;
  for (let r = 0; r < rows; r += 1) {
    const off = r % 2 ? w / 2 : 0;
    for (let k = -1; k <= cols; k += 1) {
      const t = noise(r * 13 + k * 5 + 2);
      const red = 150 + Math.round(t * 40);
      ctx.fillStyle = `rgb(${red},${62 + Math.round(t * 18)},${48 + Math.round(t * 12)})`;
      ctx.fillRect(k * w + off + 1.5, r * h + 1.5, w - 3, h - 3);
    }
  }
  return c;
}

function tiled(canvas, anisotropy) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/* A box whose UVs are in world units over the tile, so a long wall repeats
   its texture rather than stretching one copy of it. BoxGeometry's faces
   come +x, -x, +y, -y, +z, -z, each spanning its own two dimensions. */
function tiledBox(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const uv = g.getAttribute('uv');
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face += 1) {
    const [fw, fh] = dims[face];
    for (let k = 0; k < 6; k += 1) {
      const i = face * 6 + k;
      uv.setXY(i, (uv.getX(i) * fw) / tile, (uv.getY(i) * fh) / tile);
    }
  }
  return g;
}

/* A cylinder with the same treatment: around the circumference in world
   units, and up it. */
function tiledCylinder(rTop, rBot, h, seg, tile, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open).toNonIndexed();
  const uv = g.getAttribute('uv');
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
  return g;
}

/* -------------------------------------------------------------------- */
/* The atlas                                                             */
/* -------------------------------------------------------------------- */

function makeAtlas() {
  const cells = [
    { kind: 'frieze', w: 1024, h: 112 },
    { kind: 'policeSign', w: 768, h: 96 },
    { kind: 'clock', w: 256, h: 256 },
    { kind: 'medallion', w: 192, h: 192 },
    { kind: 'balustrade', w: 512, h: 96 },
    { kind: 'hallDoor', w: 160, h: 256 },
    { kind: 'sash', w: 96, h: 176 },
    { kind: 'policeDoor', w: 144, h: 208 },
    { kind: 'policeWindow', w: 96, h: 128 },
    { kind: 'garage', w: 240, h: 192 },
    { kind: 'lamp', w: 96, h: 96 },
    { kind: 'flag', w: 256, h: 160 },
    { kind: 'notice', w: 128, h: 160 },
    ...Object.entries(PAINT).map(([key, colour]) => ({ kind: 'swatch', key, colour, w: 16, h: 16 })),
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
  ctx.fillStyle = PAINT.stone;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = document.createElement('canvas');
  glow.width = WIDTH;
  glow.height = HEIGHT;
  const g = glow.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  for (const c of cells) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    DRAW[c.kind]?.(ctx, c);
    ctx.restore();
    if (c.kind === 'swatch') { ctx.fillStyle = c.colour; ctx.fillRect(c.x, c.y, c.w, c.h); }
    /* What is lit from inside: windows, the clock's dial — a town clock is
       lit at night so it can be read — and the blue lamp. */
    if (c.kind === 'sash' || c.kind === 'policeWindow') {
      g.fillStyle = '#4a3a24';
      g.fillRect(c.x + c.w * 0.12, c.y + c.h * 0.1, c.w * 0.76, c.h * 0.8);
    } else if (c.kind === 'clock') {
      g.fillStyle = '#5a5240';
      g.beginPath();
      g.arc(c.x + c.w / 2, c.y + c.h / 2, c.w * 0.44, 0, Math.PI * 2);
      g.fill();
    } else if (c.kind === 'lamp') {
      g.fillStyle = '#3a66ff';
      g.fillRect(c.x, c.y, c.w, c.h);
    }
  }

  const uvOf = (c) => ({
    u0: (c.x + 0.5) / WIDTH,
    u1: (c.x + c.w - 0.5) / WIDTH,
    v0: 1 - (c.y + c.h - 0.5) / HEIGHT,
    v1: 1 - (c.y + 0.5) / HEIGHT,
  });
  const byKind = Object.fromEntries(cells.filter((c) => c.kind !== 'swatch').map((c) => [c.kind, uvOf(c)]));
  const swatch = Object.fromEntries(cells.filter((c) => c.kind === 'swatch').map((c) => [c.key, uvOf(c)]));
  return { canvas, glow, uv: byKind, swatch, width: WIDTH, height: HEIGHT };
}

/* Fits one line of text to a width, largest first. */
function fit(ctx, text, start, room, family, weight = 'bold') {
  let size = start;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > 8 && ctx.measureText(text).width > room) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

function sheaf(ctx, cx, cy, s, colour) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(2, s * 0.04);
  ctx.lineCap = 'round';
  const stalks = 9;
  for (let i = 0; i < stalks; i += 1) {
    const t = i / (stalks - 1) - 0.5;
    const topX = cx + t * s * 0.9;
    const topY = cy - s * 0.5 + Math.abs(t) * s * 0.25;
    ctx.beginPath();
    ctx.moveTo(cx + t * s * 0.45, cy + s * 0.55);
    ctx.quadraticCurveTo(cx + t * s * 0.12, cy + s * 0.05, topX, topY);
    ctx.stroke();
    for (let k = 0; k < 4; k += 1) {
      ctx.beginPath();
      ctx.ellipse(topX - t * k * s * 0.03, topY + k * s * 0.05, s * 0.03, s * 0.055, t, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillRect(cx - s * 0.2, cy + s * 0.1, s * 0.4, s * 0.08);
  ctx.restore();
}

const DRAW = {
  /* CITY HALL, cut into the stone of the frieze: the letters darker than
     the stone with a highlight under each, which is how incised capitals
     read at a distance. */
  frieze(ctx, c) {
    ctx.fillStyle = PAINT.stone;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = PAINT.stoneDark;
    ctx.fillRect(c.x, c.y, c.w, 6);
    ctx.fillRect(c.x, c.y + c.h - 6, c.w, 6);
    const text = 'CITY  HALL';
    const size = fit(ctx, text, Math.round(c.h * 0.62), c.w * 0.8, SERIF);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(text, c.x + c.w / 2 + 1, c.y + c.h / 2 + 3);
    ctx.fillStyle = '#5b5446';
    ctx.fillText(text, c.x + c.w / 2, c.y + c.h / 2 + 1);
    // Wreaths either side.
    for (const s of [-1, 1]) {
      const wx = c.x + c.w / 2 + s * c.w * 0.44;
      ctx.strokeStyle = '#6d6553';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(wx, c.y + c.h / 2, c.h * 0.28, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  policeSign(ctx, c) {
    ctx.fillStyle = PAINT.navy;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = PAINT.white;
    ctx.lineWidth = 4;
    ctx.strokeRect(c.x + 8, c.y + 8, c.w - 16, c.h - 16);
    const text = 'POLICE STATION';
    fit(ctx, text, Math.round(c.h * 0.56), c.w * 0.85, SANS);
    ctx.fillStyle = PAINT.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.x + c.w / 2, c.y + c.h / 2 + 2);
  },
  /* The dial: cream enamel, Roman numerals, a minute track, a gilt rim.
     The hands are not drawn — they are meshes, and they move. */
  clock(ctx, c) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const r = c.w / 2;
    ctx.fillStyle = PAINT.stoneDark;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = PAINT.gold;
    ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f5efdc';
    ctx.beginPath(); ctx.arc(cx, cy, r - 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b1b1b';
    for (let m = 0; m < 60; m += 1) {
      const a = (m / 60) * Math.PI * 2;
      const long = m % 5 === 0;
      ctx.lineWidth = long ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * (r - 16), cy - Math.cos(a) * (r - 16));
      ctx.lineTo(cx + Math.sin(a) * (r - (long ? 30 : 22)), cy - Math.cos(a) * (r - (long ? 30 : 22)));
      ctx.stroke();
    }
    const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `bold 26px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    numerals.forEach((n, i) => {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillText(n, cx + Math.sin(a) * (r - 52), cy - Math.cos(a) * (r - 52));
    });
  },
  medallion(ctx, c) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    ctx.fillStyle = PAINT.stoneDark;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = PAINT.stone;
    ctx.beginPath(); ctx.arc(cx, cy, c.w / 2 - 6, 0, Math.PI * 2); ctx.fill();
    sheaf(ctx, cx, cy, c.w * 0.62, PAINT.gold);
  },
  balustrade(ctx, c) {
    ctx.fillStyle = '#6f6757';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    const n = 16;
    const w = c.w / n;
    ctx.fillStyle = PAINT.stone;
    ctx.fillRect(c.x, c.y, c.w, 14);
    ctx.fillRect(c.x, c.y + c.h - 12, c.w, 12);
    for (let i = 0; i < n; i += 1) {
      const bx = c.x + i * w + w / 2;
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.2, c.y + 14);
      ctx.quadraticCurveTo(bx - w * 0.42, c.y + c.h * 0.62, bx - w * 0.16, c.y + c.h - 12);
      ctx.lineTo(bx + w * 0.16, c.y + c.h - 12);
      ctx.quadraticCurveTo(bx + w * 0.42, c.y + c.h * 0.62, bx + w * 0.2, c.y + 14);
      ctx.fill();
    }
  },
  hallDoor(ctx, c) {
    ctx.fillStyle = PAINT.woodDark;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    // A fanlight over a pair of panelled doors.
    ctx.fillStyle = PAINT.glass;
    ctx.beginPath(); ctx.arc(c.x + c.w / 2, c.y + 52, c.w / 2 - 10, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = PAINT.gold;
    ctx.lineWidth = 3;
    for (let k = 1; k < 6; k += 1) {
      const a = Math.PI + (k / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(c.x + c.w / 2, c.y + 52);
      ctx.lineTo(c.x + c.w / 2 + Math.cos(a) * (c.w / 2 - 10), c.y + 52 + Math.sin(a) * (c.w / 2 - 10));
      ctx.stroke();
    }
    for (const s of [0, 1]) {
      const dx = c.x + 10 + s * (c.w / 2 - 5);
      const dw = c.w / 2 - 15;
      ctx.fillStyle = PAINT.wood;
      ctx.fillRect(dx, c.y + 62, dw, c.h - 70);
      ctx.strokeStyle = PAINT.woodDark;
      ctx.lineWidth = 4;
      for (let p = 0; p < 3; p += 1) ctx.strokeRect(dx + 8, c.y + 72 + p * 60, dw - 16, 50);
      ctx.fillStyle = PAINT.gold;
      ctx.fillRect(dx + (s ? 6 : dw - 12), c.y + 150, 6, 16);
    }
  },
  sash(ctx, c) {
    ctx.fillStyle = PAINT.white;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    const panes = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]];
    const pw = (c.w - 18) / 2;
    const ph = (c.h - 24) / 3;
    for (const [i, j] of panes) {
      const px = c.x + 6 + i * (pw + 6);
      const py = c.y + 6 + j * (ph + 6);
      const grad = ctx.createLinearGradient(px, py, px + pw, py + ph);
      grad.addColorStop(0, '#5d7183');
      grad.addColorStop(1, '#2b3946');
      ctx.fillStyle = grad;
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(px + 3, py + 3, pw * 0.3, ph * 0.6);
    }
  },
  policeDoor(ctx, c) {
    ctx.fillStyle = PAINT.navy;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    for (const s of [0, 1]) {
      const dx = c.x + 8 + s * (c.w / 2 - 4);
      const dw = c.w / 2 - 12;
      ctx.fillStyle = PAINT.glass;
      ctx.fillRect(dx + 6, c.y + 14, dw - 12, c.h * 0.42);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(dx + 9, c.y + 18, (dw - 12) * 0.3, c.h * 0.3);
      ctx.strokeStyle = '#0f1a33';
      ctx.lineWidth = 3;
      ctx.strokeRect(dx + 6, c.y + 22 + c.h * 0.44, dw - 12, c.h * 0.4);
    }
    ctx.fillStyle = PAINT.white;
    ctx.font = `bold 14px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('POLICE', c.x + c.w / 2, c.y + c.h * 0.5);
  },
  policeWindow(ctx, c) {
    ctx.fillStyle = PAINT.white;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = c.x + 6 + i * ((c.w - 18) / 2 + 6);
      const py = c.y + 6 + j * ((c.h - 18) / 2 + 6);
      const pw = (c.w - 18) / 2;
      const ph = (c.h - 18) / 2;
      ctx.fillStyle = '#34485a';
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(px + 3, py + 3, pw * 0.35, ph * 0.5);
    }
  },
  garage(ctx, c) {
    ctx.fillStyle = '#9aa1a8';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    for (let k = 0; k < c.h; k += 12) {
      ctx.fillStyle = '#7f868d';
      ctx.fillRect(c.x, c.y + k + 9, c.w, 3);
    }
    ctx.fillStyle = '#e9c43b';
    ctx.fillRect(c.x + c.w * 0.18, c.y + c.h * 0.42, c.w * 0.64, c.h * 0.16);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `bold 16px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLICE — KEEP CLEAR', c.x + c.w / 2, c.y + c.h / 2 + 1);
  },
  /* The blue lamp's glass, lettered POLICE on every side, as the real ones
     are. */
  lamp(ctx, c) {
    const grad = ctx.createLinearGradient(c.x, c.y, c.x, c.y + c.h);
    grad.addColorStop(0, '#6f96ff');
    grad.addColorStop(1, '#1f45c8');
    ctx.fillStyle = grad;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = PAINT.white;
    ctx.font = `bold 20px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLICE', c.x + c.w / 2, c.y + c.h / 2);
  },
  /* Farm City's flag: green, a gold sheaf, and a white band at the hoist. */
  flag(ctx, c) {
    ctx.fillStyle = '#1d5236';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = PAINT.white;
    ctx.fillRect(c.x, c.y, c.w * 0.16, c.h);
    sheaf(ctx, c.x + c.w * 0.58, c.y + c.h / 2, c.h * 0.7, PAINT.gold);
  },
  notice(ctx, c) {
    ctx.fillStyle = PAINT.navy;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#f2ead6';
    ctx.fillRect(c.x + 10, c.y + 26, c.w - 20, c.h - 36);
    ctx.fillStyle = PAINT.white;
    ctx.font = `bold 15px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('NOTICES', c.x + c.w / 2, c.y + 18);
    ctx.fillStyle = '#8b8577';
    for (let k = 0; k < 6; k += 1) ctx.fillRect(c.x + 18, c.y + 40 + k * 18, c.w - 36 - (k % 3) * 14, 5);
  },
};

/* -------------------------------------------------------------------- */
/* Building blocks                                                       */
/* -------------------------------------------------------------------- */

/* Where each piece goes while a building is being assembled, by material. */
function bucket() {
  return { stone: [], brick: [], atlas: [] };
}

const at = (g, x, y, z) => g.translate(x, y, z);

function stoneBox(B, w, h, d, x, y, z, tile = STONE_TILE) {
  B.stone.push(at(tiledBox(w, h, d, tile), x, y, z));
}
function brickBox(B, w, h, d, x, y, z) {
  B.brick.push(at(tiledBox(w, h, d, BRICK_TILE), x, y, z));
}
function swatchBox(B, A, colour, w, h, d, x, y, z) {
  B.atlas.push(at(paint(new THREE.BoxGeometry(w, h, d), A.swatch[colour]), x, y, z));
}
/* A thin panel with an atlas picture on its front, facing +z. */
function picture(B, A, kind, w, h, x, y, z, edge = 'stoneDark') {
  B.atlas.push(at(labelledBox(w, h, 0.03, { front: A.uv[kind], back: A.swatch[edge] }, A.swatch[edge]), x, y, z));
}

/* A sash window in a stone architrave, with a sill and — on the principal
   floor — a little cornice over it. Built facing +z on a wall at z = 0. */
function stoneWindow(B, A, x, y, w, h, hood) {
  /* The surround is one plate behind the sash, proud of the wall, rather
     than two jambs and a head: the same outline from any distance anyone
     sees it from, for a third of the triangles. */
  stoneBox(B, w + 0.28, h + 0.2, 0.06, x, y + h / 2, 0.03);
  picture(B, A, 'sash', w, h, x, y + h / 2, 0.075);
  stoneBox(B, w + 0.42, 0.12, 0.2, x, y - 0.06, 0.1);
  if (hood) stoneBox(B, w + 0.5, 0.1, 0.26, x, y + h + 0.16, 0.13);
}

/* -------------------------------------------------------------------- */
/* The City Hall                                                         */
/* -------------------------------------------------------------------- */

/* Its proportions, in world units, the front facing +z. */
export const HALL = {
  width: 12, depth: 7.2, height: 6.6, podium: 0.6,
  portico: { columns: 6, span: 7.2, out: 1.75, column: 5.0 },
  steps: { count: 5, width: 6.6, tread: 0.38 },
  tower: { size: 2.8, top: 12.6, clockY: 11.0, clockR: 0.98 },
};

function buildHall(A) {
  const B = bucket();
  const H = HALL;
  const half = H.width / 2;
  const front = H.depth / 2;
  const P = H.podium;

  // The podium the whole building stands on, wider than it and running out
  // under the portico.
  const podDepth = H.depth + 0.6 + H.portico.out + 0.6;
  stoneBox(B, H.width + 0.6, P, podDepth, 0, P / 2, -H.depth / 2 - 0.3 + podDepth / 2);
  const podFront = -H.depth / 2 - 0.3 + podDepth;
  // A flight of steps up to it, across the width of the portico.
  for (let i = 0; i < H.steps.count; i += 1) {
    const hgt = P - (P / H.steps.count) * i;
    const deep = H.steps.tread * (i + 1);
    stoneBox(B, H.steps.width, hgt, deep, 0, hgt / 2, podFront + deep / 2);
  }

  // The block: a rusticated ground floor, smooth ashlar above, a string
  // course between them.
  const floor = H.height / 2;
  stoneBox(B, H.width + 0.08, floor, H.depth + 0.08, 0, P + floor / 2, 0, STONE_TILE * 0.75);
  stoneBox(B, H.width, H.height - floor, H.depth, 0, P + floor + (H.height - floor) / 2, 0);
  stoneBox(B, H.width + 0.2, 0.18, H.depth + 0.2, 0, P + floor + 0.09, 0);
  // The cornice and a balustraded parapet.
  const top = P + H.height;
  stoneBox(B, H.width + 0.5, 0.28, H.depth + 0.5, 0, top + 0.14, 0);
  for (const [w, d, x, z, yaw] of [
    [H.width + 0.3, 0.22, 0, front + 0.1, 0],
    [H.width + 0.3, 0.22, 0, -front - 0.1, Math.PI],
    [H.depth + 0.2, 0.22, half + 0.1, 0, Math.PI / 2],
    [H.depth + 0.2, 0.22, -half - 0.1, 0, -Math.PI / 2],
  ]) {
    const g = labelledBox(w, 0.7, d, { front: A.uv.balustrade, back: A.uv.balustrade }, A.swatch.stone);
    B.atlas.push(placed(g, x, top + 0.28 + 0.35, z, yaw));
  }
  stoneBox(B, H.width + 0.4, 0.1, 0.3, 0, top + 1.03, front + 0.1);
  stoneBox(B, H.width + 0.4, 0.1, 0.3, 0, top + 1.03, -front - 0.1);
  stoneBox(B, 0.3, 0.1, H.depth + 0.4, half + 0.1, top + 1.03, 0);
  stoneBox(B, 0.3, 0.1, H.depth + 0.4, -half - 0.1, top + 1.03, 0);
  // A roof behind the parapet, so it is not open to the sky from above.
  swatchBox(B, A, 'slate', H.width - 0.2, 0.1, H.depth - 0.2, 0, top + 0.32, 0);

  // Windows on the front either side of the portico, and down both sides.
  const wy0 = P + 0.75;
  const wy1 = P + floor + 0.55;
  const facade = (fn) => {
    const parts = bucket();
    fn(parts);
    return parts;
  };
  const merge = (into, from, x, z, yaw) => {
    // Cloned, because placed() moves a geometry in place and the side
    // windows are merged onto both sides from the one set.
    for (const key of Object.keys(into)) for (const g of from[key]) into[key].push(placed(g.clone(), x, 0, z, yaw));
  };
  const frontWins = facade((F) => {
    for (const x of [-4.95, 4.95]) {
      stoneWindow(F, A, x, wy0, 1.0, 1.9, true);
      stoneWindow(F, A, x, wy1, 1.0, 1.75, false);
    }
    // Behind the columns: the great door, and windows over and beside it.
    picture(F, A, 'hallDoor', 1.9, 3.0, 0, P + 1.5, 0.02);
    stoneBox(F, 2.3, 0.3, 0.16, 0, P + 3.15, 0.08);
    for (const s of [-1, 1]) stoneBox(F, 0.2, 3.0, 0.14, s * 1.05, P + 1.5, 0.07);
    for (const x of [-2.5, 2.5]) stoneWindow(F, A, x, wy0, 0.95, 1.9, true);
    for (const x of [-2.5, 0, 2.5]) stoneWindow(F, A, x, wy1, 0.95, 1.75, false);
    picture(F, A, 'notice', 0.55, 0.7, -3.6, P + 1.35, 0.02, 'woodDark');
  });
  merge(B, frontWins, 0, front, 0);
  const sideWins = facade((F) => {
    for (const x of [-2.3, 0, 2.3]) {
      stoneWindow(F, A, x, wy0, 0.95, 1.9, true);
      stoneWindow(F, A, x, wy1, 0.95, 1.75, false);
    }
  });
  merge(B, sideWins, half, 0, Math.PI / 2);
  merge(B, sideWins, -half, 0, -Math.PI / 2);

  // The portico: six columns, an entablature with the frieze, a pediment.
  const pz = front + H.portico.out - 0.25;
  const colH = H.portico.column;
  for (let i = 0; i < H.portico.columns; i += 1) {
    const x = -H.portico.span / 2 + (i * H.portico.span) / (H.portico.columns - 1);
    stoneBox(B, 0.66, 0.22, 0.66, x, P + 0.11, pz);
    B.stone.push(at(tiledCylinder(0.22, 0.27, colH - 0.5, 10, STONE_TILE, true), x, P + 0.22 + (colH - 0.5) / 2, pz));
    B.stone.push(at(tiledCylinder(0.34, 0.24, 0.18, 10, STONE_TILE, true), x, P + colH - 0.2, pz));
    stoneBox(B, 0.72, 0.14, 0.72, x, P + colH - 0.04, pz);
  }
  const entY = P + colH + 0.03;
  const entW = H.portico.span + 1.1;
  const entD = H.portico.out + 0.55;
  stoneBox(B, entW, 0.3, entD, 0, entY + 0.15, front + entD / 2 - 0.1);
  const frieze = labelledBox(entW, 0.62, 0.06, { front: A.uv.frieze, back: A.swatch.stone }, A.swatch.stone);
  B.atlas.push(at(frieze, 0, entY + 0.61, front + entD - 0.08));
  stoneBox(B, entW, 0.62, entD - 0.12, 0, entY + 0.61, front + (entD - 0.12) / 2 - 0.1);
  stoneBox(B, entW + 0.4, 0.2, entD + 0.25, 0, entY + 1.02, front + entD / 2);
  const pedH = 1.55;
  const ped = new THREE.Shape();
  ped.moveTo(-(entW + 0.4) / 2, 0);
  ped.lineTo((entW + 0.4) / 2, 0);
  ped.lineTo(0, pedH);
  ped.closePath();
  const pedG = new THREE.ExtrudeGeometry(ped, { depth: entD + 0.25, bevelEnabled: false });
  const pedUV = pedG.getAttribute('uv');
  for (let i = 0; i < pedUV.count; i += 1) pedUV.setXY(i, pedUV.getX(i) / STONE_TILE, pedUV.getY(i) / STONE_TILE);
  const pedBase = entY + 1.12;
  B.stone.push(at(pedG, 0, pedBase, front - 0.125));
  /* What makes a triangle of stone read as a pediment and not as more
     wall: raking cornices standing proud along its two slopes, and a
     tympanum a shade darker than the stone round it. The first build had
     neither, and from the square the pediment vanished against the
     parapet behind it. */
  const halfBase = (entW + 0.4) / 2;
  const rake = Math.atan2(pedH, halfBase);
  const rakeLen = Math.hypot(halfBase, pedH) + 0.25;
  for (const s of [-1, 1]) {
    const g = tiledBox(rakeLen, 0.2, entD + 0.45, STONE_TILE);
    g.rotateZ(-s * rake);
    B.stone.push(at(g, s * halfBase / 2, pedBase + pedH / 2 + 0.07, front + entD / 2));
  }
  {
    const tri = new THREE.Shape();
    const inset = 0.82;
    tri.moveTo(-halfBase * inset, 0.12);
    tri.lineTo(halfBase * inset, 0.12);
    tri.lineTo(0, pedH * inset);
    tri.closePath();
    B.atlas.push(at(paint(new THREE.ShapeGeometry(tri), A.swatch.stoneShadow), 0, pedBase, front + entD + 0.13));
  }
  const med = paint(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 20), A.swatch.stoneDark);
  {
    // The medallion's face carries the sheaf; its cap is the only face that
    // gets the picture, mapped across its own circle.
    const g = new THREE.CircleGeometry(0.46, 24);
    const uv = g.getAttribute('uv');
    const m = A.uv.medallion;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, m.u0 + uv.getX(i) * (m.u1 - m.u0), m.v0 + uv.getY(i) * (m.v1 - m.v0));
    B.atlas.push(at(g.toNonIndexed(), 0, pedBase + 0.6, front + entD + 0.17));
    med.rotateX(Math.PI / 2);
    B.atlas.push(at(med, 0, pedBase + 0.6, front + entD + 0.14));
  }

  // The clock tower, rising from the roof behind the portico.
  const T = H.tower;
  const tz = -0.6;
  const tBase = top + 0.2;
  const shaft = T.clockY + T.clockR + 0.5 - tBase;
  stoneBox(B, T.size, shaft, T.size, 0, tBase + shaft / 2, tz);
  stoneBox(B, T.size + 0.3, 0.22, T.size + 0.3, 0, tBase + shaft + 0.11, tz);
  // Corner pilasters on the shaft.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    stoneBox(B, 0.3, shaft, 0.3, sx * (T.size / 2 - 0.05), tBase + shaft / 2, tz + sz * (T.size / 2 - 0.05));
  }
  // Dials on the front and the west face, each in a square stone frame.
  const dials = [
    { x: 0, z: tz + T.size / 2 + 0.1, yaw: 0 },
    { x: -T.size / 2 - 0.1, z: tz, yaw: -Math.PI / 2 },
  ];
  for (const d of dials) {
    const g = new THREE.CircleGeometry(T.clockR, 32);
    const uv = g.getAttribute('uv');
    const m = A.uv.clock;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, m.u0 + uv.getX(i) * (m.u1 - m.u0), m.v0 + uv.getY(i) * (m.v1 - m.v0));
    B.atlas.push(placed(g.toNonIndexed(), d.x, T.clockY, d.z, d.yaw));
    const frame = paint(new THREE.BoxGeometry(T.clockR * 2 + 0.36, T.clockR * 2 + 0.36, 0.08), A.swatch.stoneDark);
    B.atlas.push(placed(frame.translate(0, 0, -0.05), d.x, T.clockY, d.z, d.yaw));
  }
  // The belfry: four piers carrying a cornice, open between them.
  const bBase = tBase + shaft + 0.22;
  const bH = 1.7;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    stoneBox(B, 0.55, bH, 0.55, sx * (T.size / 2 - 0.3), bBase + bH / 2, tz + sz * (T.size / 2 - 0.3));
  }
  swatchBox(B, A, 'iron', T.size - 0.9, 0.1, T.size - 0.9, 0, bBase + 0.05, tz);
  B.atlas.push(at(paint(new THREE.CylinderGeometry(0.32, 0.42, 0.55, 10), A.swatch.gold), 0, bBase + bH * 0.55, tz));
  stoneBox(B, T.size + 0.2, 0.25, T.size + 0.2, 0, bBase + bH + 0.12, tz);
  // A copper dome, a lantern, and a spire with a weathervane.
  const dome = paint(new THREE.SphereGeometry(T.size * 0.46, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), A.swatch.copper);
  B.atlas.push(at(dome, 0, bBase + bH + 0.25, tz));
  const lanternY = bBase + bH + 0.25 + T.size * 0.46;
  B.atlas.push(at(paint(new THREE.CylinderGeometry(0.3, 0.34, 0.6, 8), A.swatch.copperDark), 0, lanternY + 0.2, tz));
  B.atlas.push(at(paint(new THREE.ConeGeometry(0.34, 1.0, 8), A.swatch.copper), 0, lanternY + 1.0, tz));
  const vaneY = lanternY + 1.5;
  swatchBox(B, A, 'gold', 0.04, 0.9, 0.04, 0, vaneY + 0.45, tz);
  swatchBox(B, A, 'gold', 0.9, 0.03, 0.03, 0, vaneY + 0.35, tz);
  swatchBox(B, A, 'gold', 0.03, 0.03, 0.9, 0, vaneY + 0.35, tz);
  const arrow = new THREE.Shape();
  arrow.moveTo(-0.45, 0); arrow.lineTo(0.3, 0); arrow.lineTo(0.3, 0.08); arrow.lineTo(0.48, -0.06);
  arrow.lineTo(0.3, -0.2); arrow.lineTo(0.3, -0.12); arrow.lineTo(-0.3, -0.12); arrow.lineTo(-0.45, -0.25);
  arrow.closePath();
  B.atlas.push(at(paint(new THREE.ExtrudeGeometry(arrow, { depth: 0.02, bevelEnabled: false }), A.swatch.gold), 0, vaneY + 0.75, tz));
  B.atlas.push(at(paint(new THREE.IcosahedronGeometry(0.08, 0), A.swatch.gold), 0, vaneY + 0.92, tz));

  const total = vaneY + 0.98;
  return {
    B, dials, podFront: podFront + H.steps.tread * H.steps.count, top: total,
    footprint: { minX: -half - 0.3, maxX: half + 0.3, minZ: -H.depth / 2 - 0.3, maxZ: podFront },
    steps: { minX: -H.steps.width / 2, maxX: H.steps.width / 2, minZ: podFront, maxZ: podFront + H.steps.tread * H.steps.count },
    door: { x: 0, z: front },
  };
}

/* -------------------------------------------------------------------- */
/* The Police Station                                                    */
/* -------------------------------------------------------------------- */

export const POLICE = { width: 9, depth: 5.6, height: 6.2 };

function buildPolice(A) {
  const B = bucket();
  const S = POLICE;
  const half = S.width / 2;
  const front = S.depth / 2;

  brickBox(B, S.width, S.height, S.depth, 0, S.height / 2, 0);
  // A stone plinth, a string course between the floors, a cornice and a
  // coped parapet.
  stoneBox(B, S.width + 0.1, 0.5, S.depth + 0.1, 0, 0.25, 0);
  stoneBox(B, S.width + 0.12, 0.16, S.depth + 0.12, 0, 3.05, 0);
  stoneBox(B, S.width + 0.3, 0.2, S.depth + 0.3, 0, S.height + 0.1, 0);
  brickBox(B, S.width, 0.5, S.depth, 0, S.height + 0.45, 0);
  stoneBox(B, S.width + 0.16, 0.1, S.depth + 0.16, 0, S.height + 0.75, 0);
  // Quoins: stone blocks up every corner, alternately long and short.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    /* Seven courses of quoins a corner, each block 0.7 tall: the
       alternating rhythm is what reads, and fourteen courses of half the
       height cost thirteen hundred triangles for the same rhythm. */
    for (let k = 0; k < 7; k += 1) {
      const long = k % 2 === 0;
      const y = 0.5 + k * 0.8 + 0.37;
      if (y > S.height) break;
      const lx = long ? 0.55 : 0.32;
      stoneBox(B, lx, 0.72, 0.06, sx * (half - lx / 2 + 0.03), y, sz * (front + 0.03));
      stoneBox(B, 0.06, 0.72, long ? 0.32 : 0.55, sx * (half + 0.03), y, sz * (front - (long ? 0.32 : 0.55) / 2 + 0.03));
    }
  }

  // Front: the garage on the left, the entrance on the right, a window
  // between, and four windows across the first floor.
  const F = bucket();
  const gx = -2.35;
  picture(F, A, 'garage', 3.1, 2.55, gx, 0.5 + 1.275, 0.02);
  stoneBox(F, 3.5, 0.3, 0.16, gx, 0.5 + 2.55 + 0.15, 0.08);
  for (const s of [-1, 1]) stoneBox(F, 0.2, 2.55, 0.12, gx + s * 1.65, 0.5 + 1.275, 0.06);
  const dx = 2.6;
  picture(F, A, 'policeDoor', 1.5, 2.25, dx, 0.5 + 1.125, 0.02);
  for (const s of [-1, 1]) stoneBox(F, 0.2, 2.45, 0.14, dx + s * 0.85, 0.5 + 1.225, 0.07);
  // The canopy over the door, on two iron brackets.
  stoneBox(F, 2.2, 0.14, 0.95, dx, 2.95, 0.48);
  for (const s of [-1, 1]) {
    swatchBox(F, A, 'iron', 0.05, 0.05, 0.85, dx + s * 0.9, 2.82, 0.43);
    swatchBox(F, A, 'iron', 0.05, 0.5, 0.05, dx + s * 0.9, 2.62, 0.04);
  }
  // Two steps up to it.
  stoneBox(F, 2.0, 0.25, 1.2, dx, 0.125, 0.6);
  stoneBox(F, 1.8, 0.5, 0.6, dx, 0.25, 0.3);
  // The blue lamp: on its own bracket above the canopy, four lettered panes
  // in an iron frame under a little pyramid roof.
  const lampY = 3.55;
  const lampZ = 0.75;
  swatchBox(F, A, 'iron', 0.05, 0.05, 0.75, dx, lampY + 0.42, lampZ / 2);
  const pane = 0.36;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const g = labelledBox(pane, 0.44, 0.02, { front: A.uv.lamp, back: A.uv.lamp }, A.swatch.iron);
    g.translate(0, 0, pane / 2);
    F.atlas.push(placed(g, dx, lampY, lampZ, yaw));
  }
  swatchBox(F, A, 'iron', pane + 0.08, 0.05, pane + 0.08, dx, lampY - 0.24, lampZ);
  const roof = paint(new THREE.ConeGeometry(0.33, 0.24, 4), A.swatch.iron);
  roof.rotateY(Math.PI / 4);
  F.atlas.push(at(roof, dx, lampY + 0.34, lampZ));
  F.atlas.push(at(paint(new THREE.IcosahedronGeometry(0.05, 0), A.swatch.iron), dx, lampY + 0.5, lampZ));
  // POLICE STATION across the front between the floors.
  picture(F, A, 'policeSign', 5.2, 0.62, -0.2, 3.5, 0.03, 'navy');
  // The window on the ground floor between the garage and the door.
  for (const x of [0.4]) {
    picture(F, A, 'policeWindow', 0.9, 1.35, x, 1.0 + 0.675, 0.02, 'white');
    stoneBox(F, 1.2, 0.12, 0.2, x, 0.94, 0.1);
    stoneBox(F, 1.1, 0.16, 0.12, x, 2.43, 0.06);
  }
  for (const x of [-3.3, -1.1, 1.1, 3.3]) {
    picture(F, A, 'policeWindow', 0.95, 1.45, x, 4.0 + 0.725, 0.02, 'white');
    stoneBox(F, 1.25, 0.12, 0.2, x, 3.94, 0.1);
    stoneBox(F, 1.15, 0.18, 0.12, x, 5.54, 0.06);
  }
  for (const key of Object.keys(B)) for (const g of F[key]) B[key].push(placed(g, 0, 0, front, 0));
  // Windows down both sides.
  const Sd = bucket();
  for (const x of [-1.6, 1.6]) {
    for (const y of [1.2, 4.0]) {
      picture(Sd, A, 'policeWindow', 0.95, 1.45, x, y + 0.725, 0.02, 'white');
      stoneBox(Sd, 1.25, 0.12, 0.2, x, y - 0.06, 0.1);
      stoneBox(Sd, 1.15, 0.18, 0.12, x, y + 1.54, 0.06);
    }
  }
  for (const [x, yaw] of [[half, Math.PI / 2], [-half, -Math.PI / 2]]) {
    for (const key of Object.keys(B)) for (const g of Sd[key]) B[key].push(placed(g.clone(), x, 0, 0, yaw));
  }
  // A radio mast on the roof.
  swatchBox(B, A, 'iron', 0.08, 2.4, 0.08, -3.2, S.height + 0.5 + 1.2, -1.8);
  for (const y of [1.2, 1.8, 2.3]) swatchBox(B, A, 'iron', 0.7 - y * 0.15, 0.04, 0.04, -3.2, S.height + 0.5 + y, -1.8);

  // The forecourt: tarmac with two parking bays marked out, and bollards
  // along its front edge.
  const fcD = 3.9;
  swatchBox(B, A, 'tarmac', S.width + 0.6, 0.04, fcD, 0, 0.02, front + fcD / 2);
  /* Two bays, in front of the garage and the window, for cars reversed in
     so they can leave in a hurry. Not in front of the door: the first
     layout parked the second car across it, and the test that walks up to
     the door found a police car where the pavement should be. */
  for (const x of [-3.55, -1.05, 1.35]) swatchBox(B, A, 'line', 0.08, 0.01, 3.0, x, 0.045, front + 0.4 + 1.5);
  const bollards = [];
  for (const x of [3.55, 4.45]) {
    B.atlas.push(at(paint(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 8), A.swatch.iron), x, 0.4, front + fcD - 0.15));
    B.atlas.push(at(paint(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8), A.swatch.white), x, 0.62, front + fcD - 0.15));
    bollards.push({ x, z: front + fcD - 0.15 });
  }
  return {
    B, bollards,
    footprint: { minX: -half - 0.1, maxX: half + 0.1, minZ: -front - 0.1, maxZ: front + 0.1 },
    steps: { minX: dx - 1.0, maxX: dx + 1.0, minZ: front, maxZ: front + 1.2 },
    bays: [-2.3, 0.15].map((x) => ({ x, z: front + 2.2 })),
    lamp: { x: dx, y: lampY, z: front + lampZ },
    door: { x: dx, z: front },
    garage: { x: gx, z: front },
    forecourt: { minX: -half - 0.3, maxX: half + 0.3, minZ: front, maxZ: front + fcD },
    top: S.height + 0.5 + 2.4,
  };
}

/* -------------------------------------------------------------------- */
/* The square: paving, a fountain, benches, beds, a flagpole             */
/* -------------------------------------------------------------------- */

export const PLAZA_FOUNTAIN_R = 2.0;

function buildPlaza(A, plaza) {
  const B = bucket();
  /* The square's furniture — benches and flower beds — on its own, so the
     scene can stop drawing it when it is too far off to see. */
  const F = bucket();
  const w = plaza.maxX - plaza.minX;
  const d = plaza.maxZ - plaza.minZ;
  const cx = (plaza.minX + plaza.maxX) / 2;
  const cz = (plaza.minZ + plaza.maxZ) / 2;
  // Flagstones, with a kerb of darker stone round the edge.
  B.stone.push(at(tiledBox(w, 0.06, d, 2.4), cx, 0.03, cz));
  for (const [bw, bd, bx, bz] of [
    [w + 0.3, 0.15, cx, plaza.minZ], [w + 0.3, 0.15, cx, plaza.maxZ],
    [0.15, d, plaza.minX, cz], [0.15, d, plaza.maxX, cz],
  ]) swatchBox(B, A, 'stoneShadow', bw, 0.12, bd, bx, 0.06, bz);

  // The fountain: an octagonal basin, a pedestal, two bowls and a finial.
  const f = plaza.fountain;
  const R = PLAZA_FOUNTAIN_R;
  /* The basin is a drum topped with a rim, and the water lies inside the
     rim, above the drum's top. A solid drum alone hid its own water: the
     first build put the pool inside the stone. */
  B.stone.push(at(tiledCylinder(R, R + 0.12, 0.62, 8, STONE_TILE), f.x, 0.31, f.z));
  {
    const wall = new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.16, 8, 1, true).toNonIndexed();
    const uv = wall.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 0.1);
    B.stone.push(at(wall, f.x, 0.7, f.z));
    const lip = new THREE.RingGeometry(R - 0.12, R + 0.12, 8).rotateX(-Math.PI / 2).toNonIndexed();
    B.stone.push(at(lip, f.x, 0.78, f.z));
  }
  B.stone.push(at(tiledCylinder(0.32, 0.42, 1.6, 10, STONE_TILE), f.x, 1.1, f.z));
  B.stone.push(at(tiledCylinder(1.0, 0.35, 0.28, 12, STONE_TILE), f.x, 1.95, f.z));
  B.stone.push(at(tiledCylinder(0.18, 0.24, 0.8, 10, STONE_TILE), f.x, 2.45, f.z));
  B.stone.push(at(tiledCylinder(0.5, 0.18, 0.18, 12, STONE_TILE), f.x, 2.92, f.z));
  B.atlas.push(at(paint(new THREE.SphereGeometry(0.16, 10, 8), A.swatch.copper), f.x, 3.14, f.z));

  // Benches facing the fountain, on the four diagonals.
  const benches = [];
  for (let k = 0; k < 4; k += 1) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const r = R + 1.85;
    const bx = f.x + Math.sin(a) * r;
    const bz = f.z + Math.cos(a) * r;
    if (bx < plaza.minX + 0.6 || bx > plaza.maxX - 0.6 || bz < plaza.minZ + 0.6 || bz > plaza.maxZ - 0.6) continue;
    const parts = [];
    parts.push(paint(new THREE.BoxGeometry(1.6, 0.06, 0.42), A.swatch.wood).translate(0, 0.46, 0));
    parts.push(paint(new THREE.BoxGeometry(1.6, 0.36, 0.05), A.swatch.wood).translate(0, 0.74, -0.2));
    for (const s of [-1, 1]) {
      parts.push(paint(new THREE.BoxGeometry(0.06, 0.46, 0.4), A.swatch.iron).translate(s * 0.7, 0.23, 0));
      parts.push(paint(new THREE.BoxGeometry(0.06, 0.5, 0.05), A.swatch.iron).translate(s * 0.7, 0.7, -0.21));
    }
    // Turned to face the fountain: the bench's +z is its front.
    const yaw = Math.atan2(f.x - bx, f.z - bz);
    for (const g of parts) F.atlas.push(placed(g, bx, 0, bz, yaw));
    benches.push({ x: bx, z: bz, yaw });
  }

  // Flower beds in the corners the flagpole is not in.
  const beds = [];
  for (const [bx, bz] of plaza.beds) {
    swatchBox(F, A, 'stoneShadow', 1.9, 0.32, 1.2, bx, 0.16, bz);
    swatchBox(F, A, 'soil', 1.7, 0.04, 1.0, bx, 0.34, bz);
    /* One mound of green and a scatter of blooms on it, rather than a
       plant per flower: from the far side of the square the bed reads the
       same, and it was seventeen hundred triangles of the fountain's
       square on its own. */
    const mound = paint(new THREE.IcosahedronGeometry(0.5, 1), A.swatch.leaf);
    mound.scale(1.55, 0.32, 0.85);
    F.atlas.push(at(mound, bx, 0.38, bz));
    const colours = ['red', 'yellow', 'pink', 'purple'];
    for (let i = 0; i < 10; i += 1) {
      const fx = bx - 0.62 + (i % 5) * 0.31;
      const fz = bz - 0.2 + Math.floor(i / 5) * 0.4 + (i % 2) * 0.06;
      F.atlas.push(at(paint(new THREE.BoxGeometry(0.11, 0.08, 0.11), A.swatch[colours[i % 4]]), fx, 0.53, fz));
    }
    beds.push({ x: bx, z: bz });
  }

  // The flagpole, on a stepped stone base.
  const p = plaza.flagpole;
  stoneBox(B, 0.9, 0.2, 0.9, p.x, 0.1, p.z);
  stoneBox(B, 0.6, 0.2, 0.6, p.x, 0.3, p.z);
  B.atlas.push(at(paint(new THREE.CylinderGeometry(0.05, 0.08, 7.0, 8), A.swatch.white), p.x, 0.4 + 3.5, p.z));
  B.atlas.push(at(paint(new THREE.IcosahedronGeometry(0.12, 0), A.swatch.gold), p.x, 7.5, p.z));
  return { B, F, benches, beds };
}

/* -------------------------------------------------------------------- */
/* Assembly                                                              */
/* -------------------------------------------------------------------- */

function worldBox(x, z, yaw, r, id, height) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const xs = [];
  const zs = [];
  for (const lx of [r.minX, r.maxX]) for (const lz of [r.minZ, r.maxZ]) {
    xs.push(x + lx * c + lz * s);
    zs.push(z - lx * s + lz * c);
  }
  return {
    id, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
    minY: 0, maxY: height,
  };
}

/**
 * Builds the City Hall at `hall` = { x, z, yaw }, the Police Station at
 * `police` = { x, z, yaw } (each yaw turning its front, +z, to face the
 * street), and the square `plaza` = { minX, maxX, minZ, maxZ, fountain,
 * flagpole, beds }. Returns { object, solids, report, update }, where
 * update(phase, t) sets the clock to a day phase (0 at noon, as
 * daySkyState gives it) and lets the flag move with the time t in seconds.
 */
export function buildCivic({ hall, police, plaza, anisotropy = 1 }) {
  const A = makeAtlas();
  const group = new THREE.Group();
  group.name = 'civic';
  const all = bucket();
  const solids = [];

  const H = buildHall(A);
  for (const key of Object.keys(all)) for (const g of H.B[key]) all[key].push(placed(g, hall.x, 0, hall.z, hall.yaw));
  solids.push(worldBox(hall.x, hall.z, hall.yaw, H.footprint, 'city-hall', H.top));
  solids.push(worldBox(hall.x, hall.z, hall.yaw, H.steps, 'city-hall', HALL.podium));

  const P = buildPolice(A);
  for (const key of Object.keys(all)) for (const g of P.B[key]) all[key].push(placed(g, police.x, 0, police.z, police.yaw));
  solids.push(worldBox(police.x, police.z, police.yaw, P.footprint, 'police-station', P.top));
  solids.push(worldBox(police.x, police.z, police.yaw, P.steps, 'police-station', 0.5));
  for (const b of P.bollards) {
    solids.push(worldBox(police.x, police.z, police.yaw,
      { minX: b.x - 0.13, maxX: b.x + 0.13, minZ: b.z - 0.13, maxZ: b.z + 0.13 }, 'bollard', 0.8));
  }

  const Q = buildPlaza(A, plaza);
  for (const key of Object.keys(all)) all[key].push(...Q.B[key]);
  const f = plaza.fountain;
  /* Two boxes for the one fountain: the basin, wide and knee-high, and the
     pedestal and bowls standing up out of the middle of it. Together they
     stop her where the stone does, and apart they say what is tall and what
     is not — an arm of a fingerpost can pass over a basin. */
  /* The basin as a circle rather than a box: a square round an octagon
     reaches three units out at its corners, and with the benches at three
     and a half that closed the way round the fountain on all four
     diagonals. The posts list is where round solids go. */
  const posts = [{ id: 'plaza-fountain', x: f.x, z: f.z, r: PLAZA_FOUNTAIN_R + 0.12, height: 0.8 }];
  solids.push({ id: 'plaza-fountain', minX: f.x - 1.0, maxX: f.x + 1.0, minZ: f.z - 1.0, maxZ: f.z + 1.0, minY: 0, maxY: 3.3 });
  for (const b of Q.benches) {
    solids.push(worldBox(b.x, b.z, b.yaw, { minX: -0.4, maxX: 0.4, minZ: -0.25, maxZ: 0.25 }, 'bench', 0.95));
  }
  for (const b of Q.beds) {
    solids.push({ id: 'flower-bed', minX: b.x - 0.95, maxX: b.x + 0.95, minZ: b.z - 0.6, maxZ: b.z + 0.6, minY: 0, maxY: 0.6 });
  }
  const fp = plaza.flagpole;
  solids.push({ id: 'flagpole', minX: fp.x - 0.45, maxX: fp.x + 0.45, minZ: fp.z - 0.45, maxZ: fp.z + 0.45, minY: 0, maxY: 7.6 });

  const tex = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };
  const stoneMat = new THREE.MeshStandardMaterial({ name: 'civic-stone', map: tiled(stoneCanvas(), anisotropy), roughness: 0.88 });
  const brickMat = new THREE.MeshStandardMaterial({ name: 'civic-brick', map: tiled(brickCanvas(), anisotropy), roughness: 0.92 });
  const atlasMat = new THREE.MeshStandardMaterial({
    name: 'civic', map: tex(A.canvas), roughness: 0.7, metalness: 0,
    emissive: 0xffffff, emissiveMap: tex(A.glow), emissiveIntensity: 0.5,
  });
  const meshes = {};
  for (const [key, mat] of [['stone', stoneMat], ['brick', brickMat], ['atlas', atlasMat]]) {
    const mesh = new THREE.Mesh(mergeGeometries(all[key], false), mat);
    for (const g of all[key]) g.dispose();
    mesh.name = `civic-${key}`;
    group.add(mesh);
    meshes[key] = mesh;
  }

  /* The square's furniture, its own mesh on the same atlas, for the scene
     to leave undrawn from far off. */
  const furniture = new THREE.Mesh(mergeGeometries(Q.F.atlas, false), atlasMat);
  for (const g of Q.F.atlas) g.dispose();
  furniture.name = 'civic-furniture';
  group.add(furniture);

  // Water, in the fountain's basin and its upper bowl.
  const water = new THREE.MeshStandardMaterial({ name: 'civic-water', color: 0x3f7fa6, roughness: 0.15, metalness: 0 });
  const pool = new THREE.Mesh(mergeGeometries([
    new THREE.CircleGeometry(PLAZA_FOUNTAIN_R - 0.1, 8).rotateX(-Math.PI / 2).translate(f.x, 0.7, f.z),
    new THREE.CircleGeometry(0.92, 12).rotateX(-Math.PI / 2).translate(f.x, 2.11, f.z),
  ], false), water);
  pool.name = 'civic-water';
  group.add(pool);

  // The clock's hands: one hour and one minute hand per dial, each a mesh
  // turned about the dial's centre.
  const handMat = new THREE.MeshStandardMaterial({ name: 'civic-hands', color: 0x141414, roughness: 0.5 });
  const hands = [];
  for (const d of H.dials) {
    const hourG = new THREE.BoxGeometry(0.09, HALL.tower.clockR * 0.55, 0.03).translate(0, HALL.tower.clockR * 0.22, 0);
    const minG = new THREE.BoxGeometry(0.06, HALL.tower.clockR * 0.82, 0.03).translate(0, HALL.tower.clockR * 0.36, 0);
    const pivot = new THREE.Group();
    // Dial centre in world space.
    const c = Math.cos(hall.yaw);
    const s = Math.sin(hall.yaw);
    pivot.position.set(hall.x + d.x * c + d.z * s, HALL.tower.clockY, hall.z - d.x * s + d.z * c);
    pivot.rotation.y = hall.yaw + d.yaw;
    const hour = new THREE.Mesh(hourG, handMat);
    const minute = new THREE.Mesh(minG, handMat);
    hour.position.z = 0.04;
    minute.position.z = 0.06;
    pivot.add(hour, minute);
    group.add(pivot);
    hands.push({ hour, minute, pivot });
  }

  // The flag: a cloth that ripples, out from the top of the pole.
  const flagW = 1.6;
  const flagH = 1.0;
  const flagG = new THREE.PlaneGeometry(flagW, flagH, 10, 4);
  {
    const uv = flagG.getAttribute('uv');
    const m = A.uv.flag;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, m.u0 + uv.getX(i) * (m.u1 - m.u0), m.v0 + uv.getY(i) * (m.v1 - m.v0));
    flagG.translate(flagW / 2, 0, 0);
  }
  const rest = flagG.getAttribute('position').array.slice();
  const flagMat = new THREE.MeshStandardMaterial({ name: 'civic-flag', map: atlasMat.map, roughness: 0.8, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(flagG, flagMat);
  flag.position.set(fp.x + 0.06, 7.4 - flagH / 2, fp.z);
  flag.rotation.y = plaza.flagYaw ?? 0;
  flag.name = 'civic-flag';
  group.add(flag);

  let shown = null;
  function update(phase, t) {
    /* phase is 0 at noon and 0.5 at midnight, so the hour is twelve plus a
       day's worth of the phase. Hands turn clockwise seen from the front,
       which about the dial's +z axis is a negative rotation. */
    const hours = (12 + phase * 24) % 24;
    const minuteTurn = (hours % 1);
    const hourTurn = (hours % 12) / 12;
    for (const h of hands) {
      h.hour.rotation.z = -hourTurn * Math.PI * 2;
      h.minute.rotation.z = -minuteTurn * Math.PI * 2;
    }
    /* What the hands actually show, read back off the meshes rather than
       restated from the sum above: a test of the clock is a test of where
       the hands point. Clockwise from twelve, in degrees. */
    const deg = (r) => ((((-r * 180) / Math.PI) % 360) + 360) % 360;
    shown = {
      hours,
      hourAngle: deg(hands[0].hour.rotation.z),
      minuteAngle: deg(hands[0].minute.rotation.z),
      dials: hands.length,
    };
    // The flag: a travelling wave, growing from nothing at the pole to its
    // full height at the fly.
    const pos = flagG.getAttribute('position');
    for (let i = 0; i < pos.count; i += 1) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const k = x / flagW;
      pos.setZ(i, Math.sin(x * 3.2 - t * 4.5 + y * 0.8) * 0.12 * k);
    }
    pos.needsUpdate = true;
    flagG.computeVertexNormals();
  }
  update(0, 0);

  const report = {
    hall: {
      x: hall.x, z: hall.z, faceX: Math.sin(hall.yaw), faceZ: Math.cos(hall.yaw),
      top: H.top, dials: H.dials.length, columns: HALL.portico.columns,
      door: { x: hall.x + Math.sin(hall.yaw) * (H.door.z), z: hall.z + Math.cos(hall.yaw) * H.door.z },
      steps: worldBox(hall.x, hall.z, hall.yaw, H.steps, 'steps', 0),
    },
    police: {
      x: police.x, z: police.z, faceX: Math.sin(police.yaw), faceZ: Math.cos(police.yaw),
      top: P.top,
      door: (() => {
        const c = Math.cos(police.yaw);
        const s = Math.sin(police.yaw);
        return { x: police.x + P.door.x * c + P.door.z * s, z: police.z - P.door.x * s + P.door.z * c };
      })(),
      lamp: (() => {
        const c = Math.cos(police.yaw);
        const s = Math.sin(police.yaw);
        return { x: police.x + P.lamp.x * c + P.lamp.z * s, y: P.lamp.y, z: police.z - P.lamp.x * s + P.lamp.z * c };
      })(),
      forecourt: worldBox(police.x, police.z, police.yaw, P.forecourt, 'forecourt', 0),
      bays: P.bays.map((b) => {
        const c = Math.cos(police.yaw);
        const s = Math.sin(police.yaw);
        return { x: police.x + b.x * c + b.z * s, z: police.z - b.x * s + b.z * c };
      }),
    },
    plaza: { ...plaza, benches: Q.benches.length, beds: Q.beds.length },
    atlas: { width: A.width, height: A.height },
    triangles: Object.values(meshes).reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0),
  };
  return {
    object: group, solids, posts, report, update, clock: () => shown,
    materials: { atlas: atlasMat }, detail: [furniture],
  };
}
