/* highstreet.js — the shopfronts of Farm City's High Street.
 *
 * The buildings themselves are the City Kit (Commercial): six blocks of two
 * to four storeys, placed and made solid by scene.js like every other kit
 * model. What the kit does not have is a shop. Its ground floors are a band
 * of dark grey with, on two of the six, a door; there is no window to look
 * into, no name over the door and nothing to say what is sold inside. A
 * street of those reads as offices.
 *
 * So everything that makes a ground floor a shop is built here, in front of
 * the kit's wall: a painted shopfront with pilasters, a stallriser, display
 * windows with the goods drawn inside them and a door; a fascia with the
 * shop's name signwritten on it; a striped canvas awning with a scalloped
 * valance; a hanging sign on an iron bracket with a picture of the trade;
 * and, outside the cafés, a terrace of tables under parasols.
 *
 * The shops are seen from outside and never entered. The doors are painted
 * and the kit block behind them is solid, which is the brief.
 *
 * All of it — every shop on the street — is one mesh on one atlas, the
 * method signs.js established: the stable's first build cost forty-seven
 * draw calls, and a high street of separately-drawn awnings and chairs
 * would cost hundreds. A second texture of the same layout carries only
 * the display windows and is the material's emissive map, so the windows
 * read as lit rooms behind glass and the paintwork beside them does not.
 *
 * Nothing here reaches into the scene. buildHighStreet takes a description
 * of each shopfront and hands back an Object3D, the collision boxes for what
 * stands on the pavement, and a report a test can hold it to.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, labelledBox, placed } from './signs.js';

/* A shopfront, in world units measured out from the face of the wall.

   The heights are set by two things that are not negotiable. The kit's
   ground floor stops at 2.55 (measured off an orthographic render at 200
   pixels to the kit unit, and the same on all five blocks), so the fascia
   sits across that line and covers it. And the farmer stands 1.62,
   measured off her own model, so the lowest edge of anything she can walk
   under has to clear that. The first build was drawn against a figure of
   1.45 from an older note, hung the awnings' valances at 1.58, and the
   test that asks her model caught it. */
export const FRONT = {
  pilaster: 0.2,
  riser: 0.45,
  windowTop: 1.84,
  door: { w: 1.0, h: 1.85 },
  fascia: { bottom: 2.2, height: 0.52, proud: 0.16 },
  awning: { hinge: 2.14, reach: 1.0, drop: 0.2, valance: 0.2, wall: 0.1 },
  bracket: { y: 3.62, reach: 0.95, plaque: 0.74 },
};

/* How far out from the wall a café's tables stand. The pavement on the
   north side is about two and a half units from wall to kerb; a table at
   1.3 leaves the width of a person behind it and keeps its chairs, which
   are what a car would hit, three units from the middle of the road. */
export const TERRACE_OUT = 1.3;
/* And the A-boards, which stand further out than the tables but not on
   the kerb: at the street's west end High Street bends towards the square
   and the pavement narrows, and the bakery's board at 1.75 stood 2.38 from
   the middle of the road. */
const ABOARD_OUT = 1.55;

/* A café parasol: the pole's height, the canopy's radius and rise, and the
   skirt that hangs from its rim. The rim — the lowest thing on it — is
   what she walks under. */
const PARASOL = { pole: 2.36, r: 0.98, h: 0.34, skirt: 0.12 };
const PARASOL_RIM = PARASOL.pole - PARASOL.h + 0.06 - PARASOL.skirt;

/* Common paint, alongside each shop's own colours. */
const PAINT = {
  iron: '#1d1d1f',
  gold: '#c9a227',
  cream: '#f1e8cf',
  white: '#f6f4ee',
  table: '#e9e6df',
  chair: '#2b2d31',
  terracotta: '#b65a3a',
  leaf: '#3f7a3a',
  leafDark: '#2d5e2b',
  bloomRed: '#d8433b',
  bloomYellow: '#efc23a',
  bloomPink: '#e889b5',
  wood: '#8a5a33',
  woodDark: '#5d3b20',
  slate: '#26292b',
  sack: '#d9c49a',
  orange: '#e8892a',
  apple: '#c8302b',
  cabbage: '#7fb04d',
  stone: '#9a958b',
};

const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, "DejaVu Sans", sans-serif';

/* Texels to the world unit for the fascia lettering. The camera sees a
   fascia from about eight units off at 80 pixels to the unit, so 128 is
   enough to stay sharp when she walks up to it and not so much that the
   atlas grows a second megabyte for nobody. */
const FASCIA_PX = 128;
const PAD = 4;
const SWATCH = 16;

/* -------------------------------------------------------------------- */
/* The atlas                                                             */
/* -------------------------------------------------------------------- */

