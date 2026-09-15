/* farmer.js — the farmer, built here rather than loaded from a kit.
 *
 * Every other object in this game is an authored Kenney model. She is not,
 * and the reason is a measurement: the pinned CC0 mirror has exactly two
 * character kits in it, and neither is a person. `blocky-characters` is a
 * Lego minifigure — a slab body, peg arms, a cube head sitting straight on
 * the shoulders with no neck. `mini-characters` has real limbs and a ready
 * -made `drive` clip, which would have been perfect, but it renders with its
 * arms fragmented and splayed at width 1.10 against height 0.78 in its own
 * bind pose, before any code here touches it: verified against the raw glTF
 * (weights normalised to 1.0000, joint indices in range, one JOINTS_0 set)
 * and against `skeleton.pose()`, which changes nothing. Whatever is wrong
 * with it is authored into the file. It is also, proportionally, a Funko —
 * a third of its height is head.
 *
 * So a figure gets built from primitives instead. That buys the thing the
 * kits cannot offer at any price: proportions. This one is six and a half
 * heads tall against a minifigure's three, and it has the four details that
 * actually separate a human silhouette from a toy one — a neck, sloped
 * shoulders, a waist, and limbs that taper and bend at a joint rather than
 * swinging from a socket.
 *
 * What it deliberately is not: detailed. The farm is flat-shaded low-poly
 * and she has to belong to it, so this is chunky prisms and one low-segment
 * sphere for the head. The aim is a human *shape* in the game's own style,
 * not a realistic human dropped into a toy field.
 *
 * The rig is a plain Object3D hierarchy with meshes parented to it, not a
 * SkinnedMesh. Nothing here needs vertices to follow bones smoothly: the
 * segments are separate solid parts, and a ball at each joint hides the seam
 * when one rotates against another, which is how a low-poly figure gets away
 * without skinning at all. Skinning would cost a weight map to author by
 * hand and would look no different at this size.
 *
 * Clips are built rather than loaded too, as ordinary AnimationClips on the
 * ordinary mixer, so scene.js's poseFarmer — its crossfades, its clip speed
 * scaling, its once-through crouch — drives this exactly as it drove the
 * authored kit. Nothing on that side had to learn that she changed.
 *
 * There is no driving pose here, and there was: it was written, seated in
 * the car, and deleted. The sedan is a solid body with a painted windscreen
 * and no cabin, so a figure at the wheel comes out through the roof however
 * well it is posed. She is simply not drawn while driving — see poseFarmer.
 */
import * as THREE from 'three';

/* Her nominal height, and the unit everything else is stated in. 1.6 rather
   than the 1.45 the blocky kit needed: a third of that figure was head, so a
   realistic height made her loom over the plots and the art bible records
   1.45 as the compromise. With a head that is a sixth of her rather than a
   third, an adult height reads correctly — and the scale tests, which compare
   her against the farmhouse, the barn, the stall and the orchard, hold the
   top of the usable range at about 1.67.

   Nominal because the measured figure comes out a little under it: the crown
   of the skull sits just below the 6.5-head mark rather than exactly on it.
   Everything that cares — the tests included — measures her rather than
   reading this. */
export const FARMER_HEIGHT = 1.6;

/* Six and a half heads, not the seven and a half a life-drawing class
   measures and not the eight a fashion plate is drawn at. The first build
   here used 7.5 and it was wrong in a way that only showed up rendered: at
   this distance a correctly-proportioned head is a handful of pixels, and
   she came out pin-headed and faintly alien — the failure mode at the far
   end from the one being fixed. 6.5 is the sturdy, grounded adult that game
   figures are usually drawn at, and it buys back enough head to carry a face
   without going anywhere near the Lego third-of-her-height it replaced. */
const HU = FARMER_HEIGHT / 6.5; // one head

/* The boot's half-height, so the ankle can be put exactly that far up and
   the sole lands on the ground. The first build had the ankle at a round
   number and the boots sank through the field. */
const BOOT_H = 0.34 * HU;

const HIP_Y = 3.1 * HU;
const CHEST_UP = 1.25 * HU; // hips -> mid-chest, the pivot the spine bends at
const NECK_UP = 0.75 * HU; // chest -> shoulder line
/* Shoulder line to the centre of the head. Short, because the gap between
   the two is a neck, and the first build left three quarters of a head of
   daylight there — from the front it read as a giraffe. */
