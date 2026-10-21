/* streetscape.js — what is between Farm City's buildings: the pavements and
 * kerbs, the street lamps, the zebra crossings and their beacons, and the
 * bunting strung across High Street.
 *
 * Its job is the town after dark as much as by day. The lamps light at
 * dusk, each throwing a pool of light on the paving under it, and the
 * crossings' amber beacons blink. None of that is a real light: a forward
 * renderer pays for every light on every pixel, and a dozen street lamps
 * would be a dozen lights. The lamps' glass glows (and blooms, on a machine
 * that can afford bloom), and the pools are soft discs drawn additively on
 * the ground, which is what a lit street looks like from a few metres up.
 *
 * Static pieces are merged by material, the method every other builder in
 * the town uses: the paving (a small canvas, tiled in world units), a
 * swatch atlas for iron, paint, flowers and flags, and three that change
 * with the time — the lamps' glass, the light pools, the beacons' globes.
 *
 * Nothing here reaches into the scene. buildStreetscape takes where things
 * go and returns the object, the collision boxes, a report and an update
 * function to call each frame with how far into the night it is.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, placed } from './signs.js';

const PAINT = {
  iron: '#1f2124',
  ironHi: '#3a3d42',
  gold: '#c9a227',
  kerb: '#a49e93',
  white: '#f2f0ea',
  black: '#17181a',
  leaf: '#3f7a3a',
  red: '#d8433b',
  yellow: '#efc23a',
  blue: '#3d7bd8',
  pink: '#e889b5',
  green: '#3b9a57',
  cord: '#d9d4c7',
  basket: '#6b4a2b',
};

/* World height of each surface. The road is laid 0.06 above the ground;
   the pavement stands a little above that, and the kerb a little more —
   enough to read as a step, not enough that her feet visibly sink into the
   paving she walks on. And under 0.08, which is the top of the stone step
   at every shop door: a pavement laid over it would bury it. */
const PAVE_Y = 0.075;
const KERB_Y = 0.12;
const KERB_W = 0.2;

function swatchAtlas() {
  const keys = Object.keys(PAINT);
  const S = 16;
  const canvas = document.createElement('canvas');
  canvas.width = S * keys.length;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const uv = {};
  keys.forEach((k, i) => {
    ctx.fillStyle = PAINT[k];
    ctx.fillRect(i * S, 0, S, S);
    uv[k] = { u0: (i * S + 2) / canvas.width, u1: ((i + 1) * S - 2) / canvas.width, v0: 0.2, v1: 0.8 };
  });
  return { canvas, uv };
}

/* Paving slabs: two courses of rectangular flags a little under a unit
   long, with darker joints and a little variation slab to slab. */
function pavingCanvas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8f8b83';
  ctx.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 4; r += 1) {
    const off = r % 2 ? 48 : 0;
    for (let k = -1; k < 3; k += 1) {
      const s = Math.sin((r * 5 + k) * 12.99) * 43758.5;
      const t = s - Math.floor(s);
      const v = 176 + Math.round(t * 20);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
      ctx.fillRect(k * 96 + off + 2, r * 64 + 2, 92, 60);
    }
  }
  return c;
}

/* The pool of light under a lamp: warm in the middle, nothing at the edge. */
function poolCanvas() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,214,150,0.85)');
  g.addColorStop(0.45, 'rgba(255,196,120,0.35)');
  g.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

/* A strip of pavement beside a road: a ribbon from the kerb out to `outer`
   from the road's centre line, on the side `side` of it, with the kerb as
   a raised edge along its inner side. `pts` are [x, z, nx, nz, outer?] —
   the road's samples with their normals, and where the pavement has to
   stop short (a shop's wall, the City Hall's steps) the width at that
   point. UVs are world x and z over the tile, so the slabs run
   continuously along a curve. */
