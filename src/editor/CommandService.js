import * as THREE from 'three';
import { validateCommand } from '../ai.js';

export class CommandService {
  constructor(editor) { this.editor = editor; }

  executeCommand = (command) => {
    validateCommand(command);
    if ((this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction)) {
      throw new Error(
        'Finish dragging before using AI.'
      );
    }

    if (this.editor.mesh.editMode) {
      throw new Error(
        'Exit Edit Mode before using AI commands.'
      );
    }

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

      return this.editor.objects.addObject(
        type,
        command.dimensions ?? {},
        command.position ?? {}
      );
    }

    let object;

    if (command.target === 'selected') {
      object = this.editor.state.selectedObject;
    } else {
      object = this.editor.state.objects.find(
        item =>
          item.userData.editorId === command.target
      );
    }

    if (!object) {
      throw new Error('Target object not found.');
    }

    if (command.action === 'delete') {
      this.editor.objects.deleteObject(object);
      return;
    }


if (command.action === 'bend') {
  this.editor.modifiers.apply('bend', {axis:command.axis, direction:command.direction, angle:command.angle}, object);
  return object;
}
if (command.action === 'taper') {
  this.editor.modifiers.apply('taper', {axis: command.axis, end: command.end, amount: command.amount}, object);
  return object;
}
if (command.action === 'skew') {
  this.editor.modifiers.apply(
    'skew',
    {
      axis: command.axis,
      relativeTo: command.relativeTo,
      amount: command.amount
    },
    object
  );

  return object;
}


    const properties = {
      move: 'position',
      rotate: 'rotation',
      scale: 'scale'
    };

    const property = properties[command.action];

    if (!property) {
      throw new Error('Unsupported action.');
    }

    const before = this.editor.history.takeSnapshot();

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

    this.editor.selection.selectObject(object);
    this.editor.history.recordAction(before);

    return object;
  };

  getSceneContext = () => {
    return {
      selectedId:
        this.editor.state.selectedObject?.userData.editorId ?? null,

      objects: this.editor.state.objects.map(object => ({
        id: object.userData.editorId,
        name: object.name,
        shape: object.userData.type.toLowerCase(),

        dimensions: this.editor.objects.getDimensions(object),

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
  };
}
