// The studio's real-time preview: renders sampleEffect() output — pooled particle sprites,
// tessellated shape meshes, point lights — plus the screen-effects overlay (a 2D canvas above
// the WebGL one) and camera shake. Playback is just a frame counter: the engine is a pure
// function of the frame, so play/scrub/loop all share renderFrame().

import * as THREE from '../../node_modules/three/build/three.module.js';
import { OrbitControls } from '../../renderer/vendor/three/OrbitControls.js';
import { getParticleTexture } from '../../renderer/js/rigbuild.js';
import { sampleEffect } from '../../renderer/js/effectEngine.js';
import { isClosedShape } from '../../renderer/js/effectShapes.js';
import { buildShapeGeometry } from '../../renderer/js/effectMeshBuilder.js';
import * as ST from './studioState.js';

const ORIGIN = [0, 0.5, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]; // half a stud above the grid

let renderer, scene, camera, controls, canvas, fxCanvas, fxCtx;
const layerVisuals = new Map(); // layerId -> { kind, ...three objects, signature }

export function initPreview() {
  canvas = document.getElementById('vfxCanvas');
  fxCanvas = document.getElementById('vfxScreenFx');
  fxCtx = fxCanvas.getContext('2d');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
  camera.position.set(4.2, 3.0, 4.8);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0a12, 1.0));
  scene.add(new THREE.GridHelper(12, 24, 0x3a3a46, 0x22222c));

  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  ST.on('effect', syncLayerVisuals);
  syncLayerVisuals();
  requestAnimationFrame(tick);
}

function resize() {
  const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fxCanvas.width = w;
  fxCanvas.height = h;
}

// ---------------------------------------------------------------- per-layer visuals
// Pools/meshes are rebuilt only when a layer's STRUCTURAL signature changes (sprite shape,
// blend, pool size, shape def...) — per-frame values (positions, colors, opacity) are applied
// in place every render.
function emitterSignature(layer) {
  const p = layer.props;
  return `em|${p.shape}|${p.blendMode}|${Math.max(1, Math.min(2000, p.maxParticles || 150))}`;
}
function shapeSignature(layer) {
  return `sh|${JSON.stringify(layer.props.shape)}|${layer.props.emissive ? 1 : 0}`;
}

function buildEmitterVisual(layer) {
  const group = new THREE.Group();
  const cap = Math.max(1, Math.min(2000, layer.props.maxParticles || 150));
  const tex = getParticleTexture(layer.props.shape);
  const blending = layer.props.blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
  const sprites = [];
  for (let i = 0; i < cap; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending });
    const spr = new THREE.Sprite(mat);
    spr.visible = false;
    group.add(spr);
    sprites.push(spr);
  }
  scene.add(group);
  return { kind: 'emitter', group, sprites };
}

// Shape layers: path shapes become a tube along the polyline; surface shapes become their
// natural three.js geometry. Geometry is cached against the shape def + a thickness bucket
// (thickness is animatable — rebuilding on >6% change keeps drags smooth without per-frame
// geometry churn).
function buildShapeVisual(layer) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: layer.props.emissive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(buildShapeGeometry(layer.props.shape, layer.props.thickness, isClosedShape(layer.props.shape)), mat);
  scene.add(mesh);
  return { kind: 'shape', mesh, geomThickness: layer.props.thickness };
}

function buildLightVisual() {
  const light = new THREE.PointLight(0xffffff, 0, 12, 1.6);
  scene.add(light);
  return { kind: 'light', light };
}

function disposeVisual(v) {
  if (v.kind === 'emitter') {
    scene.remove(v.group);
    for (const s of v.sprites) s.material.dispose();
  } else if (v.kind === 'shape') {
    scene.remove(v.mesh);
    v.mesh.geometry.dispose();
    v.mesh.material.dispose();
  } else if (v.kind === 'light') {
    scene.remove(v.light);
  }
}

