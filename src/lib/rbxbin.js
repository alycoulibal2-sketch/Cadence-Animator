'use strict';
// Parser for Roblox binary model files (.rbxm / .rbxl binary format).
// Produces a simplified instance tree: { className, name, props: {}, children: [] }.
// Reference: rbx-dom binary format spec.

let fzstd = null;
try { fzstd = require('fzstd'); } catch (_) { /* zstd chunks unsupported without fzstd */ }

const MAGIC = Buffer.from('<roblox!', 'binary');

// ---------- LZ4 block decompression ----------
function lz4Decompress(src, destLen) {
  const dst = Buffer.allocUnsafe(destLen);
  let sIdx = 0, dIdx = 0;
  while (sIdx < src.length && dIdx < destLen) {
    const token = src[sIdx++];
    let litLen = token >> 4;
    if (litLen === 15) {
      let b;
      do { b = src[sIdx++]; litLen += b; } while (b === 255);
    }
    src.copy(dst, dIdx, sIdx, sIdx + litLen);
    sIdx += litLen; dIdx += litLen;
    if (sIdx >= src.length) break; // last block ends with literals
    const offset = src[sIdx] | (src[sIdx + 1] << 8);
    sIdx += 2;
    let matchLen = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      let b;
      do { b = src[sIdx++]; matchLen += b; } while (b === 255);
    }
    let mIdx = dIdx - offset;
    for (let i = 0; i < matchLen; i++) dst[dIdx++] = dst[mIdx++];
  }
  return dst;
}

// ---------- byte-interleaved helpers ----------
function deinterleave(buf, count, width) {
  // buf holds `count` values of `width` bytes, byte-interleaved (transposed).
  const out = Buffer.allocUnsafe(count * width);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < width; j++) {
      out[i * width + j] = buf[j * count + i];
    }
  }
  return out;
}

function readInterleavedI32(buf, offset, count) {
  const raw = deinterleave(buf.subarray(offset, offset + count * 4), count, 4);
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const u = raw.readUInt32BE(i * 4);
    // zigzag decode
    out[i] = (u >>> 1) ^ -(u & 1);
  }
  return out;
}

function readInterleavedU32(buf, offset, count) {
  const raw = deinterleave(buf.subarray(offset, offset + count * 4), count, 4);
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = raw.readUInt32BE(i * 4);
  return out;
}

const f32View = new DataView(new ArrayBuffer(4));
function robloxFloat(u) {
  // Roblox float: IEEE-754 bits rotated left 1 (sign bit at LSB)
  const bits = ((u >>> 1) | ((u & 1) << 31)) >>> 0;
  f32View.setUint32(0, bits);
  return f32View.getFloat32(0);
}

function readInterleavedF32(buf, offset, count) {
  const raw = deinterleave(buf.subarray(offset, offset + count * 4), count, 4);
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = robloxFloat(raw.readUInt32BE(i * 4));
  return out;
}

function readReferents(buf, offset, count) {
  const vals = readInterleavedI32(buf, offset, count);
  let acc = 0;
  for (let i = 0; i < count; i++) { acc += vals[i]; vals[i] = acc; }
  return vals;
}

