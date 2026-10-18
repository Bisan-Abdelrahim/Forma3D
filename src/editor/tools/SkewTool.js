import * as THREE from 'three';
import { ModifierDragTool } from './ModifierDragTool.js';

export class SkewTool extends ModifierDragTool {
  constructor(editor) { super(editor, 'skew'); this.axis = 'x'; this.relativeTo = 'y'; }
  setAxes(axis, relativeTo) {
    if (this.dragging) return;
    if (!['x', 'y', 'z'].includes(axis) || !['x', 'y', 'z'].includes(relativeTo) || axis === relativeTo) throw new Error('Choose two different skew axes');
    this.axis = axis; this.relativeTo = relativeTo;
    this.updateLabel();
    this.editor.ui.updateButtons();
    this.update();
  }

  updateLabel() {
    const { axis, relativeTo } = this;
    if (this.handle) {
      this.handle.textContent = `↔ Skew ${axis.toUpperCase()}/${relativeTo.toUpperCase()}`;
      this.handle.title = `Drag left/right · local ${axis.toUpperCase()} relative to ${relativeTo.toUpperCase()} · Esc cancels`;
    }
  }
  getOptions(amount) { return {axis: this.axis, relativeTo: this.relativeTo, amount: THREE.MathUtils.clamp(amount, -10, 10)}; }
  placeHandle(point, box) { point[this.relativeTo] = box.max[this.relativeTo]; }
}
