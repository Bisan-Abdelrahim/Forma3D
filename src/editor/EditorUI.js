import * as THREE from 'three';
import { editorLayout, icon } from './EditorLayout.js';

export class EditorUI {
  constructor(editor) { this.editor = editor; }

  bindToolbar() {
    this.bindSurface();
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

  // Native details/summary menus work with mouse, Enter and Space.
  // Keep only one open; Escape returns focus to its trigger.
  bindSurface() {
    this.menus = ['add-menu', 'object-menu', 'view-menu', 'snap-menu'].map(id => document.getElementById(id));
    for (const menu of this.menus) {
      menu.addEventListener('toggle', () => {
        if (menu.open) this.closeMenus(menu);
      });
      menu.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (button && !button.disabled) {
          menu.open = false;
          document.querySelector(`#${menu.id} > summary`).focus();
        }
      });
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          menu.open = false;
          document.querySelector(`#${menu.id} > summary`).focus();
        } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target?.tagName !== 'SELECT') {
          event.preventDefault();
          menu.open = true;
          const items = [...menu.querySelectorAll('button:not(:disabled), select:not(:disabled)')];
          if (!items.length) return;
          const index = items.indexOf(document.activeElement);
          const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next].focus();
        }
      });
      menu.addEventListener('focusout', event => {
        if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
      });
    }
    window.addEventListener('pointerdown', event => {
      if (!event.target.closest('.dropdown')) this.closeMenus();
    });
    document.querySelector('#object-search').addEventListener('input', this.updateOutliner);
    for (const [id, mode] of [['move-mode','translate'], ['rotate-mode','rotate'], ['scale-mode','scale']]) {
      document.getElementById(id).addEventListener('click', () => this.editor.input.setTransformMode(mode));
    }
  }

  closeMenus(except = null) {
    for (const menu of this.menus ?? []) if (menu !== except) menu.open = false;
  }

  bindProperties() {
    this.propertyInputs = [];
    for (const property of ['position', 'rotation', 'scale']) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');

      legend.textContent = property === 'rotation' ? 'Rotation °' : property;

      fieldset.appendChild(legend);

      for (const axis of ['x', 'y', 'z']) {
        const label = document.createElement('label');

        label.className = `axis-field axis-${axis}`;
        const axisLabel = document.createElement('span');
        axisLabel.textContent = axis.toUpperCase();
        label.appendChild(axisLabel);

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
            this.editor.state.selectedObjects.length !== 1 ||
            !this.editor.workflow.transformable(this.editor.state.selectedObject) ||
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
    document.querySelector('#app').innerHTML = editorLayout();

    this.viewport = document.querySelector('#viewport');
    this.outliner = document.querySelector('#outliner');
    this.properties = document.querySelector('#properties');
  }

  updateOutliner = () => {
    this.outliner.replaceChildren();
    this.objectRows = [];

    const e = this.editor;
    const search = document.querySelector('#object-search').value.trim().toLowerCase();
    const matches = object => object.name.toLowerCase().includes(search);
    const addRow = (object, child = false, parentMatches = false) => {
      const row = document.createElement('div');
      if (search && !parentMatches && !matches(object) && !(object.isGroup && object.children.some(matches))) return;
      row.className = `object-row${child ? ' child-row' : ''}`;
      const button = document.createElement('button');
      button.innerHTML = icon(object.isGroup ? 'group' : object.userData.type.toLowerCase());
      const name = document.createElement('span');
      name.textContent = object.name;
      button.appendChild(name);
      button.title = object.name;
      button.className = 'object-name';
      button.classList.toggle('selected', e.state.selectedObjects.includes(object));
      row.classList.toggle('inherited-selection', e.state.selectedObjects.includes(object.parent));
      row.classList.toggle('unavailable', !e.workflow.editable(object));
      button.setAttribute('aria-pressed', String(e.state.selectedObjects.includes(object)));
      button.disabled = e.workflow.busy() || !e.workflow.editable(object);
      button.addEventListener('click', event => e.selection.selectObject(object, !!(event?.ctrlKey || event?.metaKey || event?.shiftKey)));
      row.appendChild(button);
      const controls = [];
      this.objectRows.push({ object, button, controls });
      for (const property of ['visible', 'locked']) {
        const control = document.createElement('button');
        const action = property === 'visible' ? (object.visible ? 'Hide' : 'Show') : (object.userData.locked ? 'Unlock' : 'Lock');
        control.innerHTML = icon(property === 'visible' ? (object.visible ? 'eye' : 'hidden') : (object.userData.locked ? 'lock' : 'unlock'));
        control.className = 'row-control';
        control.title = `${action} ${object.name}`;
        control.setAttribute('aria-label', `${action} ${object.name}`);
        control.setAttribute('aria-pressed', String(property === 'visible' ? !object.visible : !!object.userData.locked));
        control.disabled = e.workflow.busy();
        control.addEventListener('click', () => e.workflow.toggle(object, property));
        row.appendChild(control);
        controls.push(control);
      }
      this.outliner.appendChild(row);
      if (object.isGroup) object.children.forEach(child => {
        if (!search || matches(object) || matches(child)) addRow(child, true, matches(object));
      });
    };
    e.workflow.roots().forEach(object => addRow(object));
    document.querySelector('#object-count').textContent = String(e.state.objects.length);
    document.querySelector('#outliner-empty').hidden = this.outliner.children.length > 0;
    const count = e.state.selectedObjects.length;
    document.querySelector('#selection-count').textContent = count ? `${count} object${count === 1 ? '' : 's'} selected` : 'No objects selected';
  };

  updateProperties = () => {
    document.querySelector('#selection-name').textContent =
      this.editor.state.selectedObject
        ? (this.editor.state.selectedObjects.length > 1 ? `${this.editor.state.selectedObjects.length} objects selected` : this.editor.state.selectedObject.name)
        : 'No selection';

    const count = this.editor.state.selectedObjects.length;
    document.querySelector('#property-hint').textContent = count > 1
      ? 'Use the gizmo to transform together, or Object → Group Selection.'
      : this.editor.mesh.editMode ? 'Editing mesh components. Use the selection tools.'
      : count ? 'Edit values below or use the gizmo in the viewport.' : 'Select an object in the scene or Objects list.';

    for (const { input, property, axis } of this.propertyInputs) {
      input.disabled =
        !this.editor.state.selectedObject ||
        this.editor.state.selectedObjects.length !== 1 ||
        !this.editor.workflow.transformable(this.editor.state.selectedObject) ||
        this.editor.mesh.editMode ||
        (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction);

      if (!this.editor.state.selectedObject || count > 1) {
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
    for (const row of this.objectRows ?? []) {
      row.button.disabled = this.editor.workflow.busy() || !this.editor.workflow.editable(row.object);
      for (const control of row.controls) control.disabled = this.editor.workflow.busy();
    }
    document.getElementById('object-tools').hidden = this.editor.mesh.editMode;
    document.getElementById('mesh-tools').hidden = !this.editor.mesh.editMode;
    document.getElementById('face-tools').hidden = !this.editor.mesh.editMode;
    const tools = [this.editor.skewTool,this.editor.taperTool,this.editor.bendTool,this.editor.bevelTool,this.editor.insetTool,this.editor.extrudeTool];
    const active = tools.find(tool => tool?.active);
    document.getElementById('active-shape-tool').textContent = active ? active.name : 'Choose a tool';
    if (active) document.getElementById('shape-tools-panel').open = true;
    const hint = document.getElementById('tool-status');
    hint.textContent = active ? `${active.name.toUpperCase()} · Drag the yellow handle · Esc cancels · Click the tool again to exit`
      : this.editor.mesh.editMode ? 'Select a vertex, edge or face. In Face mode, select a face to use Inset or Extrude.'
      : 'Ctrl + click: multi-select · M: move · R: rotate · S: scale';
    const bevel = document.getElementById('bevel-tool');
    bevel.disabled = dragging || this.editor.mesh.editMode || (this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject) || this.editor.state.selectedObject?.userData.type !== 'Cube');
    bevel.setAttribute('aria-pressed',String(this.editor.bevelTool?.active ?? false));
    const bend = document.getElementById('bend-tool');
    bend.disabled = dragging || this.editor.mesh.editMode || (this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject) || this.editor.state.selectedObject?.userData.type !== 'Cube');
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
    taper.disabled = dragging || this.editor.mesh.editMode || (this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject) || this.editor.state.selectedObject?.userData.type !== 'Cube');
    taper.setAttribute('aria-pressed', String(this.editor.taperTool?.active ?? false));
    document.getElementById('taper-options').hidden = !this.editor.taperTool?.active;
    for (const field of ['axis', 'end']) {
      const select = document.getElementById(`taper-${field}`);
      select.disabled = dragging;
      select.value = this.editor.taperTool?.[field === 'end' ? 'side' : field] ?? (field === 'axis' ? 'y' : 'positive');
    }
    const skew = document.querySelector('#skew-tool');
    skew.disabled = dragging || this.editor.mesh.editMode || (this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject) || this.editor.state.selectedObject?.userData.type !== 'Cube');
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
      dragging || this.editor.mesh.editMode || this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject);

    document.querySelector('#duplicate').disabled =
      dragging || this.editor.mesh.editMode || this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject);

    document.querySelector('#undo').disabled =
      dragging || this.editor.history.undoHistory.length === 0;

    document.querySelector('#redo').disabled =
      dragging || this.editor.history.redoHistory.length === 0;

    const workflow = this.editor.workflow;
    const selected = this.editor.state.selectedObjects;
    document.getElementById('group').disabled = workflow.busy() || selected.length < 2 || selected.some(o => o.isGroup || o.parent !== this.editor.viewport.scene || !workflow.editable(o));
    document.getElementById('ungroup').disabled = workflow.busy() || selected.length !== 1 || !selected[0]?.isGroup || !workflow.transformable(selected[0]);
    document.getElementById('frame-selected').disabled = dragging || !selected.length;
    for (const id of ['transform-space','translation-snap','rotation-snap','scale-snap','view-preset','view-mode']) {
      document.getElementById(id).disabled = dragging || (id === 'transform-space' && this.editor.mesh.editMode);
    }
    const editButton =
      document.querySelector('#edit-mode');

    editButton.disabled =
      dragging ||
      (
        !this.editor.mesh.editMode &&
        (this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject) || this.editor.state.selectedObject?.userData.type !== 'Cube')
      );

    editButton.textContent = this.editor.mesh.editMode
      ? 'Edit Mode'
      : 'Object Mode';

    editButton.setAttribute(
      'aria-pressed',
      String(this.editor.mesh.editMode)
    );

    for (const [id, mode] of [['move-mode','translate'], ['rotate-mode','rotate'], ['scale-mode','scale']]) {
      const button = document.getElementById(id);
      button.disabled = dragging || this.editor.mesh.editMode;
      button.setAttribute('aria-pressed', String(!active && this.editor.viewport.transformControls.getMode() === mode));
    }
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
