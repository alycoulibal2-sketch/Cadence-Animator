// Real FBX/GLB/OBJ import with EXACT source geometry — no decimation, no CDN round-trip, no
// placeholder-on-failure possible (the data is already in memory). Produces the same shape
// io.js's rigFromModelTree() does — { name, rigType, rootPart, parts, joints } — so it plugs
// straight into the existing addRigItem() pipeline and gets every downstream feature (save/load,
// export, onion skin, attach, MCP) for free, with zero special-casing anywhere else.
import * as CF from './cf.js';

let THREE_ = null;
async function getThree() {
  if (!THREE_) THREE_ = await import('../../node_modules/three/build/three.module.js');
  return THREE_;
}

function baseName(filename) {
  return (filename || 'Import').replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_').replace(/[^\w -]/g, '') || 'Import';
}
function safeId(name, i) {
  return `${(name || 'Mesh').replace(/[^\w]/g, '_')}_${i}`;
}

// One mesh's exact triangle data, with `bakeMatrix` applied directly to the vertex arrays (never
// resampled/simplified — a straight linear transform of every vertex, so it's lossless).
function extractGeometryData(THREE, mesh, bakeMatrix) {
  const geo = mesh.geometry.clone();
  geo.applyMatrix4(bakeMatrix);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = new THREE.Vector3(); bb.getSize(size);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const idx = geo.index ? geo.index.array : defaultIndices(pos.count);
  // Typed arrays through the extract and merge stages, converted to plain arrays exactly once at
  // the end (see plainMesh). Array.from() here used to box every float into a JS array — on a mesh
  // with hundreds of thousands of vertices that dominated the import, and on a multi-mesh bone it
  // paid for itself twice, since mergeGeometryData then copied those arrays again.
  return {
    positions: toF32(pos.array),
    normals: toF32(nrm.array),
    uvs: uv ? toF32(uv.array) : new Float32Array(pos.count * 2),
    indices: toU32(idx),
    size: [Math.max(0.02, size.x), Math.max(0.02, size.y), Math.max(0.02, size.z)],
    triCount: idx.length / 3,
  };
}

const toF32 = (a) => (a instanceof Float32Array ? a : Float32Array.from(a));
const toU32 = (a) => (a instanceof Uint32Array ? a : Uint32Array.from(a));

// The typed arrays above are an INTERNAL representation for the extract/merge stages only. A rig
// definition is JSON-serialized wholesale (project save, autosave, MCP get_state), and a typed
// array stringifies as {"0":1.2,"1":3.4,…} rather than an array — so every customMesh is converted
// back to a plain array exactly once, here, at the point the part object is built.
function plainMesh(d) {
  return {
    positions: Array.from(d.positions),
    normals: Array.from(d.normals),
    uvs: Array.from(d.uvs),
    indices: Array.from(d.indices),
  };
}
// GLB embeds its textures directly in the binary blob, so GLTFLoader hands back a fully-decoded
// THREE.Texture with a real .image — extract it as a data URI so rigbuild.js can apply it
// synchronously (no CDN dependency, matches customMesh's own "already fully in memory"
// philosophy). FBX textures are usually EXTERNAL files referenced by relative path — since
// parse() is called with no real filesystem path (there's nothing to resolve them against),
// those never populate .image and this correctly returns null, falling back to a flat color.
// FBX files with "Embed Media" turned on at export DO carry their textures inside the binary
// and work exactly like the GLB case.
function textureToDataUri(texture) {
  const img = texture?.image;
  const w = img?.width || img?.videoWidth;
  const h = img?.height || img?.videoHeight;
  if (!w || !h) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } catch (_) {
    return null; // e.g. a tainted/cross-origin source — not expected for a local file import, but never fatal
  }
}
function extractTextureForMesh(mesh) {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat) return null;
  return textureToDataUri(mat.map) || textureToDataUri(mat.emissiveMap) || null;
}

function defaultIndices(n) {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

function loadFile(THREE, ext, arrayBuffer) {
  if (ext === 'fbx') {
    return import('../vendor/three/loaders/FBXLoader.js').then(({ FBXLoader }) => new FBXLoader().parse(arrayBuffer, ''));
  }
  if (ext === 'glb' || ext === 'gltf') {
    return import('../vendor/three/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new Promise((resolve, reject) => {
      new GLTFLoader().parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
    }));
  }
  if (ext === 'obj') {
    return import('../vendor/three/loaders/OBJLoader.js').then(({ OBJLoader }) => {
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      return new OBJLoader().parse(text);
    });
  }
  throw new Error(`Unsupported file type: .${ext} (supported: .fbx, .glb, .gltf, .obj)`);
}

