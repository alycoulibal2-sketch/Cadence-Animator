// Draggable dividers for the explorer/inspector/timeline panels. Sizes persist across
// relaunches the same way other UI prefs do (settings.json via window.cadence.setSettings).

const DEFAULTS = { explorerWidth: 250, inspectorWidth: 250, timelineHeight: 300 };
const CLAMP = {
  explorerWidth: [160, 560],
  inspectorWidth: [160, 560],
  timelineHeight: [140, () => Math.round(window.innerHeight * 0.8)],
};

function clamp(key, value) {
  const [min, max] = CLAMP[key];
  const hi = typeof max === 'function' ? max() : max;
  return Math.max(min, Math.min(hi, value));
}

function makeDragger({ handle, axis, onDrag, onEnd }) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const start = axis === 'x' ? e.clientX : e.clientY;
    const move = (me) => {
      const cur = axis === 'x' ? me.clientX : me.clientY;
      onDrag(cur - start);
    };
    const up = (ue) => {
      handle.releasePointerCapture(ue.pointerId);
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      onEnd?.();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

export function initPanels(settings, persist) {
  const sizes = {
    explorerWidth: settings.explorerWidth ?? DEFAULTS.explorerWidth,
    inspectorWidth: settings.inspectorWidth ?? DEFAULTS.inspectorWidth,
    timelineHeight: settings.timelineHeight ?? DEFAULTS.timelineHeight,
  };

  const explorer = document.getElementById('explorer');
  const inspector = document.getElementById('inspector');
  const timelinePanel = document.getElementById('timelinePanel');

  explorer.style.width = sizes.explorerWidth + 'px';
  inspector.style.width = sizes.inspectorWidth + 'px';
  timelinePanel.style.height = sizes.timelineHeight + 'px';

  let startExplorerW = sizes.explorerWidth;
  makeDragger({
    handle: document.getElementById('explorerResizer'),
    axis: 'x',
    onDrag: (dx) => {
      sizes.explorerWidth = clamp('explorerWidth', startExplorerW + dx);
      explorer.style.width = sizes.explorerWidth + 'px';
    },
    onEnd: () => { startExplorerW = sizes.explorerWidth; persist(sizes); },
  });

  let startInspectorW = sizes.inspectorWidth;
  makeDragger({
    handle: document.getElementById('inspectorResizer'),
    axis: 'x',
    onDrag: (dx) => {
      // dragging right shrinks the inspector (it's on the right edge), so invert dx
      sizes.inspectorWidth = clamp('inspectorWidth', startInspectorW - dx);
      inspector.style.width = sizes.inspectorWidth + 'px';
    },
    onEnd: () => { startInspectorW = sizes.inspectorWidth; persist(sizes); },
  });

  let startTimelineH = sizes.timelineHeight;
  makeDragger({
    handle: document.getElementById('timelineResizer'),
    axis: 'y',
    onDrag: (dy) => {
      // dragging down shrinks the timeline (it's below the divider), so invert dy
      sizes.timelineHeight = clamp('timelineHeight', startTimelineH - dy);
      timelinePanel.style.height = sizes.timelineHeight + 'px';
    },
    onEnd: () => { startTimelineH = sizes.timelineHeight; persist(sizes); },
  });
}
