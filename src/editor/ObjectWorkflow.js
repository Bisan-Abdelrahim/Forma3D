import * as THREE from 'three';

// Object-mode hierarchy, visibility and lock policy live in one place.
export class ObjectWorkflow {
  constructor(editor) { this.editor = editor; }
  busy() { return this.editor.mesh.editMode || this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction; }
  roots() { return this.editor.state.objects.filter(o => !this.editor.state.objects.includes(o.parent)); }
  visible(object) {
    for (let o = object; o && o !== this.editor.viewport.scene; o = o.parent) if (!o.visible) return false;
    return true;
  }
  unlocked(object) {
    for (let o = object; o && o !== this.editor.viewport.scene; o = o.parent) if (o.userData.locked) return false;
    return true;
  }
  editable(object) {
    return !!object && this.editor.state.objects.includes(object) && this.visible(object) && this.unlocked(object);
  }
  transformable(object) {
    if (!this.editable(object)) return false;
    return !object.isGroup || object.children.every(child => this.editable(child));
  }
  pickTarget(mesh) { return mesh.parent?.isGroup && this.editor.state.objects.includes(mesh.parent) ? mesh.parent : mesh; }
  group = () => {
    const e = this.editor, selected = e.state.selectedObjects;
    if (this.busy() || selected.length < 2 || selected.some(o => o.isGroup || o.parent !== e.viewport.scene || !this.editable(o))) return;
    const before = e.history.takeSnapshot();
    const group = new THREE.Group();
    e.objects.giveObjectName(group, 'Group');
    const box = new THREE.Box3();
    selected.forEach(o => box.expandByObject(o));
    box.getCenter(group.position);
    e.viewport.scene.add(group);
    e.viewport.scene.updateMatrixWorld(true);
    selected.forEach(o => group.attach(o));
    e.state.objects.push(group);
    e.selection.selectObject(group);
    e.history.recordAction(before);
  };
  ungroup = () => {
    const e = this.editor, group = e.state.selectedObject;
    if (this.busy() || e.state.selectedObjects.length !== 1 || !group?.isGroup || !this.transformable(group)) return;
    group.updateWorldMatrix(true, true);
    if (Math.abs(group.matrixWorld.determinant()) < 1e-10 || group.children.some(o => Math.abs(o.matrix.determinant()) < 1e-10)) return;
    const before = e.history.takeSnapshot();
    const children = [...group.children];
    e.selection.selectObject(null);
    e.viewport.scene.updateMatrixWorld(true);
    for (const child of children) {
      // Bake any shear from a rotated child under nonuniform group scale.
      // This preserves the visible surface while leaving ordinary editable TRS values.
      const world = child.matrixWorld.clone();
      e.viewport.scene.add(child);
      world.decompose(child.position, child.quaternion, child.scale);
      child.quaternion.normalize();
      child.updateMatrix();
      const residual = child.matrix.clone().invert().multiply(world);
      child.geometry.applyMatrix4(residual);
      child.geometry.computeBoundingBox();
      child.geometry.computeBoundingSphere();
    }
    group.removeFromParent();
    e.state.objects.splice(e.state.objects.indexOf(group), 1);
    e.selection.setSelection(children);
    e.history.recordAction(before);
  };
  toggle(object, property) {
    if (this.busy()) return;
    const before = this.editor.history.takeSnapshot();
    if (property === 'visible') object.visible = !object.visible;
    else object.userData.locked = !object.userData.locked;
    this.editor.selection.setSelection(this.editor.state.selectedObjects.filter(o => this.editable(o)));
    this.editor.history.recordAction(before);
  }
}
