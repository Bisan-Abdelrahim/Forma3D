import { BevelModifier } from '../src/editor/modifiers/BevelModifier.js';
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
    style: {}, remove() {}, setPointerCapture() {}, hasPointerCapture() { return false; },
    value: '', listeners: {}, children: [], validity: { valid: true },
    focus() { document.activeElement = this; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    classList: { toggle() {} },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children.length = 0; }, setAttribute() {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    clientWidth: 800, clientHeight: 600
  });
  const find = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  class Transform {
    dragging = false; axis = null; mode = 'translate'; listeners = {};
    attach(object) { this.object = object; }
    detach() { this.object = null; }
    setMode(mode) { this.mode = mode; }
    pointerUp() { this.dragging = false; }
    getMode() { return this.mode; }
    setTranslationSnap(value) { this.translationSnap = value; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLTextAreaElement = class {};
  globalThis.document = { querySelector: find, getElementById: id => find(`#${id}`), createElement: element };
  globalThis.window = { listeners: {}, addEventListener(name, fn) { const previous = this.listeners[name]; this.listeners[name] = event => { previous?.(event); fn(event); }; } };
  const app = new EditorApp({ createViewport: editor => ({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: element() }, transformControls: new Transform(), controls: {},
    setup() {
      editor.ui.viewport = find('#viewport');
      editor.ui.outliner = find('#outliner');
      editor.ui.properties = find('#properties');
    }, start() {}
  }), ...options }).start();
  return {
    app, executeCommand: app.commands.executeCommand, takeSnapshot: app.history.takeSnapshot,
    objects: app.state.objects, transformControls: app.viewport.transformControls,
    click: id => find(`#${id}`).listeners.click(), find
  };
}

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
  assert.match(e.find('#tool-status').textContent,/Select a vertex/);
});
