// Stage handles for the Effect Sheet (docs/effect-sheet.md §6): a draggable gizmo for every graph
// value that IS a spatial thing — a point, a direction, a radius, a floor, a cone — generated from
// socket metadata (type + unit + key), the same way controls and sheet rows are.
//
// THE ONE RULE: a handle exists only where dragging it sets exactly one value in the graph. There is
// no inverse solving here and never will be (§6.3): dragging a gravity arrow writes the gravity node's
// direction and strength, nothing else, so what a person did and what the graph became are the same
// fact. Every drag is one undo step (beginGesture/endGesture) and writes through ST.mutatePnx, the
// path the sheet, the node editor and MCP all share.
//
// Hover is mirrored both ways: the sheet's hot row lights its handle, and hovering a handle lights the
// row, so "which number is this arrow?" never needs a tooltip.

import * as THREE from '../../node_modules/three/build/three.module.js';
import * as ST from './studioState.js';
import * as PGRAPH from '../../renderer/js/pnx/graph.js';
import * as REG from '../../renderer/js/pnx/registry.js';
import * as T from '../../renderer/js/pnx/types.js';

const COLOR = { point: 0x7c8cff, direction: 0x7c8cff, radius: 0x54c8e8, floor: 0x9394a8, cone: 0x7c8cff, hot: 0xffb040 };
const ORIGIN_Y = 0.5;   // the preview plants effects half a stud above the grid (preview.js ORIGIN)

let three = null;        // { scene, camera, renderer, canvas, controls } from preview.js
let root = null;         // THREE.Group holding every handle
let handles = [];        // { id, kind, nodeId, key, obj, pick: [meshes], value(), apply(v) ... }
let raycaster = null;
let drag = null;
let hot = null;          // { nodeId, key } from the sheet
const graph = () => ST.state.pnx;

export function initHandles(previewObjects) {
  three = previewObjects;
  root = new THREE.Group();
  root.name = 'sheet-handles';
  three.scene.add(root);
  raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.12 };
  ST.on('effect', rebuild);
  ST.on('pnx', rebuild);
  ST.on('sheetHot', (h) => { hot = h; paint(); });
  three.canvas.addEventListener('pointerdown', onDown, true);
  three.canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  rebuild();
}

// ---------------------------------------------------------------- which sockets get a handle
// Decided from metadata alone, so a new node with a `center` vector3 gets a point handle the moment it
// is registered. Group instances and boundary nodes are skipped; their interiors are edited on their
// own scope.
function describeHandles(g) {
  const out = [];
  for (const node of PGRAPH.nodesInScope(g, PGRAPH.ROOT_SCOPE)) {
    const def = REG.getNode(node.type);
    if (!def) continue;
    const inputs = def.inputs;
    const wired = (key) => PGRAPH.linksInto(g, node.id, key).length > 0;
    const val = (s) => (node.values?.[s.key] !== undefined ? node.values[s.key] : s.default);
    // a node's own anchor: its first unwired position-like vector, else the origin
    const anchorSock = inputs.find((s) => innerName(s) === 'vector3' && /center|position|point|from/.test(s.key) && !wired(s.key));
    const anchor = anchorSock ? vec(val(anchorSock)) : [0, ORIGIN_Y, 0];

    for (const s of inputs) {
      if (s.socket === false || wired(s.key)) continue;
      const name = innerName(s);
      const key = s.key;
      if (name === 'vector3' && /center|position|point|from|to|target/.test(key) && !/normal|axis/.test(key)) {
        out.push({ kind: 'point', node, socket: s, label: `${def.label} · ${s.label}` });
      } else if (name === 'vector3' && /direction|axis|normal/.test(key)) {
        const strength = inputs.find((x) => /strength|speed|magnitude/.test(x.key) && innerName(x) === 'float' && !wired(x.key));
        out.push({ kind: 'direction', node, socket: s, strengthSocket: strength || null, anchor: def.id === 'cadence.fields.constantDirection' ? [3.2, 3.6, 0] : anchor, label: `${def.label} · ${s.label}` });
      } else if (name === 'float' && /radius|range/.test(key) && !/inner/.test(key) && (s.unit === 'studs' || /geometry|sdf|fields/.test(def.id))) {
        out.push({ kind: 'radius', node, socket: s, anchor, label: `${def.label} · ${s.label}` });
      } else if (name === 'float' && /angle|spread/.test(key) && s.unit === 'degrees') {
        const axis = inputs.find((x) => /axis|direction/.test(x.key) && innerName(x) === 'vector3');
        out.push({ kind: 'cone', node, socket: s, axisSocket: axis || null, anchor, label: `${def.label} · ${s.label}` });
      }
    }
    if (def.id === 'cadence.sdf.plane' && !wired('point')) {
      out.push({ kind: 'floor', node, socket: inputs.find((s) => s.key === 'point'), normalSocket: inputs.find((s) => s.key === 'normal'), label: 'Floor' });
    }
  }
  return out;
}
const innerName = (s) => { const t = T.parseType(s.type); const inner = T.isFieldType(t) ? t.param : t; return inner?.name; };
const vec = (v) => (Array.isArray(v) ? [v[0] || 0, v[1] || 0, v[2] || 0] : [0, 0, 0]);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------- building the gizmos
function rebuild() {
  if (!root) return;
  for (const h of handles) root.remove(h.obj);
  handles = [];
  if (!graph()) { paint(); return; }
  let k = 0;
  for (const d of describeHandles(graph())) {
    const h = buildHandle(d, k++);
    if (h) { root.add(h.obj); handles.push(h); }
  }
  paint();
}

