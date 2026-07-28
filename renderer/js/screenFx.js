// Screen effects — a port of Moon Animator 2's Item > Add Effects menu
// (Vignette, Letterboxing, Screen Cover, Subtitles).
//
// Moon implements these as real ScreenGui objects parented into Studio, then adds them to the
// timeline as ordinary items with property tracks. Cadence does the same thing structurally:
// each effect is a `prop` item of the matching Roblox class, so it inherits property tracks,
// keyframing, easing, the inspector and the Luau exporter for free. The only extra pieces are
// the `screenEffect` tag identifying which preset it is, the DOM overlay that previews it over
// the viewport, and the exporter preamble that BUILDS the GUI (unlike other prop items, these
// instances do not already exist in the user's game).

import * as S from './state.js';

// Each preset maps to the Roblox class Moon uses, with the tracks it drives.
export const SCREEN_EFFECTS = {
  vignette: {
    label: 'Vignette',
    className: 'ImageLabel',
    // Moon animates only ImageTransparency; the image itself is a static radial gradient.
    tracks: { ImageTransparency: 0.2, ImageColor3: [0, 0, 0] },
    defaultName: 'Vignette',
  },
  letterbox: {
    label: 'Letterboxing',
    className: 'Frame',
    tracks: { BackgroundTransparency: 0, BackgroundColor3: [0, 0, 0] },
    defaultName: 'Letterbox',
    // Extra non-animated geometry: how tall each bar is, as a fraction of the screen.
    statics: { barScale: 0.12 },
  },
  cover: {
    label: 'Screen Cover',
    className: 'Frame',
    tracks: { BackgroundTransparency: 1, BackgroundColor3: [0, 0, 0] },
    defaultName: 'Screen Cover',
  },
  subtitles: {
    label: 'Subtitles',
    className: 'TextLabel',
    // MaxVisibleGraphemes is Moon's typewriter control: -1 shows everything, 0..n reveals
    // that many characters, so a numeric track "types" the line out.
    tracks: { Text: '', MaxVisibleGraphemes: -1, TextTransparency: 0, TextColor3: [1, 1, 1] },
    defaultName: 'Subtitles',
    statics: { autoSize: true },
  },
};

export const SCREEN_EFFECT_KEYS = Object.keys(SCREEN_EFFECTS);

export function addScreenEffect(kind) {
  const spec = SCREEN_EFFECTS[kind];
  if (!spec) return null;
  // One of each, matching Moon (its Add Effects entries no-op if the item already exists).
  const existing = S.state.project.items.find((i) => i.screenEffect === kind);
  if (existing) return existing;

  const item = S.addPropItem({
    name: spec.defaultName,
    className: spec.className,
    target: `ScreenFx.${spec.defaultName}`,
    withDefaults: false,
  });
  item.screenEffect = kind;
  if (spec.statics) item.fxStatics = { ...spec.statics };
  // Seed one keyframe per track at frame 0 so the effect is visible and immediately keyable.
  for (const [prop, value] of Object.entries(spec.tracks)) {
    S.addPropertyTrack(item.id, prop, { noUndo: true });
    S.setKey(item.id, prop, 0, Array.isArray(value) ? value.slice() : value, { noUndo: true });
  }
  S.emit('items');
  S.emit('tracks', {});
  return item;
}

// ---------------------------------------------------------------- viewport overlay
let layer = null;

export function initScreenFx() {
  layer = document.getElementById('screenFx');
  if (!layer) return;
  ['tracks', 'items', 'project', 'playhead', 'project-props'].forEach((ev) => S.on(ev, scheduleDraw));
  scheduleDraw();
}

let pending = false;
function scheduleDraw() {
  if (pending || !layer) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; draw(); });
}

function rgb(c) {
  const [r, g, b] = (Array.isArray(c) ? c : [0, 0, 0]).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return `${r}, ${g}, ${b}`;
}

function draw() {
  if (!layer || !S.state.project) return;
  layer.replaceChildren();
  const t = S.state.playhead;
  for (const item of S.state.project.items) {
    if (!item.screenEffect) continue;
    const spec = SCREEN_EFFECTS[item.screenEffect];
    if (!spec) continue;
    const val = (prop, fallback) => {
      const tr = S.getTrack(item.id, prop);
      if (!tr || !tr.keys.length) return fallback;
      return S.evalTrackValue(item.id, prop, t, fallback);
    };
    // Styles are set through the CSSOM, never an inline style="" attribute in an HTML string —
    // the app's CSP silently drops those, which has bitten this codebase repeatedly.
    if (item.screenEffect === 'vignette') {
      const el = document.createElement('div');
      el.className = 'fx-vignette';
      const alpha = 1 - Math.max(0, Math.min(1, val('ImageTransparency', 0.2)));
      el.style.background = `radial-gradient(ellipse at center, rgba(${rgb(val('ImageColor3', [0, 0, 0]))},0) 45%, rgba(${rgb(val('ImageColor3', [0, 0, 0]))},${alpha}) 100%)`;
      layer.appendChild(el);
    } else if (item.screenEffect === 'letterbox') {
      const alpha = 1 - Math.max(0, Math.min(1, val('BackgroundTransparency', 0)));
      const color = `rgba(${rgb(val('BackgroundColor3', [0, 0, 0]))},${alpha})`;
      const h = ((item.fxStatics?.barScale ?? 0.12) * 100) + '%';
      for (const edge of ['top', 'bottom']) {
        const bar = document.createElement('div');
        bar.className = 'fx-letterbox ' + edge;
        bar.style.height = h;
        bar.style.background = color;
        layer.appendChild(bar);
      }
    } else if (item.screenEffect === 'cover') {
      const el = document.createElement('div');
      el.className = 'fx-cover';
      const alpha = 1 - Math.max(0, Math.min(1, val('BackgroundTransparency', 1)));
      el.style.background = `rgba(${rgb(val('BackgroundColor3', [0, 0, 0]))},${alpha})`;
      layer.appendChild(el);
    } else if (item.screenEffect === 'subtitles') {
      const text = String(val('Text', '') ?? '');
      if (!text) continue;
      const el = document.createElement('div');
      el.className = 'fx-subtitles';
      // MaxVisibleGraphemes: -1 means "all", otherwise reveal that many characters.
      const maxG = Math.round(val('MaxVisibleGraphemes', -1));
      el.textContent = maxG >= 0 ? [...text].slice(0, maxG).join('') : text;
      const alpha = 1 - Math.max(0, Math.min(1, val('TextTransparency', 0)));
      el.style.color = `rgba(${rgb(val('TextColor3', [1, 1, 1]))},${alpha})`;
      // Moon's SubtitlesAutoSize scales the text with the viewport (72px at 1080p).
      if (item.fxStatics?.autoSize !== false) {
        el.style.fontSize = Math.max(11, Math.round((28 / 1080) * layer.clientHeight)) + 'px';
      }
      layer.appendChild(el);
    }
  }
}

