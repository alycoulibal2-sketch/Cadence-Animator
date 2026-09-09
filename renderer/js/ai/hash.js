// Content addressing for the semantic layer.
//
// Directive Part 17 ("Scene snapshots") wants every accepted state to be recoverable and
// identifiable, and Part 16 wants a `version or revision` on every entity. Both need one thing:
// a stable, order-independent fingerprint of a plain-data value.
//
// Why a hand-rolled hash rather than SHA-256: this module has to run unchanged in three places —
// the Electron renderer, the Electron main process, and plain Node under `test/aitest.mjs`. The
// only SHA available in all three is `crypto.subtle`, which is async, and an async hash would
// force every graph projection and every `revision` field to become a promise. So: a 128-bit
// non-cryptographic hash, computed synchronously, four independent lanes.
//
// This is a CONTENT ADDRESS, not a security primitive. It is used to tell "have I already stored
// this exact state?" and "did this entity change?". It must never be used to prove a value was
// not tampered with.
//
// Collision budget, stated so nobody has to guess: at 10^5 distinct hashed values in a session,
// the birthday probability against 128 bits is about 1.5e-29. A caller that stores by hash and
// hits a collision would silently alias two states, so snapshot.js additionally compares the
// canonical stream length before treating two hashes as the same object.

// ---------------------------------------------------------------- canonical streaming
//
// The value is walked and emitted as a token stream rather than serialised to one big string:
// a real Cadence project can carry tens of megabytes of baked texture data URIs, and building a
// second copy of that as a JSON string just to hash it was not acceptable.
//
// The stream is UNAMBIGUOUS by construction — every string is length-prefixed and every value
// carries a type tag — so two structurally different values can never produce the same stream.
// That matters more than compactness: `{a:1}` and `{a:"1"}` must not collide by design, not by
// luck.

const TAG_NULL = 0x7a;      // 'z'
const TAG_UNDEF = 0x75;     // 'u'
const TAG_TRUE = 0x54;      // 'T'
const TAG_FALSE = 0x46;     // 'F'
const TAG_NUM = 0x6e;       // 'n'
const TAG_STR = 0x73;       // 's'
const TAG_ARR_OPEN = 0x5b;  // '['
const TAG_ARR_CLOSE = 0x5d; // ']'
const TAG_OBJ_OPEN = 0x7b;  // '{'
const TAG_OBJ_CLOSE = 0x7d; // '}'

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

// Four FNV-1a-style lanes with distinct 32-bit odd primes and distinct offset bases. Different
// PRIMES (not merely different seeds) is what keeps the lanes from moving together — same-prime
// lanes differing only by starting value stay correlated for the whole stream, which would make a
// 128-bit output no stronger than a 32-bit one. Each lane is finalised through murmur3's fmix32
// avalanche, because FNV's own per-byte diffusion is weak in the high bits.
const PRIMES = [16777619, 2166136261 | 0, 1000003, 2654435761 | 0].map((p) => p | 1);
const BASES = [2166136261, 0x811c9dc5 ^ 0x5bf03635, 0x9e3779b9, 0x85ebca6b];

function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

class Hasher {
  constructor() {
    this.h = BASES.slice();
    this.length = 0; // bytes consumed — see the collision note at the top of the file
  }

  byte(b) {
    this.length++;
    const h = this.h;
    for (let i = 0; i < 4; i++) h[i] = Math.imul(h[i] ^ (b & 0xff), PRIMES[i]);
  }

  bytes(arr) {
    for (let i = 0; i < arr.length; i++) this.byte(arr[i]);
  }

  // Length-prefixed so no string can impersonate a structural token, and UTF-8 encoded so the
  // same text hashes identically regardless of how the host represents it internally.
  str(s) {
    const enc = encoder ? encoder.encode(s) : latin1(s);
    this.u32(enc.length);
    this.bytes(enc);
  }

  u32(n) {
    const v = n >>> 0;
    this.byte(v & 0xff); this.byte((v >>> 8) & 0xff); this.byte((v >>> 16) & 0xff); this.byte((v >>> 24) & 0xff);
  }

  // Numbers go in as their exact IEEE-754 bits, so 1 and 1.0 agree (they are the same double) and
  // 0.1 + 0.2 does not agree with 0.3 (they are not). -0 is normalised to 0 first: JSON round-trips
  // -0 to 0, so treating them as different states would make a save/load cycle look like an edit.
  // NaN and ±Infinity survive a project only via a bug, but they are hashed distinctly rather than
  // thrown on, because a hash function is the wrong place to discover that.
  num(n) {
    const v = Object.is(n, -0) ? 0 : n;
    numBuf[0] = v;
    this.bytes(numBytes);
  }

