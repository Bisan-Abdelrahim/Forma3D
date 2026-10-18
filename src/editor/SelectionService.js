export class SelectionService {
  constructor(editor) { this.editor = editor; }

  selectObject = (object) => {
    if (this.editor.skewTool?.active) this.editor.skewTool.setActive(false);
    if (this.editor.taperTool?.active) this.editor.taperTool.setActive(false);
    if (this.editor.extrudeTool?.active) this.editor.extrudeTool.setActive(false);
    if (this.editor.bendTool?.active) this.editor.bendTool.setActive(false);
    if (this.editor.insetTool?.active) this.editor.insetTool.setActive(false);
    if (this.editor.bevelTool?.active) this.editor.bevelTool.setActive(false);
    // Clicking the same object in Edit Mode
    // should not reset the mesh selection.
    if (this.editor.mesh.editMode && object === this.editor.state.selectedObject) {
      return;
    }

    if (this.editor.mesh.editMode && object !== this.editor.state.selectedObject) {
      this.editor.mesh.editMode = false;

      this.editor.mesh.clearVertexMarkers();

      this.editor.viewport.transformControls.setMode(
        this.editor.mesh.previousObjectTransformMode
      );
    }

    if (this.editor.state.selectedObject) {
      this.editor.state.selectedObject.material.color.setHex(this.editor.state.originalColor);
    }

    this.editor.state.selectedObject = object;

    if (object) {
      object.material.color.setHex(this.editor.state.selectedColor);

      if (!this.editor.mesh.editMode) {
        this.editor.viewport.transformControls.attach(object);
      }
    } else {
      this.editor.viewport.transformControls.detach();
    }

    this.editor.ui.updateOutliner();
    this.editor.ui.updateProperties();
    this.editor.ui.updateButtons();
  };
}
