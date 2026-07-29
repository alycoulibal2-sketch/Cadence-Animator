// Builds three.js objects from rig definitions and solves joint transforms.
import * as THREE from '../../node_modules/three/build/three.module.js';
import * as CF from './cf.js';
import { isClosedShape } from './effectShapes.js';
import { buildShapeGeometry } from './effectMeshBuilder.js';
import {
  isClothedPart, buildPartClothingCanvas, buildClassicAtlas, buildR15GroupAtlas, r15GroupOf,
  loadTemplate, loadLocalMesh, classicHeadMeshPath, classicPartMeshPath,
} from './clothing.js';

let classicFacePromise = null;
function getClassicFace() {
  if (!classicFacePromise) classicFacePromise = window.cadence.classicFace();
  return classicFacePromise;
}

const texLoader = new THREE.TextureLoader();
const meshGeoCache = new Map(); // meshId -> Promise<THREE.BufferGeometry>

// Parts render at their true Roblox size (flush, touching — same as Studio). Handle markers stay
// visibly on top via depthTest:false + renderOrder instead of physically prying parts apart, which
// used to leave a visible seam at every joint and made rigs read as disassembled.
export const PART_GAP_SCALE = 1;
const partGapVector = new THREE.Vector3(PART_GAP_SCALE, PART_GAP_SCALE, PART_GAP_SCALE);

function fetchMeshGeometry(meshId) {
  const id = String(meshId).match(/(\d{4,})/)?.[1];
  if (!id) return Promise.reject(new Error('bad mesh id'));
  if (!meshGeoCache.has(id)) {
    meshGeoCache.set(id, window.cadence.fetchMesh(id).then((data) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
      geo.setIndex(data.indices);
      geo.computeBoundingBox();
      return geo;
    }));
  }
  return meshGeoCache.get(id);
}

// Roblox renders avatar textures with anisotropic filtering. Without it a surface viewed at any
// angle — which is most of a body most of the time — samples along a single axis and reads
// noticeably blurrier than the same character in Studio. three.js defaults anisotropy to 1, so
// nothing here got it. The maximum the GPU supports is published by the renderer at init.
let maxAnisotropy = 1;
export function setMaxAnisotropy(n) { maxAnisotropy = Math.max(1, n | 0); }

// Every texture this file produces goes through here, so filtering can never be set on one path
// and forgotten on another.
function configureTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; // trilinear, so distant parts don't shimmer
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function loadRobloxTexture(texId) {
  const id = String(texId).match(/(\d{4,})/)?.[1];
  if (!id) return Promise.resolve(null);
  return window.cadence.fetchTexture(id).then((dataUri) => new Promise((resolve) => {
    texLoader.load(dataUri, (t) => resolve(configureTexture(t)), undefined, () => resolve(null));
  })).catch(() => null);
}

// The classic Roblox head — SpecialMesh.MeshType = Head, which is what BOTH the R6 and the R15
// rigs Studio's Rig Builder produces actually use.
//
// These three numbers are measured, not eyeballed. Roblox ships the real mesh with Studio
// (rbxasset://avatar/heads/head.mesh); reading it back showed every horizontal cross-section is a
// perfect circle, so the head genuinely IS a surface of revolution, and the profile is a straight
// wall joined to the caps by a quarter-circle bevel. Radius at each of the mesh's 10 distinct Y
// levels matches R=0.601 / H=0.601 / bevel=0.300 to four decimals, at every level. The old values
// (0.42 / 0.5 / 0.16) were a guess and rendered a head roughly a fifth too narrow.
const HEAD_R = 0.601;    // wall radius
const HEAD_H = 0.601;    // half height
const HEAD_r = 0.300;    // corner bevel radius — half the height, i.e. a very round head
const HEAD_RADIAL = 36;  // radial segments: the real mesh's cross-section is a 36-gon
const HEAD_ARC = 4;      // segments per corner arc: reproduces the real mesh's Y levels exactly

// Roblox renders MeshType.Head at the mesh's OWN size when SpecialMesh.Scale is the canonical
// 1.25 that every stock rig ships with — verified directly in Studio, by covering a Head at
// Scale 125 with a MeshPart of the same mesh sized to exactly 100x its 1.19785 x 1.20242 x
// 1.19785 native size: the two silhouettes coincide. So Scale is a multiplier on top of native
// size, not an absolute size, which is why it is divided out here. Multiplying BY it (what this
// used to do) rendered every classic head at 1.05 wide x 1.25 tall instead of ~1.2 x 1.2 —
// noticeably narrower and taller than the same rig in Studio.
const HEAD_CANONICAL_SCALE = 1.25;

// How much to scale headGeometry() by for a given part, whichever way that part models its head.
function headGeometryScale(def) {
  if (def.specialMesh && def.specialMesh.meshType === 'Head') {
    const s = def.specialMesh.scale || [HEAD_CANONICAL_SCALE, HEAD_CANONICAL_SCALE, HEAD_CANONICAL_SCALE];
    return [s[0] / HEAD_CANONICAL_SCALE, s[1] / HEAD_CANONICAL_SCALE, s[2] / HEAD_CANONICAL_SCALE];
  }
  // Rthro-family MeshPart head standing in for a CDN mesh that wouldn't load: fit to the part.
  return [def.size[0] / (HEAD_R * 2), def.size[1] / (HEAD_H * 2), def.size[2] / (HEAD_R * 2)];
}

function headGeometry() {
  const R = HEAD_R, H = HEAD_H, r = HEAD_r;
  const N = HEAD_ARC;
  const pts = [];
  pts.push(new THREE.Vector2(0, -H));
  pts.push(new THREE.Vector2(R - r, -H));
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - r + r * Math.cos(a), -H + r + r * Math.sin(a)));
  }
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - r + r * Math.cos(a), H - r + r * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0, H));
  // Half a segment of phi offset, so -Z (the face side) lands on the middle of a facet rather
  // than on a vertex — which is how Roblox's mesh is wound, and makes the widest points line up
  // with its 1.19785 rather than the 1.202 a vertex-on-axis winding would give.
  const geo = new THREE.LatheGeometry(pts, HEAD_RADIAL, Math.PI / HEAD_RADIAL);
  geo.computeVertexNormals();
  return geo;
}

// Radius and outward normal of the classic-head profile at a given height — the same profile
// headGeometry() lathes, so anything built from this sits exactly on the head's surface.
function headProfileAt(y) {
  const flat = HEAD_H - HEAD_r;
  if (Math.abs(y) <= flat) return { r: HEAD_R, ny: 0, nr: 1 };
  const a = Math.asin(Math.min(1, (Math.abs(y) - flat) / HEAD_r));
  return { r: (HEAD_R - HEAD_r) + HEAD_r * Math.cos(a), ny: Math.sign(y) * Math.sin(a), nr: Math.cos(a) };
}

// The classic face is a PLANAR projection spanning the head's own rendered bounds — measured, not
// assumed: Roblox's face.png puts its two eyes 0.1875 of the texture width apart, and the same
// rig in Studio renders them 0.183 of the head's width apart, so the texture covers the head
// essentially 1:1. That means u/v come from world x/y (a projection), NOT from arc length, and
// the face reaches past the head's straight wall onto the top and bottom bevels — which is why
// this shrink-wraps the head's real profile instead of using a plain cylinder section. The old
// cylinder patch spanned only ~0.58 of the head's width, rendering a face about a third too small.
function headFacePatchGeometry(kx, ky, kz, offset) {
  const PHI = Math.PI * (40 / 180); // half-width in azimuth; face content only reaches about 21 deg
  const YMAX = HEAD_H * 0.9;
  const NPHI = 24, NY = 16;
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= NY; j++) {
    const y = -YMAX + (2 * YMAX * j) / NY;
    const prof = headProfileAt(y);
    for (let i = 0; i <= NPHI; i++) {
      const phi = -PHI + (2 * PHI * i) / NPHI;
      const nx = prof.nr * Math.sin(phi), ny = prof.ny, nz = -prof.nr * Math.cos(phi);
      const px = prof.r * Math.sin(phi), pz = -prof.r * Math.cos(phi);
      pos.push(px * kx + nx * offset, y * ky + ny * offset, pz * kz + nz * offset);
      nrm.push(nx, ny, nz);
      uv.push(0.5 + px / (HEAD_R * 2), 0.5 + y / (HEAD_H * 2));
    }
  }
  const at = (i, j) => j * (NPHI + 1) + i;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NPHI; i++) {
      // Wound so the outward face is the visible one; -Z is toward the viewer for a rig's front.
      idx.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// Roblox does not outline parts, and its parts are not rounded either — both were wrong guesses
// before. Reading Roblox's OWN classic limb mesh (`avatar/meshes/leftarm.mesh`, shipped with every
// install) settles it exactly: 24 unique positions, 44 triangles, and only **6 distinct normals**,
// all axis-aligned. Every corner of the box is cut back by a flat chamfer of exactly 0.065 studs,
// and the chamfer faces are shaded with the box's own axis normals rather than their own — which
// is precisely what gives a Roblox part its hard-edged look with a bright sliver on each corner.
// A rounded fillet with smooth normals (what this used to build) can never match that.
export const PART_EDGE_RADIUS = 0.065;

// Box-unwrap UVs laid out the way Roblox's own body meshes are: the four side faces in one
// horizontal strip that walks around the body (front, left, back, right, each sized by its real
// width), with the two caps above and below it. Clothing compositing reads these rects back out
// (see clothing.js), so a box part needs a genuine unwrap here, not a per-patch convenience
// mapping — otherwise a shirt on an R6 rig would land as noise.
function boxUnwrapUv(nx, ny, nz, px, py, pz, sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const perimeter = 2 * sx + 2 * sz;
  const wFront = sx / perimeter, wSide = sz / perimeter;
  const V0 = 0.25, V1 = 0.75; // the side strip's band; caps sit outside it
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) {
    const s = (px + hx) / sx, t = (pz + hz) / sz;
    return ny > 0 ? [s * 0.5, V1 + t * (1 - V1)] : [s * 0.5, V0 - t * V0];
  }
  const v = V0 + ((py + hy) / sy) * (V1 - V0);
  // One continuous loop around the body, starting at the front and turning toward the character's
  // own left, which is the order the stock meshes use (measured: front, -X, +Z, +X).
  if (az >= ax) {
    return nz < 0
      ? [((hx - px) / sx) * wFront, v]
      : [wFront + wSide + ((px + hx) / sx) * wFront, v];
  }
  return nx < 0
    ? [wFront + ((pz + hz) / sz) * wSide, v]
    : [2 * wFront + wSide + ((hz - pz) / sz) * wSide, v];
}

