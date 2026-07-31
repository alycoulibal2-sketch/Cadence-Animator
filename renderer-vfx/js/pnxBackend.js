// The three.js backend for PNX render commands.
//
// This is the ONLY file in the engine that knows three.js exists. Everything upstream produced plain
// data (render.js's resolve pass: Float32Arrays and settings objects), and this file turns that data
// into scene objects. That is Part 36's separation made concrete, and the reason it is worth the extra
// module: a Roblox exporter, a bake pass or a future GPU backend consumes exactly the same draw list
// without reimplementing any evaluation.
//
// POOLING IS THE WHOLE PERFORMANCE STORY. A particle count changes every frame, and allocating
// meshes/sprites per frame would garbage-collect the preview into a slideshow. So objects are pooled
// per pass, keyed by a structural signature (what kind of pass, which blend mode, which texture), and
// only their attributes are rewritten each frame. A pass whose signature is unchanged keeps its
// objects across frames even as its element count moves.
//
// The signature deliberately does NOT include the element count: growing a pool is cheaper than
// rebuilding it, and a count that oscillates around a threshold would otherwise thrash.

import * as THREE from '../../node_modules/three/build/three.module.js';
import { getParticleTexture } from '../../renderer/js/rigbuild.js';
import * as RENDER from '../../renderer/js/pnx/render.js';
import * as TEX from '../../renderer/js/pnx/texture.js';

// A PNX texture uploaded as a three.js DataTexture, cached so the same texture object is not re-uploaded
// every frame. The cache is keyed by the texture OBJECT, not by its contents: texture.js returns a new
// object from every operation, so object identity is exactly "has this been recomputed?" — and a
// content hash would cost more than the upload it saved.
const textureCache = new WeakMap();
function threeTextureFor(tex) {
  if (!TEX.isTexture(tex)) return null;
  const hit = textureCache.get(tex);
  if (hit) return hit;
  const bytes = TEX.toBytes(tex);
  const t = new THREE.DataTexture(bytes.data, bytes.width, bytes.height, THREE.RGBAFormat);
  t.wrapS = t.wrapT = tex.wrap === 'clamp' ? THREE.ClampToEdgeWrapping
    : tex.wrap === 'mirror' ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  t.magFilter = t.minFilter = tex.filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
  // The rasterizer's v runs bottom-up (uv 0 is the first row it wrote); three.js expects top-down. Not
  // flipping here mirrors every procedural texture vertically, which is invisible on symmetric noise and
  // obvious the moment a gradient or a flipbook is involved.
  t.flipY = true;
  t.needsUpdate = true;
  textureCache.set(tex, t);
  return t;
}

const BLEND = {
  normal: THREE.NormalBlending,
  additive: THREE.AdditiveBlending,
  multiply: THREE.MultiplyBlending,
  screen: THREE.AdditiveBlending,   // three has no screen blend; additive is the nearest honest match
};

// A pass's structural identity. Anything in here changing means the pooled objects are rebuilt;
// anything not in here is applied per frame.
function signatureOf(draw, index) {
  const m = draw.material || RENDER.DEFAULT_MATERIAL;
  const s = draw.settings || {};
  return [
    index, draw.kind, m.blend, m.depthWrite ? 1 : 0, m.doubleSided ? 1 : 0,
    s.facing || '', s.wireframe ? 1 : 0,
    draw.instanced ? 'inst' : '',
    draw.flipbook ? `fb${draw.flipbook.columns}x${draw.flipbook.rows}` : '',
    // Whether a custom texture is bound is STRUCTURAL: swapping one in has to rebuild the pooled
    // materials, since a three.js material's map cannot be changed without a recompile anyway.
    m.texture ? 'tex' : '',
  ].join('|');
}