function makeAtlas(units) {
  const colours = new Set(Object.values(PAINT));
  for (const u of units) for (const c of Object.values(u.colours)) if (c) colours.add(c);

  const cells = [];
  const kinds = [...new Set(units.map((u) => u.kind))];
  for (const u of units) {
    cells.push({ kind: 'fascia', unit: u, w: Math.round(FASCIA_PX * (u.width + 0.06)), h: Math.round(FASCIA_PX * FRONT.fascia.height) });
  }
  for (const k of kinds) cells.push({ kind: 'window', shop: k, w: 320, h: 144 });
  for (const u of units) {
    if (u.awning === false) continue;
    cells.push({ kind: 'stripes', unit: u, w: 256, h: 96 });
    cells.push({ kind: 'valance', unit: u, w: 256, h: 40 });
  }
  for (const u of units) cells.push({ kind: 'plaque', unit: u, w: 128, h: 128 });
  const boards = [...new Set(units.flatMap((u) => (u.aboard ? [u.aboard.join('\n')] : [])))];
  for (const text of boards) cells.push({ kind: 'chalk', text, w: 128, h: 176 });
  cells.push({ kind: 'sack', w: 96, h: 64 });
  for (const c of colours) cells.push({ kind: 'swatch', colour: c, w: SWATCH, h: SWATCH });

  const WIDTH = 2048;
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of cells) {
    if (x + c.w + PAD > WIDTH) { x = 0; y += rowH + PAD; rowH = 0; }
    c.x = x; c.y = y;
    x += c.w + PAD;
    rowH = Math.max(rowH, c.h);
  }
  const HEIGHT = 2 ** Math.ceil(Math.log2(Math.max(y + rowH, 64)));

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAINT.white;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  /* The glow map: black everywhere but the display windows, which are the
     only part of a shop lit from inside. */
  const glow = document.createElement('canvas');
  glow.width = WIDTH;
  glow.height = HEIGHT;
  const gctx = glow.getContext('2d');
  gctx.fillStyle = '#000';
  gctx.fillRect(0, 0, WIDTH, HEIGHT);

  const fascia = {};
  for (const c of cells) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    if (c.kind === 'swatch') {
      ctx.fillStyle = c.colour;
      ctx.fillRect(c.x, c.y, c.w, c.h);
    } else if (c.kind === 'fascia') {
      fascia[c.unit.id] = drawFascia(ctx, c, c.unit);
    } else if (c.kind === 'window') {
      drawWindow(ctx, c, c.shop);
      /* What glows is the room, not the reflection drawn over it, so the
         glow map gets the interior's light without the streaks. */
      gctx.save();
      const grad = gctx.createLinearGradient(0, c.y, 0, c.y + c.h);
      grad.addColorStop(0, '#5a4630');
      grad.addColorStop(1, '#2a2016');
      gctx.fillStyle = grad;
      gctx.fillRect(c.x, c.y, c.w, c.h);
      gctx.restore();
    } else if (c.kind === 'stripes') {
      drawStripes(ctx, c, c.unit);
    } else if (c.kind === 'valance') {
      drawValance(ctx, c, c.unit);
    } else if (c.kind === 'plaque') {
      drawPlaque(ctx, c, c.unit);
    } else if (c.kind === 'chalk') {
      drawChalk(ctx, c, c.text.split('\n'));
    } else if (c.kind === 'sack') {
      drawSack(ctx, c);
    }
    ctx.restore();
  }

  const uvOf = (c) => ({
    u0: (c.x + 0.5) / WIDTH,
    u1: (c.x + c.w - 0.5) / WIDTH,
    v0: 1 - (c.y + c.h - 0.5) / HEIGHT,
    v1: 1 - (c.y + 0.5) / HEIGHT,
  });
  const find = (pred) => uvOf(cells.find(pred));
  return {
    canvas, glow, fascia, width: WIDTH, height: HEIGHT,
    swatch: (colour) => find((c) => c.kind === 'swatch' && c.colour === colour),
    fasciaUV: (u) => find((c) => c.kind === 'fascia' && c.unit === u),
    windowUV: (kind) => find((c) => c.kind === 'window' && c.shop === kind),
    stripesUV: (u) => find((c) => c.kind === 'stripes' && c.unit === u),
    valanceUV: (u) => find((c) => c.kind === 'valance' && c.unit === u),
    plaqueUV: (u) => find((c) => c.kind === 'plaque' && c.unit === u),
    chalkUV: (lines) => find((c) => c.kind === 'chalk' && c.text === lines.join('\n')),
    sackUV: () => find((c) => c.kind === 'sack'),
  };
}

/* The name over the door, signwritten: the shop's colour, a gilt line
   inset from the edge, and the name in cream serif capitals shaded the way
   a signwriter shades gold leaf. One line, as large as it fits. */
