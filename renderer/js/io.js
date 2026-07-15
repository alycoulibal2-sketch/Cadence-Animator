// Import/export: .rbxmx XML parsing, rig extraction from model trees,
// KeyframeSequence import (files, AnimSaves, bridge), KeyframeSequence export.
import * as CF from './cf.js';
import * as S from './state.js';
import { needsBaking, evalSegment } from './easing.js';

// ---------------------------------------------------------------- XML (.rbxmx)
export function parseRbxmx(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not parse XML model file');
  const byRef = new Map();
  const parseItem = (el) => {
    const node = { className: el.getAttribute('class'), name: el.getAttribute('class'), props: {}, children: [] };
    const ref = el.getAttribute('referent');
    if (ref) byRef.set(ref, node);
    for (const child of el.children) {
      if (child.tagName === 'Properties') {
        for (const p of child.children) {
          const name = p.getAttribute('name');
          const v = parseProp(p);
          if (v !== undefined) node.props[name] = v;
          if (name === 'Name' && typeof v === 'string') node.name = v;
        }
      } else if (child.tagName === 'Item') {
        node.children.push(parseItem(child));
      }
    }
    return node;
  };
  const roots = [];
  for (const item of doc.documentElement.children) {
    if (item.tagName === 'Item') roots.push(parseItem(item));
  }
  // resolve refs
  const resolve = (node) => {
    for (const [k, v] of Object.entries(node.props)) {
      if (v && typeof v === 'object' && v.__xmlref) {
        const target = byRef.get(v.__xmlref);
        node.props[k] = target ? { refName: target.name, refNode: target } : null;
      }
    }
    node.children.forEach(resolve);
  };
  roots.forEach(resolve);
  return roots;
}

function num(el, tag) {
  const c = el.querySelector(`:scope > ${tag}`);
  return c ? parseFloat(c.textContent) : 0;
}

function parseProp(p) {
  switch (p.tagName) {
    case 'string': case 'ProtectedString': case 'BinaryString': return p.textContent;
    case 'bool': return p.textContent.trim() === 'true';
    case 'float': case 'double': case 'int': case 'int64': case 'token': return parseFloat(p.textContent);
    case 'Vector3': return { x: num(p, 'X'), y: num(p, 'Y'), z: num(p, 'Z') };
    case 'CoordinateFrame': case 'CFrame':
      return {
        cf: [num(p, 'X'), num(p, 'Y'), num(p, 'Z'),
        num(p, 'R00'), num(p, 'R01'), num(p, 'R02'),
        num(p, 'R10'), num(p, 'R11'), num(p, 'R12'),
        num(p, 'R20'), num(p, 'R21'), num(p, 'R22')],
      };
    case 'Color3uint8': {
      const v = parseInt(p.textContent, 10) >>> 0;
      return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
    }
    case 'Color3':
      return { r: num(p, 'R'), g: num(p, 'G'), b: num(p, 'B') };
    case 'Content': {
      const url = p.querySelector(':scope > url');
      return url ? url.textContent : '';
    }
    case 'Ref': {
      const t = p.textContent.trim();
      return t && t !== 'null' ? { __xmlref: t } : null;
    }
    default: return undefined;
  }
}

// ---------------------------------------------------------------- tree helpers
export function walkTree(nodes, fn) {
  for (const n of nodes) {
    fn(n);
    walkTree(n.children, fn);
  }
}
export function findByClass(nodes, className) {
  const out = [];
  walkTree(nodes, (n) => { if (n.className === className) out.push(n); });
  return out;
}

const BASEPART_CLASSES = new Set(['Part', 'MeshPart', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'UnionOperation', 'Seat', 'VehicleSeat', 'SpawnLocation']);
const MOTOR_CLASSES = new Set(['Motor6D', 'Motor']);
const WELD_CLASSES = new Set(['Weld', 'ManualWeld', 'Snap', 'ManualGlue', 'Glue']);