export class PnxBackend {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'pnx';
    scene.add(this.root);
    this.passes = new Map();          // signature -> pooled objects
    this.lastStats = { sprites: 0, triangles: 0, lights: 0, passes: 0, pooled: 0 };
  }

  // Draw one frame. `draws` is render.js's resolveScene().draws — plain data.
  render(draws, camera) {
    const live = new Set();
    let statSprites = 0, statTris = 0, statLights = 0;

    for (let idx = 0; idx < draws.length; idx++) {
      const draw = draws[idx];
      const sig = signatureOf(draw, idx);
      live.add(sig);
      let pass = this.passes.get(sig);
      if (!pass) {
        pass = this._buildPass(draw);
        if (!pass) continue;
        this.passes.set(sig, pass);
      }
      switch (draw.kind) {
        case 'sprite': case 'point':
          this._applySprites(pass, draw, camera);
          statSprites += draw.count || 0;
          break;
        case 'mesh':
          this._applyMesh(pass, draw);
          statTris += draw.indices ? draw.indices.length / 3 : 0;
          break;
        case 'line': case 'trail': case 'ribbon': case 'beam':
          this._applyStrips(pass, draw, camera);
          break;
        case 'light':
          this._applyLights(pass, draw);
          statLights += draw.count || 0;
          break;
        default:
          break;
      }
    }

    // Hide, rather than dispose, a pass that produced nothing this frame: an effect that pulses on
    // and off would otherwise rebuild its pools every cycle. Disposal happens only when the pass is
    // structurally gone (below).
    for (const [sig, pass] of this.passes) {
      if (!live.has(sig)) {
        this._disposePass(pass);
        this.passes.delete(sig);
      }
    }

    this.lastStats = {
      sprites: statSprites,
      triangles: Math.round(statTris),
      lights: statLights,
      passes: draws.length,
      pooled: [...this.passes.values()].reduce((s, p) => s + (p.pool ? p.pool.length : 0), 0),
    };
    return this.lastStats;
  }

  clear() {
    for (const pass of this.passes.values()) this._disposePass(pass);
    this.passes.clear();
  }

  dispose() {
    this.clear();
    this.scene.remove(this.root);
  }

  // ---------------------------------------------------------------- pass construction
  _buildPass(draw) {
    const group = new THREE.Group();
    this.root.add(group);
    const m = draw.material || RENDER.DEFAULT_MATERIAL;
    const blending = BLEND[m.blend] || THREE.NormalBlending;
    // A material's own procedural texture wins over the built-in soft-particle sprite. That is the whole
    // point of the Textures family: an effect can supply its own image rather than choosing from a list.
    const own = threeTextureFor(m.texture);
    return {
      kind: draw.kind, group, pool: [], blending,
      depthWrite: !!m.depthWrite,
      doubleSided: m.doubleSided !== false,
      wireframe: !!(draw.settings && draw.settings.wireframe),
      texture: own || (draw.kind === 'sprite' || draw.kind === 'point' ? getParticleTexture('soft') : null),
      ownTexture: !!own,
    };
  }

  _disposePass(pass) {
    this.root.remove(pass.group);
    for (const obj of pass.pool) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    pass.pool.length = 0;
  }

  // Grow a pool to `count`, creating with `make`. Never shrinks — surplus objects are hidden, because
  // a count that drops and rises again (every looping effect) would otherwise churn allocations.
  _ensurePool(pass, count, make) {
    while (pass.pool.length < count) {
      const obj = make();
      obj.visible = false;
      pass.group.add(obj);
      pass.pool.push(obj);
    }
    return pass.pool;
  }

  // ---------------------------------------------------------------- sprites and points
  _applySprites(pass, draw, camera) {
    const count = draw.count || 0;
    const pool = this._ensurePool(pass, count, () => new THREE.Sprite(new THREE.SpriteMaterial({
      map: pass.texture, transparent: true, depthWrite: pass.depthWrite, blending: pass.blending,
    })));

    for (let k = 0; k < count; k++) {
      const spr = pool[k];
      spr.visible = true;
      spr.position.set(draw.positions[k * 3], draw.positions[k * 3 + 1], draw.positions[k * 3 + 2]);

      // Emission is added to base colour. three's SpriteMaterial has no emission channel, so this is
      // the honest approximation the support table already declares — and it is what makes an additive
      // spark read as hot rather than as a pale dot.
      const r = draw.colors[k * 4] + (draw.emission ? draw.emission[k * 4] : 0);
      const g = draw.colors[k * 4 + 1] + (draw.emission ? draw.emission[k * 4 + 1] : 0);
      const b = draw.colors[k * 4 + 2] + (draw.emission ? draw.emission[k * 4 + 2] : 0);
      spr.material.color.setRGB(r, g, b);
      spr.material.opacity = Math.max(0, Math.min(1, draw.colors[k * 4 + 3] * draw.opacity[k]));

      const size = draw.sizes[k];
      spr.scale.set(size, size, 1);
      spr.material.rotation = (draw.rotations[k] * Math.PI) / 180;

      // Velocity facing: rotate the sprite in SCREEN space so its long axis lies along the projected
      // velocity, and stretch it. Doing this in screen space rather than world space is what keeps a
      // streak looking like a streak from every camera angle — a world-space rotation would foreshorten
      // to a dot whenever the motion pointed at the viewer.
      if (draw.facing === 'velocity' && draw.velocities) {
        const vx = draw.velocities[k * 3], vy = draw.velocities[k * 3 + 1], vz = draw.velocities[k * 3 + 2];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > 1e-6 && camera) {
          const world = new THREE.Vector3(vx, vy, vz).normalize();
          const view = world.clone().transformDirection(camera.matrixWorldInverse || camera.matrixWorld.clone().invert());
          spr.material.rotation = Math.atan2(view.y, view.x) - Math.PI / 2;
          const stretch = 1 + Math.min(4, speed * (draw.settings.velocityStretch ?? 0.05));
          spr.scale.set(size, size * stretch, 1);
        }
      }

      // Flipbook: offset into the atlas. Sprite UVs come from the material's map, so the repeat/offset
      // pair selects the cell — which means each element needs its own material clone. That is why the
      // flipbook layout is part of the pass signature: it decides the pooling strategy.
      if (draw.flipbook) {
        const { columns, rows, cells } = draw.flipbook;
        const cell = cells[k];
        const cx = cell % columns, cy = Math.floor(cell / columns);
        if (spr.material.map) {
          spr.material.map = spr.material.map.clone();
          spr.material.map.repeat.set(1 / columns, 1 / rows);
          spr.material.map.offset.set(cx / columns, 1 - (cy + 1) / rows);
          spr.material.map.needsUpdate = true;
        }
      }
    }
    for (let k = count; k < pool.length; k++) pool[k].visible = false;
  }

  // ---------------------------------------------------------------- meshes
  _applyMesh(pass, draw) {
    if (draw.instanced) return this._applyInstances(pass, draw);
    if (!draw.count || !draw.indices) {
      for (const obj of pass.pool) obj.visible = false;
      return;
    }
    const pool = this._ensurePool(pass, 1, () => new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: pass.depthWrite, blending: pass.blending,
        side: pass.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        wireframe: pass.wireframe, vertexColors: true,
      }),
    ));
    const mesh = pool[0];
    mesh.visible = true;
    const geo = mesh.geometry;

    // Reuse the attribute buffers when the sizes match, so a deforming mesh uploads new data rather
    // than reallocating GPU buffers every frame.
    const setAttr = (name, data, itemSize) => {
      const existing = geo.getAttribute(name);
      if (existing && existing.array.length === data.length) {
        existing.array.set(data);
        existing.needsUpdate = true;
      } else {
        geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(data), itemSize));
      }
    };
    setAttr('position', draw.positions, 3);
    if (draw.normals) setAttr('normal', draw.normals, 3);
    if (draw.uvs) setAttr('uv', draw.uvs, 2);

    // Vertex colours carry base colour plus emission, premultiplied by opacity — the same
    // approximation as sprites, and for the same reason: MeshBasicMaterial has one colour channel.
    const rgb = new Float32Array(draw.count * 3);
    for (let k = 0; k < draw.count; k++) {
      const a = draw.opacity ? draw.opacity[k] : 1;
      rgb[k * 3] = (draw.vertexColors[k * 4] + (draw.emission ? draw.emission[k * 4] : 0)) * a;
      rgb[k * 3 + 1] = (draw.vertexColors[k * 4 + 1] + (draw.emission ? draw.emission[k * 4 + 1] : 0)) * a;
      rgb[k * 3 + 2] = (draw.vertexColors[k * 4 + 2] + (draw.emission ? draw.emission[k * 4 + 2] : 0)) * a;
    }
    setAttr('color', rgb, 3);

    const idx = geo.getIndex();
    if (idx && idx.array.length === draw.indices.length) {
      idx.array.set(draw.indices);
      idx.needsUpdate = true;
    } else {
      geo.setIndex(Array.from(draw.indices));
    }
    geo.computeBoundingSphere();

    // Average opacity for the material's own alpha. Per-vertex alpha would need a custom shader; the
    // support table lists opacity as native for the preview, which it is — this is the blend factor,
    // and per-vertex variation still shows through the colour premultiply above.
    let sum = 0;
    for (let k = 0; k < draw.count; k++) sum += draw.opacity ? draw.opacity[k] : 1;
    mesh.material.opacity = draw.count ? Math.max(0, Math.min(1, sum / draw.count)) : 1;
  }

  _applyInstances(pass, draw) {
    // One InstancedMesh per source geometry: three needs a single geometry per instanced draw, and a
    // pass may place several different shapes.
    const bySource = new Map();
    for (let k = 0; k < draw.count; k++) {
      const which = Math.round(draw.sourceIndex[k]) || 0;
      if (!bySource.has(which)) bySource.set(which, []);
      bySource.get(which).push(k);
    }

    const needed = [...bySource.keys()];
    let slot = 0;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (const which of needed) {
      const rows = bySource.get(which);
      const src = draw.sources[which] || draw.sources[0];
      if (!src || !src.faces) continue;

      const key = `inst${which}`;
      let mesh = pass.pool.find((o) => o.userData.instKey === key);
      const capacity = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(1, rows.length))));
      if (!mesh || mesh.userData.capacity < rows.length) {
        if (mesh) {
          pass.group.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          pass.pool.splice(pass.pool.indexOf(mesh), 1);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(src.points.attrs.position.data), 3));
        if (src.points.attrs.normal) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(src.points.attrs.normal.data), 3));
        geo.setIndex(Array.from(src.faces.corners));
        geo.computeBoundingSphere();
        mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
          transparent: true, depthWrite: pass.depthWrite, blending: pass.blending,
          side: pass.doubleSided ? THREE.DoubleSide : THREE.FrontSide, wireframe: pass.wireframe,
        }), capacity);
        mesh.userData = { instKey: key, capacity };
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        pass.group.add(mesh);
        pass.pool.push(mesh);
      }
      mesh.visible = true;
      mesh.count = rows.length;
      for (let n = 0; n < rows.length; n++) {
        const k = rows[n];
        pos.set(draw.positions[k * 3], draw.positions[k * 3 + 1], draw.positions[k * 3 + 2]);
        quat.set(draw.rotations[k * 4], draw.rotations[k * 4 + 1], draw.rotations[k * 4 + 2], draw.rotations[k * 4 + 3]);
        scale.set(draw.scales[k * 3], draw.scales[k * 3 + 1], draw.scales[k * 3 + 2]);
        matrix.compose(pos, quat, scale);
        mesh.setMatrixAt(n, matrix);
        if (draw.colors && draw.colors.length) {
          const a = draw.opacity && draw.opacity.length ? draw.opacity[k] : 1;
          mesh.instanceColor.setXYZ(n,
            (draw.colors[k * 4] + (draw.emission?.[k * 4] || 0)) * a,
            (draw.colors[k * 4 + 1] + (draw.emission?.[k * 4 + 1] || 0)) * a,
            (draw.colors[k * 4 + 2] + (draw.emission?.[k * 4 + 2] || 0)) * a);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      slot++;
    }
    for (const obj of pass.pool) {
      if (!needed.some((w) => obj.userData.instKey === `inst${w}`)) obj.visible = false;
    }
  }

  // ---------------------------------------------------------------- strips
  // Trails, ribbons, beams and lines. A width-bearing strip is built as a camera-facing triangle
  // ribbon: each vertex is offset perpendicular to both the strip direction and the view direction,
  // which is what keeps a trail visible from every angle. A `line` pass has no width and draws as
  // LineSegments instead.
  _applyStrips(pass, draw, camera) {
    const strips = draw.strips || [];
    const isLine = draw.kind === 'line';
    const isRibbon = draw.kind === 'ribbon';

    const pool = this._ensurePool(pass, strips.length, () => (isLine
      ? new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
        transparent: true, depthWrite: pass.depthWrite, blending: pass.blending, vertexColors: true,
      }))
      : new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: pass.depthWrite, blending: pass.blending,
        side: THREE.DoubleSide, vertexColors: true,
      }))));

    const eye = camera ? camera.position : new THREE.Vector3(0, 0, 1);
    const dir = new THREE.Vector3(), toEye = new THREE.Vector3(), side = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3();

    for (let s = 0; s < strips.length; s++) {
      const strip = strips[s];
      const obj = pool[s];
      obj.visible = strip.count >= 2;
      if (!obj.visible) continue;
      const geo = obj.geometry;

      if (isLine) {
        const rgb = new Float32Array(strip.count * 3);
        for (let k = 0; k < strip.count; k++) {
          const alpha = strip.colors[k * 4 + 3];
          rgb[k * 3] = strip.colors[k * 4] * alpha;
          rgb[k * 3 + 1] = strip.colors[k * 4 + 1] * alpha;
          rgb[k * 3 + 2] = strip.colors[k * 4 + 2] * alpha;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strip.positions), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
        geo.computeBoundingSphere();
        continue;
      }

      // Two vertices per strip point, two triangles per segment.
      const n = strip.count;
      const verts = new Float32Array(n * 2 * 3);
      const cols = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const indices = new Array((n - 1) * 6);

      for (let k = 0; k < n; k++) {
        a.set(strip.positions[k * 3], strip.positions[k * 3 + 1], strip.positions[k * 3 + 2]);
        // Direction along the strip: forward difference, backward at the last point.
        const nk = Math.min(n - 1, k + 1), pk = Math.max(0, k - 1);
        b.set(strip.positions[nk * 3] - strip.positions[pk * 3],
          strip.positions[nk * 3 + 1] - strip.positions[pk * 3 + 1],
          strip.positions[nk * 3 + 2] - strip.positions[pk * 3 + 2]);
        dir.copy(b).normalize();

        if (isRibbon) {
          // A ribbon keeps its own plane: offset perpendicular to the strip and to world up, so it
          // does NOT turn to face the viewer. Falling back to Z when the strip runs vertically avoids
          // a zero-length cross product collapsing the ribbon to nothing.
          side.set(0, 1, 0).cross(dir);
          if (side.lengthSq() < 1e-8) side.set(0, 0, 1).cross(dir);
        } else {
          toEye.copy(eye).sub(a).normalize();
          side.copy(dir).cross(toEye);
          if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        }
        side.normalize().multiplyScalar(strip.widths[k] * 0.5);

        for (const sgn of [0, 1]) {
          const vi = k * 2 + sgn;
          const off = sgn === 0 ? -1 : 1;
          verts[vi * 3] = a.x + side.x * off;
          verts[vi * 3 + 1] = a.y + side.y * off;
          verts[vi * 3 + 2] = a.z + side.z * off;
          const alpha = strip.colors[k * 4 + 3];
          cols[vi * 3] = strip.colors[k * 4] * alpha;
          cols[vi * 3 + 1] = strip.colors[k * 4 + 1] * alpha;
          cols[vi * 3 + 2] = strip.colors[k * 4 + 2] * alpha;
          const flow = (draw.settings.textureFlow || 0) * (draw.time || 0);
          uvs[vi * 2] = strip.alongs[k] * (draw.settings.tiling || 1) - flow;
          uvs[vi * 2 + 1] = sgn;
        }
      }
      for (let k = 0; k < n - 1; k++) {
        const i0 = k * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
        indices[k * 6] = i0; indices[k * 6 + 1] = i2; indices[k * 6 + 2] = i1;
        indices[k * 6 + 3] = i1; indices[k * 6 + 4] = i2; indices[k * 6 + 5] = i3;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeBoundingSphere();
    }
    for (let k = strips.length; k < pool.length; k++) pool[k].visible = false;
  }

  // ---------------------------------------------------------------- lights
  _applyLights(pass, draw) {
    // Hard cap. A thousand real lights will not render in any case, and attempting it locks the
    // renderer for seconds — the node already warns above 64, and this is the backstop that keeps a
    // mistake from freezing the app.
    const count = Math.min(draw.count || 0, 32);
    const pool = this._ensurePool(pass, count, () => new THREE.PointLight(0xffffff, 0, 8, 2));
    for (let k = 0; k < count; k++) {
      const light = pool[k];
      light.visible = true;
      light.position.set(draw.positions[k * 3], draw.positions[k * 3 + 1], draw.positions[k * 3 + 2]);
      light.color.setRGB(draw.colors[k * 4], draw.colors[k * 4 + 1], draw.colors[k * 4 + 2]);
      light.intensity = Math.max(0, draw.intensities[k]);
      light.distance = Math.max(0.01, draw.ranges[k]);
      light.decay = Math.max(0, draw.settings.falloff ?? 2);
    }
    for (let k = count; k < pool.length; k++) pool[k].visible = false;
  }
}
