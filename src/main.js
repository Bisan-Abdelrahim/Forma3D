
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { requestCommand } from './ai.js';

// ==========================================
// FORMA3D - EDITOR UI
// ==========================================

document.querySelector('#app').innerHTML = `
  <header id="toolbar">
    <strong>Forma3D</strong>

    <button id="add-cube">Add Cube</button>
    <button id="add-sphere">Add Sphere</button>
    <button id="add-cylinder">Add Cylinder</button>

    <button id="duplicate">Duplicate</button>
    <button id="edit-mode">Edit Mode (Tab)</button>

    <button id="vertex-mode">Vertex (1)</button>
    <button id="edge-mode">Edge (2)</button>

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

// ==========================================
// THREE.JS SCENE
// ==========================================

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  1,
  0.1,
  1000
);

camera.position.set(5, 4, 5);

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.domElement.tabIndex = 0;

viewport.appendChild(renderer.domElement);

// Transform Controls
const transformControls = new TransformControls(
  camera,
  renderer.domElement
);

transformControls.setMode('translate');
scene.add(transformControls.getHelper());

// Orbit Controls
const controls = new OrbitControls(
  camera,
  renderer.domElement
);

controls.enableDamping = true;
controls.enableZoom = true;
controls.enablePan = true;

// Grid and axes
const grid = new THREE.GridHelper(20, 20);
grid.position.y = -1;

scene.add(grid);
scene.add(new THREE.AxesHelper(3));

// ==========================================
// EDITOR STATE
// ==========================================

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

// ==========================================
// MESH EDIT MODE STATE
// ==========================================

let editMode = false;

let meshSelectionMode = 'vertex';

let previousObjectTransformMode = 'translate';

// Vertex markers
let vertexMarkers = [];

const selectedVertexMarkers = new Set();

// Invisible pivot for moving selected vertices
const vertexPivot = new THREE.Object3D();

const previousPivotPosition = new THREE.Vector3();

// Edge markers
const edgeMarkers = [];

let selectedEdgeMarker = null;

// ==========================================
// VERTEX MATERIALS
// ==========================================

const vertexMarkerGeometry = new THREE.SphereGeometry(
  0.09,
  12,
  8
);

const vertexMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0xff8800,
  depthTest: false,
  depthWrite: false
});

const selectedVertexMaterial = new THREE.MeshBasicMaterial({
  color: 0x00bfff,
  depthTest: false,
  depthWrite: false
});

// ==========================================
// EDGE MATERIALS
// ==========================================

const edgeMarkerGeometry = new THREE.CylinderGeometry(
  0.065,
  0.065,
  1,
  8
);

const edgeMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0xff8800,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide
});

const selectedEdgeMaterial = new THREE.MeshBasicMaterial({
  color: 0x00bfff,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide
});

const edgeUpDirection = new THREE.Vector3(0, 1, 0);

// ==========================================
// UPDATE VERTEX SELECTION GIZMO
// ==========================================

function updateVertexSelectionGizmo() {
  // Update colors of vertex markers
  for (const marker of vertexMarkers) {
    marker.material = selectedVertexMarkers.has(marker)
      ? selectedVertexMaterial
      : vertexMarkerMaterial;
  }

  // No vertices selected
  if (
    !editMode ||
    !selectedObject ||
    selectedVertexMarkers.size === 0
  ) {
    transformControls.detach();
    vertexPivot.removeFromParent();
    return;
  }

  // Find the center of selected vertices
  const center = new THREE.Vector3();

  for (const marker of selectedVertexMarkers) {
    center.add(marker.position);
  }

  center.divideScalar(selectedVertexMarkers.size);

  // Attach pivot to selected object
  if (vertexPivot.parent !== selectedObject) {
    vertexPivot.removeFromParent();
    selectedObject.add(vertexPivot);
  }

  vertexPivot.position.copy(center);

  previousPivotPosition.copy(center);

  // Show movement arrows at selection center
  transformControls.setMode('translate');
  transformControls.attach(vertexPivot);
}

// ==========================================
// VERTEX SELECTION
// ==========================================

function selectVertexMarker(marker, multiSelect = false) {
  if (!editMode || meshSelectionMode !== 'vertex') {
    return;
  }

  // Normal click clears previous selection
  if (!multiSelect) {
    selectedVertexMarkers.clear();
  }

  if (marker) {
    // Shift + click toggles vertex selection
    if (
      multiSelect &&
      selectedVertexMarkers.has(marker)
    ) {
      selectedVertexMarkers.delete(marker);
    } else {
      selectedVertexMarkers.add(marker);
    }
  }

  updateVertexSelectionGizmo();
}

// ==========================================
// CLEAR EDGE MARKERS
// ==========================================

function clearEdgeMarkers() {
  selectedEdgeMarker = null;

  for (const edge of edgeMarkers) {
    edge.removeFromParent();
  }

  edgeMarkers.length = 0;
}

// ==========================================
// CLEAR VERTEX MARKERS
// ==========================================

function clearVertexMarkers() {
  selectedVertexMarkers.clear();

  clearEdgeMarkers();

  transformControls.detach();

  vertexPivot.removeFromParent();

  for (const marker of vertexMarkers) {
    marker.parent?.remove(marker);
  }

  vertexMarkers = [];
}

// ==========================================
// SHOW CUBE VERTICES
// ==========================================

function showCubeVertices(object) {
  clearVertexMarkers();

  if (
    !object ||
    object.userData.type !== 'Cube'
  ) {
    return;
  }

  const positions =
    object.geometry.getAttribute('position');

  // BoxGeometry has 24 position entries,
  // representing 8 geometric corners.
  const vertexGroups = new Map();

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    const key = [
      x.toFixed(5),
      y.toFixed(5),
      z.toFixed(5)
    ].join(',');

    if (!vertexGroups.has(key)) {
      vertexGroups.set(key, {
        position: new THREE.Vector3(x, y, z),
        indices: []
      });
    }

    vertexGroups.get(key).indices.push(i);
  }

  for (const group of vertexGroups.values()) {
    const marker = new THREE.Mesh(
      vertexMarkerGeometry,
      vertexMarkerMaterial
    );

    marker.position.copy(group.position);

    marker.userData.vertexIndices = group.indices;

    marker.renderOrder = 10;

    object.add(marker);

    vertexMarkers.push(marker);
  }
}

// ==========================================
// UPDATE EDGE MARKERS
// ==========================================

function updateEdgeMarkers() {
  for (const edge of edgeMarkers) {
    const start =
      edge.userData.startMarker.position;

    const end =
      edge.userData.endMarker.position;

    const direction = new THREE.Vector3().subVectors(
      end,
      start
    );

    const length = direction.length();

    if (length < 0.000001) {
      edge.visible = false;
      continue;
    }

    edge.visible = true;

    // Position edge at its midpoint
    edge.position.copy(start)
      .add(end)
      .multiplyScalar(0.5);

    // Rotate cylinder along the edge
    edge.quaternion.setFromUnitVectors(
      edgeUpDirection,
      direction.normalize()
    );

    // Match edge length
    edge.scale.set(1, length, 1);
  }
}

// ==========================================
// SHOW CUBE EDGES
// ==========================================

function showCubeEdges() {
  clearEdgeMarkers();

  if (
    !selectedObject ||
    selectedObject.userData.type !== 'Cube'
  ) {
    return;
  }

  const positions =
    selectedObject.geometry.getAttribute('position');

  // Current version supports a standard BoxGeometry
  // with one segment per dimension.
  if (positions.count !== 24) {
    console.warn(
      'Unsupported cube topology for Edge Mode.'
    );
    return;
  }

  // Map geometry indices to corner markers
  const markerByIndex = new Map();

  for (const marker of vertexMarkers) {
    for (const index of marker.userData.vertexIndices) {
      markerByIndex.set(index, marker);
    }
  }

  // Four perimeter edges of each quad face
  // Avoid the internal triangle diagonal.
  const perimeterPairs = [
    [0, 1],
    [1, 3],
    [3, 2],
    [2, 0]
  ];

  const addedEdges = new Set();

  // BoxGeometry contains 6 faces,
  // each represented by 4 position entries.
  for (let faceStart = 0; faceStart < 24; faceStart += 4) {
    for (const [aOffset, bOffset] of perimeterPairs) {
      const startMarker = markerByIndex.get(
        faceStart + aOffset
      );

      const endMarker = markerByIndex.get(
        faceStart + bOffset
      );

      if (!startMarker || !endMarker) {
        continue;
      }

      if (startMarker === endMarker) {
        continue;
      }

      const startId =
        vertexMarkers.indexOf(startMarker);

      const endId =
        vertexMarkers.indexOf(endMarker);

      // The same physical edge belongs to two faces,
      // so create it only once.
      const edgeKey = [startId, endId]
        .sort((a, b) => a - b)
        .join(':');

      if (addedEdges.has(edgeKey)) {
        continue;
      }

      addedEdges.add(edgeKey);

      const edge = new THREE.Mesh(
        edgeMarkerGeometry,
        edgeMarkerMaterial
      );

      edge.userData.startMarker = startMarker;
      edge.userData.endMarker = endMarker;

      edge.renderOrder = 9;

      selectedObject.add(edge);

      edgeMarkers.push(edge);
    }
  }

  updateEdgeMarkers();
}

// ==========================================
// EDGE SELECTION
// ==========================================

function selectEdgeMarker(edge) {
  if (!editMode || meshSelectionMode !== 'edge') {
    return;
  }

  selectedEdgeMarker = edge;

  // Clear previous vertex selection
  selectedVertexMarkers.clear();

  if (edge) {
    // Selecting an edge means selecting its 2 endpoints
    selectedVertexMarkers.add(
      edge.userData.startMarker
    );

    selectedVertexMarkers.add(
      edge.userData.endMarker
    );
  }

  // Highlight selected edge
  for (const item of edgeMarkers) {
    item.material =
      item === selectedEdgeMarker
        ? selectedEdgeMaterial
        : edgeMarkerMaterial;
  }

  // Use the existing multi-vertex movement system
  updateVertexSelectionGizmo();
}

// ==========================================
// SWITCH VERTEX / EDGE MODE
// ==========================================

function setMeshSelectionMode(mode) {
  if (
    !editMode ||
    transformControls.dragging ||
    mode === meshSelectionMode
  ) {
    return;
  }

  if (
    mode !== 'vertex' &&
    mode !== 'edge'
  ) {
    return;
  }

  meshSelectionMode = mode;

  // Reset previous selection
  selectedVertexMarkers.clear();
  selectedEdgeMarker = null;

  updateVertexSelectionGizmo();

  if (mode === 'edge') {
    // Hide vertex markers
    for (const marker of vertexMarkers) {
      marker.visible = false;
    }

    showCubeEdges();

  } else {
    // Return to Vertex Mode
    clearEdgeMarkers();

    for (const marker of vertexMarkers) {
      marker.visible = true;
    }
  }

  updateButtons();
}

document.querySelector('#vertex-mode').addEventListener(
  'click',
  () => setMeshSelectionMode('vertex')
);

document.querySelector('#edge-mode').addEventListener(
  'click',
  () => setMeshSelectionMode('edge')
);

// ==========================================
// UPDATE SELECTED VERTEX GEOMETRY
// ==========================================

function updateSelectedVertexGeometry() {
  if (
    !editMode ||
    !selectedObject ||
    selectedVertexMarkers.size === 0 ||
    vertexPivot.parent !== selectedObject
  ) {
    return;
  }

  // Calculate how far the movement gizmo moved
  const delta = new THREE.Vector3().subVectors(
    vertexPivot.position,
    previousPivotPosition
  );

  if (delta.lengthSq() < 1e-16) {
    return;
  }

  const geometry = selectedObject.geometry;

  const positions =
    geometry.getAttribute('position');

  // Move all selected geometric corners
  for (const marker of selectedVertexMarkers) {
    marker.position.add(delta);

    const indices =
      marker.userData.vertexIndices;

    // Keep duplicate BoxGeometry positions together
    for (const index of indices) {
      positions.setXYZ(
        index,
        marker.position.x,
        marker.position.y,
        marker.position.z
      );
    }
  }

  // Store latest pivot position
  previousPivotPosition.copy(vertexPivot.position);

  // Refresh geometry
  positions.needsUpdate = true;

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Refresh edge visuals after deformation
  if (meshSelectionMode === 'edge') {
    updateEdgeMarkers();
  }
}

// ==========================================
// TOGGLE OBJECT / EDIT MODE
// ==========================================

function toggleEditMode() {
  if (transformControls.dragging) {
    return;
  }

  if (editMode) {
    // Exit Edit Mode
    editMode = false;

    clearVertexMarkers();

    transformControls.setMode(
      previousObjectTransformMode
    );

    if (selectedObject) {
      transformControls.attach(selectedObject);
    }

  } else {
    // Mesh Edit Mode currently supports cubes
    if (
      !selectedObject ||
      selectedObject.userData.type !== 'Cube'
    ) {
      return;
    }

    previousObjectTransformMode =
      transformControls.getMode();

    editMode = true;

    // Always enter in Vertex Mode
    meshSelectionMode = 'vertex';

    transformControls.detach();
    transformControls.setMode('translate');

    showCubeVertices(selectedObject);
  }

  updateProperties();
  updateButtons();
}

document.querySelector('#edit-mode').addEventListener(
  'click',
  toggleEditMode
);

// ==========================================
// OBJECT CREATION
// ==========================================

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

// ==========================================
// GET GEOMETRY DIMENSIONS
// ==========================================

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

// ==========================================
// OBJECT NAMING
// ==========================================

function giveObjectName(object, type) {
  nameCounts[type] += 1;

  object.name = `${type} ${nameCounts[type]}`;

  object.userData = {
    type,
    editorId: nextObjectId++
  };
}

// ==========================================
// OBJECT SELECTION
// ==========================================

function selectObject(object) {
  // Keep selection if clicking the same object
  // while working in Edit Mode
  if (editMode && object === selectedObject) {
    return;
  }

  // Exit Edit Mode if another object is selected
  if (editMode && object !== selectedObject) {
    editMode = false;

    clearVertexMarkers();

    transformControls.setMode(
      previousObjectTransformMode
    );
  }

  if (selectedObject) {
    selectedObject.material.color.setHex(originalColor);
  }

  selectedObject = object;

  if (object) {
    object.material.color.setHex(selectedColor);

    if (!editMode) {
      transformControls.attach(object);
    }

  } else {
    transformControls.detach();
  }

  updateOutliner();
  updateProperties();
  updateButtons();
}

// ==========================================
// OUTLINER
// ==========================================

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

// ==========================================
// PROPERTIES PANEL
// ==========================================

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

    input.step =
      property === 'rotation' ? '1' : '0.1';

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
        editMode ||
        transformControls.dragging ||
        input.value === '' ||
        !input.validity.valid
      ) {
        return;
      }

      const value = input.valueAsNumber;

      if (!Number.isFinite(value)) {
        return;
      }

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
      !selectedObject ||
      editMode ||
      transformControls.dragging;

    if (!selectedObject) {
      input.value = '';
    } else {
      let value = selectedObject[property][axis];

      if (property === 'rotation') {
        value = THREE.MathUtils.radToDeg(value);
      }

      input.value = String(
        Number(value.toFixed(4))
      );
    }
  }
}

// ==========================================
// UNDO / REDO SNAPSHOT SYSTEM
// ==========================================

function takeSnapshot() {
  return {
    objects: objects.map(object => ({
      id: object.userData.editorId,
      type: object.userData.type,
      name: object.name,

      dimensions: getDimensions(object),

      // Save actual cube geometry for mesh edits
      vertexPositions:
        object.userData.type === 'Cube'
          ? Array.from(
              object.geometry.getAttribute('position').array
            )
          : null,

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
  // Reset Edit Mode before restoring geometry
  selectObject(null);

  for (const object of objects) {
    scene.remove(object);

    object.geometry.dispose();
    object.material.dispose();
  }

  objects.length = 0;

  Object.assign(
    nameCounts,
    snapshot.nameCounts
  );

  nextObjectId = snapshot.nextObjectId;

  for (const saved of snapshot.objects) {
    const object = createMesh(
      saved.type,
      saved.dimensions
    );

    // Restore edited mesh positions
    if (saved.vertexPositions) {
      const positions =
        object.geometry.getAttribute('position');

      positions.array.set(saved.vertexPositions);
      positions.needsUpdate = true;

      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
    }

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

// ==========================================
// TOOLBAR BUTTON STATES
// ==========================================

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

  // Edit Mode button
  const editButton =
    document.querySelector('#edit-mode');

  editButton.disabled =
    dragging ||
    (
      !editMode &&
      selectedObject?.userData.type !== 'Cube'
    );

  editButton.textContent = editMode
    ? 'Object Mode (Tab)'
    : 'Edit Mode (Tab)';

  editButton.setAttribute(
    'aria-pressed',
    String(editMode)
  );

  // Vertex and Edge buttons
  const vertexModeButton =
    document.querySelector('#vertex-mode');

  const edgeModeButton =
    document.querySelector('#edge-mode');

  vertexModeButton.disabled =
    !editMode || dragging;

  edgeModeButton.disabled =
    !editMode || dragging;

  vertexModeButton.setAttribute(
    'aria-pressed',
    String(editMode && meshSelectionMode === 'vertex')
  );

  edgeModeButton.setAttribute(
    'aria-pressed',
    String(editMode && meshSelectionMode === 'edge')
  );
}

// ==========================================
// ADD OBJECT
// ==========================================

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

// Add buttons
for (const type of ['Cube', 'Sphere', 'Cylinder']) {
  document
    .getElementById(`add-${type.toLowerCase()}`)
    .addEventListener('click', () => {
      addObject(type);
    });
}

// ==========================================
// DUPLICATE OBJECT
// ==========================================

document.querySelector('#duplicate').addEventListener(
  'click',
  () => {
    if (!selectedObject) {
      return;
    }

    const before = takeSnapshot();

    const duplicate = createMesh(
      selectedObject.userData.type,
      getDimensions(selectedObject)
    );

    // Preserve edited geometry
    duplicate.geometry.dispose();

    duplicate.geometry =
      selectedObject.geometry.clone();

    duplicate.geometry.parameters = {
      ...selectedObject.geometry.parameters
    };

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

// ==========================================
// DELETE OBJECT
// ==========================================

function deleteObject(object) {
  if (!object) {
    return;
  }

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

document.querySelector('#delete').addEventListener(
  'click',
  () => {
    deleteObject(selectedObject);
  }
);

// ==========================================
// AI COMMAND EXECUTION
// ==========================================

function executeCommand(command) {
  if (transformControls.dragging) {
    throw new Error(
      'Finish dragging before using AI.'
    );
  }

  if (editMode) {
    throw new Error(
      'Exit Edit Mode before using AI commands.'
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

  // FIND TARGET
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

// ==========================================
// AI SCENE CONTEXT
// ==========================================

function getSceneContext() {
  return {
    selectedId:
      selectedObject?.userData.editorId ?? null,

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

// ==========================================
// AI INPUT HANDLING
// ==========================================

const aiInput =
  document.querySelector('#ai-instruction');

const aiSend =
  document.querySelector('#ai-send');

const aiStatus =
  document.querySelector('#ai-status');

let aiBusy = false;

async function sendAIInstruction() {
  const instruction = aiInput.value.trim();

  if (!instruction) {
    aiStatus.textContent =
      'Please enter an instruction.';
    return;
  }

  if (aiBusy) {
    return;
  }

  if (editMode) {
    aiStatus.textContent =
      'Exit Edit Mode before using AI.';
    return;
  }

  if (transformControls.dragging) {
    aiStatus.textContent =
      'Finish dragging first.';
    return;
  }

  aiBusy = true;

  aiSend.disabled = true;
  aiInput.disabled = true;

  aiStatus.textContent = 'Waiting for Ollama...';

  const sceneContext = getSceneContext();

  try {
    const command = await requestCommand(
      instruction,
      sceneContext
    );

    if (
      JSON.stringify(getSceneContext()) !==
      JSON.stringify(sceneContext)
    ) {
      throw new Error(
        'Scene changed while AI was processing. Please send again.'
      );
    }

    const result = executeCommand(command);

    aiStatus.textContent =
      `Success: ${command.action}` +
      (result ? ` - ${result.name}` : '');

    console.log(
      'AI command executed:',
      command
    );

  } catch (error) {
    console.error(
      'Forma3D AI error:',
      error
    );

    aiStatus.textContent =
      `Error: ${error.message}`;

  } finally {
    aiBusy = false;

    aiSend.disabled = false;
    aiInput.disabled = false;
  }
}

aiSend.addEventListener(
  'click',
  sendAIInstruction
);

// Enter sends, Shift+Enter adds a line
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

// ==========================================
// UNDO / REDO BUTTONS
// ==========================================

document.querySelector('#undo').addEventListener(
  'click',
  () => {
    const action = undoHistory.pop();

    if (!action) {
      return;
    }

    redoHistory.push(action);

    restoreSnapshot(action.before);
  }
);

document.querySelector('#redo').addEventListener(
  'click',
  () => {
    const action = redoHistory.pop();

    if (!action) {
      return;
    }

    undoHistory.push(action);

    restoreSnapshot(action.after);
  }
);

// ==========================================
// SNAP MOVEMENT
// ==========================================

document.querySelector('#snap').addEventListener(
  'change',
  event => {
    transformControls.setTranslationSnap(
      event.target.checked ? 1 : null
    );
  }
);

// ==========================================
// KEYBOARD SHORTCUTS
// ==========================================

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

  // Tab switches Object / Edit Mode
  if (
    event.code === 'Tab' &&
    !event.shiftKey &&
    document.activeElement === renderer.domElement &&
    (
      editMode ||
      selectedObject?.userData.type === 'Cube'
    )
  ) {
    event.preventDefault();

    toggleEditMode();

    return;
  }

  // Mesh Edit Mode shortcuts
  if (editMode) {
    if (event.code === 'Digit1') {
      setMeshSelectionMode('vertex');

    } else if (event.code === 'Digit2') {
      setMeshSelectionMode('edge');
    }

    return;
  }

  // Object Mode shortcuts
  if (event.code === 'KeyM') {
    transformControls.setMode('translate');

  } else if (event.code === 'KeyR') {
    transformControls.setMode('rotate');

  } else if (event.code === 'KeyS') {
    transformControls.setMode('scale');
  }
});

// ==========================================
// TRANSFORM CONTROLS EVENTS
// ==========================================

transformControls.addEventListener(
  'mouseDown',
  () => {
    // Snapshot before dragging
    dragStartSnapshot = takeSnapshot();
  }
);

transformControls.addEventListener(
  'objectChange',
  () => {
    // Applies to Vertex and Edge Mode
    updateSelectedVertexGeometry();

    updateProperties();
  }
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

// ==========================================
// RAYCASTER SELECTION
// ==========================================

const raycaster = new THREE.Raycaster();

const mouse = new THREE.Vector2();

let clickStart = null;
let isDragging = false;

renderer.domElement.addEventListener(
  'pointerdown',
  event => {
    if (event.button !== 0) {
      return;
    }

    renderer.domElement.focus();

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

    // ======================================
    // MESH EDIT MODE SELECTION
    // ======================================

    if (editMode) {
      // EDGE MODE
      if (meshSelectionMode === 'edge') {
        const edgeHits = raycaster.intersectObjects(
          edgeMarkers,
          false
        );

        selectEdgeMarker(
          edgeHits.length > 0
            ? edgeHits[0].object
            : null
        );

      } else {
        // VERTEX MODE
        const vertexHits = raycaster.intersectObjects(
          vertexMarkers,
          false
        );

        if (vertexHits.length > 0) {
          selectVertexMarker(
            vertexHits[0].object,
            event.shiftKey
          );

        } else if (!event.shiftKey) {
          selectVertexMarker(null);
        }
      }

      return;
    }

    // ======================================
    // OBJECT MODE SELECTION
    // ======================================

    const intersections = raycaster.intersectObjects(
      objects,
      false
    );

    selectObject(
      intersections.length > 0
        ? intersections[0].object
        : null
    );
  }
);

renderer.domElement.addEventListener(
  'pointercancel',
  () => {
    clickStart = null;

    transformControls.pointerUp({
      button: 0
    });
  }
);

// ==========================================
// INITIAL TEST CUBE
// ==========================================

const cube = createMesh('Cube');

giveObjectName(cube, 'Cube');

objects.push(cube);

scene.add(cube);

selectObject(null);

// ==========================================
// RESIZE HANDLING
// ==========================================

function resizeRenderer() {
  const width = Math.max(
    1,
    viewport.clientWidth
  );

  const height = Math.max(
    1,
    viewport.clientHeight
  );

  camera.aspect = width / height;

  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

window.addEventListener(
  'resize',
  resizeRenderer
);

resizeRenderer();

// ==========================================
// ANIMATION LOOP
// ==========================================

function animate() {
  requestAnimationFrame(animate);

  if (controls.enabled) {
    controls.update();
  }

  renderer.render(scene, camera);
}

animate();
