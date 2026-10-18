import * as THREE from 'three';

// Editable meshes use independent four-vertex quads, each indexed by two triangles.
export function faceLoop(geometry, face) {
  const index = geometry.index;
  if (!index || !Number.isInteger(face) || face < 0 || (face + 1) * 6 > index.count) throw new Error('Invalid face');
  const edges = [];
  for (let t = face * 6; t < face * 6 + 6; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    for (let i = 0; i < 3; i++) edges.push([ids[i], ids[(i + 1) % 3]]);
  }
  const boundary = edges.filter(([a,b]) => !edges.some(([c,d]) => a === d && b === c));
  if (boundary.length !== 4) throw new Error('Expected a quad face');
  const loop = [boundary[0][0]];
  for (let i = 0; i < 3; i++) {
    const next = boundary.find(([a]) => a === loop.at(-1));
    if (!next) throw new Error('Invalid quad boundary');
    loop.push(next[1]);
  }
  return loop;
}
export function facePoints(geometry, face) {
  return faceLoop(geometry, face).map(i => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i));
}
