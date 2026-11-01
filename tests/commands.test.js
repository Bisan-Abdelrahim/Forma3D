import { SceneViewport } from '../src/editor/SceneViewport.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { BevelModifier } from '../src/editor/modifiers/BevelModifier.js';
import { EdgeBevelModifier } from '../src/editor/modifiers/EdgeBevelModifier.js';
import { InsetModifier } from '../src/editor/modifiers/InsetModifier.js';
import { BendModifier } from '../src/editor/modifiers/BendModifier.js';
import { ExtrudeModifier } from '../src/editor/modifiers/ExtrudeModifier.js';
import { facePoints } from '../src/editor/QuadTopology.js';
import { TaperModifier } from '../src/editor/modifiers/TaperModifier.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorApp } from '../src/editor/EditorApp.js';
import * as THREE from 'three';
import { validateCommand } from '../src/ai.js';

test('strict command boundary rejects malformed and dangerous payloads', () => {
  for (const command of [null, [], {}, { action: 'eval', code: 'alert(1)' },
    { action: 'delete', target: 'selected', extra: true },
    { action: 'create', shape: 'cone' },
    { action: 'create', shape: 'sphere', dimensions: { radius: -1 } },
    { action: 'move', target: 1, position: { x: Infinity, y: 0, z: 0 } },
    { action: 'scale', target: 1, scale: { x: 0, y: 1, z: 1 } },
    { action: 'rotate', target: 1, rotation: { x: '90', y: 0, z: 0 } },
    JSON.parse('{"action":"delete","target":1,"__proto__":{}}')]) {
    assert.throws(() => validateCommand(command));
  }
});

// Real editor services and Three.js geometry, with only the DOM/GPU boundary replaced.
function editor(options = {}) {
  const elements = new Map();
  const element = () => ({
    style: {setProperty() {}}, dataset: {}, remove() {}, setPointerCapture() {}, hasPointerCapture() { return false; },
    value: '', listeners: {}, children: [], validity: { valid: true },
    focus() { document.activeElement = this; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    classList: { toggle() {}, add() {}, remove() {} },
    contains(target) { return target === this || this.children.some(child => child.contains(target)); },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children.length = 0; }, setAttribute() {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    clientWidth: 800, clientHeight: 600
  });
  const find = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  class Transform {
    dragging = false; axis = null; mode = 'translate'; space = 'world'; listeners = {};
    attach(object) { this.object = object; }
    detach() { this.object = null; }
    setMode(mode) { this.mode = mode; }
    pointerUp() { this.dragging = false; }
    getMode() { return this.mode; }
    setTranslationSnap(value) { this.translationSnap = value; }
    setRotationSnap(value) { this.rotationSnap = value; }
    setScaleSnap(value) { this.scaleSnap = value; }
    setSpace(value) { this.space = value; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLTextAreaElement = class {};
  globalThis.document = { body: element(), addEventListener() {}, querySelector: find, getElementById: id => find(`#${id}`), createElement: element };
  globalThis.window = { listeners: {}, addEventListener(name, fn) { const previous = this.listeners[name]; this.listeners[name] = event => { previous?.(event); fn(event); }; } };
  const app = new EditorApp({ createViewport: editor => {
    const camera = new THREE.PerspectiveCamera(), canvas = element();
    return {
      scene: new THREE.Scene(), camera,
      renderer: { domElement: canvas }, transformControls: options.createTransformControls?.(camera) ?? new Transform(), controls: {},
      setup() {
        editor.ui.viewport = find('#viewport');
        editor.ui.outliner = find('#outliner');
        editor.ui.properties = find('#properties');
      }, start() {}
    };
  }, ...options }).start();
  return {
    app, executeCommand: app.commands.executeCommand, takeSnapshot: app.history.takeSnapshot,
    objects: app.state.objects, transformControls: app.viewport.transformControls,
    click: id => find(`#${id}`).listeners.click(), find
  };
}

function selectMeshComponents(e, mode) {
  const mesh = e.app.mesh;
  e.app.selection.selectObject(e.objects[0]);
  if (!mesh.editMode) e.click('edit-mode');
  mesh.setMeshSelectionMode(mode);
  if (mode === 'vertex') {
    mesh.selectVertexMarker(mesh.vertexMarkers[0]);
    mesh.selectVertexMarker(mesh.vertexMarkers[2], true);
  } else if (mode === 'edge') {
    mesh.selectEdgeMarker(mesh.edgeMarkers[0]);
    mesh.selectEdgeMarker(mesh.edgeMarkers[1], true);
  } else {
    mesh.selectFaceByTriangle(0);
    mesh.selectFaceByTriangle(4, true);
  }
}

test('UI mode guides follow actual editor modes without changing scene/history or restarting for new objects', () => {
  const e = editor(), app = e.app, guide = app.ui.guide;
  assert.equal(guide.current.key, 'object');
  const before = e.takeSnapshot();
  guide.next(); guide.closeButton.listeners.click();
  app.ui.updateButtons();
  assert.equal(guide.current, null);
  assert.deepEqual(e.takeSnapshot(), before);
  e.click('add-sphere');
  assert.equal(guide.current, null);
  app.selection.selectObject(e.objects[0]);
  const geometry = e.takeSnapshot();
  e.click('edit-mode');
  assert.equal(guide.current.key, 'edit:vertex');
  guide.dismiss(); e.click('edge-mode');
  assert.equal(guide.current.key, 'edit:edge');
  guide.dismiss(); e.click('vertex-mode');
  assert.equal(guide.current, null);
  assert.deepEqual(e.takeSnapshot(), geometry);
  assert.equal(app.history.undoHistory.length, 1);
});

test('five actions synchronize scene, selection and history; all shapes survive restore', () => {
  const e = editor();
  for (const shape of ['cube', 'sphere', 'cylinder']) {
    const dimensions = shape === 'cube' ? { width: 4, height: 2, depth: 3 } : shape === 'sphere' ? { radius: 2 } : { radius: 2, height: 4 };
    e.executeCommand({ action: 'create', shape, dimensions });
    const created = JSON.stringify(e.takeSnapshot());
    e.click('undo'); e.click('redo');
    assert.equal(JSON.stringify(e.takeSnapshot()), created);
    assert.equal(e.transformControls.object, e.objects.at(-1));
  }
  for (const [action, field, value] of [['move', 'position', 3], ['rotate', 'rotation', 90], ['scale', 'scale', 3]]) {
    const before = JSON.stringify(e.takeSnapshot());
    e.executeCommand({ action, target: 'selected', [field]: { x: value, y: value, z: value } });
    assert.ok(Math.abs(e.objects.at(-1)[field].x - (action === 'rotate' ? Math.PI / 2 : value)) < 1e-9);
    e.click('undo'); assert.equal(JSON.stringify(e.takeSnapshot()), before);
    e.click('redo');
  }
  const beforeDelete = JSON.stringify(e.takeSnapshot());
  e.executeCommand({ action: 'delete', target: 'selected' });
  assert.equal(e.transformControls.object, null);
  e.click('undo'); assert.equal(JSON.stringify(e.takeSnapshot()), beforeDelete);
  e.click('redo');
  const unchanged = JSON.stringify(e.takeSnapshot());
  assert.throws(() => e.executeCommand({ action: 'delete', target: 'selected' }));
  assert.throws(() => e.executeCommand({ action: 'delete', target: 999 }));
  e.transformControls.dragging = true;
  assert.throws(() => e.executeCommand({ action: 'create', shape: 'cube' }));
  assert.equal(JSON.stringify(e.takeSnapshot()), unchanged);
});


test('vertex, edge and face edits preserve geometry through undo, redo and duplicate', () => {
  for (const mode of ['vertex', 'edge', 'face']) {
    const e = editor();
    e.click('add-cube');
    const mesh = e.app.mesh;
    const before = e.takeSnapshot();
    e.click('edit-mode');
    assert.equal(mesh.vertexMarkers.length, 8);
    mesh.setMeshSelectionMode(mode);
    if (mode === 'vertex') mesh.selectVertexMarker(mesh.vertexMarkers[0]);
    if (mode === 'edge') {
      assert.equal(mesh.edgeMarkers.length, 12);
      mesh.selectEdgeMarker(mesh.edgeMarkers[0]);
    }
    if (mode === 'face') mesh.selectFaceByTriangle(0);
    assert.equal(mesh.selectedVertexMarkers.size, { vertex: 1, edge: 2, face: 4 }[mode]);
    const groups = [...mesh.selectedVertexMarkers].map(marker => ({
      indices: [...marker.userData.vertexIndices], x: marker.position.x
    }));
    const events = e.transformControls.listeners;
    events.mouseDown();
    mesh.vertexPivot.position.x += 0.5;
    events.objectChange();
    events.mouseUp();
    for (const group of groups) for (const i of group.indices) {
      assert.equal(e.app.state.selectedObject.geometry.attributes.position.getX(i), group.x + 0.5);
    }
    const deformed = e.takeSnapshot();
    assert.notDeepEqual(deformed.objects, before.objects);
    assert.throws(() => e.executeCommand({ action: 'move', target: 'selected', position: { x: 1, y: 1, z: 1 } }));
    e.click('undo');
    assert.equal(mesh.editMode, false);
    assert.equal(mesh.vertexMarkers.length, 0);
    assert.equal(mesh.edgeMarkers.length, 0);
    assert.equal(mesh.faceHighlight.parent, null);
    assert.deepEqual(e.takeSnapshot(), before);
    e.click('redo');
    assert.deepEqual(e.takeSnapshot(), deformed);
    e.click('duplicate');
    const original = e.objects.at(-2), copy = e.objects.at(-1);
    assert.notEqual(copy.geometry, original.geometry);
    assert.notEqual(copy.material, original.material);
    assert.deepEqual([...copy.geometry.attributes.position.array], [...original.geometry.attributes.position.array]);
    assert.equal(copy.children.length, 0);
    assert.equal(copy.position.x, original.position.x + 1);
    const duplicated = e.takeSnapshot();
    e.click('undo'); e.click('redo');
    assert.deepEqual(e.takeSnapshot(), duplicated);
  }
});

test('selection exits edit mode cleanly and supports vertex multiselect', () => {
  const e = editor();
  e.click('add-cube'); e.click('edit-mode');
  const mesh = e.app.mesh;
  mesh.selectVertexMarker(mesh.vertexMarkers[0]);
  mesh.selectVertexMarker(mesh.vertexMarkers[1], true);
  assert.equal(mesh.selectedVertexMarkers.size, 2);
  mesh.selectVertexMarker(mesh.vertexMarkers[0], true);
  assert.equal(mesh.selectedVertexMarkers.size, 1);
  e.app.selection.selectObject(e.objects[0]);
  assert.equal(mesh.editMode, false);
  assert.equal(mesh.vertexPivot.parent, null);
  assert.equal(e.transformControls.object, e.objects[0]);
  e.click('add-sphere'); e.click('edit-mode');
  assert.equal(mesh.editMode, false);
});

for (const mode of ['vertex', 'edge', 'face']) {
  test(`Edit Mode ${mode} clicks replace or toggle selection with Ctrl, Shift and Meta`, () => {
    for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey']) {
      const e = editor(), mesh = e.app.mesh;
      e.app.selection.selectObject(e.objects[0]);
      e.click('edit-mode');
      mesh.setMeshSelectionMode(mode);
      const before = e.takeSnapshot();
      const targets = mode === 'vertex' ? mesh.vertexMarkers : mesh.edgeMarkers;
      const click = (target, modified = false) => {
        e.app.input.raycaster.intersectObjects = () => target === null ? [] : [{object: targets[target]}];
        e.app.input.raycaster.intersectObject = () => target === null ? [] : [{faceIndex: target}];
        const event = {button: 0, pointerId: 1, clientX: 400, clientY: 300, [modifier]: modified};
        const canvas = e.app.viewport.renderer.domElement;
        canvas.listeners.pointerdown(event);
        canvas.listeners.pointerup(event);
      };
      // Faces 0 and 2, and edges 0 and 1, share physical vertices.
      const second = mode === 'face' ? 4 : 1;
      const selectedCount = () => mode === 'vertex' ? mesh.selectedVertexMarkers.size
        : mode === 'edge' ? mesh.selectedEdgeMarkers.size : mesh.selectedFaceIndices.size;
      click(0);
      click(second, true);
      assert.equal(selectedCount(), 2);
      assert.equal(mesh.selectedVertexMarkers.size, {vertex: 2, edge: 3, face: 6}[mode]);
      assert.equal(e.transformControls.object, mesh.vertexPivot);
      if (mode === 'edge') {
        assert.equal(mesh.selectedEdgeMarker, null);
        for (const edge of mesh.edgeMarkers) {
          assert.equal(edge.material, [targets[0], targets[1]].includes(edge)
            ? mesh.selectedEdgeMaterial : mesh.edgeMarkerMaterial);
        }
      }
      if (mode === 'face') {
        assert.equal(mesh.selectedFaceIndex, null);
        assert.equal(mesh.faceHighlightGeometry.attributes.position.count, 12);
        assert.equal(mesh.faceHighlight.parent, e.objects[0]);
      }
      click(null, true);
      assert.equal(selectedCount(), 2);
      // Either triangle must toggle the same quad face.
      click(mode === 'face' ? 1 : 0, true);
      assert.equal(selectedCount(), 1);
      assert.equal(mesh.selectedVertexMarkers.size, {vertex: 1, edge: 2, face: 4}[mode]);
      if (mode === 'edge') assert.equal(mesh.selectedEdgeMarker, targets[1]);
      if (mode === 'face') {
        assert.equal(mesh.selectedFaceIndex, 2);
        assert.equal(mesh.faceHighlightGeometry.attributes.position.count, 6);
      }
      click(second, true);
      assert.equal(selectedCount(), 0);
      assert.equal(mesh.selectedVertexMarkers.size, 0);
      assert.equal(e.transformControls.object, null);
      assert.equal(mesh.vertexPivot.parent, null);
      assert.equal(mesh.faceHighlight.parent, null);
      click(0);
      click(second);
      assert.equal(selectedCount(), 1);
      click(null);
      assert.equal(selectedCount(), 0);
      assert.equal(e.transformControls.object, null);
      assert.equal(e.app.history.undoHistory.length, 0);
      assert.deepEqual(e.takeSnapshot(), before);
    }
  });

  test(`multiple ${mode} components move together once per shared vertex and survive Undo/Redo`, () => {
    const e = editor(), mesh = e.app.mesh, object = e.objects[0];
    object.position.set(3, -2, 4);
    object.rotation.set(0.2, 0.5, -0.3);
    object.scale.set(2, 1.5, 0.75);
    e.app.selection.selectObject(object);
    e.click('edit-mode');
    mesh.setMeshSelectionMode(mode);
    if (mode === 'vertex') {
      mesh.selectVertexMarker(mesh.vertexMarkers[0]);
      mesh.selectVertexMarker(mesh.vertexMarkers[1], true);
    } else if (mode === 'edge') {
      mesh.selectEdgeMarker(mesh.edgeMarkers[0]);
      mesh.selectEdgeMarker(mesh.edgeMarkers[1], true);
    } else {
      mesh.selectFaceByTriangle(0);
      mesh.selectFaceByTriangle(4, true);
    }
    const selected = [...mesh.selectedVertexMarkers];
    const center = new THREE.Vector3();
    selected.forEach(marker => center.add(marker.position));
    center.divideScalar(selected.length);
    object.localToWorld(center);
    assert.ok(mesh.vertexPivot.position.distanceTo(center) < 1e-12);
    const markers = mesh.vertexMarkers.map(marker => ({
      marker, world: object.localToWorld(marker.position.clone()), selected: selected.includes(marker)
    }));
    const before = e.takeSnapshot();
    const events = e.transformControls.listeners;
    events.mouseDown();
    const delta = new THREE.Vector3(0.5, -0.25, 0.75);
    // Multiple objectChange events in one drag must still make one history action.
    mesh.vertexPivot.position.addScaledVector(delta, 0.5);
    events.objectChange();
    mesh.vertexPivot.position.addScaledVector(delta, 0.5);
    events.objectChange();
    events.mouseUp();
    assert.equal(e.app.history.undoHistory.length, 1);
    const positions = object.geometry.attributes.position;
    for (const {marker, world, selected} of markers) {
      const expected = selected ? world.add(delta) : world;
      assert.ok(object.localToWorld(marker.position.clone()).distanceTo(expected) < 1e-12);
      for (const index of marker.userData.vertexIndices) {
        assert.ok(object.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index)).distanceTo(expected) < 1e-6);
      }
    }
    if (mode === 'edge') for (const edge of mesh.edgeMarkers) {
      const start = edge.userData.startMarker.position, end = edge.userData.endMarker.position;
      assert.ok(edge.position.distanceTo(start.clone().add(end).multiplyScalar(0.5)) < 1e-12);
      assert.ok(Math.abs(edge.scale.y - start.distanceTo(end)) < 1e-12);
    }
    if (mode === 'face') {
      const highlighted = Array.from(mesh.faceHighlightGeometry.attributes.position.array);
      const expected = [];
      for (const face of [0, 2]) for (let i = face * 6; i < face * 6 + 6; i++) {
        const index = object.geometry.index.getX(i);
        expected.push(positions.getX(index), positions.getY(index), positions.getZ(index));
      }
      assert.deepEqual(highlighted, expected);
    }
    const after = e.takeSnapshot();
    // A click or a drag without movement must leave history untouched.
    events.mouseDown(); events.objectChange(); events.mouseUp();
    assert.equal(e.app.history.undoHistory.length, 1);
    e.click('undo');
    assert.deepEqual(e.takeSnapshot(), before);
    assert.equal(mesh.selectedEdgeMarkers.size, 0);
    assert.equal(mesh.selectedFaceIndices.size, 0);
    assert.equal(mesh.selectedVertexMarkers.size, 0);
    assert.equal(mesh.faceHighlight.parent, null);
    e.click('redo');
    assert.deepEqual(e.takeSnapshot(), after);
    e.click('edit-mode');
    assert.equal(mesh.selectedVertexMarkers.size, 0);
  });
}

