// Texture and compositing nodes (spec Parts 17 and 41).
//
// PART 17's LIST is long — sample, UV transform, blend, mask, threshold, levels, blur, sharpen, erode,
// dilate, edge detect, warp, distort, displace, channel split/combine, normal from height, gradient map,
// colorize. Most of them are one call into texture.js, and several collapse into each other once
// textures and fields compose: `Mask` is a multiply, `Distort` and `Displace` are both `Warp`, and
// `Colorize` and `Gradient Map` are the same operation (luminance through a gradient).
//
// So this file is short for the same reason the particle file is: the operations that are genuinely
// distinct get nodes, and the ones that are compositions say so in their documentation rather than
// getting a duplicate implementation (Part 79).
//
// COMPOSITING (Part 41) IS DELIBERATELY LIMITED HERE, and the reason is worth stating. Bloom, motion
// blur, depth of field, chromatic aberration and lens distortion are SCREEN-SPACE passes: they operate
// on the rendered frame, which means they need a render target, a post-process chain, and a renderer
// that can read back its own output. The preview renderer draws straight to the canvas and has none of
// that. The nodes below are the ones that work on a TEXTURE the graph built — which is a real and useful
// thing, and honest about what it is. A screen-space bloom on the final render is Part 41's actual
// request and it is not built; the type system and the export report say so rather than a button
// existing that dims the effect slightly and calls it bloom.

import * as V from './../values.js';
import * as F from './../fields.js';
import * as TEX from './../texture.js';
import { node, n, i as intIn, b as boolIn, v3, col, out, mode } from './_helpers.js';

const C = 'Textures';
const CO = 'Compositing';

const texIn = (key = 'texture', label = 'Texture') => ({ key, label, type: 'texture2d' });
const texOut = (label = 'Texture') => ({ key: 'out', label, type: 'texture2d' });
const resIn = (dflt = TEX.DEFAULT_RESOLUTION) => intIn('resolution', 'Resolution', dflt, {
  min: 4, max: TEX.MAX_RESOLUTION,
  description: 'Pixels per side. Every operation downstream works at this resolution, so it is the one number that decides the cost of the whole chain.',
});

// A texture operation: one texture in, one out, plus whatever else. Shared so the "no texture connected"
// case behaves identically everywhere — returning null rather than an empty texture, because null is
// what every function in texture.js treats as absent.
function texOp(spec) {
  return node({
    id: spec.id, label: spec.label, category: spec.category || C, subcategory: spec.subcategory || 'Process',
    aliases: spec.aliases, summary: spec.summary, teach: spec.teach, explain: spec.explain,
    commonUses: spec.commonUses,
    preview: 'texture',
    exportSupport: spec.exportSupport || 'baked',
    exportNote: spec.exportNote || 'Baked into an image on export. Roblox reads uploaded textures, not procedural ones.',
    performance: spec.performance || 'moderate',
    inputs: [texIn(), ...(spec.inputs || [])],
    outputs: [texOut()],
    evaluate: (api, i) => {
      if (!TEX.isTexture(i.texture)) {
        api.note('No texture is connected, so this produces nothing.');
        return null;
      }
      return spec.run(i.texture, i, api);
    },
  });
}

// ---------------------------------------------------------------- making a texture
node({
  id: 'cadence.texture.rasterize', label: 'Rasterize', category: C, subcategory: 'Create',
  aliases: ['bake to texture', 'render to texture', 'field to texture', 'make texture', 'freeze', 'to image'],
  summary: 'Turns a field into a fixed grid of pixels.',
  teach: 'Takes something continuous — noise, a pattern, a shape — and draws it into an image of a chosen size.',
  explain: 'This is the visible moment a field becomes pixels, and it is a separate node on purpose: a field has no resolution, and everything downstream of here does. Blur, edge detect and dilate all need neighbouring pixels, which only exist once something has been rasterized — but noise driving a particle colour should stay a field, because sampling it at each particle is exactly right and rasterizing first would quantise it for nothing.',
  commonUses: ['turning procedural noise into a texture to blur', 'building a sprite from an SDF', 'making a gradient ramp image'],
  performance: 'expensive',
  inputs: [
    { key: 'field', label: 'Field', type: 'field<color>', default: [0, 0, 0, 1] },
    resIn(),
    n('extent', 'World extent', 1, { min: 1e-3, unit: 'studs', description: 'The texture covers this many studs either side of the origin, so a 3D field like noise or an SDF rasterizes at a sensible scale.' }),
    mode('wrap', 'Wrapping', TEX.WRAP_MODES, 'repeat'),
    mode('filter', 'Filtering', TEX.FILTER_MODES, 'linear'),
  ],
  outputs: [texOut()],
  timeDependent: true,
  evaluate: (api, i) => {
    const res = Math.max(4, Math.min(TEX.MAX_RESOLUTION, Math.round(i.resolution)));
    if (res * res > 1024 * 1024) {
      api.note(`Rasterizing at ${res}x${res} is ${Math.round((res * res * 16) / 1e6)} MB and will be slow to re-evaluate. Lower the resolution while building, then raise it once.`);
    }
    return TEX.rasterize(i.field, res, res, { wrap: i.wrap, filter: i.filter, extent: i.extent, time: api.time });
  },
});