function pavementStrip(pts, side, inner, outer, tile) {
  const top = [];
  const kerb = [];
  const quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, z0, nx0, nz0, o0 = outer] = pts[i];
    const [x1, z1, nx1, nz1, o1 = outer] = pts[i + 1];
    const off = (x, z, nx, nz, d, y) => [x + nx * side * d, y, z + nz * side * d];
    const a0 = off(x0, z0, nx0, nz0, inner + KERB_W, PAVE_Y);
    const b0 = off(x0, z0, nx0, nz0, o0, PAVE_Y);
    const a1 = off(x1, z1, nx1, nz1, inner + KERB_W, PAVE_Y);
    const b1 = off(x1, z1, nx1, nz1, o1, PAVE_Y);
    // Wound so the top faces up whichever side of the road it is on.
    if (side > 0) quad(top, a0, a1, b1, b0); else quad(top, a0, b0, b1, a1);
    // The kerb: a top and a face down to the road.
    const k0 = off(x0, z0, nx0, nz0, inner, KERB_Y);
    const k1 = off(x1, z1, nx1, nz1, inner, KERB_Y);
    const ka0 = off(x0, z0, nx0, nz0, inner + KERB_W, KERB_Y);
    const ka1 = off(x1, z1, nx1, nz1, inner + KERB_W, KERB_Y);
    const f0 = off(x0, z0, nx0, nz0, inner, 0.02);
    const f1 = off(x1, z1, nx1, nz1, inner, 0.02);
    if (side > 0) {
      quad(kerb, k0, k1, ka1, ka0);
      quad(kerb, f0, f1, k1, k0);
    } else {
      quad(kerb, k0, ka0, ka1, k1);
      quad(kerb, f0, k0, k1, f1);
    }
    // And a step down from the kerb top to the pavement, for the
    // two-centimetre lip between them.
    const p0 = off(x0, z0, nx0, nz0, inner + KERB_W, PAVE_Y);
    const p1 = off(x1, z1, nx1, nz1, inner + KERB_W, PAVE_Y);
    if (side > 0) quad(kerb, ka0, ka1, p1, p0); else quad(kerb, ka0, p0, p1, ka1);
    // The outer edge, down to the ground: see the ends, below.
    quad(kerb, off(x0, z0, nx0, nz0, o0, 0), off(x1, z1, nx1, nz1, o1, 0), b1, b0);
  }
  /* The ends of the strip, where it stops at the mouth of a road, and its
     outer edge where there is no wall to meet: the paving is laid 0.075
     above the ground and the kerb 0.12, and the first build had no faces
     down from either — an open edge with daylight under it, and, at the
     four ends, the kerb's profile seen hollow end-on. In the kerb's own
     material, which is drawn from both sides, so the winding does not
     matter. */
  for (const [x, z, nx, nz, o = outer] of [pts[0], pts[pts.length - 1]]) {
    const off = (d, y) => [x + nx * side * d, y, z + nz * side * d];
    quad(kerb, off(inner, 0.02), off(inner, KERB_Y), off(inner + KERB_W, KERB_Y), off(inner + KERB_W, 0));
    quad(kerb, off(inner + KERB_W, 0), off(inner + KERB_W, PAVE_Y), off(o, PAVE_Y), off(o, 0));
  }
  const build = (arr, uvOf) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const uv = [];
    for (let i = 0; i < arr.length; i += 3) uv.push(...uvOf(arr[i], arr[i + 2]));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  return {
    top: build(top, (x, z) => [x / tile, z / tile]),
    kerb: build(kerb, () => [0, 0]),
  };
}

/* A Victorian street lamp: a moulded iron base, a fluted post, a collar,
   and a four-sided lantern with a pyramid roof and a finial. The glass is
   its own geometry, returned separately, because it is what lights up. */