// Roblox's classic part shape, reproduced exactly from its own mesh rather than approximated.
//
// Derived by reading `avatar/meshes/leftarm.mesh` out of the local install: for a box with
// half-extents (hx,hy,hz), every one of the 8 corners is replaced by 3 vertices in which exactly
// ONE axis stays at its full extent and the other two are pulled in by the chamfer c:
//     (hx, hy-c, hz-c)   (hx-c, hy, hz-c)   (hx-c, hy-c, hz)
// which gives 24 vertices. The surface is then 6 rectangular faces (inset by c on both in-plane
// axes), 12 chamfer strips along the edges, and 8 corner triangles — 12 + 24 + 8 = 44 triangles,
// matching the real mesh's triangle count exactly.
//
// Normals are snapped to the nearest box axis, never averaged, because the real mesh carries only
// 6 distinct normals. That hard-edged shading is a large part of what makes a part read as Roblox.
function classicPartGeometry(sx, sy, sz, chamfer = PART_EDGE_RADIUS) {
  const h = [sx / 2, sy / 2, sz / 2];
  const c = Math.min(chamfer, h[0] * 0.9, h[1] * 0.9, h[2] * 0.9);
  if (!(c > 1e-6)) return new THREE.BoxGeometry(sx, sy, sz);

  const pos = [], nrm = [], uv = [];
  // Corner vertex where `axis` is the one held at full extent, for the octant given by signs.
  const corner = (s, axis) => {
    const p = [s[0] * (h[0] - c), s[1] * (h[1] - c), s[2] * (h[2] - c)];
    p[axis] = s[axis] * h[axis];
    return p;
  };
  const SIGNS = [-1, 1];
  const emit = (tri) => {
    // Geometric normal, snapped to the nearest axis — matches the real mesh's 6-normal shading.
    const e1 = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]];
    const e2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
    const g = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(g[0], g[1], g[2]);
    if (!len) return;
    let dom = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(g[k]) > Math.abs(g[dom])) dom = k;
    const n = [0, 0, 0];
    n[dom] = Math.sign(g[dom]);
    for (const p of tri) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      const t = boxUnwrapUv(n[0], n[1], n[2], p[0], p[1], p[2], sx, sy, sz);
      uv.push(t[0], t[1]);
    }
  };
  // A quad, wound so its geometric normal points along `want`.
  const quad = (a, b, c2, d, want) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
    const g = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    if (g[0] * want[0] + g[1] * want[1] + g[2] * want[2] >= 0) { emit([a, b, c2]); emit([a, c2, d]); }
    else { emit([a, c2, b]); emit([a, d, c2]); }
  };

  // 6 inset faces
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    for (const s of SIGNS) {
      const at = (su, sv) => {
        const p = [0, 0, 0];
        p[axis] = s * h[axis];
        p[u] = su * (h[u] - c);
        p[v] = sv * (h[v] - c);
        return p;
      };
      const want = [0, 0, 0]; want[axis] = s;
      quad(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1), want);
    }
  }
  // 12 chamfer strips: one per box edge, spanning the two faces that meet there
  for (let axis = 0; axis < 3; axis++) { // the axis the edge RUNS along
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    for (const su of SIGNS) {
      for (const sv of SIGNS) {
        const s = [0, 0, 0]; s[u] = su; s[v] = sv;
        const ends = SIGNS.map((sa) => {
          const sg = s.slice(); sg[axis] = sa;
          return [corner(sg, u), corner(sg, v)];
        });
        const want = [0, 0, 0]; want[u] = su; want[v] = sv;
        quad(ends[0][0], ends[0][1], ends[1][1], ends[1][0], want);
      }
    }
  }
  // 8 corner triangles
  for (const sx1 of SIGNS) {
    for (const sy1 of SIGNS) {
      for (const sz1 of SIGNS) {
        const s = [sx1, sy1, sz1];
        const tri = [corner(s, 0), corner(s, 1), corner(s, 2)];
        const e1 = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]];
        const e2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
        const g = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        if (g[0] * sx1 + g[1] * sy1 + g[2] * sz1 >= 0) emit(tri);
        else emit([tri[0], tri[2], tri[1]]);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Is `def` drawn with the classic head shape (as opposed to a real fetched mesh, or an arbitrary
// custom-imported part that just happens to be named "Head")? Both the R6-style (Part +
// specialMesh.meshType='Head') and Rthro-style (MeshPart named Head) conventions land here.
function isLatheHeadPart(def) {
  if (def.specialMesh && def.specialMesh.meshType === 'Head') return true;
  return def.className === 'MeshPart' && def.name === 'Head' && !def.customMesh;
}

// Roblox Material -> a reasonable PBR approximation. Roblox's own renderer uses a proprietary
// baked material texture atlas we have no access to, so this is a best-effort visual match (right
// roughness/metalness family, Neon actually glows) rather than a pixel-identical reproduction —
// that's a real limit of rendering Roblox content in a from-scratch three.js scene, not a bug.
const MATERIAL_PROPS = {
  Plastic: { roughness: 0.82, metalness: 0.02 },
  SmoothPlastic: { roughness: 0.25, metalness: 0.02 },
  Neon: { roughness: 0.35, metalness: 0, emissive: 0.85 },
  Metal: { roughness: 0.35, metalness: 0.9 },
  CorrodedMetal: { roughness: 0.75, metalness: 0.7 },
  DiamondPlate: { roughness: 0.3, metalness: 0.85 },
  Foil: { roughness: 0.15, metalness: 0.95 },
  Glass: { roughness: 0.05, metalness: 0.1, transparentBoost: 0.55 },
  ForceField: { roughness: 0.1, metalness: 0.2, transparentBoost: 0.6 },
  Ice: { roughness: 0.1, metalness: 0.05, transparentBoost: 0.35 },
  Glacier: { roughness: 0.15, metalness: 0.05, transparentBoost: 0.25 },
  Water: { roughness: 0.1, metalness: 0.1, transparentBoost: 0.4 },
  Wood: { roughness: 0.88, metalness: 0 },
  WoodPlanks: { roughness: 0.88, metalness: 0 },
  Cardboard: { roughness: 0.95, metalness: 0 },
  Leather: { roughness: 0.7, metalness: 0 },
  Fabric: { roughness: 0.95, metalness: 0 },
  Carpet: { roughness: 0.97, metalness: 0 },
  Rubber: { roughness: 0.8, metalness: 0 },
  Plaster: { roughness: 0.85, metalness: 0 },
  Grass: { roughness: 1, metalness: 0 },
  LeafyGrass: { roughness: 1, metalness: 0 },
  Sand: { roughness: 1, metalness: 0 },
  Snow: { roughness: 0.95, metalness: 0 },
  Mud: { roughness: 0.9, metalness: 0 },
  Ground: { roughness: 1, metalness: 0 },
  Salt: { roughness: 0.9, metalness: 0 },
};
const UNKNOWN_MATERIAL_PROPS = { roughness: 0.92, metalness: 0 }; // stone/masonry family fallback
function materialProps(name) {
  // No `material` field at all (older saved projects, the hand-written builtin rig presets)
  // means "never captured a Material" — Roblox's own actual default is Plastic, so that's the
  // correct fallback here, not the generic stone/masonry bucket below (which is only for a
  // material NAME that's present but somehow not in the lookup table, which shouldn't happen
  // given every official Enum.Material name is mapped, but is a safer miss than assuming stone).
  if (!name) return MATERIAL_PROPS.Plastic;
  return MATERIAL_PROPS[name] || UNKNOWN_MATERIAL_PROPS;
}

// Roblox NormalId -> which local axis a decal plane's normal points along (sign) and how to
// rotate a three.js PlaneGeometry (default normal +Z) to face that direction.
const FACE_ORIENT = {
  Front: { axis: 'z', sign: -1, rotY: Math.PI, rotX: 0 },
  Back: { axis: 'z', sign: 1, rotY: 0, rotX: 0 },
  Right: { axis: 'x', sign: 1, rotY: Math.PI / 2, rotX: 0 },
  Left: { axis: 'x', sign: -1, rotY: -Math.PI / 2, rotX: 0 },
  Top: { axis: 'y', sign: 1, rotY: 0, rotX: -Math.PI / 2 },
  Bottom: { axis: 'y', sign: -1, rotY: 0, rotX: Math.PI / 2 },
};

// Embedded exact geometry from a locally-imported FBX/GLB/OBJ file (see meshImport.js) — the data
// is already fully in memory (no CDN round-trip), so this is synchronous and can never fall back
// to a placeholder: there's no async fetch to fail. Built once here and never touched again.
function customMeshGeometry(def) {
  const cm = def.customMesh;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(cm.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(cm.normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(cm.uvs, 2));
  geo.setIndex(cm.indices);
  geo.computeBoundingBox();
  return geo;
}

// Geometry straight out of a Roblox mesh payload, fitted to the part's real size the same way a
// MeshPart is: recentre on the mesh's own bounds, then scale those bounds onto Part.Size.
function geometryFromMeshData(data, size) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  geo.setIndex(data.indices);
  geo.computeBoundingBox();
  if (size) {
    const bb = geo.boundingBox;
    const bs = new THREE.Vector3(); bb.getSize(bs);
    const bc = new THREE.Vector3(); bb.getCenter(bc);
    geo.translate(-bc.x, -bc.y, -bc.z);
    geo.scale(size[0] / (bs.x || 1), size[1] / (bs.y || 1), size[2] / (bs.z || 1));
    geo.computeBoundingBox();
  }
  return geo;
}

// Is this part one Roblox ships a real mesh for locally? The classic head is an exact file in the
// Studio install, so it is always loaded rather than approximated.
//
// The five R6 body meshes are shipped too, and their UVs address Roblox's 1024x512 body atlas —
// so they are used ONLY when the exact atlas composite is available to go with them (clothing.js).
// The two belong together: the real meshes without the real atlas would sample a texture laid out
// for a different unwrap. Without local content, classicPartGeometry reproduces the same shape
// (same 0.065 chamfer, same 44 triangles, same axis-snapped normals) with UVs this renderer
// controls, and the per-part fallback composite matches those instead.
function localMeshPathFor(def, useAtlas) {
  if (def.customMesh) return null;
  if (def.specialMesh && def.specialMesh.meshType === 'Head') return classicHeadMeshPath();
  if (def.className === 'MeshPart' && def.name === 'Head' && !def.meshId) return classicHeadMeshPath();
  if (useAtlas && def.className !== 'MeshPart' && !def.specialMesh) return classicPartMeshPath(def.name);
  return null;
}

function partGeometry(def) {
  const [sx, sy, sz] = def.size;
  if (def.customMesh) return customMeshGeometry(def);
  if (def.className === 'MeshPart' || (def.specialMesh && def.specialMesh.meshType === 'FileMesh' && def.specialMesh.meshId)) {
    if (def.name === 'Head') {
      // Rthro-family heads are gated MeshPart CDN assets that 401 without an authenticated Roblox
      // session (see fetchMeshGeometry below) — the classic lathed head shape is a much closer
      // stand-in than a bare sphere for the real default Roblox head while that fetch is pending
      // or fails, and never affects the actual exported meshId/className data.
      const g = headGeometry();
      const [kx, ky, kz] = headGeometryScale(def);
      g.scale(kx, ky, kz);
      return g;
    }
    // Placeholder until the real mesh lands. A rounded box, not a capsule: every stock R15 body
    // part IS a rounded box, so the limb reads correctly the instant it appears instead of
    // popping from a pill shape to a block once the fetch completes.
    return classicPartGeometry(sx, sy, sz);
  }
  if (def.specialMesh && def.specialMesh.meshType === 'Head') {
    const g = headGeometry();
    const [kx, ky, kz] = headGeometryScale(def);
    g.scale(kx, ky, kz);
    return g;
  }
  if (def.shape === 'Ball') return new THREE.SphereGeometry(Math.min(sx, sy, sz) / 2, 24, 18);
  if (def.shape === 'Cylinder') {
    const g = new THREE.CylinderGeometry(Math.min(sy, sz) / 2, Math.min(sy, sz) / 2, sx, 24);
    g.rotateZ(Math.PI / 2); // Roblox cylinders extend along X
    return g;
  }
  return classicPartGeometry(sx, sy, sz);
}

const handleGeoNormal = new THREE.SphereGeometry(0.22, 12, 10);
const handleGeoSmall = new THREE.SphereGeometry(0.12, 12, 10);
// Unit cube reused (scaled per-part via the matrix, like partGapVector below) for every part's
// selection-box overlay — a Moon-Animator-style click target sized to the whole part instead of
// its exact mesh silhouette, so clicking a limb is consistent regardless of the real geometry's
// shape/texture. Invisible until hovered/selected (see RigInstance#setHighlight).
const SEL_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

// Moon Animator draws a small pale-blue patch on every part, so which limbs are selectable — and
// where to click for each — is visible without hunting. Cadence already had a per-part click box
// covering the whole part, but it was invisible until hovered, so there was nothing to aim at.
// These markers are that affordance: one camera-facing quad per part, sitting on the surface
// nearest the viewer so it reads as painted on the limb from any angle.
const PART_MARKER_GEO = new THREE.PlaneGeometry(1, 1);
const MARKER_COLOR = 0x8ed0e8;        // pale blue, matching Moon's
const MARKER_COLOR_HOVER = 0xd7f2ff;
const MARKER_COLOR_SELECTED = 0x7c8cff;
// Fraction of the face's shorter side the patch covers, then clamped — the cap is what stops a
// big part like the torso getting a slab that swamps it.
const MARKER_FRACTION = 0.45;
const MARKER_MIN = 0.18, MARKER_MAX = 0.62;
// Scratch objects for updatePartMarkers — it runs for every part every frame, so it allocates
// nothing.
const _mkCamPos = new THREE.Vector3();
const _mkCentre = new THREE.Vector3();
const _mkDir = new THREE.Vector3();
const _mkLocal = new THREE.Vector3();
const _mkPos = new THREE.Vector3();
const _mkScale = new THREE.Vector3();
const _mkUp = new THREE.Vector3(0, 1, 0);
const _mkQuat = new THREE.Quaternion();
const _mkMat = new THREE.Matrix4();
const _mkNormalMat = new THREE.Matrix4();
const _mkLook = new THREE.Matrix4();
const _mkBoxSize = new THREE.Vector3();
const _mkU = new THREE.Vector3();
const _mkV = new THREE.Vector3();
const _mkN = new THREE.Vector3();
const _mkBasis = new THREE.Matrix4();
const _mkRot = new THREE.Matrix3();
const _mkRotT = new THREE.Matrix3();

// Half-extents of what a part actually DRAWS as, cached against the geometry object so a part that
// swaps its placeholder for a real mesh picks the new bounds up automatically.
function partHalfExtents(p) {
  const geo = p.mesh.geometry;
  if (p._extentsFor !== geo) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    geo.boundingBox.getSize(_mkBoxSize);
    p._extents = [_mkBoxSize.x / 2 || 0.5, _mkBoxSize.y / 2 || 0.5, _mkBoxSize.z / 2 || 0.5];
    // Vertex-accurate outer radius, used to cap the box exit distance below.
    p._radius = (geo.boundingSphere && geo.boundingSphere.radius) || Math.hypot(...p._extents);
    p._extentsFor = geo;
    p._markerSize = null;
  }
  return p._extents;
}

// Marker size for the face being shown: a fraction of that face's shorter side, so the patch is
// always in proportion to the surface it sits on.
function markerSizeFor(half, axis) {
  const u = half[(axis + 1) % 3] * 2, v = half[(axis + 2) % 3] * 2;
  return Math.min(MARKER_MAX, Math.max(MARKER_MIN, Math.min(u, v) * MARKER_FRACTION));
}

// Part edges: nothing to draw. Roblox's renderer has no outline pass at all — measured directly
// in Studio at 2276 px/stud, a part's silhouette corner is a smooth ~0.042-stud arc and its edges
// read as LIGHTER shaded bands, never darker lines. This file used to add a black LineSegments2
// overlay along every hard corner to imitate that; against the real thing it reads as a wireframe
// Studio never shows. classicPartGeometry() above produces the highlight from real geometry now.

export class RigInstance {
  // opts.onMeshError(def, kind, reason): kind is 'mesh' | 'texture' — called whenever a part's
  // real CDN geometry/texture fails to load and it's about to silently stay on its placeholder
  // (a box, or flat grey) with no other visible sign anything went wrong. Previously nothing
  // called this at all — a mesh or texture 404/401/network hiccup just permanently looked like
  // "the app simplified my model" with zero error surfaced anywhere. See viewport.js's makeInstance
  // for where this gets wired to an actual toast.
  constructor(item, scene, opts = {}) {
    this.item = item;
    this.scene = scene;
    this.onMeshError = opts.onMeshError || null;
    this.group = new THREE.Group();
    this.group.name = item.name;
    this.parts = new Map();   // partId -> { def, mesh, world: cf }
    this.joints = [];         // motor joints (animatable)
    this.welds = [];          // rigid attachments
    this.jointByPart1 = new Map();
    this.solveOrder = null;
    this.tmpM = new THREE.Matrix4();
    this.showRoot = false;
    this.handles = [];        // [{ joint, part0Id, mesh }] — always-visible clickable joint markers

    const rig = item.rig;
    this.partDefsByName = new Map(rig.parts.map((p) => [p.name, p]));
    // One Shirt is worn by every part of a body, so the templates are decoded once per rig here
    // and every part composites from the same images.
    this.clothing = (rig.clothing && (rig.clothing.shirt || rig.clothing.pants)) ? rig.clothing : null;
    this.clothingImages = this.clothing ? Promise.all([
      this.clothing.shirt ? loadTemplate(this.clothing.shirt) : null,
      this.clothing.pants ? loadTemplate(this.clothing.pants) : null,
    ]).then(([shirt, pants]) => ((shirt || pants) ? { shirt, pants } : null)) : null;
    // Roblox's own bake, when its content is on this machine. Resolves to null otherwise, and
    // every part then falls back to the per-part approximation — so a machine with no Roblox
    // install still renders clothing, just not provably-exactly.
    this.classicAtlas = this.clothing ? buildClassicAtlas(rig, this.clothing).catch(() => null) : null;
    // Set once the atlas is confirmed present: it switches classic body parts onto Roblox's own
    // meshes (whose UVs address that atlas) and turns off the usual texture Y-flip.
    this.usingAtlas = false;
    for (const p of rig.parts) this.#buildPart(p);
    for (const j of rig.joints || []) {
      if (j.kind === 'weld') this.welds.push(j);
      else { this.joints.push(j); this.jointByPart1.set(j.part1, j); }
    }
    this.#computeSolveOrder();
    this.#buildHandles();
    scene.add(this.group);
  }

  #buildHandles() {
    for (const j of this.joints) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc74d, transparent: true, opacity: 0.85, depthTest: false });
      const mesh = new THREE.Mesh(handleGeoNormal, mat);
      mesh.renderOrder = 10;
      mesh.userData = { itemId: this.item.id, partId: j.part1, isHandle: true };
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.handles.push({ joint: j, mesh });
    }
  }

  #buildPart(def) {
    const geometry = partGeometry(def);
    const mp = materialProps(def.material);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.color || '#A3A2A5'),
      roughness: mp.roughness,
      metalness: Math.max(mp.metalness, (def.reflectance || 0) * 0.8),
    });
    if (mp.emissive) {
      material.emissive = new THREE.Color(def.color || '#A3A2A5');
      material.emissiveIntensity = mp.emissive;
    }
    // transparentBoost approximates glass/ice/water/forcefield always reading as at least
    // somewhat see-through even at Transparency 0, which is how Roblox actually renders them.
    const effectiveTransparency = Math.max(def.transparency || 0, mp.transparentBoost || 0);
    if (effectiveTransparency > 0) {
      material.transparent = true;
      material.opacity = 1 - effectiveTransparency;
      if (def.transparency >= 1) material.visible = true; // handled via mesh.visible
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData = { itemId: this.item.id, partId: def.id, partName: def.name };
    if (def.transparency >= 1) mesh.visible = this.showRoot || def.id !== (this.item.rig.rootPart);
    if (def.transparency >= 0.99) mesh.visible = false;
    this.group.add(mesh);
    // baseEmissive: Neon's own glow color/intensity, restored by setHighlight() below instead of
    // going to black like every other material — a Neon part must keep glowing even while some
    // other part is selected, not just when this exact one is.
    const baseEmissive = mp.emissive ? { color: new THREE.Color(def.color || '#A3A2A5'), intensity: mp.emissive } : null;

    const selBoxMat = new THREE.MeshBasicMaterial({ color: 0x3355ff, transparent: true, opacity: 0, depthTest: true });
    const selBox = new THREE.Mesh(SEL_BOX_GEO, selBoxMat);
    selBox.matrixAutoUpdate = false;
    // visible stays true permanently — opacity 0 is how it's "hidden" at rest, so it's always a
    // valid pick() raycast target (pick() gates candidates on .visible, not opacity/appearance).
    selBox.userData = { itemId: this.item.id, partId: def.id, partName: def.name, isSelBox: true };
    this.group.add(selBox);
    const selBoxSize = new THREE.Vector3(def.size[0], def.size[1], def.size[2]);

    // The visible part marker. Its own click target rather than relying on selBox alone, so it
    // stays hittable even where the part's real surface is awkward to hit (a thin hand, a limb
    // mostly hidden behind the torso).
    const markerMat = new THREE.MeshBasicMaterial({
      color: MARKER_COLOR, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    });
    const marker = new THREE.Mesh(PART_MARKER_GEO, markerMat);
    marker.matrixAutoUpdate = false;
    marker.renderOrder = 6;
    marker.visible = false; // turned on by setPartMarkersVisible once the scene syncs state
    marker.userData = { itemId: this.item.id, partId: def.id, partName: def.name, isSelBox: true };
    this.group.add(marker);

    this.parts.set(def.id, {
      def, mesh, world: CF.IDENTITY.slice(), extras: [], baseEmissive,
      selBox, selBoxSize, marker,
    });

    // customTexture: an already-decoded data URI captured at FBX/GLB import time (see
    // meshImport.js) — no CDN, no async race with the real-mesh-fetch path below (customMesh
    // parts never have a meshId, so that path is always skipped for these), just load it.
    if (def.customTexture) {
      texLoader.load(def.customTexture, (tex) => {
        configureTexture(tex);
        material.map = tex;
        material.color.set('#ffffff');
        material.needsUpdate = true;
      });
    }

    // Face: a user's custom layer stack (Face Presets) takes priority over every rig's default
    // face. Below that, R15/Rthro/RthroSlender heads carry their default face baked into the CDN
    // mesh/texture (111092388570647) the same way real Roblox Studio does — but that asset is
    // gated behind an authenticated Roblox session and 401s in this bare desktop app (see
    // headFaceFallback below), so `hasCustomFace` alone doesn't tell us whether *some* face will
    // end up on screen. R6's Head has no CDN texture at all — faceDecal is its only face source,
    // so it always renders the classic smiley immediately, unconditionally.
    const hasCustomFace = def.name === 'Head' && this.item.faceLayers && this.item.faceLayers.length;
    if (hasCustomFace) {
      this.item.faceLayers.forEach((layer, i) => this.#buildFacePlane(def, mesh, layer.dataUri, layer.opacity ?? 1, 'Front', i));
    } else if (def.faceDecal) {
      getClassicFace().then((dataUri) => {
        if (dataUri) this.#buildFacePlane(def, mesh, dataUri, 1, 'Front', 0);
      });
    }
    // Guaranteed default face for R15-family heads: shows the classic smiley — exactly what
    // Roblox Studio's own default rigs read as — as soon as it's clear the real baked-in CDN face
    // won't arrive, and never at all if the real one does (avoids a doubled-up face). Guarded by
    // `headFaceShown` since either the mesh-geometry failure path or the texture failure path
    // below can trigger it, and only one should ever actually build the plane.
    let headFaceShown = hasCustomFace || !!def.faceDecal;
    const headFaceFallback = () => {
      if (headFaceShown || def.name !== 'Head' || def.className !== 'MeshPart') return;
      headFaceShown = true;
      getClassicFace().then((dataUri) => {
        if (dataUri) this.#buildFacePlane(def, mesh, dataUri, 1, 'Front', 0);
      });
    };

    // async: texture (fixes the UGC "black head" bug: we always fetch + apply the real texture).
    // Modern UGC heads carry their texture on a SurfaceAppearance rather than MeshPart.TextureID —
    // prefer that when present, since it's what actually renders in-game.
    const sa = def.surfaceAppearance;
    const applyTexture = () => {
      // Clothing wins over a body part's own (usually empty) texture: it IS what that surface
      // should look like. The atlas is Roblox's own composite (see clothing.js), and each part's
      // mesh already carries UVs into it, so applying it is just a texture assignment.
      if (this.clothingImages && isClothedPart(def.name)) {
        // isAtlas: a composite authored in image space (Y down), which the body meshes' UVs
        // already address that way — so it must NOT get the flip an uploaded texture gets.
        const applyCanvas = (canvas, isAtlas) => {
          if (!canvas) return false;
          const tex = configureTexture(new THREE.CanvasTexture(canvas));
          tex.flipY = !isAtlas;
          material.map = tex;
          // The composite already carries the body colour underneath, so the material must not
          // tint it a second time.
          material.color.set('#ffffff');
          material.needsUpdate = true;
          return true;
        };
        // Roblox's own bake first — the body-wide sheet for a classic rig, the per-group canvas
        // for R15 — falling back to the per-part approximation only if its content isn't here.
        const exact = (def.className === 'MeshPart' && r15GroupOf(def.name))
          ? buildR15GroupAtlas(this.item.rig, this.clothing, def.name, this.item.id)
          : Promise.resolve(this.classicAtlas).then((a) => (this.usingAtlas ? a : null));
        exact.then((canvas) => {
          if (applyCanvas(canvas, true)) return;
          return this.clothingImages.then((images) => {
            if (!images) return;
            applyCanvas(buildPartClothingCanvas(def, mesh.geometry, this.partDefsByName, images), false);
          });
        });
        return;
      }
      const texId = (sa && sa.colorMap) || (def.className === 'MeshPart' ? def.textureId : (def.specialMesh && def.specialMesh.textureId));
      if (texId) {
        loadRobloxTexture(texId).then((tex) => {
          if (!tex) {
            headFaceFallback();
            if (def.name !== 'Head') this.onMeshError?.(def, 'texture', `texture ${texId} failed to load`);
            return;
          }
          headFaceShown = true; // the real CDN texture won — never show the fallback smiley too
          material.map = tex;
          // Roblox MULTIPLIES a MeshPart's texture by its Color — verified in Studio by turning a
          // textured head red and watching the skin go red while the face stayed black. This used
          // to force white, which threw away every avatar's skin tone: Builderman imported with a
          // stark white head instead of his own colour.
          material.color.set(def.color || '#ffffff');
          material.needsUpdate = true;
        });
      } else {
        headFaceFallback();
      }
      if (sa && sa.roughnessMap) {
        loadRobloxTexture(sa.roughnessMap).then((tex) => { if (tex) { material.roughnessMap = tex; material.needsUpdate = true; } });
      }
      if (sa && sa.normalMap) {
        loadRobloxTexture(sa.normalMap).then((tex) => { if (tex) { material.normalMap = tex; material.needsUpdate = true; } });
      }
    };

    // Exact geometry from Roblox's own local files, for the classic shapes it ships (the head and
    // the four R6 limbs). This is the real asset the engine renders, so there is nothing to
    // approximate and nothing that can fail partway — no network, no auth, no asset gating. The
    // procedural shape built above is only ever what's on screen for the instant before this
    // resolves, or on a machine with no Roblox install at all.
    const headPath = localMeshPathFor(def, false);
    const bodyPath = classicPartMeshPath(def.name);
    const isClassicBody = !!bodyPath && def.className !== 'MeshPart' && !def.specialMesh;
    if (headPath || isClassicBody) {
      // A classic BODY part only adopts Roblox's mesh when the exact atlas is also available,
      // since that mesh's UVs address the atlas and nothing else. The head has no clothing, so it
      // is loaded unconditionally.
      const gate = isClassicBody ? Promise.resolve(this.classicAtlas) : Promise.resolve(null);
      gate.then((atlas) => {
        if (isClassicBody && !atlas) { applyTexture(); return; } // keep the procedural twin
        if (isClassicBody) this.usingAtlas = true;
        return loadLocalMesh(headPath || bodyPath).then((data) => {
          if (!data) { applyTexture(); return; }
          // A classic head is sized by SpecialMesh.Scale off the mesh's own size; a body part is
          // sized by Part.Size directly.
          let g;
          if (headPath) {
            g = geometryFromMeshData(data, null);
            const [kx, ky, kz] = headGeometryScale(def);
            g.scale(kx, ky, kz);
            g.computeBoundingBox();
          } else {
            g = geometryFromMeshData(data, def.size);
          }
          mesh.geometry.dispose();
          mesh.geometry = g;
          applyTexture();
        });
      });
      return;
    }

    // async: real mesh geometry
    const smFile = def.specialMesh && def.specialMesh.meshType === 'FileMesh' && def.specialMesh.meshId;
    const meshId = def.className === 'MeshPart' ? def.meshId : (smFile ? def.specialMesh.meshId : null);
    if (meshId) {
      fetchMeshGeometry(meshId).then((geo) => {
        const g = geo.clone();
        const bb = geo.boundingBox;
        const bbSize = new THREE.Vector3(); bb.getSize(bbSize);
        const bbCenter = new THREE.Vector3(); bb.getCenter(bbCenter);
        if (def.className === 'MeshPart') {
          // fit native geometry into part size (recentred)
          g.translate(-bbCenter.x, -bbCenter.y, -bbCenter.z);
          const [sx, sy, sz] = def.size;
          g.scale(sx / (bbSize.x || 1), sy / (bbSize.y || 1), sz / (bbSize.z || 1));
        } else {
          const s = def.specialMesh.scale || [1, 1, 1];
          g.scale(s[0], s[1], s[2]);
          const o = def.specialMesh.offset || [0, 0, 0];
          g.translate(o[0], o[1], o[2]);
        }
        mesh.geometry.dispose();
        mesh.geometry = g;
        // only now — the placeholder's UVs don't match the real mesh's layout, so a texture
        // applied before this would smear/misalign (this is what caused the R15 head to render
        // with a dark band when its mesh CDN fetch 401s but the texture fetch still succeeds)
        applyTexture();
      }).catch((err) => {
        headFaceFallback(); // keep placeholder shape, skip texture — its UVs wouldn't match anyway
        if (def.name !== 'Head') this.onMeshError?.(def, 'mesh', err?.message || String(err));
      });
    } else {
      applyTexture();
    }
    // Every Decal Roblox has on this part, on whichever face(s) it's actually on — not just the
    // one the classic-smiley path above assumes. A part can carry up to six simultaneously.
    if (def.decals && def.decals.length) {
      def.decals.forEach((d, i) => {
        loadRobloxTexture(d.texture).then((tex) => {
          if (tex) this.#buildFacePlane(def, mesh, null, 1 - (d.transparency || 0), d.face, i, tex);
        });
      });
    }
  }

  // One decal plane parented to the part, positioned just off the given face's surface. Layer
  // index nudges each successive layer on the SAME face a hair further out so multiple stacked
  // layers (e.g. a base skin tone plus separate eyebrows/mouth layers) composite correctly
  // instead of z-fighting. `face` is a Roblox NormalId name; defaults to 'Front' for the
  // Face-Presets/classic-smiley callers above, which only ever target the front of a head.
  #buildFacePlane(def, partMesh, dataUri, opacity, face, layerIndex, preloadedTex) {
    const place = (tex) => {
      configureTexture(tex);
      let patch;
      if (face === 'Front' && isLatheHeadPart(def)) {
        // A flat plane can only touch the head's curved surface at one point, gapping everywhere
        // else. This patch is the head's own profile, shrink-wrapped and pushed out a hair along
        // its own normals — flush by construction, across the bevels as well as the straight wall.
        // Same scale factors headGeometry() was built with, so it tracks the head whichever way
        // that head is modelled (SpecialMesh Scale, or a MeshPart's own size).
        const [kx, ky, kz] = headGeometryScale(def);
        const geo = headFacePatchGeometry(kx, ky, kz, 0.004 + layerIndex * 0.004);
        patch = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false }));
      } else {
        // A classic head's rendered size comes from the lathe, not from Part.Size (which is
        // 2 x 1 x 1 on every stock rig and has nothing to do with what you see).
        const isHeadMesh = def.specialMesh && def.specialMesh.meshType === 'Head';
        const hs = isHeadMesh ? headGeometryScale(def) : null;
        const w = hs ? HEAD_R * 2 * hs[0] : def.size[0];
        const h = hs ? HEAD_H * 2 * hs[1] : def.size[1];
        const depth = hs ? HEAD_R * 2 * hs[2] : def.size[2];
        const shrink = isHeadMesh ? 0.82 : 1;
        const orient = FACE_ORIENT[face] || FACE_ORIENT.Front;
        const dims = orient.axis === 'z' ? [w, h] : orient.axis === 'x' ? [depth, h] : [w, depth];
        const half = { x: w / 2, y: h / 2, z: depth / 2 }[orient.axis] * shrink;
        patch = new THREE.Mesh(
          new THREE.PlaneGeometry(dims[0] * 0.9, dims[1] * 0.9),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false }),
        );
        patch.rotation.y = orient.rotY;
        patch.rotation.x = orient.rotX;
        const offset = (half + 0.012 + layerIndex * 0.004) * orient.sign;
        patch.position[orient.axis] = offset;
      }
      patch.renderOrder = 10 + layerIndex;
      patch.userData.isFaceLayer = true;
      patch.raycast = () => { }; // click through to the part
      partMesh.add(patch);
    };
    if (preloadedTex) place(preloadedTex);
    else texLoader.load(dataUri, place);
  }

  #computeSolveOrder() {
    const rootId = this.item.rig.rootPart;
    const order = [];
    const visited = new Set([rootId]);
    const all = [...this.joints, ...this.welds];
    let progress = true;
    while (progress) {
      progress = false;
      for (const j of all) {
        if (visited.has(j.part1) || !visited.has(j.part0)) continue;
        order.push(j);
        visited.add(j.part1);
        progress = true;
      }
    }
    this.solveOrder = order;
    // parts never reached by a joint keep a rigid offset from the root
    this.staticParts = [];
    const rootDef = this.parts.get(rootId)?.def;
    for (const [id, p] of this.parts) {
      if (!visited.has(id)) {
        const rel = CF.mul(CF.inverse(rootDef.cf), p.def.cf);
        this.staticParts.push({ id, rel });
      }
    }
  }

  // Pure pose solve: writes resolved world CFrames for every part into `out` (partId -> cf)
  // without touching any live mesh. Shared by computeWorld() (the displayed pose) and
  // solvePoseWorlds() (queries for onion skin / MCP frame inspection that must not disturb it).
  // `unparented` (optional Set of joint names): those joints' pose values are ORIGIN-relative
  // part CFrames rather than parent-relative Transforms — the "unparented animation" feature,
  // where a limb's motion is authored in rig space so it survives retargeting to rigs with
  // different proportions. Its children still chain off it normally.
  #solve(pose, originCF, out, unparented) {
    const rootId = this.item.rig.rootPart;
    out.set(rootId, originCF);
    for (const j of this.solveOrder) {
      const isMotor = this.jointByPart1.get(j.part1) === j;
      if (isMotor && unparented && unparented.has(j.name) && pose[j.name]) {
        out.set(j.part1, CF.mul(originCF, pose[j.name]));
        continue;
      }
      const p0World = out.get(j.part0);
      if (!p0World) continue;
      const transform = isMotor ? (pose[j.name] || CF.IDENTITY) : CF.IDENTITY;
      // Part1 = Part0 * C0 * Transform * C1^-1
      out.set(j.part1, CF.mul(CF.mul(CF.mul(p0World, j.c0), transform), CF.inverse(j.c1)));
    }
    for (const s of this.staticParts) {
      out.set(s.id, CF.mul(originCF, s.rel));
    }
    return out;
  }

  // pose: { [jointName]: transformCF }, originCF: world cf of root part — updates the displayed rig.
  computeWorld(pose, originCF, unparented) {
    if (!this.parts.has(this.item.rig.rootPart)) return;
    const worlds = this.#solve(pose, originCF, new Map(), unparented);
    for (const [id, p] of this.parts) {
      p.world = worlds.get(id) || p.world;
      CF.toThreeMatrix(p.world, p.mesh.matrix);
      p.mesh.matrix.scale(partGapVector);
      p.mesh.matrixWorldNeedsUpdate = true;
      CF.toThreeMatrix(p.world, p.selBox.matrix);
      p.selBox.matrix.scale(p.selBoxSize);
      p.selBox.matrixWorldNeedsUpdate = true;
    }
    for (const h of this.handles) {
      const p0World = worlds.get(h.joint.part0);
      if (!p0World) continue;
      const pivot = CF.mul(p0World, h.joint.c0);
      CF.toThreeMatrix(pivot, h.mesh.matrix);
      h.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  // Side-effect-free: world CFrame per partId for an arbitrary pose, without touching the
  // displayed instance. Used for onion skin ghosts and for MCP frame-inspection tools.
  solvePoseWorlds(pose, originCF, unparented) {
    return this.#solve(pose, originCF, new Map(), unparented);
  }

  // Lay each part's marker flat on whichever of its faces is most turned toward the camera.
  //
  // Deliberately NOT a camera-facing billboard: a billboard always presents square-on, so it reads
  // as a sticker pasted on the screen. Sitting in the part's own face plane means it foreshortens
  // and tilts with the limb, which is what makes it look like it belongs on the surface — the
  // difference between this and Moon's markers when they were billboarded.
  //
  // Called once per frame from the viewport, which is what owns the camera.
  updatePartMarkers(camera) {
    if (!this.markersVisible) return;
    const camPos = _mkCamPos.setFromMatrixPosition(camera.matrixWorld);
    for (const [, p] of this.parts) {
      if (!p.marker.visible) continue;
      _mkMat.fromArray([
        p.world[3], p.world[6], p.world[9], 0,
        p.world[4], p.world[7], p.world[10], 0,
        p.world[5], p.world[8], p.world[11], 0,
        p.world[0], p.world[1], p.world[2], 1,
      ]);
      _mkCentre.set(p.world[0], p.world[1], p.world[2]);
      _mkDir.copy(camPos).sub(_mkCentre);
      if (_mkDir.lengthSq() < 1e-9) continue;
      _mkDir.normalize();
      // View direction in the part's own axes, which is what decides the face being shown.
      //
      // Rotation ONLY — a direction must never go through the full transform, or the part's world
      // position leaks into it. That bug put every rotated part's marker on the wrong face: R6's
      // joints rotate the torso, arms and head but not the legs, so only the legs looked right.
      //
      // Extents come from the RENDERED geometry, never Part.Size: a classic head is a 2x1x1 Part
      // that draws as a ~1.2 lathe, so sizing off Part.Size buried its marker inside the head.
      _mkRot.setFromMatrix4(_mkMat);
      _mkRotT.copy(_mkRot).transpose(); // orthonormal, so the transpose is the inverse
      _mkLocal.copy(_mkDir).applyMatrix3(_mkRotT).normalize();
      const half = partHalfExtents(p);

      // The face most turned toward the camera.
      let axis = 0;
      for (let k = 1; k < 3; k++) if (Math.abs(_mkLocal.getComponent(k)) > Math.abs(_mkLocal.getComponent(axis))) axis = k;
      const sign = _mkLocal.getComponent(axis) >= 0 ? 1 : -1;

      // How far out that face sits. Measuring along the FACE normal rather than the view ray also
      // removes the round-vs-boxy problem entirely: the half-extent is the surface distance for a
      // flat face and for a sphere alike. Along the view ray it was not — treating the round head
      // as a box put its marker out at the bounding-box corner, 0.864 against a surface at 0.60.
      const out = half[axis];

      // Basis: the face normal plus the part's other two axes, so the quad lies IN the face.
      // (u, v, n) is kept right-handed by swapping the tangents on a negative face.
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      _mkU.set(0, 0, 0).setComponent(sign > 0 ? u : v, 1).applyMatrix3(_mkRot);
      _mkV.set(0, 0, 0).setComponent(sign > 0 ? v : u, 1).applyMatrix3(_mkRot);
      _mkN.set(0, 0, 0).setComponent(axis, sign).applyMatrix3(_mkRot);
      _mkBasis.makeBasis(_mkU.normalize(), _mkV.normalize(), _mkN.normalize());
      _mkQuat.setFromRotationMatrix(_mkBasis);
      _mkPos.copy(_mkCentre).addScaledVector(_mkN, out + 0.012);
      p.marker.matrix.compose(_mkPos, _mkQuat, _mkScale.setScalar(markerSizeFor(half, axis)));
      p.marker.matrixWorldNeedsUpdate = true;
    }
  }

  setPartMarkersVisible(v) {
    this.markersVisible = !!v;
    for (const [, p] of this.parts) {
      // Never on a part that isn't drawn (an invisible HumanoidRootPart shouldn't sprout a marker).
      p.marker.visible = !!v && p.def.transparency < 0.99;
    }
  }

  setHandlesVisible(v) {
    for (const h of this.handles) h.mesh.visible = v;
  }
  setHandleSize(size) {
    const geo = size === 'small' ? handleGeoSmall : handleGeoNormal;
    for (const h of this.handles) h.mesh.geometry = geo;
  }

  partWorld(partId) {
    return this.parts.get(partId)?.world || CF.IDENTITY;
  }

  // The part's real anatomical attachment point (Part0.World * C0) — the same pivot the
  // joint-handle marker sits at in computeWorld(). Null for parts with no driving joint (root,
  // welded/static parts) — callers fall back to partWorld() for those.
  jointPivotWorld(partId) {
    const j = this.jointByPart1.get(partId);
    if (!j) return null;
    const p0 = this.parts.get(j.part0);
    if (!p0) return null;
    return CF.mul(p0.world, j.c0);
  }

  // For a part with no direct motor Transform to solve (welded, or reached only through welds/
  // static offsets — transformForWorld returns null for these): the ORIGIN is the only animatable
  // thing upstream of it, so find the origin value that lands this part exactly on `desiredWorld`,
  // holding every other joint's current pose fixed. `partWorld = origin * (origin^-1 * partWorld)`
  // — that parenthesized term is this part's pose relative to origin under the CURRENT (unperturbed)
  // pose, cached from the last computeWorld() — so solving `desired = newOrigin * thatTerm` gives
  // newOrigin = desired * partWorld^-1 * origin. (For the root part itself, that term is identity,
  // so this reduces to newOrigin = desired — the existing, already-correct root/@origin behavior.)
  originForWorld(partId, desiredWorld) {
    const part = this.parts.get(partId);
    const root = this.parts.get(this.item.rig.rootPart);
    if (!part || !root) return null;
    return CF.orthonormalize(CF.mul(CF.mul(desiredWorld, CF.inverse(part.world)), root.world));
  }

  // Given a desired world CFrame for a part, return the joint value that produces it — a
  // parent-relative Transform normally, or (for an "unparented" joint — see #solve) an
  // origin-relative world CFrame instead, since that IS what its track stores.
  transformForWorld(partId, desiredWorld, unparented) {
    const j = this.jointByPart1.get(partId);
    if (!j) return null;
    if (unparented && unparented.has(j.name)) {
      const origin = this.parts.get(this.item.rig.rootPart).world;
      return { joint: j.name, transform: CF.orthonormalize(CF.mul(CF.inverse(origin), desiredWorld)), space: 'world' };
    }
    const p0 = this.parts.get(j.part0);
    // Transform = C0^-1 * Part0World^-1 * desired * C1
    return {
      joint: j.name,
      transform: CF.orthonormalize(CF.mul(CF.mul(CF.mul(CF.inverse(j.c0), CF.inverse(p0.world)), desiredWorld), j.c1)),
    };
  }

  // level: 0 none, 1 hover, 2 selected. `partId` may be a single id or a collection of them —
  // parts are multi-selectable (shift-click), and every member has to read as selected, not just
  // the primary one the gizmo happens to be anchored to.
  setHighlight(partId, level) {
    const targets = (partId && typeof partId === 'object' && typeof partId[Symbol.iterator] === 'function')
      ? new Set(partId)
      : new Set(partId == null ? [] : [partId]);
    const isTargetId = (id) => targets.has(id);
    for (const [id, p] of this.parts) {
      const em = p.mesh.material.emissive;
      const isTarget = isTargetId(id);
      if (em) {
        if (isTarget && level === 2) em.set(0x3355ff), p.mesh.material.emissiveIntensity = 0.35;
        else if (isTarget && level === 1) em.set(0x223377), p.mesh.material.emissiveIntensity = 0.3;
        else if (p.baseEmissive) em.copy(p.baseEmissive.color), p.mesh.material.emissiveIntensity = p.baseEmissive.intensity;
        else em.set(0x000000);
        p.mesh.material.needsUpdate = false;
      }
      // Selection box: invisible at rest, a soft fill on hover, a stronger one when selected —
      // the click-target itself gives the same affordance a real cursor-over highlight would.
      p.selBox.material.opacity = isTarget && level === 2 ? 0.32 : isTarget && level === 1 ? 0.16 : 0;
      // The marker is the thing the eye actually tracks, so it carries the state most visibly.
      p.marker.material.color.setHex(
        isTarget && level === 2 ? MARKER_COLOR_SELECTED
          : isTarget && level === 1 ? MARKER_COLOR_HOVER : MARKER_COLOR,
      );
      p.marker.material.opacity = isTarget && level === 2 ? 0.95 : isTarget && level === 1 ? 0.8 : 0.55;
    }
    for (const h of this.handles) {
      const isTarget = isTargetId(h.joint.part1);
      h.mesh.material.color.set(isTarget && level === 2 ? 0x7c8cff : isTarget && level === 1 ? 0xffe08a : 0xffc74d);
      h.mesh.scale.setScalar(isTarget && level === 2 ? 1.4 : 1);
    }
  }

  setRootVisible(v) {
    this.showRoot = v;
    const rootId = this.item.rig.rootPart;
    const p = this.parts.get(rootId);
    if (p && p.def.transparency >= 0.99) p.mesh.visible = v;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      // handle geometries are shared module-level constants — never dispose those, or every
      // OTHER still-live instance loses them too.
      if (o.geometry && o.geometry !== handleGeoNormal && o.geometry !== handleGeoSmall
        && o.geometry !== SEL_BOX_GEO && o.geometry !== PART_MARKER_GEO) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

// Camera items get a small visible camera body + a real PerspectiveCamera
// An item with nothing to draw in the 3D viewport — currently `prop` items, which drive
// properties on a Roblox instance that lives in the user's game, and the screen effects, which
// render through the DOM overlay in screenFx.js instead.
//
// This exists so `makeInstance` never falls through to RigInstance for a rig-less item: doing so
// threw on `item.rig.parts` on every single animation frame, silently spamming the console and
// stalling anything watching for a clean run. Every method the viewport calls on an instance is
// answered here with a harmless no-op or an identity value.
export class NullInstance {
  constructor(item) {
    this.item = item;
    this.group = new THREE.Group(); // never added to the scene — nothing to render
    this.parts = new Map();
    this.handles = null;
    this.world = CF.IDENTITY.slice();
  }
  computeWorld() { }
  solvePoseWorlds() { return new Map(); }
  partWorld() { return CF.IDENTITY.slice(); }
  jointPivotWorld() { return null; }
  originForWorld(world) { return world; }
  transformForWorld() { return CF.IDENTITY.slice(); }
  setHighlight() { }
  setHandlesVisible() { }
  setHandleSize() { }
  setPartMarkersVisible() { }
  updatePartMarkers() { }
  setBodyVisible() { }
  setFrustumVisible() { }
  dispose() { }
}

export class CameraInstance {
  constructor(item, scene) {
    this.item = item;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = item.name;

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8f95ff, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 1.1), bodyMat);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 16), bodyMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.75;
    body.userData = lens.userData = { itemId: item.id, partId: '@camera', partName: 'Camera' };
    this.group.add(body, lens);

    this.camera = new THREE.PerspectiveCamera(item.fov || 70, 16 / 9, 0.1, 5000);
    this.camera.rotation.y = 0;
    this.group.add(this.camera);

    this.helper = new THREE.CameraHelper(this.camera);
    this.helper.visible = false;
    scene.add(this.helper);
    scene.add(this.group);
    this.world = CF.IDENTITY.slice();
    this.tmpM = new THREE.Matrix4();
  }

  computeWorld(originCF, fov) {
    this.world = originCF;
    CF.toThreeMatrix(originCF, this.tmpM);
    this.group.matrixAutoUpdate = false;
    this.tmpM.decompose(this.group.position, this.group.quaternion, this.group.scale);
    this.group.matrixAutoUpdate = true;
    this.group.updateMatrixWorld(true);
    this.camera.fov = fov || this.item.fov || 70;
    this.camera.updateProjectionMatrix();
    this.helper.update();
  }

  partWorld() { return this.world; }
  setHighlight() { }
  setFrustumVisible(v) { this.helper.visible = v; }
  setBodyVisible(v) { this.group.visible = v; }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.helper);
  }
}

