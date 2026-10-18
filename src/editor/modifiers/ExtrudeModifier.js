import * as THREE from 'three';
import { facePoints, faceLoop } from '../QuadTopology.js';

export class ExtrudeModifier {
  apply(geometry, {face, amount = 0} = {}) {
    if (!Number.isFinite(amount) || Math.abs(amount) > 10) throw new Error('Invalid extrusion distance');
    const loop = faceLoop(geometry, face), points = facePoints(geometry, face);
    const normal = new THREE.Vector3().subVectors(points[1], points[0])
      .cross(new THREE.Vector3().subVectors(points[2], points[0])).normalize();
    if (normal.lengthSq() < 0.5) throw new Error('Cannot extrude a degenerate face');
    if (Math.abs(amount) < 1e-6) return geometry.clone();
    const offset = normal.multiplyScalar(amount);
    const positions = Array.from(geometry.attributes.position.array);
    const indices = Array.from(geometry.index.array);
    const uvs = geometry.attributes.uv ? Array.from(geometry.attributes.uv.array) : new Array(positions.length / 3 * 2).fill(0);
    // Move only the cap; original boundary remains attached to the other faces.
    for (const id of loop) for (let c = 0; c < 3; c++) positions[id * 3 + c] += offset.getComponent(c);
    for (let i = 0; i < 4; i++) {
      const a = points[i], b = points[(i + 1) % 4];
      const start = positions.length / 3;
      for (const p of [a, b, b.clone().add(offset), a.clone().add(offset)]) positions.push(...p.toArray());
      uvs.push(0,0, 1,0, 1,1, 0,1);
      indices.push(start, start+1, start+2, start, start+2, start+3);
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    result.setIndex(indices);
    result.parameters = {...geometry.parameters};
    result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
    return result;
  }
}