for (const mode of ['vertex', 'edge', 'face']) for (const operation of ['rotate', 'scale']) {
  test(`${operation} multiple ${mode} components in World/Local space under transformed parents`, () => {
    for (const space of ['world', 'local']) {
      const e = editor(), app = e.app, mesh = app.mesh, object = e.objects[0];
      const group = new THREE.Group();
      app.objects.giveObjectName(group, 'Group');
      group.position.set(1, 2, -1);
      group.rotation.set(0.3, -0.4, 0.2);
      group.scale.set(1.5, 0.75, 2);
      object.position.set(2, -1, 3);
      object.rotation.set(-0.2, 0.6, 0.1);
      object.scale.set(2, 1.25, 0.8);
      app.viewport.scene.add(group);
      group.add(object);
      app.state.objects.push(group);
      selectMeshComponents(e, mode);
      e.find('#transform-space').listeners.change({target: {value: space}});
      e.click(operation === 'rotate' ? 'rotate-mode' : 'scale-mode');
      const frame = space === 'local' ? object.getWorldQuaternion(new THREE.Quaternion()).normalize()
        : new THREE.Quaternion();
      assert.ok(mesh.vertexPivot.quaternion.angleTo(frame) < 1e-7);
      const center = mesh.vertexPivot.position.clone();
      const markers = mesh.vertexMarkers.map(marker => ({
        marker, world: object.localToWorld(marker.position.clone()), selected: mesh.selectedVertexMarkers.has(marker)
      }));
      const before = e.takeSnapshot(), events = e.transformControls.listeners;
      const angle = Math.PI / 3, factors = new THREE.Vector3(1.5, 0.75, 1.25);
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(frame);
      const turn = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      events.mouseDown();
      if (operation === 'rotate') mesh.vertexPivot.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, angle / 2)).multiply(frame);
      else mesh.vertexPivot.scale.set(1.25, 0.875, 1.125);
      events.objectChange();
      if (operation === 'rotate') mesh.vertexPivot.quaternion.copy(turn).multiply(frame);
      else mesh.vertexPivot.scale.copy(factors);
      events.objectChange(); events.objectChange();
      events.mouseUp();
      assert.equal(app.history.undoHistory.length, 1);
      assert.equal(mesh.vertexTransform, null);
      assert.deepEqual(mesh.vertexPivot.scale.toArray(), [1, 1, 1]);
      assert.ok(mesh.vertexPivot.quaternion.angleTo(frame) < 1e-7);
      const positions = object.geometry.attributes.position;
      for (const {marker, world, selected} of markers) {
        const expected = world.clone();
        if (selected) {
          expected.sub(center);
          if (operation === 'rotate') expected.applyQuaternion(turn);
          else expected.applyQuaternion(frame.clone().invert()).multiply(factors).applyQuaternion(frame);
          expected.add(center);
        }
        assert.ok(object.localToWorld(marker.position.clone()).distanceTo(expected) < 1e-10);
        for (const index of marker.userData.vertexIndices) {
          assert.ok(object.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index)).distanceTo(expected) < 2e-6);
        }
      }
      assert.ok(object.geometry.attributes.normal.array.every(Number.isFinite));
      const after = e.takeSnapshot();
      for (let i = 0; i < before.objects.length; i++) {
        for (const field of ['position', 'rotation', 'scale', 'topology']) {
          assert.deepEqual(after.objects[i][field], before.objects[i][field]);
        }
      }
      // The next drag starts with a clean pivot, and returning to its start is a no-op.
      const originalQuaternion = mesh.vertexPivot.quaternion.clone();
      events.mouseDown();
      if (operation === 'rotate') mesh.vertexPivot.rotateZ(0.2);
      else mesh.vertexPivot.scale.setScalar(1.2);
      events.objectChange();
      mesh.vertexPivot.quaternion.copy(originalQuaternion);
      mesh.vertexPivot.scale.setScalar(1);
      events.objectChange(); events.mouseUp();
      assert.equal(app.history.undoHistory.length, 1);
      assert.deepEqual(e.takeSnapshot(), after);
      e.click('undo'); assert.deepEqual(e.takeSnapshot(), before);
      assert.equal(mesh.vertexPivot.parent, null);
      e.click('redo'); assert.deepEqual(e.takeSnapshot(), after);
    }
  });
}

test('Edit Mode transform shortcuts persist across selection, respect drag/typing locks, and restore Object Mode', () => {
  const e = editor(), app = e.app, mesh = app.mesh, canvas = app.viewport.renderer.domElement;
  const key = (code, target = canvas) => window.listeners.keydown({code, target, preventDefault() {}});
  app.selection.selectObject(e.objects[0]);
  e.click('scale-mode');
  e.click('edit-mode');
  key('KeyR');
  assert.equal(e.transformControls.getMode(), 'rotate');
  assert.equal(e.transformControls.object, null);
  mesh.selectVertexMarker(mesh.vertexMarkers[0]);
  mesh.selectVertexMarker(mesh.vertexMarkers[2], true);
  assert.equal(e.transformControls.getMode(), 'rotate');
  assert.equal(e.transformControls.object, mesh.vertexPivot);
  key('KeyS', new HTMLInputElement());
  assert.equal(e.transformControls.getMode(), 'rotate');
  key('KeyS');
  assert.equal(e.transformControls.getMode(), 'scale');
  key('Digit2');
  mesh.selectEdgeMarker(mesh.edgeMarkers[0]);
  assert.equal(e.transformControls.getMode(), 'scale');
  e.transformControls.dragging = true;
  key('KeyM'); e.click('rotate-mode');
  e.find('#transform-space').listeners.change({target: {value: 'local'}});
  assert.equal(e.transformControls.getMode(), 'scale');
  assert.equal(e.transformControls.space, 'world');
  e.transformControls.dragging = false;
  key('KeyM');
  assert.equal(e.transformControls.getMode(), 'translate');
  e.click('rotate-mode');
  e.click('edit-mode');
  assert.equal(e.transformControls.getMode(), 'scale');
  assert.equal(e.transformControls.object, app.state.selectedObject);
  assert.equal(mesh.vertexPivot.parent, null);
});