function drawFascia(ctx, c, u) {
  const { x, y, w, h } = c;
  ctx.fillStyle = u.colours.paint;
  ctx.fillRect(x, y, w, h);
  const inset = Math.round(h * 0.12);
  ctx.strokeStyle = PAINT.gold;
  ctx.lineWidth = Math.max(2, Math.round(h * 0.035));
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);

  const text = u.name.toUpperCase();
  let size = Math.round(h * 0.6);
  const room = w - inset * 4;
  ctx.font = `bold ${size}px ${SERIF}`;
  while (size > 10 && ctx.measureText(text).width > room) {
    size -= 1;
    ctx.font = `bold ${size}px ${SERIF}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = x + w / 2;
  const cy = y + h / 2 + size * 0.05;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(text, cx + size * 0.05, cy + size * 0.06);
  ctx.fillStyle = u.colours.ink ?? PAINT.cream;
  ctx.fillText(text, cx, cy);
  // Cap height, in world units, which is what the test holds it to.
  return { px: size, capUnits: (size * 0.7) * (FRONT.fascia.height / h) };
}

/* A display window: a warm room behind glass, with what the shop sells on
   shelves and counters, and the two pale diagonal streaks that are how a
   painter says "glass" without having to render it. */
function drawWindow(ctx, c, kind) {
  const { x, y, w, h } = c;
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#f3d9a4');
  grad.addColorStop(0.7, '#c9965c');
  grad.addColorStop(1, '#7b5634');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  const shelf = (sy) => {
    ctx.fillStyle = '#6b4526';
    ctx.fillRect(x + 6, y + sy, w - 12, 5);
  };
  const r = (n) => {
    // Deterministic jitter, so the same shop looks the same on every load.
    const s = Math.sin(n * 12.9898 + kind.length * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  if (kind === 'grocer') {
    for (let row = 0; row < 2; row += 1) {
      const sy = 40 + row * 50;
      for (let k = 0; k < 6; k += 1) {
        const bx = x + 12 + k * 50;
        ctx.fillStyle = '#9b6b3f';
        ctx.fillRect(bx, y + sy, 42, 22);
        const fruit = ['#e8892a', '#c8302b', '#7fb04d', '#efc23a', '#6e3a7a', '#c8302b'][(k + row) % 6];
        ctx.fillStyle = fruit;
        for (let f = 0; f < 5; f += 1) {
          ctx.beginPath();
          ctx.arc(bx + 6 + f * 8, y + sy - 2 - (f % 2) * 4, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  } else if (kind === 'bakery') {
    shelf(46); shelf(92);
    for (let k = 0; k < 7; k += 1) {
      ctx.fillStyle = k % 2 ? '#b8752f' : '#d39a4c';
      ctx.beginPath();
      ctx.ellipse(x + 30 + k * 42, y + 36, 17, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a4f1c';
      ctx.lineWidth = 2;
      for (let s = -1; s <= 1; s += 1) {
        ctx.beginPath();
        ctx.moveTo(x + 30 + k * 42 + s * 7 - 3, y + 31);
        ctx.lineTo(x + 30 + k * 42 + s * 7 + 3, y + 41);
        ctx.stroke();
      }
    }
    for (let k = 0; k < 5; k += 1) {
      const cx = x + 40 + k * 60;
      ctx.fillStyle = '#f7f1e6';
      ctx.fillRect(cx - 20, y + 70, 40, 22);
      ctx.fillStyle = ['#e889b5', '#6b3a1f', '#efc23a', '#e889b5', '#c8302b'][k];
      ctx.fillRect(cx - 20, y + 66, 40, 8);
    }
    ctx.fillStyle = '#eadfca';
    ctx.fillRect(x, y + h - 34, w, 34);
  } else if (kind === 'cafe') {
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(x + w - 110, y + 14, 92, 56);
    ctx.fillStyle = '#f1e8cf';
    ctx.font = `bold 13px ${SANS}`;
    ctx.textAlign = 'left';
    ['COFFEE', 'TEA', 'CAKE'].forEach((t, i) => ctx.fillText(t, x + w - 100, y + 32 + i * 15));
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(x, y + h - 46, w, 46);
    for (let k = 0; k < 5; k += 1) {
      const cx = x + 26 + k * 40;
      ctx.fillStyle = '#f6f4ee';
      ctx.fillRect(cx - 9, y + h - 62, 18, 16);
      ctx.fillRect(cx + 9, y + h - 58, 5, 8);
    }
    for (let k = 0; k < 3; k += 1) {
      ctx.fillStyle = 'rgba(255,240,200,0.9)';
      ctx.beginPath();
      ctx.arc(x + 60 + k * 90, y + 12, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'restaurant') {
    for (let k = 0; k < 3; k += 1) {
      const cx = x + 55 + k * 105;
      ctx.fillStyle = '#f6f4ee';
      ctx.fillRect(cx - 34, y + 86, 68, 24);
      ctx.fillStyle = '#c9c3b6';
      ctx.fillRect(cx - 34, y + 106, 68, 6);
      ctx.fillStyle = '#3a2416';
      ctx.fillRect(cx - 44, y + 70, 9, 48);
      ctx.fillRect(cx + 35, y + 70, 9, 48);
      ctx.fillStyle = '#f7f1e6';
      ctx.fillRect(cx - 2, y + 70, 4, 16);
      ctx.fillStyle = 'rgba(255,220,120,0.95)';
      ctx.beginPath();
      ctx.arc(cx, y + 67, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,190,0.9)';
      ctx.beginPath();
      ctx.arc(cx, y + 18, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'hardware') {
    ctx.fillStyle = '#b48a5a';
    ctx.fillRect(x + 8, y + 8, w - 16, 84);
    ctx.fillStyle = '#8f6a42';
    for (let px = 0; px < 18; px += 1) for (let py = 0; py < 5; py += 1) {
      ctx.fillRect(x + 16 + px * 16, y + 14 + py * 16, 3, 3);
    }
    const tool = (tx, ty, kindOf) => {
      ctx.fillStyle = '#6b4526';
      ctx.fillRect(tx - 2, ty, 4, 50);
      ctx.fillStyle = '#5f6670';
      if (kindOf === 0) ctx.fillRect(tx - 10, ty + 44, 20, 16);
      else if (kindOf === 1) ctx.fillRect(tx - 12, ty - 4, 24, 8);
      else { ctx.beginPath(); ctx.moveTo(tx - 10, ty + 44); ctx.lineTo(tx + 10, ty + 44); ctx.lineTo(tx, ty + 64); ctx.fill(); }
    };
    for (let k = 0; k < 8; k += 1) tool(x + 30 + k * 36, y + 16 + (k % 2) * 6, k % 3);
    ctx.fillStyle = '#d9c49a';
    for (let k = 0; k < 4; k += 1) ctx.fillRect(x + 20 + k * 74, y + h - 40, 62, 36);
    ctx.fillStyle = '#7a5b2e';
    ctx.font = `bold 12px ${SANS}`;
    ctx.textAlign = 'center';
    for (let k = 0; k < 4; k += 1) ctx.fillText('FEED', x + 51 + k * 74, y + h - 18);
  } else if (kind === 'pharmacy') {
    ctx.fillStyle = '#eef4f0';
    ctx.fillRect(x, y, w, h);
    shelf(44); shelf(88);
    for (let row = 0; row < 2; row += 1) {
      for (let k = 0; k < 16; k += 1) {
        ctx.fillStyle = ['#3d8bd8', '#f6f4ee', '#d8433b', '#4fae6a', '#efc23a'][Math.floor(r(k + row * 16) * 5)];
        const bh = 14 + Math.floor(r(k * 3 + row) * 12);
        ctx.fillRect(x + 12 + k * 19, y + 44 + row * 44 - bh, 13, bh);
      }
    }
    ctx.fillStyle = '#1f9a55';
    ctx.fillRect(x + w / 2 - 8, y + 100, 16, 40);
    ctx.fillRect(x + w / 2 - 20, y + 112, 40, 16);
  }

  // The glass: a darker band at the top where the awning shades it, and
  // two pale diagonal streaks.
  const shade = ctx.createLinearGradient(0, y, 0, y + h * 0.35);
  shade.addColorStop(0, 'rgba(20,24,30,0.45)');
  shade.addColorStop(1, 'rgba(20,24,30,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, h * 0.35);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (const [a, b] of [[0.18, 0.12], [0.62, 0.05]]) {
    ctx.beginPath();
    ctx.moveTo(x + w * a, y + h);
    ctx.lineTo(x + w * (a + b), y + h);
    ctx.lineTo(x + w * (a + b + 0.3), y);
    ctx.lineTo(x + w * (a + 0.3), y);
    ctx.closePath();
    ctx.fill();
  }
}

/* Awning canvas: stripes down the slope, about a quarter of a unit each.
   The cell is drawn with exactly the number of stripes the awning's width
   wants, so every awning's stripes are the same width as every other's. */
function stripeCount(u) {
  return Math.max(4, Math.round((u.width - 2 * FRONT.pilaster) / 0.26));
}

function drawStripes(ctx, c, u) {
  const n = stripeCount(u);
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = i % 2 ? u.colours.stripe : PAINT.white;
    const x0 = c.x + Math.floor((i * c.w) / n);
    const x1 = c.x + Math.floor(((i + 1) * c.w) / n);
    ctx.fillRect(x0, c.y, x1 - x0, c.h);
  }
  // A soft shadow in the folds at the top, where the canvas meets its roller.
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h * 0.3);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x, c.y, c.w, c.h * 0.3);
}

/* The valance: the same stripes, with the bottom edge cut into scallops.
   The cut is real — transparent texels the material discards with an
   alpha test — so the scallops have sky between them rather than being a
   painted pattern on a straight strip. */
function drawValance(ctx, c, u) {
  ctx.clearRect(c.x, c.y, c.w, c.h);
  const n = stripeCount(u);
  const sw = c.w / n;
  const top = c.h * 0.5;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + c.w, c.y);
  ctx.lineTo(c.x + c.w, c.y + top);
  for (let i = n - 1; i >= 0; i -= 1) {
    const cx = c.x + (i + 0.5) * sw;
    ctx.arc(cx, c.y + top, sw / 2, 0, Math.PI, false);
  }
  ctx.closePath();
  ctx.save();
  ctx.clip();
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = i % 2 ? u.colours.stripe : PAINT.white;
    ctx.fillRect(c.x + Math.floor(i * sw), c.y, Math.ceil(sw) + 1, c.h);
  }
  ctx.fillStyle = u.colours.stripe;
  ctx.fillRect(c.x, c.y, c.w, Math.max(2, c.h * 0.12));
  ctx.restore();
}

/* The hanging sign: the trade drawn, not written, because a picture reads
   from further off than a word does and that is what a hanging sign is for. */
function drawPlaque(ctx, c, u) {
  const { x, y, w, h } = c;
  const kind = u.kind;
  ctx.fillStyle = kind === 'pharmacy' ? PAINT.white : u.colours.paint;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PAINT.gold;
  ctx.lineWidth = 6;
  ctx.strokeRect(x + 7, y + 7, w - 14, h - 14);
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.fillStyle = PAINT.cream;
  ctx.strokeStyle = PAINT.cream;
  ctx.lineCap = 'round';
  if (kind === 'grocer') {
    ctx.fillStyle = PAINT.apple;
    ctx.beginPath();
    ctx.arc(cx - 11, cy + 6, 22, 0, Math.PI * 2);
    ctx.arc(cx + 11, cy + 6, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5d3b20';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx + 4, cy - 30); ctx.stroke();
    ctx.fillStyle = PAINT.cabbage;
    ctx.beginPath(); ctx.ellipse(cx + 16, cy - 26, 12, 6, -0.5, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'bakery') {
    ctx.fillStyle = '#d39a4c';
    ctx.beginPath(); ctx.ellipse(cx, cy + 4, 40, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a4f1c';
    ctx.lineWidth = 5;
    for (let s = -1; s <= 1; s += 1) {
      ctx.beginPath(); ctx.moveTo(cx + s * 16 - 7, cy - 10); ctx.lineTo(cx + s * 16 + 7, cy + 16); ctx.stroke();
    }
  } else if (kind === 'cafe') {
    ctx.fillStyle = PAINT.cream;
    ctx.fillRect(cx - 26, cy - 8, 44, 34);
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(cx + 22, cy + 8, 11, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.fillRect(cx - 34, cy + 28, 62, 6);
    ctx.lineWidth = 4;
    for (let s = -1; s <= 1; s += 1) {
      ctx.beginPath();
      ctx.moveTo(cx - 4 + s * 12, cy - 14);
      ctx.bezierCurveTo(cx - 14 + s * 12, cy - 24, cx + 6 + s * 12, cy - 30, cx - 4 + s * 12, cy - 40);
      ctx.stroke();
    }
  } else if (kind === 'restaurant') {
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(cx - 16, cy - 36); ctx.lineTo(cx - 16, cy + 38); ctx.stroke();
    for (let t = -1; t <= 1; t += 1) {
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx - 16 + t * 8, cy - 38); ctx.lineTo(cx - 16 + t * 8, cy - 14); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx + 16, cy + 38);
    ctx.lineTo(cx + 16, cy - 38);
    ctx.quadraticCurveTo(cx + 34, cy - 20, cx + 16, cy);
    ctx.lineWidth = 8;
    ctx.stroke();
  } else if (kind === 'hardware') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.7);
    ctx.fillStyle = PAINT.wood;
    ctx.fillRect(-5, -10, 10, 52);
    ctx.fillStyle = PAINT.cream;
    ctx.fillRect(-22, -30, 44, 20);
    ctx.restore();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.7);
    ctx.fillStyle = PAINT.cream;
    ctx.fillRect(-4, -36, 8, 62);
    ctx.beginPath(); ctx.arc(0, -36, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = u.colours.paint;
    ctx.fillRect(-4, -50, 8, 14);
    ctx.restore();
  } else if (kind === 'pharmacy') {
    ctx.fillStyle = '#1f9a55';
    ctx.fillRect(cx - 14, cy - 40, 28, 80);
    ctx.fillRect(cx - 40, cy - 14, 80, 28);
  }
}

/* The café's board on the pavement: a slate with the day's offer chalked
   on it, in a wooden frame. */
function drawChalk(ctx, c, lines) {
  const { x, y, w, h } = c;
  ctx.fillStyle = PAINT.woodDark;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PAINT.slate;
  ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
  ctx.fillStyle = '#ece9df';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}${i === 0 ? 22 : 17}px ${SANS}`;
    ctx.fillText(line, x + w / 2, y + 34 + i * 30);
  });
}

