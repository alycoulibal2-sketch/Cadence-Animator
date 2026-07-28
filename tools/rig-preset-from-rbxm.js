#!/usr/bin/env node
'use strict';
// Regenerate a builtin rig preset straight from a .rbxm exported out of Roblox Studio.
//
// The builtin presets in rigs/builtin.json used to be hand-captured, and drifted from what
// Studio's Rig Builder actually produces (wrong mesh ids, wrong part sizes, a Head modelled as a
// MeshPart when Studio uses Part + SpecialMesh). Transcribing 16 parts x 12 CFrame numbers by hand
// is exactly the kind of thing that silently goes wrong, so this reads the real rig instead.
//
//   1. In Studio: build the rig (Avatar > Rig Builder), then export it, e.g. via the MCP
//      export_rbxm tool or SerializationService:SerializeInstancesAsync.
//   2. node tools/rig-preset-from-rbxm.js <file.rbxm> <ModelName>=<presetKey> [...] > out.json
//      e.g. node tools/rig-preset-from-rbxm.js rigs.rbxm R6=r6 R15=r15
//   3. Merge the printed JSON into rigs/builtin.json.
//
// Output matches the schema rigbuild.js/state.js consume: parts carry a root-relative `cf`
// (flat 12: x,y,z then the row-major 3x3), joints carry Motor6D C0/C1 in the same layout.

const fs = require('fs');
const path = require('path');
const { parse } = require('../src/lib/rbxbin');

// ---------------------------------------------------------------- flat-12 CFrame helpers
const IDENTITY = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

function cfInverse(a) {
  const [x, y, z, m0, m1, m2, m3, m4, m5, m6, m7, m8] = a;
  // rotation part is orthonormal, so the inverse is the transpose
  return [
    -(m0 * x + m3 * y + m6 * z),
    -(m1 * x + m4 * y + m7 * z),
    -(m2 * x + m5 * y + m8 * z),
    m0, m3, m6,
    m1, m4, m7,
    m2, m5, m8,
  ];
}