test('switching to a component transform leaves Extrude/Inset and preserves one-face tools afterward', () => {
  for (const name of ['extrude', 'inset']) {
    const e = editor(), mesh = e.app.mesh, tool = e.app[`${name}Tool`];
    e.app.selection.selectObject(e.objects[0]);
    e.click('edit-mode'); e.click('face-mode');
    mesh.selectFaceByTriangle(0);
    tool.setActive(true);
    e.find('#transform-space').listeners.change({target: {value: 'local'}});
    assert.equal(e.transformControls.object, null);
    assert.equal(tool.active, true);
    e.click('rotate-mode');
    assert.equal(tool.active, false);
    assert.equal(e.transformControls.getMode(), 'rotate');
    assert.equal(e.transformControls.object, mesh.vertexPivot);
    tool.setActive(true);
    const pointer = x => ({button: 0, pointerId: 6, clientX: x, preventDefault() {}, stopPropagation() {}});
    tool.begin(pointer(0));
    e.click('scale-mode');
    assert.equal(e.transformControls.getMode(), 'rotate');
    tool.end(pointer(60));
    assert.equal(e.objects[0].geometry.index.count, 60);
    assert.equal(mesh.selectedFaceIndex, 0);
    e.click('scale-mode');
    assert.equal(tool.active, false);
    assert.equal(e.transformControls.getMode(), 'scale');
    assert.equal(e.transformControls.object, mesh.vertexPivot);
  }
});

for (const operation of ['rotate', 'scale']) {
  test(`native TransformControls ${operation} raycasts, snapping and history work on component geometry`, () => {
    const e = editor({createTransformControls: camera => new TransformControls(camera)});
    const app = e.app, mesh = app.mesh, controls = e.transformControls;
    app.selection.selectObject(e.objects[0]);
    e.click('edit-mode'); e.click('face-mode');
    mesh.selectFaceByTriangle(0);
    e.click(operation === 'rotate' ? 'rotate-mode' : 'scale-mode');
    e.find(operation === 'rotate' ? '#rotation-snap' : '#scale-snap').listeners.change({
      target: {value: operation === 'rotate' ? '45' : '0.25'}
    });
    const center = mesh.vertexPivot.position.clone();
    const camera = app.viewport.camera;
    camera.position.copy(center).add(new THREE.Vector3(0, 0, 8));
    camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    app.viewport.scene.add(controls.getHelper());
    controls.axis = operation === 'rotate' ? 'Z' : 'Y';
    app.viewport.scene.updateMatrixWorld(true);
    const pointer = (offset, button) => {
      const ndc = offset.clone().add(center).project(camera);
      return {x: ndc.x, y: ndc.y, button};
    };
    const markers = [...mesh.selectedVertexMarkers].map(marker => ({marker, start: marker.position.clone()}));
    const before = e.takeSnapshot();
    const start = operation === 'rotate' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0.4, 1, 0);
    const end = operation === 'rotate' ? new THREE.Vector3(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0)
      : new THREE.Vector3(0.4, 1.3, 0);
    controls.pointerDown(pointer(start, 0));
    assert.equal(controls.dragging, true);
    assert.ok(mesh.vertexTransform);
    assert.equal(app.viewport.controls.enabled, false);
    controls.pointerMove(pointer(end, -1));
    const field = app.ui.propertyInputs.find(item => item.property === (operation === 'rotate' ? 'rotation' : 'scale') &&
      item.axis === (operation === 'rotate' ? 'z' : 'y')).input;
    const expectedValue = operation === 'rotate' ? '45' : '1.25';
    assert.equal(field.value, expectedValue);
    assert.equal(field.disabled, true);
    controls.pointerUp({button: 0});
    assert.equal(field.value, expectedValue);
    assert.equal(field.disabled, false);
    assert.equal(controls.dragging, false);
    assert.equal(app.viewport.controls.enabled, true);
    assert.equal(app.history.undoHistory.length, 1);
    for (const {marker, start} of markers) {
      const expected = start.clone().sub(center);
      if (operation === 'rotate') expected.applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
      else expected.y *= 1.25;
      assert.ok(marker.position.distanceTo(expected.add(center)) < 1e-10);
    }
    const after = e.takeSnapshot();
    // Adjust the actual gizmo operation numerically without adding its angle/factor twice.
    const numeric = operation === 'rotate' ? 60 : 1.6;
    field.value = String(numeric); field.valueAsNumber = numeric;
    field.listeners.change();
    assert.equal(field.value, String(numeric));
    assert.equal(app.history.undoHistory.length, 2);
    for (const {marker, start} of markers) {
      const expected = start.clone().sub(center);
      if (operation === 'rotate') expected.applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 3);
      else expected.y *= numeric;
      assert.ok(marker.position.distanceTo(expected.add(center)) < 1e-10);
    }
    const adjusted = e.takeSnapshot();
    e.click('undo'); assert.deepEqual(e.takeSnapshot(), after);
    e.click('undo'); assert.deepEqual(e.takeSnapshot(), before);
    e.click('redo'); e.click('redo'); assert.deepEqual(e.takeSnapshot(), adjusted);
  });
}

for (const mode of ['vertex', 'edge', 'face']) {
  test(`selection inspector numerically adjusts the last ${mode} edit in World and Local space`, () => {
    for (const space of ['world', 'local']) for (const property of ['position', 'rotation', 'scale']) {
      const e = editor(), app = e.app, mesh = app.mesh, object = e.objects[0];
      object.position.set(2, -1, 3);
      object.rotation.set(0.2, 0.4, -0.3);
      object.scale.set(2, 0.75, 1.5);
      selectMeshComponents(e, mode);
      e.find('#transform-space').listeners.change({target: {value: space}});
      const input = (property, axis) => app.ui.propertyInputs.find(item => item.property === property && item.axis === axis).input;
      assert.equal(e.find('#transform-title').textContent, 'Selection transform');
      assert.equal(e.find('#transform-context').textContent, 'Last edit');
      assert.equal(input('rotation', 'x').value, '0');
      assert.equal(input('scale', 'x').value, '1');
      const center = mesh.vertexPivot.position.clone();
      const frame = mesh.vertexPivot.quaternion.clone();
      const markers = mesh.vertexMarkers.map(marker => ({
        marker, start: object.localToWorld(marker.position.clone()), selected: mesh.selectedVertexMarkers.has(marker)
      }));
      const before = e.takeSnapshot();
      const axis = property === 'rotation' ? 'z' : property === 'scale' ? 'y' : 'x';
      const values = property === 'rotation' ? [45, 60] : property === 'scale' ? [1.25, 2] : [1.5, 2.5];
      const field = input(property, axis);
      for (const value of values) {
        field.value = String(value); field.valueAsNumber = value;
        field.listeners.input(); // Typing alone does not make intermediate undo steps.
        field.listeners.change();
        assert.equal(field.value, String(value));
      }
      assert.equal(app.history.undoHistory.length, 2);
      field.listeners.change();
      assert.equal(app.history.undoHistory.length, 2);
      const amount = values[1];
      for (const {marker, start, selected} of markers) {
        const expected = start.clone();
        if (selected) {
          expected.sub(center).applyQuaternion(frame.clone().invert());
          if (property === 'rotation') expected.applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(amount));
          else if (property === 'scale') expected.y *= amount;
          else expected.x += amount;
          expected.applyQuaternion(frame).add(center);
        }
        assert.ok(object.localToWorld(marker.position.clone()).distanceTo(expected) < 1e-10);
      }
      const after = e.takeSnapshot();
      for (const property of ['position', 'rotation', 'scale', 'topology']) {
        assert.deepEqual(after.objects[0][property], before.objects[0][property]);
      }
      e.click('undo'); e.click('undo'); assert.deepEqual(e.takeSnapshot(), before);
      assert.equal(e.find('#transform-title').textContent, 'Object transform');
      e.click('redo'); e.click('redo'); assert.deepEqual(e.takeSnapshot(), after);
    }
  });
}

test('selection inspector commits Enter once, starts fresh after selection/space changes, and restores object values', () => {
  const e = editor(), app = e.app, mesh = app.mesh, object = e.objects[0];
  object.rotation.y = 0.3;
  selectMeshComponents(e, 'face');
  const rotation = app.ui.propertyInputs.find(item => item.property === 'rotation' && item.axis === 'z').input;
  rotation.blur = () => { rotation.listeners.change(); rotation.listeners.blur(); };
  rotation.value = '45'; rotation.valueAsNumber = 45;
  rotation.listeners.input();
  assert.equal(app.history.undoHistory.length, 0);
  rotation.listeners.keydown({key: 'Enter', preventDefault() {}});
  assert.equal(app.history.undoHistory.length, 1);
  assert.equal(rotation.value, '45');
  e.click('scale-mode');
  assert.equal(rotation.value, '45');
  const geometry = object.geometry.attributes.position.array.slice();
  mesh.selectFaceByTriangle(8, true);
  assert.equal(rotation.value, '0');
  assert.equal(mesh.componentTransformBase, null);
  assert.deepEqual(object.geometry.attributes.position.array, geometry);
  assert.equal(e.find('#selection-name').textContent, `${object.name} · 3 faces selected`);
  assert.equal(mesh.setComponentTransformValue('position', 'x', 0.5), true);
  e.find('#transform-space').listeners.change({target: {value: 'local'}});
  assert.equal(rotation.value, '0');
  assert.equal(mesh.componentTransformValues.position.x, 0);
  mesh.selectFaceByTriangle(null);
  assert.equal(rotation.value, '');
  assert.equal(rotation.disabled, true);
  assert.match(e.find('#property-hint').textContent, /Select vertices/);
  e.click('edit-mode');
  assert.equal(e.find('#transform-title').textContent, 'Object transform');
  const objectRotation = app.ui.propertyInputs.find(item => item.property === 'rotation' && item.axis === 'y').input;
  assert.equal(Number(objectRotation.value), Number(THREE.MathUtils.radToDeg(0.3).toFixed(4)));
  assert.equal(objectRotation.disabled, false);
});

test('selection numeric edits reject invalid values and stay disabled during gizmo/face tool operations', () => {
  for (const name of ['extrude', 'inset']) {
    const e = editor(), app = e.app, mesh = app.mesh, tool = app[`${name}Tool`];
    app.selection.selectObject(e.objects[0]); e.click('edit-mode'); e.click('face-mode');
    mesh.selectFaceByTriangle(0);
    const field = app.ui.propertyInputs.find(item => item.property === 'position' && item.axis === 'x').input;
    const before = e.takeSnapshot();
    for (const value of [NaN, Infinity, 1e300]) {
      field.value = String(value); field.valueAsNumber = value;
      field.listeners.change();
      assert.deepEqual(e.takeSnapshot(), before);
      assert.equal(app.history.undoHistory.length, 0);
      assert.equal(field.value, '0');
    }
    e.transformControls.dragging = true;
    assert.equal(mesh.setComponentTransformValue('position', 'x', 2), false);
    e.transformControls.dragging = false;
    tool.setActive(true);
    assert.equal(field.disabled, true);
    assert.equal(mesh.setComponentTransformValue('position', 'x', 2), false);
    assert.deepEqual(e.takeSnapshot(), before);
    const pointer = x => ({button: 0, pointerId: 7, clientX: x, preventDefault() {}, stopPropagation() {}});
    tool.begin(pointer(0)); tool.end(pointer(60));
    tool.setActive(false);
    assert.equal(field.disabled, false);
    assert.equal(field.value, '0');
    assert.equal(mesh.componentTransformBase, null);
    assert.equal(e.objects[0].geometry.index.count, 60);
    assert.equal(mesh.setComponentTransformValue('position', 'x', 0.5), true);
    assert.equal(field.value, '0.5');
  }
});

