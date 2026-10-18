import * as THREE from 'three';
import { ModifierDragTool } from './ModifierDragTool.js';
import { facePoints } from '../QuadTopology.js';

// Shared selection and marker lifecycle for tools that change one quad face.
export class FaceModifierTool extends ModifierDragTool {
  canActivate() {
    return this.editor.mesh.editMode && this.editor.mesh.meshSelectionMode === 'face' &&
      this.editor.mesh.selectedFaceIndex !== null;
  }
  placeHandle(point) {
    const points = facePoints(this.editor.state.selectedObject.geometry, this.editor.mesh.selectedFaceIndex);
    point.set(0,0,0); for (const p of points) point.add(p); point.multiplyScalar(0.25);
  }
  afterPreview() { this.editor.mesh.updateFaceHighlight(); }
  afterFinish() {
    const mesh = this.editor.mesh, face = mesh.selectedFaceIndex;
    mesh.showCubeVertices(this.editor.state.selectedObject);
    for (const marker of mesh.vertexMarkers) marker.visible = false;
    mesh.selectFaceByTriangle(face === null ? null : face * 2);
    if (this.active) this.editor.viewport.transformControls.detach();
  }
}