function mat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false, depthWrite: false });
}
function lineMat(color) { return new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }); }

function buildHandle(d, index) {
  const node = d.node, s = d.socket;
  const value = () => (graph().nodes[node.id]?.values?.[s.key] !== undefined ? graph().nodes[node.id].values[s.key] : s.default);
  const obj = new THREE.Group();
  obj.renderOrder = 1000;
  const h = { id: `${node.id}:${s.key}`, kind: d.kind, nodeId: node.id, key: s.key, label: d.label, obj, pick: [], d };

  if (d.kind === 'point') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mat(COLOR.point));
    obj.add(core); h.pick.push(core);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 24), mat(COLOR.point, 0.6));
    ring.rotation.x = -Math.PI / 2; obj.add(ring);
    h.update = () => { const p = vec(value()); obj.position.set(p[0], p[1], p[2]); };
    h.dragPlane = 'camera';
    h.apply = (world) => [round(world.x), round(world.y), round(world.z)];
  } else if (d.kind === 'direction') {
    const shaft = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), lineMat(COLOR.direction));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 12), mat(COLOR.direction));
    obj.add(shaft, tip); h.pick.push(tip);
    h.update = () => {
      const dir = vec(value());
      const L = Math.hypot(dir[0], dir[1], dir[2]);
      const strength = d.strengthSocket ? num(graph().nodes[node.id]?.values?.[d.strengthSocket.key] ?? d.strengthSocket.default, 1) : L;
      const len = 0.6 + Math.min(4, Math.abs(strength)) * 0.35;
      const a = d.anchor;
      obj.position.set(a[0], a[1], a[2]);
      const n = L > 1e-6 ? new THREE.Vector3(dir[0] / L, dir[1] / L, dir[2] / L) : new THREE.Vector3(0, 1, 0);
      shaft.geometry.setFromPoints([new THREE.Vector3(), n.clone().multiplyScalar(len)]);
      tip.position.copy(n.clone().multiplyScalar(len));
      tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      h.len = len; h.dir = n;
    };
    h.dragPlane = 'camera';
    h.apply = (world) => {
      // The tip's new position relative to the anchor gives direction; its distance gives strength.
      const a = d.anchor;
      const rel = new THREE.Vector3(world.x - a[0], world.y - a[1], world.z - a[2]);
      const L = rel.length();
      if (L < 1e-4) return null;
      const dir = rel.clone().normalize();
      const out = { [s.key]: [round(dir.x), round(dir.y), round(dir.z)] };
      if (d.strengthSocket) out[d.strengthSocket.key] = round(Math.max(0, (L - 0.6) / 0.35));
      else out[s.key] = [round(dir.x * L), round(dir.y * L), round(dir.z * L)];
      return out;
    };
  } else if (d.kind === 'radius') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 64), mat(COLOR.radius, 0.9));
    ring.rotation.x = Math.PI / 2;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mat(COLOR.radius));
    obj.add(ring, knob); h.pick.push(knob);
    h.update = () => {
      const r = Math.max(0.05, num(value(), 1));
      const a = centerOf(node, d.anchor);
      obj.position.set(a[0], a[1], a[2]);
      ring.scale.setScalar(r);
      knob.position.set(r, 0, 0);
      h.center = a;
    };
    h.dragPlane = 'xz';
    h.apply = (world) => round(Math.max(0.01, Math.hypot(world.x - h.center[0], world.z - h.center[2])));
  } else if (d.kind === 'cone') {
    const geo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    const cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLOR.cone, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mat(COLOR.cone));
    obj.add(cone, knob); h.pick.push(knob);
    h.update = () => {
      const deg = Math.max(0.5, Math.min(179, num(value(), 30)));
      const axisV = d.axisSocket ? vec(graph().nodes[node.id]?.values?.[d.axisSocket.key] ?? d.axisSocket.default) : [0, 1, 0];
      const L = Math.hypot(axisV[0], axisV[1], axisV[2]) || 1;
      const n = new THREE.Vector3(axisV[0] / L, axisV[1] / L, axisV[2] / L);
      const len = 1.6;
      const r = Math.tan(deg * Math.PI / 180) * len;
      const a = d.anchor;
      obj.position.set(a[0], a[1], a[2]);
      obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      cone.scale.set(r, len, r);
      cone.position.set(0, len / 2, 0);
      cone.rotation.x = Math.PI;   // apex at the anchor, opening along +y
      knob.position.set(r, len, 0);
      h.len = len; h.axis = n; h.anchorV = new THREE.Vector3(a[0], a[1], a[2]);
    };
    h.dragPlane = 'camera';
    h.apply = (world) => {
      const rel = new THREE.Vector3(world.x, world.y, world.z).sub(h.anchorV);
      const along = rel.dot(h.axis);
      const perp = rel.clone().sub(h.axis.clone().multiplyScalar(along)).length();
      if (along < 0.05) return null;
      return round(Math.max(0.5, Math.min(179, Math.atan2(perp, along) * 180 / Math.PI)));
    };
  } else if (d.kind === 'floor') {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: COLOR.floor, transparent: true, opacity: 0.12, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(10, 10)), lineMat(COLOR.floor));
    obj.add(plane, edge); h.pick.push(plane);
    h.update = () => {
      const p = vec(value());
      const nv = vec(graph().nodes[node.id]?.values?.[d.normalSocket.key] ?? d.normalSocket.default);
      const L = Math.hypot(nv[0], nv[1], nv[2]) || 1;
      const n = new THREE.Vector3(nv[0] / L, nv[1] / L, nv[2] / L);
      obj.position.set(p[0], p[1], p[2]);
      obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      h.normal = n;
    };
    h.dragPlane = 'normal';
    h.apply = (world) => {
      // slide along the normal only
      const p = vec(value());
      const n = h.normal;
      const t = new THREE.Vector3(world.x - p[0], world.y - p[1], world.z - p[2]).dot(n);
      return [round(p[0] + n.x * t), round(p[1] + n.y * t), round(p[2] + n.z * t)];
    };
  } else return null;

  h.update();
  return h;
}
const round = (v) => Math.round(v * 100) / 100;
function centerOf(node, fallback) {
  const c = node.values?.center ?? node.values?.position;
  return Array.isArray(c) ? vec(c) : fallback;
}