  digest() {
    const out = this.h.map(fmix32);
    return out.map((x) => x.toString(16).padStart(8, '0')).join('');
  }
}

const numBuf = new Float64Array(1);
const numBytes = new Uint8Array(numBuf.buffer);

function latin1(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// Object keys are sorted so that two projects holding the same data in a different insertion
// order hash identically — the whole point of a content address. `undefined`-valued keys are
// dropped exactly as `JSON.stringify` drops them, because a project that has been through a
// save/load cycle will have lost them and must still match its in-memory original.
function walk(h, v, seen) {
  if (v === null) { h.byte(TAG_NULL); return; }
  const t = typeof v;
  if (t === 'undefined') { h.byte(TAG_UNDEF); return; }
  if (t === 'boolean') { h.byte(v ? TAG_TRUE : TAG_FALSE); return; }
  if (t === 'number') { h.byte(TAG_NUM); h.num(v); return; }
  if (t === 'string') { h.byte(TAG_STR); h.str(v); return; }
  if (t === 'bigint') { h.byte(TAG_STR); h.str(`bigint:${v}`); return; }
  if (t === 'function' || t === 'symbol') {
    throw new TypeError(`contentHash: cannot hash a ${t} — the semantic layer only ever hashes plain data`);
  }

  if (seen.has(v)) throw new TypeError('contentHash: value contains a cycle');
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      h.byte(TAG_ARR_OPEN);
      h.u32(v.length);
      for (let i = 0; i < v.length; i++) walk(h, v[i], seen);
      h.byte(TAG_ARR_CLOSE);
      return;
    }
    // Typed arrays appear in rig/mesh data; treat them as their numeric contents rather than as
    // an object with index keys, so a Float32Array and a plain array of the same numbers agree.
    if (ArrayBuffer.isView(v)) {
      h.byte(TAG_ARR_OPEN);
      h.u32(v.length);
      for (let i = 0; i < v.length; i++) walk(h, v[i], seen);
      h.byte(TAG_ARR_CLOSE);
      return;
    }
    if (typeof v.toJSON === 'function') { walk(h, v.toJSON(), seen); return; }

    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    h.byte(TAG_OBJ_OPEN);
    h.u32(keys.length);
    for (const k of keys) { h.str(k); walk(h, v[k], seen); }
    h.byte(TAG_OBJ_CLOSE);
  } finally {
    seen.delete(v);
  }
}

/** 128-bit content hash of any plain-data value, as 32 lowercase hex characters. */
export function contentHash(value) {
  const h = new Hasher();
  walk(h, value, new Set());
  return h.digest();
}

/**
 * 128-bit digest of a flat byte buffer, with an optional salt hashed in first.
 *
 * `contentHash` would give the same answer, but it walks the value as a typed token stream and
 * emits nine bytes per element — on a 192x192 RGBA render pass that is 1.3 million hash steps for
 * 147 456 bytes of actual data. A raster is already a flat, untyped byte buffer with its shape
 * recorded alongside it, so the tagging buys nothing. The salt is where that shape goes: two
 * buffers with identical bytes but different dimensions or passes must not share a digest.
 */
export function byteHash(bytes, salt = '') {
  const h = new Hasher();
  if (salt) h.str(salt);
  h.u32(bytes.length);
  h.bytes(bytes);
  return h.digest();
}

/** `{ hash, length }` — length is the canonical byte count, used as a cheap collision guard. */
export function contentFingerprint(value) {
  const h = new Hasher();
  walk(h, value, new Set());
  return { hash: h.digest(), length: h.length };
}

/**
 * A short, human-quotable form of a hash — enough to say "revision a3f19c02" in a report without
 * pasting 32 characters. NEVER use this for storage keys or equality: 8 hex characters is 32
 * bits, which collides at around 77 000 values.
 */
export function shortHash(hash) {
  return String(hash).slice(0, 8);
}

/**
 * Deterministic canonical JSON, for the rare caller that genuinely needs the string (diff output,
 * a file on disk). Separate from the hash path on purpose so that hashing a large project never
 * silently materialises a second copy of it.
 */
export function canonicalJSON(value) {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(v) {
  if (v === null || typeof v !== 'object') return Object.is(v, -0) ? 0 : v;
  if (Array.isArray(v)) return v.map(canonicalise);
  if (ArrayBuffer.isView(v)) return Array.from(v);
  if (typeof v.toJSON === 'function') return canonicalise(v.toJSON());
  const out = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canonicalise(v[k]);
  return out;
}