function prop(node, ...names) {
  for (const n of names) {
    if (node.props[n] !== undefined) return node.props[n];
  }
  // case-insensitive fallback
  const lower = names.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(node.props)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return undefined;
}

function colorHex(c) {
  if (!c) return '#A3A2A5';
  const h = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

const SHAPE_NAMES = ['Ball', 'Block', 'Cylinder', 'Wedge', 'CornerWedge'];
const MESHTYPE_NAMES = ['Head', 'Torso', 'Wedge', 'Sphere', 'Cylinder', 'FileMesh', 'Brick', 'Prism', 'Pyramid', 'ParallelRamp', 'RightAngleRamp', 'CornerWedge'];
const NORMALID_FRONT = 5;
const NORMALID_NAMES = ['Right', 'Top', 'Back', 'Left', 'Bottom', 'Front'];
// Enum.Material's numeric Values, straight from Roblox's own docs — needed because the binary/XML
// property is stored as a bare integer token, unlike the Studio bridge which reads p.Material.Name
// directly with no guessing involved.
const MATERIAL_NAMES = {
  256: 'Plastic', 272: 'SmoothPlastic', 288: 'Neon',
  512: 'Wood', 528: 'WoodPlanks',
  784: 'Marble', 788: 'Basalt', 800: 'Slate', 804: 'CrackedLava', 816: 'Concrete', 820: 'Limestone',
  832: 'Granite', 836: 'Pavement', 848: 'Brick', 864: 'Pebble', 880: 'Cobblestone', 896: 'Rock', 912: 'Sandstone',
  1040: 'CorrodedMetal', 1056: 'DiamondPlate', 1072: 'Foil', 1088: 'Metal',
  1280: 'Grass', 1284: 'LeafyGrass', 1296: 'Sand', 1312: 'Fabric', 1328: 'Snow', 1344: 'Mud', 1360: 'Ground',
  1376: 'Asphalt', 1392: 'Salt',
  1536: 'Ice', 1552: 'Glacier', 1568: 'Glass', 1584: 'ForceField',
  1792: 'Air', 2048: 'Water',
  2304: 'Cardboard', 2305: 'Carpet', 2306: 'CeramicTiles', 2307: 'ClayRoofTiles', 2308: 'RoofShingles',
  2309: 'Leather', 2310: 'Plaster', 2311: 'Rubber',
};

// ---------------------------------------------------------------- rig from a model tree
// Deep hierarchies are fine: we walk EVERY descendant (no 3-layer limit),
// and parts get unique ids so name collisions can't corrupt anything.
export function rigFromModelTree(modelNode) {
  const partNodes = [];
  const motorNodes = [];
  const weldNodes = [];
  walkTree([modelNode], (n) => {
    if (BASEPART_CLASSES.has(n.className)) partNodes.push(n);
    else if (MOTOR_CLASSES.has(n.className)) motorNodes.push(n);
    else if (WELD_CLASSES.has(n.className) || n.className === 'WeldConstraint') weldNodes.push(n);
  });
  if (!partNodes.length) throw new Error(`No parts found in "${modelNode.name}"`);

  const idByNode = new Map();
  const usedIds = new Set();
  const parts = [];
  for (const pn of partNodes) {
    let id = pn.name;
    let i = 2;
    while (usedIds.has(id)) id = `${pn.name}#${i++}`;
    usedIds.add(id);
    idByNode.set(pn, id);
  }

  // resolve a Ref prop to a part node (binary gives {refId}; xml gives {refNode})
  const nodeByBinaryRef = new Map();
  walkTree([modelNode], (n) => { if (n.props.__binref !== undefined) nodeByBinaryRef.set(n.props.__binref, n); });
  const resolveRef = (v) => {
    if (!v) return null;
    if (v.refNode) return v.refNode;
    if (v.refId !== undefined) {
      // binary path: true instance identity via the referent id carried across IPC — required
      // whenever two parts share a name (e.g. duplicate default "Part"s), since a name match
      // alone can't tell them apart and would wire a Motor6D/Weld to the wrong instance.
      const byId = nodeByBinaryRef.get(v.refId);
      if (byId) return byId;
    }
    if (v.refName !== undefined) {
      // last-resort fallback if the id lookup ever misses (e.g. ref points outside this model)
      const matches = partNodes.filter((p) => p.name === v.refName);
      return matches[0] || null;
    }
    return null;
  };

  const joints = [];
  for (const m of motorNodes) {
    const p0 = resolveRef(prop(m, 'Part0'));
    const p1 = resolveRef(prop(m, 'Part1'));
    if (!p0 || !p1 || !idByNode.has(p0) || !idByNode.has(p1)) continue;
    joints.push({
      name: m.name,
      part0: idByNode.get(p0),
      part1: idByNode.get(p1),
      c0: prop(m, 'C0')?.cf || CF.IDENTITY.slice(),
      c1: prop(m, 'C1')?.cf || CF.IDENTITY.slice(),
    });
  }
  for (const wnode of weldNodes) {
    const p0 = resolveRef(prop(wnode, 'Part0'));
    const p1 = resolveRef(prop(wnode, 'Part1'));
    if (!p0 || !p1 || !idByNode.has(p0) || !idByNode.has(p1)) continue;
    let c0 = prop(wnode, 'C0')?.cf;
    let c1 = prop(wnode, 'C1')?.cf;
    if (wnode.className === 'WeldConstraint' || !c0) {
      const cf0 = prop(p0, 'CFrame')?.cf || CF.IDENTITY;
      const cf1 = prop(p1, 'CFrame')?.cf || CF.IDENTITY;
      c0 = CF.mul(CF.inverse(cf0), cf1);
      c1 = CF.IDENTITY.slice();
    }
    joints.push({ name: wnode.name, kind: 'weld', part0: idByNode.get(p0), part1: idByNode.get(p1), c0, c1 });
  }

  // choose root: HumanoidRootPart > PrimaryPart > most-common part0 that is never a part1
  let rootNode = partNodes.find((p) => p.name === 'HumanoidRootPart');
  if (!rootNode) {
    const primary = prop(modelNode, 'PrimaryPart');
    const pn = resolveRef(primary);
    if (pn && idByNode.has(pn)) rootNode = pn;
  }
  if (!rootNode) {
    const part1Ids = new Set(joints.map((j) => j.part1));
    rootNode = partNodes.find((p) => !part1Ids.has(idByNode.get(p))) || partNodes[0];
  }
  const rootCf = prop(rootNode, 'CFrame')?.cf || CF.IDENTITY;

  for (const pn of partNodes) {
    const cf = prop(pn, 'CFrame')?.cf || CF.IDENTITY;
    const size = prop(pn, 'size', 'Size') || { x: 1, y: 1, z: 1 };
    const def = {
      id: idByNode.get(pn),
      name: pn.name,
      className: pn.className === 'MeshPart' ? 'MeshPart' : 'Part',
      size: [size.x, size.y, size.z],
      cf: CF.mul(CF.inverse(rootCf), cf),
      color: colorHex(prop(pn, 'Color3uint8', 'Color')),
      transparency: prop(pn, 'Transparency') || 0,
      material: MATERIAL_NAMES[prop(pn, 'material', 'Material')] || 'Plastic',
      reflectance: prop(pn, 'reflectance', 'Reflectance') || 0,
    };
    const shapeToken = prop(pn, 'shape', 'Shape');
    if (pn.className === 'Part' && shapeToken !== undefined) def.shape = SHAPE_NAMES[shapeToken] || 'Block';
    if (pn.className === 'MeshPart') {
      def.meshId = prop(pn, 'MeshId', 'MeshID') || '';
      def.textureId = prop(pn, 'TextureID', 'TextureId') || '';
    }
    const sm = pn.children.find((c) => c.className === 'SpecialMesh' || c.className === 'BlockMesh' || c.className === 'CylinderMesh');
    if (sm) {
      const mt = sm.className === 'SpecialMesh' ? (MESHTYPE_NAMES[prop(sm, 'MeshType') ?? 6] || 'Brick') : 'Brick';
      const scale = prop(sm, 'Scale') || { x: 1, y: 1, z: 1 };
      const offset = prop(sm, 'Offset') || { x: 0, y: 0, z: 0 };
      def.specialMesh = {
        meshType: mt,
        meshId: prop(sm, 'MeshId') || '',
        textureId: prop(sm, 'TextureId') || '',
        scale: [scale.x, scale.y, scale.z],
        offset: [offset.x, offset.y, offset.z],
      };
    }
    // Every Decal on the part, on whatever face it's actually on — not just the front one.
    const decalNodes = pn.children.filter((c) => c.className === 'Decal' && prop(c, 'Texture'));
    if (decalNodes.length) {
      def.decals = decalNodes.map((c) => ({
        face: NORMALID_NAMES[prop(c, 'Face') ?? NORMALID_FRONT] || 'Front',
        texture: prop(c, 'Texture') || '',
        transparency: prop(c, 'Transparency') || 0,
      }));
    }
    // Modern UGC heads texture via SurfaceAppearance, not MeshPart.TextureID — missing this is
    // exactly what causes the "UGC mesh head turns black" bug, so file imports capture it too.
    const sa = pn.children.find((c) => c.className === 'SurfaceAppearance');
    if (sa) {
      def.surfaceAppearance = {
        colorMap: prop(sa, 'ColorMap') || '',
        normalMap: prop(sa, 'NormalMap') || '',
        roughnessMap: prop(sa, 'RoughnessMap') || '',
        metalnessMap: prop(sa, 'MetalnessMap') || '',
      };
    }
    parts.push(def);
  }

  return {
    name: modelNode.name,
    rigType: 'Custom',
    rootPart: idByNode.get(rootNode),
    parts,
    joints,
  };
}

// ---------------------------------------------------------------- animation import
const POSE_STYLE = ['Linear', 'Constant', 'Elastic', 'Cubic', 'Bounce', 'Cubic'];
const POSE_DIR = ['In', 'Out', 'InOut'];
const PRIORITY = { 0: 'Idle', 1: 'Movement', 2: 'Action', 3: 'Action2', 4: 'Action3', 5: 'Action4', 1000: 'Core' };

// Neutral animation form: { name, loop, priority, keyframes: [{time, poses: [{part, cf, weight, es, ed}]}] }
export function neutralAnimFromTree(ksNode) {
  const keyframes = [];
  for (const kf of ksNode.children) {
    if (kf.className !== 'Keyframe') continue;
    const time = prop(kf, 'Time') || 0;
    const poses = [];
    const walkPose = (node) => {
      for (const c of node.children) {
        if (c.className !== 'Pose' && c.className !== 'NumberPose') continue;
        if (c.className === 'Pose') {
          poses.push({
            part: c.name,
            cf: prop(c, 'CFrame')?.cf || CF.IDENTITY.slice(),
            weight: prop(c, 'Weight') ?? 1,
            es: POSE_STYLE[prop(c, 'EasingStyle') ?? 0] || 'Linear',
            ed: POSE_DIR[prop(c, 'EasingDirection') ?? 0] || 'In',
          });
        }
        walkPose(c);
      }
    };
    walkPose(kf);
    keyframes.push({ time, poses });
  }
  keyframes.sort((a, b) => a.time - b.time);
  const pr = prop(ksNode, 'Priority');
  return {
    name: ksNode.name,
    loop: !!prop(ksNode, 'Loop'),
    priority: PRIORITY[pr] || 'Action',
    keyframes,
  };
}

// Apply a neutral animation onto a rig item's tracks.
// Times are kept fractional (never rounded) — zero precision loss.
export function applyAnimationToItem(item, anim, opts = {}) {
  const fps = S.state.project.fps;
  const rig = item.rig;
  const jointByPartName = new Map();
  for (const j of rig.joints || []) {
    if (j.kind === 'weld') continue;
    const partDef = rig.parts.find((p) => p.id === j.part1);
    if (partDef) jointByPartName.set(partDef.name, j.name);
  }

  // gather per-track raw keys with the pose easing attached (eases INTO the pose)
  const raw = new Map(); // jointName -> [{t, cf, es, ed}]
  let skipped = 0;
  for (const kf of anim.keyframes) {
    for (const pose of kf.poses) {
      if (pose.weight <= 0) continue;
      const joint = jointByPartName.get(pose.part);
      if (!joint) { skipped++; continue; }
      if (!raw.has(joint)) raw.set(joint, []);
      raw.get(joint).push({ t: kf.time * fps, cf: pose.cf, es: pose.es, ed: pose.ed });
    }
  }

  S.pushUndo();
  let added = 0;
  for (const [joint, keys] of raw) {
    keys.sort((a, b) => a.t - b.t);
    for (let i = 0; i < keys.length; i++) {
      // pose easing describes the segment ENDING at this key → store it on the previous key
      const next = keys[i + 1];
      S.setKey(item.id, joint, keys[i].t, keys[i].cf, {
        noUndo: true,
        es: next ? next.es : 'Linear',
        ed: next ? next.ed : 'Out',
      });
      added++;
    }
  }
  if (anim.keyframes.length) {
    const endT = Math.max(...anim.keyframes.map((k) => k.time)) * fps;
    if (endT > S.state.project.length) {
      S.state.project.length = Math.ceil(endT);
      S.emit('project-props');
    }
  }
  if (!opts.silent) S.emit('tracks', {});
  S.markDirty();
  return { added, skipped, tracks: raw.size };
}

// ---------------------------------------------------------------- animation export
// Produces the neutral form; segments with non-native easing get baked per frame
// so the uploaded animation matches the editor EXACTLY (no translation gap).
export function buildExportData(item, opts = {}) {
  const p = S.state.project;
  const fps = p.fps;
  const tracks = S.getTracks(item.id);
  const rig = item.rig;
  const partNameByJoint = new Map();
  const jointDefByName = new Map();
  for (const j of rig.joints || []) {
    if (j.kind === 'weld') continue;
    const partDef = rig.parts.find((pp) => pp.id === j.part1);
    if (partDef) partNameByJoint.set(j.name, partDef.name);
    jointDefByName.set(j.name, j);
  }

  // 1. copy + bake tracks
  const baked = new Map(); // jointName -> keys [{t, cf, es, ed}]
  for (const [trackName, tr] of Object.entries(tracks)) {
    if (trackName.startsWith('@')) continue;
    if (!partNameByJoint.has(trackName)) continue;
    if (!tr.keys.length) continue;
    const keys = [];
    for (let i = 0; i < tr.keys.length; i++) {
      const k = tr.keys[i];
      const next = tr.keys[i + 1];
      keys.push({ t: k.t, cf: k.v, es: k.es || 'Linear', ed: k.ed || 'Out' });
      if (next && needsBaking(k)) {
        const step = Math.max(1, Math.round(opts.bakeStep || 1));
        for (let f = Math.ceil(k.t) + step; f < next.t; f += step) {
          const alpha = evalSegment(k, (f - k.t) / (next.t - k.t));
          keys.push({ t: f, cf: CF.lerp(k.v, next.v, alpha), es: 'Linear', ed: 'Out', baked: true });
        }
        // the original key's own easing becomes Linear once baked
        keys.find((kk) => kk.t === k.t).es = 'Linear';
      }
    }
    keys.sort((a, b) => a.t - b.t);
    baked.set(trackName, keys);
  }

  // 2. union of times → keyframes with sparse poses
  const times = new Set();
  for (const [, keys] of baked) for (const k of keys) times.add(Math.round(k.t * 1e6) / 1e6);
  const sortedTimes = [...times].sort((a, b) => a - b);

  const keyframes = sortedTimes.map((t) => ({ time: t / fps, poses: [] }));
  const timeIndex = new Map(sortedTimes.map((t, i) => [t, i]));

  for (const [joint, keys] of baked) {
    const part = partNameByJoint.get(joint);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const prev = keys[i - 1];
      const idx = timeIndex.get(Math.round(k.t * 1e6) / 1e6);
      if (idx === undefined) continue;
      keyframes[idx].poses.push({
        part,
        cf: k.cf,
        weight: 1,
        // Roblox pose easing = easing INTO this pose = previous key's segment easing
        es: prev ? prev.es : 'Linear',
        ed: prev ? prev.ed : 'Out',
      });
    }
  }

  // 3. pose hierarchy (parent chains from the joint graph)
  const parentByPart = {};
  for (const j of rig.joints || []) {
    const p0 = rig.parts.find((pp) => pp.id === j.part0);
    const p1 = rig.parts.find((pp) => pp.id === j.part1);
    if (p0 && p1) parentByPart[p1.name] = p0.name;
  }
  const rootPartName = rig.parts.find((pp) => pp.id === rig.rootPart)?.name || 'HumanoidRootPart';

  return {
    name: opts.name || `${item.name} animation`,
    loop: p.loop,
    priority: p.priority,
    fps,
    rootPart: rootPartName,
    parentByPart,
    keyframes: keyframes.filter((kf) => kf.poses.length),
  };
}

