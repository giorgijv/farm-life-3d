/* windows.js — the rooms seen through the High Street's shop windows.
 *
 * Every shop's room is built at its real place, behind its own shopfront
 * (interiors.js), so the glass knows exactly what is on the other side of
 * it: a box, from the window to the back wall, the floor to the top of the
 * walls. What the glass cannot have is the room's draw calls. A room costs
 * about eighty and the street, seen from the pavement, twenty-five; six of
 * them drawn behind their windows would be the street several times over.
 *
 * So each room is photographed instead, off screen, from across the road
 * where the street's camera stands, and the glass looks the photograph up.
 * For each pixel of glass the shader follows the line of sight on through
 * the window into the room's box, finds the wall or the floor it meets
 * there, and asks the photograph what is at that point. The walls and the
 * floor are where they really are, so they move behind the glass the way a
 * room does as the camera goes past; what stands in the room is printed
 * onto them as the photograph saw it — exactly right from where it was
 * taken, and a little off from anywhere else.
 *
 * Two photographs a shop: the lamps off and the lamps on. Every light in a
 * room is a straight line in one number, lampsLit (interiors.js), so the
 * two mixed by that number are the room at any hour, not an approximation
 * of it.
 *
 * Nothing here reaches into the scene. buildShopWindow takes a shopfront
 * and the room behind it and hands back the glass and the means to
 * photograph the room for it; scene.js decides when.
 */
import * as THREE from 'three';
import { ROOM } from './interiors.js';
import { FRONT } from './highstreet.js';

/* Where a room is photographed from, in its shop's frame: x along the
   frontage, +z out to the street, y up from the pavement. This is the
   street's own camera with her outside the door — 14 behind her and 5.8
   above her feet, her 0.7 out from the wall — which is the view of a
   shopfront the game gives most. */
export const VANTAGE = { x: 0, y: 5.8, z: 14.7 };

/* The photograph's longer side, in texels. A shopfront seen from the
   street's camera is about four hundred pixels across on a desktop. */
export const PHOTO_SIZE = 512;

/* How far the glass stands in front of the painted pane it covers. The
   painted pane stays where it was, as what the window shows until its
   room has been photographed. */
const PROUD = 0.005;

// The white between an awning's stripes (highstreet.js's paint).
const AWNING_WHITE = '#f6f4ee';