test('switching component modes and exiting Edit Mode clear all multi-selection state', () => {
  const e = editor(), mesh = e.app.mesh;
  e.app.selection.selectObject(e.objects[0]);
  e.click('edit-mode'); e.click('edge-mode');
  mesh.selectEdgeMarker(mesh.edgeMarkers[0]);
  mesh.selectEdgeMarker(mesh.edgeMarkers[1], true);
  e.click('face-mode');
  assert.equal(mesh.selectedEdgeMarkers.size, 0);
  assert.equal(mesh.selectedVertexMarkers.size, 0);
  assert.equal(e.transformControls.object, null);
  mesh.selectFaceByTriangle(0);
  mesh.selectFaceByTriangle(4, true);
  e.click('vertex-mode');
  assert.equal(mesh.selectedFaceIndices.size, 0);
  assert.equal(mesh.faceHighlight.parent, null);
  assert.equal(mesh.selectedVertexMarkers.size, 0);
  e.click('face-mode');
  mesh.selectFaceByTriangle(0);
  mesh.selectFaceByTriangle(4, true);
  e.click('edit-mode');
  assert.equal(mesh.selectedFaceIndices.size, 0);
  assert.equal(mesh.faceHighlight.parent, null);
  assert.equal(mesh.vertexPivot.parent, null);
  assert.equal(e.transformControls.object, e.objects[0]);
});

test('Extrude and Inset return to the shared gizmo for multiple faces and still edit a single face', () => {
  for (const name of ['extrude', 'inset']) {
    const e = editor(), mesh = e.app.mesh;
    e.app.selection.selectObject(e.objects[0]);
    e.click('edit-mode'); e.click('face-mode');
    const tool = e.app[`${name}Tool`];
    mesh.selectFaceByTriangle(0);
    tool.setActive(true);
    assert.equal(tool.active, true);
    assert.equal(e.transformControls.object, null);
    mesh.selectFaceByTriangle(4, true);
    assert.equal(tool.active, false);
    assert.equal(tool.canActivate(), false);
    assert.equal(e.find('#extrude-tool').disabled, true);
    assert.equal(e.find('#inset-tool').disabled, true);
    assert.equal(e.transformControls.object, mesh.vertexPivot);
    tool.setActive(true);
    assert.equal(tool.active, false);
    mesh.selectFaceByTriangle(5, true);
    assert.equal(mesh.selectedFaceIndex, 0);
    assert.equal(e.find('#extrude-tool').disabled, false);
    assert.equal(e.find('#inset-tool').disabled, false);
    tool.setActive(true);
    // Replacing the single face keeps the face tool active on the new face.
    mesh.selectFaceByTriangle(4);
    assert.equal(tool.active, true);
    assert.equal(mesh.selectedFaceIndex, 2);
    assert.equal(e.transformControls.object, null);
    const before = e.takeSnapshot();
    const event = x => ({button: 0, pointerId: 7, clientX: x, preventDefault() {}, stopPropagation() {}});
    tool.begin(event(0)); tool.end(event(60));
    assert.equal(e.objects[0].geometry.index.count, 60);
    assert.deepEqual([...mesh.selectedFaceIndices], [2]);
    assert.equal(mesh.selectedVertexMarkers.size, 4);
    assert.equal(e.app.history.undoHistory.length, 1);
    const after = e.takeSnapshot();
    // Newly generated walls participate in the same multi-selection lifecycle.
    mesh.selectFaceByTriangle(12, true);
    assert.deepEqual([...mesh.selectedFaceIndices], [2, 6]);
    assert.equal(mesh.faceHighlightGeometry.attributes.position.count, 12);
    assert.equal(e.transformControls.object, mesh.vertexPivot);
    mesh.selectFaceByTriangle(13, true);
    tool.setActive(true);
    // Toggling the last face off must also turn off the active tool.
    mesh.selectFaceByTriangle(5, true);
    assert.equal(tool.active, false);
    assert.equal(e.transformControls.object, null);
    assert.equal(mesh.faceHighlight.parent, null);
    e.click('undo'); assert.deepEqual(e.takeSnapshot(), before);
    e.click('redo'); assert.deepEqual(e.takeSnapshot(), after);
  }
});

test('no-op edits preserve redo; a new action clears redo and restores object IDs', () => {
  const e = editor();
  e.click('add-sphere');
  const created = e.takeSnapshot();
  e.click('undo'); e.click('redo');
  assert.deepEqual(e.takeSnapshot(), created);
  e.executeCommand({ action: 'move', target: 'selected', position: { x: 2, y: 0, z: 0 } });
  e.click('undo');
  e.executeCommand({ action: 'move', target: 'selected', position: { x: 0, y: 0, z: 0 } });
  assert.equal(e.app.history.redoHistory.length, 1);
  e.click('add-cylinder');
  assert.equal(e.app.history.redoHistory.length, 0);
  const current = e.takeSnapshot();
  assert.throws(() => e.executeCommand({ action: 'delete', target: 1, unexpected: true }));
  assert.deepEqual(e.takeSnapshot(), current);
});

test('Properties, snap and drag events use the same services', () => {
  const e = editor();
  e.click('add-cube');
  const rotation = e.app.ui.propertyInputs.find(p => p.property === 'rotation' && p.axis === 'y').input;
  rotation.value = '90'; rotation.valueAsNumber = 90;
  rotation.listeners.input();
  assert.equal(e.app.state.selectedObject.rotation.y, Math.PI / 2);
  e.click('undo'); assert.equal(e.app.state.selectedObject.rotation.y, 0);
  e.find('#snap').listeners.change({ target: { checked: true } });
  assert.equal(e.transformControls.translationSnap, 1);
  e.find('#snap').listeners.change({ target: { checked: false } });
  assert.equal(e.transformControls.translationSnap, null);
  e.transformControls.dragging = true;
  e.transformControls.listeners['dragging-changed']({ value: true });
  assert.equal(e.app.viewport.controls.enabled, false);
  assert.equal(e.find('#undo').disabled, true);
  assert.equal(rotation.disabled, true);
  const before = e.takeSnapshot(); e.app.history.undo();
  assert.deepEqual(e.takeSnapshot(), before);
});

test('AI controller applies valid results and releases controls on failure', async () => {
  const e = editor({ requestAICommand: async () => ({ action: 'create', shape: 'sphere' }) });
  e.find('#ai-instruction').value = 'Create a sphere';
  await e.app.ai.sendAIInstruction();
  assert.equal(e.objects.at(-1).userData.type, 'Sphere');
  assert.equal(e.find('#ai-send').disabled, false);
  const before = e.takeSnapshot();
  e.app.ai.request = async () => ({ action: 'eval', code: 'no' });
  await e.app.ai.sendAIInstruction();
  assert.deepEqual(e.takeSnapshot(), before);
  assert.match(e.find('#ai-status').textContent, /Error/);
  assert.equal(e.find('#ai-send').disabled, false);
});

test('AI rejects stale replies after geometry or selection changes', async () => {
  for (const change of ['geometry', 'selection']) {
    let reply;
    const e = editor({ requestAICommand: () => new Promise(resolve => { reply = resolve; }) });
    e.click('add-cube');
    e.find('#ai-instruction').value = 'Create a sphere';
    const pending = e.app.ai.sendAIInstruction();
    if (change === 'geometry') e.objects.at(-1).geometry.attributes.position.setX(0, 8);
    else e.app.selection.selectObject(null);
    const changed = e.takeSnapshot();
    reply({ action: 'create', shape: 'sphere' });
    await pending;
    assert.deepEqual(e.takeSnapshot(), changed);
    assert.match(e.find('#ai-status').textContent, /Scene changed/);
    assert.equal(e.find('#ai-send').disabled, false);
  }
});

test('keyboard shortcuts respect typing and canvas focus; raycast separates click from orbit drag', () => {
  const e = editor();
  const canvas = e.app.viewport.renderer.domElement;
  const camera = e.app.viewport.camera;
  camera.position.set(5, 4, 5);
  camera.aspect = 800 / 600;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const pointer = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y });
  canvas.listeners.pointerdown(pointer(400, 300));
  canvas.listeners.pointerup(pointer(400, 300));
  assert.equal(e.app.state.selectedObject, e.objects[0]);
  canvas.listeners.pointerdown(pointer(400, 300));
  canvas.listeners.pointermove(pointer(790, 590));
  canvas.listeners.pointerup(pointer(790, 590));
  assert.equal(e.app.state.selectedObject, e.objects[0]);
  const key = (code, target = canvas) => window.listeners.keydown({ code, target, preventDefault() {} });
  key('KeyR'); assert.equal(e.transformControls.mode, 'rotate');
  key('KeyS', new HTMLInputElement()); assert.equal(e.transformControls.mode, 'rotate');
  key('KeyS'); assert.equal(e.transformControls.mode, 'scale');
  key('KeyM'); assert.equal(e.transformControls.mode, 'translate');
  document.activeElement = canvas;
  key('Tab'); assert.equal(e.app.mesh.editMode, true);
  key('Digit2'); assert.equal(e.app.mesh.meshSelectionMode, 'edge');
  key('Digit3'); assert.equal(e.app.mesh.meshSelectionMode, 'face');
  key('Digit1'); assert.equal(e.app.mesh.meshSelectionMode, 'vertex');
  key('Tab'); assert.equal(e.app.mesh.editMode, false);
  canvas.listeners.pointercancel();
  assert.equal(e.app.input.clickStart, null);
});


