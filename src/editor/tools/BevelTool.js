import * as THREE from 'three';
import { ModifierDragTool } from './ModifierDragTool.js';
export class BevelTool extends ModifierDragTool {
  constructor(editor) { super(editor,'bevel'); }
  updateLabel() {
    this.handle.textContent='↔ Bevel';
    this.handle.title='Drag right to chamfer all edges · left to reduce · Esc cancels';
  }
  getOptions(amount) {return {amount:THREE.MathUtils.clamp(amount*0.25,0,0.45)};}
  placeHandle(point,box) {point.copy(box.max);}
}
