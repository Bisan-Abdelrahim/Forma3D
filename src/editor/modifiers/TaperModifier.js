import * as THREE from 'three';

// Linear cross-section scaling around the local bounding-box center.
// The opposite end stays fixed; amount 0 is identity, -0.5 halves the target end.
export class TaperModifier {
  apply(geometry, {axis = 'y', end = 'positive', amount = 0} = {}) {
    if (!geometry?.isBufferGeometry || !geometry.getAttribute('position')) throw new Error('Invalid geometry');
    if (!['x', 'y', 'z'].includes(axis) || !['positive', 'negative'].includes(end) ||
        !Number.isFinite(amount) || amount < -0.95 || amount > 3) throw new Error('Invalid taper options');
    const source = geometry.getAttribute('position');
    const box = new THREE.Box3().setFromBufferAttribute(source);
    const center = box.getCenter(new THREE.Vector3());
    const length = box.max[axis] - box.min[axis];
    if (length <= 1e-10) throw new Error('Cannot taper a flat axis');
    const result = geometry.clone(), positions = result.getAttribute('position');
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(source, i);
      let t = (point[axis] - box.min[axis]) / length;
      if (end === 'negative') t = 1 - t;
      const factor = 1 + amount * t;
      for (const cross of ['x', 'y', 'z']) if (cross !== axis) point[cross] = center[cross] + (point[cross] - center[cross]) * factor;
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
    return result;
  }
}