node({
  id: 'cadence.texture.solid', label: 'Solid Colour', category: C, subcategory: 'Create',
  aliases: ['flat colour', 'fill', 'blank texture', 'plain'],
  summary: 'A texture of one flat colour.',
  explain: 'Mainly a base to composite onto, and the right thing to plug into a texture input you want to be neutral — an unconnected one produces nothing at all, which is different from producing white.',
  exportSupport: 'converted',
  inputs: [col('color', 'Colour', [1, 1, 1, 1]), intIn('resolution', 'Resolution', 8, { min: 1, max: 256 })],
  outputs: [texOut()],
  evaluate: (api, i) => TEX.solidTexture(i.color, i.resolution),
});

node({
  id: 'cadence.texture.sample', label: 'Sample Texture', category: C, subcategory: 'Read',
  aliases: ['read texture', 'texture to field', 'lookup', 'uv sample', 'image'],
  summary: 'Reads a texture as a colour that varies over UV coordinates.',
  explain: 'The counterpart to Rasterize: this turns pixels back into a field, so every colour and maths node applies to it again. It samples by the element\'s UV, which means a mesh with UVs, a sprite, or anything carrying a uv attribute can be textured by it.',
  commonUses: ['texturing a mesh or a sprite', 'driving a particle colour from an image'],
  exportSupport: 'converted',
  exportNote: 'A sampled texture exports as a Roblox texture asset reference once the image itself is uploaded.',
  inputs: [texIn()],
  outputs: [{ key: 'out', label: 'Colour', type: 'field<color>' }],
  evaluate: (api, i) => {
    if (!TEX.isTexture(i.texture)) return F.constantField('color', [1, 1, 1, 1]);
    return TEX.textureAsField(i.texture);
  },
});

node({
  id: 'cadence.texture.info', label: 'Texture Info', category: C, subcategory: 'Read',
  aliases: ['texture size', 'how big', 'texture statistics', 'range'],
  summary: 'The size of a texture and the range of values in it.',
  explain: 'The node to reach for when a texture chain looks wrong: a range of 0 to 0 says the source produced nothing, and an average alpha of 0 says the whole thing is transparent — which looks identical to "not drawn" and is a completely different problem.',
  exportSupport: 'native',
  inputs: [texIn()],
  outputs: [
    { key: 'width', label: 'Width', type: 'int' },
    { key: 'height', label: 'Height', type: 'int' },
    { key: 'min', label: 'Darkest', type: 'float' },
    { key: 'max', label: 'Brightest', type: 'float' },
    { key: 'averageAlpha', label: 'Average alpha', type: 'float' },
    { key: 'megabytes', label: 'Memory (MB)', type: 'float' },
  ],
  evaluate: (api, i) => {
    const d = TEX.describeTexture(i.texture);
    if (d.empty) return { width: 0, height: 0, min: 0, max: 0, averageAlpha: 0, megabytes: 0 };
    return {
      width: d.width, height: d.height,
      min: d.range.min, max: d.range.max,
      averageAlpha: d.averageAlpha,
      megabytes: Math.round((d.bytes / 1e6) * 100) / 100,
    };
  },
});