test('manual skew is non-cumulative, one undo action, cancel restores original and releases controls', () => {
  const e = editor();
  e.app.selection.selectObject(e.objects[0]);
  const tool = e.app.skewTool;
  const object = e.app.state.selectedObject;
  const original = object.geometry;
  const before = e.takeSnapshot();
  e.app.viewport.controls.enabled = true;
  tool.setActive(true);
  assert.equal(e.transformControls.object, null);
  const pointer = x => ({ button: 0, pointerId: 7, clientX: x, preventDefault() {}, stopPropagation() {} });
  tool.begin(pointer(100));
  assert.equal(e.app.viewport.controls.enabled, false);
  assert.throws(() => e.executeCommand({action: 'skew', target: 'selected', axis: 'x', relativeTo: 'y', amount: 1}));
  e.app.history.undo();
  tool.move(pointer(160));
  tool.move(pointer(220));
  const pos = object.geometry.attributes.position;
  const base = original.attributes.position;
  for (let i = 0; i < pos.count; i++) assert.equal(pos.getX(i), base.getX(i) + base.getY(i));
  assert.equal(e.app.history.undoHistory.length, 0);
  tool.end(pointer(220));
  assert.equal(e.app.history.undoHistory.length, 1);
  assert.equal(e.app.state.selectedObject, object);
  assert.equal(e.app.viewport.controls.enabled, true);
  const after = e.takeSnapshot();
  e.app.history.undo(); assert.deepEqual(e.takeSnapshot(), before);
  e.app.history.redo(); assert.deepEqual(e.takeSnapshot(), after);
  tool.setActive(true);
  const restored = e.app.state.selectedObject.geometry;
  tool.begin(pointer(0)); tool.move(pointer(-120));
  tool.keydown({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(e.app.state.selectedObject.geometry, restored);
  assert.deepEqual(e.takeSnapshot(), after);
  assert.equal(e.app.history.undoHistory.length, 1);
  tool.begin(pointer(0)); tool.end(pointer(0));
  assert.equal(e.app.history.undoHistory.length, 1);
  tool.setActive(false);
  e.executeCommand({action: 'skew', target: 'selected', axis: 'z', relativeTo: 'y', amount: 0.5});
  assert.equal(e.app.history.undoHistory.length, 2);
});


test('cancel, selection changes and disposal release preview geometry without history', () => {
  const e = editor();
  e.app.selection.selectObject(e.objects[0]);
  const tool = e.app.skewTool;
  const original = e.objects[0].geometry;
  e.app.viewport.controls.enabled = false;
  const event = {button: 0, pointerId: 4, clientX: 0, preventDefault() {}, stopPropagation() {}};
  tool.setActive(true); tool.begin(event);
  tool.move({...event, clientX: 60});
  let disposed = 0;
  e.objects[0].geometry.addEventListener('dispose', () => disposed++);
  tool.cancel();
  assert.equal(disposed, 1);
  assert.equal(e.objects[0].geometry, original);
  assert.equal(e.app.viewport.controls.enabled, false);
  assert.equal(e.app.history.undoHistory.length, 0);
  tool.begin(event); tool.move({...event, clientX: 30});
  e.app.selection.selectObject(null);
  assert.equal(tool.active, false);
  assert.equal(tool.dragging, false);
  assert.equal(e.objects[0].geometry, original);
  tool.dispose();
  assert.equal(tool.events.signal.aborted, true);
});


test('manual skew supports all six local axis pairs and toolbar swaps duplicate axes', () => {
  for (const axis of ['x', 'y', 'z']) for (const relativeTo of ['x', 'y', 'z']) {
    if (axis === relativeTo) continue;
    const e = editor();
    e.app.selection.selectObject(e.objects[0]);
    const tool = e.app.skewTool;
    tool.setAxes(axis, relativeTo); tool.setActive(true);
    const base = e.objects[0].geometry.attributes.position.array.slice();
    const event = {button: 0, pointerId: 2, clientX: 0, preventDefault() {}, stopPropagation() {}};
    tool.begin(event);
    tool.setAxes(relativeTo, axis); // Locked during drag.
    assert.equal(tool.axis, axis);
    tool.end({...event, clientX: 120});
    const result = e.objects[0].geometry.attributes.position.array;
    const a = ['x', 'y', 'z'].indexOf(axis), b = ['x', 'y', 'z'].indexOf(relativeTo);
    for (let i = 0; i < result.length; i++) assert.equal(result[i], base[i] + (i % 3 === a ? base[i - a + b] : 0));
    assert.equal(e.app.history.undoHistory.length, 1);
  }
  const e = editor();
  e.find('#skew-axis').listeners.change({target: {value: 'y'}});
  assert.equal(e.app.skewTool.axis, 'y');
  assert.equal(e.app.skewTool.relativeTo, 'x');
  assert.throws(() => e.app.skewTool.setAxes('z', 'z'));
});


test('taper math preserves opposite end and length on every axis/end; validates options', () => {
  const modifier = new TaperModifier();
  for (const axis of ['x', 'y', 'z']) for (const end of ['positive', 'negative']) {
    const geometry = new THREE.BoxGeometry(2, 4, 6);
    geometry.translate(3, 5, -2);
    const source = geometry.attributes.position.array.slice();
    const a = ['x','y','z'].indexOf(axis), center = [3,5,-2];
    const result = modifier.apply(geometry, {axis, end, amount: -0.5});
    const before = geometry.attributes.position, after = result.attributes.position;
    for (let i = 0; i < before.count; i++) {
      const original = [before.getX(i), before.getY(i), before.getZ(i)];
      const next = [after.getX(i), after.getY(i), after.getZ(i)];
      const target = end === 'positive' ? original[a] > center[a] : original[a] < center[a];
      assert.equal(next[a], original[a]);
      for (let c = 0; c < 3; c++) if (c !== a) assert.equal(next[c], center[c] + (original[c] - center[c]) * (target ? 0.5 : 1));
    }
    assert.deepEqual(geometry.attributes.position.array, source);
    assert.ok(result.boundingSphere.radius > 0);
    result.dispose(); geometry.dispose();
  }
  const geometry = new THREE.BoxGeometry();
  for (const options of [{axis:'q'}, {end:'top'}, {amount: -1}, {amount: Infinity}, {amount: 4}]) assert.throws(() => modifier.apply(geometry, options));
  const flat = new THREE.BoxGeometry(2, 0, 2);
  assert.throws(() => modifier.apply(flat));
});

test('manual taper shares drag lifecycle, one history action, axis lock, cancel and AI', () => {
  const e = editor();
  e.app.selection.selectObject(e.objects[0]);
  const tool = e.app.taperTool, skew = e.app.skewTool;
  skew.setActive(true); tool.setActive(true);
  assert.equal(skew.active, false);
  assert.equal(tool.active, true);
  const before = e.takeSnapshot(), object = e.objects[0], original = object.geometry;
  const event = x => ({button: 0, pointerId: 8, clientX: x, preventDefault() {}, stopPropagation() {}});
  tool.begin(event(0)); tool.move(event(-30)); tool.move(event(-60));
  tool.setOptions('z', 'negative'); assert.equal(tool.axis, 'y');
  assert.equal(e.find('#taper-axis').disabled, true);
  assert.throws(() => e.executeCommand({action:'create', shape:'cube'}));
  for (let i = 0; i < original.attributes.position.count; i++) {
    const source = original.attributes.position;
    assert.equal(object.geometry.attributes.position.getX(i), source.getX(i) * (source.getY(i) > 0 ? 0.5 : 1));
  }
  tool.end(event(-60));
  assert.equal(e.app.state.selectedObject, object);
  assert.equal(e.app.history.undoHistory.length, 1);
  const after = e.takeSnapshot();
  e.app.history.undo(); assert.deepEqual(e.takeSnapshot(), before);
  e.app.history.redo(); assert.deepEqual(e.takeSnapshot(), after);
  tool.setOptions('z', 'negative'); tool.setActive(true);
  const restored = e.app.state.selectedObject.geometry;
  tool.begin(event(0)); tool.move(event(120)); tool.cancel();
  assert.equal(e.app.state.selectedObject.geometry, restored);
  assert.deepEqual(e.takeSnapshot(), after);
  tool.begin(event(0)); tool.end(event(0));
  assert.equal(e.app.history.undoHistory.length, 1);
  skew.setActive(true); assert.equal(tool.active, false);
  e.executeCommand({action: 'taper', target: 'selected', axis: 'x', end: 'negative', amount: 1});
  assert.equal(e.app.history.undoHistory.length, 2);
  for (const command of [
    {action:'taper', target:'selected', axis:'y', end:'positive', amount:-1},
    {action:'taper', target:'selected', axis:'y', end:'bad', amount:0},
    {action:'taper', target:'selected', axis:'z', end:'positive', amount:1, code:'no'},
  ]) assert.throws(() => validateCommand(command));
  e.click('add-sphere'); assert.throws(() => e.executeCommand({action:'taper', target:'selected', axis:'y', end:'positive', amount:1}));
});


test('extrude adds four connected quad walls on all faces, preserves source and oriented boundary', () => {
  const modifier = new ExtrudeModifier();
  for (let face = 0; face < 6; face++) {
    const source = new THREE.BoxGeometry(2,2,2), saved = source.attributes.position.array.slice();
    const result = modifier.apply(source, {face, amount: 1});
    assert.equal(result.attributes.position.count, 40);
    assert.equal(result.index.count, 60);
    assert.deepEqual(source.attributes.position.array, saved);
    const edges = new Map();
    const key = p => p.toArray().join(',');
    for (let f = 0; f < 10; f++) {
      const points = facePoints(result, f);
      for (let i = 0; i < 4; i++) {
        const a = key(points[i]), b = key(points[(i+1)%4]);
        const id = [a,b].sort().join('|');
        const entry = edges.get(id) ?? [];
        entry.push([a,b]); edges.set(id, entry);
      }
    }
    for (const uses of edges.values()) {
      assert.equal(uses.length, 2);
      assert.equal(uses[0][0], uses[1][1]);
      assert.equal(uses[0][1], uses[1][0]);
    }
    source.dispose(); result.dispose();
  }
});

test('manual extrude repeats on new walls, cancels, preserves topology in history/duplicate and other modifiers', () => {
  const e = editor();
  e.app.selection.selectObject(e.objects[0]); e.click('edit-mode'); e.click('face-mode');
  e.app.mesh.selectFaceByTriangle(0);
  const tool = e.app.extrudeTool, mesh = e.app.mesh;
  const before = e.takeSnapshot(), object = e.objects[0];
  tool.setActive(true);
  assert.equal(e.transformControls.object, null);
  const event = x => ({button:0, pointerId:5, clientX:x, preventDefault(){}, stopPropagation(){}});
  tool.begin(event(0)); tool.move(event(60)); tool.end(event(120));
  assert.equal(e.app.state.selectedObject, object);
  assert.equal(object.geometry.index.count, 60);
  assert.equal(mesh.vertexMarkers.length, 12);
  assert.equal(mesh.selectedFaceIndex, 0);
  assert.equal(e.app.history.undoHistory.length, 1);
  const original = object.geometry;
  tool.begin(event(0)); tool.move(event(-30)); tool.cancel();
  assert.equal(object.geometry, original);
  assert.equal(e.app.history.undoHistory.length, 1);
  tool.begin(event(0)); tool.end(event(0));
  assert.equal(e.app.history.undoHistory.length, 1);
  mesh.selectFaceByTriangle(12); // New side wall.
  tool.begin(event(0)); tool.end(event(60));
  assert.equal(object.geometry.index.count, 84);
  assert.equal(e.app.history.undoHistory.length, 2);
  const after = e.takeSnapshot();
  e.app.history.undo(); e.app.history.undo(); assert.deepEqual(e.takeSnapshot(), before);
  e.app.history.redo(); e.app.history.redo(); assert.deepEqual(e.takeSnapshot(), after);
  const restored = e.app.state.selectedObject.geometry;
  assert.equal(restored.attributes.normal.count, restored.attributes.position.count);
  e.click('duplicate');
  assert.deepEqual(e.app.state.selectedObject.geometry.index.array, restored.index.array);
  e.click('edit-mode'); e.click('edge-mode');
  assert.ok(mesh.edgeMarkers.length > 12);
  e.click('face-mode'); mesh.selectFaceByTriangle(26);
  assert.equal(mesh.selectedVertexMarkers.size, 4);
  e.click('edit-mode');
  e.executeCommand({action:'skew',target:'selected',axis:'x',relativeTo:'y',amount:0.2});
  e.executeCommand({action:'taper',target:'selected',axis:'y',end:'positive',amount:-0.2});
  assert.equal(e.app.state.selectedObject.geometry.index.count, 84);
  const modified = e.takeSnapshot(); e.app.history.undo(); e.app.history.redo();
  assert.deepEqual(e.takeSnapshot(), modified);
});


test('Bend anchors minimum-axis end, refines quads and bends all six axis pairs', () => {
  const modifier = new BendModifier();
  for (const axis of ['x','y','z']) for (const direction of ['x','y','z']) {
    if (axis === direction) continue;
    const geometry = new THREE.BoxGeometry(2,2,2);
    const source = geometry.attributes.position.array.slice();
    const result = modifier.apply(geometry,{axis,direction,angle:90});
    assert.ok(result.attributes.position.count > 24);
    assert.deepEqual(geometry.attributes.position.array, source);
    assert.equal(result.index.count / 6, result.attributes.position.count / 4);
    const a = ['x','y','z'].indexOf(axis), d = ['x','y','z'].indexOf(direction);
    const expectedS = -1 + 4/Math.PI, expectedD = 4/Math.PI;
    const points = [];
    for(let i=0;i<result.attributes.position.count;i++) points.push(new THREE.Vector3().fromBufferAttribute(result.attributes.position,i));
    assert.ok(points.every(p => p.toArray().every(Number.isFinite)));
    assert.ok(points.some(p => Math.abs(p.getComponent(a)-(expectedS-1))<1e-5 && Math.abs(p.getComponent(d)-expectedD)<1e-5));
    for (let i=0; i<geometry.attributes.position.count; i++) {
      const anchor = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i);
      if (anchor[axis] === -1) assert.ok(points.some(p => p.distanceTo(anchor)<1e-6));
    }
    const zero = modifier.apply(geometry,{axis,direction,angle:0});
    assert.deepEqual(zero.attributes.position.array,source);
    geometry.dispose(); result.dispose(); zero.dispose();
  }
  for (const options of [{axis:'y',direction:'y'}, {angle:181}, {angle:NaN}, {axis:'q'}]) assert.throws(() => modifier.apply(new THREE.BoxGeometry(),options));
});

test('manual Bend has one undo, exact cancel/no-op, axis locking and interoperates with mesh editing and AI', () => {
  const e=editor(); e.app.selection.selectObject(e.objects[0]);
  const tool=e.app.bendTool, object=e.objects[0], before=e.takeSnapshot();
  e.app.skewTool.setActive(true); tool.setActive(true);
  assert.equal(e.app.skewTool.active,false);
  const event=x=>({button:0,pointerId:11,clientX:x,preventDefault(){},stopPropagation(){}});
  const original=object.geometry;
  tool.begin(event(0)); tool.move(event(60)); tool.cancel();
  assert.equal(object.geometry,original); assert.deepEqual(e.takeSnapshot(),before);
  tool.begin(event(0)); tool.end(event(0)); assert.equal(e.app.history.undoHistory.length,0);
  tool.begin(event(0)); tool.move(event(30)); tool.setOptions('z','x'); assert.equal(tool.axis,'y');
  tool.end(event(120)); assert.equal(e.app.history.undoHistory.length,1);
  assert.equal(e.app.state.selectedObject,object);
  const after=e.takeSnapshot();
  e.app.history.undo(); assert.deepEqual(e.takeSnapshot(),before);
  e.app.history.redo(); assert.deepEqual(e.takeSnapshot(),after);
  e.click('duplicate'); assert.deepEqual(e.app.state.selectedObject.geometry.index.array,e.objects[0].geometry.index.array);
  e.click('edit-mode'); e.click('face-mode'); e.app.mesh.selectFaceByTriangle(0);
  assert.equal(e.app.mesh.selectedVertexMarkers.size,4);
  e.click('extrude-tool'); const extrude=e.app.extrudeTool;
  extrude.begin(event(0)); extrude.end(event(20));
  e.click('edit-mode');
  e.executeCommand({action:'bend',target:'selected',axis:'z',direction:'x',angle:-20});
  const final=e.takeSnapshot(); e.app.history.undo(); e.app.history.redo(); assert.deepEqual(e.takeSnapshot(),final);
  e.find('#bend-axis').listeners.change({target:{value:'x'}});
  assert.equal(tool.axis,'x'); assert.equal(tool.direction,'y');
  assert.throws(()=>e.executeCommand({action:'bend',target:'selected',axis:'x',direction:'x',angle:90}));
});


test('Inset preserves closed oriented surface and shrinks cap on all six faces', () => {
  const modifier = new InsetModifier();
  for(let face=0; face<6; face++) {
    const source = new THREE.BoxGeometry(2,2,2), original = source.attributes.position.array.slice();
    const old = facePoints(source,face), center = new THREE.Vector3(); old.forEach(p=>center.add(p)); center.multiplyScalar(0.25);
    const result = modifier.apply(source,{face,amount:0.5});
    assert.deepEqual(source.attributes.position.array,original);
    assert.equal(result.attributes.position.count,40); assert.equal(result.index.count,60);
    const inner = facePoints(result,face);
    inner.forEach((p,i)=>assert.ok(p.distanceTo(old[i].clone().lerp(center,0.5))<1e-6));
    const edges = new Map();
    for(let f=0; f<10; f++) {
      const points=facePoints(result,f);
      for(let i=0;i<4;i++) {
        const a=points[i].toArray().join(','),b=points[(i+1)%4].toArray().join(',');
        const key=[a,b].sort().join('|'), uses=edges.get(key)??[];
        uses.push([a,b]); edges.set(key,uses);
      }
    }
    for(const uses of edges.values()) {assert.equal(uses.length,2); assert.equal(uses[0][0],uses[1][1]); assert.equal(uses[0][1],uses[1][0]);}
    result.dispose(); source.dispose();
  }
  const geometry = new THREE.BoxGeometry();
  for(const options of [{face:0,amount:-0.1},{face:0,amount:1},{face:0,amount:NaN},{face:99,amount:0.5}]) assert.throws(()=>modifier.apply(geometry,options));
  const pos=geometry.attributes.position; pos.setX(0,pos.getX(0)+0.5);
  assert.throws(()=>modifier.apply(geometry,{face:0,amount:0.5}),/flat convex/);
});

test('manual Inset cancels and no-ops, records one undo, then extrudes the inner cap', () => {
  const e=editor(); e.app.selection.selectObject(e.objects[0]); e.click('edit-mode'); e.click('face-mode');
  e.app.mesh.selectFaceByTriangle(0);
  const tool=e.app.insetTool, mesh=e.app.mesh, object=e.objects[0];
  const original=object.geometry, before=e.takeSnapshot();
  const event=x=>({button:0,pointerId:12,clientX:x,preventDefault(){},stopPropagation(){}});
  e.click('inset-tool'); assert.equal(e.transformControls.object,null);
  tool.begin(event(0)); tool.move(event(30)); tool.cancel();
  assert.equal(object.geometry,original); assert.deepEqual(e.takeSnapshot(),before);
  tool.begin(event(0)); tool.end(event(0)); assert.equal(e.app.history.undoHistory.length,0);
  tool.begin(event(0)); tool.move(event(15)); tool.end(event(60));
  assert.equal(e.app.state.selectedObject,object); assert.equal(mesh.selectedFaceIndex,0);
  assert.equal(e.app.history.undoHistory.length,1); assert.equal(object.geometry.index.count,60);
  const inset=e.takeSnapshot();
  e.click('extrude-tool'); assert.equal(tool.active,false);
  const extrude=e.app.extrudeTool; extrude.begin(event(0)); extrude.end(event(-60));
  assert.equal(object.geometry.index.count,84); assert.equal(e.app.history.undoHistory.length,2);
  const after=e.takeSnapshot();
  e.app.history.undo(); assert.deepEqual(e.takeSnapshot(),inset);
  e.app.history.undo(); assert.deepEqual(e.takeSnapshot(),before);
  e.app.history.redo(); e.app.history.redo(); assert.deepEqual(e.takeSnapshot(),after);
  e.click('duplicate'); assert.deepEqual(e.app.state.selectedObject.geometry.index.array,e.objects[0].geometry.index.array);
  e.click('edit-mode'); e.click('face-mode'); mesh.selectFaceByTriangle(12); e.click('inset-tool');
  e.click('edge-mode'); assert.equal(tool.active,false); assert.ok(mesh.edgeMarkers.length>12);
});


test('Bevel is a closed oriented quad surface and preserves its input', () => {
  const modifier=new BevelModifier();
  for(const amount of [0.05,0.25,0.45]) {
    const geometry=new THREE.BoxGeometry(2,2,2), source=geometry.attributes.position.array.slice();
    const result=modifier.apply(geometry,{amount});
    assert.deepEqual(geometry.attributes.position.array,source);
    assert.equal(result.index.count/6,96);
    const edges=new Map();
    const key=p=>p.toArray().map(x=>x.toFixed(5)).join(',');
    for(let f=0;f<result.index.count/6;f++) {
      const points=facePoints(result,f);
      const n=new THREE.Vector3().subVectors(points[1],points[0]).cross(new THREE.Vector3().subVectors(points[2],points[0]));
      assert.ok(n.length()>1e-8);
      const center=new THREE.Vector3();points.forEach(p=>center.add(p));center.multiplyScalar(0.25);
      assert.ok(n.dot(center)>0);
      for(let i=0;i<4;i++) {
        const a=key(points[i]),b=key(points[(i+1)%4]),id=[a,b].sort().join('|'),uses=edges.get(id)??[];
        uses.push([a,b]);edges.set(id,uses);
      }
    }
    for(const uses of edges.values()) {assert.equal(uses.length,2);assert.equal(uses[0][0],uses[1][1]);assert.equal(uses[0][1],uses[1][0]);}
    assert.deepEqual(result.boundingBox.min.toArray(),[-1,-1,-1]);assert.deepEqual(result.boundingBox.max.toArray(),[1,1,1]);
  }
  assert.throws(()=>modifier.apply(new THREE.BoxGeometry(),{amount:0.5}));
  assert.throws(()=>modifier.apply(new THREE.BoxGeometry(2,2,2,2,2,2),{amount:0.2}));
});

test('manual Bevel supports cancel/history/duplicate/editing and rejects detailed meshes safely', () => {
  const e=editor();e.app.selection.selectObject(e.objects[0]);
  e.executeCommand({action:'skew',target:'selected',axis:'x',relativeTo:'y',amount:0.2});
  const tool=e.app.bevelTool,object=e.objects[0],original=object.geometry,before=e.takeSnapshot();
  const count=e.app.history.undoHistory.length;
  const event=x=>({button:0,pointerId:14,clientX:x,preventDefault(){},stopPropagation(){}});
  e.app.bendTool.setActive(true);tool.setActive(true);assert.equal(e.app.bendTool.active,false);
  tool.begin(event(0));tool.move(event(60));tool.cancel();assert.equal(object.geometry,original);
  tool.begin(event(0));tool.end(event(0));assert.equal(e.app.history.undoHistory.length,count);
  tool.begin(event(0));tool.move(event(30));tool.end(event(120));
  assert.equal(e.app.state.selectedObject,object);assert.equal(e.app.history.undoHistory.length,count+1);
  const after=e.takeSnapshot();e.app.history.undo();assert.deepEqual(e.takeSnapshot(),before);e.app.history.redo();assert.deepEqual(e.takeSnapshot(),after);
  e.click('duplicate');assert.deepEqual(e.app.state.selectedObject.geometry.index.array,e.objects[0].geometry.index.array);
  e.click('edit-mode');e.click('face-mode');e.app.mesh.selectFaceByTriangle(0);assert.equal(e.app.mesh.selectedVertexMarkers.size,4);
  e.click('edge-mode');assert.ok(e.app.mesh.edgeMarkers.length>12);e.click('edit-mode');
  const unsupported=e.takeSnapshot();tool.setActive(true);tool.begin(event(0));tool.move(event(60));
  assert.equal(tool.dragging,false);assert.equal(e.app.modifiers.transaction,null);assert.deepEqual(e.takeSnapshot(),unsupported);
  assert.match(e.find('#tool-status').textContent,/unsubdivided/);
});

test('selected-edge Bevel previews, cancels, repeats, preserves transforms and supports history/duplicate', () => {
  const e = editor(), app = e.app, mesh = app.mesh, object = e.objects[0], tool = app.bevelTool;
  object.position.set(3, -2, 1);
  object.rotation.set(0.3, -0.2, 0.4);
  object.scale.set(2, 0.75, 1.5);
  app.viewport.controls.enabled = true;
  selectMeshComponents(e, 'edge');
  const before = e.takeSnapshot(), original = object.geometry;
  e.click('bevel-tool');
  assert.equal(tool.active, true);
  assert.equal(e.transformControls.object, null);
  assert.equal(e.find('#bevel-tools').hidden, false);
  const event = x => ({button: 0, pointerId: 19, clientX: x, preventDefault() {}, stopPropagation() {}});
  tool.begin(event(0)); tool.move(event(60));
  assert.equal(app.modifiers.transaction.name, 'edgeBevel');
  assert.ok(object.geometry.index.count > 36);
  assert.ok(mesh.edgeMarkers.every(edge => !edge.visible));
  assert.equal(e.find('#edge-mode').disabled, true);
  assert.equal(app.viewport.controls.enabled, false);
  tool.cancel();
  assert.equal(object.geometry, original);
  assert.equal(app.modifiers.transaction, null);
  assert.deepEqual(e.takeSnapshot(), before);
  assert.equal(mesh.selectedEdgeMarkers.size, 2);
  assert.ok(mesh.edgeMarkers.every(edge => edge.visible));
  assert.equal(app.viewport.controls.enabled, true);
  tool.begin(event(0)); tool.end(event(0));
  assert.equal(app.history.undoHistory.length, 0);
  assert.equal(mesh.selectedEdgeMarkers.size, 2);
  const source = object.geometry;
  tool.begin(event(0));
  tool.move(event(30));
  const intermediate = object.geometry;
  let disposed = 0;
  intermediate.addEventListener('dispose', () => disposed++);
  tool.end(event(60));
  assert.equal(disposed, 1);
  assert.equal(app.history.undoHistory.length, 1);
  assert.equal(mesh.selectedEdgeMarkers.size, 8);
  assert.equal(object.geometry.userData.bevelEdgeIndices, undefined);
  const expected = new EdgeBevelModifier().apply(source, {edges: tool.sourceEdges, amount: 0.125});
  assert.deepEqual(object.geometry.attributes.position.array, expected.attributes.position.array);
  expected.dispose();
  for (const property of ['position', 'rotation', 'scale']) {
    assert.deepEqual(e.takeSnapshot().objects[0][property], before.objects[0][property]);
  }
  const bevelled = e.takeSnapshot();
  tool.begin(event(0)); tool.end(event(24)); // Bevel the newly selected rim segments.
  assert.equal(app.history.undoHistory.length, 2);
  assert.equal(mesh.selectedEdgeMarkers.size, 32);
  e.click('move-mode');
  assert.equal(tool.active, false);
  assert.equal(e.transformControls.object, mesh.vertexPivot);
  const events = e.transformControls.listeners;
  events.mouseDown(); mesh.vertexPivot.position.y += 0.2; events.objectChange(); events.mouseUp();
  assert.equal(app.history.undoHistory.length, 3);
  const after = e.takeSnapshot();
  e.click('undo'); e.click('undo'); assert.deepEqual(e.takeSnapshot(), bevelled);
  e.click('undo'); assert.deepEqual(e.takeSnapshot(), before);
  assert.equal(mesh.edgeMarkers.length, 0);
  e.click('redo'); e.click('redo'); e.click('redo'); assert.deepEqual(e.takeSnapshot(), after);
  e.click('duplicate');
  assert.deepEqual(app.state.selectedObject.geometry.attributes.position.array, e.objects[0].geometry.attributes.position.array);
  assert.deepEqual(app.state.selectedObject.geometry.index.array, e.objects[0].geometry.index.array);
  assert.equal(app.state.selectedObject.children.length, 0);
});

test('edge Bevel follows multi-selection, turns off on mode/selection changes and locks numeric transforms', () => {
  const e = editor(), app = e.app, mesh = app.mesh, tool = app.bevelTool;
  app.selection.selectObject(e.objects[0]); e.click('edit-mode');
  assert.equal(e.find('#bevel-tools').hidden, true);
  e.click('edge-mode');
  assert.equal(e.find('#bevel-tool').disabled, true);
  mesh.selectEdgeMarker(mesh.edgeMarkers[0]);
  assert.equal(e.find('#bevel-tool').disabled, false);
  e.click('bevel-tool');
  mesh.selectEdgeMarker(mesh.edgeMarkers[1], true);
  assert.equal(tool.active, true);
  assert.equal(mesh.selectedEdgeMarkers.size, 2);
  assert.equal(e.transformControls.object, null);
  assert.ok(app.ui.propertyInputs.every(({input}) => input.disabled));
  assert.equal(mesh.setComponentTransformValue('position', 'x', 1), false);
  mesh.selectEdgeMarker(null);
  assert.equal(tool.active, false);
  assert.equal(e.find('#bevel-tool').disabled, true);
  mesh.selectEdgeMarker(mesh.edgeMarkers[0]); e.click('bevel-tool');
  e.click('face-mode');
  assert.equal(tool.active, false);
  assert.equal(e.find('#bevel-tools').hidden, true);
  e.click('edge-mode'); mesh.selectEdgeMarker(mesh.edgeMarkers[0]); e.click('bevel-tool');
  e.click('rotate-mode');
  assert.equal(tool.active, false);
  assert.equal(e.transformControls.getMode(), 'rotate');
  assert.equal(e.transformControls.object, mesh.vertexPivot);
  assert.ok(app.ui.propertyInputs.every(({input}) => !input.disabled));
});

test('edge Bevel errors and capture loss restore topology, selection, controls and history', () => {
  const e = editor(), app = e.app, mesh = app.mesh, tool = app.bevelTool;
  app.selection.selectObject(e.objects[0]); e.click('edit-mode'); e.click('edge-mode');
  mesh.selectEdgeMarker(mesh.edgeMarkers[0]);
  const event = x => ({button: 0, pointerId: 20, clientX: x, preventDefault() {}, stopPropagation() {}});
  app.viewport.controls.enabled = true;
  const before = e.takeSnapshot(), original = e.objects[0].geometry;
  e.click('bevel-tool'); tool.begin(event(0)); tool.move(event(48));
  tool.handle.listeners.lostpointercapture();
  assert.equal(e.objects[0].geometry, original);
  assert.deepEqual(e.takeSnapshot(), before);
  assert.equal(mesh.selectedEdgeMarkers.size, 1);
  assert.equal(app.modifiers.transaction, null);
  assert.equal(app.history.undoHistory.length, 0);
  const p = original.attributes.position;
  p.setX(0, p.getX(0) + 0.2); // Nonplanar source must fail without changing it.
  const invalid = e.takeSnapshot();
  tool.begin(event(0)); tool.move(event(48));
  assert.equal(tool.dragging, false);
  assert.equal(app.modifiers.transaction, null);
  assert.equal(app.viewport.controls.enabled, true);
  assert.deepEqual(e.takeSnapshot(), invalid);
  assert.equal(mesh.selectedEdgeMarkers.size, 1);
  assert.match(e.find('#tool-status').textContent, /flat convex/);
});

test('selected-edge Bevel remains editable with single-face Extrude/Inset and topology-aware Undo/Redo', () => {
  const e = editor(), app = e.app, mesh = app.mesh;
  selectMeshComponents(e, 'edge');
  const before = e.takeSnapshot();
  const event = x => ({button: 0, pointerId: 21, clientX: x, preventDefault() {}, stopPropagation() {}});
  e.click('bevel-tool'); app.bevelTool.begin(event(0)); app.bevelTool.end(event(48));
  assert.equal(app.history.undoHistory.length, 1);
  e.click('face-mode'); mesh.selectFaceByTriangle(0);
  e.click('extrude-tool'); app.extrudeTool.begin(event(0)); app.extrudeTool.end(event(30));
  assert.equal(app.history.undoHistory.length, 2);
  e.click('inset-tool'); app.insetTool.begin(event(0)); app.insetTool.end(event(30));
  assert.equal(app.history.undoHistory.length, 3);
  assert.equal(mesh.selectedFaceIndex, 0);
  assert.equal(mesh.selectedVertexMarkers.size, 4);
  const after = e.takeSnapshot();
  e.click('undo'); e.click('undo'); e.click('undo'); assert.deepEqual(e.takeSnapshot(), before);
  e.click('redo'); e.click('redo'); e.click('redo'); assert.deepEqual(e.takeSnapshot(), after);
});


test('toolbar shows tools for the current mode and keeps active-tool guidance synchronized', () => {
  const e=editor();
  assert.equal(e.find('#object-tools').hidden,false); assert.equal(e.find('#mesh-tools').hidden,true);
  e.app.selection.selectObject(e.objects[0]); e.click('skew-tool');
  assert.match(e.find('#tool-status').textContent,/SKEW/);
  e.click('edit-mode');
  assert.equal(e.app.skewTool.active,false);
  assert.equal(e.find('#object-tools').hidden,true); assert.equal(e.find('#mesh-tools').hidden,false);
  assert.equal(e.find('#inset-tool').disabled,true);
  e.click('face-mode'); e.app.mesh.selectFaceByTriangle(0);
  assert.equal(e.find('#inset-tool').disabled,false);
  e.click('inset-tool'); assert.match(e.find('#tool-status').textContent,/INSET/);
  e.click('edge-mode'); assert.equal(e.app.insetTool.active,false);
  assert.match(e.find('#tool-status').textContent,/Ctrl\/Shift \+ click/);
});

test('object multiselection toggles, highlights, excludes parent/child and drives a shared transform pivot', () => {
  const e = editor(), app = e.app;
  const a = e.objects[0];
  app.objects.addObject('Sphere');
  const b = app.state.selectedObject;
  b.position.x = 4;
  app.selection.selectObject(a);
  app.selection.selectObject(b, true);
  assert.deepEqual(app.state.selectedObjects, [a, b]);
  assert.equal(a.material.color.getHex(), app.state.selectedColor);
  assert.equal(b.material.color.getHex(), app.state.selectedColor);
  assert.equal(e.transformControls.object, app.selection.pivot);
  const events = e.transformControls.listeners;
  events.mouseDown();
  app.selection.pivot.position.y += 3;
  events.objectChange(); events.mouseUp();
  assert.equal(a.position.y, 3);
  assert.equal(b.position.y, 3);
  e.click('undo');
  assert.equal(e.objects[0].position.y, 0);
  assert.equal(app.state.selectedObjects.length, 2);
  e.click('redo');
  assert.equal(e.objects[0].position.y, 3);
  app.selection.selectObject(app.state.selectedObjects[1], true);
  assert.equal(app.state.selectedObjects.length, 1);
  app.selection.selectObject(null, true);
  assert.equal(app.state.selectedObjects.length, 1);
  app.selection.selectObject(null);
  assert.equal(app.state.selectedObjects.length, 0);
});

function worldVertices(object) {
  object.updateWorldMatrix(true, false);
  const positions = object.geometry.attributes.position;
  return Array.from({ length: positions.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld));
}
function assertVertices(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(v.distanceTo(expected[i]) < 1e-5));
}