const HEAD_UP = 0.72 * HU;

/* The hip joint sits below the centre of the pelvis, which is where the
   `hips` bone is. Naming it matters because the leg's length has to be
   measured from the joint, not from the pelvis: the first build subtracted
   from HIP_Y instead and put both boots 8.6cm through the field — visible in
   nothing, since the grass hid it, and obvious the moment every mesh's world
   extent was printed. */
const HIP_DROP = 0.35 * HU;
const SHIN = 1.20 * HU;
const THIGH = HIP_Y - HIP_DROP - BOOT_H / 2 - SHIN; // thigh longer than shin, as a leg is
const UPPER_ARM = 1.25 * HU;
const FOREARM = 1.1 * HU;

const SHOULDER_X = 0.62 * HU;
const HIP_X = 0.32 * HU;

/* Two farmers, and the whole of the difference between them. The kit this
   replaces shipped two authored characters; these are the same idea stated
   as numbers — build, colouring, and a hair shape. */
const LOOK = {
  female: {
    skin: 0xd8a882,
    hair: 0x6b4423,
    shirt: 0x9a5fbf,
    trousers: 0x4f6180,
    boots: 0x4a3527,
    ponytail: true,
    shoulders: 0.94, // narrower than his, and a slightly deeper waist taper
    waist: 0.80,
  },
  male: {
    skin: 0xc08a5e,
    hair: 0x35271a,
    shirt: 0x3f8f5f,
    trousers: 0x6b5a45,
    boots: 0x43301f,
    ponytail: false,
    beard: true,
    shoulders: 1.06,
    waist: 0.90,
  },
};

/* Named, and not only for tidiness: scene.js's materialFacts walks the scene
   collecting roughness by material name, and the test that no surface in the
   farm is left perfectly matte reads it. An unnamed material is invisible to
   that check, and she is the thing the player looks at most. */
const mat = (hex, name) => new THREE.MeshStandardMaterial({
  name,
  color: hex,
  roughness: 0.82,
  metalness: 0,
  /* Flat shading, because every other surface in this farm is flat-shaded
     low-poly and a smoothly-shaded figure would read as a different game's
     character standing in this one. It also does the tapered prisms a
     favour: the facet edges are what make a six-sided limb look carved
     rather than like a cylinder that failed to be round. */
  flatShading: true,
});

/* A tapered prism, pivoting at its top end and hanging down its own length.
   Limbs are built this way so a bone rotation swings the segment from its
   joint, which is what a shoulder and a knee actually do — geometry
   translated after the fact, rather than a mesh offset inside a group, keeps
   the object count down to one per segment.

   `sides` is the whole style dial. Six reads as a limb, four as a plank; the
   torso is four scaled unevenly, because a chest is wider than it is deep
   and a square one is the Lego silhouette this is here to get away from. */
function part(material, { top, bottom, length, sides = 6, depth = 1, twist = 0 }) {
  const geo = new THREE.CylinderGeometry(top, bottom, length, sides, 1);
  if (twist) geo.rotateY(twist);
  if (depth !== 1) geo.scale(1, 1, depth);
  geo.translate(0, -length / 2, 0);
  return new THREE.Mesh(geo, material);
}

/* A ball at a joint. Low-poly on purpose and slightly smaller than the
   segments it sits between, so it fills the wedge that opens on the inside
   of a bend without bulging on the outside — the cheap substitute for
   skinning, and at this size an indistinguishable one. */
function joint(material, r) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), material);
}

function bone(name, x = 0, y = 0, z = 0) {
  const b = new THREE.Object3D();
  b.name = name;
  b.position.set(x, y, z);
  return b;
}

