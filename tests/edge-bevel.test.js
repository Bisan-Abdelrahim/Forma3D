import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EdgeBevelModifier } from '../src/editor/modifiers/EdgeBevelModifier.js';
import { ExtrudeModifier } from '../src/editor/modifiers/ExtrudeModifier.js';
import { InsetModifier } from '../src/editor/modifiers/InsetModifier.js';
import { faceLoop, facePoints } from '../src/editor/QuadTopology.js';

const pointKey = point => point.toArray().map(value => value.toFixed(5)).join(',');

function meshEdges(geometry) {
  const edges = new Map(), position = geometry.attributes.position;
  for (let f = 0; f < position.count / 4; f++) {
    const loop = faceLoop(geometry, f);
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % 4];
      const key = [a, b].map(v => pointKey(new THREE.Vector3().fromBufferAttribute(position, v))).sort().join('|');
      if (!edges.has(key)) edges.set(key, [a, b]);
    });
  }
  return [...edges.values()];
}

function assertClosed(geometry) {
  const position = geometry.attributes.position, edges = new Map();
  assert.equal(geometry.index.count, position.count / 4 * 6);
  assert.equal(geometry.attributes.normal.count, position.count);
  assert.equal(geometry.attributes.uv.count, position.count);
  assert.ok(position.array.every(Number.isFinite));
  let volume = 0;
  for (let f = 0; f < position.count / 4; f++) {
    const points = facePoints(geometry, f), loop = points.map(pointKey);
    assert.equal(new Set(loop).size, 4, 'four distinct physical corners per quad');
    for (const [a, b, c] of [[points[0], points[1], points[2]], [points[0], points[2], points[3]]]) {
      assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() > 1e-16, 'nondegenerate triangles');
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % 4], key = [a, b].sort().join('|');
      const uses = edges.get(key) ?? [];
      uses.push([a, b]); edges.set(key, uses);
    });
  }
  for (const uses of edges.values()) {
    assert.equal(uses.length, 2, 'closed surface without overlapping/T-junction edges');
    assert.equal(uses[0][0], uses[1][1], 'opposite shared-edge orientation');
    assert.equal(uses[0][1], uses[1][0]);
  }
  assert.ok(volume > 0, 'outward oriented solid');
}

test('selected bevel closes single, adjacent, opposite and corner-connected cube edge selections', () => {
  const modifier = new EdgeBevelModifier(), source = new THREE.BoxGeometry(2, 2, 2);
  const edges = meshEdges(source), patterns = new Set([4095, 1365, 2730]);
  assert.equal(edges.length, 12);
  for (let mask = 1; mask < 4096; mask++) {
    const count = mask.toString(2).replaceAll('0', '').length;
    if (count <= 2 || count >= 10 || mask % 97 === 0) patterns.add(mask);
  }
  const original = source.attributes.position.array.slice();
  for (const mask of patterns) for (const amount of [0.05, 0.45]) {
    const selected = edges.filter((_, i) => mask & (1 << i));
    const result = modifier.apply(source, {edges: selected, amount});
    assertClosed(result);
    assert.equal(result.userData.bevelEdgeIndices.length, selected.length * 4);
    assert.deepEqual(source.attributes.position.array, original);
    result.dispose();
  }
  source.dispose();
});

test('selected bevel preserves unselected corners and supports skewed/tapered quads', () => {
  const modifier = new EdgeBevelModifier(), geometry = new THREE.BoxGeometry(2, 2, 2);
  const [edge] = meshEdges(geometry);
  const result = modifier.apply(geometry, {edges: [edge], amount: 0.2});
  const endpoints = edge.map(i => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i));
  const corners = new Set();
  for (let i = 0; i < result.attributes.position.count; i++) corners.add(pointKey(new THREE.Vector3().fromBufferAttribute(result.attributes.position, i)));
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i);
    if (endpoints.every(endpoint => endpoint.distanceTo(point) > 1e-6)) assert.ok(corners.has(pointKey(point)));
  }
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), factor = 1 + 0.1 * y;
    p.setXYZ(i, p.getX(i) * factor + 0.2 * y, y, p.getZ(i) * factor);
  }
  const skewed = modifier.apply(geometry, {edges: meshEdges(geometry).slice(0, 3), amount: 0.1});
  assertClosed(skewed);
  geometry.dispose(); result.dispose(); skewed.dispose();
});

test('edge bevel supports extruded/inset concave quad surfaces and repeated bevels', () => {
  const modifier = new EdgeBevelModifier();
  const cube = new THREE.BoxGeometry(2, 2, 2);
  const inset = new InsetModifier().apply(cube, {face: 0, amount: 0.4});
  const raised = new ExtrudeModifier().apply(inset, {face: 0, amount: 0.75});
  const pairs = meshEdges(raised);
  for (const edge of pairs) {
    const result = modifier.apply(raised, {edges: [edge], amount: 0.05});
    assertClosed(result);
    result.dispose();
  }
  const first = modifier.apply(cube, {edges: meshEdges(cube).slice(0, 2), amount: 0.15});
  const second = modifier.apply(first, {edges: [first.userData.bevelEdgeIndices[0]], amount: 0.1});
  assertClosed(second);
  for (const geometry of [cube, inset, raised, first, second]) geometry.dispose();
});

test('edge bevel validates selection and topology; zero amount preserves buffers', () => {
  const modifier = new EdgeBevelModifier(), cube = new THREE.BoxGeometry(2, 2, 2);
  const edges = meshEdges(cube).slice(0, 2);
  const copy = modifier.apply(cube, {edges, amount: 0});
  assert.deepEqual(copy.attributes.position.array, cube.attributes.position.array);
  assert.deepEqual(copy.index.array, cube.index.array);
  for (const options of [{edges: []}, {edges, amount: -1}, {edges, amount: NaN}, {edges, amount: 0.5},
    {edges: [[-1, 2]]}, {edges: [[0, 999]]}, {edges: [[0, 3]]}]) assert.throws(() => modifier.apply(cube, options));
  const open = cube.clone(); open.setIndex(Array.from(open.index.array).slice(0, -6));
  assert.throws(() => modifier.apply(open, {edges, amount: 0.1}));
  const warped = cube.clone(); warped.attributes.position.setX(0, 1.2);
  assert.throws(() => modifier.apply(warped, {edges, amount: 0.1}), /flat convex|closed/);
  for (const geometry of [cube, copy, open, warped]) geometry.dispose();
});

test('repeated edge bevel stops at the editing face limit without mutating its source', () => {
  const modifier = new EdgeBevelModifier();
  let geometry = new THREE.BoxGeometry(2, 2, 2), limited = false;
  for (let i = 0; i < 8; i++) {
    const before = geometry.attributes.position.array.slice();
    try {
      const next = modifier.apply(geometry, {edges: meshEdges(geometry).slice(0, 1), amount: 0.1});
      assert.ok(next.attributes.position.count / 4 <= 8192);
      geometry.dispose(); geometry = next;
    } catch (error) {
      assert.match(error.message, /8192-face/);
      assert.deepEqual(geometry.attributes.position.array, before);
      const noop = modifier.apply(geometry, {edges: meshEdges(geometry).slice(0, 1), amount: 0});
      assert.deepEqual(noop.attributes.position.array, before);
      noop.dispose();
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
  geometry.dispose();
});