const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec4 pane;
  varying vec3 vWorld;
  varying vec4 vPane;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vPane = pane;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform mat4 uToShop;   // world to the shop's frame
  uniform mat4 uPhoto;    // the shop's frame to the photograph's clip space
  uniform vec3 uBoxMin;   // the room: (left wall, floor, back wall)
  uniform vec3 uBoxMax;   //           (right wall, top of the walls, -)
  uniform float uFront;   // the inner face of the wall the glass is in
  uniform sampler2D uDark;
  uniform sampler2D uLamps;
  uniform float uLit;
  uniform float uDay;     // 1 at noon, 0 at midnight
  uniform vec3 uSky;      // the sky, at the horizon
  uniform vec3 uGround;   // the pavement, lit as it is
  uniform vec3 uReveal;   // the shopfront's paint, for the sides of the opening
  uniform vec4 uAwning;   // its hinge height, drop, distance out at the hinge, reach
  uniform vec4 uAwningSpan; // left, right, its valance's depth, and 1 if it has one
  uniform vec3 uAwningColour;
  uniform int uMode;      // 0 as seen; 1 the room alone; 2 flat magenta; 3 the
                          // sides of the opening, the left red, the right green,
                          // the head and sill blue; 4 what the glass reflects
  varying vec3 vWorld;
  varying vec4 vPane;     // this pane: left, right, bottom, top, in the shop's frame

  vec3 photo(vec3 p) {
    vec4 c = uPhoto * vec4(p, 1.0);
    vec2 uv = clamp(c.xy / c.w * 0.5 + 0.5, 0.0, 1.0);
    return mix(texture2D(uDark, uv).rgb, texture2D(uLamps, uv).rgb, uLit);
  }

  /* What the glass reflects along r from p: the underside of the shop's
     own awning, where the reflection runs up into it — its sloping canvas,
     or the valance hanging from its lip — and otherwise the sky above the
     horizon and the pavement below it. */
  vec3 reflected(vec3 p, vec3 r) {
    if (uAwningSpan.w > 0.5) {
      vec3 under = uAwningColour * (0.1 + 0.3 * uDay);
      float slope = uAwning.y / uAwning.w;
      float den = r.y + slope * r.z;
      if (abs(den) > 1e-4) {
        float t = (uAwning.x + slope * uAwning.z - p.y - slope * p.z) / den;
        vec3 h = p + r * t;
        if (t > 0.0 && h.z >= uAwning.z && h.z <= uAwning.z + uAwning.w
          && h.x >= uAwningSpan.x && h.x <= uAwningSpan.y) return under;
      }
      if (r.z > 1e-4) {
        float lipZ = uAwning.z + uAwning.w;
        float lipY = uAwning.x - uAwning.y;
        vec3 h = p + r * ((lipZ - p.z) / r.z);
        if (h.y <= lipY && h.y >= lipY - uAwningSpan.z
          && h.x >= uAwningSpan.x && h.x <= uAwningSpan.y) return under;
      }
    }
    return r.y > 0.0 ? uSky : uGround;
  }

  void main() {
    if (uMode == 2) {
      gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      return;
    }
    vec3 eye = (uToShop * vec4(cameraPosition, 1.0)).xyz;
    vec3 p = (uToShop * vec4(vWorld, 1.0)).xyz;
    vec3 d = normalize(p - eye);
    // Never a zero to divide by: a component that small meets its wall
    // so far off that one of the others is always nearer.
    d = mix(d, vec3(1e-5), vec3(lessThan(abs(d), vec3(1e-5))));
    // The wall each way the line of sight is heading, and how far to it.
    vec3 t = (mix(uBoxMin, uBoxMax, step(0.0, d)) - p) / d;
    float far = min(min(t.x, t.y), t.z);
    vec3 hit = p + d * far;
    vec3 col;
    if (d.y > 0.0 && t.y <= min(t.x, t.z)) {
      /* The ceiling, which a photograph taken from above the room has no
         picture of: the colour at the top of the back wall over the same
         spot, a shade darker. Only a camera below the head of the window
         looking up ever sees it. */
      col = photo(vec3(hit.x, uBoxMax.y - 0.04, uBoxMin.z)) * 0.72;
    } else {
      col = photo(hit);
    }
    if (uMode == 1) {
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
      return;
    }

    /* The sides of the opening. The glass is at the front of a wall the
       depth of the shopfront and the room's street wall together; a line
       of sight at a slant that leaves the pane's own rectangle before it
       is through that wall has met the reveal, not the room. Painted as
       the shopfront is, the head in its own shadow, the sill catching the
       sky, and a little of the room's light on all of them. */
    float through = (uFront - p.z) / d.z;
    float tx = ((d.x < 0.0 ? vPane.x : vPane.y) - p.x) / d.x;
    float ty = ((d.y < 0.0 ? vPane.z : vPane.w) - p.y) / d.y;
    float leaves = min(tx, ty);
    bool reveal = leaves < through;
    if (uMode == 3) {
      bool jamb = reveal && tx < ty;
      gl_FragColor = vec4(jamb && d.x < 0.0 ? 1.0 : 0.0, jamb && d.x > 0.0 ? 1.0 : 0.0, reveal && !jamb ? 1.0 : 0.0, 1.0);
      return;
    }
    if (reveal) {
      float face = tx < ty ? 0.8 : (d.y < 0.0 ? 1.0 : 0.45);
      col = uReveal * face * (0.08 + 0.6 * uDay) + col * 0.18;
    }

    /* The glass itself: a little of the light through it lost, and the
       street reflected in it — four parts in a hundred looking straight
       at it, more and more towards a glancing angle, which is Fresnel's
       law for glass by Schlick's sum. */
    float cosi = clamp(-d.z, 0.0, 1.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
    vec3 r = vec3(d.x, d.y, -d.z);
    if (uMode == 4) {
      gl_FragColor = vec4(reflected(p, r), 1.0);
      #include <colorspace_fragment>
      return;
    }
    col = col * (1.0 - fresnel) * 0.94 + reflected(p, r) * fresnel;

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

// The shop's own frame to the world: turned by its yaw, at its frontage.
function shopMatrix(unit) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(unit.x, 0, unit.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), unit.yaw),
    new THREE.Vector3(1, 1, 1),
  );
}