test('group/ungroup preserve world surfaces, hierarchy, metadata and history, including shear', () => {
  const e = editor(), app = e.app;
  const a = e.objects[0];
  a.position.set(-2, 1, 0); a.rotation.z = 0.4;
  const b = app.objects.addObject('Sphere'); b.position.x = 3;
  app.selection.setSelection([a, b]);
  const before = worldVertices(a);
  e.click('group');
  const group = app.state.selectedObject;
  assert.ok(group.isGroup);
  assert.equal(a.parent, group);
  assertVertices(worldVertices(a), before);
  group.rotation.y = 0.7; group.scale.set(2, 1, 0.6);
  const transformed = worldVertices(a), sphereTransformed = worldVertices(b);
  e.click('ungroup');
  assert.equal(a.parent, app.viewport.scene);
  assertVertices(worldVertices(a), transformed);
  assertVertices(worldVertices(b), sphereTransformed);
  assert.equal(app.state.selectedObjects.length, 2);
  e.click('undo');
  assert.ok(app.state.selectedObject.isGroup);
  assert.equal(app.state.selectedObject.children.length, 2);
  e.click('redo');
  assert.equal(e.objects.length, 2);
  assertVertices(worldVertices(e.objects.find(o => o.name === a.name)), transformed);
  assertVertices(worldVertices(e.objects.find(o => o.name === b.name)), sphereTransformed);
});

