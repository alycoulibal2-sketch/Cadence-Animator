// Classic Roblox clothing (Shirt / Pants), composited onto body parts.
//
// Roblox never puts clothing on a part's texture. A Shirt is a separate instance holding a flat
// 585x559 template, and the engine bakes it onto whatever body wears it at render time. A renderer
// that doesn't reproduce that bake shows a character with correct skin and no clothes, which is
// exactly what was happening here.
//
// Both sides of the mapping are plain box unwraps, so each face is a straight rect-to-rect blit:
// the template is a sheet of axis-aligned rectangles (one per body-box face), and every body part
// unwraps its side faces to axis-aligned UV rectangles too.
//
// The region coordinates below are not guessed. They were measured off the real template files,
// and then independently CONFIRMED against Roblox's own compositing meshes, which ship with every
// Studio install: `CompositLeftArmBase.mesh` carries vertex (568,112) with uv (0.3709,0.4830),
// i.e. template pixel (217,289) — exactly the corner of the right-limb UP region in the table
// below. Roblox's own data agrees with this layout to the pixel.

export const TEMPLATE_W = 585, TEMPLATE_H = 559;

const rect = (x0, y0, x1, y1) => ({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });

// The two limb blocks list their side faces in a DIFFERENT left-to-right order — that is how the
// real template is laid out, not an oversight (right block L,B,R,F; left block F,L,B,R).
export const TEMPLATE_BLOCKS = {
  torso: {
    UP: rect(231, 8, 358, 71), DOWN: rect(231, 204, 358, 267),
    RIGHT: rect(165, 74, 228, 201), FRONT: rect(231, 74, 358, 201),
    LEFT: rect(361, 74, 424, 201), BACK: rect(427, 74, 554, 201),
  },
  rightLimb: {
    UP: rect(217, 289, 280, 352), DOWN: rect(217, 485, 280, 548),
    LEFT: rect(19, 355, 82, 482), BACK: rect(85, 355, 148, 482),
    RIGHT: rect(151, 355, 214, 482), FRONT: rect(217, 355, 280, 482),
  },
  leftLimb: {
    UP: rect(308, 289, 371, 352), DOWN: rect(308, 485, 371, 548),
    FRONT: rect(308, 355, 371, 482), LEFT: rect(374, 355, 437, 482),
    BACK: rect(440, 355, 503, 482), RIGHT: rect(506, 355, 569, 482),
  },
};

// A Roblox character faces -Z, so its own right hand is at +X.
const FACE_BY_AXIS = { '-z': 'FRONT', '+z': 'BACK', '+x': 'RIGHT', '-x': 'LEFT', '+y': 'UP', '-y': 'DOWN' };

