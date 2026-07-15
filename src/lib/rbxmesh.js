'use strict';
// Parser for Roblox mesh asset formats (version 1.xx text, 2.00/3.xx/4.xx/5.00 binary).
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

function parseMesh(buffer) {
  const headerLine = buffer.toString('utf8', 0, 13).split('\n')[0].trim();
  if (headerLine.startsWith('version 1')) return parseV1(buffer.toString('utf8'));
  if (headerLine.startsWith('version 2') || headerLine.startsWith('version 3')) return parseV2V3(buffer, headerLine);
  if (headerLine.startsWith('version 4') || headerLine.startsWith('version 5')) return parseV4V5(buffer, headerLine);
  throw new Error('Unsupported mesh version: ' + headerLine);
}

module.exports = { parseMesh };
