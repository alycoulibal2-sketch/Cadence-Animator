// Shared shape-layer mesh geometry: how a base shape (renderer/js/effectShapes.js) becomes an
// actual three.js mesh. Used by BOTH the main viewport's EffectInstance (rigbuild.js) and the
// standalone studio's preview (renderer-vfx/js/preview.js) — kept in exactly one place so the
// two can never render the same effect differently, the same class of bug this app has hit
// before with particle textures and part-gap scaling (see rigbuild.js's PART_GAP_SCALE comment).
import * as THREE from '../../node_modules/three/build/three.module.js';
import { shapePoint, isSurfaceShape } from './effectShapes.js';

export class ShapeCurve extends THREE.Curve {
  constructor(def) { super(); this.def = def; }
  getPoint(u, target = new THREE.Vector3()) {
    const p = shapePoint(this.def, u);
    return target.set(p[0], p[1], p[2]);
  }
}

// Surface shapes (sphere/cylinder/cone/rect/ring) get their natural three.js primitive; every
// other shape (line/arc/slash/ribbon/wave/spiral/lightning/circle/spline/...) becomes a tube
// swept along its tessellated polyline, radius = thickness.
export function buildShapeGeometry(def, thickness, isClosedShape) {
  if (isSurfaceShape(def)) {
    switch (def.kind) {
      case 'sphere': return new THREE.SphereGeometry(def.radius ?? 1.5, 24, 16);
      case 'cylinder': return new THREE.CylinderGeometry(def.radius ?? 1.5, def.radius ?? 1.5, def.height ?? 3, 24, 1, true).translate(0, (def.height ?? 3) / 2, 0);
      case 'cone': return new THREE.ConeGeometry(def.radius ?? 1.5, def.height ?? 2.5, 24, 1, true).rotateX(Math.PI).translate(0, (def.height ?? 2.5) / 2, 0);
      case 'rect': return new THREE.PlaneGeometry(def.width ?? 4, def.depth ?? 4).rotateX(-Math.PI / 2);
      case 'ring': return new THREE.RingGeometry(Math.max(0.01, (def.radius ?? 2) - (def.width ?? 0.5) / 2), (def.radius ?? 2) + (def.width ?? 0.5) / 2, 48).rotateX(-Math.PI / 2);
      case 'slash': break; // slash reads best as a tube along its arc — fall through
      default: break;
    }
  }
  return new THREE.TubeGeometry(new ShapeCurve(def), 64, Math.max(0.004, thickness), 8, isClosedShape);
}