// No skeleton: every mesh is baked into ONE shared frame (its own true world transform from the
// file), and every part's own CFrame contribution is left at IDENTITY — so the solver places
// every part at exactly `origin` and the already-baked vertex data reproduces the file's exact
// relative layout with no risk of a double-transform bug. Correct for this case specifically
// because welds are rigid: nothing here will ever be individually re-posed, so there's no need
// for per-part pivots — only the combined assembled SHAPE has to be exact, and it is.
function buildStaticRig(THREE, filename, meshes) {
  const baked = meshes.map((m) => extractGeometryData(THREE, m, m.matrixWorld));
  let rootIdx = 0, rootTris = -1;
  baked.forEach((d, i) => { if (d.triCount > rootTris) { rootTris = d.triCount; rootIdx = i; } });

  const partIds = meshes.map((m, i) => safeId(m.name, i));
  const parts = meshes.map((m, i) => {
    const part = {
      id: partIds[i], name: m.name || `Mesh${i}`,
      className: 'MeshPart', size: baked[i].size, cf: CF.IDENTITY.slice(),
      color: '#A3A2A5',
      customMesh: plainMesh(baked[i]),
    };
    const tex = extractTextureForMesh(m);
    if (tex) part.customTexture = tex;
    return part;
  });
  const joints = parts
    .map((p, i) => (i === rootIdx ? null : { name: `${p.id}Weld`, kind: 'weld', part0: partIds[rootIdx], part1: p.id, c0: CF.IDENTITY.slice(), c1: CF.IDENTITY.slice() }))
    .filter(Boolean);

  return { name: baseName(filename), rigType: 'Custom', rootPart: partIds[rootIdx], parts, joints };
}

// Has a skeleton: each BONE becomes a real, individually posable part (Motor6D-equivalent joint
// from its parent bone, C0 synthesized from the bind-pose bone matrices — the standard way to
// convert any skeletal hierarchy into a Motor6D rig). Each SkinnedMesh is assigned to its single
// most-influential bone (majority vote by total skin weight across all its vertices) and baked
// into THAT bone's local/bind frame — real per-joint animation, but NOT true per-vertex GPU
// skinning/blending (this app's whole animation model is rigid-part-based, same as Roblox's own
// Motor6D system, so that's the correct target to hit, not a shortfall against it). A bone with
// no mesh assigned still becomes a real (invisible, HumanoidRootPart-style) part so the joint
// chain stays intact.
function buildSkeletalRig(THREE, filename, meshes, skeleton) {
  const bones = skeleton.bones;
  const boneWorld = new Map(bones.map((b) => [b, CF.fromThreeMatrix(b.matrixWorld)]));
  const boneParent = new Map(); // Bone -> parent Bone (within this skeleton only)
  const boneSet = new Set(bones);
  for (const b of bones) {
    let p = b.parent;
    while (p && !boneSet.has(p)) p = p.parent;
    if (p) boneParent.set(b, p);
  }
  const rootBone = bones.find((b) => !boneParent.has(b)) || bones[0];

  // Dominant-bone vote per mesh: sum each vertex's skinWeight onto its highest-weighted bone.
  const meshBone = new Map();
  for (const m of meshes) {
    if (!m.isSkinnedMesh || !m.geometry.attributes.skinIndex) { meshBone.set(m, rootBone); continue; }
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    const tally = new Map();
    for (let v = 0; v < si.count; v++) {
      let best = -1, bestW = -1;
      for (let k = 0; k < si.itemSize; k++) {
        const w = sw.getComponent(v, k);
        if (w > bestW) { bestW = w; best = si.getComponent(v, k); }
      }
      if (best < 0) continue;
      tally.set(best, (tally.get(best) || 0) + bestW);
    }
    let winner = 0, winnerScore = -1;
    for (const [idx, score] of tally) if (score > winnerScore) { winnerScore = score; winner = idx; }
    meshBone.set(m, m.skeleton.bones[winner] || rootBone);
  }

  const boneIds = new Map(bones.map((b, i) => [b, safeId(b.name, i)]));
  const meshesByBone = new Map();
  for (const m of meshes) {
    const b = meshBone.get(m);
    if (!meshesByBone.has(b)) meshesByBone.set(b, []);
    meshesByBone.get(b).push(m);
  }

  const parts = [];
  const joints = [];
  for (const bone of bones) {
    const id = boneIds.get(bone);
    const assigned = meshesByBone.get(bone) || [];
    const boneWorldCF = boneWorld.get(bone);
    if (assigned.length) {
      const boneWorldInv = CF.inverse(boneWorldCF);
      const baked = assigned.map((m) => extractGeometryData(THREE, m, CF.toThreeMatrix(CF.mul(boneWorldInv, CF.fromThreeMatrix(m.matrixWorld)), new THREE.Matrix4())));
      // Multiple meshes on one bone: merge into a single part by concatenating triangle data —
      // still exact, just combined (this app's rig model is one geometry per part).
      const merged = mergeGeometryData(baked);
      const part = {
        id, name: bone.name || id, className: 'MeshPart', size: merged.size, cf: CF.IDENTITY.slice(),
        color: '#A3A2A5',
        customMesh: plainMesh(merged),
      };
      // Same one-geometry-per-part simplification as the merge above: if several differently-
      // textured meshes land on one bone, only the first's texture is used for the whole part —
      // consistent with the existing documented tradeoff, and strictly better than the flat grey
      // this would otherwise fall back to.
      const tex = extractTextureForMesh(assigned[0]);
      if (tex) part.customTexture = tex;
      parts.push(part);
    } else {
      parts.push({ id, name: bone.name || id, className: 'Part', size: [0.2, 0.2, 0.2], cf: CF.IDENTITY.slice(), color: '#A3A2A5', transparency: 1 });
    }
    const parent = boneParent.get(bone);
    if (parent) {
      const parentWorldCF = boneWorld.get(parent);
      joints.push({
        name: `${boneIds.get(parent)}To${id}`,
        part0: boneIds.get(parent), part1: id,
        c0: CF.mul(CF.inverse(parentWorldCF), boneWorldCF),
        c1: CF.IDENTITY.slice(),
      });
    }
  }

  return { name: baseName(filename), rigType: 'Custom', rootPart: boneIds.get(rootBone), parts, joints };
}

