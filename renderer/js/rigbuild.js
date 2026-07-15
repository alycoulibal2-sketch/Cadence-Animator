// Builds three.js objects from rig definitions and solves joint transforms.
import * as THREE from '../../node_modules/three/build/three.module.js';
import * as CF from './cf.js';

let classicFacePromise = null;
function getClassicFace() {
  if (!classicFacePromise) classicFacePromise = window.eclipse.classicFace();
  return classicFacePromise;
}

const texLoader = new THREE.TextureLoader();
const meshGeoCache = new Map(); // meshId -> Promise<THREE.BufferGeometry>

// Rendered-only shrink applied to every part around its own center: two parts that touch flush
// at a joint (the normal case) end up with a small visible seam instead of solid contact, so the
// handle marker sitting exactly on that shared boundary reads as floating in a gap rather than
// half-buried in both parts. Cosmetic only — `p.world` (the real CFrame used for gizmos/IK/export)
// is never touched, only the mesh's rendered matrix.
export const PART_GAP_SCALE = 0.88;
const partGapVector = new THREE.Vector3(PART_GAP_SCALE, PART_GAP_SCALE, PART_GAP_SCALE);

function fetchMeshGeometry(meshId) {
  const id = String(meshId).match(/(\d{4,})/)?.[1];
  if (!id) return Promise.reject(new Error('bad mesh id'));
  if (!meshGeoCache.has(id)) {
    meshGeoCache.set(id, window.eclipse.fetchMesh(id).then((data) => {
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
  return window.eclipse.fetchTexture(id).then((dataUri) => new Promise((resolve) => {
    texLoader.load(dataUri, (t) => { t.colorSpace = THREE.SRGBColorSpace; resolve(t); }, undefined, () => resolve(null));
  })).catch(() => null);
}

// Classic "head" special mesh: lathe profile approximating the bevelled cylinder
function headGeometry() {
  const pts = [];
  const N = 12;
  // profile from bottom center out: bevelled cylinder, unit size (1 wide, 1 tall)
  pts.push(new THREE.Vector2(0, -0.5));
  pts.push(new THREE.Vector2(0.34, -0.5));
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * Math.PI;
    pts.push(new THREE.Vector2(0.34 + 0.16 * Math.cos(a), Math.sin(a) * 0.34 * 0.5 / 0.34 * 0.32 + (a < 0 ? -0.18 : 0.18)));
  }
  pts.push(new THREE.Vector2(0.34, 0.5));
  pts.push(new THREE.Vector2(0, 0.5));
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.computeVertexNormals();
  return geo;
}

// Real R15/Rthro part names — used only to pick a humanoid-shaped placeholder while the
// actual mesh downloads (or in place of it, if the CDN 401s: some avatar assets require an
// authenticated Roblox session that a bare desktop app doesn't have — this keeps the rig
// looking like a person instead of a pile of boxes when that happens).
const LIMB_PART_NAMES = new Set([
  'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot',
]);

function partGeometry(def) {
  const [sx, sy, sz] = def.size;
  if (def.className === 'MeshPart' || (def.specialMesh && def.specialMesh.meshType === 'FileMesh' && def.specialMesh.meshId)) {
    if (LIMB_PART_NAMES.has(def.name)) {
      const radius = Math.max(0.08, (sx + sz) / 4);
      const length = Math.max(0.05, sy - radius * 2);
      return new THREE.CapsuleGeometry(radius, length, 4, 12);
    }
    if (def.name === 'Head') {
      return new THREE.SphereGeometry(Math.max(sx, sy, sz) / 2, 20, 16);
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

export class RigInstance {
  constructor(item, scene) {
    this.item = item;
    this.scene = scene;
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
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.color || '#A3A2A5'),
      roughness: 0.82,
      metalness: 0.02,
    });
    if (def.transparency > 0) {
      material.transparent = true;
      material.opacity = 1 - def.transparency;
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
    this.parts.set(def.id, { def, mesh, world: CF.IDENTITY.slice(), extras: [] });

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
      }).catch(() => { /* keep placeholder box */ });
    }

    // async: texture (fixes the UGC "black head" bug: we always fetch + apply the real texture).
    // Modern UGC heads carry their texture on a SurfaceAppearance rather than MeshPart.TextureID —
    // prefer that when present, since it's what actually renders in-game.
    const sa = def.surfaceAppearance;
    const texId = (sa && sa.colorMap) || (def.className === 'MeshPart' ? def.textureId : (def.specialMesh && def.specialMesh.textureId));
    if (texId) {
      loadRobloxTexture(texId).then((tex) => {
        if (!tex) return;
        material.map = tex;
        material.color.set('#ffffff');
        material.needsUpdate = true;
      });
    }
    if (sa && sa.roughnessMap) {
      loadRobloxTexture(sa.roughnessMap).then((tex) => { if (tex) { material.roughnessMap = tex; material.needsUpdate = true; } });
    }
    if (sa && sa.normalMap) {
      loadRobloxTexture(sa.normalMap).then((tex) => { if (tex) { material.normalMap = tex; material.needsUpdate = true; } });
    }

    // classic R6 smiley
    if (def.faceDecal) {
      getClassicFace().then((dataUri) => {
        if (!dataUri) return;
        texLoader.load(dataUri, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const isHeadMesh = def.specialMesh && def.specialMesh.meshType === 'Head';
          const w = isHeadMesh ? (def.specialMesh.scale?.[0] ?? 1.25) : def.size[0];
          const h = isHeadMesh ? (def.specialMesh.scale?.[1] ?? 1.25) : def.size[1];
          const depth = isHeadMesh ? (def.specialMesh.scale?.[2] ?? 1.25) : def.size[2];
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(w * 0.9, h * 0.9),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
          );
          plane.rotation.y = Math.PI; // face -Z (Roblox front)
          plane.position.z = -(depth / 2) * (isHeadMesh ? 0.82 : 1) - 0.012;
          plane.raycast = () => { }; // click through to the head
          mesh.add(plane);
        });
      });
    }
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
  #solve(pose, originCF, out) {
    const rootId = this.item.rig.rootPart;
    out.set(rootId, originCF);
    for (const j of this.solveOrder) {
      const p0World = out.get(j.part0);
      if (!p0World) continue;
      const isMotor = this.jointByPart1.get(j.part1) === j;
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
  computeWorld(pose, originCF) {
    if (!this.parts.has(this.item.rig.rootPart)) return;
    const worlds = this.#solve(pose, originCF, new Map());
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
  solvePoseWorlds(pose, originCF) {
    return this.#solve(pose, originCF, new Map());
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

  // Given a desired world CFrame for a part, return the joint transform that produces it
  transformForWorld(partId, desiredWorld) {
    const j = this.jointByPart1.get(partId);
    if (!j) return null;
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
      // handle geometries are shared module-level constants — never dispose those
      if (o.geometry && o.geometry !== handleGeoNormal && o.geometry !== handleGeoSmall) o.geometry.dispose();
      if (o.material) {
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