function cfMul(a, b) {
  const [ax, ay, az, a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [bx, by, bz, b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return [
    ax + a0 * bx + a1 * by + a2 * bz,
    ay + a3 * bx + a4 * by + a5 * bz,
    az + a6 * bx + a7 * by + a8 * bz,
    a0 * b0 + a1 * b3 + a2 * b6, a0 * b1 + a1 * b4 + a2 * b7, a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6, a3 * b1 + a4 * b4 + a5 * b7, a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6, a6 * b1 + a7 * b4 + a8 * b7, a6 * b2 + a7 * b5 + a8 * b8,
  ];
}

// Studio hands back float32 noise (1.1920928955078125e-7 where 0 is meant, 0.9999996 where 1 is).
// Snap that away: it is not real rig data, and left in it makes every diff of this file unreadable.
const EPS = 2e-4;
function clean(v) {
  if (!Number.isFinite(v)) return 0;
  const nearest = Math.round(v);
  if (Math.abs(v - nearest) < EPS) return nearest === 0 ? 0 : nearest;
  const half = Math.round(v * 2) / 2;
  if (Math.abs(v - half) < EPS) return half;
  return +v.toFixed(5);
}
const cleanCf = (cf) => cf.map(clean);

// ---------------------------------------------------------------- Roblox enum decoding
const SHAPE_NAMES = { 0: 'Ball', 1: 'Block', 2: 'Cylinder', 3: 'Wedge', 4: 'CornerWedge' };
const MESHTYPE_NAMES = {
  0: 'Head', 1: 'Torso', 2: 'Wedge', 3: 'Prism', 4: 'Pyramid', 5: 'ParallelRamp',
  6: 'RightAngleRamp', 7: 'CornerWedge', 8: 'Brick', 9: 'Sphere', 10: 'Cylinder', 11: 'FileMesh',
};
const NORMALID_NAMES = { 0: 'Right', 1: 'Top', 2: 'Back', 3: 'Left', 4: 'Bottom', 5: 'Front' };
const MATERIAL_NAMES = {
  256: 'Plastic', 272: 'SmoothPlastic', 288: 'Neon', 512: 'Wood', 528: 'WoodPlanks',
  784: 'Marble', 788: 'Basalt', 800: 'Slate', 804: 'CrackedLava', 816: 'Concrete',
  820: 'Limestone', 832: 'Granite', 836: 'Pavement', 848: 'Brick', 864: 'Pebble',
  880: 'Cobblestone', 896: 'Rock', 912: 'Sandstone', 946: 'Sand', 1040: 'Metal',
  1056: 'CorrodedMetal', 1072: 'DiamondPlate', 1088: 'Foil', 1104: 'Salt', 1280: 'Grass',
  1296: 'LeafyGrass', 1312: 'Ground', 1328: 'Mud', 1344: 'Snow', 1360: 'Asphalt',
  1392: 'Glacier', 1536: 'Glass', 1552: 'ForceField', 1568: 'Ice', 1584: 'Water',
  1792: 'Fabric', 1808: 'Leather', 1824: 'Cardboard', 1840: 'Carpet', 1856: 'Plaster',
  1872: 'Rubber',
};

const BASEPART = new Set(['Part', 'MeshPart', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'UnionOperation', 'Seat', 'VehicleSeat', 'SpawnLocation']);

function prop(node, ...names) {
  for (const n of names) if (node.props[n] !== undefined) return node.props[n];
  return undefined;
}
function hex(c) {
  if (!c) return '#A3A2A5';
  const b = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${b(c.r)}${b(c.g)}${b(c.b)}`;
}
function assetId(v) {
  const m = String(v || '').match(/(\d{4,})/);
  return m ? m[1] : '';
}

function walk(nodes, fn) {
  for (const n of nodes) { fn(n); walk(n.children || [], fn); }
}

// ---------------------------------------------------------------- preset builder
function buildPreset(modelNode, presetKey) {
  const partNodes = [];
  const motorNodes = [];
  const byRef = new Map();
  walk([modelNode], (n) => {
    if (n.referent !== undefined) byRef.set(n.referent, n);
    if (BASEPART.has(n.className)) partNodes.push(n);
    else if (n.className === 'Motor6D' || n.className === 'Motor') motorNodes.push(n);
  });
  if (!partNodes.length) throw new Error(`no parts in "${modelNode.name}"`);

  const resolve = (v) => (v && v.__ref !== undefined ? byRef.get(v.__ref) : null);

  const root = partNodes.find((p) => p.name === 'HumanoidRootPart') || partNodes[0];
  const invRoot = cfInverse(prop(root, 'CFrame')?.cf || IDENTITY);

  const defByName = new Map();
  for (const pn of partNodes) {
    const size = prop(pn, 'size', 'Size') || { x: 1, y: 1, z: 1 };
    const def = {
      id: pn.name,
      name: pn.name,
      className: pn.className === 'MeshPart' ? 'MeshPart' : 'Part',
      size: [clean(size.x), clean(size.y), clean(size.z)],
      cf: cleanCf(cfMul(invRoot, prop(pn, 'CFrame')?.cf || IDENTITY)),
      color: hex(prop(pn, 'Color3uint8', 'Color')),
      transparency: clean(prop(pn, 'Transparency') || 0),
    };
    const mat = MATERIAL_NAMES[prop(pn, 'material', 'Material')];
    if (mat && mat !== 'Plastic') def.material = mat;
    if (pn.className === 'MeshPart') {
      def.meshId = assetId(prop(pn, 'MeshId', 'MeshID'));
      const tex = assetId(prop(pn, 'TextureID', 'TextureId'));
      if (tex) def.textureId = tex;
    } else {
      def.shape = SHAPE_NAMES[prop(pn, 'shape', 'Shape')] || 'Block';
    }
    const sm = (pn.children || []).find((c) => c.className === 'SpecialMesh');
    if (sm) {
      const scale = prop(sm, 'Scale') || { x: 1, y: 1, z: 1 };
      const offset = prop(sm, 'Offset') || { x: 0, y: 0, z: 0 };
      def.specialMesh = {
        meshType: MESHTYPE_NAMES[prop(sm, 'MeshType') ?? 6] || 'Brick',
        meshId: prop(sm, 'MeshId') || '',
        textureId: prop(sm, 'TextureId') || '',
        scale: [clean(scale.x), clean(scale.y), clean(scale.z)],
        offset: [clean(offset.x), clean(offset.y), clean(offset.z)],
      };
    }
    // A Front-facing decal is the rig's face — the same single-string convention rigbuild.js's
    // faceDecal path already expects. Anything on another face goes through the generic list.
    const decals = (pn.children || []).filter((c) => c.className === 'Decal' && prop(c, 'Texture'));
    const front = decals.find((c) => (prop(c, 'Face') ?? 5) === 5);
    if (front) def.faceDecal = prop(front, 'Texture');
    const others = decals.filter((c) => c !== front);
    if (others.length) {
      def.decals = others.map((c) => ({
        face: NORMALID_NAMES[prop(c, 'Face') ?? 5] || 'Front',
        texture: prop(c, 'Texture') || '',
        transparency: clean(prop(c, 'Transparency') || 0),
      }));
    }
    defByName.set(pn.name, def);
  }

  const joints = [];
  for (const m of motorNodes) {
    const p0 = resolve(prop(m, 'Part0'));
    const p1 = resolve(prop(m, 'Part1'));
    if (!p0 || !p1 || !defByName.has(p0.name) || !defByName.has(p1.name)) continue;
    joints.push({
      name: m.name,
      part0: p0.name,
      part1: p1.name,
      c0: cleanCf(prop(m, 'C0')?.cf || IDENTITY),
      c1: cleanCf(prop(m, 'C1')?.cf || IDENTITY),
    });
  }

  // Emit parts root-first then in joint order, so the file reads like the skeleton it describes
  // (the solver computes its own order, this is purely for humans reading the JSON).
  const ordered = [defByName.get(root.name)];
  const seen = new Set([root.name]);
  let queue = [root.name];
  while (queue.length) {
    const next = [];
    for (const parent of queue) {
      for (const j of joints) {
        if (j.part0 === parent && !seen.has(j.part1)) {
          seen.add(j.part1);
          ordered.push(defByName.get(j.part1));
          next.push(j.part1);
        }
      }
    }
    queue = next;
  }
  for (const [name, def] of defByName) if (!seen.has(name)) ordered.push(def);

  return {
    key: presetKey,
    preset: {
      name: modelNode.name,
      rigType: modelNode.name,
      rootPart: root.name,
      parts: ordered,
      joints,
    },
  };
}

// ---------------------------------------------------------------- cli
function main() {
  const [file, ...pairs] = process.argv.slice(2);
  if (!file || !pairs.length) {
    console.error('usage: node tools/rig-preset-from-rbxm.js <file.rbxm> <ModelName>=<presetKey> [...]');
    process.exit(1);
  }
  const tree = parse(fs.readFileSync(path.resolve(file)));
  const models = [];
  walk(tree.roots, (n) => { if (n.className === 'Model') models.push(n); });

  const out = {};
  for (const pair of pairs) {
    const [modelName, key] = pair.split('=');
    const model = models.find((m) => m.name === modelName);
    if (!model) throw new Error(`model "${modelName}" not found (have: ${models.map((m) => m.name).join(', ')})`);
    const { preset } = buildPreset(model, key);
    out[key] = preset;
    console.error(`${key}: ${preset.parts.length} parts, ${preset.joints.length} joints (root ${preset.rootPart})`);
  }
  process.stdout.write(JSON.stringify(out, null, 2));
}

main();