// Preallocate-and-set, not push(...spread). Spreading an array into push passes every element as
// a separate function argument, which blows the call-argument limit (a RangeError, i.e. a failed
// import) on any mesh over ~100k floats and is slow well before that.
function mergeGeometryData(chunks) {
  if (chunks.length === 1) return chunks[0];
  let nPos = 0, nUv = 0, nIdx = 0;
  for (const c of chunks) { nPos += c.positions.length; nUv += c.uvs.length; nIdx += c.indices.length; }
  const positions = new Float32Array(nPos);
  const normals = new Float32Array(nPos);
  const uvs = new Float32Array(nUv);
  const indices = new Uint32Array(nIdx);
  let pOff = 0, uOff = 0, iOff = 0, base = 0;
  for (const c of chunks) {
    positions.set(c.positions, pOff);
    normals.set(c.normals, pOff);
    uvs.set(c.uvs, uOff);
    for (let i = 0; i < c.indices.length; i++) indices[iOff + i] = c.indices[i] + base;
    pOff += c.positions.length;
    uOff += c.uvs.length;
    iOff += c.indices.length;
    base += c.positions.length / 3;
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i]; if (positions[i] > maxX) maxX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1]; if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2]; if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }
  return { positions, normals, uvs, indices, size: [Math.max(0.02, maxX - minX), Math.max(0.02, maxY - minY), Math.max(0.02, maxZ - minZ)] };
}

// Entry point. Returns a rig def (same shape as io.js's rigFromModelTree) ready for addRigItem().
export async function importExternalMesh(arrayBuffer, filename) {
  const THREE = await getThree();
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const root = await loadFile(THREE, ext, arrayBuffer);
  root.updateMatrixWorld(true);

  const meshes = [];
  let skeleton = null;
  root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position?.count) {
      meshes.push(o);
      if (o.isSkinnedMesh && o.skeleton && !skeleton) skeleton = o.skeleton;
    }
  });
  if (!meshes.length) throw new Error('No mesh geometry found in that file');

  if (skeleton && skeleton.bones.length > 1) return buildSkeletalRig(THREE, filename, meshes, skeleton);
  return buildStaticRig(THREE, filename, meshes);
}
