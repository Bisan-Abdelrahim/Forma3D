import * as THREE from 'three';

export class SelectionService {
  constructor(editor) {
    this.editor = editor;
    this.pivot = new THREE.Object3D();
  }
  selectObject = (object, toggle = false) => {
    const e = this.editor;
    if (e.mesh.editMode && object === e.state.selectedObject) return;
    if (toggle && e.mesh.editMode) return;
    if (object && e.workflow && !e.workflow.editable(object)) return;
    let selection = object ? [object] : [];
    if (toggle) {
      selection = [...e.state.selectedObjects];
      if (!object) return;
      const index = selection.indexOf(object);
      if (index >= 0) selection.splice(index, 1);
      else selection.push(object);
    }
    this.setSelection(selection);
  };
  setSelection(selection) {
    const e = this.editor;
    for (const name of ['skewTool','taperTool','extrudeTool','bendTool','insetTool','bevelTool']) {
      if (e[name]?.active) e[name].setActive(false);
    }
    if (e.mesh.editMode) {
      e.mesh.editMode = false;
      e.mesh.clearVertexMarkers();
      e.viewport.transformControls.setMode(e.mesh.previousObjectTransformMode);
    }
    // Never select a parent and its child at the same time.
    selection = selection.filter(o => !selection.includes(o.parent) && (!e.workflow || e.workflow.editable(o)));
    e.state.selectedObjects = selection;
    e.state.selectedObject = selection.at(-1) ?? null;
    for (const object of e.state.objects) if (object.isMesh) {
      const selected = selection.includes(object) || selection.includes(object.parent);
      object.material.color.setHex(selected ? e.state.selectedColor : e.state.originalColor);
    }
    const control = e.viewport.transformControls;
    control.detach();
    const allowed = selection.every(o => !e.workflow || e.workflow.transformable(o));
    if (selection.length === 1 && allowed) control.attach(selection[0]);
    if (selection.length > 1 && allowed) {
      const box = new THREE.Box3();
      selection.forEach(o => box.expandByObject(o));
      box.getCenter(this.pivot.position);
      selection.at(-1).getWorldQuaternion(this.pivot.quaternion);
      this.pivot.scale.setScalar(1);
      e.viewport.scene.add(this.pivot);
      this.pivot.updateMatrixWorld(true);
      control.attach(this.pivot);
    }
    e.ui.updateOutliner();
    e.ui.updateProperties();
    e.ui.updateButtons();
  }
  beginTransform() {
    if (this.editor.state.selectedObjects.length < 2) return;
    this.pivot.updateMatrixWorld(true);
    this.startInverse = this.pivot.matrixWorld.clone().invert();
    this.startMatrices = this.editor.state.selectedObjects.map(object => {
      object.updateWorldMatrix(true, false);
      return { object, world: object.matrixWorld.clone(), meshes: (object.isGroup ? object.children : [object]).map(mesh => ({ mesh, geometry: mesh.geometry.clone(), matrix: mesh.matrix.clone() })) };
    });
  }
  updateTransform() {
    if (!this.startMatrices) return;
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(this.startInverse);
    for (const { object, world, meshes } of this.startMatrices) {
      object.parent.updateWorldMatrix(true, false);
      const local = object.parent.matrixWorld.clone().invert().multiply(delta).multiply(world);
      local.decompose(object.position, object.quaternion, object.scale);
      object.quaternion.normalize();
      object.updateMatrix();
      // Nonuniform scaling in world space can create shear. Keep it in geometry,
      // rather than silently dropping it when decomposing into position/rotation/scale.
      const residual = object.matrix.clone().invert().multiply(local);
      for (const { mesh, geometry, matrix } of meshes) {
        const baked = object === mesh ? residual : matrix.clone().invert().multiply(residual).multiply(matrix);
        mesh.geometry.dispose();
        mesh.geometry = geometry.clone();
        mesh.geometry.parameters = { ...geometry.parameters };
        mesh.geometry.applyMatrix4(baked);
      }
      object.updateMatrixWorld(true);
    }
  }
  endTransform() {
    for (const entry of this.startMatrices ?? []) for (const saved of entry.meshes) saved.geometry.dispose();
    this.startMatrices = null;
  }
}