// Reconcile visuals with the current doc — resolve layers BY ID each time (snapshot undo
// replaces the objects; holding a layer reference across 'effect' events is the known trap).
function syncLayerVisuals() {
  const doc = ST.state.doc;
  const seen = new Set();
  for (const layer of doc.layers) {
    if (layer.type !== 'emitter' && layer.type !== 'shape' && layer.type !== 'light') continue;
    seen.add(layer.id);
    const sig = layer.type === 'emitter' ? emitterSignature(layer) : layer.type === 'shape' ? shapeSignature(layer) : 'light';
    const existing = layerVisuals.get(layer.id);
    if (existing && existing.signature === sig) continue;
    if (existing) disposeVisual(existing);
    const built = layer.type === 'emitter' ? buildEmitterVisual(layer) : layer.type === 'shape' ? buildShapeVisual(layer) : buildLightVisual();
    built.signature = sig;
    layerVisuals.set(layer.id, built);
  }
  for (const [id, v] of layerVisuals) {
    if (!seen.has(id)) {
      disposeVisual(v);
      layerVisuals.delete(id);
    }
  }
}

// ---------------------------------------------------------------- frame application
function applySample(sample) {
  // particles → per-layer sprite pools
  const byLayer = new Map();
  for (const p of sample.particles) {
    let arr = byLayer.get(p.layerId);
    if (!arr) byLayer.set(p.layerId, arr = []);
    arr.push(p);
  }
  for (const [id, v] of layerVisuals) {
    if (v.kind !== 'emitter') continue;
    const particles = byLayer.get(id) || [];
    for (let i = 0; i < v.sprites.length; i++) {
      const spr = v.sprites[i];
      const p = particles[i];
      if (!p) { spr.visible = false; continue; }
      spr.visible = true;
      spr.position.set(p.pos[0], p.pos[1], p.pos[2]);
      spr.scale.setScalar(p.size);
      spr.material.color.setRGB(p.color[0], p.color[1], p.color[2]);
      spr.material.opacity = p.opacity;
    }
  }
  // shapes
  const shapeByLayer = new Map(sample.shapes.map((s) => [s.layerId, s]));
  for (const [id, v] of layerVisuals) {
    if (v.kind === 'shape') {
      const s = shapeByLayer.get(id);
      if (!s) { v.mesh.visible = false; continue; }
      v.mesh.visible = s.opacity > 0.002;
      if (Math.abs(s.thickness - v.geomThickness) / Math.max(0.004, v.geomThickness) > 0.06) {
        v.mesh.geometry.dispose();
        v.mesh.geometry = buildShapeGeometry(s.shapeDef, s.thickness, isClosedShape(s.shapeDef));
        v.geomThickness = s.thickness;
      }
      v.mesh.position.set(ORIGIN[0] + s.offset[0], ORIGIN[1] + s.offset[1], ORIGIN[2] + s.offset[2]);
      v.mesh.rotation.set(0, (s.rotation * Math.PI) / 180, 0);
      v.mesh.scale.setScalar(s.scale);
      v.mesh.material.color.setRGB(s.color[0], s.color[1], s.color[2]);
      v.mesh.material.opacity = s.opacity;
    } else if (v.kind === 'light') {
      const l = sample.lights.find((x) => x.layerId === id);
      if (!l) { v.light.intensity = 0; continue; }
      v.light.position.set(ORIGIN[0] + l.offset[0], ORIGIN[1] + l.offset[1], ORIGIN[2] + l.offset[2]);
      v.light.color.setRGB(l.color[0], l.color[1], l.color[2]);
      v.light.intensity = l.intensity;
      v.light.distance = l.range;
    }
  }
  drawScreenFx(sample.screen);
  return sample.shake;
}

