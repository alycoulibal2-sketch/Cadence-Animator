// The Sketch Workspace: a large, distraction-free canvas for drawing the rough shape of an idea —
// the entry stage of the SKETCH IT pipeline (see sketchCandidates.js's header for the full
// pipeline diagram). Strokes are stored as VECTOR point data in workspace-logical coordinates
// (never raster), because sketchGeometry.js's analysis needs real geometry, not pixels — pan/zoom
// only changes the view transform, never the stored data (the same logical-vs-screen separation
// timeline.js's box-select already relies on).
//
// Reuses ui.js's modal() for the open/close animation and backdrop (the same "fade + scale from
// 0.95" contract every other dialog in this app uses) via a .modal:has(.sketch-workspace) CSS
// size override — see the .vfx-preset-browser override in presetsPanel.js/styles.css for the
// established precedent of this exact technique.
//
// Local, ephemeral undo/redo — deliberately separate from the studio's document undo stack
// (ST.pushUndo/undo in studioState.js). This is architecturally normal in this codebase already
// (the main animator and VFX Studio already run two entirely independent undo stacks); a sketch
// that hasn't become an effect yet doesn't belong on either of them. Keyboard shortcuts are
// attached to the canvas itself (not window) and call stopPropagation, so they don't also fire
// app.js's window-level studio Ctrl+Z/Y handler.

import { modal, toast } from '../../renderer/js/ui.js';
import { shapePolyline } from '../../renderer/js/effectShapes.js';
import { recognizeStroke } from '../../renderer/js/sketchClean.js';
import { dist } from '../../renderer/js/sketchGeometry.js';

let overlay = null; // non-null while a workspace session is open — openSketchWorkspace is a singleton

const TAU = Math.PI * 2;

function palette() {
  const s = getComputedStyle(document.documentElement);
  return {
    paper: s.getPropertyValue('--bg-0').trim() || '#0a0a0e',
    grid: s.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)',
    ink: s.getPropertyValue('--text-0').trim() || '#f2f2f6',
    accent: s.getPropertyValue('--accent').trim() || '#7c8cff',
  };
}

// A Guide keeps its points+params: { points:[{x,y,p,t}], tool, params }. `points` is always the
// clean polyline analyzeSketchStrokes()/rendering actually consume; `params` is the tool-native,
// re-editable handle data (kept even though nothing edits it live yet — this is what a future
// drag-to-resize pass would read/write instead of re-deriving from points).
function cloneStrokes(strokes) {
  return (strokes || []).map((s) => ({
    points: s.points.map((p) => ({ ...p })),
    tool: s.tool,
    params: s.params ? { ...s.params } : null,
  }));
}

function toolButton(label, title) {
  const b = document.createElement('button');
  b.className = 'tb-btn';
  b.textContent = label;
  b.title = title;
  return b;
}