// ---------------------------------------------------------------- neighbourhood operations
texOp({
  id: 'cadence.texture.blur', label: 'Blur', subcategory: 'Filter',
  aliases: ['gaussian blur', 'soften', 'smooth', 'defocus', 'glow base'],
  summary: 'Softens a texture.',
  explain: 'A separable Gaussian: a horizontal pass then a vertical one, which is what makes a large radius affordable. Blur is also the first half of a glow — blur a bright texture and add it back over the original.',
  commonUses: ['softening a hard-edged mask', 'the blur half of a glow', 'smoothing noise into cloud shapes'],
  inputs: [n('radius', 'Radius', 4, { min: 0, max: 64, unit: 'pixels' })],
  run: (tex, i) => TEX.blurTexture(tex, i.radius),
});

texOp({
  id: 'cadence.texture.sharpen', label: 'Sharpen', subcategory: 'Filter',
  aliases: ['crisp', 'unsharp mask', 'detail', 'clarity'],
  summary: 'Makes edges crisper by subtracting a blurred copy.',
  explain: 'An unsharp mask: original + (original - blurred) * amount. Pushed too far it produces halos, which is inherent to the technique rather than a bug — the amount is the control for how much of that you accept.',
  inputs: [n('amount', 'Amount', 1, { min: 0, max: 5 }), n('radius', 'Radius', 2, { min: 1, max: 32, unit: 'pixels' })],
  run: (tex, i) => {
    const blurred = TEX.blurTexture(tex, i.radius);
    return TEX.zipTextures(tex, blurred, (a, b) => [
      a[0] + (a[0] - b[0]) * i.amount,
      a[1] + (a[1] - b[1]) * i.amount,
      a[2] + (a[2] - b[2]) * i.amount,
      a[3],
    ]);
  },
});

texOp({
  id: 'cadence.texture.dilate', label: 'Grow', subcategory: 'Filter',
  aliases: ['dilate', 'expand', 'fatten', 'spread', 'thicken'],
  summary: 'Grows the opaque parts of a texture outwards.',
  explain: 'Takes the most opaque pixel within the radius, using a round kernel so a grown shape does not read as square. Grow then subtract the original and you have an outline.',
  commonUses: ['thickening a thin mask', 'building an outline', 'closing gaps in a mask'],
  inputs: [n('radius', 'Radius', 2, { min: 0, max: 32, unit: 'pixels' })],
  performance: 'expensive',
  run: (tex, i) => TEX.morphTexture(tex, i.radius, 1),
});

texOp({
  id: 'cadence.texture.erode', label: 'Shrink', subcategory: 'Filter',
  aliases: ['erode', 'contract', 'thin', 'shrink mask'],
  summary: 'Shrinks the opaque parts of a texture inwards.',
  inputs: [n('radius', 'Radius', 2, { min: 0, max: 32, unit: 'pixels' })],
  performance: 'expensive',
  run: (tex, i) => TEX.morphTexture(tex, i.radius, -1),
});

texOp({
  id: 'cadence.texture.edges', label: 'Edge Detect', subcategory: 'Filter',
  aliases: ['outline', 'sobel', 'find edges', 'contour', 'line art'],
  summary: 'Finds the edges in a texture.',
  explain: 'A Sobel gradient on brightness, written to every channel so the result is usable as a mask directly. Strong on a hard-edged image, faint on a soft one — so blur first if you want thicker lines.',
  commonUses: ['a hologram wireframe from a shape', 'outlining a mask'],
  inputs: [n('strength', 'Strength', 1, { min: 0, max: 10 })],
  run: (tex, i) => TEX.edgeTexture(tex, i.strength),
});

texOp({
  id: 'cadence.texture.warp', label: 'Warp', subcategory: 'Filter',
  aliases: ['distort', 'displace', 'ripple', 'melt', 'heat distortion', 'refract', 'push'],
  summary: 'Pushes a texture around using a second texture as the directions.',
  teach: 'Bends and smears an image. The second texture decides which way each part moves.',
  explain: 'This one node is Part 17\'s Warp, Distort AND Displace: all three are "move each pixel\'s source coordinate by an offset read from somewhere". The offsets are read as signed, so a neutral grey offset map leaves the image alone rather than displacing everything by half the amount — which is what a 0-to-1 reading would do.',
  commonUses: ['heat distortion', 'liquid or melting looks', 'roughening a clean shape with noise'],
  inputs: [
    { key: 'offsets', label: 'Offsets', type: 'texture2d', description: 'Red and green are read as the X and Y offset. Noise is the usual source.' },
    n('amount', 'Amount', 0.05, { min: 0, max: 1 }),
  ],
  run: (tex, i) => TEX.warpTexture(tex, i.offsets, i.amount),
});

