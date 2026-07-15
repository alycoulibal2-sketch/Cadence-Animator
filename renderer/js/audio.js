// Native audio track: decode, waveform peaks, synced playback, scrub blips.
import * as S from './state.js';

const au = {
  ctx: null,
  buffer: null,
  gain: null,
  source: null,
  peaks: null,       // { mins: Float32Array, maxs: Float32Array, buckets }
  duration: 0,
  scrubTimer: 0,
};

function ensureCtx() {
  if (!au.ctx) {
    au.ctx = new AudioContext();
    au.gain = au.ctx.createGain();
    au.gain.connect(au.ctx.destination);
  }
  return au.ctx;
}

export function hasAudio() { return !!au.buffer; }

export async function loadAudioFromPath(path, name) {
  ensureCtx();
  const data = await window.cadence.readFileBinary(path);
  const arr = data instanceof ArrayBuffer ? data : new Uint8Array(data.data || data).buffer;
  au.buffer = await au.ctx.decodeAudioData(arr.slice(0));
  au.duration = au.buffer.duration;
  computePeaks();
  S.pushUndo();
  S.state.project.audio = { name: name || 'Audio', path, offset: 0, volume: 1 };
  S.emit('audio');
  S.markDirty();
}

export async function restoreAudio() {
  const a = S.state.project?.audio;
  au.buffer = null;
  au.peaks = null;
  if (a && a.path) {
    try {
      ensureCtx();
      const data = await window.cadence.readFileBinary(a.path);
      const arr = data instanceof ArrayBuffer ? data : new Uint8Array(data.data || data).buffer;
      au.buffer = await au.ctx.decodeAudioData(arr.slice(0));
      au.duration = au.buffer.duration;
      computePeaks();
    } catch (e) {
      console.warn('audio restore failed', e);
    }
  }
  S.emit('audio');
}

export function removeAudio() {
  stop();
  au.buffer = null;
  au.peaks = null;
  S.pushUndo();
  S.state.project.audio = null;
  S.emit('audio');
  S.markDirty();
}

export function setAudioOffset(frames) {
  const a = S.state.project?.audio;
  if (!a) return;
  a.offset = frames;
  S.emit('audio');
  S.markDirty();
}

export function setAudioVolume(v) {
  const a = S.state.project?.audio;
  if (!a) return;
  a.volume = v;
  if (au.gain) au.gain.gain.value = v;
  S.emit('audio');
  S.markDirty();
}

function computePeaks() {
  const N = 8192;
  const ch = au.buffer.getChannelData(0);
  const per = Math.max(1, Math.floor(ch.length / N));
  const mins = new Float32Array(N), maxs = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let mn = 0, mx = 0;
    const s0 = i * per, s1 = Math.min(ch.length, s0 + per);
    for (let s = s0; s < s1; s += 4) {
      const v = ch[s];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    mins[i] = mn; maxs[i] = mx;
  }
  au.peaks = { mins, maxs, buckets: N };
}

// startTime/endTime in seconds relative to audio start; buckets = pixels
export function getWaveformSlice(startTime, endTime, buckets) {
  if (!au.peaks || !au.buffer) return null;
  const mins = new Float32Array(buckets), maxs = new Float32Array(buckets);
  const total = au.peaks.buckets;
  for (let i = 0; i < buckets; i++) {
    const t0 = startTime + ((endTime - startTime) * i) / buckets;
    const t1 = startTime + ((endTime - startTime) * (i + 1)) / buckets;
    const b0 = Math.floor((t0 / au.duration) * total);
    const b1 = Math.max(b0 + 1, Math.ceil((t1 / au.duration) * total));
    let mn = 0, mx = 0;
    if (b1 > 0 && b0 < total) {
      for (let b = Math.max(0, b0); b < Math.min(total, b1); b++) {
        if (au.peaks.mins[b] < mn) mn = au.peaks.mins[b];
        if (au.peaks.maxs[b] > mx) mx = au.peaks.maxs[b];
      }
    }
    mins[i] = mn; maxs[i] = mx;
  }
  return { mins, maxs };
}

export function stop() {
  if (au.source) {
    try { au.source.stop(); } catch (_) { }
    au.source = null;
  }
}

export function syncPlayback() {
  const p = S.state.project;
  stop();
  if (!au.buffer || !p?.audio || !S.state.playing) return;
  ensureCtx();
  if (au.ctx.state === 'suspended') au.ctx.resume();
  au.gain.gain.value = p.audio.volume ?? 1;
  const t = (S.state.playhead - (p.audio.offset || 0)) / p.fps;
  const src = au.ctx.createBufferSource();
  src.buffer = au.buffer;
  src.connect(au.gain);
  if (t >= 0 && t < au.duration) src.start(0, t);
  else if (t < 0) src.start(au.ctx.currentTime - t, 0);
  au.source = src;
}

// short blip while dragging the playhead over audio — lip-sync friendly scrubbing
export function scrubBlip() {
  const p = S.state.project;
  if (!au.buffer || !p?.audio || S.state.playing) return;
  const now = performance.now();
  if (now - au.scrubTimer < 70) return;
  au.scrubTimer = now;
  ensureCtx();
  if (au.ctx.state === 'suspended') au.ctx.resume();
  const t = (S.state.playhead - (p.audio.offset || 0)) / p.fps;
  if (t < 0 || t >= au.duration) return;
  stop();
  au.gain.gain.value = p.audio.volume ?? 1;
  const src = au.ctx.createBufferSource();
  src.buffer = au.buffer;
  src.connect(au.gain);
  src.start(0, t, 0.09);
  au.source = src;
}

export function initAudio() {
  S.on('playing', () => syncPlayback());
  S.on('playhead', () => {
    if (S.state.playing) return;
    scrubBlip();
  });
  S.on('project', () => restoreAudio());
}
