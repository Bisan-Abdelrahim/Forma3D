import * as THREE from 'three';

export class EditorUI {
  constructor(editor) { this.editor = editor; }

  bindToolbar() {
    document.getElementById('bevel-tool').addEventListener('click',this.editor.bevelTool.toggle);
    document.getElementById('inset-tool').addEventListener('click', this.editor.insetTool.toggle);
    document.getElementById('bend-tool').addEventListener('click', this.editor.bendTool.toggle);
    for (const field of ['axis','direction']) document.getElementById(`bend-${field}`).addEventListener('change', event => {
      const tool = this.editor.bendTool;
      let axis = field === 'axis' ? event.target.value : tool.axis;
      let direction = field === 'direction' ? event.target.value : tool.direction;
      if (axis === direction) { if (field === 'axis') direction = tool.axis; else axis = tool.direction; }
      tool.setOptions(axis,direction);
    });
    document.getElementById('extrude-tool').addEventListener('click', this.editor.extrudeTool.toggle);
    document.getElementById('taper-tool').addEventListener('click', this.editor.taperTool.toggle);
    for (const field of ['axis', 'end']) document.getElementById(`taper-${field}`).addEventListener('change', event => {
      const tool = this.editor.taperTool;
      tool.setOptions(field === 'axis' ? event.target.value : tool.axis, field === 'end' ? event.target.value : tool.side);
    });
    for (const field of ['axis', 'relativeTo']) {
      document.getElementById(`skew-${field}`).addEventListener('change', event => {
        const tool = this.editor.skewTool;
        let axis = field === 'axis' ? event.target.value : tool.axis;
        let relativeTo = field === 'relativeTo' ? event.target.value : tool.relativeTo;
        // Swap axes if the newly chosen one matches the other selector.
        if (axis === relativeTo) {
          if (field === 'axis') relativeTo = tool.axis;
          else axis = tool.relativeTo;
        }
        tool.setAxes(axis, relativeTo);
      });
    }
    document.querySelector('#skew-tool').addEventListener('click', this.editor.skewTool.toggle);

    for (const type of ['Cube', 'Sphere', 'Cylinder']) {
      document
        .getElementById(`add-${type.toLowerCase()}`)
        .addEventListener('click', () => {
          this.editor.objects.addObject(type);
        });
    }
    document.querySelector('#duplicate').addEventListener('click', this.editor.objects.duplicateSelectedObject);
    document.querySelector('#delete').addEventListener(
      'click',
      () => this.editor.objects.deleteObject(this.editor.state.selectedObject)
    );

    document.querySelector('#vertex-mode').addEventListener(
      'click',
      () => this.editor.mesh.setMeshSelectionMode('vertex')
    );
    document.querySelector('#edge-mode').addEventListener(
      'click',
      () => this.editor.mesh.setMeshSelectionMode('edge')
    );
    document.querySelector('#face-mode').addEventListener(
      'click',
      () => this.editor.mesh.setMeshSelectionMode('face')
    );
    document.querySelector('#edit-mode').addEventListener(
      'click',
      this.editor.mesh.toggleEditMode
    );
  }