test('hidden and locked objects are not editable, are excluded from picking, and restore with undo/redo', () => {
  const e = editor(), app = e.app;
  let object = e.objects[0];
  app.selection.selectObject(object);
  app.workflow.toggle(object, 'visible');
  assert.equal(object.visible, false);
  assert.equal(app.state.selectedObject, null);
  app.selection.selectObject(object);
  assert.equal(app.state.selectedObject, null);
  assert.throws(() => e.executeCommand({ action: 'move', target: object.userData.editorId, position: {x:1,y:0,z:0} }));
  e.click('undo'); object = e.objects[0];
  assert.equal(object.visible, true);
  assert.equal(app.state.selectedObject, object);
  e.click('redo'); assert.equal(e.objects[0].visible, false);
  app.workflow.toggle(e.objects[0], 'visible');
  object = e.objects[0];
  app.workflow.toggle(object, 'locked');
  assert.equal(object.visible, true);
  assert.equal(object.userData.locked, true);
  assert.equal(app.state.selectedObject, null);
  assert.equal(app.workflow.editable(object), false);
  e.click('undo'); assert.equal(e.objects[0].userData.locked, false);
  e.click('redo'); assert.equal(e.objects[0].userData.locked, true);
  app.workflow.toggle(e.objects[0], 'locked');
  app.selection.selectObject(e.objects[0]);
  assert.equal(e.transformControls.object, e.objects[0]);
});

