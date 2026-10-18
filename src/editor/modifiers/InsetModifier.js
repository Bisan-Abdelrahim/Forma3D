import * as THREE from 'three';
import { facePoints, faceLoop } from '../QuadTopology.js';

// Proportional inset around the center of a planar convex quad (not constant-width offset).
export class InsetModifier {
  apply(geometry, {face, amount = 0} = {}) {
    if (!Number.isFinite(amount) || amount < 0 || amount > 0.95) throw new Error('Inset amount must be 0..0.95');
    const loop = faceLoop(geometry,face), points = facePoints(geometry,face);
    const center = new THREE.Vector3(); for (const p of points) center.add(p); center.multiplyScalar(0.25);
    if (amount < 1e-6) { const copy = geometry.clone(); copy.parameters = {...geometry.parameters}; return copy; }
    const edge = (a,b) => new THREE.Vector3().subVectors(b,a);
    const normal = edge(points[0],points[1]).cross(edge(points[1],points[2]));
    const scale = Math.max(...points.map(p => p.distanceTo(center)));
    if (normal.length() < scale*scale*1e-8) throw new Error('Select a non-degenerate face for Inset');
    normal.normalize();
    if (points.some(p => Math.abs(edge(points[0],p).dot(normal)) > scale*1e-5) ||
        points.some((p,i) => edge(p,points[(i+1)%4]).cross(edge(points[(i+1)%4],points[(i+2)%4])).dot(normal) <= scale*scale*1e-8)) {
      throw new Error('Inset needs a flat convex face');
    }
    const inner = points.map(p => p.clone().lerp(center,amount));
    const positions = Array.from(geometry.attributes.position.array), indices = Array.from(geometry.index.array);
    const attribute = geometry.attributes.uv;
    const uv = attribute ? Array.from(attribute.array) : new Array(positions.length/3*2).fill(0);
    const tex = loop.map(i => new THREE.Vector2(uv[i*2],uv[i*2+1]));
    const texCenter = new THREE.Vector2(); for (const t of tex) texCenter.add(t); texCenter.multiplyScalar(0.25);
    const innerTex = tex.map(t => t.clone().lerp(texCenter,amount));
    loop.forEach((id,i) => { positions.splice(id*3,3,...inner[i].toArray()); uv.splice(id*2,2,...innerTex[i].toArray()); });
    for (let i=0;i<4;i++) {
      const j=(i+1)%4, start=positions.length/3;
      for (const p of [points[i],points[j],inner[j],inner[i]]) positions.push(...p.toArray());
      for (const t of [tex[i],tex[j],innerTex[j],innerTex[i]]) uv.push(...t.toArray());
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
    const result=new THREE.BufferGeometry();
    result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    result.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); result.setIndex(indices);
    result.parameters={...geometry.parameters};
    result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
    return result;
  }
}