function drawSack(ctx, c) {
  ctx.fillStyle = PAINT.sack;
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.fillStyle = '#7a5b2e';
  ctx.font = `bold 22px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FEED', c.x + c.w / 2, c.y + c.h / 2);
}

/* -------------------------------------------------------------------- */
/* Geometry                                                              */
/* -------------------------------------------------------------------- */

const box = (w, h, d, uv) => paint(new THREE.BoxGeometry(w, h, d), uv);
const at = (g, x, y, z) => g.translate(x, y, z);

/* A rod from one point to another in the shop's own frame, for the iron
   work: awning arms, the bracket's brace, a parasol's ribs. */
function rod(a, b, thick, uv) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = box(thick, d.length(), thick, uv);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(q);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return g.translate(mid.x, mid.y, mid.z);
}

/* Where the door goes along the frontage, and the windows either side of
   it. Returns the door's centre and the spans of wall that are glass. */
function frontageLayout(u) {
  const half = u.width / 2;
  const P = FRONT.pilaster;
  const dw = FRONT.door.w;
  let dx = 0;
  if (u.door === 'left') dx = -half + P + 0.15 + dw / 2;
  else if (u.door === 'right') dx = half - P - 0.15 - dw / 2;
  const doorL = dx - dw / 2 - 0.08;
  const doorR = dx + dw / 2 + 0.08;
  const spans = [[-half + P, doorL], [doorR, half - P]].filter(([a, b]) => b - a > 0.35);
  return { dx, spans };
}

function shopfrontParts(u, A) {
  const parts = [];
  const half = u.width / 2;
  const P = FRONT.pilaster;
  const F = FRONT.fascia;
  const sw = A.swatch;
  const paintUV = sw(u.colours.paint);
  const trimUV = sw(u.colours.trim);
  const { dx, spans } = frontageLayout(u);

  // Pilasters, each with a plinth and a capital.
  for (const s of [-1, 1]) {
    const px = s * (half - P / 2);
    parts.push(at(box(P, F.bottom, 0.14, paintUV), px, F.bottom / 2, 0.07));
    parts.push(at(box(P + 0.06, 0.3, 0.18, trimUV), px, 0.15, 0.09));
    parts.push(at(box(P + 0.06, 0.08, 0.18, trimUV), px, F.bottom - 0.04, 0.09));
  }
  // The band between the window heads and the fascia.
  parts.push(at(box(u.width - 2 * P, F.bottom - FRONT.windowTop, 0.08, paintUV), 0, (F.bottom + FRONT.windowTop) / 2, 0.04));

  // Display windows.
  const winUV = A.windowUV(u.kind);
  for (const [a, b] of spans) {
    const len = b - a;
    const mid = (a + b) / 2;
    const h = FRONT.windowTop - FRONT.riser;
    parts.push(at(box(len, FRONT.riser, 0.12, trimUV), mid, FRONT.riser / 2, 0.06));
    parts.push(at(labelledBox(len, h, 0.02, { front: winUV, back: winUV }, trimUV), mid, FRONT.riser + h / 2, 0.03));
    parts.push(at(box(len + 0.04, 0.05, 0.2, trimUV), mid, FRONT.riser + 0.025, 0.1));
    parts.push(at(box(len, 0.07, 0.1, paintUV), mid, FRONT.windowTop + 0.035, 0.05));
    // A transom bar a third of the way down, and glazing bars across.
    parts.push(at(box(len, 0.045, 0.07, paintUV), mid, FRONT.windowTop - 0.32, 0.05));
    const bars = Math.max(1, Math.round(len / 1.0));
    for (let k = 1; k < bars; k += 1) {
      parts.push(at(box(0.055, h, 0.07, paintUV), a + (len * k) / bars, FRONT.riser + h / 2, 0.05));
    }
  }

  // The door: a frame, a panelled leaf in the door colour, glass in the top
  // half, a brass handle and a step.
  const D = FRONT.door;
  parts.push(at(box(D.w + 0.16, D.h + 0.08, 0.1, trimUV), dx, (D.h + 0.08) / 2, 0.05));
  parts.push(at(box(D.w, D.h, 0.06, sw(u.colours.door)), dx, D.h / 2, 0.1));
  parts.push(at(labelledBox(D.w * 0.64, D.h * 0.4, 0.02, { front: winUV, back: winUV }, trimUV), dx, D.h * 0.7, 0.135));
  parts.push(at(box(D.w * 0.64, D.h * 0.28, 0.02, sw(u.colours.trim)), dx, D.h * 0.27, 0.135));
  const handle = u.door === 'right' ? -1 : 1;
  parts.push(at(box(0.05, 0.16, 0.05, sw(PAINT.gold)), dx + handle * (D.w / 2 - 0.13), 0.98, 0.16));
  parts.push(at(box(D.w + 0.3, 0.08, 0.34, sw(PAINT.stone)), dx, 0.04, 0.17));

  // Fascia, cornice, and the console brackets that hold the fascia's ends.
  parts.push(at(labelledBox(u.width + 0.06, F.height, F.proud, { front: A.fasciaUV(u), back: paintUV }, paintUV),
    0, F.bottom + F.height / 2, F.proud / 2));
  parts.push(at(box(u.width + 0.22, 0.09, F.proud + 0.12, trimUV), 0, F.bottom + F.height + 0.045, (F.proud + 0.12) / 2));
  for (const s of [-1, 1]) {
    parts.push(at(box(0.14, F.height + 0.16, F.proud + 0.06, trimUV), s * (half + 0.07), F.bottom + F.height / 2 - 0.04, (F.proud + 0.06) / 2));
  }

  if (u.awning !== false) parts.push(...awningParts(u, A));
  parts.push(...bracketSign(u, A, dx));
  return parts;
}

/* The awning: a striped canvas sloping out from under the fascia, triangular
   cheeks at its ends, a scalloped valance along its lip, and two iron arms
   that hold it out. */
function awningParts(u, A) {
  const W = FRONT.awning;
  const parts = [];
  const width = u.width - 2 * FRONT.pilaster - 0.06;
  const stripeUV = A.stripesUV(u);
  const solid = A.swatch(u.colours.stripe);
  const len = Math.hypot(W.reach, W.drop);
  const canvas = labelledBox(width, len, 0.025, { front: stripeUV, back: stripeUV }, solid);
  /* Turned so the box's own length runs out and down from the hinge: about
     X, by the angle whose cosine is the slope's vertical part. */
  canvas.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.atan2(W.reach, -W.drop)));
  canvas.translate(0, W.hinge - W.drop / 2, W.wall + W.reach / 2);
  parts.push(canvas);

  const lipY = W.hinge - W.drop;
  const lipZ = W.wall + W.reach;
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(W.wall, W.hinge);
    shape.lineTo(lipZ, lipY);
    shape.lineTo(W.wall, lipY - 0.02);
    shape.closePath();
    const cheek = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    cheek.rotateY(-Math.PI / 2);
    cheek.translate(s * (width / 2) + (s > 0 ? 0.02 : 0), 0, 0);
    parts.push(paint(cheek, solid));
  }
  const val = labelledBox(width, W.valance, 0.02, { front: A.valanceUV(u), back: A.valanceUV(u) }, solid);
  parts.push(at(val, 0, lipY - W.valance / 2, lipZ));
  // The roller box at the top, and the arms.
  parts.push(at(box(width + 0.04, 0.09, 0.12, A.swatch(u.colours.trim)), 0, W.hinge + 0.02, W.wall));
  const iron = A.swatch(PAINT.iron);
  for (const s of [-1, 1]) {
    const x = s * (width / 2 - 0.12);
    parts.push(rod(new THREE.Vector3(x, W.hinge - 0.62, 0.02), new THREE.Vector3(x, lipY + 0.01, lipZ - 0.03), 0.028, iron));
  }
  return parts;
}

/* A hanging sign on a scrolled iron bracket at first-floor height, at the
   end of the frontage away from the door. Turned edge-on to the shop so it
   reads from up and down the street, which is where people walking are. */
function bracketSign(u, A, doorX) {
  const B = FRONT.bracket;
  const parts = [];
  const side = doorX > 0.01 ? -1 : 1;
  const x = side * (u.width / 2 - 0.42);
  const iron = A.swatch(PAINT.iron);
  parts.push(at(box(0.05, 0.05, B.reach, iron), x, B.y, B.reach / 2));
  parts.push(rod(new THREE.Vector3(x, B.y - 0.5, 0.02), new THREE.Vector3(x, B.y - 0.02, B.reach * 0.7), 0.04, iron));
  parts.push(at(box(0.2, 0.62, 0.06, iron), x, B.y - 0.25, 0.03));
  const finial = paint(new THREE.IcosahedronGeometry(0.055, 0), A.swatch(PAINT.gold));
  parts.push(at(finial, x, B.y, B.reach + 0.02));
  const P = B.plaque;
  const uv = A.plaqueUV(u);
  const plaque = labelledBox(P, P, 0.05, { front: uv, back: uv }, A.swatch(PAINT.gold));
  plaque.rotateY(Math.PI / 2);
  parts.push(at(plaque, x, B.y - 0.1 - P / 2, 0.16 + P / 2));
  for (const z of [0.2, 0.12 + P]) parts.push(at(box(0.02, 0.1, 0.02, iron), x, B.y - 0.06, z));
  return parts;
}

/* A café table under its parasol, with a bistro chair either side. Built
   about its own centre; the caller places it. */
function terraceTable(u, A) {
  const parts = [];
  const iron = A.swatch(PAINT.chair);
  const top = paint(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 14), A.swatch(PAINT.table));
  parts.push(at(top, 0, 0.74, 0));
  parts.push(at(box(0.05, 0.72, 0.05, iron), 0, 0.36, 0));
  parts.push(at(paint(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 12), iron), 0, 0.015, 0));

  for (const s of [-1, 1]) {
    const cx = s * 0.58;
    parts.push(at(paint(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), A.swatch(u.colours.chair ?? PAINT.chair)), cx, 0.46, 0));
    for (const [lx, lz] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) {
      parts.push(at(box(0.03, 0.46, 0.03, iron), cx + lx, 0.23, lz));
    }
    // The back, on the side away from the table.
    parts.push(at(box(0.03, 0.42, 0.34, iron), cx + s * 0.17, 0.7, 0));
    parts.push(at(box(0.04, 0.06, 0.38, iron), cx + s * 0.17, 0.92, 0));
  }

  if (u.parasol !== false) {
    const P = PARASOL;
    parts.push(at(box(0.04, P.pole - 0.74, 0.04, A.swatch(PAINT.white)), 0, 0.74 + (P.pole - 0.74) / 2, 0));
    /* Eight panels in alternating colours. ConeGeometry builds its sides
       one radial segment at a time, and for a cone — a cylinder with no top
       radius — it skips the degenerate triangle at the apex, so after
       expanding it each panel is the same run of vertices and can be
       painted on its own. The run is counted rather than assumed. */
    const cone = new THREE.ConeGeometry(P.r, P.h, 8, 1, true).toNonIndexed();
    const uvA = A.swatch(u.colours.stripe);
    const uvB = A.swatch(PAINT.white);
    const attr = cone.getAttribute('uv');
    const per = attr.count / 8;
    for (let i = 0; i < attr.count; i += 1) {
      const panel = Math.floor(i / per);
      const uv = panel % 2 ? uvA : uvB;
      attr.setXY(i, (uv.u0 + uv.u1) / 2, (uv.v0 + uv.v1) / 2);
    }
    parts.push(at(cone, 0, P.pole - P.h / 2 + 0.06, 0));
    const valance = paint(new THREE.CylinderGeometry(P.r, P.r, P.skirt, 8, 1, true), uvA);
    parts.push(at(valance, 0, PARASOL_RIM + P.skirt / 2, 0));
    parts.push(at(paint(new THREE.IcosahedronGeometry(0.06, 0), A.swatch(PAINT.white)), 0, P.pole + 0.08, 0));
  }
  return parts;
}

/* The board a café puts out on the pavement: two chalk slates leaning
   together in an A. */
function aBoard(lines, A) {
  const parts = [];
  const uv = A.chalkUV(lines);
  const wood = A.swatch(PAINT.woodDark);
  for (const s of [-1, 1]) {
    const g = labelledBox(0.5, 0.82, 0.03, { front: uv, back: uv }, wood);
    // Face outward, then lean the top in towards the other slate.
    if (s < 0) g.rotateY(Math.PI);
    g.rotateX(-s * 0.2);
    parts.push(at(g, 0, 0.41, s * 0.085));
  }
  return parts;
}

/* Fruit and vegetables on a stand under the greengrocer's awning: two
   tilted crates, each heaped with one thing, and a basket of cabbages on
   the pavement in front. Under a unit across, which is what lets it stand
   against the shop's own plinth: the narrow pavement at the street's west
   end, where High Street bends towards the square, has no room for a
   trestle a unit out from the wall. */
function produceStand(A) {
  const parts = [];
  const wood = A.swatch(PAINT.wood);
  const dark = A.swatch(PAINT.woodDark);
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.18, 0.18]) parts.push(at(box(0.05, 0.62, 0.05, dark), x, 0.31, z));
  }
  parts.push(at(box(0.94, 0.05, 0.46, dark), 0, 0.63, 0));
  [PAINT.orange, PAINT.apple].forEach((colour, i) => {
    const cx = -0.23 + i * 0.46;
    const crate = box(0.44, 0.14, 0.42, wood);
    crate.rotateX(0.32);
    parts.push(at(crate, cx, 0.73, 0));
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) {
        const ball = paint(new THREE.IcosahedronGeometry(0.06, 0), A.swatch(colour));
        const lz = -0.13 + b * 0.13;
        parts.push(at(ball, cx - 0.13 + a * 0.13, 0.82 - lz * 0.33, lz));
      }
    }
  });
  const basket = paint(new THREE.CylinderGeometry(0.2, 0.16, 0.2, 10), wood);
  parts.push(at(basket, 0.62, 0.1, 0.02));
  for (let k = 0; k < 4; k += 1) {
    const c = paint(new THREE.IcosahedronGeometry(0.085, 0), A.swatch(PAINT.cabbage));
    parts.push(at(c, 0.56 + (k % 2) * 0.12, 0.24 + Math.floor(k / 2) * 0.05, -0.05 + (k % 3) * 0.05));
  }
  return parts;
}

/* Sacks of feed stacked outside Hardware & Feed, the one shop on the street
   that sells to farmers by the hundredweight. Under a unit across, so the
   stack can lean on the shop's plinth the way sacks do. */
function sackStack(A) {
  const parts = [];
  const uv = A.sackUV();
  const sack = A.swatch(PAINT.sack);
  const spots = [[-0.23, 0.14, 0, 0.05], [0.23, 0.14, 0, -0.08], [0, 0.42, 0.02, 0.12], [0.08, 0.14, 0.38, 1.45]];
  for (const [x, y, z, yaw] of spots) {
    const g = labelledBox(0.44, 0.28, 0.32, { front: uv, back: uv }, sack);
    g.rotateY(yaw);
    parts.push(at(g, x, y, z));
  }
  return parts;
}

/* A planter beside a door: a terracotta trough of clipped green with a few
   flowers in it. */
function planter(A, bloom) {
  const parts = [];
  parts.push(at(box(0.5, 0.4, 0.4, A.swatch(PAINT.terracotta)), 0, 0.2, 0));
  const leaves = paint(new THREE.IcosahedronGeometry(0.28, 1), A.swatch(PAINT.leaf));
  leaves.scale(1, 0.7, 0.8);
  parts.push(at(leaves, 0, 0.55, 0));
  for (let k = 0; k < 5; k += 1) {
    const f = paint(new THREE.IcosahedronGeometry(0.05, 0), A.swatch(bloom));
    parts.push(at(f, -0.18 + k * 0.09, 0.66 + (k % 2) * 0.05, (k % 3 - 1) * 0.08));
  }
  return parts;
}

/* -------------------------------------------------------------------- */
/* The street                                                            */
/* -------------------------------------------------------------------- */

/* A box in the shop's frame turned into an axis-aligned one in the world's,
   for SOLIDS: every corner, transformed, and the bounds of those. */
function worldBox(u, lx0, lx1, lz0, lz1, height, id) {
  const c = Math.cos(u.yaw);
  const s = Math.sin(u.yaw);
  const xs = [];
  const zs = [];
  for (const lx of [lx0, lx1]) for (const lz of [lz0, lz1]) {
    xs.push(u.x + lx * c + lz * s);
    zs.push(u.z - lx * s + lz * c);
  }
  return {
    id, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
    minY: 0, maxY: height,
  };
}

/**
 * Builds every shopfront. Each unit is
 *   { id, name, kind, x, z, yaw, width, door, colours, awning?, terrace?,
 *     aboard?, extras? }
 * where (x, z) is the middle of the frontage on the face of the wall and
 * yaw turns the shop's own +z — out of the wall — onto the street.
 * `colours` are { paint, trim, stripe, door, ink?, chair? }.
 */
export function buildHighStreet({ units, anisotropy = 1 }) {
  const A = makeAtlas(units);
  const parts = [];
  const solids = [];
  const report = { units: [], atlas: { width: A.width, height: A.height } };

  for (const u of units) {
    const local = shopfrontParts(u, A);
    const { dx, spans } = frontageLayout(u);
    const out = [];

    /* Tables go in front of the glass, never the door, evenly along the
       spans that are windows. */
    const tables = [];
    const n = u.terrace ?? 0;
    if (n > 0) {
      const span = spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      const all = spans.length > 1 && n > 1 ? spans : [span];
      const per = Math.ceil(n / all.length);
      for (const [a, b] of all) {
        for (let k = 0; k < per && tables.length < n; k += 1) {
          tables.push(a + ((k + 0.5) * (b - a)) / per);
        }
      }
    }
    for (const tx of tables) {
      for (const g of terraceTable(u, A)) local.push(g.translate(tx, 0, TERRACE_OUT));
      /* The table and its two chairs as one box: what stops her is the
         furniture, and the parasol above it is overhead. */
      out.push(worldBox(u, tx - 0.82, tx + 0.82, TERRACE_OUT - 0.4, TERRACE_OUT + 0.4, 0.95, `terrace:${u.id}`));
    }
    /* The board stands out by the kerb in line with the door, which is the
       one stretch of pavement no table is in front of. */
    if (u.aboard) {
      const ax = dx;
      for (const g of aBoard(u.aboard, A)) local.push(g.translate(ax, 0, ABOARD_OUT));
      out.push(worldBox(u, ax - 0.28, ax + 0.28, ABOARD_OUT - 0.22, ABOARD_OUT + 0.22, 0.85, `aboard:${u.id}`));
    }
    for (const extra of u.extras ?? []) {
      if (extra.kind === 'produce') {
        for (const g of produceStand(A)) local.push(g.translate(extra.x, 0, extra.out));
        out.push(worldBox(u, extra.x - 0.48, extra.x + 0.48, extra.out - 0.24, extra.out + 0.24, 0.95, `produce:${u.id}`));
      } else if (extra.kind === 'sacks') {
        for (const g of sackStack(A)) local.push(g.translate(extra.x, 0, extra.out));
        out.push(worldBox(u, extra.x - 0.47, extra.x + 0.47, extra.out - 0.18, extra.out + 0.56, 0.6, `sacks:${u.id}`));
      } else if (extra.kind === 'planters') {
        for (const s of [-1, 1]) {
          const px = dx + s * (FRONT.door.w / 2 + 0.42);
          /* Out past the plinth, which stands 0.36 proud of the wall on
             these blocks. */
          for (const g of planter(A, extra.bloom ?? PAINT.bloomRed)) local.push(g.translate(px, 0, 0.62));
          out.push(worldBox(u, px - 0.25, px + 0.25, 0.42, 0.82, 0.75, `planter:${u.id}`));
        }
      }
    }

    for (const g of local) parts.push(placed(g, u.x, 0, u.z, u.yaw));
    solids.push(...out);
    const fx = Math.sin(u.yaw);
    const fz = Math.cos(u.yaw);
    report.units.push({
      id: u.id, name: u.name, kind: u.kind, x: u.x, z: u.z, width: u.width,
      faceX: fx, faceZ: fz,
      door: { x: u.x + dx * Math.cos(u.yaw), z: u.z - dx * Math.sin(u.yaw) },
      fasciaCap: A.fascia[u.id].capUnits,
      fasciaPx: A.fascia[u.id].px,
      awning: u.awning !== false,
      tables: tables.length,
      lowestOverhead: u.awning !== false ? FRONT.awning.hinge - FRONT.awning.drop - FRONT.awning.valance : null,
      parasolRim: tables.length && u.parasol !== false ? PARASOL_RIM : null,
    });
  }

  const tex = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  /* alphaTest for the valances' scallops, and nowhere else: every other
     texel in the atlas is opaque. Double-sided because so much of this is
     seen from underneath — an awning's canvas, a parasol's canopy — and a
     second copy of each turned inside out would be more triangles for the
     same picture. */
  const material = new THREE.MeshStandardMaterial({
    name: 'high-street', map: tex(A.canvas), roughness: 0.78, metalness: 0,
    emissive: 0xffe2b0, emissiveMap: tex(A.glow), emissiveIntensity: 0.55,
    alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
  for (const g of parts) g.dispose();
  mesh.name = 'high-street';
  report.triangles = mesh.geometry.getAttribute('position').count / 3;
  return { object: mesh, solids, report, material };
}
