import * as THREE from 'three';
import { ModifierDragTool } from './ModifierDragTool.js';
export class BevelTool extends ModifierDragTool {
  constructor(editor) { super(editor,'bevel'); }
  canActivate() {
    const e = this.editor, mesh = e.mesh;
    return e.state.selectedObjects.length === 1 && e.workflow.transformable(e.state.selectedObject) &&
      e.state.selectedObject?.userData.type === 'Cube' &&
      (!mesh.editMode || (mesh.meshSelectionMode === 'edge' && mesh.selectedEdgeMarkers.size > 0));
  }
  get modifierName() { return this.editSelection ? 'edgeBevel' : 'bevel'; }
  updateLabel() {
    const selected = this.editor.mesh.editMode;
    this.handle.textContent = selected ? '↔ Bevel edges' : '↔ Bevel';
    this.handle.title = selected ? 'Drag right to chamfer selected edges · left to reduce · Esc cancels'
      : 'Drag right to chamfer all edges · left to reduce · Esc cancels';
  }
  beforeBegin() {
    const mesh = this.editor.mesh;
    this.editSelection = mesh.editMode;
    this.sourceEdges = [...mesh.selectedEdgeMarkers].map(edge => [
      edge.userData.startMarker.userData.vertexIndices[0],
      edge.userData.endMarker.userData.vertexIndices[0]
    ]);
  }
  getOptions(amount) {
    return {amount: THREE.MathUtils.clamp(amount * 0.25, 0, 0.45),
      ...(this.editSelection ? {edges: this.sourceEdges} : {})};
  }
  placeHandle(point, box) {
    const mesh = this.editor.mesh;
    if (!mesh.editMode) { point.copy(box.max); return; }
    point.set(0, 0, 0);
    for (const marker of mesh.selectedVertexMarkers) point.add(marker.position);
    if (mesh.selectedVertexMarkers.size) point.divideScalar(mesh.selectedVertexMarkers.size);
  }
  afterPreview() {
    if (!this.editSelection) return;
    // Original marker indices remain valid for every non-cumulative preview.
    // Hide those helpers while the preview has different topology.
    for (const marker of [...this.editor.mesh.vertexMarkers, ...this.editor.mesh.edgeMarkers]) marker.visible = false;
  }
  afterFinish() {
    if (!this.editSelection) return;
    const geometry = this.editor.state.selectedObject.geometry;
    const selection = geometry.userData.bevelEdgeIndices ?? this.sourceEdges;
    delete geometry.userData.bevelEdgeIndices;
    this.editor.mesh.rebuildEdgeSelection(selection);
  }
}