const PRIORITY_TOKEN = { Idle: 0, Movement: 1, Action: 2, Action2: 3, Action3: 4, Action4: 5, Core: 1000 };
const STYLE_TOKEN = { Linear: 0, Constant: 1, Elastic: 2, Cubic: 3, Bounce: 4 };
const DIR_TOKEN = { In: 0, Out: 1, InOut: 2 };

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cfXml(cf) {
  const tags = ['X', 'Y', 'Z', 'R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'];
  return tags.map((t, i) => `<${t}>${cf[i]}</${t}>`).join('');
}

// Full .rbxmx of a KeyframeSequence — drop it into Studio and it just works.
export function buildKeyframeSequenceXML(data) {
  let refCounter = 0;
  const ref = () => `ECL${refCounter++}`;
  const lines = [];
  lines.push(`<roblox version="4">`);
  lines.push(`<Item class="KeyframeSequence" referent="${ref()}"><Properties>` +
    `<string name="Name">${esc(data.name)}</string>` +
    `<bool name="Loop">${data.loop}</bool>` +
    `<token name="Priority">${PRIORITY_TOKEN[data.priority] ?? 2}</token>` +
    `</Properties>`);

  for (const kf of data.keyframes) {
    lines.push(`<Item class="Keyframe" referent="${ref()}"><Properties>` +
      `<string name="Name">Keyframe</string>` +
      `<float name="Time">${kf.time}</float>` +
      `</Properties>`);

    // build nested pose tree: chain every posed part up to the root
    const posed = new Map(kf.poses.map((p) => [p.part, p]));
    const childrenOf = new Map();
    const ensureChain = (part) => {
      let cur = part;
      while (cur && cur !== data.rootPart) {
        const parent = data.parentByPart[cur] || data.rootPart;
        if (!childrenOf.has(parent)) childrenOf.set(parent, new Set());
        childrenOf.get(parent).add(cur);
        cur = parent;
      }
    };
    for (const p of kf.poses) ensureChain(p.part);

    const emitPose = (part) => {
      const pose = posed.get(part);
      const cf = pose ? pose.cf : CF.IDENTITY;
      const weight = pose ? pose.weight : 0;
      const es = pose ? (STYLE_TOKEN[pose.es] ?? 0) : 0;
      const edir = pose ? (DIR_TOKEN[pose.ed] ?? 0) : 0;
      lines.push(`<Item class="Pose" referent="${ref()}"><Properties>` +
        `<string name="Name">${esc(part)}</string>` +
        `<CoordinateFrame name="CFrame">${cfXml(cf)}</CoordinateFrame>` +
        `<float name="Weight">${weight}</float>` +
        `<token name="EasingStyle">${es}</token>` +
        `<token name="EasingDirection">${edir}</token>` +
        `<float name="MaskWeight">0</float>` +
        `</Properties>`);
      for (const c of childrenOf.get(part) || []) emitPose(c);
      lines.push(`</Item>`);
    };
    emitPose(data.rootPart);
    lines.push(`</Item>`);
  }
  lines.push(`</Item>`);
  lines.push(`</roblox>`);
  return lines.join('\n');
}