// ---------------------------------------------------------------- Luau construction
// Unlike an ordinary prop item, a screen effect's instance does not exist in the user's game —
// the exported script has to build it. This emits that preamble; the generic property-track
// exporter then drives the instances it created, addressing them by the same path.
export function buildScreenFxPreambleLua(items) {
  const fx = items.filter((i) => i.screenEffect && SCREEN_EFFECTS[i.screenEffect]);
  if (!fx.length) return '';
  const L = [];
  L.push('-- Screen effects: build the ScreenGui these tracks drive.');
  L.push('local _fxParent = game:GetService("Players").LocalPlayer');
  L.push('\tand game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")');
  L.push('\tor game:GetService("StarterGui")');
  L.push('local ScreenFx = Instance.new("ScreenGui")');
  L.push('ScreenFx.Name = "ScreenFx"');
  L.push('ScreenFx.ResetOnSpawn = false');
  L.push('ScreenFx.IgnoreGuiInset = true');
  L.push('ScreenFx.DisplayOrder = 100');
  L.push('ScreenFx.Parent = _fxParent');
  for (const item of fx) {
    const spec = SCREEN_EFFECTS[item.screenEffect];
    const v = `_fx_${item.screenEffect}`;
    L.push(`local ${v} = Instance.new("${spec.className}")`);
    L.push(`${v}.Name = ${JSON.stringify(spec.defaultName)}`);
    L.push(`${v}.BorderSizePixel = 0`);
    // Register under the item's own target path so resolve() finds it — these live under
    // PlayerGui, which a path walk from `game` would never reach.
    L.push(`_built[${JSON.stringify(item.target)}] = ${v}`);
    if (item.screenEffect === 'letterbox') {
      const bar = item.fxStatics?.barScale ?? 0.12;
      // Two bars share one animated parent Frame, so a single set of tracks drives both —
      // the same trick Moon uses (its Letterbox mirrors properties onto the Top frame).
      L.push(`${v}.Size = UDim2.fromScale(1, ${bar})`);
      L.push(`${v}.Position = UDim2.fromScale(0, 0)`);
      L.push(`${v}.Parent = ScreenFx`);
      L.push(`local ${v}_b = ${v}:Clone()`);
      L.push(`${v}_b.Position = UDim2.fromScale(0, ${1 - bar})`);
      L.push(`${v}_b.Parent = ScreenFx`);
      L.push(`${v}:GetPropertyChangedSignal("BackgroundTransparency"):Connect(function() ${v}_b.BackgroundTransparency = ${v}.BackgroundTransparency end)`);
      L.push(`${v}:GetPropertyChangedSignal("BackgroundColor3"):Connect(function() ${v}_b.BackgroundColor3 = ${v}.BackgroundColor3 end)`);
      continue;
    }
    L.push(`${v}.Size = UDim2.fromScale(1, 1)`);
    if (item.screenEffect === 'vignette') {
      L.push(`${v}.BackgroundTransparency = 1`);
      L.push(`${v}.Image = "rbxassetid://5028857472"`); // Roblox's stock radial gradient
      L.push(`${v}.ScaleType = Enum.ScaleType.Stretch`);
    } else if (item.screenEffect === 'subtitles') {
      L.push(`${v}.BackgroundTransparency = 1`);
      L.push(`${v}.Size = UDim2.fromScale(0.8, 0.15)`);
      L.push(`${v}.Position = UDim2.fromScale(0.1, 0.8)`);
      L.push(`${v}.Font = Enum.Font.GothamMedium`);
      L.push(`${v}.TextScaled = ${item.fxStatics?.autoSize !== false ? 'true' : 'false'}`);
      L.push(`${v}.TextWrapped = true`);
      L.push(`${v}.TextStrokeTransparency = 0.5`);
    }
    L.push(`${v}.Parent = ScreenFx`);
  }
  L.push('');
  return L.join('\n');
}
