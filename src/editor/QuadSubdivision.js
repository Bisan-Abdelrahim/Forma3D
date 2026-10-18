import * as THREE from 'three';
import { facePoints, faceLoop } from './QuadTopology.js';

// Refine the existing surface, preserving prior edits and independent quad layout.
export function subdivideForBend(geometry, axis, length, segments = 16) {
  const positions = [], uv = [], indices = [];
  const attribute = geometry.attributes.uv;
  for (let face = 0; face < geometry.index.count / 6; face++) {
    const p = facePoints(geometry, face), loop = faceLoop(geometry, face);
    const tex = loop.map(i => attribute ? new THREE.Vector2().fromBufferAttribute(attribute, i) : new THREE.Vector2());
    const steps = (a,b,c,d) => Math.max(1, Math.ceil(Math.max(Math.abs(p[a][axis]-p[b][axis]), Math.abs(p[c][axis]-p[d][axis])) / length * segments - 1e-6));
    const nu = steps(0,1,3,2), nv = steps(0,3,1,2);
    if (positions.length / 12 + nu * nv > 8192) throw new Error('Mesh too detailed for Bend. Undo or use a simpler mesh.');
    const interpolate = (values,u,v) => values[0].clone().lerp(values[1],u).lerp(values[3].clone().lerp(values[2],u),v);
    for (let v=0; v<nv; v++) for (let u=0; u<nu; u++) {
      const start = positions.length / 3;
      for (const [x,y] of [[u/nu,v/nv],[(u+1)/nu,v/nv],[(u+1)/nu,(v+1)/nv],[u/nu,(v+1)/nv]]) {
        positions.push(...interpolate(p,x,y).toArray()); uv.push(...interpolate(tex,x,y).toArray());
      }
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  result.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); result.setIndex(indices);
  result.parameters = {...geometry.parameters};
  return result;
}