// ---------------------------------------------------------------- shape-tool guide generators
// Every tool synthesizes an already-clean Guide directly, no fitting/recognition needed (that's
// only for Free Sketch, via sketchClean.js's recognizeStroke). Line/Circle/Lightning reuse
// effectShapes.js's real primitives — "a dragged Circle tool literally is shapePolyline(...)"; a
// canvas point (x,y) maps to a shape's local (x,z) plane (y=0), a top-down projection convention
// consistent with how those primitives are authored (Y up, XZ the "flat" plane). Ellipse/Rect/
// Spiral have no primitive analog (effectShapes.js's own "spiral" is a constant-radius 3D helix,
// not a flat growing-radius spiral — projecting it to 2D would just retrace a circle) so those
// three get their own small, dedicated 2D math.
export function lineGuide(p0, p1) {
  return { tool: 'line', points: [{ x: p0.x, y: p0.y, p: 0.6, t: 0 }, { x: p1.x, y: p1.y, p: 0.6, t: 1 }], params: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y } };
}
export function circleGuide(center, edge) {
  const r = Math.max(0.5, Math.hypot(edge.x - center.x, edge.y - center.y));
  const raw = shapePolyline({ kind: 'circle', radius: r }, 48);
  return { tool: 'circle', points: raw.map((pt, i) => ({ x: center.x + pt[0], y: center.y + pt[2], p: 0.6, t: i })), params: { cx: center.x, cy: center.y, r } };
}
export function ellipseGuide(center, edge, n = 48) {
  const rx = Math.max(0.5, Math.abs(edge.x - center.x));
  const ry = Math.max(0.5, Math.abs(edge.y - center.y));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    points.push({ x: center.x + Math.cos(a) * rx, y: center.y + Math.sin(a) * ry, p: 0.6, t: i });
  }
  return { tool: 'ellipse', points, params: { cx: center.x, cy: center.y, rx, ry } };
}
export function rectGuide(p0, p1) {
  const x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x);
  const y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  return { tool: 'rect', points: corners.map(([x, y], i) => ({ x, y, p: 0.6, t: i })), params: { x0, y0, x1, y1 } };
}
export function spiralGuide(center, edge, turns = 3, n = 72) {
  const r = Math.max(0.5, Math.hypot(edge.x - center.x, edge.y - center.y));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = u * TAU * turns;
    const rr = r * u;
    points.push({ x: center.x + Math.cos(a) * rr, y: center.y + Math.sin(a) * rr, p: 0.6, t: i });
  }
  return { tool: 'spiral', points, params: { cx: center.x, cy: center.y, r, turns } };
}
export function arrowGuide(p0, p1) {
  return { tool: 'arrow', points: [{ x: p0.x, y: p0.y, p: 0.6, t: 0 }, { x: p1.x, y: p1.y, p: 0.6, t: 1 }], params: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y } };
}
export function lightningGuide(p0, p1) {
  const length = Math.max(0.5, Math.hypot(p1.x - p0.x, p1.y - p0.y));
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const seed = Math.abs(Math.round(p0.x * 7 + p0.y * 13)) % 1000;
  const jag = Math.max(0.3, length * 0.07);
  const raw = shapePolyline({ kind: 'lightning', length, jag, segments: 9, seed }, 24);
  // lightning's point(): [lateralJitter, (1-u)*length, lateralJitter2] — Y runs length->0 as u:0->1,
  // so `length - pt[1]` gives the along-axis distance from p0 (0..length) in increasing u order.
  const points = raw.map((pt, i) => {
    const along = length - pt[1];
    const lateral = pt[0];
    return {
      x: p0.x + Math.cos(angle) * along - Math.sin(angle) * lateral,
      y: p0.y + Math.sin(angle) * along + Math.cos(angle) * lateral,
      p: 0.6, t: i,
    };
  });
  return { tool: 'lightning', points, params: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, jag, seed } };
}
// Cubic bezier through clicked control points (same symmetric-handle-free convention as a quick
// path sketch — real handle editing is a future refinement, this already satisfies "Bezier Path"
// as a distinct tool from Free Sketch: a clean multi-segment curve from a few clicks, not a drag).
export function bezierGuide(controlPts, n = 60) {
  const pts = controlPts;
  if (pts.length < 2) return { tool: 'bezier', points: pts.map((p, i) => ({ x: p.x, y: p.y, p: 0.6, t: i })), params: { points: pts.map((p) => [p.x, p.y]) } };
  const segs = pts.length - 1;
  const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const points = [];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * segs;
    const seg = Math.min(segs - 1, Math.floor(u));
    const t = u - seg;
    const p0 = at(seg - 1), p1 = at(seg), p2 = at(seg + 1), p3 = at(seg + 2);
    const c = (a, b, c2, d, tt) => {
      const t2 = tt * tt, t3 = t2 * tt;
      return 0.5 * ((2 * b) + (-a + c2) * tt + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
    };
    points.push({ x: c(p0.x, p1.x, p2.x, p3.x, t), y: c(p0.y, p1.y, p2.y, p3.y, t), p: 0.6, t: i });
  }
  return { tool: 'bezier', points, params: { points: pts.map((p) => [p.x, p.y]) } };
}

const DRAG_TOOLS = {
  line: lineGuide, circle: circleGuide, ellipse: ellipseGuide, rect: rectGuide,
  spiral: spiralGuide, arrow: arrowGuide, lightning: lightningGuide,
};