// Which template block a part draws from, which garment supplies it, and the chain it belongs to
// (ordered top to bottom). R15 splits each R6 limb into three parts, so each takes its own slice
// of the block's side strip, proportional to its height within the chain.
const CHAINS = [
  { block: 'torso', garments: ['pants', 'shirt'], parts: ['UpperTorso', 'LowerTorso'] },
  { block: 'torso', garments: ['pants', 'shirt'], parts: ['Torso'] },
  { block: 'leftLimb', garments: ['shirt'], parts: ['LeftUpperArm', 'LeftLowerArm', 'LeftHand'] },
  { block: 'rightLimb', garments: ['shirt'], parts: ['RightUpperArm', 'RightLowerArm', 'RightHand'] },
  { block: 'leftLimb', garments: ['shirt'], parts: ['Left Arm'] },
  { block: 'rightLimb', garments: ['shirt'], parts: ['Right Arm'] },
  { block: 'leftLimb', garments: ['pants'], parts: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'] },
  { block: 'rightLimb', garments: ['pants'], parts: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot'] },
  { block: 'leftLimb', garments: ['pants'], parts: ['Left Leg'] },
  { block: 'rightLimb', garments: ['pants'], parts: ['Right Leg'] },
];

const PART_INFO = new Map();
for (const chain of CHAINS) {
  chain.parts.forEach((name, index) => {
    PART_INFO.set(name, { block: chain.block, garments: chain.garments, chain: chain.parts, index });
  });
}

export function isClothedPart(name) { return PART_INFO.has(name); }

// Roblox ships the real classic body meshes with every install. Reading them is strictly better
// than re-deriving the shapes: they are the exact assets the engine renders, need no network and
// no authenticated session, and cannot 401. Their UVs also address Roblox's own body atlas, which
// is what makes the exact composite below usable.
export function classicHeadMeshPath() { return 'avatar/heads/head.mesh'; }

const R6_PART_MESHES = {
  Torso: 'avatar/meshes/torso.mesh',
  'Left Arm': 'avatar/meshes/leftarm.mesh',
  'Right Arm': 'avatar/meshes/rightarm.mesh',
  'Left Leg': 'avatar/meshes/leftleg.mesh',
  'Right Leg': 'avatar/meshes/rightleg.mesh',
};
export function classicPartMeshPath(partName) { return R6_PART_MESHES[partName] || null; }

const localMeshCache = new Map();
export function loadLocalMesh(relPath) {
  if (!localMeshCache.has(relPath)) {
    localMeshCache.set(relPath, window.cadence.localMesh(relPath).catch(() => null));
  }
  return localMeshCache.get(relPath);
}

// The share of the limb's full length this part covers, as [top, bottom] fractions. Derived from
// the rig's own part sizes rather than hard-coded, so a scaled avatar (every Roblox body is scaled
// by its HumanoidDescription) slices its templates in the right places.
function verticalShare(def, partsByName) {
  const info = PART_INFO.get(def.name);
  if (!info) return null;
  const heights = info.chain.map((n) => {
    const p = partsByName.get(n);
    return p ? Math.abs(p.size[1]) : 0;
  });
  const total = heights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let before = 0;
  for (let i = 0; i < info.index; i++) before += heights[i];
  return [before / total, (before + heights[info.index]) / total];
}

// ---------------------------------------------------------------- reading a part's own unwrap
// Group triangles by which box face they lie on and return each face's UV rectangle. Uses the
// GEOMETRIC normal of each triangle (not interpolated vertex normals) and ignores anything more
// than ~32 degrees off-axis, so chamfer strips don't smear a face's rect.
export function faceUvRects(geometry) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  if (!pos || !uv) return null;
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const at = (i) => (index ? index.getX(i) : i);
  const AXES = ['x', 'y', 'z'];
  const out = {};
  for (let t = 0; t + 2 < count; t += 3) {
    const [ia, ib, ic] = [at(t), at(t + 1), at(t + 2)];
    const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
    const e1 = [pos.getX(ib) - ax, pos.getY(ib) - ay, pos.getZ(ib) - az];
    const e2 = [pos.getX(ic) - ax, pos.getY(ic) - ay, pos.getZ(ic) - az];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!len) continue;
    let dom = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(n[k]) > Math.abs(n[dom])) dom = k;
    if (Math.abs(n[dom]) / len < 0.85) continue;
    const face = FACE_BY_AXIS[(n[dom] > 0 ? '+' : '-') + AXES[dom]];
    if (!face) continue;
    const r = out[face] || (out[face] = { u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity, tris: 0 });
    for (const vi of [ia, ib, ic]) {
      const u = uv.getX(vi), v = uv.getY(vi);
      if (u < r.u0) r.u0 = u; if (u > r.u1) r.u1 = u;
      if (v < r.v0) r.v0 = v; if (v > r.v1) r.v1 = v;
    }
    r.tris++;
  }
  return out;
}

// ---------------------------------------------------------------- compositing
const TEX_SIZE = 512;

const imageCache = new Map();
export function loadTemplate(assetId) {
  const id = String(assetId).match(/(\d{4,})/)?.[1];
  if (!id) return Promise.resolve(null);
  if (!imageCache.has(id)) {
    imageCache.set(id, window.cadence.fetchTexture(id).then((dataUri) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUri;
    })).catch(() => null));
  }
  return imageCache.get(id);
}

// ---------------------------------------------------------------- the exact composite
//
// Roblox's own compositing meshes, run directly. In each one a vertex POSITION is a destination
// pixel in the 1024x512 body atlas and its UV samples the source template, so rasterising them
// reproduces the engine's bake rather than approximating it. Every classic body mesh already
// carries UVs into this same atlas, so a part just samples the result.
//
// Two conventions had to be resolved empirically (see tools/composite-preview.js, which renders
// this offline for inspection):
//   * destination Y is used as-is — top-down, NOT flipped;
//   * source V is the RAW file value, i.e. 1 minus what the mesh parser returns (the parser flips
//     V on read for 3D use).
// Confirmed by Roblox's own data: CompositLeftArmBase's vertex (568,112) carries a UV that, under
// exactly these conventions, lands on template pixel (217,289) — the corner of the right-limb UP
// region in the table above.
export const ATLAS_W = 1024, ATLAS_H = 512;

