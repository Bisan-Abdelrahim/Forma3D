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
    if (!!this.editor.modifiers?.transaction) return;
      if (!this.editor.state.selectedObject) return;

      const before = this.editor.history.takeSnapshot();

      const duplicate = this.createMesh(
        this.editor.state.selectedObject.userData.type,
        this.getDimensions(this.editor.state.selectedObject)
      );

      duplicate.geometry.dispose();
      duplicate.geometry = this.editor.state.selectedObject.geometry.clone();

      duplicate.geometry.parameters = {
        ...this.editor.state.selectedObject.geometry.parameters
      };

      this.giveObjectName(
        duplicate,
        this.editor.state.selectedObject.userData.type
      );

      duplicate.position
        .copy(this.editor.state.selectedObject.position)
        .add(new THREE.Vector3(1, 0, 1));

      duplicate.quaternion.copy(
        this.editor.state.selectedObject.quaternion
      );

      duplicate.scale.copy(
        this.editor.state.selectedObject.scale
      );

      this.editor.state.objects.push(duplicate);
      this.editor.viewport.scene.add(duplicate);

      this.editor.selection.selectObject(duplicate);
      this.editor.history.recordAction(before);
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
    if (!!this.editor.modifiers?.transaction) return;
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

    this.editor.selection.selectObject(object);
    this.editor.history.recordAction(before);

    return object;
  };

  deleteObject = (object) => {
    if (!!this.editor.modifiers?.transaction) return;
    if (!object) return;

    const index = this.editor.state.objects.indexOf(object);

    if (index === -1) {
      throw new Error('Object not found.');
    }

    const before = this.editor.history.takeSnapshot();

    if (this.editor.state.selectedObject === object) {
      this.editor.selection.selectObject(null);
    }

    this.editor.state.objects.splice(index, 1);
    this.editor.viewport.scene.remove(object);

    object.geometry.dispose();
    object.material.dispose();

    this.editor.ui.updateOutliner();
    this.editor.history.recordAction(before);
  };
}