function lampParts(A) {
  const iron = A.uv.iron;
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 8), iron).translate(0, 0.25, 0));
  parts.push(paint(new THREE.CylinderGeometry(0.15, 0.2, 0.18, 8), A.uv.ironHi).translate(0, 0.59, 0));
  parts.push(paint(new THREE.CylinderGeometry(0.065, 0.085, 2.7, 8), iron).translate(0, 0.68 + 1.35, 0));
  parts.push(paint(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 8), A.uv.gold).translate(0, 2.2, 0));
  parts.push(paint(new THREE.CylinderGeometry(0.11, 0.075, 0.3, 8), iron).translate(0, 3.45, 0));
  // The lantern's frame.
  const lanternY = 3.85;
  parts.push(paint(new THREE.BoxGeometry(0.42, 0.06, 0.42), iron).translate(0, lanternY - 0.29, 0));
  for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
    parts.push(paint(new THREE.BoxGeometry(0.04, 0.6, 0.04), iron).translate(x, lanternY, z));
  }
  const roof = paint(new THREE.ConeGeometry(0.36, 0.32, 4), iron);
  roof.rotateY(Math.PI / 4);
  parts.push(roof.translate(0, lanternY + 0.46, 0));
  parts.push(paint(new THREE.IcosahedronGeometry(0.05, 0), A.uv.gold).translate(0, lanternY + 0.66, 0));
  // A hanging basket on a little bracket, flowers in it.
  parts.push(paint(new THREE.BoxGeometry(0.04, 0.04, 0.5), iron).translate(0, 2.65, 0.25));
  parts.push(paint(new THREE.CylinderGeometry(0.26, 0.14, 0.22, 10), A.uv.basket).translate(0, 2.25, 0.48));
  const leaves = paint(new THREE.IcosahedronGeometry(0.26, 0), A.uv.leaf);
  leaves.scale(1, 0.6, 1);
  parts.push(leaves.translate(0, 2.4, 0.48));
  const blooms = ['red', 'yellow', 'pink', 'blue'];
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * Math.PI * 2;
    parts.push(paint(new THREE.BoxGeometry(0.09, 0.07, 0.09), A.uv[blooms[k % 4]])
      .translate(Math.sin(a) * 0.22, 2.42 + (k % 2) * 0.06, 0.48 + Math.cos(a) * 0.22));
  }
  // The glass: a box, slightly inside the frame.
  const glass = new THREE.BoxGeometry(0.36, 0.54, 0.36).toNonIndexed().translate(0, lanternY, 0);
  return { parts, glass, lanternY };
}

/* A Belisha beacon: a black and white banded pole, and an amber globe. */
function beaconParts(A) {
  const parts = [];
  for (let k = 0; k < 9; k += 1) {
    parts.push(paint(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), k % 2 ? A.uv.white : A.uv.black)
      .translate(0, 0.15 + k * 0.3, 0));
  }
  const globe = new THREE.SphereGeometry(0.19, 10, 6).toNonIndexed().translate(0, 2.9, 0);
  return { parts, globe };
}

/* Bunting: a cord sagging between two points, with a pennant every half a
   unit in turn of colours. */
function buntingParts(A, a, b, sag) {
  const parts = [];
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const n = Math.floor(len / 0.5);
  const at = (t) => new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0));
  const colours = ['red', 'yellow', 'blue', 'green', 'white', 'pink'];
  const dir = d.clone().setY(0).normalize();
  const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
  for (let i = 0; i < n; i += 1) {
    const p0 = at(i / n);
    const p1 = at((i + 1) / n);
    const seg = new THREE.Vector3().subVectors(p1, p0);
    const cord = paint(new THREE.BoxGeometry(0.02, seg.length(), 0.02), A.uv.cord);
    cord.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.clone().normalize()));
    const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    parts.push(cord.translate(mid.x, mid.y, mid.z));
    if (i === 0) continue;
    const tri = new THREE.Shape();
    tri.moveTo(-0.17, 0); tri.lineTo(0.17, 0); tri.lineTo(0, -0.34); tri.closePath();
    const flag = paint(new THREE.ShapeGeometry(tri), A.uv[colours[i % colours.length]]);
    parts.push(placed(flag, p0.x, p0.y, p0.z, yaw));
  }
  return parts;
}

