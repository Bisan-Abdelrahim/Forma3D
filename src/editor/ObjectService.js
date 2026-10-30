import { ShapeFactory } from './ShapeFactory.js';
import * as THREE from 'three';

export class ObjectService {
  constructor(editor, factory = new ShapeFactory()) {
      this.editor = editor;
      this.factory = factory;
  }

  createInitialObject() {
    const cube = this.createMesh('Cube');
    this.giveObjectName(cube, 'Cube');
    this.editor.state.objects.push(cube);
    this.editor.viewport.scene.add(cube);
    this.editor.selection.selectObject(null);
  }


  duplicateSelectedObject = () => {
    const e = this.editor, source = e.state.selectedObject;
    if (e.workflow.busy() || !e.workflow.transformable(source) || e.state.selectedObjects.length !== 1) return;
    const before = e.history.takeSnapshot();
    const copy = original => {
      const duplicate = original.isGroup ? new THREE.Group() : this.createMesh(original.userData.type, this.getDimensions(original));
      if (original.isMesh) {
        duplicate.geometry.dispose();
        duplicate.geometry = original.geometry.clone();
        duplicate.geometry.parameters = { ...original.geometry.parameters };
      }
      this.giveObjectName(duplicate, original.userData.type);
      duplicate.position.copy(original.position);
      duplicate.quaternion.copy(original.quaternion);
      duplicate.scale.copy(original.scale);
      duplicate.visible = original.visible;
      duplicate.userData.locked = !!original.userData.locked;
      e.state.objects.push(duplicate);
      if (original.isGroup) for (const child of original.children) duplicate.add(copy(child));
      return duplicate;
    };
    const duplicate = copy(source);
    source.parent.add(duplicate);
    duplicate.position.add(new THREE.Vector3(1, 0, 1));
    e.views.applyMaterials();
    e.selection.selectObject(duplicate);
    e.history.recordAction(before);
  };

  createMesh = (type, dimensions = {}) => this.factory.create(type, dimensions);

  getDimensions = object => this.factory.getDimensions(object);

  giveObjectName = (object, type) => {
    this.editor.state.nameCounts[type] += 1;

    object.name = `${type} ${this.editor.state.nameCounts[type]}`;

    object.userData = {
      type,
      editorId: this.editor.state.nextObjectId++
    };
  };

  addObject = (type, dimensions = {}, position = {}) => {
    if (this.editor.workflow.busy()) return;
    const before = this.editor.history.takeSnapshot();

    const object = this.createMesh(type);
    if (type === 'Cube') object.scale.set((dimensions.width ?? 2) / 2, (dimensions.height ?? 2) / 2, (dimensions.depth ?? 2) / 2);
    else if (type === 'Sphere') object.scale.setScalar(dimensions.radius ?? 1);
    else object.scale.set(dimensions.radius ?? 1, (dimensions.height ?? 2) / 2, dimensions.radius ?? 1);

    this.giveObjectName(object, type);

    object.position.set(
      position.x ?? 0,
      position.y ?? 0,
      position.z ?? 0
    );

    this.editor.state.objects.push(object);
    this.editor.viewport.scene.add(object);

    this.editor.views.applyMaterials();
    this.editor.selection.selectObject(object);
    this.editor.history.recordAction(before);

    return object;
  };

  deleteObject = (object) => {
    const e = this.editor;
    if (e.workflow.busy() || !e.workflow.transformable(object)) return;
    const before = e.history.takeSnapshot();
    const removed = object.isGroup ? [object, ...object.children] : [object];
    e.selection.setSelection(e.state.selectedObjects.filter(o => !removed.includes(o)));
    object.removeFromParent();
    for (const item of removed) {
      e.state.objects.splice(e.state.objects.indexOf(item), 1);
      item.geometry?.dispose();
      item.material?.dispose();
    }
    e.ui.updateOutliner();
    e.history.recordAction(before);
  };
}
