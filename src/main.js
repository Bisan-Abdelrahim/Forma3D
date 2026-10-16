
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { requestCommand } from './ai.js';

// ===============================
// EDITOR UI
// ===============================

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
    <label>
      <input id="snap" type="checkbox">
      Snap movement (1 unit)
    </label>
  </header>
  <section id="ai-panel">
    <label for="ai-instruction">AI Command (Ollama)</label>

    <div class="ai-input-row">
      <textarea
        id="ai-instruction"
        rows="2"
        placeholder="Create a cube with width 4, height 2 and depth 3"
      ></textarea>

      <button id="ai-send">Send</button>
    </div>

    <p id="ai-status" role="status" aria-live="polite">
      Ready for your instruction.
    </p>
  </section>


  <main id="editor">
    <aside>
      <h2>Objects</h2>
      <div id="outliner"></div>
    </aside>

    <div id="viewport"></div>

    <aside>
      <h2>Properties</h2>
      <p id="selection-name">No selection</p>
      <div id="properties"></div>
    </aside>
  </main>
`;

const viewport = document.querySelector('#viewport');
const outliner = document.querySelector('#outliner');
const properties = document.querySelector('#properties');

// ===============================
// THREE.JS SCENE
// ===============================

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(5, 4, 5);

const renderer = new THREE.WebGLRenderer();
viewport.appendChild(renderer.domElement);

// Transform Controls
const transformControls = new TransformControls(
  camera,
  renderer.domElement
);

transformControls.setMode('translate');
scene.add(transformControls.getHelper());

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);

controls.enableDamping = true;
controls.enableZoom = true;
controls.enablePan = true;

// Grid and axes
const grid = new THREE.GridHelper(20, 20);
grid.position.y = -1;

scene.add(grid);
scene.add(new THREE.AxesHelper(3));

// ===============================
// EDITOR STATE
// ===============================

const objects = [];
let selectedObject = null;

const nameCounts = {
  Cube: 0,
  Sphere: 0,
  Cylinder: 0
};

let nextObjectId = 1;

const originalColor = 0x00ff88;
const selectedColor = 0xccff33;

const undoHistory = [];
const redoHistory = [];

let dragStartSnapshot = null;

// ===============================
// OBJECT CREATION
// ===============================

function createMesh(type, dimensions = {}) {
  let geometry;

  if (type === 'Cube') {
    geometry = new THREE.BoxGeometry(
      dimensions.width ?? 2,
      dimensions.height ?? 2,
      dimensions.depth ?? 2
    );

  } else if (type === 'Sphere') {
    geometry = new THREE.SphereGeometry(
      dimensions.radius ?? 1,
      24,
      16
    );

  } else if (type === 'Cylinder') {
    const radius = dimensions.radius ?? 1;

    geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      dimensions.height ?? 2,
      24
    );

  } else {
    throw new Error('Unsupported shape.');
  }

  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: originalColor
    })
  );
}

// Get object dimensions for Undo/Redo
function getDimensions(object) {
  const params = object.geometry.parameters;
  const type = object.userData.type;

  if (type === 'Cube') {
    return {
      width: params.width,
      height: params.height,
      depth: params.depth
    };
  }

  if (type === 'Sphere') {
    return {
      radius: params.radius
    };
  }

  return {
    radius: params.radiusTop,
    height: params.height
  };
}

// Give each object a unique name and ID
function giveObjectName(object, type) {
  nameCounts[type] += 1;

  object.name = `${type} ${nameCounts[type]}`;

  object.userData = {
    type,
    editorId: nextObjectId++
  };
}

// ===============================
// OBJECT SELECTION
// ===============================

function selectObject(object) {
  if (selectedObject) {
    selectedObject.material.color.setHex(originalColor);
  }

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

// ===============================
// OUTLINER
// ===============================

function updateOutliner() {
  outliner.replaceChildren();

  for (const object of objects) {
    const button = document.createElement('button');

    button.textContent = object.name;

    button.classList.toggle(
      'selected',
      object === selectedObject
    );

    button.setAttribute(
      'aria-pressed',
      String(object === selectedObject)
    );

    button.disabled = transformControls.dragging;

    button.addEventListener('click', () => {
      selectObject(object);
    });

    outliner.appendChild(button);
  }
}

// ===============================
// PROPERTIES PANEL
// ===============================

const propertyInputs = [];

for (const property of ['position', 'rotation', 'scale']) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');

  legend.textContent =
    property === 'rotation'
      ? 'Rotation (degrees)'
      : property;

  fieldset.appendChild(legend);

  for (const axis of ['x', 'y', 'z']) {
    const label = document.createElement('label');

    label.textContent = axis.toUpperCase();

    const input = document.createElement('input');

    input.type = 'number';
    input.step = property === 'rotation' ? '1' : '0.1';

    input.setAttribute(
      'aria-label',
      `${property} ${axis.toUpperCase()}`
    );

    label.appendChild(input);
    fieldset.appendChild(label);

    propertyInputs.push({
      input,
      property,
      axis
    });

    input.addEventListener('input', () => {
      if (
        !selectedObject ||
        transformControls.dragging ||
        input.value === '' ||
        !input.validity.valid
      ) {
        return;
      }

      const value = input.valueAsNumber;

      if (!Number.isFinite(value)) return;

      const before = takeSnapshot();

      selectedObject[property][axis] =
        property === 'rotation'
          ? THREE.MathUtils.degToRad(value)
          : value;

      selectedObject.updateMatrixWorld();

      recordAction(before);
    });

    input.addEventListener('blur', updateProperties);
  }

  properties.appendChild(fieldset);
}

function updateProperties() {
  document.querySelector('#selection-name').textContent =
    selectedObject
      ? selectedObject.name
      : 'No selection';

  for (const { input, property, axis } of propertyInputs) {
    input.disabled =
      !selectedObject || transformControls.dragging;

    if (!selectedObject) {
      input.value = '';
    } else {
      let value = selectedObject[property][axis];

      if (property === 'rotation') {
        value = THREE.MathUtils.radToDeg(value);
      }

      input.value = String(Number(value.toFixed(4)));
    }
  }
}

// ===============================
// UNDO / REDO SYSTEM
// ===============================

function takeSnapshot() {
  return {
    objects: objects.map(object => ({
      id: object.userData.editorId,
      type: object.userData.type,
      name: object.name,

      // Save geometry dimensions
      dimensions: getDimensions(object),

      position: object.position.toArray(),
      rotation: object.rotation.toArray(),
      scale: object.scale.toArray()
    })),

    selectedId:
      selectedObject?.userData.editorId ?? null,

    nameCounts: { ...nameCounts },
    nextObjectId
  };
}

function recordAction(before) {
  const after = takeSnapshot();

  if (
    JSON.stringify(before.objects) ===
    JSON.stringify(after.objects)
  ) {
    return;
  }

  undoHistory.push({
    before,
    after
  });

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
    // Restore the original geometry dimensions
    const object = createMesh(
      saved.type,
      saved.dimensions
    );

    object.name = saved.name;

    object.userData = {
      type: saved.type,
      editorId: saved.id
    };

    object.position.fromArray(saved.position);
    object.rotation.fromArray(saved.rotation);
    object.scale.fromArray(saved.scale);

    objects.push(object);
    scene.add(object);
  }

  scene.updateMatrixWorld(true);

  const previousSelection = objects.find(
    object =>
      object.userData.editorId === snapshot.selectedId
  );

  selectObject(previousSelection ?? null);
}

// ===============================
// TOOLBAR BUTTON STATES
// ===============================

function updateButtons() {
  const dragging = transformControls.dragging;

  for (const id of [
    'add-cube',
    'add-sphere',
    'add-cylinder',
    'snap'
  ]) {
    document.getElementById(id).disabled = dragging;
  }

  document.querySelector('#delete').disabled =
    dragging || !selectedObject;

  document.querySelector('#duplicate').disabled =
    dragging || !selectedObject;

  document.querySelector('#undo').disabled =
    dragging || undoHistory.length === 0;

  document.querySelector('#redo').disabled =
    dragging || redoHistory.length === 0;
}

// ===============================
// ADD OBJECT
// ===============================

function addObject(
  type,
  dimensions = {},
  position = {}
) {
  const before = takeSnapshot();

  const object = createMesh(type, dimensions);

  giveObjectName(object, type);

  object.position.set(
    position.x ?? 0,
    position.y ?? 0,
    position.z ?? 0
  );

  objects.push(object);
  scene.add(object);

  selectObject(object);
  recordAction(before);

  return object;
}

// Toolbar create buttons
for (const type of ['Cube', 'Sphere', 'Cylinder']) {
  document
    .getElementById(`add-${type.toLowerCase()}`)
    .addEventListener('click', () => {
      addObject(type);
    });
}

// ===============================
// DUPLICATE OBJECT
// ===============================

document.querySelector('#duplicate').addEventListener(
  'click',
  () => {
    if (!selectedObject) return;

    const before = takeSnapshot();

    const duplicate = createMesh(
      selectedObject.userData.type,
      getDimensions(selectedObject)
    );

    giveObjectName(
      duplicate,
      selectedObject.userData.type
    );

    duplicate.position
      .copy(selectedObject.position)
      .add(new THREE.Vector3(1, 0, 1));

    duplicate.quaternion.copy(
      selectedObject.quaternion
    );

    duplicate.scale.copy(
      selectedObject.scale
    );

    objects.push(duplicate);
    scene.add(duplicate);

    selectObject(duplicate);
    recordAction(before);
  }
);

// ===============================
// DELETE OBJECT
// ===============================

function deleteObject(object) {
  if (!object) return;

  const index = objects.indexOf(object);

  if (index === -1) {
    throw new Error('Object not found.');
  }

  const before = takeSnapshot();

  if (selectedObject === object) {
    selectObject(null);
  }

  objects.splice(index, 1);
  scene.remove(object);

  object.geometry.dispose();
  object.material.dispose();

  updateOutliner();
  recordAction(before);
}

// Toolbar delete button
document.querySelector('#delete').addEventListener(
  'click',
  () => {
    deleteObject(selectedObject);
  }
);

// ===============================
// AI COMMAND EXECUTION
// ===============================

function executeCommand(command) {
  if (transformControls.dragging) {
    throw new Error(
      'Finish dragging before using AI.'
    );
  }

  // CREATE
  if (command.action === 'create') {
    const types = {
      cube: 'Cube',
      sphere: 'Sphere',
      cylinder: 'Cylinder'
    };

    const type = types[command.shape];

    if (!type) {
      throw new Error('Unsupported shape.');
    }

    return addObject(
      type,
      command.dimensions ?? {},
      command.position ?? {}
    );
  }

  // FIND TARGET OBJECT
  let object;

  if (command.target === 'selected') {
    object = selectedObject;
  } else {
    object = objects.find(
      item =>
        item.userData.editorId === command.target
    );
  }

  if (!object) {
    throw new Error('Target object not found.');
  }

  // DELETE
  if (command.action === 'delete') {
    deleteObject(object);
    return;
  }

  // MOVE / ROTATE / SCALE
  const properties = {
    move: 'position',
    rotate: 'rotation',
    scale: 'scale'
  };

  const property = properties[command.action];

  if (!property) {
    throw new Error('Unsupported action.');
  }

  const before = takeSnapshot();

  for (
    const [axis, value] of
    Object.entries(command[property])
  ) {
    object[property][axis] =
      command.action === 'rotate'
        ? THREE.MathUtils.degToRad(value)
        : value;
  }

  object.updateMatrixWorld(true);

  selectObject(object);
  recordAction(before);

  return object;
}

// ===============================
// AI SCENE CONTEXT
// ===============================

function getSceneContext() {
  return {
    selectedId: selectedObject?.userData.editorId ?? null,

    objects: objects.map(object => ({
      id: object.userData.editorId,
      name: object.name,
      shape: object.userData.type.toLowerCase(),

      dimensions: getDimensions(object),

      position: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z
      },

      rotation: {
        x: THREE.MathUtils.radToDeg(object.rotation.x),
        y: THREE.MathUtils.radToDeg(object.rotation.y),
        z: THREE.MathUtils.radToDeg(object.rotation.z)
      },

      scale: {
        x: object.scale.x,
        y: object.scale.y,
        z: object.scale.z
      }
    }))
  };
}

// ===============================
// AI INPUT HANDLING
// ===============================

const aiInput = document.querySelector('#ai-instruction');
const aiSend = document.querySelector('#ai-send');
const aiStatus = document.querySelector('#ai-status');

let aiBusy = false;

async function sendAIInstruction() {
  const instruction = aiInput.value.trim();

  if (!instruction) {
    aiStatus.textContent = 'Please enter an instruction.';
    return;
  }

  if (aiBusy) return;

  if (transformControls.dragging) {
    aiStatus.textContent = 'Finish dragging first.';
    return;
  }

  aiBusy = true;
  aiSend.disabled = true;
  aiInput.disabled = true;

  aiStatus.textContent = 'Waiting for Ollama...';

  // Collect current objects before requesting AI
  const sceneContext = getSceneContext();

  try {
    // Step 1: Send user instruction to Ollama
    // Step 2: Receive and validate JSON in ai.js
    const command = await requestCommand(
      instruction,
      sceneContext
    );

    // Avoid applying an outdated command if the scene changed
    if (
      JSON.stringify(getSceneContext()) !==
      JSON.stringify(sceneContext)
    ) {
      throw new Error(
        'Scene changed while AI was processing. Please send again.'
      );
    }

    // Step 3: Execute the validated command
    const result = executeCommand(command);

    aiStatus.textContent =
      `Success: ${command.action}` +
      (result ? ` - ${result.name}` : '');

    console.log('AI command executed:', command);

  } catch (error) {
    console.error('Forma3D AI error:', error);

    aiStatus.textContent =
      `Error: ${error.message}`;

  } finally {
    aiBusy = false;
    aiSend.disabled = false;
    aiInput.disabled = false;
  }
}

// Send button
aiSend.addEventListener('click', sendAIInstruction);

// Press Enter to send, Shift+Enter for a new line
aiInput.addEventListener('keydown', event => {
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    sendAIInstruction();
  }
});

// ===============================
// UNDO / REDO BUTTONS
// ===============================

document.querySelector('#undo').addEventListener(
  'click',
  () => {
    const action = undoHistory.pop();

    if (!action) return;

    redoHistory.push(action);
    restoreSnapshot(action.before);
  }
);

document.querySelector('#redo').addEventListener(
  'click',
  () => {
    const action = redoHistory.pop();

    if (!action) return;

    undoHistory.push(action);
    restoreSnapshot(action.after);
  }
);

// ===============================
// SNAP TO GRID
// ===============================

document.querySelector('#snap').addEventListener(
  'change',
  event => {
    transformControls.setTranslationSnap(
      event.target.checked ? 1 : null
    );
  }
);

// ===============================
// KEYBOARD SHORTCUTS
// ===============================


window.addEventListener('keydown', event => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target.isContentEditable ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    transformControls.dragging
  ) {
    return;
  }

  if (event.code === 'KeyM') {
    transformControls.setMode('translate');
  }

  else if (event.code === 'KeyR') {
    transformControls.setMode('rotate');
  }

  else if (event.code === 'KeyS') {
    transformControls.setMode('scale');
  }
});


// ===============================
// TRANSFORM CONTROLS EVENTS
// ===============================

transformControls.addEventListener(
  'mouseDown',
  () => {
    dragStartSnapshot = takeSnapshot();
  }
);

transformControls.addEventListener(
  'objectChange',
  updateProperties
);

transformControls.addEventListener(
  'mouseUp',
  () => {
    if (dragStartSnapshot) {
      recordAction(dragStartSnapshot);
    }

    dragStartSnapshot = null;
  }
);

transformControls.addEventListener(
  'dragging-changed',
  event => {
    controls.enabled = !event.value;

    updateProperties();
    updateOutliner();
    updateButtons();
  }
);

// ===============================
// RAYCASTER SELECTION
// ===============================

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let clickStart = null;
let isDragging = false;

renderer.domElement.addEventListener(
  'pointerdown',
  event => {
    if (event.button !== 0) return;

    if (
      transformControls.dragging ||
      transformControls.axis !== null
    ) {
      clickStart = null;
      return;
    }

    clickStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId
    };

    isDragging = false;
  }
);

renderer.domElement.addEventListener(
  'pointermove',
  event => {
    if (
      !clickStart ||
      event.pointerId !== clickStart.pointerId
    ) {
      return;
    }

    if (
      Math.hypot(
        event.clientX - clickStart.x,
        event.clientY - clickStart.y
      ) > 4
    ) {
      isDragging = true;
    }
  }
);

renderer.domElement.addEventListener(
  'pointerup',
  event => {
    if (
      !clickStart ||
      event.pointerId !== clickStart.pointerId
    ) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - clickStart.x,
      event.clientY - clickStart.y
    );

    clickStart = null;

    if (
      event.button !== 0 ||
      isDragging ||
      distance > 4
    ) {
      return;
    }

    const bounds =
      renderer.domElement.getBoundingClientRect();

    mouse.x =
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1;

    mouse.y =
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

    scene.updateMatrixWorld(true);

    raycaster.setFromCamera(mouse, camera);

    const intersections = raycaster.intersectObjects(
      objects,
      false
    );

    selectObject(
      intersections.length
        ? intersections[0].object
        : null
    );
  }
);

renderer.domElement.addEventListener(
  'pointercancel',
  () => {
    clickStart = null;
    transformControls.pointerUp({ button: 0 });
  }
);

// ===============================
// INITIAL TEST CUBE
// ===============================

// This initial object is not an undoable action.
const cube = createMesh('Cube');

giveObjectName(cube, 'Cube');

objects.push(cube);
scene.add(cube);

selectObject(null);

// ===============================
// RESIZE HANDLING
// ===============================

function resizeRenderer() {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

window.addEventListener('resize', resizeRenderer);

resizeRenderer();

// ===============================
// ANIMATION LOOP
// ===============================

function animate() {
  requestAnimationFrame(animate);

  if (controls.enabled) {
    controls.update();
  }

  renderer.render(scene, camera);
}

animate();