// ---------------------------------------------------------------- paint (hover / hot)
function paint() {
  for (const h of handles) {
    const isHot = hot && hot.nodeId === h.nodeId && (hot.key === h.key || (h.d.strengthSocket && hot.key === h.d.strengthSocket.key) || (h.d.axisSocket && hot.key === h.d.axisSocket.key));
    const active = isHot || (drag && drag.h === h) || (hoverHandle === h);
    h.obj.traverse((o) => {
      if (!o.material) return;
      const base = o.userData.baseColor || (o.userData.baseColor = o.material.color.getHex());
      o.material.color.setHex(active ? COLOR.hot : base);
    });
    h.obj.visible = true;
  }
}

// ---------------------------------------------------------------- pointer
let hoverHandle = null;
function pickAt(e) {
  const r = three.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, three.camera);
  const meshes = handles.flatMap((h) => h.pick);
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const mesh = hits[0].object;
  return { h: handles.find((h) => h.pick.includes(mesh)), point: hits[0].point, ndc };
}
function planeFor(h, at) {
  if (h.dragPlane === 'xz') return new THREE.Plane(new THREE.Vector3(0, 1, 0), -at.y);
  if (h.dragPlane === 'normal') return new THREE.Plane(three.camera.getWorldDirection(new THREE.Vector3()).negate(), 0).setFromNormalAndCoplanarPoint(three.camera.getWorldDirection(new THREE.Vector3()).negate(), at);
  const n = three.camera.getWorldDirection(new THREE.Vector3()).negate();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, at);
}
function onDown(e) {
  if (!graph() || e.button !== 0) return;
  const hit = pickAt(e);
  if (!hit) return;
  e.stopPropagation(); e.preventDefault();
  three.controls.enabled = false;
  drag = { h: hit.h, plane: planeFor(hit.h, hit.point), pointer: e.pointerId };
  try { three.canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
  ST.beginGesture();
  paint();
}
function onMove(e) {
  if (!drag) {
    if (!graph()) return;
    const hit = pickAt(e);
    const next = hit ? hit.h : null;
    if (next !== hoverHandle) {
      hoverHandle = next;
      three.canvas.style.cursor = next ? 'grab' : '';
      ST.emit('stageHot', next ? { nodeId: next.nodeId, key: next.key } : null);
      paint();
    }
    return;
  }
  const r = three.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, three.camera);
  const world = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(drag.plane, world)) return;
  const h = drag.h;
  const next = h.apply(world);
  if (next === null || next === undefined) return;
  ST.mutatePnx((g) => {
    if (next && typeof next === 'object' && !Array.isArray(next)) for (const [k, v] of Object.entries(next)) PGRAPH.setNodeValue(g, h.nodeId, k, v);
    else PGRAPH.setNodeValue(g, h.nodeId, h.key, next);
  }, { nodeId: h.nodeId, undoable: false });
}
function onUp(e) {
  if (!drag) return;
  try { three.canvas.releasePointerCapture(drag.pointer); } catch (_) { /* fine */ }
  drag = null;
  three.controls.enabled = true;
  ST.endGesture();
  paint();
}

export function handleCount() { return handles.length; }
export function handleList() { return handles.map((h) => ({ id: h.id, kind: h.kind, nodeId: h.nodeId, key: h.key, label: h.label })); }
