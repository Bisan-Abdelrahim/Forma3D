import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// Plain HTML keeps the editor UI separate from the Three.js canvas.
document.querySelector('#app').innerHTML = `
  <header id="toolbar">
    <strong>Forma3D</strong>
    <button id="add-cube">Add Cube</button>
    <button id="add-sphere">Add Sphere</button>
    <button id="add-cylinder">Add Cylinder</button>
    <button id="duplicate">Duplicate</button>
    <button id="delete">Delete</button>
    <button id="undo">Undo</button>
    <button id="redo">Redo</button>
    <label><input id="snap" type="checkbox"> Snap movement (1 unit)</label>
  </header>
  <main id="editor">
    <aside><h2>Objects</h2><div id="outliner"></div></aside>
    <div id="viewport"></div>
    <aside><h2>Properties</h2><p id="selection-name">No selection</p><div id="properties"></div></aside>
  </main>
`;
const viewport = document.querySelector('#viewport');
const outliner = document.querySelector('#outliner');
const properties = document.querySelector('#properties');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(5, 4, 5);
const renderer = new THREE.WebGLRenderer();
viewport.appendChild(renderer.domElement);

// Register the gizmo first so it disables camera input before a drag starts.
const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
scene.add(transformControls.getHelper());
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = true;
controls.enablePan = true;
const grid = new THREE.GridHelper(20, 20);
grid.position.y = -1;
scene.add(grid);
scene.add(new THREE.AxesHelper(3));

// Only meshes in this array can be selected or edited.
const objects = [];
let selectedObject = null;
const nameCounts = { Cube: 0, Sphere: 0, Cylinder: 0 };
let nextObjectId = 1;
const originalColor = 0x00ff88;
const selectedColor = 0xccff33;
const undoHistory = [];
const redoHistory = [];
let dragStartSnapshot = null;

function createMesh(type) {
  let geometry;
  if (type === 'Cube') geometry = new THREE.BoxGeometry(2, 2, 2);
  else if (type === 'Sphere') geometry = new THREE.SphereGeometry(1, 24, 16);
  else geometry = new THREE.CylinderGeometry(1, 1, 2, 24);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: originalColor }));
}

function giveObjectName(object, type) {
  nameCounts[type] += 1;
  object.name = `${type} ${nameCounts[type]}`;
  object.userData = { type, editorId: nextObjectId++ };
}

function selectObject(object) {
  if (selectedObject) selectedObject.material.color.setHex(originalColor);
  selectedObject = object;
  if (object) {
    object.material.color.setHex(selectedColor);
    transformControls.attach(object);
  } else {
    transformControls.detach();
  }
  updateOutliner();
  updateProperties();
  updateButtons();
}

function updateOutliner() {
  outliner.replaceChildren();
  for (const object of objects) {
    const button = document.createElement('button');
    button.textContent = object.name;
    button.classList.toggle('selected', object === selectedObject);
    button.setAttribute('aria-pressed', String(object === selectedObject));
    button.disabled = transformControls.dragging;
    button.addEventListener('click', () => selectObject(object));
    outliner.appendChild(button);
  }
}

// Rotation is shown in degrees; Three.js stores it in radians.
const propertyInputs = [];
for (const property of ['position', 'rotation', 'scale']) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = property === 'rotation' ? 'Rotation (degrees)' : property;
  fieldset.appendChild(legend);
  for (const axis of ['x', 'y', 'z']) {
    const label = document.createElement('label');
    label.textContent = axis.toUpperCase();
    const input = document.createElement('input');
    input.type = 'number';
    input.step = property === 'rotation' ? '1' : '0.1';
    input.setAttribute('aria-label', `${property} ${axis.toUpperCase()}`);
    label.appendChild(input);
    fieldset.appendChild(label);
    propertyInputs.push({ input, property, axis });
    input.addEventListener('input', () => {
      if (!selectedObject || transformControls.dragging || input.value === '' || !input.validity.valid) return;
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      const before = takeSnapshot();
      selectedObject[property][axis] = property === 'rotation' ? THREE.MathUtils.degToRad(value) : value;
      selectedObject.updateMatrixWorld();
      recordAction(before);
    });
    input.addEventListener('blur', updateProperties);
  }
  properties.appendChild(fieldset);
}

function updateProperties() {
  document.querySelector('#selection-name').textContent = selectedObject ? selectedObject.name : 'No selection';
  for (const { input, property, axis } of propertyInputs) {
    input.disabled = !selectedObject || transformControls.dragging;
    if (!selectedObject) input.value = '';
    else {
      let value = selectedObject[property][axis];
      if (property === 'rotation') value = THREE.MathUtils.radToDeg(value);
      input.value = String(Number(value.toFixed(4)));
    }
  }
}

// History saves plain object data, not live meshes or their selection colors.
function takeSnapshot() {
  return {
    objects: objects.map(object => ({
      id: object.userData.editorId,
      type: object.userData.type,
      name: object.name,
      position: object.position.toArray(),
      rotation: object.rotation.toArray(),
      scale: object.scale.toArray()
    })),
    selectedId: selectedObject?.userData.editorId ?? null,
    nameCounts: { ...nameCounts },
    nextObjectId
  };
}