// Drawn in the Z order the meshes themselves carry: body colour (~15.8), pants (46.8), shirt
// (63.6). That ordering is what puts a shirt over pants at the waist, exactly as in game.
const ATLAS_LAYERS = [
  { mesh: 'avatar/compositing/CompositTorsoBase.mesh', part: 'Torso' },
  { mesh: 'avatar/compositing/CompositLeftArmBase.mesh', part: 'Left Arm' },
  { mesh: 'avatar/compositing/CompositRightArmBase.mesh', part: 'Right Arm' },
  { mesh: 'avatar/compositing/CompositLeftLegBase.mesh', part: 'Left Leg' },
  { mesh: 'avatar/compositing/CompositRightLegBase.mesh', part: 'Right Leg' },
  { mesh: 'avatar/compositing/CompositPantsTemplate.mesh', garment: 'pants' },
  { mesh: 'avatar/compositing/CompositShirtTemplate.mesh', garment: 'shirt' },
];

// Barycentric fill with nearest-neighbour sampling — nearest, not bilinear, because this is a
// near-1:1 blit and interpolation would soften the template's hard edges. Kept identical to
// tools/composite-preview.js so the offline preview and the app produce the same pixels.
function rasteriseTriangle(dst, dw, dh, src, tri) {
  const [p0, p1, p2] = tri;
  const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
  const maxX = Math.min(dw - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
  const maxY = Math.min(dh - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
  const det = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
  if (Math.abs(det) < 1e-12) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let a = ((p1.y - p2.y) * (px - p2.x) + (p2.x - p1.x) * (py - p2.y)) / det;
      let b = ((p2.y - p0.y) * (px - p2.x) + (p0.x - p2.x) * (py - p2.y)) / det;
      let c = 1 - a - b;
      if (a < -0.002 || b < -0.002 || c < -0.002) continue; // a hair of overlap: no seams
      a = Math.max(0, a); b = Math.max(0, b); c = Math.max(0, c);
      const su = Math.round(a * p0.u + b * p1.u + c * p2.u);
      const sv = Math.round(a * p0.v + b * p1.v + c * p2.v);
      if (su < 0 || sv < 0 || su >= src.width || sv >= src.height) continue;
      const s = (sv * src.width + su) * 4;
      if (src.data[s + 3] === 0) continue; // transparent template pixel keeps what is underneath
      const d = (y * dw + x) * 4;
      dst[d] = src.data[s]; dst[d + 1] = src.data[s + 1];
      dst[d + 2] = src.data[s + 2]; dst[d + 3] = 255;
    }
  }
}

function runCompositMesh(dst, mesh, src, dw = ATLAS_W, dh = ATLAS_H) {
  const { positions: p, uvs: u, indices: idx } = mesh;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const ids = [idx[t], idx[t + 1], idx[t + 2]];
    rasteriseTriangle(dst, dw, dh, src, ids.map((i) => ({
      x: p[i * 3],
      y: p[i * 3 + 1],
      u: u[i * 2] * src.width,
      v: (1 - u[i * 2 + 1]) * src.height,
    })));
  }
}

function imageToPixels(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  return cx.getImageData(0, 0, img.width, img.height);
}

// A 1x1 source of a flat colour, for filling a canvas with a body colour.
function solidPixels(hex) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = hex;
  cx.fillRect(0, 0, 1, 1);
  return cx.getImageData(0, 0, 1, 1);
}

// The base layers only mark WHERE each body part lives in the atlas, in one flat colour — so they
// are filled as native canvas paths rather than sampled per pixel. That matters: their meshes
// carry ~416 triangles each including wide bleed geometry, and running five of them through the
// software rasteriser over a 1024x512 canvas took minutes. The garment layers still go through
// the rasteriser, which is where the exactness actually lives.
function fillCompositMesh(ctx, mesh, hex) {
  const { positions: p, indices: idx } = mesh;
  ctx.fillStyle = hex;
  ctx.beginPath();
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    ctx.moveTo(p[a * 3], p[a * 3 + 1]);
    ctx.lineTo(p[b * 3], p[b * 3 + 1]);
    ctx.lineTo(p[c * 3], p[c * 3 + 1]);
    ctx.closePath();
  }
  ctx.fill();
}