texOp({
  id: 'cadence.texture.resize', label: 'Resize', subcategory: 'Process',
  aliases: ['scale texture', 'resample', 'downsample', 'upscale'],
  summary: 'Changes a texture\'s resolution.',
  explain: 'Bilinear in both directions. A large reduction will alias, because proper downsampling needs a mip chain and this is a single bilinear pass — blur before shrinking if that matters.',
  inputs: [resIn(128)],
  run: (tex, i) => TEX.resizeTexture(tex, Math.max(4, Math.round(i.resolution))),
});

// ---------------------------------------------------------------- per-pixel operations
texOp({
  id: 'cadence.texture.levels', label: 'Levels', subcategory: 'Adjust',
  aliases: ['contrast', 'brightness', 'gamma', 'curves', 'remap texture', 'exposure'],
  summary: 'Remaps the brightness range of a texture.',
  explain: 'Input black and white say which values become 0 and 1; everything outside clamps. Gamma bends the middle without moving the ends. This is the standard way to turn noise that happens to sit in 0.3–0.7 into something that uses the full range.',
  commonUses: ['stretching noise to full contrast', 'crushing a texture into a hard mask'],
  performance: 'cheap',
  inputs: [
    n('inputBlack', 'Input black', 0), n('inputWhite', 'Input white', 1),
    n('gamma', 'Gamma', 1, { min: 0.01, max: 10 }),
    n('outputBlack', 'Output black', 0), n('outputWhite', 'Output white', 1),
  ],
  run: (tex, i) => {
    const span = Math.abs(i.inputWhite - i.inputBlack) < 1e-9 ? 1 : i.inputWhite - i.inputBlack;
    const g = 1 / Math.max(0.01, i.gamma);
    const adj = (v) => {
      const t = V.clamp01((v - i.inputBlack) / span);
      return i.outputBlack + (i.outputWhite - i.outputBlack) * Math.pow(t, g);
    };
    return TEX.mapTexture(tex, (px) => [adj(px[0]), adj(px[1]), adj(px[2]), px[3]]);
  },
});

texOp({
  id: 'cadence.texture.threshold', label: 'Threshold', subcategory: 'Adjust',
  aliases: ['cutoff', 'posterize', 'binary', 'hard edge', 'clip', 'step'],
  summary: 'Turns a texture into hard on-or-off regions.',
  explain: 'Softness above zero feathers the transition rather than leaving a jagged edge — a threshold with no softness aliases badly on anything that moves, which is why the default is not zero.',
  performance: 'cheap',
  inputs: [n('threshold', 'Threshold', 0.5, { min: 0, max: 1 }), n('softness', 'Softness', 0.02, { min: 0, max: 1 })],
  run: (tex, i) => {
    const s = Math.max(1e-6, i.softness);
    return TEX.mapTexture(tex, (px) => {
      const l = V.luminance(px);
      const t = V.clamp01((l - i.threshold + s * 0.5) / s);
      const m = t * t * (3 - 2 * t);
      return [m, m, m, px[3]];
    });
  },
});

texOp({
  id: 'cadence.texture.gradientMap', label: 'Gradient Map', subcategory: 'Adjust',
  aliases: ['colorize', 'colourise', 'tint by brightness', 'false colour', 'palette', 'ramp'],
  summary: 'Recolours a texture by looking its brightness up in a gradient.',
  teach: 'Turns a grey image into a colourful one: dark parts take the left of the gradient, bright parts the right.',
  explain: 'Part 17 lists Colorize and Gradient Map separately; they are the same operation, so this is one node. It is the standard way to turn a greyscale noise or an SDF into fire, ice or any other palette.',
  commonUses: ['turning noise into fire colours', 'palettising a mask'],
  performance: 'cheap',
  inputs: [{ key: 'gradient', label: 'Gradient', type: 'gradient', default: { kind: 'color', stops: [{ u: 0, v: '#000000' }, { u: 1, v: '#ffffff' }] } }],
  run: (tex, i, api) => {
    // The gradient is sampled into a small lookup table once rather than per pixel: a 256-entry ramp is
    // visually indistinguishable and turns a per-pixel gradient evaluation into an array read.
    const lut = [];
    const stops = Array.isArray(i.gradient?.stops) ? i.gradient.stops : [];
    for (let k = 0; k < 256; k++) {
      const t = k / 255;
      lut.push(stops.length ? V.hexToColor(sampleStops(stops, t)) : [t, t, t, 1]);
    }
    return TEX.mapTexture(tex, (px) => {
      const c = lut[Math.max(0, Math.min(255, Math.round(V.luminance(px) * 255)))];
      return [c[0], c[1], c[2], px[3]];
    });
  },
});

