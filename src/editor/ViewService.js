import * as THREE from 'three';

export class ViewService {
  constructor(editor) {
    this.editor = editor;
    this.mode = 'solid';
    this.materialDefaults = new WeakMap();
  }
  busy() { return this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction; }
  bind() {
    const e = this.editor;
    document.getElementById('group').addEventListener('click', e.workflow.group);
    document.getElementById('ungroup').addEventListener('click', e.workflow.ungroup);
    document.getElementById('frame-selected').addEventListener('click', () => this.frameSelected());
    document.getElementById('transform-space').addEventListener('change', event => {
      if (!this.busy()) e.viewport.transformControls.setSpace(event.target.value);
    });
    for (const [id, method] of [['translation-snap','setTranslationSnap'], ['rotation-snap','setRotationSnap'], ['scale-snap','setScaleSnap']]) {
      document.getElementById(id).addEventListener('change', event => {
        if (this.busy()) return;
        const value = Number(event.target.value);
        e.viewport.transformControls[method](value ? (id === 'rotation-snap' ? THREE.MathUtils.degToRad(value) : value) : null);
        if (id === 'translation-snap') document.getElementById('snap').checked = value === 1;
      });
    }
    document.getElementById('view-preset').addEventListener('change', event => this.setPreset(event.target.value));
    document.getElementById('view-mode').addEventListener('change', event => {
      this.mode = event.target.value;
      this.applyMaterials();
    });
  }
  applyMaterials() {
    for (const object of this.editor.state.objects) if (object.isMesh) {
      const material = object.material;
      if (!this.materialDefaults.has(material)) this.materialDefaults.set(material, {
        wireframe: material.wireframe, transparent: material.transparent,
        opacity: material.opacity, depthWrite: material.depthWrite
      });
      Object.assign(material, this.materialDefaults.get(material));
      if (this.mode === 'wireframe') material.wireframe = true;
      if (this.mode === 'xray') { material.transparent = true; material.opacity = 0.3; material.depthWrite = false; }
      material.needsUpdate = true;
    }
  }
  setPreset(preset) {
    if (this.busy()) return;
    const v = this.editor.viewport;
    const damping = v.controls.enableDamping;
    v.controls.enableDamping = false;
    v.controls.update();
    const target = v.controls.target.clone();
    const distance = Math.max(v.camera.position.distanceTo(target), 5);
    let camera;
    if (preset === 'perspective') {
      camera = v.perspectiveCamera;
      camera.up.set(0, 1, 0);
      camera.position.copy(target).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(distance));
    } else {
      const directions = { front: [0,0,1], back: [0,0,-1], left: [-1,0,0], right: [1,0,0], top: [0,1,0], bottom: [0,-1,0] };
      camera = v.orthographicCamera;
      v.orthoHeight = Math.max(2, 2 * distance * Math.tan(THREE.MathUtils.degToRad(v.perspectiveCamera.fov / 2)));
      camera.zoom = 1;
      camera.up.set(0, preset === 'top' || preset === 'bottom' ? 0 : 1, preset === 'top' ? -1 : preset === 'bottom' ? 1 : 0);
      camera.position.copy(target).add(new THREE.Vector3(...directions[preset]).multiplyScalar(distance));
    }
    // Share the active camera with orbiting, picking and the transform gizmo.
    v.camera = camera;
    v.controls.object = camera;
    v.transformControls.camera = camera;
    camera.lookAt(target);
    v.controls.target.copy(target);
    v.controls.update();
    v.controls.enableDamping = damping;
    v.resizeRenderer();
  }
  frameSelected = () => {
    if (this.busy() || !this.editor.state.selectedObjects.length) return;
    const box = new THREE.Box3();
    for (const object of this.editor.state.selectedObjects) box.expandByObject(object);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const v = this.editor.viewport, camera = v.camera;
    const radius = Math.max(sphere.radius, 0.1);
    const direction = camera.position.clone().sub(v.controls.target).normalize();
    if (!direction.lengthSq()) direction.set(1, 0.8, 1).normalize();
    const damping = v.controls.enableDamping;
    v.controls.enableDamping = false;
    v.controls.update();
    v.controls.target.copy(sphere.center);
    if (camera.isPerspectiveCamera) {
      const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
      const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.2;
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      camera.far = Math.max(1000, distance + radius * 4);
    } else {
      const aspect = Math.max(0.01, this.editor.ui.viewport.clientWidth / this.editor.ui.viewport.clientHeight);
      v.orthoHeight = radius * 2.4 / Math.min(1, aspect);
      camera.zoom = 1;
      const distance = radius * 3 + 5;
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      camera.far = Math.max(1000, distance + radius * 4);
    }
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    v.resizeRenderer();
    v.controls.update();
    v.controls.enableDamping = damping;
  };
}
