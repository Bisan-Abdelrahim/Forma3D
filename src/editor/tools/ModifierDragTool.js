import * as THREE from 'three';

// A projected HTML handle avoids fighting canvas selection and control raycasts.
// Horizontal screen distance controls modifier strength, including edge-on views.
export class ModifierDragTool {
  constructor(editor, name) { this.editor = editor; this.name = name; this.active = false; this.drag = null; }
  get dragging() { return this.drag !== null; }

  bind() {
    this.handle = document.createElement('button');
    this.handle.className = 'skew-handle';
    this.updateLabel();
    this.handle.hidden = true;
    this.editor.ui.viewport.appendChild(this.handle);
    this.events = new AbortController();
    const options = { signal: this.events.signal };
    this.handle.addEventListener('pointerdown', this.begin, options);
    this.handle.addEventListener('pointermove', this.move, options);
    this.handle.addEventListener('pointerup', this.end, options);
    this.handle.addEventListener('pointercancel', this.cancel, options);
    this.handle.addEventListener('lostpointercapture', this.cancel, options);
    window.addEventListener('blur', this.cancel, options);
    window.addEventListener('keydown', this.keydown, { ...options, capture: true });
  }

  canActivate() { return !this.editor.mesh.editMode; }

  toggle = () => this.setActive(!this.active);
  setActive(active) {
    this.cancel();
    const e = this.editor;
    if (active) for (const tool of [e.skewTool, e.taperTool, e.extrudeTool, e.bendTool, e.insetTool, e.bevelTool]) {
      if (tool && tool !== this && tool.active) tool.setActive(false);
    }
    this.active = active && this.canActivate() && !e.viewport.transformControls.dragging &&
      e.state.selectedObject?.userData.type === 'Cube';
    if (this.active) e.viewport.transformControls.detach();
    else if (e.state.selectedObject && !e.mesh.editMode) e.viewport.transformControls.attach(e.state.selectedObject);
    if (!this.active && e.mesh.editMode) e.mesh.updateVertexSelectionGizmo();
    this.update();
    e.ui.updateButtons();
  }

  begin = event => {
    if (event.button !== 0 || !this.active || this.dragging) return;
    event.preventDefault(); event.stopPropagation();
    this.handle.focus();
    const e = this.editor;
    this.handle.title = this.handle.title.split(' · Error:')[0];
    const status = document.getElementById('tool-status');
    if (status) status.textContent = '';
    e.modifiers.beginPreview(this.name);
    this.drag = { pointerId: event.pointerId, x: event.clientX, orbit: e.viewport.controls.enabled };
    e.viewport.controls.enabled = false;
    this.handle.setPointerCapture(event.pointerId);
    this.refreshUI();
  };
  move = event => {
    if (event.pointerId !== this.drag?.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    try {
      this.editor.modifiers.preview(this.getOptions((event.clientX - this.drag.x) / 120));
      this.afterPreview?.();
    } catch (error) { this.cancel(); this.handle.title += ` · Error: ${error.message}`;
      const status = document.getElementById('tool-status');
      if (status) status.textContent = error.message;
    }
  };
  end = event => {
    if (event.pointerId !== this.drag?.pointerId) return;
    this.move(event);
    if (!this.drag) return;
    this.finish(true);
  };
  cancel = () => { if (this.drag) this.finish(false); };
  finish(commit) {
    const drag = this.drag;
    this.drag = null; // Release can synchronously dispatch lostpointercapture.
    this.editor.modifiers.endPreview(commit);
    this.editor.viewport.controls.enabled = drag.orbit;
    if (this.handle.hasPointerCapture(drag.pointerId)) this.handle.releasePointerCapture(drag.pointerId);
    this.afterFinish?.();
    this.refreshUI();
  }
  keydown = event => {
    if (!this.active) return;
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.dragging) this.cancel(); else this.setActive(false);
    } else if (this.dragging) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  refreshUI() {
    this.editor.ui.updateButtons(); this.editor.ui.updateProperties(); this.editor.ui.updateOutliner();
  }
  update() {
    if (!this.handle) return;
    const e = this.editor, object = e.state.selectedObject;
    this.handle.hidden = !this.active || !object || !this.canActivate();
    if (this.handle.hidden) return;
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox;
    const point = box.getCenter(new THREE.Vector3());
    this.placeHandle(point, box);
    object.updateWorldMatrix(true, false);
    point.applyMatrix4(object.matrixWorld).project(e.viewport.camera);
    this.handle.hidden = point.z < -1 || point.z > 1;
    this.handle.style.left = `${(point.x + 1) * e.ui.viewport.clientWidth / 2}px`;
    this.handle.style.top = `${(1 - point.y) * e.ui.viewport.clientHeight / 2}px`;
  }
  dispose() {
    this.setActive(false); this.events?.abort(); this.handle?.remove();
  }
}