// Minimal stop interpolation, kept local rather than importing rampEval so this module has no dependency
// on the old effect system.
function sampleStops(stops, t) {
  const sorted = stops.filter((s) => s && Number.isFinite(s.u)).slice().sort((a, b) => a.u - b.u);
  if (!sorted.length) return '#ffffff';
  if (t <= sorted[0].u) return sorted[0].v;
  if (t >= sorted[sorted.length - 1].u) return sorted[sorted.length - 1].v;
  for (let k = 1; k < sorted.length; k++) {
    if (t <= sorted[k].u) {
      const a = sorted[k - 1], b = sorted[k];
      const span = b.u - a.u;
      const f = span < 1e-9 ? 0 : (t - a.u) / span;
      const ca = V.hexToColor(a.v), cb = V.hexToColor(b.v);
      return V.colorToHex([
        ca[0] + (cb[0] - ca[0]) * f,
        ca[1] + (cb[1] - ca[1]) * f,
        ca[2] + (cb[2] - ca[2]) * f,
        1,
      ]);
    }
  }
  return sorted[sorted.length - 1].v;
}

// ---------------------------------------------------------------- combining
node({
  id: 'cadence.texture.blend', label: 'Blend Textures', category: C, subcategory: 'Combine',
  aliases: ['mix textures', 'composite', 'layer', 'over', 'add', 'multiply', 'mask', 'screen', 'subtract', 'difference'],
  summary: 'Combines two textures.',
  explain: 'Part 17 lists Blend, Mask, Multiply, Add, Subtract and Difference as separate operations; they differ only in the arithmetic, so they are modes here rather than six nodes. Where the two sizes differ, the second is sampled at the first\'s resolution rather than either being resized — so compositing a 1024 detail map onto a 256 base does not silently upscale the base.',
  commonUses: ['layering detail noise over base noise', 'masking one texture by another'],
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [
    texIn('a', 'Base'),
    texIn('b', 'Layer'),
    mode('blend', 'Mode', ['over', 'add', 'multiply', 'subtract', 'difference', 'screen', 'min', 'max', 'mix'], 'over'),
    n('amount', 'Amount', 1, { min: 0, max: 1 }),
  ],
  outputs: [texOut()],
  evaluate: (api, i) => {
    if (!TEX.isTexture(i.a) && !TEX.isTexture(i.b)) return null;
    const k = V.clamp01(i.amount);
    const ops = {
      // `over` is real alpha compositing, so a layer with alpha actually occludes rather than adding.
      over: (a, b) => {
        const ba = b[3] * k;
        return [
          b[0] * ba + a[0] * (1 - ba),
          b[1] * ba + a[1] * (1 - ba),
          b[2] * ba + a[2] * (1 - ba),
          ba + a[3] * (1 - ba),
        ];
      },
      add: (a, b) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k, Math.max(a[3], b[3] * k)],
      multiply: (a, b) => [a[0] * (1 - k + b[0] * k), a[1] * (1 - k + b[1] * k), a[2] * (1 - k + b[2] * k), a[3]],
      subtract: (a, b) => [a[0] - b[0] * k, a[1] - b[1] * k, a[2] - b[2] * k, a[3]],
      difference: (a, b) => [Math.abs(a[0] - b[0]) * k + a[0] * (1 - k), Math.abs(a[1] - b[1]) * k + a[1] * (1 - k), Math.abs(a[2] - b[2]) * k + a[2] * (1 - k), a[3]],
      screen: (a, b) => [1 - (1 - a[0]) * (1 - b[0] * k), 1 - (1 - a[1]) * (1 - b[1] * k), 1 - (1 - a[2]) * (1 - b[2] * k), Math.max(a[3], b[3] * k)],
      min: (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])],
      max: (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
      mix: (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k],
    };
    return TEX.zipTextures(i.a, i.b, ops[i.blend] || ops.over);
  },
});