// Serialize a rig item (with its animation) to a self-contained .rbxmx model:
// rig parts + Motor6Ds + AnimSaves folder holding the KeyframeSequence.
// Dropping the file into Studio recreates everything in one go.
export function buildRigModelXML(item, animXmlInner) {
  const rig = item.rig;
  let refCounter = 1000000;
  const ref = () => `ECLM${refCounter++}`;
  const refByPart = new Map();
  for (const p of rig.parts) refByPart.set(p.id, ref());
  const lines = [];
  lines.push(`<roblox version="4">`);
  lines.push(`<Item class="Model" referent="${ref()}"><Properties><string name="Name">${esc(item.name)}</string></Properties>`);
  for (const p of rig.parts) {
    const cls = p.className === 'MeshPart' ? 'MeshPart' : 'Part';
    lines.push(`<Item class="${cls}" referent="${refByPart.get(p.id)}"><Properties>` +
      `<string name="Name">${esc(p.name)}</string>` +
      `<CoordinateFrame name="CFrame">${cfXml(p.cf)}</CoordinateFrame>` +
      `<Vector3 name="size"><X>${p.size[0]}</X><Y>${p.size[1]}</Y><Z>${p.size[2]}</Z></Vector3>` +
      `<float name="Transparency">${p.transparency || 0}</float>` +
      `<bool name="Anchored">${p.id === rig.rootPart}</bool>` +
      `<bool name="CanCollide">false</bool>` +
      (cls === 'MeshPart' && p.meshId ? `<Content name="MeshId"><url>rbxassetid://${String(p.meshId).match(/\d+/)?.[0] || ''}</url></Content>` : '') +
      `</Properties>`);
    if (p.specialMesh) {
      const mt = MESHTYPE_NAMES.indexOf(p.specialMesh.meshType);
      lines.push(`<Item class="SpecialMesh" referent="${ref()}"><Properties>` +
        `<string name="Name">Mesh</string>` +
        `<token name="MeshType">${mt >= 0 ? mt : 6}</token>` +
        `<Vector3 name="Scale"><X>${p.specialMesh.scale[0]}</X><Y>${p.specialMesh.scale[1]}</Y><Z>${p.specialMesh.scale[2]}</Z></Vector3>` +
        `</Properties></Item>`);
    }
    lines.push(`</Item>`);
  }
  for (const j of rig.joints || []) {
    const cls = j.kind === 'weld' ? 'Weld' : 'Motor6D';
    lines.push(`<Item class="${cls}" referent="${ref()}"><Properties>` +
      `<string name="Name">${esc(j.name)}</string>` +
      `<CoordinateFrame name="C0">${cfXml(j.c0)}</CoordinateFrame>` +
      `<CoordinateFrame name="C1">${cfXml(j.c1)}</CoordinateFrame>` +
      `<Ref name="Part0">${refByPart.get(j.part0)}</Ref>` +
      `<Ref name="Part1">${refByPart.get(j.part1)}</Ref>` +
      `</Properties></Item>`);
  }
  if (animXmlInner) {
    lines.push(`<Item class="Model" referent="${ref()}"><Properties><string name="Name">AnimSaves</string></Properties>`);
    lines.push(animXmlInner);
    lines.push(`</Item>`);
  }
  lines.push(`</Item></roblox>`);
  return lines.join('\n');
}

// Strip the outer <roblox> wrapper from a KeyframeSequence XML for embedding
export function innerXml(fullXml) {
  return fullXml.replace(/^<roblox[^>]*>\n?/, '').replace(/\n?<\/roblox>$/, '');
}
