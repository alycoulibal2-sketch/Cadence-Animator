// Round-trip tests for the texture-library pack/unpack added to state.js. Pure functions over
// plain objects, so they run in bare node — no Electron, no DOM.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// state.js is an ES module full of browser globals at import time; pull just the two functions
// out by evaluating the isolated block they live in.
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'state.js'), 'utf8');
const start = src.indexOf("const TEX_REF = '@texlib:';");
const end = src.indexOf('export function loadProject');
assert.ok(start > 0 && end > start, 'could not locate the texture-library block in state.js');
const block = src.slice(start, end).replace(/^export /gm, '');
const mod = { exports: {} };
new Function('module', 'exports', `${block}\nmodule.exports = { packProject, unpackProject, TEX_REF };`)(mod, mod.exports);
const { packProject, unpackProject } = mod.exports;

const bigA = 'data:image/png;base64,' + 'A'.repeat(5000);
const bigB = 'data:image/png;base64,' + 'B'.repeat(5000);
// Same LENGTH as bigA but different content — guards the length-bucketed comparison against
// ever handing a part the wrong atlas.
const bigC = 'data:image/png;base64,' + 'A'.repeat(4999) + 'C';

function project() {
  return {
    name: 'T', items: [
      {
        id: 'i1', rig: {
          parts: [
            { id: 'p1', customTexture: bigA, customMesh: { positions: [1, 2, 3] } },
            { id: 'p2', customTexture: bigA },
            { id: 'p3', customTexture: bigB },
            { id: 'p4', customTexture: bigC },
            { id: 'p5' },
          ],
        },
      },
      { id: 'i2', kind: 'camera' },
      { id: 'i3', rig: { parts: [{ id: 'q1', customTexture: bigA }] } },
    ],
  };
}

let pass = 0;
const check = (name, fn) => { fn(); pass++; console.log('  ok -', name); };

console.log('texture library pack/unpack');

check('dedups identical textures across parts AND items', () => {
  const packed = packProject(project());
  assert.strictEqual(Object.keys(packed.textureLib).length, 3, 'expected 3 unique textures');
  // The property that matters is that each texture's bytes appear exactly ONCE on the wire,
  // however many parts reference it — a size ratio would just re-encode this fixture's shape.
  const wire = JSON.stringify(packed);
  const count = (hay, needle) => hay.split(needle).length - 1;
  assert.strictEqual(count(wire, 'A'.repeat(4999)), 2, 'bigA and bigC share a prefix, so 2 hits');
  assert.strictEqual(count(wire, 'B'.repeat(5000)), 1, 'bigB stored once');
  assert.strictEqual(count(JSON.stringify(project()), 'B'.repeat(5000)), 1);
  // bigA is referenced by 3 parts; unpacked it appears 3 times, packed exactly once.
  assert.strictEqual(count(JSON.stringify(project()), `"${bigA}"`), 3);
  assert.strictEqual(count(wire, `"${bigA}"`), 1);
});

check('distinguishes same-length different-content textures', () => {
  const packed = packProject(project());
  const parts = packed.items[0].rig.parts;
  assert.notStrictEqual(parts[0].customTexture, parts[3].customTexture, 'bigA and bigC must not share a key');
  const back = unpackProject(JSON.parse(JSON.stringify(packed)));
  assert.strictEqual(back.items[0].rig.parts[0].customTexture, bigA);
  assert.strictEqual(back.items[0].rig.parts[3].customTexture, bigC);
});

check('round-trips through JSON to exactly the original', () => {
  const original = project();
  const back = unpackProject(JSON.parse(JSON.stringify(packProject(original))));
  delete back.textureLib;
  assert.deepStrictEqual(back, original);
});

check('unpack hands duplicates the SAME string instance (lets the GPU cache collapse them)', () => {
  const back = unpackProject(JSON.parse(JSON.stringify(packProject(project()))));
  const a = back.items[0].rig.parts[0].customTexture;
  const b = back.items[0].rig.parts[1].customTexture;
  const c = back.items[2].rig.parts[0].customTexture;
  assert.ok(a === b && b === c, 'duplicates should be one shared instance');
});

check('does not mutate the live project it packs', () => {
  const p = project();
  packProject(p);
  assert.strictEqual(p.items[0].rig.parts[0].customTexture, bigA, 'live project must keep real data URIs');
  assert.strictEqual(p.textureLib, undefined);
});

check('loading an OLD project with no textureLib is unchanged', () => {
  const old = project();
  const back = unpackProject(JSON.parse(JSON.stringify(old)));
  assert.deepStrictEqual(back, old);
});

check('a project with no textures is passed straight through', () => {
  const p = { name: 'x', items: [{ id: 'a', rig: { parts: [{ id: 'p' }] } }] };
  assert.strictEqual(packProject(p), p, 'should return the same object, not a copy');
});

check('a dangling texture ref degrades to no texture instead of a broken URI', () => {
  const packed = packProject(project());
  delete packed.textureLib.t0;
  const back = unpackProject(JSON.parse(JSON.stringify(packed)));
  assert.strictEqual(back.items[0].rig.parts[0].customTexture, undefined);
  assert.strictEqual(back.items[0].rig.parts[2].customTexture, bigB, 'other textures still resolve');
});

check('packing an already-packed project is a no-op', () => {
  const once = packProject(project());
  const twice = packProject(once);
  assert.deepStrictEqual(twice.items, once.items);
});

check('handles items with no rig / no parts', () => {
  const p = { items: [{ id: 'a' }, { id: 'b', rig: {} }, { id: 'c', rig: { parts: [] } }] };
  assert.doesNotThrow(() => unpackProject(packProject(p)));
});

console.log(`\n${pass}/${pass} passed`);