// One small sprite texture per particle "shape" (see particleLibrary.js's SHAPES), each generated
// once via canvas (no network fetch, so unaffected by the app's CSP) and cached — a fixed set of
// textures shared across every VFX item that uses a given shape, not one per item/preset.
const particleTextures = new Map(); // shape -> THREE.CanvasTexture
function drawGlow(ctx) {
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
}
function drawSpark(ctx) {
  ctx.save();
  ctx.translate(16, 16);
  ctx.scale(0.4, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-16, -16, 32, 32);
  ctx.restore();
}
function drawRing(ctx) {
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
}
function drawStar(ctx) {
  ctx.save();
  ctx.translate(16, 16);
  ctx.filter = 'blur(1.5px)';
  ctx.fillStyle = 'white';
  ctx.beginPath();
  const spikes = 4, outerR = 15, innerR = 4;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawSmoke(ctx) {
  // A few overlapping soft blobs at fixed (deterministic, not random-per-call) offsets read as a
  // puffy cloud silhouette instead of one uniform circle.
  const blobs = [[16, 16, 15], [10, 20, 10], [22, 19, 10], [16, 9, 9]];
  for (const [cx, cy, r] of blobs) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }
}
function drawSquare(ctx) {
  ctx.save();
  ctx.filter = 'blur(2px)';
  ctx.fillStyle = 'white';
  const r = 6;
  ctx.beginPath();
  ctx.moveTo(8 + r, 8);
  ctx.arcTo(24, 8, 24, 24, r);
  ctx.arcTo(24, 24, 8, 24, r);
  ctx.arcTo(8, 24, 8, 8, r);
  ctx.arcTo(8, 8, 24, 8, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawLeaf(ctx) {
  ctx.save();
  ctx.translate(16, 16);
  ctx.rotate(Math.PI / 4);
  ctx.filter = 'blur(1px)';
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
const SHAPE_DRAWERS = { glow: drawGlow, spark: drawSpark, ring: drawRing, star: drawStar, smoke: drawSmoke, square: drawSquare, leaf: drawLeaf };
export function getParticleTexture(shape) {
  const key = SHAPE_DRAWERS[shape] ? shape : 'glow';
  if (particleTextures.has(key)) return particleTextures.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  SHAPE_DRAWERS[key](ctx);
  const tex = new THREE.CanvasTexture(c);
  particleTextures.set(key, tex);
  return tex;
}

// VFX items get a small selectable emitter icon plus a pool of reusable Sprites (billboards,
// always face the camera automatically) standing in for particles — a fixed-size pool sized to
// the item's maxParticles cap, toggling visibility per-slot each frame rather than
// creating/destroying sprites continuously.
export class VfxInstance {
  constructor(item, scene) {
    this.item = item;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = item.name;

    const iconMat = new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.85 });
    this.icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), iconMat);
    this.icon.userData = { itemId: item.id, partId: '@vfx', partName: 'Emitter' };
    this.icon.matrixAutoUpdate = false;
    this.group.add(this.icon);

    const cap = Math.max(1, Math.min(2000, item.emitter?.maxParticles || 150));
    this.pool = [];
    const tex = getParticleTexture(item.emitter?.shape);
    const blending = item.emitter?.blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (let i = 0; i < cap; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      spr.userData.nonSelectable = true;
      this.group.add(spr);
      this.pool.push(spr);
    }
    scene.add(this.group);
    this.world = CF.IDENTITY.slice();
  }

  // particles: sampleParticles()'s output — { pos, size, color:[r,g,b], opacity }[]
  computeWorld(originCF, particles) {
    this.world = originCF;
    CF.toThreeMatrix(originCF, this.icon.matrix);
    this.icon.matrixWorldNeedsUpdate = true;
    for (let i = 0; i < this.pool.length; i++) {
      const spr = this.pool[i];
      const p = particles[i];
      if (!p) { spr.visible = false; continue; }
      spr.visible = true;
      spr.position.set(p.pos[0], p.pos[1], p.pos[2]);
      spr.scale.setScalar(p.size);
      spr.material.color.setRGB(p.color[0], p.color[1], p.color[2]);
      spr.material.opacity = p.opacity;
    }
  }

  partWorld() { return this.world; }
  setHighlight(partId, level) {
    this.icon.material.color.set(level === 2 ? 0x7c8cff : level === 1 ? 0xffe08a : 0xffaa55);
  }
  setFrustumVisible() { }
  setBodyVisible(v) { this.icon.visible = v; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.material) { o.material.dispose(); }
      if (o.geometry) o.geometry.dispose();
    });
  }
}

