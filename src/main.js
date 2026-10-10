import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.position.set(5, 4, 5);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Register the gizmo first so it can disable camera input before a drag.
const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
scene.add(transformControls.getHelper());

// Use the same controls for moving, rotating, and scaling the selected cube.
window.addEventListener('keydown', (event) => {
  if (transformControls.dragging) return;

  const key = event.key.toLowerCase();
  if (key === 'm') {
    transformControls.setMode('translate');
  } else if (key === 'r') {
    transformControls.setMode('rotate');
  } else if (key === 's') {
    transformControls.setMode('scale');
  }
});

// Move the camera around the cube with the mouse.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = true;
controls.enablePan = true;

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});

const geometry = new THREE.BoxGeometry(2, 2, 2);
const material = new THREE.MeshBasicMaterial({
  color: 0x00ff88
});
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// Cast a ray from the camera through the clicked position.
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const originalColor = material.color.clone();
const selectedColor = new THREE.Color(0xccff33);
let clickStart = null;
let isDragging = false;

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;

  // A gizmo interaction must not change the current selection.
  if (transformControls.dragging || transformControls.axis !== null) {
    clickStart = null;
    return;
  }

  clickStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  isDragging = false;
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!clickStart || event.pointerId !== clickStart.pointerId) return;

  // Remember movement so an OrbitControls drag does not select the cube.
  const distance = Math.hypot(
    event.clientX - clickStart.x,
    event.clientY - clickStart.y
  );
  if (distance > 4) isDragging = true;
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (!clickStart || event.pointerId !== clickStart.pointerId) return;

  const distance = Math.hypot(
    event.clientX - clickStart.x,
    event.clientY - clickStart.y
  );
  clickStart = null;
  if (event.button !== 0 || isDragging || distance > 4) return;

  const bounds = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersections = raycaster.intersectObject(cube);
  const isSelected = intersections.length > 0;
  material.color.copy(isSelected ? selectedColor : originalColor);

  if (isSelected) {
    transformControls.attach(cube);
  } else {
    transformControls.detach();
  }
});

renderer.domElement.addEventListener('pointercancel', () => {
  clickStart = null;
});

// Keep the ground grid at the original bottom of the cube.
const grid = new THREE.GridHelper(20, 20);
grid.position.y = -1;
scene.add(grid);

const axes = new THREE.AxesHelper(3);
scene.add(axes);

// Keep the scene sized correctly when the browser window changes.
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
}

animate();