/* The glass: a quad over each painted pane, facing the street, in world
   space. Normals for the ambient occlusion pass, which draws every mesh
   with a material of its own that reads them. */
function glassGeometry(unit, panes) {
  const pos = [];
  const nrm = [];
  const rect = [];
  for (const p of panes) {
    const z = p.z + PROUD;
    const quad = [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y0], [p.x1, p.y1], [p.x0, p.y1]];
    for (const [x, y] of quad) {
      pos.push(x, y, z);
      nrm.push(0, 0, 1);
      // Every corner carries its pane's rectangle, for the reveal.
      rect.push(p.x0, p.x1, p.y0, p.y1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('pane', new THREE.Float32BufferAttribute(rect, 4));
  g.applyMatrix4(shopMatrix(unit));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/* The camera the photograph is taken with: at the vantage, looking at the
   middle of the room, and its frustum drawn in tight round the room's box
   — walls, floor, and the depth of the shopfront in front of them, which a
   line of sight crosses before it is inside — so that every texel of the
   photograph is room. */
function photoCamera(unit, room, vantage) {
  const toWorld = shopMatrix(unit);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(vantage.x, vantage.y, vantage.z).applyMatrix4(toWorld);
  cam.lookAt(new THREE.Vector3((room.minX + room.maxX) / 2, ROOM.height / 2, room.back / 2).applyMatrix4(toWorld));
  cam.updateMatrixWorld();
  const view = [];
  for (const x of [room.minX, room.maxX]) {
    for (const y of [0, ROOM.height]) {
      for (const z of [room.back, 0.16]) {
        view.push(new THREE.Vector3(x, y, z).applyMatrix4(toWorld).applyMatrix4(cam.matrixWorldInverse));
      }
    }
  }
  const near = Math.min(...view.map((v) => -v.z)) * 0.9;
  const far = Math.max(...view.map((v) => -v.z)) * 1.1;
  const xs = view.map((v) => (v.x * near) / -v.z);
  const ys = view.map((v) => (v.y * near) / -v.z);
  const [l, r, b, t] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  cam.near = near;
  cam.far = far;
  cam.projectionMatrix.makePerspective(l, r, t, b, near, far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  const toPhoto = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(toWorld);
  return { cam, toPhoto, aspect: (r - l) / (t - b) };
}

/**
 * The glass for one shop, and its two photographs.
 *   unit:  the shopfront, { id, x, z, yaw }
 *   panes: its glass, from highstreet.js's shopGlass
 *   room:  the room behind it, { minX, maxX, back } in the shop's frame
 */
export function buildShopWindow({ unit, panes, room, vantage = VANTAGE, size = PHOTO_SIZE }) {
  const shot = photoCamera(unit, room, vantage);
  const width = shot.aspect >= 1 ? size : Math.max(32, Math.round(size * shot.aspect));
  const height = shot.aspect >= 1 ? Math.max(32, Math.round(size / shot.aspect)) : size;
  /* Eight bits a channel stored as sRGB, smoothed at the edges and
     mipmapped. sRGB because the photograph holds the room's light as it
     is, before it is turned into a picture, and eight bits of that light
     stored straight band in the dark corners of a room at night; sRGB
     spends its steps where the eye sees them, and is turned back into
     light by the GPU when the glass reads it, before the two photographs
     are mixed — so the mix is still a mix of light. Mipmapped because a
     window seen from the far end of the street is a few dozen pixels of a
     photograph five hundred across, which without them sparkles as the
     camera moves. */
  const target = (which) => {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      colorSpace: THREE.SRGBColorSpace,
      samples: 4,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    rt.texture.name = `shop-window:${unit.id}:${which}`;
    return rt;
  };
  const photos = { dark: target('dark'), lamps: target('lamps') };
  const taken = { dark: false, lamps: false };

  const material = new THREE.ShaderMaterial({
    name: `shop-window:${unit.id}`,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uToShop: { value: new THREE.Matrix4() },
      uPhoto: { value: new THREE.Matrix4() },
      uBoxMin: { value: new THREE.Vector3() },
      uBoxMax: { value: new THREE.Vector3() },
      uFront: { value: -ROOM.wall },
      uDark: { value: null },
      uLamps: { value: null },
      uLit: { value: 0 },
      uDay: { value: 1 },
      uSky: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uReveal: { value: new THREE.Color() },
      uAwning: { value: new THREE.Vector4() },
      uAwningSpan: { value: new THREE.Vector4() },
      uAwningColour: { value: new THREE.Color() },
      uMode: { value: 0 },
    }]),
    vertexShader,
    fragmentShader,
    fog: true,
  });
  material.toneMapped = false;
  const u = material.uniforms;
  u.uToShop.value.copy(shopMatrix(unit)).invert();
  u.uPhoto.value.copy(shot.toPhoto);
  u.uBoxMin.value.set(room.minX, 0, room.back);
  u.uBoxMax.value.set(room.maxX, ROOM.height, 1);
  u.uDark.value = photos.dark.texture;
  u.uLamps.value = photos.lamps.texture;
  /* The shopfront around the glass: its paint, for the reveal, and its
     awning, whose underside is what the top of the window reflects to a
     camera low enough to see it — the stripes and the white between them,
     taken together. */
  u.uReveal.value.set(unit.colours.paint);
  if (unit.awning !== false) {
    const A = FRONT.awning;
    const half = (unit.width - 2 * FRONT.pilaster - 0.06) / 2;
    u.uAwning.value.set(A.hinge, A.drop, A.wall, A.reach);
    u.uAwningSpan.value.set(-half, half, A.valance, 1);
    u.uAwningColour.value.set(unit.colours.stripe).lerp(new THREE.Color(AWNING_WHITE), 0.5);
  }

  const mesh = new THREE.Mesh(glassGeometry(unit, panes), material);
  mesh.name = `shop-window:${unit.id}`;
  // Shown once both photographs are in; the painted window until then.
  mesh.visible = false;

  const ready = () => taken.dark && taken.lamps;
  let ms = 0;
  let shots = 0;
  /* Being taken again, with the last pair still showing: a window whose
     room has changed keeps the room it had until the new photographs are
     both in, rather than going back to paint for the frames between. */
  let stale = false;

  return {
    id: unit.id,
    mesh,
    material,
    camera: shot.cam,
    ready,
    /* Which photograph is still to take, or null. */
    next: () => (!taken.dark ? 'dark' : !taken.lamps ? 'lamps' : null),
    /* Takes one of the two photographs of the room, which has to be the
       room built for this shop. The room's lamps are left as the
       photograph had them; whoever next draws the room sets them again. */
    photograph(renderer, built, which) {
      const t0 = performance.now();
      const prev = renderer.getRenderTarget();
      built.forPhoto(true);
      built.update(which === 'lamps' ? 1 : 0, 0);
      renderer.setRenderTarget(photos[which]);
      renderer.render(built.scene, shot.cam);
      renderer.setRenderTarget(prev);
      built.forPhoto(false);
      taken[which] = true;
      shots += 1;
      ms += performance.now() - t0;
      if (ready()) stale = false;
      mesh.visible = ready() || stale;
    },
    /* Both photographs to be taken again, the old ones shown meanwhile. */
    retake() {
      if (ready()) stale = true;
      taken.dark = false;
      taken.lamps = false;
    },
    /* Both photographs gone — a lost context takes everything a render
       target held — so the painted window shows until they are taken
       again. */
    forget() {
      taken.dark = false;
      taken.lamps = false;
      stale = false;
      mesh.visible = false;
    },
    setLit(lit) {
      u.uLit.value = lit;
    },
    /* The street as the glass reflects it: the sky's colour, the pavement's
       as it is lit, and how far into the day it is. */
    setStreet({ sky, ground, day }) {
      u.uSky.value.copy(sky);
      u.uGround.value.copy(ground);
      u.uDay.value = day;
    },
    setMode(mode) {
      u.uMode.value = mode;
    },
    report: () => ({
      id: unit.id,
      ready: ready(),
      taken: { ...taken },
      size: [width, height],
      vantage: { ...vantage },
      box: { minX: room.minX, maxX: room.maxX, back: room.back, height: ROOM.height },
      panes: panes.length,
      // Where the glass is, in the world.
      bounds: {
        min: mesh.geometry.boundingBox.min.toArray(),
        max: mesh.geometry.boundingBox.max.toArray(),
      },
      ms: Math.round(ms),
      // How many photographs have been taken, all told.
      shots,
      // Both photographs and their mipmaps, which add a third.
      bytes: Math.round(width * height * 4 * 2 * (4 / 3)),
    }),
    dispose() {
      photos.dark.dispose();
      photos.lamps.dispose();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