node({
  id: 'cadence.texture.channels', label: 'Texture Channels', category: C, subcategory: 'Combine',
  aliases: ['split channels', 'combine channels', 'swizzle', 'rgba', 'pack', 'unpack', 'alpha'],
  summary: 'Rebuilds a texture by picking which channel goes where.',
  explain: 'Part 17\'s Channel Split and Channel Combine in one node, because splitting and recombining is nearly always done together — packing a mask into alpha, moving a height map from red into all three, or building an offset map out of two noises.',
  commonUses: ['packing a mask into the alpha channel', 'making a greyscale texture from one channel'],
  exportSupport: 'baked',
  performance: 'cheap',
  inputs: [
    texIn(),
    mode('red', 'Red from', ['red', 'green', 'blue', 'alpha', 'luminance', 'one', 'zero'], 'red'),
    mode('green', 'Green from', ['red', 'green', 'blue', 'alpha', 'luminance', 'one', 'zero'], 'green'),
    mode('blue', 'Blue from', ['red', 'green', 'blue', 'alpha', 'luminance', 'one', 'zero'], 'blue'),
    mode('alpha', 'Alpha from', ['red', 'green', 'blue', 'alpha', 'luminance', 'one', 'zero'], 'alpha'),
  ],
  outputs: [texOut()],
  evaluate: (api, i) => {
    if (!TEX.isTexture(i.texture)) return null;
    const pick = (px, which) => {
      switch (which) {
        case 'red': return px[0];
        case 'green': return px[1];
        case 'blue': return px[2];
        case 'alpha': return px[3];
        case 'luminance': return V.luminance(px);
        case 'one': return 1;
        default: return 0;
      }
    };
    return TEX.mapTexture(i.texture, (px) => [pick(px, i.red), pick(px, i.green), pick(px, i.blue), pick(px, i.alpha)]);
  },
});

node({
  id: 'cadence.texture.normalMap', label: 'Normal From Height', category: C, subcategory: 'Combine',
  aliases: ['bump to normal', 'height to normal', 'normal map', 'surface detail'],
  summary: 'Builds a normal map from a height texture.',
  explain: 'Brightness is read as height and the surface normal is derived from its slope — the cross product of the two surface tangents rather than a packed gradient, so the result is a correct unit normal. Strength scales the HEIGHT, not the resulting normal, because scaling a normal denormalises it.',
  commonUses: ['adding surface relief to a procedural material', 'making noise read as bumpy rather than as a stain'],
  exportSupport: 'baked',
  performance: 'moderate',
  inputs: [texIn('texture', 'Height'), n('strength', 'Strength', 1, { min: 0, max: 20 })],
  outputs: [texOut('Normal map')],
  evaluate: (api, i) => (TEX.isTexture(i.texture) ? TEX.normalFromHeight(i.texture, i.strength) : null),
});

// ---------------------------------------------------------------- UV
node({
  id: 'cadence.texture.uvTransform', label: 'UV Transform', category: C, subcategory: 'UV',
  aliases: ['tile', 'offset uv', 'rotate uv', 'scale uv', 'pan', 'scroll', 'texture coordinates'],
  summary: 'Tiles, offsets and rotates texture coordinates.',
  explain: 'Operates on the COORDINATES rather than on a texture, so it goes between a UV source and whatever samples it. Animating the offset is how a texture scrolls, which is most of what makes energy read as flowing.',
  commonUses: ['scrolling a texture along a beam', 'tiling a detail texture', 'rotating a sprite\'s texture'],
  exportSupport: 'converted',
  inputs: [
    { key: 'uv', label: 'UV', type: 'field<vector2>', default: [0, 0], defaultFrom: 'uv' },
    { key: 'tiling', label: 'Tiling', type: 'field<vector2>', default: [1, 1] },
    { key: 'offset', label: 'Offset', type: 'field<vector2>', default: [0, 0] },
    { key: 'rotation', label: 'Rotation', type: 'field<float>', default: 0, unit: 'degrees' },
    v3('pivot', 'Pivot', [0.5, 0.5, 0], { description: 'The point rotation and tiling happen around. The centre, 0.5 0.5, is almost always what you want.' }),
  ],
  outputs: [{ key: 'out', label: 'UV', type: 'field<vector2>' }],
  evaluate: (api, i) => F.makeField('vector2', (ctx) => {
    const uv = V.toComponents('vector2', F.sampleAny(i.uv, ctx));
    const tile = V.toComponents('vector2', F.sampleAny(i.tiling, ctx));
    const off = V.toComponents('vector2', F.sampleAny(i.offset, ctx));
    const rot = (Number(F.sampleAny(i.rotation, ctx)) || 0) * Math.PI / 180;
    const p = V.toComponents('vector3', i.pivot);
    // Rotate about the pivot, then tile about it too — tiling about the origin instead makes a rotated
    // tile drift away from where it was, which reads as the pivot being ignored.
    const dx = uv[0] - p[0], dy = uv[1] - p[1];
    const c = Math.cos(rot), s = Math.sin(rot);
    return [
      (dx * c - dy * s) * tile[0] + p[0] + off[0],
      (dx * s + dy * c) * tile[1] + p[1] + off[1],
    ];
  }),
});