// A VFX Studio multi-layer effect document, placed on the main animator's own timeline. Once an
// item is added, its document is fixed for the item's lifetime (there is no live studio<->item
// link yet — editing always happens in the standalone window and comes back as a new item, see
// docs/vfx-studio.md), so every per-layer visual (particle pools, shape meshes, point lights) is
// built ONCE in the constructor from the doc as it existed at add-time — no per-frame structural
// rebuilding, only the ordinary per-frame value updates computeWorld() applies. Screen/shake/
// sound layers render nothing here (studio-preview + export only, per the design doc); their
// sampleEffect() output is simply not consumed.
export class EffectInstance {
  constructor(item, scene) {
    this.item = item;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = item.name;

    const iconMat = new THREE.MeshBasicMaterial({ color: 0xff9955, transparent: true, opacity: 0.85 });
    this.icon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), iconMat);
    this.icon.userData = { itemId: item.id, partId: '@effect', partName: 'Effect' };
    this.icon.matrixAutoUpdate = false;
    this.group.add(this.icon);

    this.emitterVisuals = new Map(); // layerId -> { sprites: THREE.Sprite[] }
    this.shapeVisuals = new Map();   // layerId -> { mesh, geomThickness }
    this.lightVisuals = new Map();   // layerId -> THREE.PointLight

    const doc = item.effect;
    for (const layer of doc?.layers || []) {
      if (layer.type === 'emitter') {
        const cap = Math.max(1, Math.min(2000, layer.props.maxParticles || 150));
        const tex = getParticleTexture(layer.props.shape);
        const blending = layer.props.blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
        const sprites = [];
        for (let i = 0; i < cap; i++) {
          const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending });
          const spr = new THREE.Sprite(mat);
          spr.visible = false;
          spr.userData.nonSelectable = true;
          this.group.add(spr);
          sprites.push(spr);
        }
        this.emitterVisuals.set(layer.id, { sprites });
      } else if (layer.type === 'shape') {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: layer.props.emissive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        const geomThickness = layer.props.thickness;
        const mesh = new THREE.Mesh(buildShapeGeometry(layer.props.shape, geomThickness, isClosedShape(layer.props.shape)), mat);
        mesh.userData.nonSelectable = true;
        this.group.add(mesh);
        this.shapeVisuals.set(layer.id, { mesh, geomThickness });
      } else if (layer.type === 'light') {
        const light = new THREE.PointLight(0xffffff, 0, 12, 1.6);
        this.group.add(light);
        this.lightVisuals.set(layer.id, light);
      }
    }

    scene.add(this.group);
    this.world = CF.IDENTITY.slice();
  }

  // sample: sampleEffect()'s output, or null (effect hasn't started yet / no document) — every
  // visual just hides itself in that case, exactly like an emitter with zero live particles.
  computeWorld(originCF, sample) {
    this.world = originCF;
    CF.toThreeMatrix(originCF, this.icon.matrix);
    this.icon.matrixWorldNeedsUpdate = true;

    const particlesByLayer = new Map();
    for (const p of sample?.particles || []) {
      let arr = particlesByLayer.get(p.layerId);
      if (!arr) particlesByLayer.set(p.layerId, arr = []);
      arr.push(p);
    }
    for (const [layerId, v] of this.emitterVisuals) {
      const particles = particlesByLayer.get(layerId) || [];
      for (let i = 0; i < v.sprites.length; i++) {
        const spr = v.sprites[i];
        const p = particles[i];
        if (!p) { spr.visible = false; continue; }
        spr.visible = true;
        spr.position.set(p.pos[0], p.pos[1], p.pos[2]);
        spr.scale.setScalar(p.size);
        spr.material.color.setRGB(p.color[0], p.color[1], p.color[2]);
        spr.material.opacity = p.opacity;
      }
    }

    const shapeByLayer = new Map((sample?.shapes || []).map((s) => [s.layerId, s]));
    for (const [layerId, v] of this.shapeVisuals) {
      const s = shapeByLayer.get(layerId);
      if (!s) { v.mesh.visible = false; continue; }
      v.mesh.visible = s.opacity > 0.002;
      if (Math.abs(s.thickness - v.geomThickness) / Math.max(0.004, v.geomThickness) > 0.06) {
        v.mesh.geometry.dispose();
        v.mesh.geometry = buildShapeGeometry(s.shapeDef, s.thickness, isClosedShape(s.shapeDef));
        v.geomThickness = s.thickness;
      }
      v.mesh.position.set(s.offset[0], s.offset[1], s.offset[2]);
      v.mesh.rotation.set(0, (s.rotation * Math.PI) / 180, 0);
      v.mesh.scale.setScalar(s.scale);
      v.mesh.material.color.setRGB(s.color[0], s.color[1], s.color[2]);
      v.mesh.material.opacity = s.opacity;
    }

    const lightByLayer = new Map((sample?.lights || []).map((l) => [l.layerId, l]));
    for (const [layerId, light] of this.lightVisuals) {
      const l = lightByLayer.get(layerId);
      if (!l) { light.intensity = 0; continue; }
      light.position.set(l.offset[0], l.offset[1], l.offset[2]);
      light.color.setRGB(l.color[0], l.color[1], l.color[2]);
      light.intensity = l.intensity;
      light.distance = l.range;
    }
  }

  partWorld() { return this.world; }
  setHighlight(partId, level) {
    this.icon.material.color.set(level === 2 ? 0x7c8cff : level === 1 ? 0xffe08a : 0xff9955);
  }
  setFrustumVisible() { }
  setBodyVisible(v) { this.icon.visible = v; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.material) o.material.dispose();
      if (o.geometry) o.geometry.dispose();
    });
  }
}
