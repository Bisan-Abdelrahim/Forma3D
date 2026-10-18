import * as THREE from 'three';
import { FaceModifierTool } from './FaceModifierTool.js';

export class InsetTool extends FaceModifierTool {
  constructor(editor) { super(editor, 'inset'); }
  updateLabel() {
    this.handle.textContent = '↔ Inset';
    this.handle.title = 'Drag right to shrink the inner face · left to reduce the inset · Esc cancels';
  }
  getOptions(amount) { return {face:this.editor.mesh.selectedFaceIndex, amount:THREE.MathUtils.clamp(amount,0,0.95)}; }
}