function recordAction(before) {
  const after = takeSnapshot();
  if (JSON.stringify(before.objects) === JSON.stringify(after.objects)) return;
  undoHistory.push({ before, after });
  redoHistory.length = 0;
  updateButtons();
}

function restoreSnapshot(snapshot) {
  selectObject(null);
  for (const object of objects) {
    scene.remove(object);
    object.geometry.dispose();
    object.material.dispose();
  }
  objects.length = 0;
  Object.assign(nameCounts, snapshot.nameCounts);
  nextObjectId = snapshot.nextObjectId;
  for (const saved of snapshot.objects) {
    const object = createMesh(saved.type);
    object.name = saved.name;
    object.userData = { type: saved.type, editorId: saved.id };
    object.position.fromArray(saved.position);
    object.rotation.fromArray(saved.rotation);
    object.scale.fromArray(saved.scale);
    objects.push(object);
    scene.add(object);
  }
  scene.updateMatrixWorld(true);
  selectObject(objects.find(object => object.userData.editorId === snapshot.selectedId) ?? null);
}

function updateButtons() {
  const dragging = transformControls.dragging;
  for (const id of ['add-cube', 'add-sphere', 'add-cylinder', 'snap']) {
    document.getElementById(id).disabled = dragging;
  }
  document.querySelector('#delete').disabled = dragging || !selectedObject;
  document.querySelector('#duplicate').disabled = dragging || !selectedObject;
  document.querySelector('#undo').disabled = dragging || undoHistory.length === 0;
  document.querySelector('#redo').disabled = dragging || redoHistory.length === 0;
}

function addObject(type) {
  const before = takeSnapshot();
  const object = createMesh(type);
  giveObjectName(object, type);
  objects.push(object);
  scene.add(object);
  selectObject(object);
  recordAction(before);
}
for (const type of ['Cube', 'Sphere', 'Cylinder']) {
  document.getElementById(`add-${type.toLowerCase()}`).addEventListener('click', () => addObject(type));
}
document.querySelector('#duplicate').addEventListener('click', () => {
  if (!selectedObject) return;
  const before = takeSnapshot();
  const duplicate = createMesh(selectedObject.userData.type);
  giveObjectName(duplicate, selectedObject.userData.type);
  duplicate.position.copy(selectedObject.position).add(new THREE.Vector3(1, 0, 1));
  duplicate.quaternion.copy(selectedObject.quaternion);
  duplicate.scale.copy(selectedObject.scale);
  objects.push(duplicate);
  scene.add(duplicate);
  selectObject(duplicate);
  recordAction(before);
});
document.querySelector('#delete').addEventListener('click', () => {
  if (!selectedObject) return;
  const before = takeSnapshot();
  const object = selectedObject;
  selectObject(null);
  objects.splice(objects.indexOf(object), 1);
  scene.remove(object);
  object.geometry.dispose();
  object.material.dispose();
  updateOutliner();
  recordAction(before);
});
document.querySelector('#undo').addEventListener('click', () => {
  const action = undoHistory.pop();
  if (!action) return;
  redoHistory.push(action);
  restoreSnapshot(action.before);
});
document.querySelector('#redo').addEventListener('click', () => {
  const action = redoHistory.pop();
  if (!action) return;
  undoHistory.push(action);
  restoreSnapshot(action.after);
});
document.querySelector('#snap').addEventListener('change', (event) => {
  transformControls.setTranslationSnap(event.target.checked ? 1 : null);
});

window.addEventListener('keydown', (event) => {
  // Typing into a property field should never switch the gizmo mode.
  if (event.target instanceof HTMLInputElement || event.target.isContentEditable ||
      event.ctrlKey || event.metaKey || event.altKey || transformControls.dragging) return;
  const key = event.key.toLowerCase();
  if (key === 'm') transformControls.setMode('translate');
  else if (key === 'r') transformControls.setMode('rotate');
  else if (key === 's') transformControls.setMode('scale');
});

transformControls.addEventListener('mouseDown', () => {
  dragStartSnapshot = takeSnapshot();
});
transformControls.addEventListener('objectChange', updateProperties);
transformControls.addEventListener('mouseUp', () => {
  if (dragStartSnapshot) recordAction(dragStartSnapshot);
  dragStartSnapshot = null;
});
transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
  updateProperties();
  updateOutliner();
  updateButtons();
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let clickStart = null;
let isDragging = false;
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (transformControls.dragging || transformControls.axis !== null) {
    clickStart = null;
    return;
  }
  clickStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  isDragging = false;
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!clickStart || event.pointerId !== clickStart.pointerId) return;
  if (Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 4) isDragging = true;
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!clickStart || event.pointerId !== clickStart.pointerId) return;
  const distance = Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y);
  clickStart = null;
  if (event.button !== 0 || isDragging || distance > 4) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(mouse, camera);
  const intersections = raycaster.intersectObjects(objects, false);
  selectObject(intersections.length ? intersections[0].object : null);
});
renderer.domElement.addEventListener('pointercancel', () => {
  clickStart = null;
  transformControls.pointerUp({ button: 0 });
});

// Keep the original test cube; creating it is not an undoable user action.
const cube = createMesh('Cube');
giveObjectName(cube, 'Cube');
objects.push(cube);
scene.add(cube);
selectObject(null);

function resizeRenderer() {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer();
function animate() {
  requestAnimationFrame(animate);
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
}
animate();
