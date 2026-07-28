'use strict';
// Parser for Roblox mesh asset formats (version 1.xx text, 2.00/3.xx/4.xx/5.00 binary,
// 6.xx/7.xx Draco-compressed).
// Returns { positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array }

function parseV1(text) {
  const lines = text.split('\n');
  const version = lines[0].trim();
  const scale = version === 'version 1.00' ? 0.5 : 1;
  const dataLine = lines[2] || '';
  const nums = dataLine.match(/\[([^\]]+)\]/g);
  if (!nums) throw new Error('Bad v1 mesh data');
  const vecs = nums.map((s) => s.slice(1, -1).split(',').map(Number));
  const vertCount = Math.floor(vecs.length / 3);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    const p = vecs[i * 3], nrm = vecs[i * 3 + 1], uv = vecs[i * 3 + 2];
    positions[i * 3] = p[0] * scale; positions[i * 3 + 1] = p[1] * scale; positions[i * 3 + 2] = p[2] * scale;
    normals[i * 3] = nrm[0]; normals[i * 3 + 1] = nrm[1]; normals[i * 3 + 2] = nrm[2];
    uvs[i * 2] = uv[0]; uvs[i * 2 + 1] = 1 - uv[1];
    indices[i] = i;
  }
  return { positions, normals, uvs, indices };
}

function readVerts(buf, offset, numVerts, vertSize) {
  const positions = new Float32Array(numVerts * 3);
  const normals = new Float32Array(numVerts * 3);
  const uvs = new Float32Array(numVerts * 2);
  for (let i = 0; i < numVerts; i++) {
    const base = offset + i * vertSize;
    positions[i * 3] = buf.readFloatLE(base);
    positions[i * 3 + 1] = buf.readFloatLE(base + 4);
    positions[i * 3 + 2] = buf.readFloatLE(base + 8);
    normals[i * 3] = buf.readFloatLE(base + 12);
    normals[i * 3 + 1] = buf.readFloatLE(base + 16);
    normals[i * 3 + 2] = buf.readFloatLE(base + 20);
    uvs[i * 2] = buf.readFloatLE(base + 24);
    uvs[i * 2 + 1] = 1 - buf.readFloatLE(base + 28);
  }
  return { positions, normals, uvs };
}

function readFaces(buf, offset, numFaces) {
  const indices = new Uint32Array(numFaces * 3);
  for (let i = 0; i < numFaces * 3; i++) indices[i] = buf.readUInt32LE(offset + i * 4);
  return indices;
}

function parseV2V3(buf, headerLine) {
  const isV3 = headerLine.startsWith('version 3');
  let pos = headerLine.length + 1; // include newline
  const headerSize = buf.readUInt16LE(pos);
  const headerStart = pos;
  pos += 2;
  const vertSize = buf.readUInt8(pos); pos += 1;
  pos += 1; // face size
  let numLODs = 0;
  if (isV3) {
    pos += 2; // sizeof_LOD
    numLODs = buf.readUInt16LE(pos); pos += 2;
  }
  const numVerts = buf.readUInt32LE(pos); pos += 4;
  const numFaces = buf.readUInt32LE(pos); pos += 4;
  pos = headerStart + headerSize;

  const { positions, normals, uvs } = readVerts(buf, pos, numVerts, vertSize);
  pos += numVerts * vertSize;
  let indices = readFaces(buf, pos, numFaces);
  pos += numFaces * 12;
  if (isV3 && numLODs >= 2) {
    const lods = [];
    for (let i = 0; i < numLODs; i++) { lods.push(buf.readUInt32LE(pos)); pos += 4; }
    indices = indices.subarray(lods[0] * 3, lods[1] * 3);
  }
  return { positions, normals, uvs, indices };
}

function parseV4V5(buf, headerLine) {
  let pos = headerLine.length + 1;
  const headerStart = pos;
  const headerSize = buf.readUInt16LE(pos); pos += 2;
  pos += 2; // lodType
  const numVerts = buf.readUInt32LE(pos); pos += 4;
  const numFaces = buf.readUInt32LE(pos); pos += 4;
  const numLODs = buf.readUInt16LE(pos); pos += 2;
  const numBones = buf.readUInt16LE(pos); pos += 2;
  const boneNamesSize = buf.readUInt32LE(pos); pos += 4;
  pos = headerStart + headerSize;

  // v4/v5 vertices are always 40 bytes: pos(12) normal(12) uv(8) tangent(4) color(4)
  const { positions, normals, uvs } = readVerts(buf, pos, numVerts, 40);
  pos += numVerts * 40;
  if (numBones > 0) pos += numVerts * 8; // skinning envelopes
  let indices = readFaces(buf, pos, numFaces);
  pos += numFaces * 12;
  if (numLODs >= 2) {
    const lods = [];
    for (let i = 0; i < numLODs; i++) { lods.push(buf.readUInt32LE(pos)); pos += 4; }
    indices = indices.subarray(lods[0] * 3, lods[1] * 3);
  }
  return { positions, normals, uvs, indices };
}