// Axis-aligned rotation ID table (orient ids used by binary CFrame type)
const ROT_IDS = {
  0x02: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  0x03: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  0x05: [1, 0, 0, 0, -1, 0, 0, 0, -1],
  0x06: [1, 0, 0, 0, 0, 1, 0, -1, 0],
  0x07: [0, 1, 0, 1, 0, 0, 0, 0, -1],
  0x09: [0, 0, 1, 1, 0, 0, 0, 1, 0],
  0x0a: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  0x0c: [0, 0, -1, 1, 0, 0, 0, -1, 0],
  0x0d: [0, 1, 0, 0, 0, 1, 1, 0, 0],
  0x0e: [0, 0, -1, 0, 1, 0, 1, 0, 0],
  0x10: [0, -1, 0, 0, 0, -1, 1, 0, 0],
  0x11: [0, 0, 1, 0, -1, 0, 1, 0, 0],
  0x14: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  0x15: [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  0x17: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  0x18: [-1, 0, 0, 0, 0, -1, 0, -1, 0],
  0x19: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  0x1b: [0, 0, -1, -1, 0, 0, 0, 1, 0],
  0x1c: [0, -1, 0, -1, 0, 0, 0, 0, -1],
  0x1e: [0, 0, 1, -1, 0, 0, 0, -1, 0],
  0x1f: [0, 1, 0, 0, 0, -1, -1, 0, 0],
  0x20: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  0x22: [0, -1, 0, 0, 0, 1, -1, 0, 0],
  0x23: [0, 0, -1, 0, -1, 0, -1, 0, 0],
};

function parse(buffer) {
  if (!buffer.subarray(0, 8).equals(MAGIC)) {
    throw new Error('Not a Roblox binary file (bad magic). If this is XML (.rbxmx), use the XML parser.');
  }
  let pos = 8 + 6 + 2; // magic + signature + version
  const numClasses = buffer.readInt32LE(pos); pos += 4;
  const numInstances = buffer.readInt32LE(pos); pos += 4;
  pos += 8; // reserved

  const classes = {};       // classId -> { className, referents: [] }
  const instances = {};     // referent -> node
  const sharedStrings = [];
  let parentPairs = null;

  while (pos < buffer.length) {
    const name = buffer.toString('binary', pos, pos + 4); pos += 4;
    const compressedLen = buffer.readUInt32LE(pos); pos += 4;
    const uncompressedLen = buffer.readUInt32LE(pos); pos += 4;
    pos += 4; // reserved
    let data;
    if (compressedLen === 0) {
      data = buffer.subarray(pos, pos + uncompressedLen);
      pos += uncompressedLen;
    } else {
      const comp = buffer.subarray(pos, pos + compressedLen);
      pos += compressedLen;
      if (comp[0] === 0x28 && comp[1] === 0xb5 && comp[2] === 0x2f && comp[3] === 0xfd) {
        if (!fzstd) throw new Error('File uses zstd compression but fzstd module is unavailable');
        data = Buffer.from(fzstd.decompress(new Uint8Array(comp)));
      } else {
        data = lz4Decompress(comp, uncompressedLen);
      }
    }
    if (name === 'END\0') break;
    try {
      if (name === 'SSTR') parseSSTR(data, sharedStrings);
      else if (name === 'INST') parseINST(data, classes, instances);
      else if (name === 'PROP') parsePROP(data, classes, instances, sharedStrings);
      else if (name === 'PRNT') parentPairs = parsePRNT(data);
    } catch (e) {
      // Skip malformed/unsupported chunks rather than failing the whole file
      if (name === 'INST' || name === 'PRNT') throw e;
    }
  }

  // Build tree
  const roots = [];
  if (parentPairs) {
    for (const [childRef, parentRef] of parentPairs) {
      const child = instances[childRef];
      if (!child) continue;
      if (parentRef === -1 || !instances[parentRef]) roots.push(child);
      else instances[parentRef].children.push(child);
    }
  } else {
    for (const ref of Object.keys(instances)) roots.push(instances[ref]);
  }
  return { roots, numInstances, numClasses };
}

function readString(buf, pos) {
  const len = buf.readUInt32LE(pos);
  return [buf.toString('utf8', pos + 4, pos + 4 + len), pos + 4 + len];
}

function parseSSTR(data, out) {
  let pos = 4; // version
  const count = data.readUInt32LE(pos); pos += 4;
  for (let i = 0; i < count; i++) {
    pos += 16; // md5
    const [str, next] = readString(data, pos);
    out.push(str);
    pos = next;
  }
}

function parseINST(data, classes, instances) {
  let pos = 0;
  const classId = data.readUInt32LE(pos); pos += 4;
  let className; [className, pos] = readString(data, pos);
  pos += 1; // object format
  const count = data.readUInt32LE(pos); pos += 4;
  const refs = readReferents(data, pos, count);
  classes[classId] = { className, referents: refs };
  for (const ref of refs) {
    instances[ref] = { referent: ref, className, name: className, props: {}, children: [] };
  }
}

function parsePRNT(data) {
  let pos = 1; // version
  const count = data.readUInt32LE(pos); pos += 4;
  const children = readReferents(data, pos, count); pos += count * 4;
  const parents = readReferents(data, pos, count);
  const pairs = [];
  for (let i = 0; i < count; i++) pairs.push([children[i], parents[i]]);
  return pairs;
}

function parsePROP(data, classes, instances, sharedStrings) {
  let pos = 0;
  const classId = data.readUInt32LE(pos); pos += 4;
  let propName; [propName, pos] = readString(data, pos);
  const typeId = data[pos]; pos += 1;
  const cls = classes[classId];
  if (!cls) return;
  const refs = cls.referents;
  const n = refs.length;
  const values = new Array(n);

  switch (typeId) {
    case 0x01: { // String
      for (let i = 0; i < n; i++) {
        const len = data.readUInt32LE(pos);
        // Binary content (e.g. embedded meshes) kept as base64; text kept as string
        const raw = data.subarray(pos + 4, pos + 4 + len);
        values[i] = raw.toString('utf8');
        pos += 4 + len;
      }
      break;
    }
    case 0x02: { // Bool
      for (let i = 0; i < n; i++) values[i] = data[pos + i] !== 0;
      break;
    }
    case 0x03: { // Int32
      const v = readInterleavedI32(data, pos, n);
      for (let i = 0; i < n; i++) values[i] = v[i];
      break;
    }
    case 0x04: { // Float32
      const v = readInterleavedF32(data, pos, n);
      for (let i = 0; i < n; i++) values[i] = v[i];
      break;
    }
    case 0x05: { // Float64
      for (let i = 0; i < n; i++) values[i] = data.readDoubleLE(pos + i * 8);
      break;
    }
    case 0x0b: { // BrickColor
      const v = readInterleavedU32(data, pos, n);
      for (let i = 0; i < n; i++) values[i] = v[i];
      break;
    }
    case 0x0c: { // Color3
      const r = readInterleavedF32(data, pos, n);
      const g = readInterleavedF32(data, pos + n * 4, n);
      const b = readInterleavedF32(data, pos + n * 8, n);
      for (let i = 0; i < n; i++) values[i] = { r: r[i], g: g[i], b: b[i] };
      break;
    }
    case 0x0e: { // Vector3
      const x = readInterleavedF32(data, pos, n);
      const y = readInterleavedF32(data, pos + n * 4, n);
      const z = readInterleavedF32(data, pos + n * 8, n);
      for (let i = 0; i < n; i++) values[i] = { x: x[i], y: y[i], z: z[i] };
      break;
    }
    case 0x10: { // CFrame
      const rots = new Array(n);
      for (let i = 0; i < n; i++) {
        const rotId = data[pos]; pos += 1;
        if (rotId === 0) {
          const m = new Array(9);
          for (let j = 0; j < 9; j++) { m[j] = data.readFloatLE(pos); pos += 4; }
          rots[i] = m;
        } else {
          rots[i] = ROT_IDS[rotId] || [1, 0, 0, 0, 1, 0, 0, 0, 1];
        }
      }
      const x = readInterleavedF32(data, pos, n);
      const y = readInterleavedF32(data, pos + n * 4, n);
      const z = readInterleavedF32(data, pos + n * 8, n);
      for (let i = 0; i < n; i++) {
        const m = rots[i];
        values[i] = { cf: [x[i], y[i], z[i], m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]] };
      }
      break;
    }
    case 0x12: { // Enum
      const v = readInterleavedU32(data, pos, n);
      for (let i = 0; i < n; i++) values[i] = v[i];
      break;
    }
    case 0x13: { // Referent (instance ref)
      const v = readReferents(data, pos, n);
      for (let i = 0; i < n; i++) values[i] = { ref: v[i] };
      break;
    }
    case 0x1b: { // Color3uint8
      for (let i = 0; i < n; i++) {
        values[i] = { r: data[pos + i] / 255, g: data[pos + n + i] / 255, b: data[pos + 2 * n + i] / 255 };
      }
      break;
    }
    case 0x1c: { // Int64
      const raw = deinterleave(data.subarray(pos, pos + n * 8), n, 8);
      for (let i = 0; i < n; i++) {
        const u = raw.readBigUInt64BE(i * 8);
        values[i] = Number((u >> 1n) ^ -(u & 1n));
      }
      break;
    }
    case 0x1d: { // SharedString
      const v = readInterleavedU32(data, pos, n);
      for (let i = 0; i < n; i++) values[i] = sharedStrings[v[i]] ?? '';
      break;
    }
    default:
      return; // unsupported type: skip this property entirely
  }

  for (let i = 0; i < n; i++) {
    const inst = instances[refs[i]];
    if (!inst) continue;
    if (propName === 'Name' && typeof values[i] === 'string') inst.name = values[i];
    inst.props[propName] = values[i];
  }

  // resolve refs lazily: mark for post-processing
  if (typeId === 0x13) {
    for (let i = 0; i < n; i++) {
      const inst = instances[refs[i]];
      if (inst) inst.props[propName] = { __ref: values[i].ref };
    }
  }
}

module.exports = { parse };
