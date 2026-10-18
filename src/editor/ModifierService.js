
export class ModifierService {
  constructor(editor) {
    this.editor = editor;
    this.modifiers = new Map();
  }

  register(name, modifier) {
    if (typeof modifier?.apply !== 'function') {
      throw new Error('Invalid modifier');
    }

    this.modifiers.set(name, modifier);
  }

  beginPreview(name, object = this.editor.state.selectedObject) {
    if (this.transaction || !this.modifiers.has(name) || !object?.isMesh ||
        object.userData.type !== 'Cube' || (['extrude','inset'].includes(name) ? !this.editor.mesh.editMode : this.editor.mesh.editMode) ||
        this.editor.viewport.transformControls.dragging) throw new Error('Cannot start modifier drag');
    this.transaction = { name, object, original: object.geometry,
      before: this.editor.history.takeSnapshot() };
  }

  preview(options) {
    const t = this.transaction;
    if (!t) throw new Error('No modifier drag');
    // Every frame starts from the captured geometry, never the last preview.
    const next = this.modifiers.get(t.name).apply(t.original, options);
    next.parameters = {...t.original.parameters};
    const previous = t.object.geometry;
    t.object.geometry = next;
    if (previous !== t.original) previous.dispose();
  }

  endPreview(commit) {
    const t = this.transaction;
    if (!t) return;
    this.transaction = null;
    const changed = t.object.geometry !== t.original;
    if (!commit) {
      if (changed) t.object.geometry.dispose();
      t.object.geometry = t.original;
    } else {
      if (changed && !this.editor.state.objects.some(o => o !== t.object && o.geometry === t.original)) t.original.dispose();
      this.editor.history.recordAction(t.before);
    }
  }

  apply(
  name,
  options = {},
  object = this.editor.state.selectedObject
) {
    if (this.transaction) throw new Error('Finish dragging before applying a modifier');
    const modifier = this.modifiers.get(name);

    if (!modifier) {
      throw new Error(`Unknown modifier: ${name}`);
    }

    // Temporary restriction until History supports
    // arbitrary mesh geometry.
    if (!object?.isMesh || object.userData.type !== 'Cube') {
      throw new Error('Modifiers currently support cubes only');
    }

    // Avoid modifying geometry while editing vertices.
    if (
      this.editor.mesh.editMode ||
      this.editor.viewport.transformControls.dragging
    ) {
      throw new Error('Switch to Object Mode first');
    }

    // Save state before modification.
    const before = this.editor.history.takeSnapshot();

    const oldGeometry = object.geometry;

    // Calculate new geometry.
    const newGeometry = modifier.apply(
      oldGeometry,
      options
    );

    if (
      !newGeometry?.isBufferGeometry ||
      newGeometry === oldGeometry
    ) {
      throw new Error(
        'Modifier must return a new BufferGeometry'
      );
    }

    newGeometry.parameters = {...oldGeometry.parameters};
    // Apply modified geometry.
    object.geometry = newGeometry;

    // Dispose old geometry if it is not shared.
    const isShared = this.editor.state.objects.some(
      item => item !== object &&
      item.geometry === oldGeometry
    );

    if (!isShared) {
      oldGeometry.dispose();
    }
    this.editor.selection.selectObject(object);

    // Save action for Undo / Redo.
    this.editor.history.recordAction(before);

    // Refresh properties.
    this.editor.ui.updateProperties();

    return true;
  }
}