const TOOLS = [
  { id: 'freehand', label: '✏', title: 'Free Sketch — draw messy, Cadence cleans it up' },
  { id: 'line', label: '📏', title: 'Straight Line' },
  { id: 'circle', label: '⭕', title: 'Circle' },
  { id: 'ellipse', label: '🥚', title: 'Ellipse' },
  { id: 'rect', label: '▭', title: 'Rectangle' },
  { id: 'spiral', label: '🌀', title: 'Spiral' },
  { id: 'arrow', label: '➡️', title: 'Arrow' },
  { id: 'lightning', label: '⚡', title: 'Lightning' },
  { id: 'bezier', label: '〜', title: 'Bezier Path — click to add points, double-click or Enter to finish' },
];

const ENERGY_LEVELS = ['calm', 'normal', 'strong', 'extreme'];

// If this workspace is reopened FROM the results screen ("← Edit sketch"), doGenerate() below
// hands results a fresh closure over openSketchWorkspace as its onEditSketch callback — that
// keeps the dependency one-directional (workspace -> results), never circular. Also carries the
// energy choice back in the same way, so re-editing a sketch doesn't silently reset it to Normal.
export function openSketchWorkspace(initialStrokes = null, {
  initialEnergyLevel = 'normal', initialColorDabs = null, initialDensityDabs = null, initialMotionArrows = null,
} = {}) {
  if (overlay) return;

  let strokes = cloneStrokes(initialStrokes);
  let currentStroke = null;
  let energyLevel = ENERGY_LEVELS.includes(initialEnergyLevel) ? initialEnergyLevel : 'normal';
  let panX = 0, panY = 0, zoom = 1;
  let brushSize = 10; // world units — doubles as color/density-dab radius on those layers
  let eraserMode = false;
  let panDrag = null;
  let erasing = false;
  let spaceHeld = false;
  let currentTool = 'freehand';
  let dragStart = null; // world-space anchor for line/circle/ellipse/rect/spiral/arrow/lightning
  let bezierPts = []; // in-progress click-to-add-point path
  let lastBezierClick = 0;
  let currentLayer = 'shape'; // 'shape' | 'color' | 'density' | 'motion' — active canvas-painting mode
  let colorDabs = (initialColorDabs || []).map((d) => ({ ...d })); // { x, y, radius, hex }
  let currentColor = '#7c8cff';
  let paintingColor = false;
  let densityDabs = (initialDensityDabs || []).map((d) => ({ ...d })); // { x, y, radius, intensity }
  let currentIntensity = 0.7;
  let paintingDensity = false;
  let motionArrows = (initialMotionArrows || []).map((a) => ({ origin: { ...a.origin }, dir: { ...a.dir }, magnitude: a.magnitude })); // { origin:{x,y}, dir:{x,y}, magnitude }
  let motionDragStart = null;
  const undoStack = [];
  const redoStack = [];

  const wrap = document.createElement('div');
  wrap.className = 'sketch-workspace';

  // SKETCH IT 2.0: which layer the canvas is currently painting into. Shape is the only layer
  // with its own tool palette (the freehand/line/circle/... shapes analyzeSketchStrokes() reads);
  // Color/Density paint dabs and Motion draws arrows into their own buffers entirely — none of the
  // four share canvas state, only the same physical canvas element (and Color/Density share the
  // same Brush-size control).
  const layerTabs = document.createElement('div');
  layerTabs.className = 'sketch-layer-tabs';
  const LAYER_TABS = [
    { id: 'shape', label: '✏ Shape' },
    { id: 'color', label: '🎨 Color' },
    { id: 'density', label: '⚫ Density' },
    { id: 'motion', label: '➡️ Motion' },
  ];
  const layerTabBtns = new Map();
  for (const lt of LAYER_TABS) {
    const b = toolButton(lt.label, `${lt.label.slice(2)} layer`);
    b.className = 'tb-btn sketch-layer-tab';
    b.addEventListener('click', () => setLayer(lt.id));
    layerTabs.appendChild(b);
    layerTabBtns.set(lt.id, b);
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'sketch-toolbar';

  const toolPalette = document.createElement('div');
  toolPalette.className = 'sketch-tool-palette';
  const toolButtons = new Map();
  for (const t of TOOLS) {
    const btn = toolButton(t.label, t.title);
    btn.className = 'tb-btn sketch-tool-btn';
    btn.addEventListener('click', () => setTool(t.id));
    toolPalette.appendChild(btn);
    toolButtons.set(t.id, btn);
  }

  const colorControls = document.createElement('div');
  colorControls.className = 'sketch-color-controls';
  const colorSwatch = document.createElement('input');
  colorSwatch.type = 'color';
  colorSwatch.className = 'fld sketch-color-swatch';
  colorSwatch.value = currentColor;
  colorSwatch.title = 'Paint color';
  colorSwatch.addEventListener('input', () => { currentColor = colorSwatch.value; });
  colorControls.appendChild(colorSwatch);

  // Density: "dark brush = high density, light brush = low density" (spec's own wording) — a
  // slider is more precise than trying to infer intensity from repeated overlapping strokes.
  const densityControls = document.createElement('div');
  densityControls.className = 'sketch-density-controls';
  const densityLabel = document.createElement('span');
  densityLabel.className = 'sketch-size-label';
  densityLabel.textContent = 'Intensity';
  const densitySlider = document.createElement('input');
  densitySlider.type = 'range';
  densitySlider.className = 'fld sketch-density-slider';
  densitySlider.min = '0.05'; densitySlider.max = '1'; densitySlider.step = '0.05';
  densitySlider.value = String(currentIntensity);
  densitySlider.title = 'Density brush intensity — dark/heavy = dense, light = sparse';
  densitySlider.addEventListener('input', () => { currentIntensity = Number(densitySlider.value); });
  densityControls.append(densityLabel, densitySlider);

  const undoBtn = toolButton('↶', 'Undo (Ctrl+Z)');
  const redoBtn = toolButton('↷', 'Redo (Ctrl+Y)');
  const eraserBtn = toolButton('🧹', 'Eraser (E)');
  const clearBtn = toolButton('🗑 Clear', 'Clear the canvas — Ctrl+Z restores it, no confirmation needed');

  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'sketch-size-wrap';
  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'sketch-size-label';
  sizeLabel.textContent = 'Brush';
  const sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.className = 'fld sketch-size-slider';
  sizeSlider.min = '2';
  sizeSlider.max = '40';
  sizeSlider.step = '1';
  sizeSlider.value = String(brushSize);
  sizeSlider.title = 'Brush size ( [ and ] also work)';
  sizeWrap.append(sizeLabel, sizeSlider);

  // Energy layer (SKETCH IT 2.0): a single global 4-way chip, not a paintable brush — modifies
  // brightness/glow/emission/particle-size/shake internally (interpretEnergy in sketchIntent.js),
  // never exposing raw Roblox properties to the user, per the spec's explicit instruction.
  const energyWrap = document.createElement('div');
  energyWrap.className = 'sketch-size-wrap';
  const energyLabel = document.createElement('span');
  energyLabel.className = 'sketch-size-label';
  energyLabel.textContent = 'Energy';
  const energyChips = document.createElement('div');
  energyChips.className = 'sketch-energy-chips';
  const energyBtns = new Map();
  for (const lvl of ENERGY_LEVELS) {
    const b = toolButton(lvl[0].toUpperCase(), `Energy: ${lvl} — how bright/intense the generated effect feels`);
    b.className = 'tb-btn sketch-energy-btn';
    b.addEventListener('click', () => setEnergy(lvl));
    energyChips.appendChild(b);
    energyBtns.set(lvl, b);
  }
  energyWrap.append(energyLabel, energyChips);

  const hint = document.createElement('div');
  hint.className = 'sketch-hint';
  hint.textContent = 'Draw the rough shape of an idea, or pick a tool — Cadence imagines the rest.';

  const spacer = document.createElement('div');
  spacer.className = 'spacer';

  const generateBtn = document.createElement('button');
  generateBtn.className = 'tb-btn primary sketch-generate-btn';
  generateBtn.textContent = '✨ Generate';
  generateBtn.title = 'Analyze the sketch and imagine ~30 VFX interpretations';

  toolbar.append(layerTabs, toolPalette, colorControls, densityControls, undoBtn, redoBtn, eraserBtn, sizeWrap, energyWrap, clearBtn, hint, spacer, generateBtn);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'sketch-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'sketch-canvas';
  canvas.tabIndex = -1;
  canvasWrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  wrap.append(toolbar, canvasWrap);

  function worldToScreen(x, y) {
    return { x: (x + panX) * zoom + canvas.clientWidth / 2, y: (y + panY) * zoom + canvas.clientHeight / 2 };
  }
  function screenToWorld(x, y) {
    return { x: (x - canvas.clientWidth / 2) / zoom - panX, y: (y - canvas.clientHeight / 2) / zoom - panY };
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.floor(w * dpr)), ph = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = palette();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = P.paper;
    ctx.fillRect(0, 0, w, h);

    const spacing = 40 * zoom;
    if (spacing >= 8) {
      const origin = worldToScreen(0, 0);
      const startX = ((origin.x % spacing) + spacing) % spacing;
      const startY = ((origin.y % spacing) + spacing) % spacing;
      ctx.fillStyle = P.grid;
      for (let x = startX; x < w; x += spacing) {
        for (let y = startY; y < h; y += spacing) {
          ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    drawColorDabs(); // under the ink strokes — reads as a color wash beneath the clean shape guides
    drawDensityDabs();
    drawMotionArrows(P);

    ctx.strokeStyle = P.ink;
    ctx.fillStyle = P.ink;
    for (const s of strokes) drawStroke(s);
    if (currentStroke && currentLayer !== 'motion') drawStroke(currentStroke);
  }

  // Committed arrows render in the accent color (distinct from Shape-layer ink) so it's always
  // visually clear which arrows describe motion intent vs. the Shape tab's own Arrow tool.
  function drawMotionArrows(P) {
    ctx.strokeStyle = P.accent;
    ctx.fillStyle = P.accent;
    for (const a of motionArrows) {
      const len = 20 + a.magnitude * 60;
      const from = { x: a.origin.x, y: a.origin.y };
      const to = { x: a.origin.x + a.dir.x * len, y: a.origin.y + a.dir.y * len };
      const sFrom = worldToScreen(from.x, from.y), sTo = worldToScreen(to.x, to.y);
      ctx.lineWidth = Math.max(1.5, 3 * zoom);
      ctx.beginPath(); ctx.moveTo(sFrom.x, sFrom.y); ctx.lineTo(sTo.x, sTo.y); ctx.stroke();
      drawArrowhead(from, to);
    }
    if (currentLayer === 'motion' && currentStroke) drawStroke(currentStroke); // live drag preview, same accent color
  }

  function drawColorDabs() {
    for (const d of colorDabs) {
      const s = worldToScreen(d.x, d.y);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = d.hex;
      ctx.beginPath(); ctx.arc(s.x, s.y, d.radius * zoom, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawDensityDabs() {
    // Dark/opaque = high painted intensity, light/faint = low — matches the spec's own wording.
    for (const d of densityDabs) {
      const s = worldToScreen(d.x, d.y);
      ctx.globalAlpha = 0.15 + d.intensity * 0.55;
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.arc(s.x, s.y, d.radius * zoom, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function widthFor(pt) { return Math.max(1, brushSize * (0.5 + 0.5 * (pt.p ?? 0.5)) * zoom); }

  function drawStroke(stroke) {
    const pts = stroke.points;
    if (!pts.length) return;
    if (pts.length === 1) {
      const s = worldToScreen(pts[0].x, pts[0].y);
      ctx.beginPath(); ctx.arc(s.x, s.y, widthFor(pts[0]) / 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = worldToScreen(pts[i - 1].x, pts[i - 1].y);
      const b = worldToScreen(pts[i].x, pts[i].y);
      ctx.lineWidth = widthFor(pts[i]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (stroke.tool === 'arrow') drawArrowhead(pts[pts.length - 2], pts[pts.length - 1]);
  }

  function drawArrowhead(from, to) {
    const a = worldToScreen(from.x, from.y), b = worldToScreen(to.x, to.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = Math.max(10, widthFor(to) * 3);
    const spread = Math.PI / 7;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - headLen * Math.cos(angle - spread), b.y - headLen * Math.sin(angle - spread));
    ctx.lineTo(b.x - headLen * Math.cos(angle + spread), b.y - headLen * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fill();
  }

  function capturePoint(e) {
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const pressure = e.pointerType === 'pen' && Number.isFinite(e.pressure) && e.pressure > 0 ? e.pressure : 0.5;
    return { x: world.x, y: world.y, p: pressure, t: performance.now() };
  }

  function pushLocalUndo() {
    undoStack.push({
      strokes: strokes.map((s) => ({ points: s.points.slice(), tool: s.tool, params: s.params ? { ...s.params } : null })),
      colorDabs: colorDabs.map((d) => ({ ...d })),
      densityDabs: densityDabs.map((d) => ({ ...d })),
      motionArrows: motionArrows.map((a) => ({ origin: { ...a.origin }, dir: { ...a.dir }, magnitude: a.magnitude })),
    });
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  function localUndo() {
    // Bezier-in-progress: undo removes the last clicked point instead of touching the committed
    // stroke history — the in-progress path never lands on the global undo stack until finished.
    if (bezierPts.length) {
      bezierPts.pop();
      currentStroke = bezierPts.length ? bezierGuide(bezierPts) : null;
      draw();
      return true;
    }
    if (!undoStack.length) return false;
    redoStack.push({ strokes, colorDabs, densityDabs, motionArrows });
    const snap = undoStack.pop();
    strokes = snap.strokes;
    colorDabs = snap.colorDabs;
    densityDabs = snap.densityDabs;
    motionArrows = snap.motionArrows;
    draw();
    return true;
  }
  function localRedo() {
    if (!redoStack.length) return false;
    undoStack.push({ strokes, colorDabs, densityDabs, motionArrows });
    const snap = redoStack.pop();
    strokes = snap.strokes;
    colorDabs = snap.colorDabs;
    densityDabs = snap.densityDabs;
    motionArrows = snap.motionArrows;
    draw();
    return true;
  }

  function eraseAt(worldPos, radius) {
    let changed = false;
    const next = [];
    for (const stroke of strokes) {
      let run = [];
      let touched = false;
      for (const p of stroke.points) {
        if (Math.hypot(p.x - worldPos.x, p.y - worldPos.y) <= radius) {
          touched = true;
          if (run.length) next.push({ points: run });
          run = [];
        } else {
          run.push(p);
        }
      }
      if (run.length) next.push({ points: run });
      if (touched) changed = true;
    }
    if (changed) strokes = next;
    return changed;
  }

  function updateCursor() {
    if (currentLayer === 'color' || currentLayer === 'density') { canvas.style.cursor = 'crosshair'; return; }
    if (currentLayer === 'motion') { canvas.style.cursor = 'copy'; return; }
    canvas.style.cursor = eraserMode ? 'cell' : (currentTool === 'freehand' ? 'crosshair' : 'copy');
  }
  function setEraser(on) {
    eraserMode = on;
    if (on && currentTool !== 'freehand') setTool('freehand', { keepEraser: true });
    eraserBtn.classList.toggle('active', eraserMode);
    updateCursor();
  }
  function setTool(id, { keepEraser = false } = {}) {
    if (bezierPts.length && id !== 'bezier') finishBezier();
    currentTool = id;
    if (!keepEraser && eraserMode) { eraserMode = false; eraserBtn.classList.remove('active'); }
    for (const [tid, btn] of toolButtons) btn.classList.toggle('active', tid === id);
    updateCursor();
  }
  function setBrushSize(v) {
    brushSize = Math.max(2, Math.min(40, v));
    sizeSlider.value = String(brushSize);
  }
  function setEnergy(lvl) {
    energyLevel = lvl;
    for (const [l, b] of energyBtns) b.classList.toggle('active', l === lvl);
  }
  function setLayer(id) {
    if (bezierPts.length) finishBezier();
    currentLayer = id;
    for (const [lid, b] of layerTabBtns) b.classList.toggle('active', lid === id);
    toolPalette.classList.toggle('hidden', id !== 'shape');
    colorControls.classList.toggle('hidden', id !== 'color');
    densityControls.classList.toggle('hidden', id !== 'density');
    eraserBtn.disabled = id !== 'shape'; // erasing paint dabs isn't supported yet — Undo/Clear cover it
    updateCursor();
    draw();
  }

  function finishBezier() {
    if (bezierPts.length >= 2) {
      pushLocalUndo();
      strokes.push(bezierGuide(bezierPts));
    }
    bezierPts = [];
    currentStroke = null;
    draw();
  }

  function paintColorDab(e) {
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    colorDabs.push({ x: world.x, y: world.y, radius: brushSize, hex: currentColor });
    draw();
  }
  function paintDensityDab(e) {
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    densityDabs.push({ x: world.x, y: world.y, radius: brushSize, intensity: currentIntensity });
    draw();
  }

  function onPointerDown(e) {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceHeld) {
      panDrag = { lastX: e.clientX, lastY: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    if (currentLayer === 'color') {
      pushLocalUndo();
      paintingColor = true;
      paintColorDab(e);
      return;
    }
    if (currentLayer === 'density') {
      pushLocalUndo();
      paintingDensity = true;
      paintDensityDab(e);
      return;
    }
    if (currentLayer === 'motion') {
      const rect = canvas.getBoundingClientRect();
      motionDragStart = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    if (eraserMode) {
      pushLocalUndo();
      erasing = true;
      const rect = canvas.getBoundingClientRect();
      eraseAt(screenToWorld(e.clientX - rect.left, e.clientY - rect.top), brushSize * 1.8);
      draw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (currentTool === 'bezier') {
      const now = performance.now();
      if (bezierPts.length && now - lastBezierClick < 350 && dist(world, bezierPts[bezierPts.length - 1]) < 12 / zoom) {
        finishBezier();
        lastBezierClick = 0;
        return;
      }
      lastBezierClick = now;
      bezierPts.push(world);
      currentStroke = bezierGuide(bezierPts);
      draw();
      return;
    }
    if (DRAG_TOOLS[currentTool]) {
      pushLocalUndo();
      dragStart = world;
      currentStroke = DRAG_TOOLS[currentTool](world, world);
      draw();
      return;
    }
    pushLocalUndo();
    currentStroke = { points: [capturePoint(e)], tool: null, params: null };
    draw();
  }
  function onPointerMove(e) {
    if (panDrag) {
      panX += (e.clientX - panDrag.lastX) / zoom;
      panY += (e.clientY - panDrag.lastY) / zoom;
      panDrag.lastX = e.clientX; panDrag.lastY = e.clientY;
      draw();
      return;
    }
    if (paintingColor) {
      paintColorDab(e);
      return;
    }
    if (paintingDensity) {
      paintDensityDab(e);
      return;
    }
    if (motionDragStart) {
      // Reuses the Shape tab's own arrow guide + arrowhead rendering purely for the live preview —
      // this in-progress "stroke" is never committed to `strokes`, only converted to a
      // {origin,dir,magnitude} entry in motionArrows on release.
      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      currentStroke = arrowGuide(motionDragStart, world);
      draw();
      return;
    }
    if (erasing) {
      const rect = canvas.getBoundingClientRect();
      eraseAt(screenToWorld(e.clientX - rect.left, e.clientY - rect.top), brushSize * 1.8);
      draw();
      return;
    }
    if (dragStart && DRAG_TOOLS[currentTool]) {
      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      currentStroke = DRAG_TOOLS[currentTool](dragStart, world);
      draw();
      return;
    }
    if (currentStroke && currentTool === 'freehand') {
      currentStroke.points.push(capturePoint(e));
      draw();
    }
  }
  function onPointerUp() {
    if (panDrag) { panDrag = null; updateCursor(); return; }
    if (paintingColor) { paintingColor = false; return; }
    if (paintingDensity) { paintingDensity = false; return; }
    if (motionDragStart) {
      if (currentStroke) {
        const p0 = currentStroke.points[0], p1 = currentStroke.points[currentStroke.points.length - 1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-3) {
          pushLocalUndo();
          motionArrows.push({ origin: { x: p0.x, y: p0.y }, dir: { x: dx / len, y: dy / len }, magnitude: Math.max(0.2, Math.min(1, len / 100)) });
        }
      }
      motionDragStart = null;
      currentStroke = null;
      draw();
      return;
    }
    if (erasing) { erasing = false; return; }
    if (currentTool === 'bezier') return; // commits via finishBezier(), not on pointerup
    if (dragStart && DRAG_TOOLS[currentTool]) {
      dragStart = null;
      if (currentStroke) { strokes.push(currentStroke); currentStroke = null; draw(); }
      return;
    }
    if (currentStroke) {
      // Free Sketch only: clean the raw capture into an editable guide (spec's "messy circle ->
      // perfect editable circle" step) before it ever joins the committed stroke list.
      strokes.push(recognizeStroke(currentStroke.points));
      currentStroke = null;
      draw();
    }
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      const worldAtMouse = screenToWorld(mx, my);
      const factor = e.deltaY > 0 ? 0.88 : 1.14;
      zoom = Math.max(0.15, Math.min(6, zoom * factor));
      panX = (mx - canvas.clientWidth / 2) / zoom - worldAtMouse.x;
      panY = (my - canvas.clientHeight / 2) / zoom - worldAtMouse.y;
    } else {
      panX -= e.deltaX / zoom;
      panY -= e.deltaY / zoom;
    }
    draw();
  }
  function onKeyDown(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      if (!localUndo()) toast('Nothing to undo');
    } else if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault(); e.stopPropagation();
      if (!localRedo()) toast('Nothing to redo');
    } else if (e.code === 'Space') {
      e.preventDefault(); e.stopPropagation();
      spaceHeld = true;
      canvas.style.cursor = 'grab';
    } else if (e.key === '[') {
      e.stopPropagation();
      setBrushSize(brushSize - 2);
    } else if (e.key === ']') {
      e.stopPropagation();
      setBrushSize(brushSize + 2);
    } else if (e.key.toLowerCase() === 'e') {
      e.stopPropagation();
      setEraser(!eraserMode);
    } else if (e.key === 'Enter' && currentTool === 'bezier' && bezierPts.length >= 2) {
      e.preventDefault(); e.stopPropagation();
      finishBezier();
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (currentTool === 'bezier' && bezierPts.length) {
        bezierPts = []; currentStroke = null; draw(); // cancel the in-progress path, don't close
      } else {
        close();
      }
    }
  }
  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceHeld = false;
      updateCursor();
    }
  }

  function doClear() {
    if (!strokes.length && !currentStroke && !bezierPts.length && !colorDabs.length && !densityDabs.length && !motionArrows.length) return;
    pushLocalUndo();
    strokes = [];
    currentStroke = null;
    bezierPts = [];
    colorDabs = [];
    densityDabs = [];
    motionArrows = [];
    draw();
    toast('Canvas cleared — Ctrl+Z restores it');
  }

  function doGenerate() {
    if (bezierPts.length) finishBezier(); // never silently drop an in-progress path
    const real = strokes.filter((s) => s.points.length);
    if (!real.length) { toast('Draw something first — even a quick doodle works!'); return; }
    const snapshot = cloneStrokes(real);
    const colorSnapshot = colorDabs.map((d) => ({ ...d }));
    const densitySnapshot = densityDabs.map((d) => ({ ...d }));
    const motionSnapshot = motionArrows.map((a) => ({ origin: { ...a.origin }, dir: { ...a.dir }, magnitude: a.magnitude }));
    close();
    import('./sketchResults.js').then(({ openSketchResults }) => {
      openSketchResults(snapshot, {
        energyLevel,
        colorDabs: colorSnapshot,
        densityDabs: densitySnapshot,
        motionArrows: motionSnapshot,
        onEditSketch: () => openSketchWorkspace(snapshot, {
          initialEnergyLevel: energyLevel, initialColorDabs: colorSnapshot, initialDensityDabs: densitySnapshot, initialMotionArrows: motionSnapshot,
        }),
      });
    });
  }

  undoBtn.addEventListener('click', () => { if (!localUndo()) toast('Nothing to undo'); });
  redoBtn.addEventListener('click', () => { if (!localRedo()) toast('Nothing to redo'); });
  eraserBtn.addEventListener('click', () => setEraser(!eraserMode));
  clearBtn.addEventListener('click', doClear);
  sizeSlider.addEventListener('input', () => setBrushSize(Number(sizeSlider.value)));
  generateBtn.addEventListener('click', doGenerate);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  toolButtons.get('freehand').classList.add('active');
  energyBtns.get(energyLevel).classList.add('active');
  layerTabBtns.get('shape').classList.add('active');
  colorControls.classList.add('hidden');
  densityControls.classList.add('hidden');
  updateCursor();

  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(canvasWrap);

  const m = modal({
    title: '✏ Sketch It',
    body: wrap,
    actions: [],
    onClose: () => {
      window.removeEventListener('pointerup', onPointerUp);
      resizeObserver.disconnect();
      overlay = null;
    },
  });
  overlay = m;
  function close() { m.close(); }

  setTimeout(() => { canvas.focus(); draw(); }, 60);
}