// ---------------------------------------------------------------- flipbooks
node({
  id: 'cadence.texture.flipbook', label: 'Bake Flipbook', category: C, subcategory: 'Create',
  aliases: ['sprite sheet', 'atlas', 'animation sheet', 'texture atlas', 'frames'],
  summary: 'Bakes an animated field into a grid of frames on one sheet.',
  teach: 'Records a moving effect as a strip of still pictures laid out in a grid — which is how a game plays an animated puff of smoke.',
  explain: 'This is the bridge from something that moves procedurally to something a simple runtime can play: a Roblox ParticleEmitter can read a flipbook and cannot read a field. The field is rasterized once per cell at successive times, so the cost is the cell resolution times the number of cells.',
  commonUses: ['an animated smoke or explosion sprite for Roblox', 'baking a noise loop for a game engine'],
  exportSupport: 'converted',
  exportNote: 'A flipbook is exactly what Roblox ParticleEmitter\'s own flipbook support reads, once the sheet is uploaded as a texture asset.',
  performance: 'expensive',
  timeDependent: true,
  inputs: [
    { key: 'field', label: 'Field', type: 'field<color>', default: [0, 0, 0, 1] },
    intIn('columns', 'Columns', 4, { min: 1, max: 16 }),
    intIn('rows', 'Rows', 4, { min: 1, max: 16 }),
    intIn('cellSize', 'Cell size', 64, { min: 8, max: 512, unit: 'pixels' }),
    n('duration', 'Duration', 1, { min: 1e-3, unit: 'seconds', description: 'How much time the whole sheet covers. The field is sampled at even steps across it.' }),
    n('extent', 'World extent', 1, { min: 1e-3, unit: 'studs' }),
  ],
  outputs: [
    texOut('Sheet'),
    { key: 'columns', label: 'Columns', type: 'int' },
    { key: 'rows', label: 'Rows', type: 'int' },
    { key: 'frames', label: 'Frames', type: 'int' },
  ],
  evaluate: (api, i) => {
    const book = TEX.bakeFlipbook(
      (t, cell) => TEX.rasterize(i.field, cell, cell, { wrap: 'clamp', extent: i.extent, time: t }),
      { columns: i.columns, rows: i.rows, cellSize: i.cellSize, duration: i.duration },
    );
    const px = book.sheet.width * book.sheet.height;
    if (px > 2048 * 2048) api.note(`This sheet is ${book.sheet.width}x${book.sheet.height}, which is larger than most engines accept as one texture.`);
    return { out: book.sheet, columns: book.columns, rows: book.rows, frames: book.frames };
  },
});