/** Builds one farmer. Returns the same shape the glTF path used to. */
export function buildFarmer(gender) {
  const look = LOOK[gender] ?? LOOK.female;
  const skin = mat(look.skin, 'farmer-skin');
  const hair = mat(look.hair, 'farmer-hair');
  const shirt = mat(look.shirt, 'farmer-shirt');
  const trousers = mat(look.trousers, 'farmer-trousers');
  const boots = mat(look.boots, 'farmer-boots');

  const root = new THREE.Group();
  root.name = 'farmer-built';

  const hips = bone('hips', 0, HIP_Y, 0);
  root.add(hips);

  /* The pelvis: short, and flared wider at the top than the bottom so the
     waist above it has something to narrow away from. A single box here —
     which is what the kit had — is most of why the old figure read as a
     rectangle with legs. */
  hips.add(part(trousers, {
    top: 0.62 * HU * look.shoulders, bottom: 0.54 * HU, length: 0.85 * HU, sides: 6, depth: 0.72,
  }));

  const chest = bone('chest', 0, CHEST_UP, 0);
  hips.add(chest);
  /* Torso, built as two tapered pieces meeting at the waist rather than one
     straight box: up from the waist it widens to the shoulders, down from
     the waist it narrows to the hips. Four-sided and scaled shallow, so it
     is a chest rather than a column. */
  chest.add(part(shirt, {
    top: 0.80 * HU * look.shoulders, bottom: 0.58 * HU * look.waist,
    length: CHEST_UP * 0.95, sides: 4, depth: 0.62, twist: Math.PI / 4,
  }).translateY(NECK_UP));
  chest.add(part(shirt, {
    top: 0.58 * HU * look.waist, bottom: 0.60 * HU,
    length: CHEST_UP * 0.72, sides: 4, depth: 0.66, twist: Math.PI / 4,
  }));

  const neck = bone('neck', 0, NECK_UP, 0);
  chest.add(neck);
  neck.add(part(skin, { top: 0.21 * HU, bottom: 0.25 * HU, length: 0.34 * HU, sides: 6 })
    .translateY(0.30 * HU));

  const head = bone('head', 0, HEAD_UP, 0);
  neck.add(head);
  /* Egg rather than cube, and eight segments rather than sixteen: enough to
     read as a skull, few enough that the facets stay visible. The slight
     forward push puts the face over the chest instead of behind it, which is
     the difference between looking where she is going and looking up. */
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.50 * HU, 8, 6), skin);
  skull.scale.set(0.94, 1.08, 1.0);
  skull.position.z = 0.03 * HU;
  head.add(skull);

  /* A cap of hair, and the phiLength is the whole of it. At a hemisphere it
     came down to the equator of the skull — which is eye height — and read as
     a motorcycle helmet with the visor down. Two thirds of that, lifted, is
     hair sitting on a head. */
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.53 * HU, 8, 5, 0, Math.PI * 2, 0, 1.42), hair);
  cap.scale.set(0.97, 1.05, 1.02);
  cap.position.set(0, 0.06 * HU, 0);
  /* Tilted, rather than trimmed evenly. A cap short enough to clear the eyes
     is also short enough to leave the nape bare, which from behind — the view
     this game is mostly played from — read as a hole in the back of her head.
     Tipping the opening forward lifts the front rim off the brow and drops
     the back one over the neck in the same move. */
  cap.rotation.x = -0.30;
  head.add(cap);
  if (look.ponytail) {
    const tail = part(hair, { top: 0.2 * HU, bottom: 0.13 * HU, length: 0.8 * HU, sides: 5 });
    tail.position.set(0, 0.2 * HU, -0.4 * HU);
    tail.rotation.x = -0.4;
    head.add(tail);
  }
  /* Two dark chips for eyes. At the distance this game is played at they are
     three pixels each, and they are still the difference between a person and
     a mannequin — a blank head reads as faceless long before it reads as
     stylised. Deliberately nothing else: a mouth at this size is a smudge. */
  const eyes = mat(0x2b2119, 'farmer-eyes');
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.11 * HU, 0.12 * HU, 0.06 * HU), eyes);
    eye.position.set(0.17 * HU * side, 0.03 * HU, 0.44 * HU);
    head.add(eye);
  }
  if (look.beard) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.47 * HU, 8, 5, 0, Math.PI * 2, 1.9, 0.75), hair);
    beard.scale.set(0.99, 1.1, 1.02);
    beard.position.set(0, -0.06 * HU, 0.05 * HU);
    head.add(beard);
  }

  /* Arms and legs, both sides from one description. `side` is +1 for her
     left, which is +X — the figure faces +Z, so her left is the viewer's
     right, and the only thing that actually depends on it is which way the
     shoulder and hip sit off centre. */
  const limbs = {};
  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';

    const shoulder = bone(`arm${S}`, SHOULDER_X * side, NECK_UP * 0.92, 0);
    chest.add(shoulder);
    shoulder.add(joint(shirt, 0.215 * HU));
    shoulder.add(part(shirt, { top: 0.23 * HU, bottom: 0.185 * HU, length: UPPER_ARM }));

    const elbow = bone(`fore${S}`, 0, -UPPER_ARM, 0);
    shoulder.add(elbow);
    elbow.add(joint(skin, 0.165 * HU));
    elbow.add(part(skin, { top: 0.175 * HU, bottom: 0.14 * HU, length: FOREARM }));

    const wrist = bone(`hand${S}`, 0, -FOREARM, 0);
    elbow.add(wrist);
    const hand = part(skin, { top: 0.17 * HU, bottom: 0.15 * HU, length: 0.42 * HU, sides: 5, depth: 0.7 });
    wrist.add(hand);

    const hip = bone(`thigh${S}`, HIP_X * side, -HIP_DROP, 0);
    hips.add(hip);
    hip.add(joint(trousers, 0.3 * HU));
    hip.add(part(trousers, { top: 0.32 * HU, bottom: 0.25 * HU, length: THIGH }));

    const knee = bone(`shin${S}`, 0, -THIGH, 0);
    hip.add(knee);
    knee.add(joint(trousers, 0.21 * HU));
    knee.add(part(trousers, { top: 0.23 * HU, bottom: 0.17 * HU, length: SHIN }));

    const ankle = bone(`foot${S}`, 0, -SHIN, 0);
    knee.add(ankle);
    /* The boot is the one part that points along Z rather than Y, so it is
       built lying down and then dropped to the floor. Length forward of the
       ankle, not centred on it: a foot is mostly in front of its own leg. */
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.44 * HU, BOOT_H, 0.9 * HU), boots);
    boot.position.set(0, 0, 0.16 * HU);
    ankle.add(boot);

    limbs[S] = { shoulder, elbow, wrist, hip, knee, ankle };
  }

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of buildClips()) actions[clip.name] = mixer.clipAction(clip);

  return { object: root, mixer, actions, limbs };
}