// The whole classic body's texture, exactly as Roblox bakes it. Returns null when the local
// Roblox content is unavailable, so the caller can fall back to the per-part approximation.
export async function buildClassicAtlas(rig, clothing) {
  const [shirtImg, pantsImg] = await Promise.all([
    clothing.shirt ? loadTemplate(clothing.shirt) : null,
    clothing.pants ? loadTemplate(clothing.pants) : null,
  ]);
  if (!shirtImg && !pantsImg) return null;
  const sources = {
    shirt: shirtImg ? imageToPixels(shirtImg) : null,
    pants: pantsImg ? imageToPixels(pantsImg) : null,
  };

  const meshes = await Promise.all(ATLAS_LAYERS.map((l) => loadLocalMesh(l.mesh)));
  if (meshes.some((m) => !m)) return null; // no local Roblox install

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorOf = (name) => {
    const def = rig.parts.find((p) => p.name === name);
    return (def && def.color) || '#A3A2A5';
  };

  // Base body colours first, as native fills.
  ATLAS_LAYERS.forEach((layer, i) => {
    if (layer.garment) return;
    fillCompositMesh(ctx, meshes[i], colorOf(layer.part));
  });

  // Then the garments, sampled exactly.
  const dst = ctx.getImageData(0, 0, ATLAS_W, ATLAS_H).data;
  ATLAS_LAYERS.forEach((layer, i) => {
    if (!layer.garment || !sources[layer.garment]) return;
    runCompositMesh(dst, meshes[i], sources[layer.garment]);
  });
  ctx.putImageData(new ImageData(dst, ATLAS_W, ATLAS_H), 0, 0);
  return canvas;
}

// ---------------------------------------------------------------- R15
//
// R15 composites per body GROUP rather than into one body-wide sheet, and each group's parts
// share that group's canvas, stacking disjointly down it — measured from the stock R15 meshes'
// own UVs, which meet exactly at their boundaries:
//     torso  LowerTorso v 0.023..0.375 | UpperTorso v 0.375..0.962
//     arm    Hand 0.007..0.233 | LowerArm 0.247..0.543 | UpperArm 0.544..0.993
//     leg    Foot 0.008..0.232 | LowerLeg 0.247..0.544 | UpperLeg 0.544..0.769
//
// Roblox ships no R15 *leg* compositing mesh. It doesn't need one: the leg UV layout is the arm
// layout (same u span, same 0.247/0.544 breakpoints — a leg simply doesn't use the top of it), so
// a leg reuses its side's arm mesh and draws from the PANTS template instead of the shirt. Arms
// and legs genuinely overlap in UV space, which is what proves they are separate canvases rather
// than one shared sheet.
const R15_GROUPS = {
  torso: { mesh: 'avatar/compositing/R15CompositTorsoBase.mesh', w: 388, h: 264, garments: ['pants', 'shirt'], primary: 'UpperTorso' },
  leftArm: { mesh: 'avatar/compositing/R15CompositLeftArmBase.mesh', w: 264, h: 284, garments: ['shirt'], primary: 'LeftUpperArm' },
  rightArm: { mesh: 'avatar/compositing/R15CompositRightArmBase.mesh', w: 264, h: 284, garments: ['shirt'], primary: 'RightUpperArm' },
  leftLeg: { mesh: 'avatar/compositing/R15CompositLeftArmBase.mesh', w: 264, h: 284, garments: ['pants'], primary: 'LeftUpperLeg' },
  rightLeg: { mesh: 'avatar/compositing/R15CompositRightArmBase.mesh', w: 264, h: 284, garments: ['pants'], primary: 'RightUpperLeg' },
};

const R15_PART_GROUP = {
  UpperTorso: 'torso', LowerTorso: 'torso',
  LeftUpperArm: 'leftArm', LeftLowerArm: 'leftArm', LeftHand: 'leftArm',
  RightUpperArm: 'rightArm', RightLowerArm: 'rightArm', RightHand: 'rightArm',
  LeftUpperLeg: 'leftLeg', LeftLowerLeg: 'leftLeg', LeftFoot: 'leftLeg',
  RightUpperLeg: 'rightLeg', RightLowerLeg: 'rightLeg', RightFoot: 'rightLeg',
};

