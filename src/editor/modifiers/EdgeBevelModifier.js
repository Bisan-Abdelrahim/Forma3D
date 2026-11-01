import * as THREE from 'three';
import { faceLoop } from '../QuadTopology.js';

const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

// Selective, single-segment proportional chamfer on a closed quad surface.
// Faces can form a concave object, but individual source faces must be flat
// and convex. Stable corner IDs keep adjacent bevels and their end caps welded.
export class EdgeBevelModifier {
  apply(geometry, {edges: selection, amount = 0} = {}) {
    if (!Number.isFinite(amount) || amount < 0 || amount > 0.45) throw new Error('Bevel amount must be 0..0.45');
    const positions = geometry?.attributes.position, index = geometry?.index;
    if (!positions || !index || positions.count % 4 || index.count !== positions.count / 4 * 6) {
      throw new Error('Edge Bevel needs an editable quad mesh');
    }
    if (!Array.isArray(selection) || !selection.length) throw new Error('Select at least one edge for Bevel');
    // Every retained source quad produces at least four output quads.
    if (amount >= 1e-6 && positions.count / 4 > 2048) throw new Error('Edge Bevel would exceed the 8192-face editing limit');

    // Match the physical-corner grouping used by the mesh editor.
    const vertices = [], vertexByKey = new Map(), physical = [];
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i);
      if (!point.toArray().every(Number.isFinite)) throw new Error('Bevel needs finite vertex positions');
      const key = point.toArray().map(value => value.toFixed(5)).join(',');
      if (!vertexByKey.has(key)) {
        vertexByKey.set(key, vertices.length);
        vertices.push(point);
      }
      physical.push(vertexByKey.get(key));
    }
    const tolerance = Math.max(new THREE.Box3().setFromBufferAttribute(positions)
      .getSize(new THREE.Vector3()).length() * 1e-7, 1e-9);
    const faces = [], edges = new Map();
    for (let f = 0; f < positions.count / 4; f++) {
      const loop = faceLoop(geometry, f).map(i => physical[i]);
      if (new Set(loop).size !== 4) throw new Error('Cannot bevel a degenerate face');
      const points = loop.map(i => vertices[i]);
      const turnTolerance = tolerance * Math.max(...points.map((point, i) => point.distanceTo(points[(i + 1) % 4])));
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[1]));
      if (normal.length() < tolerance * tolerance) throw new Error('Cannot bevel a degenerate face');
      normal.normalize();
      if (points.some(point => Math.abs(point.clone().sub(points[0]).dot(normal)) > tolerance) ||
        points.some((point, i) => points[(i + 1) % 4].clone().sub(point)
          .cross(points[(i + 2) % 4].clone().sub(points[(i + 1) % 4])).dot(normal) < -turnTolerance)) {
        throw new Error('Edge Bevel needs flat convex faces');
      }
      faces.push(loop);
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % 4], key = edgeKey(a, b);
        if (!edges.has(key)) edges.set(key, {key, a, b, uses: [], selected: false});
        edges.get(key).uses.push({face: f, corner: i, a, b});
      });
    }
    if ([...edges.values()].some(edge => edge.uses.length !== 2 ||
      edge.uses[0].a !== edge.uses[1].b || edge.uses[0].b !== edge.uses[1].a)) {
      throw new Error('Edge Bevel needs a closed consistently oriented surface');
    }
    for (const pair of selection) {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(i => !Number.isInteger(i) || i < 0 || i >= positions.count)) {
        throw new Error('Invalid bevel edge');
      }
      const edge = edges.get(edgeKey(physical[pair[0]], physical[pair[1]]));
      if (!edge) throw new Error('Select an existing mesh edge for Bevel');
      edge.selected = true;
    }
    if (amount < 1e-6) return geometry.clone();

    const points = vertices.map(position => position.clone());
    const anchors = vertices.map((_, i) => i), offsetIds = new Map();
    const addPoint = (point, vertex) => {
      const id = points.length;
      points.push(point); anchors.push(vertex);
      return id;
    };
    const offsetPoint = (edge, vertex) => {
      const key = `${edge.key}@${vertex}`;
      if (!offsetIds.has(key)) {
        const other = edge.a === vertex ? edge.b : edge.a;
        offsetIds.set(key, addPoint(vertices[vertex].clone().lerp(vertices[other], amount), vertex));
      }
      return offsetIds.get(key);
    };
    const faceEdges = faces.map(loop => loop.map((a, i) => edges.get(edgeKey(a, loop[(i + 1) % 4]))));
    const corners = faces.map((loop, f) => loop.map((v, i) => {
      const previous = faceEdges[f][(i + 3) % 4], next = faceEdges[f][i];
      if (previous.selected && next.selected) {
        return addPoint(vertices[v].clone()
          .addScaledVector(vertices[loop[(i + 3) % 4]].clone().sub(vertices[v]), amount)
          .addScaledVector(vertices[loop[(i + 1) % 4]].clone().sub(vertices[v]), amount), v);
      }
      if (previous.selected) return offsetPoint(next, v);
      if (next.selected) return offsetPoint(previous, v);
      return v;
    }));
    // Unselected edges share one trimmed endpoint across both incident faces.
    // This also clips the end of a lone bevel into the third face at a corner.
    const endpoint = (edge, vertex) => {
      const trimmed = edge.uses.some(use => {
        const i = faces[use.face].indexOf(vertex);
        return faceEdges[use.face][i].selected || faceEdges[use.face][(i + 3) % 4].selected;
      });
      return trimmed ? offsetPoint(edge, vertex) : vertex;
    };
    const polygons = [];
    const polygon = (loop, selectedEdges = []) => {
      const clean = loop.filter((v, i) => v !== loop[(i + loop.length - 1) % loop.length]);
      if (clean.length < 3 || new Set(clean).size !== clean.length) throw new Error('Bevel produced an invalid corner');
      polygons.push({loop: clean, selectedEdges: new Set(selectedEdges)});
    };
    faces.forEach((loop, f) => {
      const boundary = [];
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % 4], edge = faceEdges[f][i];
        boundary.push(edge.selected ? corners[f][i] : endpoint(edge, a));
        boundary.push(edge.selected ? corners[f][(i + 1) % 4] : endpoint(edge, b));
      });
      polygon(boundary);
    });
    for (const edge of edges.values()) if (edge.selected) {
      const [a, b] = edge.uses;
      const a0 = corners[a.face][a.corner], a1 = corners[a.face][(a.corner + 1) % 4];
      const b0 = corners[b.face][b.corner], b1 = corners[b.face][(b.corner + 1) % 4];
      polygon([a1, a0, b1, b0], [edgeKey(a0, a1), edgeKey(b0, b1)]);
    }

    const uses = new Map();
    for (const {loop} of polygons) loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length], key = edgeKey(a, b);
      if (!uses.has(key)) uses.set(key, []);
      uses.get(key).push([a, b]);
    });
    const gaps = new Map();
    for (const list of uses.values()) {
      if (list.length === 2 && list[0][0] === list[1][1] && list[0][1] === list[1][0]) continue;
      if (list.length !== 1 || anchors[list[0][0]] !== anchors[list[0][1]]) throw new Error('Bevel could not join the selected edges');
      const [a, b] = list[0], vertex = anchors[a];
      if (!gaps.has(vertex)) gaps.set(vertex, []);
      gaps.get(vertex).push([b, a]); // Fill with the opposite boundary orientation.
    }
    for (const boundary of gaps.values()) {
      while (boundary.length) {
        const [start, end] = boundary.shift(), loop = [start, end];
        while (loop.at(-1) !== start) {
          const next = boundary.findIndex(([a]) => a === loop.at(-1));
          if (next < 0) throw new Error('Bevel could not close a corner');
          loop.push(boundary.splice(next, 1)[0][1]);
        }
        polygon(loop.slice(0, -1));
      }
    }

    // A varying-width strip or high-valence corner can be twisted. Split those
    // patches into planar triangles before making quads, so the output itself
    // can be bevelled again. Straight boundary corners are intentionally retained.
    const planar = [];
    for (const patch of polygons) {
      const {loop} = patch;
      const center = new THREE.Vector3(); loop.forEach(v => center.add(points[v])); center.divideScalar(loop.length);
      const normal = new THREE.Vector3();
      loop.forEach((v, i) => normal.add(points[v].clone().sub(center)
        .cross(points[loop[(i + 1) % loop.length]].clone().sub(center))));
      normal.normalize();
      if (loop.every(v => Math.abs(points[v].clone().sub(center).dot(normal)) <= tolerance)) {
        planar.push(patch);
      } else {
        const c = addPoint(center, null);
        loop.forEach((a, i) => planar.push({loop: [a, loop[(i + 1) % loop.length], c], selectedEdges: patch.selectedEdges}));
      }
    }

    // Quad fans retain the editor's four-positions/six-indices face contract.
    // Midpoint IDs are shared even when two neighboring polygons differ in size.
    if (planar.reduce((count, {loop}) => count + loop.length, 0) > 8192) {
      throw new Error('Edge Bevel would exceed the 8192-face editing limit');
    }
    const midpoints = new Map();
    const midpoint = (a, b) => {
      const key = edgeKey(a, b);
      if (!midpoints.has(key)) midpoints.set(key, addPoint(points[a].clone().add(points[b]).multiplyScalar(0.5), null));
      return midpoints.get(key);
    };
    const output = [], indices = [], uv = [], bevelEdges = [];
    for (const {loop, selectedEdges} of planar) {
      const center = new THREE.Vector3(); loop.forEach(v => center.add(points[v])); center.divideScalar(loop.length);
      const c = addPoint(center, null);
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length], previous = loop[(i + loop.length - 1) % loop.length];
        const start = output.length / 3;
        for (const v of [a, midpoint(a, b), c, midpoint(previous, a)]) output.push(...points[v].toArray());
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        if (selectedEdges.has(edgeKey(a, b))) bevelEdges.push([start, start + 1]);
        if (selectedEdges.has(edgeKey(previous, a))) bevelEdges.push([start + 3, start]);
      });
    }
    if (output.some(value => !Number.isFinite(Math.fround(value)))) throw new Error('Bevel produced invalid positions');
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(output, 3));
    result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    result.setIndex(indices);
    result.parameters = {...geometry.parameters};
    // Transient selection handoff; the tool consumes this after commit.
    result.userData.bevelEdgeIndices = bevelEdges;
    result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
    return result;
  }
}
