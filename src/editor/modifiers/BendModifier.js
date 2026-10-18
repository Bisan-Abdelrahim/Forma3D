import * as THREE from 'three';
import { subdivideForBend } from '../QuadSubdivision.js';

export class BendModifier {
  apply(geometry, {axis = 'y', direction = 'x', angle = 0} = {}) {
    if (!geometry?.index || !geometry.attributes.position || !['x','y','z'].includes(axis) ||
        !['x','y','z'].includes(direction) || axis === direction || !Number.isFinite(angle) || Math.abs(angle) > 180) throw new Error('Invalid Bend options');
    if (Math.abs(angle) < 1e-5) { const copy = geometry.clone(); copy.parameters = {...geometry.parameters}; return copy; }
    const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const length = box.max[axis] - box.min[axis];
    if (length < 1e-8) throw new Error('Cannot bend a flat axis');
    const center = box.getCenter(new THREE.Vector3()), k = THREE.MathUtils.degToRad(angle) / length;
    const result = subdivideForBend(geometry, axis, length);
    const positions = result.attributes.position, p = new THREE.Vector3();
    for (let i=0; i<positions.count; i++) {
      p.fromBufferAttribute(positions,i);
      const s = p[axis] - box.min[axis], d = p[direction] - center[direction], theta = k*s;
      // Anchor the minimum-axis cross section; rotate successive cross sections.
      p[axis] = box.min[axis] + Math.sin(theta)/k - d*Math.sin(theta);
      p[direction] = center[direction] + 2*Math.sin(theta/2)**2/k + d*Math.cos(theta);
      positions.setXYZ(i,p.x,p.y,p.z);
    }
    positions.needsUpdate = true;
    result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
    return result;
  }
}
