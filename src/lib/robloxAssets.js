'use strict';
// Roblox asset (mesh/texture/asset/classic-face) fetching + disk caching. Extracted out of
// main.js so both the desktop IPC handlers (roblox:mesh etc.) and the mobile server's HTTP proxy
// routes (/api/mesh/:id etc.) share one implementation instead of two copies drifting apart.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseMesh } = require('./rbxmesh');

const userData = () => app.getPath('userData');
const cacheDir = (sub) => {
  const d = path.join(userData(), 'cache', sub);
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch (e) {
    // A locked/permission-denied cache folder shouldn't break asset fetching — every caller
    // below already treats "not on disk" as a cache miss and falls back to fetching fresh.
    console.error('cache dir unavailable, continuing without disk cache:', d, e.message);
  }
  return d;
};

async function robloxFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CadenceAnimator/0.1' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function normalizeAssetId(idOrUrl) {
  if (typeof idOrUrl === 'number') return String(idOrUrl);
  const s = String(idOrUrl).trim();
  const m = s.match(/(\d{4,})/);
  return m ? m[1] : null;
}

function assetUrl(id) {
  return `https://assetdelivery.roblox.com/v1/asset/?id=${id}`;
}

const meshMemCache = new Map();
async function fetchMeshData(meshIdOrUrl) {
  const id = normalizeAssetId(meshIdOrUrl);
  if (!id) throw new Error('Bad mesh id: ' + meshIdOrUrl);
  if (meshMemCache.has(id)) return meshMemCache.get(id);
  const diskPath = path.join(cacheDir('mesh'), `${id}.json`);
  let result;
  if (fs.existsSync(diskPath)) {
    result = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
  } else {
    const buf = await robloxFetch(assetUrl(id));
    const geo = parseMesh(buf);
    result = {
      positions: Array.from(geo.positions),
      normals: Array.from(geo.normals),
      uvs: Array.from(geo.uvs),
      indices: Array.from(geo.indices),
    };
    try { fs.writeFileSync(diskPath, JSON.stringify(result)); } catch (_) { /* disk cache best-effort only */ }
  }
  meshMemCache.set(id, result);
  return result;
}

async function fetchTextureDataUri(texIdOrUrl) {
  const id = normalizeAssetId(texIdOrUrl);
  if (!id) throw new Error('Bad texture id: ' + texIdOrUrl);
  const diskPath = path.join(cacheDir('tex'), `${id}.bin`);
  let buf;
  if (fs.existsSync(diskPath)) buf = fs.readFileSync(diskPath);
  else {
    buf = await robloxFetch(assetUrl(id));
    try { fs.writeFileSync(diskPath, buf); } catch (_) { /* disk cache best-effort only */ }
  }
  const mime = buf[0] === 0x89 ? 'image/png' : (buf[0] === 0xff ? 'image/jpeg' : 'application/octet-stream');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function fetchAssetBase64(idOrUrl) {
  const id = normalizeAssetId(idOrUrl);
  if (!id) throw new Error('Could not parse an asset id from: ' + idOrUrl);
  const buf = await robloxFetch(assetUrl(id));
  return { id, base64: buf.toString('base64') };
}

// Classic smiley face from the local Roblox Studio install — see rigbuild.js's headFaceFallback.
// Reads straight off disk so it never depends on an authenticated Roblox web session.
function getClassicFaceDataUri() {
  try {
    const versionsDirs = [
      path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions'),
      'C:/Program Files (x86)/Roblox/Versions',
      'C:/Program Files/Roblox/Versions',
    ];
    for (const vd of versionsDirs) {
      if (!fs.existsSync(vd)) continue;
      for (const v of fs.readdirSync(vd)) {
        const facePath = path.join(vd, v, 'content', 'textures', 'face.png');
        if (fs.existsSync(facePath)) {
          return 'data:image/png;base64,' + fs.readFileSync(facePath).toString('base64');
        }
      }
    }
  } catch (_) { /* fall through to null */ }
  return null;
}

module.exports = {
  cacheDir,
  robloxFetch,
  normalizeAssetId,
  assetUrl,
  fetchMeshData,
  fetchTextureDataUri,
  fetchAssetBase64,
  getClassicFaceDataUri,
};
