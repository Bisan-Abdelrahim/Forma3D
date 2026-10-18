import * as THREE from 'three';
import { FaceModifierTool } from './FaceModifierTool.js';

export class ExtrudeTool extends FaceModifierTool {
  constructor(editor) { super(editor, 'extrude'); }
  updateLabel() {
    this.handle.textContent = '↔ Extrude';
    this.handle.title = 'Drag right: outward · left: inward · Esc cancels';
  }
  getOptions(amount) { return {face: this.editor.mesh.selectedFaceIndex, amount: THREE.MathUtils.clamp(amount, -10, 10)}; }
}
