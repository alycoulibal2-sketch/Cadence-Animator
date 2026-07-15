// CFrame math over flat arrays [x,y,z, r00,r01,r02, r10,r11,r12, r20,r21,r22]
// Same component order as Roblox CFrame:GetComponents(). Rotation rows are matrix rows.

export const IDENTITY = Object.freeze([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function cfNew(x = 0, y = 0, z = 0) {
  return [x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1];
}

// Reflects a joint transform across the rig's left/right (local X) plane — the math behind
// "reflect the rig": mirroring a rotation across a plane is M*R*M where M = diag(-1,1,1),
// which for our row-major layout works out to negating the off-diagonal terms touching X.
export function mirror(cf) {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf;
  return [-x, y, z, r00, -r01, -r02, -r10, r11, r12, -r20, r21, r22];
}

export function mul(a, b) {
  const [ax, ay, az, a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
  const [bx, by, bz, b00, b01, b02, b10, b11, b12, b20, b21, b22] = b;
  return [
    a00 * bx + a01 * by + a02 * bz + ax,
    a10 * bx + a11 * by + a12 * bz + ay,
    a20 * bx + a21 * by + a22 * bz + az,
    a00 * b00 + a01 * b10 + a02 * b20, a00 * b01 + a01 * b11 + a02 * b21, a00 * b02 + a01 * b12 + a02 * b22,
    a10 * b00 + a11 * b10 + a12 * b20, a10 * b01 + a11 * b11 + a12 * b21, a10 * b02 + a11 * b12 + a12 * b22,
    a20 * b00 + a21 * b10 + a22 * b20, a20 * b01 + a21 * b11 + a22 * b21, a20 * b02 + a21 * b12 + a22 * b22,
  ];
}

export function inverse(a) {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = a;
  // R^T
  const nx = -(r00 * x + r10 * y + r20 * z);
  const ny = -(r01 * x + r11 * y + r21 * z);
  const nz = -(r02 * x + r12 * y + r22 * z);
  return [nx, ny, nz, r00, r10, r20, r01, r11, r21, r02, r12, r22];
}

export function toQuat(cf) {
  const [, , , m00, m01, m02, m10, m11, m12, m20, m21, m22] = cf;
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
  }
  return [x, y, z, w];
}

export function fromQuatPos(q, px, py, pz) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    px, py, pz,
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ];
}

function slerp(qa, qb, t) {
  let [ax, ay, az, aw] = qa;
  let [bx, by, bz, bw] = qb;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
  if (cos > 0.9995) {
    const x = ax + t * (bx - ax), y = ay + t * (by - ay), z = az + t * (bz - az), w = aw + t * (bw - aw);
    const len = Math.hypot(x, y, z, w) || 1;
    return [x / len, y / len, z / len, w / len];
  }
  const theta = Math.acos(cos);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb];
}

export function lerp(a, b, t) {
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();
  const q = slerp(toQuat(a), toQuat(b), t);
  return fromQuatPos(q, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

// Matches Roblox CFrame.Angles / fromEulerAnglesXYZ
export function fromEuler(rx, ry, rz, px = 0, py = 0, pz = 0) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rx * Ry * Rz
  return [
    px, py, pz,
    cy * cz, -cy * sz, sy,
    sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy,
    -cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy,
  ];
}

// Inverse of fromEuler (Roblox toEulerAnglesXYZ)
export function toEuler(cf) {
  const [, , , m00, m01, m02, m10, m11, m12, m20, m21, m22] = cf;
  const ry = Math.asin(Math.max(-1, Math.min(1, m02)));
  let rx, rz;
  if (Math.abs(m02) < 0.99999) {
    rx = Math.atan2(-m12, m22);
    rz = Math.atan2(-m01, m00);
  } else {
    rx = Math.atan2(m21, m11);
    rz = 0;
  }
  return [rx, ry, rz];
}

export function orthonormalize(cf) {
  // Gram-Schmidt on rotation columns to fight drift
  let [x, y, z, m00, m01, m02, m10, m11, m12, m20, m21, m22] = cf;
  let cx = [m00, m10, m20], cy = [m01, m11, m21];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  cx = norm(cx);
  const dot = cx[0] * cy[0] + cx[1] * cy[1] + cx[2] * cy[2];
  cy = norm([cy[0] - cx[0] * dot, cy[1] - cx[1] * dot, cy[2] - cx[2] * dot]);
  const cz = [cx[1] * cy[2] - cx[2] * cy[1], cx[2] * cy[0] - cx[0] * cy[2], cx[0] * cy[1] - cx[1] * cy[0]];
  return [x, y, z, cx[0], cy[0], cz[0], cx[1], cy[1], cz[1], cx[2], cy[2], cz[2]];
}

export function position(cf) { return [cf[0], cf[1], cf[2]]; }

export function setPosition(cf, x, y, z) {
  const out = cf.slice();
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

export function almostEqual(a, b, eps = 1e-6) {
  for (let i = 0; i < 12; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

// three.js interop -------------------------------------------------------
export function toThreeMatrix(cf, m4) {
  // three Matrix4.set takes row-major args
  m4.set(
    cf[3], cf[4], cf[5], cf[0],
    cf[6], cf[7], cf[8], cf[1],
    cf[9], cf[10], cf[11], cf[2],
    0, 0, 0, 1,
  );
  return m4;
}

export function fromThreeMatrix(m4) {
  const e = m4.elements; // column-major
  return [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}
