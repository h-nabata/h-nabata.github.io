(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};

  function vsub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function vadd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function vscale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) {
    const n = norm(a);
    if (n < 1e-9) return { x: 1, y: 0, z: 0 };
    return vscale(a, 1 / n);
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function degToRad(v) { return v * Math.PI / 180; }
  function radToDeg(v) { return v * 180 / Math.PI; }

  function distance(a, b) {
    return norm(vsub(a, b));
  }

  function angle(a, b, c) {
    const ba = unit(vsub(a, b));
    const bc = unit(vsub(c, b));
    return radToDeg(Math.acos(clamp(dot(ba, bc), -1, 1)));
  }

  function rotateAroundAxis(point, origin, axis, degrees) {
    const theta = degToRad(degrees);
    const u = unit(axis);
    const p = vsub(point, origin);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const term1 = vscale(p, cos);
    const term2 = vscale(cross(u, p), sin);
    const term3 = vscale(u, dot(u, p) * (1 - cos));
    return vadd(origin, vadd(vadd(term1, term2), term3));
  }

  function dihedral(a, b, c, d) {
    const b1 = vsub(b, a);
    const b2 = vsub(c, b);
    const b3 = vsub(d, c);
    const n1 = unit(cross(b1, b2));
    const n2 = unit(cross(b2, b3));
    const m1 = cross(n1, unit(b2));
    return radToDeg(Math.atan2(dot(m1, n2), dot(n1, n2)));
  }

  function setDistance(a, b, target) {
    const dir = unit(vsub(b, a));
    return vadd(a, vscale(dir, target));
  }

  function setAngle(a, b, c, targetDegrees) {
    const current = angle(a, b, c);
    const axis = cross(vsub(a, b), vsub(c, b));
    return rotateAroundAxis(c, b, axis, targetDegrees - current);
  }

  function setDihedral(a, b, c, d, targetDegrees) {
    const current = dihedral(a, b, c, d);
    return rotateAroundAxis(d, c, vsub(c, b), targetDegrees - current);
  }

  MV.Geometry = {
    vsub,
    vadd,
    vscale,
    dot,
    cross,
    norm,
    unit,
    distance,
    angle,
    dihedral,
    rotateAroundAxis,
    setDistance,
    setAngle,
    setDihedral
  };
})(window);