test('group safety blocks locked descendants; duplicate/delete groups preserve geometry and undo', () => {
  const e = editor(), app = e.app;
  app.objects.addObject('Cube');
  app.selection.setSelection([...e.objects]);
  app.workflow.group();
  let group = app.state.selectedObject;
  app.workflow.toggle(group.children[0], 'locked');
  assert.equal(e.transformControls.object, null);
  assert.equal(app.workflow.transformable(group), false);
  const count = e.objects.length;
  app.objects.deleteObject(group);
  assert.equal(e.objects.length, count);
  app.workflow.toggle(group.children[0], 'locked');
  app.selection.selectObject(group);
  e.click('duplicate');
  const copy = app.state.selectedObject;
  assert.ok(copy.isGroup);
  assert.equal(copy.children.length, 2);
  assert.notEqual(copy.children[0].geometry, group.children[0].geometry);
  e.click('delete');
  assert.equal(e.objects.length, count);
  e.click('undo');
  assert.equal(app.state.selectedObject.children.length, 2);
  e.click('redo'); assert.equal(e.objects.length, count);
});

test('Outliner supports Shift selection, visibility and lock; Edit Mode disables object workflow', () => {
  const e = editor(), app = e.app;
  app.objects.addObject('Cube');
  const rows = app.ui.outliner.children;
  rows[0].children[0].listeners.click({shiftKey:false});
  rows[1].children[0].listeners.click({shiftKey:true});
  assert.equal(app.state.selectedObjects.length, 2);
  app.mesh.toggleEditMode();
  assert.equal(app.mesh.editMode, false);
  app.selection.selectObject(e.objects[0]);
  app.mesh.toggleEditMode();
  assert.equal(app.mesh.editMode, true);
  assert.equal(e.find('#group').disabled, true);
  const before = JSON.stringify(e.takeSnapshot());
  app.workflow.toggle(e.objects[0], 'visible');
  app.workflow.group();
  assert.equal(JSON.stringify(e.takeSnapshot()), before);
  app.mesh.toggleEditMode();
  app.ui.updateOutliner();
  app.ui.outliner.children[0].children[1].listeners.click();
  assert.equal(e.objects[0].visible, false);
  app.ui.outliner.children[0].children[1].listeners.click();
  app.ui.outliner.children[0].children[2].listeners.click();
  assert.equal(e.objects[0].userData.locked, true);
});

test('transform space and snap settings use native APIs; view materials return exactly to Solid', () => {
  const e = editor(), app = e.app;
  app.selection.selectObject(e.objects[0]);
  const before = JSON.stringify(e.takeSnapshot());
  e.find('#transform-space').listeners.change({target:{value:'local'}});
  assert.equal(e.transformControls.space, 'local');
  assert.equal(JSON.stringify(e.takeSnapshot()), before);
  for (const [id, value, field, expected] of [
    ['translation-snap','5','translationSnap',5],
    ['rotation-snap','15','rotationSnap',Math.PI / 12],
    ['scale-snap','0.25','scaleSnap',0.25]
  ]) {
    e.find(`#${id}`).listeners.change({target:{value}});
    assert.ok(Math.abs(e.transformControls[field] - expected) < 1e-12);
    e.find(`#${id}`).listeners.change({target:{value:'0'}});
    assert.equal(e.transformControls[field], null);
  }
  const material = e.objects[0].material;
  material.opacity = 0.8;
  const original = [material.wireframe, material.transparent, material.opacity, material.depthWrite];
  for (const mode of ['wireframe','xray','solid']) {
    e.find('#view-mode').listeners.change({target:{value:mode}});
    if (mode === 'wireframe') assert.equal(material.wireframe, true);
    if (mode === 'xray') assert.equal(material.opacity, 0.3);
  }
  assert.deepEqual([material.wireframe, material.transparent, material.opacity, material.depthWrite], original);
});

test('all orthographic presets share active camera with controls; frame selected fits perspective and ortho', () => {
  const e = editor(), app = e.app;
  const viewport = new SceneViewport(app);
  Object.assign(viewport, app.viewport);
  viewport.renderer.setSize = () => {};
  viewport.perspectiveCamera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 1000);
  viewport.perspectiveCamera.position.set(5,4,5);
  viewport.orthographicCamera = new THREE.OrthographicCamera(-5,5,5,-5,0.1,1000);
  viewport.orthoHeight = 10;
  viewport.camera = viewport.perspectiveCamera;
  viewport.controls = { target:new THREE.Vector3(), update() {}, enableDamping:true };
  app.viewport = viewport;
  const object = e.objects[0]; object.position.set(20,3,-8);
  app.selection.selectObject(object);
  const unchanged = JSON.stringify(e.takeSnapshot());
  for (const preset of ['front','back','left','right','top','bottom','perspective']) {
    app.views.setPreset(preset);
    assert.equal(viewport.camera.isOrthographicCamera === true, preset !== 'perspective');
    assert.equal(viewport.controls.object, viewport.camera);
    assert.equal(viewport.transformControls.camera, viewport.camera);
    app.views.frameSelected();
    assert.ok(viewport.controls.target.distanceTo(object.position) < 1e-6);
    viewport.camera.updateMatrixWorld(true);
    for (const point of worldVertices(object)) {
      const projected = point.clone().project(viewport.camera);
      assert.ok(Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1);
    }
  }
  assert.equal(JSON.stringify(e.takeSnapshot()), unchanged);
});

test('multi-object nonuniform scaling preserves world surfaces and active selection through history', () => {
  const e = editor(), app = e.app;
  const a = e.objects[0]; a.rotation.z = 0.6;
  const b = app.objects.addObject('Cube'); b.position.x = 4; b.rotation.y = 0.3;
  app.selection.setSelection([b, a]);
  const source = worldVertices(a);
  const pivotBefore = app.selection.pivot.matrixWorld.clone();
  const events = e.transformControls.listeners;
  events.mouseDown();
  app.selection.pivot.scale.set(2, 0.7, 1);
  app.selection.pivot.updateMatrixWorld(true);
  const delta = app.selection.pivot.matrixWorld.clone().multiply(pivotBefore.invert());
  const expected = source.map(v => v.clone().applyMatrix4(delta));
  events.objectChange(); events.mouseUp();
  assertVertices(worldVertices(a), expected);
  const activeId = a.userData.editorId;
  e.click('undo'); e.click('redo');
  assert.equal(app.state.selectedObject.userData.editorId, activeId);
  assertVertices(worldVertices(app.state.selectedObject), expected);
});

test('viewport picking skips hidden/locked meshes and supports Shift selection', () => {
  const e = editor(), app = e.app;
  const cube = e.objects[0], sphere = app.objects.addObject('Sphere');
  const input = app.input;
  let candidates;
  input.raycaster.intersectObjects = objects => { candidates = objects; return objects.length ? [{object:objects[0]}] : []; };
  const canvas = app.viewport.renderer.domElement;
  const click = shiftKey => {
    canvas.listeners.pointerdown({button:0,clientX:400,clientY:300,pointerId:1});
    canvas.listeners.pointerup({button:0,clientX:400,clientY:300,pointerId:1,shiftKey});
  };
  app.selection.selectObject(sphere);
  click(true);
  assert.equal(app.state.selectedObjects.length, 2);
  app.workflow.toggle(cube, 'visible');
  click(false);
  assert.deepEqual(candidates, [sphere]);
  app.workflow.toggle(sphere, 'locked');
  click(false);
  assert.equal(candidates.length, 0);
  assert.equal(app.state.selectedObject, null);
});

test('Ctrl and Meta clicks toggle objects in Outliner and viewport without changing Edit Mode selection', () => {
  const e = editor(), app = e.app;
  const a = e.objects[0], b = app.objects.addObject('Cube');
  app.ui.outliner.children[0].children[0].listeners.click({ctrlKey:true});
  assert.deepEqual(app.state.selectedObjects, [b,a]);
  app.ui.outliner.children[1].children[0].listeners.click({metaKey:true});
  assert.deepEqual(app.state.selectedObjects, [a]);
  const input = app.input;
  input.raycaster.intersectObjects = () => [{object:b}];
  const canvas = app.viewport.renderer.domElement;
  canvas.listeners.pointerdown({button:0,clientX:400,clientY:300,pointerId:1});
  canvas.listeners.pointerup({button:0,clientX:400,clientY:300,pointerId:1,ctrlKey:true});
  assert.deepEqual(app.state.selectedObjects, [a,b]);
  app.selection.selectObject(a);
  app.mesh.toggleEditMode();
  assert.equal(app.ui.outliner.children[0].children[1].disabled, true);
  app.selection.selectObject(b,true);
  assert.equal(app.state.selectedObject,a);
});

test('toolbar transform buttons share keyboard behavior in Object/Edit Mode and respect drag locks', () => {
  const e = editor(), app = e.app;
  app.selection.selectObject(e.objects[0]);
  for (const [id,mode] of [['rotate-mode','rotate'],['scale-mode','scale'],['move-mode','translate']]) {
    e.click(id);
    assert.equal(e.transformControls.getMode(),mode);
  }
  app.skewTool.setActive(true);
  e.click('rotate-mode');
  assert.equal(app.skewTool.active,false);
  assert.equal(e.transformControls.getMode(),'rotate');
  e.transformControls.dragging = true;
  e.click('scale-mode');
  assert.equal(e.transformControls.getMode(),'rotate');
  e.transformControls.dragging = false;
  app.mesh.toggleEditMode();
  assert.equal(e.find('#rotate-mode').disabled,false);
  e.click('rotate-mode');
  assert.equal(e.transformControls.getMode(),'rotate');
});

test('object search retains group context, reports no results, and never changes selection', () => {
  const e = editor(), app = e.app;
  const a = e.objects[0], b = app.objects.addObject('Sphere');
  app.selection.setSelection([a,b]); app.workflow.group();
  const group = app.state.selectedObject;
  const search = e.find('#object-search');
  search.value = 'sphere'; search.listeners.input();
  assert.equal(app.ui.outliner.children.length,2);
  assert.equal(app.state.selectedObject,group);
  search.value = 'group'; search.listeners.input();
  assert.equal(app.ui.outliner.children.length,3);
  search.value = 'missing'; search.listeners.input();
  assert.equal(app.ui.outliner.children.length,0);
  assert.equal(e.find('#outliner-empty').hidden,false);
  search.value = ''; search.listeners.input();
  assert.equal(app.ui.outliner.children.length,3);
  assert.equal(e.find('#outliner-empty').hidden,true);
});

test('dropdowns close siblings and outside clicks, and Escape returns focus to the trigger', () => {
  const e = editor(), ui = e.app.ui;
  const [add,object] = ui.menus;
  add.id = 'add-menu'; object.id = 'object-menu';
  add.open = true;
  object.open = true; object.listeners.toggle();
  assert.equal(add.open,false);
  assert.equal(object.open,true);
  let prevented = false;
  object.listeners.keydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){}});
  assert.equal(object.open,false);
  assert.equal(prevented,true);
  assert.equal(document.activeElement,e.find('#object-menu > summary'));
  object.open = true;
  window.listeners.pointerdown({target:{closest(){return null;}}});
  assert.equal(object.open,false);
  const one = e.find('#add-cube'), two = e.find('#add-sphere');
  add.querySelectorAll = () => [one,two];
  document.activeElement = null;
  add.listeners.keydown({key:'ArrowDown',preventDefault(){}});
  assert.equal(document.activeElement,one);
  add.listeners.keydown({key:'ArrowDown',preventDefault(){}});
  assert.equal(document.activeElement,two);
});
