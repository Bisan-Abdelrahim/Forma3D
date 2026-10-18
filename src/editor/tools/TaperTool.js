import * as THREE from 'three';
import { ModifierDragTool } from './ModifierDragTool.js';

export class TaperTool extends ModifierDragTool {
  constructor(editor) { super(editor, 'taper'); this.axis = 'y'; this.side = 'positive'; }
  setOptions(axis, end) {
    if (this.dragging) return;
    if (!['x', 'y', 'z'].includes(axis) || !['positive', 'negative'].includes(end)) throw new Error('Invalid taper direction');
    this.axis = axis; this.side = end;
    this.updateLabel(); this.editor.ui.updateButtons(); this.update();
  }
  updateLabel() {
    if (!this.handle) return;
    this.handle.textContent = `↔ Taper ${this.side === 'positive' ? '+' : '−'}${this.axis.toUpperCase()}`;
    this.handle.title = 'Drag left to narrow, right to widen · Esc cancels';
  }
  getOptions(amount) {
    return {axis: this.axis, end: this.side, amount: THREE.MathUtils.clamp(amount, -0.95, 3)};
  }
  placeHandle(point, box) { point[this.axis] = box[this.side === 'positive' ? 'max' : 'min'][this.axis]; }
}