// ---------------------------------------------------------------- version 6/7 (Draco)
//
// Roblox's newest mesh format is a small "COREMESH" container wrapping a Draco-compressed
// bitstream. Every modern dynamic head is one of these, which is why importing a present-day
// avatar used to fail on the head specifically while its (older-format) body loaded fine —
// the fetch threw "Unsupported mesh version: version 7.00" and the head silently fell back to a
// placeholder, reading as a head detached from the body.
//
// three.js already ships a Draco decoder, so this reuses that rather than adding a dependency.
let dracoPromise = null;
function getDraco() {
  if (!dracoPromise) {
    dracoPromise = (async () => {
      const fs = require('fs');
      const path = require('path');
      const vm = require('vm');
      const dir = path.join(__dirname, '..', '..', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco');
      const src = fs.readFileSync(path.join(dir, 'draco_decoder.js'), 'utf8');
      // The decoder is an emscripten bundle that assigns a global; run it in its own context and
      // pick the factory back out rather than polluting this process's globals.
      const sandbox = {
        self: {}, module: { exports: {} }, exports: {}, process, require, __dirname: dir,
        console, Buffer, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, fetch,
      };
      sandbox.global = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(src, sandbox);
      return sandbox.DracoDecoderModule({});
    })();
  }
  return dracoPromise;
}

// Locate the Draco bitstream inside the container. The layout after the "version 7.00\n" line is
// "COREMESH", a u32 version, a u32 total size and a u32 chunk size, then the bitstream (which
// starts with Draco's own "DRACO" magic) — but the magic is searched for rather than assumed at a
// fixed offset, so a container that grows another field ahead of it still parses.
function findDracoChunk(buf) {
  const magic = Buffer.from('DRACO', 'latin1');
  const at = buf.indexOf(magic, 13);
  if (at < 0) throw new Error('No Draco chunk in mesh container');
  let len = buf.length - at;
  if (at >= 4) {
    const declared = buf.readUInt32LE(at - 4);
    if (declared > 16 && declared <= len) len = declared;
  }
  return buf.subarray(at, at + len);
}

async function parseDraco(buffer) {
  const draco = await getDraco();
  const chunk = findDracoChunk(buffer);
  const decoderBuffer = new draco.DecoderBuffer();
  decoderBuffer.Init(new Int8Array(chunk), chunk.length);
  const decoder = new draco.Decoder();
  const mesh = new draco.Mesh();
  try {
    const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh);
    if (!status.ok()) throw new Error('Draco decode failed: ' + status.error_msg());
    const numPoints = mesh.num_points();
    const numFaces = mesh.num_faces();

    const readAttr = (attrType, components) => {
      const id = decoder.GetAttributeId(mesh, attrType);
      if (id < 0) return null;
      const attr = decoder.GetAttribute(mesh, id);
      const out = new draco.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(mesh, attr, out);
      const arr = new Float32Array(numPoints * components);
      for (let i = 0; i < arr.length; i++) arr[i] = out.GetValue(i);
      draco.destroy(out);
      return arr;
    };

    const positions = readAttr(draco.POSITION, 3);
    if (!positions) throw new Error('Draco mesh has no POSITION attribute');
    const uvs = readAttr(draco.TEX_COORD, 2) || new Float32Array(numPoints * 2);
    // Same V flip the binary reader applies (readVerts) — Roblox stores V top-down. Missing it
    // here renders every Draco mesh's texture upside down while the older formats look right.
    for (let i = 1; i < uvs.length; i += 2) uvs[i] = 1 - uvs[i];
    let normals = readAttr(draco.NORMAL, 3);

    const indices = new Uint32Array(numFaces * 3);
    const face = new draco.DracoInt32Array();
    for (let i = 0; i < numFaces; i++) {
      decoder.GetFaceFromMesh(mesh, i, face);
      indices[i * 3] = face.GetValue(0);
      indices[i * 3 + 1] = face.GetValue(1);
      indices[i * 3 + 2] = face.GetValue(2);
    }
    draco.destroy(face);

    // Roblox's Draco meshes routinely omit normals (the engine recomputes them), so do the same.
    if (!normals) {
      normals = new Float32Array(numPoints * 3);
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
        const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
        const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
        const n = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        for (const v of [a, b, c]) {
          normals[v] += n[0]; normals[v + 1] += n[1]; normals[v + 2] += n[2];
        }
      }
      for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
      }
    }
    return { positions, normals, uvs, indices };
  } finally {
    draco.destroy(mesh);
    draco.destroy(decoder);
    draco.destroy(decoderBuffer);
  }
}

function isDracoVersion(headerLine) {
  return headerLine.startsWith('version 6') || headerLine.startsWith('version 7');
}

function parseMesh(buffer) {
  const headerLine = buffer.toString('utf8', 0, 13).split('\n')[0].trim();
  if (headerLine.startsWith('version 1')) return parseV1(buffer.toString('utf8'));
  if (headerLine.startsWith('version 2') || headerLine.startsWith('version 3')) return parseV2V3(buffer, headerLine);
  if (headerLine.startsWith('version 4') || headerLine.startsWith('version 5')) return parseV4V5(buffer, headerLine);
  if (isDracoVersion(headerLine)) {
    throw new Error(`Mesh ${headerLine} is Draco-compressed — use parseMeshAsync`);
  }
  throw new Error('Unsupported mesh version: ' + headerLine);
}

// Same contract as parseMesh, but able to handle the Draco-compressed versions too (their decoder
// initialises asynchronously). Callers that already sit in async code should prefer this.
async function parseMeshAsync(buffer) {
  const headerLine = buffer.toString('utf8', 0, 13).split('\n')[0].trim();
  if (isDracoVersion(headerLine)) return parseDraco(buffer);
  return parseMesh(buffer);
}

module.exports = { parseMesh, parseMeshAsync };