function drawScreenFx(screenLayers) {
  const w = fxCanvas.width, h = fxCanvas.height;
  fxCtx.clearRect(0, 0, w, h);
  for (const s of screenLayers) {
    if (s.opacity <= 0.002) continue;
    const rgba = (a) => `rgba(${Math.round(s.color[0] * 255)},${Math.round(s.color[1] * 255)},${Math.round(s.color[2] * 255)},${a})`;
    if (s.kind === 'flash' || s.kind === 'overlay') {
      fxCtx.fillStyle = rgba(s.opacity);
      fxCtx.fillRect(0, 0, w, h);
    } else if (s.kind === 'vignette') {
      const g = fxCtx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, rgba(0));
      g.addColorStop(1, rgba(s.opacity));
      fxCtx.fillStyle = g;
      fxCtx.fillRect(0, 0, w, h);
    } else if (s.kind === 'speedlines') {
      fxCtx.strokeStyle = rgba(s.opacity);
      fxCtx.lineWidth = Math.max(1.5, w / 480);
      const cx = w / 2, cy = h / 2;
      const rIn = Math.min(w, h) * 0.28, rOut = Math.hypot(w, h) / 2;
      fxCtx.beginPath();
      for (let i = 0; i < s.density; i++) {
        // Deterministic per-index angles — the lines shimmer via opacity, not random jumps.
        const a = (i / s.density) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.12;
        fxCtx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
        fxCtx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
      }
      fxCtx.stroke();
    }
  }
}

// ---------------------------------------------------------------- playback loop
let lastNow = null;
let playFrame = 0; // fractional frame accumulator while playing

function tick(now) {
  const doc = ST.state.doc;
  if (ST.state.playing) {
    if (lastNow == null) { lastNow = now; playFrame = ST.state.playhead; }
    playFrame += ((now - lastNow) / 1000) * (doc.fps || 30);
    if (playFrame >= doc.duration) {
      if (doc.loop) playFrame %= doc.duration;
      else { playFrame = doc.duration - 1; ST.setPlaying(false); }
    }
    ST.setPlayhead(playFrame, { fromPlayback: true });
  } else {
    lastNow = null;
  }
  lastNow = ST.state.playing ? now : null;

  const frame = Math.floor(ST.state.playhead);
  const sample = sampleEffect(doc, frame, {
    origin: ORIGIN,
    soloIds: ST.state.solo,
  });
  const shake = applySample(sample);

  controls.update();
  // Shake is applied only for this render, then undone immediately after. controls.update()
  // re-derives its orbit baseline from the camera's CURRENT position/quaternion every call (it
  // reads position back, not just writes it), so leaving the shake transform applied gets
  // silently adopted as the new "home" pose and compounds every tick — this is what caused
  // runaway camera drift even while paused: tick() free-runs off rAF regardless of play state,
  // so a frozen-but-nonzero shake value still got re-applied and re-baked into the baseline
  // every frame. Restoring the pre-shake pose right after the render keeps it purely visual.
  if (shake && (shake.dx || shake.dy || shake.roll)) {
    const basePos = camera.position.clone();
    const baseQuat = camera.quaternion.clone();
    camera.translateX(shake.dx * 0.25);
    camera.translateY(shake.dy * 0.25);
    camera.rotateZ((shake.roll * Math.PI) / 180);
    renderer.render(scene, camera);
    camera.position.copy(basePos);
    camera.quaternion.copy(baseQuat);
  } else {
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
}

// For MCP vfx_render_frame: scrub, then resolve after two real paints (the double-rAF rule from
// the animator's render_frame — capturePage racing three.js's paint was a real observed bug).
export function scrubAndSettle(frame) {
  ST.setPlaying(false);
  ST.setPlayhead(frame);
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({ frame: Math.floor(ST.state.playhead) })));
  });
}

// Test-only: snapshot the live camera transform for the smoketest's shake-while-paused
// regression check (vfx_test_shake_pause_stability in mcp.js). Not part of the MCP-facing API.
export function debugCameraPose() {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
  };
}

// Test-only: let N real rAF ticks elapse (the same loop tick() free-runs on) and resolve once
// they've all fired — used to simulate "sitting paused in the studio" for the check above.
export function debugWaitTicks(n) {
  return new Promise((resolve) => {
    let remaining = Math.max(1, n | 0);
    (function step() {
      remaining--;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    })();
  });
}
