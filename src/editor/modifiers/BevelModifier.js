import * as THREE from 'three';
import { facePoints } from '../QuadTopology.js';

// One-segment all-edge chamfer of a closed convex six-quad/eight-corner mesh.
// Emit quads throughout, including three quads per triangular corner patch.
export class BevelModifier {
  apply(geometry, {amount = 0} = {}) {
    if (!Number.isFinite(amount) || amount < 0 || amount > 0.45) throw new Error('Bevel amount must be 0..0.45');
    if (!geometry?.index || geometry.index.count !== 36 || geometry.attributes.position.count !== 24) throw new Error('Bevel currently needs an unsubdivided cube (Skew/Taper are supported)');
    const faces = Array.from({length:6},(_,f)=>facePoints(geometry,f));
    const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const tolerance = Math.max(box.getSize(new THREE.Vector3()).length()*1e-6,1e-9);
    const corners = [], ids = faces.map(points=>points.map(p=>{
      let id=corners.findIndex(q=>p.distanceTo(q)<tolerance);
      if(id<0) {id=corners.length;corners.push(p.clone());} return id;
    }));
    if(corners.length!==8) throw new Error('Bevel needs eight distinct corners');
    const center = box.getCenter(new THREE.Vector3()), edges=new Map(), patches=corners.map(()=>[]);
    const inset = faces.map((points,f)=>points.map((p,i)=>{
      const n=new THREE.Vector3().subVectors(points[1],points[0]).cross(new THREE.Vector3().subVectors(points[2],points[0]));
      if(n.length()<tolerance*tolerance) throw new Error('Cannot bevel a degenerate cube');
      n.normalize();
      if(points.some(q=>Math.abs(new THREE.Vector3().subVectors(q,points[0]).dot(n))>tolerance) || corners.some(q=>new THREE.Vector3().subVectors(q,points[0]).dot(n)>tolerance)) throw new Error('Bevel needs a flat-faced convex cube');
      const q=p.clone().addScaledVector(new THREE.Vector3().subVectors(points[(i+3)%4],p),amount)
        .addScaledVector(new THREE.Vector3().subVectors(points[(i+1)%4],p),amount);
      patches[ids[f][i]].push(q); return q;
    }));
    ids.forEach((loop,f)=>loop.forEach((a,i)=>{
      const j=(i+1)%4,b=loop[j],key=[a,b].sort((x,y)=>x-y).join(':');
      const uses=edges.get(key)??[]; uses.push({a,b,p:inset[f][i],q:inset[f][j]});edges.set(key,uses);
    }));
    if(edges.size!==12 || [...edges.values()].some(e=>e.length!==2 || e[0].a!==e[1].b || e[0].b!==e[1].a) || patches.some(p=>p.length!==3)) throw new Error('Bevel needs a closed cube topology');
    if(amount<1e-6) {const copy=geometry.clone();copy.parameters={...geometry.parameters};return copy;}
    const polygons=[...inset];
    for(const uses of edges.values()) polygons.push([uses[0].q,uses[0].p,uses[1].q,uses[1].p]);
    // Sort corner triangles around an outward normal before emitting patches.
    patches.forEach((points,id)=>{
      const n=corners[id].clone().sub(center).normalize();
      const c=new THREE.Vector3();points.forEach(p=>c.add(p));c.multiplyScalar(1/3);
      const u=points[0].clone().sub(c).normalize(),v=new THREE.Vector3().crossVectors(n,u);
      points.sort((a,b)=>Math.atan2(a.clone().sub(c).dot(v),a.clone().sub(c).dot(u))-Math.atan2(b.clone().sub(c).dot(v),b.clone().sub(c).dot(u)));
      polygons.push(points);
    });
    const positions=[],indices=[],uv=[];
    const quad=points=>{
      const start=positions.length/3;points.forEach(p=>positions.push(...p.toArray()));
      uv.push(0,0,1,0,1,1,0,1);indices.push(start,start+1,start+2,start,start+2,start+3);
    };
    // One quad per polygon vertex; shared polygon edges receive identical midpoints.
    for(const polygon of polygons) {
      const c=new THREE.Vector3();polygon.forEach(p=>c.add(p));c.multiplyScalar(1/polygon.length);
      polygon.forEach((p,i)=>quad([p,p.clone().add(polygon[(i+1)%polygon.length]).multiplyScalar(0.5),c,p.clone().add(polygon[(i+polygon.length-1)%polygon.length]).multiplyScalar(0.5)]));
    }
    const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    result.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));result.setIndex(indices);result.parameters={...geometry.parameters};
    result.computeVertexNormals();result.computeBoundingBox();result.computeBoundingSphere();return result;
  }
}
