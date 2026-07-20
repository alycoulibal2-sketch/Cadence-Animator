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

let overlay = null; // non-null while a workspace session is open — openSketchWorkspace is a singleton

function palette() {
  const s = getComputedStyle(document.documentElement);
  return {
    paper: s.getPropertyValue('--bg-0').trim() || '#0a0a0e',
    grid: s.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)',
    ink: s.getPropertyValue('--text-0').trim() || '#f2f2f6',
    accent: s.getPropertyValue('--accent').trim() || '#7c8cff',
  };
}

function cloneStrokes(strokes) {
  return (strokes || []).map((s) => ({ points: s.points.map((p) => ({ ...p })) }));
}

function toolButton(label, title) {
  const b = document.createElement('button');
  b.className = 'tb-btn';
  b.textContent = label;
  b.title = title;
  return b;
}

// If this workspace is reopened FROM the results screen ("← Edit sketch"), doGenerate() below
// hands results a fresh closure over openSketchWorkspace as its onEditSketch callback — that
// keeps the dependency one-directional (workspace -> results), never circular.
export function openSketchWorkspace(initialStrokes = null) {
  if (overlay) return;

  let strokes = cloneStrokes(initialStrokes);
  let currentStroke = null;
  let panX = 0, panY = 0, zoom = 1;
  let brushSize = 10; // world units
  let eraserMode = false;
  let panDrag = null;
  let erasing = false;
  let spaceHeld = false;
  const undoStack = [];
  const redoStack = [];

  const wrap = document.createElement('div');
  wrap.className = 'sketch-workspace';

  const toolbar = document.createElement('div');
  toolbar.className = 'sketch-toolbar';

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

  const hint = document.createElement('div');
  hint.className = 'sketch-hint';
  hint.textContent = 'Draw the rough shape of an idea — Cadence imagines the rest.';

  const spacer = document.createElement('div');
  spacer.className = 'spacer';

  const generateBtn = document.createElement('button');
  generateBtn.className = 'tb-btn primary sketch-generate-btn';
  generateBtn.textContent = '✨ Generate';
  generateBtn.title = 'Analyze the sketch and imagine ~30 VFX interpretations';

  toolbar.append(undoBtn, redoBtn, eraserBtn, sizeWrap, clearBtn, hint, spacer, generateBtn);

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

    ctx.strokeStyle = P.ink;
    ctx.fillStyle = P.ink;
    for (const s of strokes) drawStroke(s);
    if (currentStroke) drawStroke(currentStroke);
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
  }

  function capturePoint(e) {
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const pressure = e.pointerType === 'pen' && Number.isFinite(e.pressure) && e.pressure > 0 ? e.pressure : 0.5;
    return { x: world.x, y: world.y, p: pressure, t: performance.now() };
  }

  function pushLocalUndo() {
    undoStack.push(strokes.map((s) => ({ points: s.points.slice() })));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  function localUndo() {
    if (!undoStack.length) return false;
    redoStack.push(strokes);
    strokes = undoStack.pop();
    draw();
    return true;
  }
  function localRedo() {
    if (!redoStack.length) return false;
    undoStack.push(strokes);
    strokes = redoStack.pop();
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

  function setEraser(on) {
    eraserMode = on;
    eraserBtn.classList.toggle('active', eraserMode);
    canvas.style.cursor = eraserMode ? 'cell' : 'crosshair';
  }
  function setBrushSize(v) {
    brushSize = Math.max(2, Math.min(40, v));
    sizeSlider.value = String(brushSize);
  }

  function onPointerDown(e) {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceHeld) {
      panDrag = { lastX: e.clientX, lastY: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    pushLocalUndo();
    if (eraserMode) {
      erasing = true;
      const rect = canvas.getBoundingClientRect();
      eraseAt(screenToWorld(e.clientX - rect.left, e.clientY - rect.top), brushSize * 1.8);
      draw();
      return;
    }
    currentStroke = { points: [capturePoint(e)] };
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
    if (erasing) {
      const rect = canvas.getBoundingClientRect();
      eraseAt(screenToWorld(e.clientX - rect.left, e.clientY - rect.top), brushSize * 1.8);
      draw();
      return;
    }
    if (currentStroke) {
      currentStroke.points.push(capturePoint(e));
      draw();
    }
  }
  function onPointerUp() {
    if (panDrag) { panDrag = null; canvas.style.cursor = eraserMode ? 'cell' : 'crosshair'; return; }
    if (erasing) { erasing = false; return; }
    if (currentStroke) {
      strokes.push(currentStroke);
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
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      close();
    }
  }
  function onKeyUp(e) {
    if (e.code === 'Space') {
      spaceHeld = false;
      canvas.style.cursor = eraserMode ? 'cell' : 'crosshair';
    }
  }

  function doClear() {
    if (!strokes.length && !currentStroke) return;
    pushLocalUndo();
    strokes = [];
    currentStroke = null;
    draw();
    toast('Canvas cleared — Ctrl+Z restores it');
  }

  function doGenerate() {
    const real = strokes.filter((s) => s.points.length);
    if (!real.length) { toast('Draw something first — even a quick doodle works!'); return; }
    const snapshot = cloneStrokes(real);
    close();
    import('./sketchResults.js').then(({ openSketchResults }) => {
      openSketchResults(snapshot, { onEditSketch: () => openSketchWorkspace(snapshot) });
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
  canvas.style.cursor = 'crosshair';

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