// ---------------------------------------------------------------- compositing (Part 41)
// Only the operations that work on a texture the graph BUILT. The screen-space passes Part 41 asks for —
// bloom over the final render, motion blur, depth of field, chromatic aberration, lens distortion —
// need a render target and a post-process chain the preview renderer does not have. They are absent
// rather than approximated: see the note at the top of this file.
node({
  id: 'cadence.compositing.glow', label: 'Glow', category: CO, subcategory: 'Texture',
  aliases: ['bloom', 'halo', 'blur and add', 'soft light', 'haze'],
  summary: 'Adds a blurred, brightened copy of a texture back over itself.',
  teach: 'Makes the bright parts of an image spill light into their surroundings.',
  explain: 'Bloom applied to a TEXTURE, not to the rendered frame. Screen-space bloom over the whole effect is a different thing and is not built — it needs the renderer to read back its own output, which the preview renderer cannot do. This one is real and useful for building a glowing sprite or a soft mask, and it is named Glow rather than Bloom to keep the distinction visible.',
  commonUses: ['making a sprite texture glow at its core', 'softening a bright mask outwards'],
  exportSupport: 'baked',
  performance: 'expensive',
  inputs: [
    texIn(),
    n('threshold', 'Threshold', 0.6, { min: 0, max: 2, description: 'Only pixels brighter than this contribute to the glow.' }),
    n('radius', 'Radius', 8, { min: 1, max: 64, unit: 'pixels' }),
    n('intensity', 'Intensity', 1, { min: 0, max: 8 }),
  ],
  outputs: [texOut()],
  evaluate: (api, i) => {
    if (!TEX.isTexture(i.texture)) return null;
    // Isolate the bright parts, blur THAT, and add it back. Blurring the whole image and adding it
    // instead washes out the dark areas as well, which reads as fog rather than as glow.
    const bright = TEX.mapTexture(i.texture, (px) => {
      const l = V.luminance(px);
      const k = l > i.threshold ? (l - i.threshold) / Math.max(1e-6, l) : 0;
      return [px[0] * k, px[1] * k, px[2] * k, px[3]];
    });
    const blurred = TEX.blurTexture(bright, i.radius);
    return TEX.zipTextures(i.texture, blurred, (a, b) => [
      a[0] + b[0] * i.intensity,
      a[1] + b[1] * i.intensity,
      a[2] + b[2] * i.intensity,
      Math.max(a[3], Math.min(1, b[3] * i.intensity)),
    ]);
  },
});

node({
  id: 'cadence.compositing.colorGrade', label: 'Colour Grade', category: CO, subcategory: 'Texture',
  aliases: ['grade', 'saturation', 'contrast', 'tint', 'exposure', 'look', 'filter'],
  summary: 'Adjusts the exposure, contrast, saturation and tint of a texture.',
  explain: 'The order is fixed and matters: exposure, then contrast about mid-grey, then saturation, then tint. Contrast about mid-grey rather than about zero is what keeps a grade from darkening everything as a side effect.',
  commonUses: ['unifying the look of a composited texture', 'desaturating smoke so only the fire is coloured'],
  exportSupport: 'baked',
  performance: 'cheap',
  inputs: [
    texIn(),
    n('exposure', 'Exposure', 0, { min: -5, max: 5, description: 'In stops: +1 doubles the brightness.' }),
    n('contrast', 'Contrast', 1, { min: 0, max: 4 }),
    n('saturation', 'Saturation', 1, { min: 0, max: 4 }),
    col('tint', 'Tint', [1, 1, 1, 1]),
  ],
  outputs: [texOut()],
  evaluate: (api, i) => {
    if (!TEX.isTexture(i.texture)) return null;
    const gain = Math.pow(2, i.exposure);
    const t = V.toComponents('color', i.tint);
    return TEX.mapTexture(i.texture, (px) => {
      let r = px[0] * gain, g = px[1] * gain, b = px[2] * gain;
      r = (r - 0.5) * i.contrast + 0.5;
      g = (g - 0.5) * i.contrast + 0.5;
      b = (b - 0.5) * i.contrast + 0.5;
      const l = V.luminance([r, g, b, 1]);
      r = l + (r - l) * i.saturation;
      g = l + (g - l) * i.saturation;
      b = l + (b - l) * i.saturation;
      return [r * t[0], g * t[1], b * t[2], px[3]];
    });
  },
});

node({
  id: 'cadence.compositing.vignette', label: 'Vignette', category: CO, subcategory: 'Texture',
  aliases: ['darken edges', 'fade corners', 'frame', 'falloff'],
  summary: 'Darkens the edges of a texture.',
  exportSupport: 'baked',
  performance: 'cheap',
  inputs: [
    texIn(),
    n('amount', 'Amount', 0.5, { min: 0, max: 1 }),
    n('radius', 'Radius', 0.7, { min: 0, max: 1.5 }),
    n('softness', 'Softness', 0.4, { min: 0.01, max: 1 }),
  ],
  outputs: [texOut()],
  evaluate: (api, i) => {
    if (!TEX.isTexture(i.texture)) return null;
    const tex = i.texture;
    return TEX.mapTexture(tex, (px, x, y) => {
      const u = (x + 0.5) / tex.width - 0.5;
      const v = (y + 0.5) / tex.height - 0.5;
      const d = Math.sqrt(u * u + v * v) * 2;
      const t = V.clamp01((d - i.radius) / Math.max(1e-6, i.softness));
      const k = 1 - t * t * (3 - 2 * t) * i.amount;
      return [px[0] * k, px[1] * k, px[2] * k, px[3]];
    });
  },
});
