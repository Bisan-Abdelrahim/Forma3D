import * as THREE from 'three';

export class InputController {
  constructor(editor) { this.editor = editor; }

  setTransformMode(mode) {
    const e = this.editor;
    if (!['translate', 'rotate', 'scale'].includes(mode) || e.viewport.transformControls.dragging || e.modifiers?.transaction) return;
    for (const name of ['skewTool','taperTool','bendTool','bevelTool','extrudeTool','insetTool']) if (e[name]?.active) e[name].setActive(false);
    if (e.mesh.editMode) {
      e.mesh.editTransformMode = mode;
      e.mesh.updateVertexSelectionGizmo({preserveTransform: true});
    } else {
      e.viewport.transformControls.setMode(mode);
    }
    e.ui.updateButtons();
  }

  bind() {
    document.querySelector('#undo').addEventListener('click', this.editor.history.undo);
    document.querySelector('#redo').addEventListener('click', this.editor.history.redo);
    this.dragStartSnapshot = null;
    document.querySelector('#snap').addEventListener(
      'change',
      event => {
        this.editor.viewport.transformControls.setTranslationSnap(
          event.target.checked ? 1 : null
        );
      }
    );
    window.addEventListener('keydown', event => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction)
      ) {
        return;
      }

      if (event.code === 'KeyF') { this.editor.views.frameSelected(); return; }

      // Tab: Object / Edit Mode
      if (
        event.code === 'Tab' &&
        !event.shiftKey &&
        document.activeElement === this.editor.viewport.renderer.domElement &&
        (
          this.editor.mesh.editMode ||
          this.editor.state.selectedObject?.userData.type === 'Cube'
        )
      ) {
        event.preventDefault();
        this.editor.mesh.toggleEditMode();
        return;
      }

      const modes = { KeyM: 'translate', KeyR: 'rotate', KeyS: 'scale' };
      if (modes[event.code]) { this.setTransformMode(modes[event.code]); return; }

      // Mesh selection shortcuts
      if (this.editor.mesh.editMode) {
        if (event.code === 'Digit1') {
          this.editor.mesh.setMeshSelectionMode('vertex');

        } else if (event.code === 'Digit2') {
          this.editor.mesh.setMeshSelectionMode('edge');

        } else if (event.code === 'Digit3') {
          this.editor.mesh.setMeshSelectionMode('face');
        }

        return;
      }
    });
    this.editor.viewport.transformControls.addEventListener(
      'mouseDown',
      () => {
        this.dragStartSnapshot = this.editor.history.takeSnapshot();
        this.editor.selection.beginTransform();
        this.editor.mesh.beginVertexTransform();
      }
    );
    this.editor.viewport.transformControls.addEventListener(
      'objectChange',
      () => {
        this.editor.selection.updateTransform();
        // Works for Vertex / Edge / Face modes.
        this.editor.mesh.updateSelectedVertexGeometry();
        this.editor.ui.updateProperties();
      }
    );
    this.editor.viewport.transformControls.addEventListener(
      'mouseUp',
      () => {
        if (this.dragStartSnapshot) {
          this.editor.history.recordAction(this.dragStartSnapshot);
        }

        this.dragStartSnapshot = null;
        this.editor.selection.endTransform();
        this.editor.mesh.endVertexTransform();
      }
    );
    this.editor.viewport.transformControls.addEventListener(
      'dragging-changed',
      event => {
        this.editor.viewport.controls.enabled = !event.value;

        this.editor.ui.updateProperties();
        this.editor.ui.updateOutliner();
        this.editor.ui.updateButtons();
      }
    );
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.clickStart = null;
    this.isDragging = false;
    this.editor.viewport.renderer.domElement.addEventListener(
      'pointerdown',
      event => {
        if (event.button !== 0) return;

        this.editor.viewport.renderer.domElement.focus();

        if (
          (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction) ||
          this.editor.viewport.transformControls.axis !== null
        ) {
          this.clickStart = null;
          return;
        }

        this.clickStart = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId
        };

        this.isDragging = false;
      }
    );
    this.editor.viewport.renderer.domElement.addEventListener(
      'pointermove',
      event => {
        if (
          !this.clickStart ||
          event.pointerId !== this.clickStart.pointerId
        ) {
          return;
        }

        if (
          Math.hypot(
            event.clientX - this.clickStart.x,
            event.clientY - this.clickStart.y
          ) > 4
        ) {
          this.isDragging = true;
        }
      }
    );
    this.editor.viewport.renderer.domElement.addEventListener(
      'pointerup',
      event => {
        if (
          !this.clickStart ||
          event.pointerId !== this.clickStart.pointerId
        ) {
          return;
        }

        const distance = Math.hypot(
          event.clientX - this.clickStart.x,
          event.clientY - this.clickStart.y
        );

        this.clickStart = null;

        if (
          event.button !== 0 ||
          this.isDragging ||
          distance > 4
        ) {
          return;
        }

        const bounds =
          this.editor.viewport.renderer.domElement.getBoundingClientRect();

        this.mouse.x =
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1;

        this.mouse.y =
          -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

        this.editor.viewport.scene.updateMatrixWorld(true);
        this.raycaster.setFromCamera(this.mouse, this.editor.viewport.camera);

        // ======================================
        // MESH EDIT MODE SELECTION
        // ======================================

        if (this.editor.mesh.editMode) {
          const multiSelect = !!(event.ctrlKey || event.metaKey || event.shiftKey);

          // EDGE MODE
          if (this.editor.mesh.meshSelectionMode === 'edge') {
            const edgeHits = this.raycaster.intersectObjects(
              this.editor.mesh.edgeMarkers,
              false
            );

            this.editor.mesh.selectEdgeMarker(
              edgeHits.length > 0
                ? edgeHits[0].object
                : null,
              multiSelect
            );
          }

          // VERTEX MODE
          else if (this.editor.mesh.meshSelectionMode === 'vertex') {
            const vertexHits = this.raycaster.intersectObjects(
              this.editor.mesh.vertexMarkers,
              false
            );

            this.editor.mesh.selectVertexMarker(
              vertexHits.length > 0 ? vertexHits[0].object : null,
              multiSelect
            );
          }

          // FACE MODE
          else if (this.editor.mesh.meshSelectionMode === 'face') {
            // Test only the cube mesh, not its children.
            const faceHits = this.raycaster.intersectObject(
              this.editor.state.selectedObject,
              false
            );

            const triangleIndex =
              faceHits.length > 0
                ? faceHits[0].faceIndex
                : null;

            this.editor.mesh.selectFaceByTriangle(triangleIndex, multiSelect);
          }

          return;
        }

        // ======================================
        // OBJECT MODE SELECTION
        // ======================================

        const intersections = this.raycaster.intersectObjects(
          this.editor.state.objects.filter(o => o.isMesh && this.editor.workflow.editable(o)),
          false
        );

        this.editor.selection.selectObject(
          intersections.length > 0
            ? this.editor.workflow.pickTarget(intersections[0].object)
            : null,
          !!(event.ctrlKey || event.metaKey || event.shiftKey)
        );
      }
    );
    this.editor.viewport.renderer.domElement.addEventListener(
      'pointercancel',
      () => {
        this.clickStart = null;

        this.editor.viewport.transformControls.pointerUp({
          button: 0
        });
      }
    );
  }
}