/**
 * strips:    [{ pts: [[x, z, nx, nz], ...], side, inner, outer }]
 * lamps:     [{ x, z, yaw }]       — yaw turns the basket's bracket
 * crossings: [{ x, z, dx, dz, width }] — a point on the road, its direction
 * bunting:   [[[x, y, z], [x, y, z], sag]]
 */
export function buildStreetscape({ strips = [], lamps = [], crossings = [], bunting = [], anisotropy = 1 }) {
  const A = swatchAtlas();
  const group = new THREE.Group();
  group.name = 'streetscape';
  const solids = [];

  const paveTex = new THREE.CanvasTexture(pavingCanvas());
  paveTex.colorSpace = THREE.SRGBColorSpace;
  paveTex.wrapS = THREE.RepeatWrapping;
  paveTex.wrapT = THREE.RepeatWrapping;
  paveTex.anisotropy = anisotropy;
  const swatchTex = new THREE.CanvasTexture(A.canvas);
  swatchTex.colorSpace = THREE.SRGBColorSpace;
  swatchTex.magFilter = THREE.NearestFilter;
  swatchTex.minFilter = THREE.NearestFilter;
  swatchTex.generateMipmaps = false;

  /* Two lists for the static pieces: what is drawn from anywhere — the
     paving itself, a band of grey a player sees from the farm — and the
     detail, which the scene stops drawing from far off: kerbs, lamp posts,
     baskets, bunting, the beacons' poles. */
  /* Detail is kept in groups — each kerb, each crossing, each run of
     lamps — and each group is a mesh: one mesh for the street's whole
     length would have its nearest point at whichever end is nearest, and
     would never be far enough off to leave out. */
  const paveParts = [];
  const groups = new Map();
  const detailOf = (key) => {
    if (!groups.has(key)) groups.set(key, []);
    return groups.get(key);
  };
  strips.forEach((s, i) => {
    const g = pavementStrip(s.pts, s.side, s.inner, s.outer, 1.5);
    paveParts.push(g.top);
    detailOf(`kerb:${i}`).push(paint(g.kerb, A.uv.kerb));
  });

  const glass = [];
  const pools = [];
  const lampSpec = lampParts(A);
  for (const l of lamps) {
    for (const g of lampSpec.parts) detailOf(`lamps:${l.group ?? 'all'}`).push(placed(g.clone(), l.x, 0, l.z, l.yaw ?? 0));
    glass.push(placed(lampSpec.glass.clone(), l.x, 0, l.z, l.yaw ?? 0));
    pools.push(new THREE.CircleGeometry(2.4, 20).rotateX(-Math.PI / 2).toNonIndexed().translate(l.x, PAVE_Y + 0.02, l.z));
    // The base is what she or the car would hit.
    solids.push({ id: 'street-lamp', minX: l.x - 0.27, maxX: l.x + 0.27, minZ: l.z - 0.27, maxZ: l.z + 0.27, minY: 0, maxY: 4.5 });
  }

  const globes = [];
  const beaconSpec = beaconParts(A);
  crossings.forEach((c, ci) => {
    const detail = detailOf(`crossing:${ci}`);
    /* The stripes: a zebra across the carriageway, each bar half a unit
       wide with half a unit of road between, as many as fit its width. */
    const nx = -c.dz;
    const nz = c.dx;
    /* Turned so a bar's long side runs across the road: placed() maps the
       bar's own +z onto the yaw, so the yaw is the road's normal, and its
       own +x then lies along the road. Half a unit of white, half of road. */
    const across = Math.atan2(nx, nz);
    const bars = 6;
    for (let k = 0; k < bars; k += 1) {
      const t = k - (bars - 1) / 2;
      const bar = paint(new THREE.BoxGeometry(0.5, 0.01, c.width), A.uv.white);
      // The stripes are drawn from anywhere: white on a dark road is the
      // part of a crossing that reads from far off.
      detailOf('always:zebras').push(placed(bar, c.x + c.dx * t, 0.075, c.z + c.dz * t, across));
    }
    for (const s of [-1, 1]) {
      const bx = c.x + nx * s * (c.width / 2 + 0.55);
      const bz = c.z + nz * s * (c.width / 2 + 0.55);
      for (const g of beaconSpec.parts) detail.push(g.clone().translate(bx, 0, bz));
      globes.push(beaconSpec.globe.clone().translate(bx, 0, bz));
      solids.push({ id: 'beacon', minX: bx - 0.12, maxX: bx + 0.12, minZ: bz - 0.12, maxZ: bz + 0.12, minY: 0, maxY: 3.1 });
    }
  });

  bunting.forEach(([a, b, sag, group]) => {
    detailOf(`bunting:${group ?? 'all'}`).push(...buntingParts(A, new THREE.Vector3(...a), new THREE.Vector3(...b), sag));
  });

  const meshOf = (parts, mat, name) => {
    if (!parts.length) return null;
    const m = new THREE.Mesh(mergeGeometries(parts, false), mat);
    for (const p of parts) p.dispose();
    m.name = name;
    group.add(m);
    return m;
  };
  meshOf(paveParts, new THREE.MeshStandardMaterial({ name: 'pavement', map: paveTex, roughness: 0.95 }), 'pavement');
  const detailMat = new THREE.MeshStandardMaterial({
    name: 'street-detail', map: swatchTex, roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
  });
  const detailMeshes = [...groups]
    .map(([key, parts]) => meshOf(parts, detailMat, `street-detail:${key}`))
    .filter((m) => m && !m.name.includes('always:'));
  const glassMat = new THREE.MeshStandardMaterial({
    name: 'lamp-glass', color: 0xfff1d6, roughness: 0.2, emissive: 0xffc77a, emissiveIntensity: 0.1,
  });
  meshOf(glass, glassMat, 'lamp-glass');
  const poolTex = new THREE.CanvasTexture(poolCanvas());
  poolTex.colorSpace = THREE.SRGBColorSpace;
  const poolMat = new THREE.MeshBasicMaterial({
    name: 'lamp-pools', map: poolTex, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const poolMesh = meshOf(pools, poolMat, 'lamp-pools');
  if (poolMesh) poolMesh.renderOrder = 2;
  const beaconMat = new THREE.MeshStandardMaterial({
    name: 'beacon', color: 0xf0a020, roughness: 0.3, emissive: 0xff9a1a, emissiveIntensity: 0.4,
  });
  meshOf(globes, beaconMat, 'beacons');

  let lit = 0;
  /* night: 0 by day, 1 at midnight (the scene's skyNight). t: seconds. The
     lamps come on through dusk, the way the yard lamps do, rather than at a
     switch; the beacons blink once a second whatever the hour, as real ones
     do. */
  function update(night, t) {
    lit = THREE.MathUtils.smoothstep(night, 0.3, 0.6);
    glassMat.emissiveIntensity = 0.1 + lit * 2.6;
    poolMat.opacity = lit * 0.75;
    if (poolMesh) poolMesh.visible = lit > 0.01;
    beaconMat.emissiveIntensity = Math.floor(t * 1.0) % 2 === 0 ? 2.2 : 0.25;
  }
  update(0, 0);

  return {
    object: group, solids, update,
    detail: detailMeshes,
    state: () => ({ lit, glass: glassMat.emissiveIntensity, pools: poolMat.opacity, beacon: beaconMat.emissiveIntensity }),
    report: {
      lamps: lamps.map((l) => ({ x: l.x, z: l.z })),
      crossings: crossings.map((c) => ({ x: c.x, z: c.z, width: c.width })),
      strips: strips.map((st) => ({ side: st.side, from: st.pts[0].slice(0, 2), to: st.pts[st.pts.length - 1].slice(0, 2) })),
      bunting: bunting.length,
      kerb: { y: KERB_Y, pavement: PAVE_Y },
    },
  };
}
