import { materialSnapshot } from '../services/SceneSerializer.js';
import * as THREE from 'three';
export class HistoryService {
  constructor(editor) {
      this.editor = editor;
      this.undoHistory = [];
      this.redoHistory = [];
  }

  undo = () => {
    if (this.editor.readOnly || (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction)) return;
    const action = this.undoHistory.pop();
    if (!action) return;
    this.redoHistory.push(action);
    this.restoreSnapshot(action.before);
  };

  redo = () => {
    if (this.editor.readOnly || (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction)) return;
    const action = this.redoHistory.pop();
    if (!action) return;
    this.undoHistory.push(action);
    this.restoreSnapshot(action.after);
  };

  takeSnapshot = () => {
    return {
      objects: this.editor.state.objects.map(object => ({
        id: object.userData.editorId,
        persistentId: object.userData.persistentId,
        materials: object.isMesh ? [object.material].flat().map(material=>materialSnapshot(material,this.editor)) : [],
        type: object.userData.type,
        name: object.name,

        dimensions: object.isMesh ? this.editor.objects.getDimensions(object) : {},
        parentId: object.parent?.userData.editorId ?? null,
        visible: object.visible,
        locked: !!object.userData.locked,

        // Preserve mesh deformation, including shear baked while ungrouping.
        vertexPositions:
          object.isMesh
            ? Array.from(
                object.geometry.getAttribute('position').array
              )
            : null,

        topology: object.isMesh ? {
          index: Array.from(object.geometry.index.array),
          uv: object.geometry.attributes.uv ? Array.from(object.geometry.attributes.uv.array) : null
        } : null,
        position: object.position.toArray(),
        rotation: object.rotation.toArray(),
        scale: object.scale.toArray()
      })),

      selectedIds: this.editor.state.selectedObjects.map(o => o.userData.editorId),
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
    this.onChange?.();
  };

  restoreSnapshot = (snapshot) => {
    // Exit Edit Mode before replacing meshes.
    this.editor.selection.selectObject(null);

    for (const object of this.editor.state.objects) {
      object.removeFromParent();
      object.geometry?.dispose();
      [object.material].flat().forEach(material=>material?.dispose());
    }

    this.editor.state.objects.length = 0;

    Object.assign(this.editor.state.nameCounts, snapshot.nameCounts);
    this.editor.state.nextObjectId = snapshot.nextObjectId;

    for (const saved of snapshot.objects) {
      const object = saved.type === 'Group' ? new THREE.Group() : this.editor.objects.createMesh(saved.type, saved.dimensions);

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

      if (object.isMesh && saved.materials?.length) {
        object.material.dispose();
        const materials=saved.materials.map(json=>new THREE.MaterialLoader().parse(json));
        object.material=materials.length===1?materials[0]:materials;
      }
      object.name = saved.name;

      object.userData = {
        type: saved.type,
        editorId: saved.id,
        persistentId: saved.persistentId ?? crypto.randomUUID(),
        locked: saved.locked ?? false
      };

      object.visible = saved.visible ?? true;
      object.position.fromArray(saved.position);
      object.rotation.fromArray(saved.rotation);
      object.scale.fromArray(saved.scale);

      this.editor.state.objects.push(object);
      this.editor.viewport.scene.add(object);
    }

    for (const saved of snapshot.objects) {
      if (saved.parentId) {
        const object = this.editor.state.objects.find(o => o.userData.editorId === saved.id);
        const parent = this.editor.state.objects.find(o => o.userData.editorId === saved.parentId);
        parent.add(object);
      }
    }
    this.editor.views?.applyMaterials();
    this.editor.viewport.scene.updateMatrixWorld(true);

    const ids = snapshot.selectedIds ?? [snapshot.selectedId];
    this.editor.selection.setSelection(ids.map(id => this.editor.state.objects.find(o => o.userData.editorId === id)).filter(Boolean));
    this.onChange?.();
  };
}
