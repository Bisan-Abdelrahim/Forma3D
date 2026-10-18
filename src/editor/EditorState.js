export class EditorState {
  constructor() {
    this.objects = [];
    this.selectedObject = null;
    this.nameCounts = {
      Cube: 0,
      Sphere: 0,
      Cylinder: 0
    };
    this.nextObjectId = 1;
    this.originalColor = 0x00ff88;
    this.selectedColor = 0xccff33;
  }
}