export function r15GroupOf(partName) { return R15_PART_GROUP[partName] || null; }

const r15Cache = new Map();
// One group's canvas, built with the same conventions proven for the classic atlas. Cached per
// rig+group, since every part of a group shares one canvas.
export function buildR15GroupAtlas(rig, clothing, partName, cacheKey) {
  const groupName = R15_PART_GROUP[partName];
  const group = groupName && R15_GROUPS[groupName];
  if (!group) return Promise.resolve(null);
  const garments = group.garments.filter((g) => clothing[g]);
  if (!garments.length) return Promise.resolve(null);

  const key = `${cacheKey}|${groupName}`;
  if (r15Cache.has(key)) return r15Cache.get(key);

  const build = (async () => {
    const mesh = await loadLocalMesh(group.mesh);
    if (!mesh) return null;
    const dst = new Uint8ClampedArray(group.w * group.h * 4);
    // Base colour for the whole group. Parts of a group can in principle differ, but they share
    // one canvas, so this uses the group's main part — clothing covers nearly all of it anyway.
    const def = rig.parts.find((p) => p.name === group.primary) || rig.parts.find((p) => p.name === partName);
    const base = solidPixels((def && def.color) || '#A3A2A5');
    for (let i = 0; i < dst.length; i += 4) {
      dst[i] = base.data[0]; dst[i + 1] = base.data[1]; dst[i + 2] = base.data[2]; dst[i + 3] = 255;
    }
    for (const g of garments) { // pants before shirt, the order Roblox layers them
      const img = await loadTemplate(clothing[g]);
      if (!img) continue;
      runCompositMesh(dst, mesh, imageToPixels(img), group.w, group.h);
    }
    const canvas = document.createElement('canvas');
    canvas.width = group.w;
    canvas.height = group.h;
    canvas.getContext('2d').putImageData(new ImageData(dst, group.w, group.h), 0, 0);
    return canvas;
  })();
  r15Cache.set(key, build);
  return build;
}

// One part's finished texture: the body colour underneath, then each garment's template painted
// face by face on top. Returns null when this part wears nothing, so the caller keeps the plain
// coloured material rather than paying for a texture that would only re-state its colour.
//
// This is the FALLBACK for when Roblox's own content isn't on the machine (see buildClassicAtlas
// above, which is exact). It maps template regions onto a part's own box unwrap, which matches
// Studio visually but is a re-derivation rather than the engine's real bake.
export function buildPartClothingCanvas(def, geometry, partsByName, images) {
  const info = PART_INFO.get(def.name);
  if (!info) return null;
  const garments = info.garments.filter((g) => images[g]);
  if (!garments.length) return null;
  const rects = faceUvRects(geometry);
  if (!rects || !Object.keys(rects).length) return null;
  const share = verticalShare(def, partsByName);
  if (!share) return null;

  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = def.color || '#A3A2A5';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.imageSmoothingEnabled = true;

  const [shareTop, shareBottom] = share;
  for (const garment of garments) { // pants first, shirt over it — the order Roblox draws them
    const img = images[garment];
    for (const [faceName, dst] of Object.entries(rects)) {
      const src = TEMPLATE_BLOCKS[info.block][faceName];
      if (!src) continue;
      // Caps belong to the ends of the limb only; drawing the UP patch on a forearm would put a
      // shoulder cap halfway down the arm.
      if (faceName === 'UP' && info.index !== 0) continue;
      if (faceName === 'DOWN' && info.index !== info.chain.length - 1) continue;
      // Side faces get the vertical slice of the strip this part covers. Template Y runs downward
      // from the top of the limb, so the share maps straight onto it.
      const sliced = (faceName === 'UP' || faceName === 'DOWN')
        ? src
        : { x: src.x, y: src.y + src.h * shareTop, w: src.w, h: src.h * (shareBottom - shareTop) };
      // UV v runs upward (textures are flipped on upload), so v1 is the TOP of the destination.
      const dx = dst.u0 * TEX_SIZE;
      const dy = (1 - dst.v1) * TEX_SIZE;
      const dw = (dst.u1 - dst.u0) * TEX_SIZE;
      const dh = (dst.v1 - dst.v0) * TEX_SIZE;
      if (!(dw > 0 && dh > 0)) continue;
      ctx.drawImage(img, sliced.x, sliced.y, sliced.w, sliced.h, dx, dy, dw, dh);
    }
  }
  return canvas;
}