/* ------------------------------------------------------------------ */
/* The clips                                                           */
/* ------------------------------------------------------------------ */

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

/** Euler degrees -> a flat [x,y,z,w] run, for a QuaternionKeyframeTrack. */
function quats(frames) {
  const out = [];
  for (const [x, y, z] of frames) {
    _q.setFromEuler(_e.set(x, y, z, 'XYZ'));
    out.push(_q.x, _q.y, _q.z, _q.w);
  }
  return out;
}

const rot = (name, times, frames) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quats(frames));
const pos = (name, times, values) => new THREE.VectorKeyframeTrack(`${name}.position`, times, values);

/* Which way a rotation swings a limb, written down once because it is the
   thing most likely to be got backwards. The figure faces +Z and every limb
   hangs down -Y, so a positive rotation about X carries the far end toward
   -Z — backwards. Forward is therefore negative. */

function buildClips() {
  const clips = [];

  /* --- walk ------------------------------------------------------- */
  /* One second, two steps, authored to look right at 1.5 units a second —
     which is the CLIP_WALK_SPEED scene.js scales against, so her feet stay
     planted when the walk speed is tuned. Five keys: contact, pass, contact,
     pass, and back to the first.

     The arms are the half that makes it read as walking rather than
     marching. They swing opposite their own side's leg, which is what a
     human does to cancel the twist the legs put into the hips, and the
     chest counter-rotates a few degrees for the same reason. */
  const wt = [0, 0.25, 0.5, 0.75, 1];
  const F = -0.62; const B = 0.5; // thigh forward / back at contact
  clips.push(new THREE.AnimationClip('walk', 1, [
    rot('thighL', wt, [[F, 0, 0], [-0.05, 0, 0], [B, 0, 0], [0.12, 0, 0], [F, 0, 0]]),
    rot('thighR', wt, [[B, 0, 0], [0.12, 0, 0], [F, 0, 0], [-0.05, 0, 0], [B, 0, 0]]),
    // The knee never straightens fully on the planted leg and folds hard on
    // the swinging one; a leg that stays straight through the pass reads as
    // a stilt.
    rot('shinL', wt, [[0.16, 0, 0], [0.62, 0, 0], [0.12, 0, 0], [0.30, 0, 0], [0.16, 0, 0]]),
    rot('shinR', wt, [[0.12, 0, 0], [0.30, 0, 0], [0.16, 0, 0], [0.62, 0, 0], [0.12, 0, 0]]),
    rot('footL', wt, [[-0.22, 0, 0], [-0.10, 0, 0], [0.18, 0, 0], [-0.05, 0, 0], [-0.22, 0, 0]]),
    rot('footR', wt, [[0.18, 0, 0], [-0.05, 0, 0], [-0.22, 0, 0], [-0.10, 0, 0], [0.18, 0, 0]]),
    rot('armL', wt, [[0.44, 0, 0.10], [0.02, 0, 0.10], [-0.48, 0, 0.10], [0.02, 0, 0.10], [0.44, 0, 0.10]]),
    rot('armR', wt, [[-0.48, 0, -0.10], [0.02, 0, -0.10], [0.44, 0, -0.10], [0.02, 0, -0.10], [-0.48, 0, -0.10]]),
    rot('foreL', wt, [[-0.34, 0, 0], [-0.52, 0, 0], [-0.22, 0, 0], [-0.40, 0, 0], [-0.34, 0, 0]]),
    rot('foreR', wt, [[-0.22, 0, 0], [-0.40, 0, 0], [-0.34, 0, 0], [-0.52, 0, 0], [-0.22, 0, 0]]),
    rot('chest', wt, [[0.04, 0.09, 0], [0.04, 0, 0], [0.04, -0.09, 0], [0.04, 0, 0], [0.04, 0.09, 0]]),
    rot('head', wt, [[0, -0.05, 0], [0, 0, 0], [0, 0.05, 0], [0, 0, 0], [0, -0.05, 0]]),
    /* Two bobs per cycle, not one: the body rises over each planted leg, so
       it peaks at both passes. Getting this wrong is the single most obvious
       tell in a walk cycle — one bob per cycle looks like a limp. */
    pos('hips', wt, [
      0, HIP_Y - 0.012, 0,
      0, HIP_Y + 0.010, 0,
      0, HIP_Y - 0.012, 0,
      0, HIP_Y + 0.010, 0,
      0, HIP_Y - 0.012, 0,
    ]),
  ]));

  /* --- idle ------------------------------------------------------- */
  /* Long and small. Everything here is under four degrees except the
     breathing, and the point is only that she is not a statue between jobs —
     a figure holding perfectly still reads as a bug once everything around
     her is moving in the wind. */
  const it = [0, 1.1, 2.1, 3.2];
  clips.push(new THREE.AnimationClip('idle', 3.2, [
    rot('chest', it, [[0.012, 0, 0], [-0.020, 0.02, 0], [0.012, 0, 0], [0.012, 0, 0]]),
    rot('head', it, [[0, 0.05, 0], [0, -0.03, 0], [0, 0.07, 0], [0, 0.05, 0]]),
    rot('armL', it, [[0.02, 0, 0.11], [0.05, 0, 0.13], [0.02, 0, 0.11], [0.02, 0, 0.11]]),
    rot('armR', it, [[0.02, 0, -0.11], [0.05, 0, -0.13], [0.02, 0, -0.11], [0.02, 0, -0.11]]),
    rot('foreL', it, [[-0.18, 0, 0], [-0.24, 0, 0], [-0.18, 0, 0], [-0.18, 0, 0]]),
    rot('foreR', it, [[-0.18, 0, 0], [-0.24, 0, 0], [-0.18, 0, 0], [-0.18, 0, 0]]),
    pos('hips', it, [
      0, HIP_Y, 0,
      0, HIP_Y + 0.006, 0,
      0, HIP_Y, 0,
      0, HIP_Y, 0,
    ]),
  ]));

  /* --- pick-up ---------------------------------------------------- */
  /* Played once, and scene.js stretches it to however long the crouch beat
     lasts. A real bend: knees first, then the back, with the hands arriving
     at the ground at the midpoint — which is the frame the crop actually
     changes on, so the timing has to put her hands down at half. */
  const pt = [0, 0.45, 0.62, 1];
  clips.push(new THREE.AnimationClip('pick-up', 1, [
    rot('thighL', pt, [[0, 0, 0], [-0.75, 0, 0], [-0.75, 0, 0], [0, 0, 0]]),
    rot('thighR', pt, [[0, 0, 0], [-0.75, 0, 0], [-0.75, 0, 0], [0, 0, 0]]),
    rot('shinL', pt, [[0.14, 0, 0], [1.05, 0, 0], [1.05, 0, 0], [0.14, 0, 0]]),
    rot('shinR', pt, [[0.14, 0, 0], [1.05, 0, 0], [1.05, 0, 0], [0.14, 0, 0]]),
    rot('chest', pt, [[0.03, 0, 0], [0.62, 0, 0], [0.58, 0, 0], [0.03, 0, 0]]),
    rot('head', pt, [[0, 0, 0], [-0.30, 0, 0], [-0.26, 0, 0], [0, 0, 0]]),
    rot('armL', pt, [[0.02, 0, 0.11], [-0.70, 0, 0.20], [-0.62, 0, 0.20], [0.02, 0, 0.11]]),
    rot('armR', pt, [[0.02, 0, -0.11], [-0.70, 0, -0.20], [-0.62, 0, -0.20], [0.02, 0, -0.11]]),
    rot('foreL', pt, [[-0.18, 0, 0], [-0.35, 0, 0], [-0.55, 0, 0], [-0.18, 0, 0]]),
    rot('foreR', pt, [[-0.18, 0, 0], [-0.35, 0, 0], [-0.55, 0, 0], [-0.18, 0, 0]]),
    pos('hips', pt, [
      0, HIP_Y, 0,
      0, HIP_Y - 0.30, 0,
      0, HIP_Y - 0.30, 0,
      0, HIP_Y, 0,
    ]),
  ]));

  /* --- carry ------------------------------------------------------ */
  /* The walk again, with the arms taken out of it and put in front of her
     holding a crate. The legs are the same keys rather than a second set to
     keep in step with the first: a crate that bobs against a different
     rhythm than the feet is worse than no crate. */
  clips.push(new THREE.AnimationClip('carry', 1, [
    rot('thighL', wt, [[F, 0, 0], [-0.05, 0, 0], [B, 0, 0], [0.12, 0, 0], [F, 0, 0]]),
    rot('thighR', wt, [[B, 0, 0], [0.12, 0, 0], [F, 0, 0], [-0.05, 0, 0], [B, 0, 0]]),
    rot('shinL', wt, [[0.16, 0, 0], [0.62, 0, 0], [0.12, 0, 0], [0.30, 0, 0], [0.16, 0, 0]]),
    rot('shinR', wt, [[0.12, 0, 0], [0.30, 0, 0], [0.16, 0, 0], [0.62, 0, 0], [0.12, 0, 0]]),
    rot('footL', wt, [[-0.22, 0, 0], [-0.10, 0, 0], [0.18, 0, 0], [-0.05, 0, 0], [-0.22, 0, 0]]),
    rot('footR', wt, [[0.18, 0, 0], [-0.05, 0, 0], [-0.22, 0, 0], [-0.10, 0, 0], [0.18, 0, 0]]),
    // Leaning back a little, the way anyone carrying weight in front does.
    rot('chest', wt, [[-0.10, 0.03, 0], [-0.10, 0, 0], [-0.10, -0.03, 0], [-0.10, 0, 0], [-0.10, 0.03, 0]]),
    rot('armL', [0, 1], [[-1.15, 0, 0.30], [-1.15, 0, 0.30]]),
    rot('armR', [0, 1], [[-1.15, 0, -0.30], [-1.15, 0, -0.30]]),
    rot('foreL', [0, 1], [[-1.05, 0, 0], [-1.05, 0, 0]]),
    rot('foreR', [0, 1], [[-1.05, 0, 0], [-1.05, 0, 0]]),
    pos('hips', wt, [
      0, HIP_Y - 0.010, 0,
      0, HIP_Y + 0.008, 0,
      0, HIP_Y - 0.010, 0,
      0, HIP_Y + 0.008, 0,
      0, HIP_Y - 0.010, 0,
    ]),
  ]));

  return clips;
}
