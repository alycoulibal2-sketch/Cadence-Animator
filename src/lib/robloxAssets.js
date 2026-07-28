'use strict';
// Roblox asset (mesh/texture/asset/classic-face) fetching + disk caching. Extracted out of
// main.js so both the desktop IPC handlers (roblox:mesh etc.) and the mobile server's HTTP proxy
// routes (/api/mesh/:id etc.) share one implementation instead of two copies drifting apart.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseMeshAsync } = require('./rbxmesh');

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
    const geo = await parseMeshAsync(buf);
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

// ---------------------------------------------------------------- local Roblox content
//
// Roblox ships the real classic body/head meshes AND its own avatar-compositing meshes inside
// every Studio/Player install. Reading those is strictly better than fetching or approximating:
// they are the exact assets the engine itself renders with, they need no network and no
// authenticated session, and they cannot 401. Anything served from here is exact by definition.
let contentDirCache;
function findContentDir() {
  if (contentDirCache !== undefined) return contentDirCache;
  contentDirCache = null;
  try {
    const roots = [
      path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions'),
      'C:/Program Files (x86)/Roblox/Versions',
      'C:/Program Files/Roblox/Versions',
    ];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const v of fs.readdirSync(root)) {
        const dir = path.join(root, v, 'content');
        // Probe for a file only a real content tree has, so a half-installed/partial version
        // directory can't be picked and then fail on every read afterwards.
        if (fs.existsSync(path.join(dir, 'avatar', 'heads', 'head.mesh'))) {
          contentDirCache = dir;
          return contentDirCache;
        }
      }
    }
  } catch (_) { /* leave null — callers fall back to the web */ }
  return contentDirCache;
}

function localContentPath(relPath) {
  const dir = findContentDir();
  if (!dir) return null;
  // Confine to the content tree: these paths come from the renderer, and a "../.." in one must
  // not turn into an arbitrary file read.
  const full = path.resolve(dir, relPath);
  if (!full.startsWith(path.resolve(dir))) return null;
  return fs.existsSync(full) ? full : null;
}

const localMeshCache = new Map();
async function fetchLocalMesh(relPath) {
  if (localMeshCache.has(relPath)) return localMeshCache.get(relPath);
  const full = localContentPath(relPath);
  if (!full) return null;
  const geo = await parseMeshAsync(fs.readFileSync(full));
  const result = {
    positions: Array.from(geo.positions),
    normals: Array.from(geo.normals),
    uvs: Array.from(geo.uvs),
    indices: Array.from(geo.indices),
  };
  localMeshCache.set(relPath, result);
  return result;
}

function fetchLocalImageDataUri(relPath) {
  const full = localContentPath(relPath);
  if (!full) return null;
  const buf = fs.readFileSync(full);
  const mime = buf[0] === 0x89 ? 'image/png' : (buf[0] === 0xff ? 'image/jpeg' : 'application/octet-stream');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function localContentStatus() {
  return { dir: findContentDir() };
}

// Classic smiley face from the local Roblox Studio install — see rigbuild.js's headFaceFallback.
function getClassicFaceDataUri() {
  return fetchLocalImageDataUri(path.join('textures', 'face.png'));
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
  findContentDir,
  fetchLocalMesh,
  fetchLocalImageDataUri,
  localContentStatus,
};
