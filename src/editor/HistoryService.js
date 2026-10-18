import * as THREE from 'three';
export class HistoryService {
  constructor(editor) {
      this.editor = editor;
      this.undoHistory = [];
      this.redoHistory = [];
  }

  undo = () => {
    if ((this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction)) return;
    const action = this.undoHistory.pop();
    if (!action) return;
    this.redoHistory.push(action);
    this.restoreSnapshot(action.before);
  };

  redo = () => {
    if ((this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction)) return;
    const action = this.redoHistory.pop();
    if (!action) return;
    this.undoHistory.push(action);
    this.restoreSnapshot(action.after);
  };

  takeSnapshot = () => {
    return {
      objects: this.editor.state.objects.map(object => ({
        id: object.userData.editorId,
        type: object.userData.type,
        name: object.name,

        dimensions: this.editor.objects.getDimensions(object),

        // Preserve cube deformation.
        vertexPositions:
          object.userData.type === 'Cube'
            ? Array.from(
                object.geometry.getAttribute('position').array
              )
            : null,

        topology: object.userData.type === 'Cube' ? {
          index: Array.from(object.geometry.index.array),
          uv: object.geometry.attributes.uv ? Array.from(object.geometry.attributes.uv.array) : null
        } : null,
        position: object.position.toArray(),
        rotation: object.rotation.toArray(),
        scale: object.scale.toArray()
      })),

      selectedId:
        this.editor.state.selectedObject?.userData.editorId ?? null,

      nameCounts: { ...this.editor.state.nameCounts },
      nextObjectId: this.editor.state.nextObjectId
    };
  };

  recordAction = (before) => {
    const after = this.takeSnapshot();

    if (
      JSON.stringify(before.objects) ===
      JSON.stringify(after.objects)
    ) {
      return;
    }

    this.undoHistory.push({ before, after });
    this.redoHistory.length = 0;

    this.editor.ui.updateButtons();
  };

  restoreSnapshot = (snapshot) => {
    // Exit Edit Mode before replacing meshes.
    this.editor.selection.selectObject(null);

    for (const object of this.editor.state.objects) {
      this.editor.viewport.scene.remove(object);
      object.geometry.dispose();
      object.material.dispose();
    }

    this.editor.state.objects.length = 0;

    Object.assign(this.editor.state.nameCounts, snapshot.nameCounts);
    this.editor.state.nextObjectId = snapshot.nextObjectId;

    for (const saved of snapshot.objects) {
      const object = this.editor.objects.createMesh(
        saved.type,
        saved.dimensions
      );

      if (saved.vertexPositions) {
        object.geometry.setAttribute('position', new THREE.Float32BufferAttribute(saved.vertexPositions, 3));
        if (saved.topology) {
          object.geometry.setIndex(saved.topology.index);
          if (saved.topology.uv) object.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(saved.topology.uv, 2));
          object.geometry.clearGroups();
        }
        object.geometry.deleteAttribute('normal');
        const positions = object.geometry.getAttribute('position');
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

      this.editor.state.objects.push(object);
      this.editor.viewport.scene.add(object);
    }

    this.editor.viewport.scene.updateMatrixWorld(true);

    const previousSelection = this.editor.state.objects.find(
      object =>
        object.userData.editorId === snapshot.selectedId
    );

    this.editor.selection.selectObject(previousSelection ?? null);
  };
}
