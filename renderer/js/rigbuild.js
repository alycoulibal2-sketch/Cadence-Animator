// Builds three.js objects from rig definitions and solves joint transforms.
import * as THREE from '../../node_modules/three/build/three.module.js';
import * as CF from './cf.js';

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

function loadRobloxTexture(texId) {
  const id = String(texId).match(/(\d{4,})/)?.[1];
  if (!id) return Promise.resolve(null);
  return window.cadence.fetchTexture(id).then((dataUri) => new Promise((resolve) => {
    texLoader.load(dataUri, (t) => { t.colorSpace = THREE.SRGBColorSpace; resolve(t); }, undefined, () => resolve(null));
  })).catch(() => null);
}

// Classic "head" special mesh: a rounded-cylinder lathe profile (flat disc top/bottom, bevelled
// corners, straight sides in between) approximating Roblox's bevelled-cylinder head. Unit size
// (1 wide, 1 tall) — callers scale it to the actual head dimensions.
// Kept in sync with headGeometry() below by construction (same three numbers) — used separately
// to build a face-decal patch that's curved to exactly match this profile's constant-radius
// mid-section, instead of a flat plane that can only ever touch a curved surface at one point.
const HEAD_R = 0.42, HEAD_r = 0.16, HEAD_H = 0.5;

function headGeometry() {
  const R = HEAD_R, H = HEAD_H, r = HEAD_r;
  const N = 10;    // segments per corner arc
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
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.computeVertexNormals();
  return geo;
}

// Is `def` rendered with the built-in lathe headGeometry() shape (as opposed to a real fetched
// CDN mesh, or an arbitrary custom-imported part that just happens to be named "Head")? Both the
// R6-style (Part + specialMesh.meshType='Head') and R15/Rthro-style (MeshPart named Head, no
// customMesh) builtin conventions land here — see partGeometry() above for the exact match.
function isLatheHeadPart(def) {
  if (def.specialMesh && def.specialMesh.meshType === 'Head') return true;
  return def.className === 'MeshPart' && def.name === 'Head' && !def.customMesh;
}