  bindProperties() {
    this.propertyInputs = [];
    for (const property of ['position', 'rotation', 'scale']) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');

      legend.textContent =
        property === 'rotation'
          ? 'Rotation (degrees)'
          : property;

      fieldset.appendChild(legend);

      for (const axis of ['x', 'y', 'z']) {
        const label = document.createElement('label');

        label.textContent = axis.toUpperCase();

        const input = document.createElement('input');

        input.type = 'number';

        input.step =
          property === 'rotation' ? '1' : '0.1';

        input.setAttribute(
          'aria-label',
          `${property} ${axis.toUpperCase()}`
        );

        label.appendChild(input);
        fieldset.appendChild(label);

        this.propertyInputs.push({
          input,
          property,
          axis
        });

        input.addEventListener('input', () => {
          if (
            !this.editor.state.selectedObject ||
            this.editor.mesh.editMode ||
            (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction) ||
            input.value === '' ||
            !input.validity.valid
          ) {
            return;
          }

          const value = input.valueAsNumber;

          if (!Number.isFinite(value)) {
            return;
          }

          const before = this.editor.history.takeSnapshot();

          this.editor.state.selectedObject[property][axis] =
            property === 'rotation'
              ? THREE.MathUtils.degToRad(value)
              : value;

          this.editor.state.selectedObject.updateMatrixWorld();

          this.editor.history.recordAction(before);
        });

        input.addEventListener('blur', this.updateProperties);
      }

      this.properties.appendChild(fieldset);
    }
  }

  mount() {
    document.querySelector('#app').innerHTML = `
      <header id="toolbar">
        <strong>Forma3D</strong>
        <div class="toolbar-group" role="group" aria-label="Add objects"><button id="add-cube">Add Cube</button><button id="add-sphere">Add Sphere</button><button id="add-cylinder">Add Cylinder</button></div>
        <div class="toolbar-group" role="group" aria-label="Object actions"><button id="edit-mode">Edit Mode (Tab)</button><button id="duplicate">Duplicate</button><button id="delete">Delete</button></div>
        <div class="toolbar-group" role="group" aria-label="History"><button id="undo">Undo</button><button id="redo">Redo</button></div>
      </header>
      <nav id="tool-shelf" aria-label="Modeling tools">
        <div id="object-tools" class="toolbar-group"><span class="group-label">Shape</span><button id="skew-tool" title="Drag the handle left/right. Esc cancels." aria-pressed="false">Skew</button><button id="taper-tool" aria-pressed="false">Taper</button><button id="bend-tool" aria-pressed="false">Bend</button><button id="bevel-tool" title="Chamfer all edges of an unsubdivided cube">Bevel</button></div>
        <div id="mesh-tools" class="toolbar-group" hidden><span class="group-label">Select</span><button id="vertex-mode">Vertex (1)</button><button id="edge-mode">Edge (2)</button><button id="face-mode">Face (3)</button><span class="group-label">Face tools</span><button id="inset-tool" title="Select a face in Edit Mode, then drag right">Inset</button><button id="extrude-tool" title="Edit Mode → Face → select a face, then drag the handle">Extrude</button></div>
        <div id="tool-options"><span id="skew-axes" hidden>
          <label title="Local axis to move">Tilt <select id="skew-axis" aria-label="Skew displacement axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
          <label title="Local axis the tilt varies along">along <select id="skew-relativeTo" aria-label="Skew reference axis"><option value="x">X</option><option value="y" selected>Y</option><option value="z">Z</option></select></label>
        </span><span id="taper-options" hidden>
          <label>Axis <select id="taper-axis" aria-label="Taper axis"><option value="x">X</option><option value="y" selected>Y</option><option value="z">Z</option></select></label>
          <label>End <select id="taper-end" aria-label="Taper end"><option value="positive">+ end</option><option value="negative">− end</option></select></label>
        </span><span id="bend-options" hidden>
          <label>Along <select id="bend-axis" aria-label="Bend length axis"><option value="x">X</option><option value="y" selected>Y</option><option value="z">Z</option></select></label>
          <label>Toward <select id="bend-direction" aria-label="Bend direction"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
        </span></div>
        <label class="snap-label"><input id="snap" type="checkbox"> Snap (1 unit)</label>
      </nav>
      <p id="tool-status" role="status" aria-live="polite"></p>
      <details id="ai-drawer"><summary>AI assistant <span>Optional · Ollama</span></summary>
      <section id="ai-panel">
        <label for="ai-instruction">AI Command (Ollama)</label>

        <div class="ai-input-row">
          <textarea
            id="ai-instruction"
            rows="2"
            maxlength="2000"
            placeholder="Create a cube with width 4, height 2 and depth 3"
          ></textarea>

          <button id="ai-send">Send</button>
        </div>

        <p id="ai-status" role="status" aria-live="polite">
          Ready for your instruction.
        </p>
      </section>

      </details>
      <main id="editor">
        <aside>
          <h2>Objects</h2>
          <div id="outliner"></div>
        </aside>

        <div id="viewport"></div>

        <aside>
          <h2>Properties</h2>
          <p id="selection-name">No selection</p>
          <div id="properties"></div>
        </aside>
      </main>
    `;

    this.viewport = document.querySelector('#viewport');
    this.outliner = document.querySelector('#outliner');
    this.properties = document.querySelector('#properties');
  }

  updateOutliner = () => {
    this.outliner.replaceChildren();

    for (const object of this.editor.state.objects) {
      const button = document.createElement('button');

      button.textContent = object.name;

      button.classList.toggle(
        'selected',
        object === this.editor.state.selectedObject
      );

      button.setAttribute(
        'aria-pressed',
        String(object === this.editor.state.selectedObject)
      );

      button.disabled = (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction);

      button.addEventListener('click', () => {
        this.editor.selection.selectObject(object);
      });

      this.outliner.appendChild(button);
    }
  };

  updateProperties = () => {
    document.querySelector('#selection-name').textContent =
      this.editor.state.selectedObject
        ? this.editor.state.selectedObject.name
        : 'No selection';

    for (const { input, property, axis } of this.propertyInputs) {
      input.disabled =
        !this.editor.state.selectedObject ||
        this.editor.mesh.editMode ||
        (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction);

      if (!this.editor.state.selectedObject) {
        input.value = '';
        continue;
      }

      let value = this.editor.state.selectedObject[property][axis];

      if (property === 'rotation') {
        value = THREE.MathUtils.radToDeg(value);
      }

      input.value = String(
        Number(value.toFixed(4))
      );
    }
  };

  updateButtons = () => {
    const dragging = (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction);
    document.getElementById('object-tools').hidden = this.editor.mesh.editMode;
    document.getElementById('mesh-tools').hidden = !this.editor.mesh.editMode;
    const tools = [this.editor.skewTool,this.editor.taperTool,this.editor.bendTool,this.editor.bevelTool,this.editor.insetTool,this.editor.extrudeTool];
    const active = tools.find(tool => tool?.active);
    const hint = document.getElementById('tool-status');
    hint.textContent = active ? `${active.name.toUpperCase()} · Drag the yellow handle · Esc cancels · Click the tool again to exit`
      : this.editor.mesh.editMode ? 'Select a vertex, edge or face. In Face mode, select a face to use Inset or Extrude.'
      : 'Select an object, then choose a shape tool. M: move · R: rotate · S: scale';
    const bevel = document.getElementById('bevel-tool');
    bevel.disabled = dragging || this.editor.mesh.editMode || this.editor.state.selectedObject?.userData.type !== 'Cube';
    bevel.setAttribute('aria-pressed',String(this.editor.bevelTool?.active ?? false));
    const bend = document.getElementById('bend-tool');
    bend.disabled = dragging || this.editor.mesh.editMode || this.editor.state.selectedObject?.userData.type !== 'Cube';
    bend.setAttribute('aria-pressed', String(this.editor.bendTool?.active ?? false));
    document.getElementById('bend-options').hidden = !this.editor.bendTool?.active;
    for (const field of ['axis','direction']) {
      const select = document.getElementById(`bend-${field}`);
      select.disabled = dragging;
      select.value = this.editor.bendTool?.[field] ?? (field === 'axis' ? 'y' : 'x');
    }
    const inset = document.getElementById('inset-tool');
    inset.disabled = dragging || !this.editor.insetTool?.canActivate();
    inset.setAttribute('aria-pressed', String(this.editor.insetTool?.active ?? false));
    const extrude = document.getElementById('extrude-tool');
    extrude.disabled = dragging || !this.editor.extrudeTool?.canActivate();
    extrude.setAttribute('aria-pressed', String(this.editor.extrudeTool?.active ?? false));
    const taper = document.getElementById('taper-tool');
    taper.disabled = dragging || this.editor.mesh.editMode || this.editor.state.selectedObject?.userData.type !== 'Cube';
    taper.setAttribute('aria-pressed', String(this.editor.taperTool?.active ?? false));
    document.getElementById('taper-options').hidden = !this.editor.taperTool?.active;
    for (const field of ['axis', 'end']) {
      const select = document.getElementById(`taper-${field}`);
      select.disabled = dragging;
      select.value = this.editor.taperTool?.[field === 'end' ? 'side' : field] ?? (field === 'axis' ? 'y' : 'positive');
    }
    const skew = document.querySelector('#skew-tool');
    skew.disabled = dragging || this.editor.mesh.editMode || this.editor.state.selectedObject?.userData.type !== 'Cube';
    skew.setAttribute('aria-pressed', String(this.editor.skewTool?.active ?? false));
    document.getElementById('skew-axes').hidden = !this.editor.skewTool?.active;
    for (const field of ['axis', 'relativeTo']) {
      const select = document.getElementById(`skew-${field}`);
      select.disabled = dragging;
      select.value = this.editor.skewTool?.[field] ?? (field === 'axis' ? 'x' : 'y');
    }

    for (const id of [
      'add-cube',
      'add-sphere',
      'add-cylinder',
      'snap'
    ]) {
      document.getElementById(id).disabled = dragging;
    }

    document.querySelector('#delete').disabled =
      dragging || !this.editor.state.selectedObject;

    document.querySelector('#duplicate').disabled =
      dragging || !this.editor.state.selectedObject;

    document.querySelector('#undo').disabled =
      dragging || this.editor.history.undoHistory.length === 0;

    document.querySelector('#redo').disabled =
      dragging || this.editor.history.redoHistory.length === 0;

    const editButton =
      document.querySelector('#edit-mode');

    editButton.disabled =
      dragging ||
      (
        !this.editor.mesh.editMode &&
        this.editor.state.selectedObject?.userData.type !== 'Cube'
      );

    editButton.textContent = this.editor.mesh.editMode
      ? 'Object Mode (Tab)'
      : 'Edit Mode (Tab)';

    editButton.setAttribute(
      'aria-pressed',
      String(this.editor.mesh.editMode)
    );

    // Mesh selection buttons
    for (const mode of ['vertex', 'edge', 'face']) {
      const button =
        document.querySelector(`#${mode}-mode`);

      button.disabled = !this.editor.mesh.editMode || dragging;

      button.setAttribute(
        'aria-pressed',
        String(this.editor.mesh.editMode && this.editor.mesh.meshSelectionMode === mode)
      );
    }
  };
}
