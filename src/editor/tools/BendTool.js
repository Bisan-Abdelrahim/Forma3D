import * as THREE from 'three';
import { ModifierDragTool } from './ModifierDragTool.js';

export class BendTool extends ModifierDragTool {
  constructor(editor) { super(editor, 'bend'); this.axis = 'y'; this.direction = 'x'; }
  setOptions(axis, direction) {
    if (this.dragging) return;
    if (!['x','y','z'].includes(axis) || !['x','y','z'].includes(direction) || axis === direction) throw new Error('Choose different Bend axes');
    this.axis = axis; this.direction = direction;
    this.updateLabel(); this.editor.ui.updateButtons(); this.update();
  }
  updateLabel() {
    if (!this.handle) return;
    this.handle.textContent = `↔ Bend ${this.axis.toUpperCase()}→${this.direction.toUpperCase()}`;
    this.handle.title = 'Drag left/right to bend · 120px = 90° · Esc cancels';
  }
  getOptions(amount) { return {axis:this.axis, direction:this.direction, angle:THREE.MathUtils.clamp(amount*90,-180,180)}; }
  placeHandle(point,box) { point[this.axis] = box.max[this.axis]; }
}