// Roblox Material -> a reasonable PBR approximation. Roblox's own renderer uses a proprietary
// baked material texture atlas we have no access to, so this is a best-effort visual match (right
// roughness/metalness family, Neon actually glows) rather than a pixel-identical reproduction —
// that's a real limit of rendering Roblox content in a from-scratch three.js scene, not a bug.
const MATERIAL_PROPS = {
  // Roblox's Plastic has a visible, soft specular sheen — 0.82 read almost fully matte under
  // this viewport's PBR lighting, flatter than the real material. 0.55 keeps it clearly non-glossy
  // (SmoothPlastic at 0.25 is still the distinctly shinier one) while giving back a visible highlight.
  Plastic: { roughness: 0.55, metalness: 0.02 },
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

// Real R15/Rthro part names — used only to pick a humanoid-shaped placeholder while the
// actual mesh downloads (or in place of it, if the CDN 401s: some avatar assets require an
// authenticated Roblox session that a bare desktop app doesn't have — this keeps the rig
// looking like a person instead of a pile of boxes when that happens).
const LIMB_PART_NAMES = new Set([
  'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot',
]);

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

function partGeometry(def) {
  const [sx, sy, sz] = def.size;
  if (def.customMesh) return customMeshGeometry(def);
  if (def.className === 'MeshPart' || (def.specialMesh && def.specialMesh.meshType === 'FileMesh' && def.specialMesh.meshId)) {
    if (LIMB_PART_NAMES.has(def.name)) {
      const radius = Math.max(0.08, (sx + sz) / 4);
      const length = Math.max(0.05, sy - radius * 2);
      return new THREE.CapsuleGeometry(radius, length, 4, 12);
    }
    if (def.name === 'Head') {
      // R15/Rthro heads are gated MeshPart CDN assets that 401 without an authenticated Roblox
      // session (see fetchMeshGeometry below) — the classic lathed head shape is a much closer
      // stand-in than a bare sphere for the real default Roblox head while that fetch is pending
      // or fails, and never affects the actual exported meshId/className data.
      const g = headGeometry();
      g.scale(sx, sy, sz);
      return g;
    }
    return new THREE.BoxGeometry(sx, sy, sz); // torso pieces already read fine as boxes; replaced async if the mesh loads
  }
  if (def.specialMesh && def.specialMesh.meshType === 'Head') {
    const g = headGeometry();
    const s = def.specialMesh.scale || [1.25, 1.25, 1.25];
    g.scale(s[0], s[1], s[2]);
    return g;
  }
  if (def.shape === 'Ball') return new THREE.SphereGeometry(Math.min(sx, sy, sz) / 2, 24, 18);
  if (def.shape === 'Cylinder') {
    const g = new THREE.CylinderGeometry(Math.min(sy, sz) / 2, Math.min(sy, sz) / 2, sx, 24);
    g.rotateZ(Math.PI / 2); // Roblox cylinders extend along X
    return g;
  }
  return new THREE.BoxGeometry(sx, sy, sz);
}

const handleGeoNormal = new THREE.SphereGeometry(0.22, 12, 10);
const handleGeoSmall = new THREE.SphereGeometry(0.12, 12, 10);

// Roblox's own renderer always draws a subtle dark edge along every part's hard corners — one of
// the things that reads as "flat/plastic-toy-like" in a bare PBR material without it. Shared
// across every part (a child of that part's own mesh, so it inherits the exact same per-frame
// world matrix automatically via the normal scene graph — no extra per-frame update code needed).
// depthTest stays true: these lines sit exactly on the surface they outline, so testing them
// normally against the part's own coincident faces is what keeps a hidden BACK edge from showing
// through the front (an x-ray-wireframe look real Roblox never has) — buildEdgeOverlay below
// pushes the line geometry a hair outward instead, which fixes the OTHER problem (below) without
// that trade-off.
const EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthTest: true });
// These placeholder primitives approximate a curve with a fixed ring of flat segments (the lathe
// head: 24 segments/360° = 15° apart; a capsule limb's radial segments similarly) — EVERY one of
// those segment seams has SOME non-zero angle to its neighbor, so ANY edge-detection threshold
// low enough to catch a box's genuine ~90° corners also lights up all 24 of those seams as fake
// "hard" lines, reading as a busy faceted look on what should be smooth (confirmed from a real
// screenshot: vertical stripes running the length of the head). Roblox's real, smooth-shaded
// meshes never show this, so the correct fix is skipping the overlay on these shapes entirely,
// not chasing a "big enough" threshold that still risks catching real coarse curves elsewhere.
const ROUND_PRIMITIVE_TYPES = new Set(['LatheGeometry', 'CapsuleGeometry', 'SphereGeometry', 'CylinderGeometry']);
function buildEdgeOverlay(geometry) {
  if (ROUND_PRIMITIVE_TYPES.has(geometry.type)) return null;
  // 30°, not 1° — generous enough to ignore a real (customMesh or fetched-CDN) mesh's own
  // moderate per-triangle noise while still catching genuine hard corners/creases.
  const edgeGeo = new THREE.EdgesGeometry(geometry, 30);
  // Nudge the outline a hair outward from the shape's own bounding-box center (not just object-
  // local origin — a fetched/customMesh part isn't always centered there) so it sits marginally
  // outside the surface it traces. Without this the line is exactly coincident with that surface,
  // which is a textbook z-fight: GPU rounding picks a winner per-pixel per-frame, so the outline
  // flickered in and out depending on camera angle (confirmed: a straight-on full-body shot showed
  // nothing, while an oblique close-up on the exact same part showed it clearly).
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const c = geometry.boundingBox.getCenter(new THREE.Vector3());
  edgeGeo.translate(-c.x, -c.y, -c.z);
  edgeGeo.scale(1.004, 1.004, 1.004);
  edgeGeo.translate(c.x, c.y, c.z);
  const edges = new THREE.LineSegments(edgeGeo, EDGE_MATERIAL);
  edges.raycast = () => { }; // cosmetic only — never steals a click from the part underneath
  edges.userData.isEdgeOverlay = true; // so a later real-geometry swap can find and replace it
  return edges;
}
// Swap in a fresh overlay matching new geometry — used once a part's real (async-loaded) mesh
// replaces its placeholder, since the old overlay's edges no longer match the new shape at all.
function refreshEdgeOverlay(mesh, geometry) {
  const old = mesh.children.find((c) => c.userData.isEdgeOverlay);
  if (old) { mesh.remove(old); old.geometry.dispose(); }
  const fresh = buildEdgeOverlay(geometry);
  if (fresh) mesh.add(fresh);
}

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
    const initialEdges = buildEdgeOverlay(geometry);
    if (initialEdges) mesh.add(initialEdges);
    this.group.add(mesh);
    // baseEmissive: Neon's own glow color/intensity, restored by setHighlight() below instead of
    // going to black like every other material — a Neon part must keep glowing even while some
    // other part is selected, not just when this exact one is.
    const baseEmissive = mp.emissive ? { color: new THREE.Color(def.color || '#A3A2A5'), intensity: mp.emissive } : null;
    this.parts.set(def.id, { def, mesh, world: CF.IDENTITY.slice(), extras: [], baseEmissive });

    // customTexture: an already-decoded data URI captured at FBX/GLB import time (see
    // meshImport.js) — no CDN, no async race with the real-mesh-fetch path below (customMesh
    // parts never have a meshId, so that path is always skipped for these), just load it.
    if (def.customTexture) {
      texLoader.load(def.customTexture, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
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
          material.color.set('#ffffff');
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
        refreshEdgeOverlay(mesh, g);
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
      tex.colorSpace = THREE.SRGBColorSpace;
      let patch;
      if (face === 'Front' && isLatheHeadPart(def)) {
        // The head is a LatheGeometry revolved around Y (see headGeometry()) — a flat plane can
        // only ever touch that curved surface at one point, gapping everywhere else (worst at
        // the corners, which is exactly the "little gap" this replaces). A cylindrical patch at
        // the lathe's own constant-radius mid-band sits geometrically flush against the real
        // surface instead of approximating it. Tracing headGeometry()'s own profile points in
        // order: the bottom bevel arc ends at (R, -H+r) and the top bevel arc starts at
        // (R, H-r) — CONSECUTIVE points in a lathe profile, i.e. a straight vertical polyline
        // edge at the FULL radius R (not R-r, which is only the radius at the top/bottom rim
        // caps) spanning height ±(H-r). Confirmed by the patch being invisible (occluded by the
        // head's own nearer, actually-R-radius surface) when this used R-r on the first attempt.
        const isHeadMesh = def.specialMesh && def.specialMesh.meshType === 'Head';
        const scale = isHeadMesh ? (def.specialMesh.scale || [1.25, 1.25, 1.25]) : def.size;
        const [sx, sy, sz] = scale;
        const radius = HEAD_R * ((sx + sz) / 2); // avg of X/Z scale — heads are ~circular in cross-section
        const flatHalfHeight = (HEAD_H - HEAD_r) * sy;
        const thetaHalf = 0.62; // ~35.5° each side of dead-center-front — a believable face width
        const patchHeight = flatHalfHeight * 2 * 0.86; // stays inboard of the top/bottom bevel curve
        // CylinderGeometry's own convention (vertex.x = r·sinθ, vertex.z = r·cosθ — confirmed
        // directly from three.js's source, not assumed) puts θ=π at -Z, which is "Front" here.
        const geo = new THREE.CylinderGeometry(
          radius, radius, patchHeight, 24, 1, true,
          Math.PI - thetaHalf, thetaHalf * 2,
        );
        patch = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false }));
        // Layers nudge outward by scaling about the shared Y axis (the cylinder's own axis) —
        // equivalent to the flat-plane path's per-layer offset, without disturbing the curve.
        patch.scale.setScalar(1 + 0.006 + layerIndex * 0.006);
      } else {
        const isHeadMesh = def.specialMesh && def.specialMesh.meshType === 'Head';
        const w = isHeadMesh ? (def.specialMesh.scale?.[0] ?? 1.25) : def.size[0];
        const h = isHeadMesh ? (def.specialMesh.scale?.[1] ?? 1.25) : def.size[1];
        const depth = isHeadMesh ? (def.specialMesh.scale?.[2] ?? 1.25) : def.size[2];
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

  setHighlight(partId, level) { // level: 0 none, 1 hover, 2 selected
    for (const [id, p] of this.parts) {
      const em = p.mesh.material.emissive;
      if (!em) continue;
      if (id === partId && level === 2) em.set(0x3355ff), p.mesh.material.emissiveIntensity = 0.35;
      else if (id === partId && level === 1) em.set(0x223377), p.mesh.material.emissiveIntensity = 0.3;
      else if (p.baseEmissive) em.copy(p.baseEmissive.color), p.mesh.material.emissiveIntensity = p.baseEmissive.intensity;
      else em.set(0x000000);
      p.mesh.material.needsUpdate = false;
    }
    for (const h of this.handles) {
      const isTarget = h.joint.part1 === partId;
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
      // handle geometries and the edge-overlay material are shared module-level constants —
      // never dispose those, or every OTHER still-live instance loses them too.
      if (o.geometry && o.geometry !== handleGeoNormal && o.geometry !== handleGeoSmall) o.geometry.dispose();
      if (o.material && o.material !== EDGE_MATERIAL) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

// Camera items get a small visible camera body + a real PerspectiveCamera
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

// Shared across every VFX item — a small soft-radial-gradient sprite texture, generated once via
// canvas (no network fetch, so it's unaffected by the app's CSP) instead of every particle being
// a hard-edged flat square.
let particleTexture = null;
function getParticleTexture() {
  if (particleTexture) return particleTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  particleTexture = new THREE.CanvasTexture(c);
  return particleTexture;
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
    const tex = getParticleTexture();
    for (let i = 0; i < cap; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false });
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
