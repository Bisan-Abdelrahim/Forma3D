import { faceLoop } from './QuadTopology.js';
import * as THREE from 'three';

export class MeshEditor {
  constructor(editor) { this.editor = editor; }

  initialize() {
    this.editMode = false;
    this.meshSelectionMode = 'vertex';
    this.editTransformMode = 'translate';
    this.previousObjectTransformMode = 'translate';
    this.vertexMarkers = [];
    this.selectedVertexMarkers = new Set();
    this.vertexPivot = new THREE.Object3D();
    this.vertexTransform = null;
    this.componentTransformBase = null;
    this.componentTransformValues = {
      position: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      scale: new THREE.Vector3(1, 1, 1)
    };
    this.edgeMarkers = [];
    this.selectedEdgeMarkers = new Set();
    this.selectedFaceIndices = new Set();
    this.vertexMarkerGeometry = new THREE.SphereGeometry(
      0.09, 12, 8
    );
    this.vertexMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      depthTest: false,
      depthWrite: false
    });
    this.selectedVertexMaterial = new THREE.MeshBasicMaterial({
      color: 0x00bfff,
      depthTest: false,
      depthWrite: false
    });
    this.edgeMarkerGeometry = new THREE.CylinderGeometry(
      0.065, 0.065, 1, 8
    );
    this.edgeMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.selectedEdgeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00bfff,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.edgeUpDirection = new THREE.Vector3(0, 1, 0);
    this.faceHighlightGeometry = new THREE.BufferGeometry();
    this.faceHighlightGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array(18),
        3
      )
    );
    this.faceHighlightMaterial = new THREE.MeshBasicMaterial({
      color: 0x00bfff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    this.faceHighlight = new THREE.Mesh(
      this.faceHighlightGeometry,
      this.faceHighlightMaterial
    );
    this.faceHighlight.renderOrder = 11;

  }

  get selectedEdgeMarker() {
    return this.selectedEdgeMarkers.size === 1
      ? this.selectedEdgeMarkers.values().next().value
      : null;
  }

  // Extrude and Inset operate on exactly one face.
  get selectedFaceIndex() {
    return this.selectedFaceIndices.size === 1
      ? this.selectedFaceIndices.values().next().value
      : null;
  }

  resetComponentTransform = () => {
    this.componentTransformBase = null;
    this.componentTransformValues.position.set(0, 0, 0);
    this.componentTransformValues.rotation.set(0, 0, 0);
    this.componentTransformValues.scale.set(1, 1, 1);
  };

  canEditComponentTransform = () => {
    return this.editMode && this.selectedVertexMarkers.size > 0 &&
      this.editor.state.selectedObjects.length === 1 &&
      this.editor.workflow.transformable(this.editor.state.selectedObject) &&
      !this.editor.viewport.transformControls.dragging &&
      !this.editor.modifiers?.transaction &&
      !this.editor.extrudeTool?.active && !this.editor.insetTool?.active && !this.editor.bevelTool?.active;
  };

  updateVertexSelectionGizmo = ({preserveTransform = false} = {}) => {
    if (!preserveTransform) this.resetComponentTransform();
    // Refresh vertex colors
    for (const marker of this.vertexMarkers) {
      marker.material = this.selectedVertexMarkers.has(marker)
        ? this.selectedVertexMaterial
        : this.vertexMarkerMaterial;
    }

    this.editor.viewport.transformControls.setMode(this.editTransformMode);

    if (
      !this.editMode ||
      !this.editor.state.selectedObject ||
      this.selectedVertexMarkers.size === 0 ||
      this.editor.extrudeTool?.active || this.editor.insetTool?.active || this.editor.bevelTool?.active
    ) {
      this.editor.viewport.transformControls.detach();
      this.vertexPivot.removeFromParent();
      this.editor.ui.updateProperties();
      return;
    }

    const center = new THREE.Vector3();

    for (const marker of this.selectedVertexMarkers) {
      center.add(marker.position);
    }

    center.divideScalar(this.selectedVertexMarkers.size);

    const object = this.editor.state.selectedObject;
    object.updateWorldMatrix(true, false);
    center.applyMatrix4(object.matrixWorld);

    // A scene-level pivot avoids inheriting nonuniform object/group scale.
    if (this.vertexPivot.parent !== this.editor.viewport.scene) {
      this.vertexPivot.removeFromParent();
      this.editor.viewport.scene.add(this.vertexPivot);
    }

    this.vertexPivot.position.copy(center);
    this.vertexPivot.scale.setScalar(1);
    if (this.editor.viewport.transformControls.space === 'local') {
      object.getWorldQuaternion(this.vertexPivot.quaternion).normalize();
    } else {
      this.vertexPivot.quaternion.identity();
    }
    this.vertexPivot.updateMatrixWorld(true);

    this.editor.viewport.transformControls.attach(this.vertexPivot);
    this.editor.ui.updateProperties();
  };

  selectVertexMarker = (marker, multiSelect = false) => {
    if (!this.editMode || this.meshSelectionMode !== 'vertex') {
      return;
    }

    if (!multiSelect) {
      this.selectedVertexMarkers.clear();
    }

    if (marker) {
      if (
        multiSelect &&
        this.selectedVertexMarkers.has(marker)
      ) {
        this.selectedVertexMarkers.delete(marker);
      } else {
        this.selectedVertexMarkers.add(marker);
      }
    }

    this.updateVertexSelectionGizmo();
  };

  clearFaceSelection = () => {
    this.selectedFaceIndices.clear();
    this.faceHighlight.removeFromParent();
  };

  clearEdgeMarkers = () => {
    this.selectedEdgeMarkers.clear();

    for (const edge of this.edgeMarkers) {
      edge.removeFromParent();
    }

    this.edgeMarkers.length = 0;
  };

  clearVertexMarkers = () => {
    this.vertexTransform = null;
    this.resetComponentTransform();
    this.selectedVertexMarkers.clear();

    this.clearEdgeMarkers();
    this.clearFaceSelection();

    this.editor.viewport.transformControls.detach();
    this.vertexPivot.removeFromParent();

    for (const marker of this.vertexMarkers) {
      marker.removeFromParent();
    }

    this.vertexMarkers = [];
  };

  showCubeVertices = (object) => {
    this.clearVertexMarkers();

    if (
      !object ||
      object.userData.type !== 'Cube'
    ) {
      return;
    }

    const positions = object.geometry.getAttribute('position');
    const vertexGroups = new Map();

    // BoxGeometry has 24 position entries
    // but only 8 physical corners.

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      const key = [
        x.toFixed(5),
        y.toFixed(5),
        z.toFixed(5)
      ].join(',');

      if (!vertexGroups.has(key)) {
        vertexGroups.set(key, {
          position: new THREE.Vector3(x, y, z),
          indices: []
        });
      }

      vertexGroups.get(key).indices.push(i);
    }

    for (const group of vertexGroups.values()) {
      const marker = new THREE.Mesh(
        this.vertexMarkerGeometry,
        this.vertexMarkerMaterial
      );

      marker.position.copy(group.position);
      marker.userData.vertexIndices = group.indices;

      marker.renderOrder = 10;

      object.add(marker);
      this.vertexMarkers.push(marker);
    }
  };

  updateEdgeMarkers = () => {
    for (const edge of this.edgeMarkers) {
      const start = edge.userData.startMarker.position;
      const end = edge.userData.endMarker.position;

      const direction = new THREE.Vector3().subVectors(
        end, start
      );

      const length = direction.length();

      if (length < 0.000001) {
        edge.visible = false;
        continue;
      }

      edge.visible = true;

      edge.position
        .copy(start)
        .add(end)
        .multiplyScalar(0.5);

      edge.quaternion.setFromUnitVectors(
        this.edgeUpDirection,
        direction.normalize()
      );

      edge.scale.set(1, length, 1);
    }
  };

  showCubeEdges = () => {
    this.clearEdgeMarkers();

    if (
      !this.editor.state.selectedObject ||
      this.editor.state.selectedObject.userData.type !== 'Cube'
    ) {
      return;
    }

    const positions =
      this.editor.state.selectedObject.geometry.getAttribute('position');

    if (positions.count % 4 !== 0) {
      console.warn('Unsupported cube topology.');
      return;
    }

    const markerByIndex = new Map();

    for (const marker of this.vertexMarkers) {
      for (const index of marker.userData.vertexIndices) {
        markerByIndex.set(index, marker);
      }
    }



    const addedEdges = new Set();

    for (let faceStart = 0; faceStart < positions.count; faceStart += 4) {
      const loop = faceLoop(this.editor.state.selectedObject.geometry, faceStart / 4);
      for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
        const aOffset = loop[edgeIndex] - faceStart, bOffset = loop[(edgeIndex + 1) % 4] - faceStart;
        const startMarker = markerByIndex.get(
          faceStart + aOffset
        );

        const endMarker = markerByIndex.get(
          faceStart + bOffset
        );

        if (!startMarker || !endMarker) continue;
        if (startMarker === endMarker) continue;

        const startId = this.vertexMarkers.indexOf(startMarker);
        const endId = this.vertexMarkers.indexOf(endMarker);

        const key = [startId, endId]
          .sort((a, b) => a - b)
          .join(':');

        if (addedEdges.has(key)) continue;

        addedEdges.add(key);

        const edge = new THREE.Mesh(
          this.edgeMarkerGeometry,
          this.edgeMarkerMaterial
        );

        edge.userData.startMarker = startMarker;
        edge.userData.endMarker = endMarker;

        edge.renderOrder = 9;

        this.editor.state.selectedObject.add(edge);
        this.edgeMarkers.push(edge);
      }
    }

    this.updateEdgeMarkers();
  };

  selectEdgeMarker = (edge, multiSelect = false) => {
    if (!this.editMode || this.meshSelectionMode !== 'edge') {
      return;
    }

    if (!multiSelect) {
      this.selectedEdgeMarkers.clear();
    }

    if (edge) {
      if (multiSelect && this.selectedEdgeMarkers.has(edge)) {
        this.selectedEdgeMarkers.delete(edge);
      } else {
        this.selectedEdgeMarkers.add(edge);
      }
    }

    this.updateEdgeSelection();
  };

  updateEdgeSelection = () => {
    if (this.editor.bevelTool?.active && !this.editor.bevelTool.canActivate()) this.editor.bevelTool.setActive(false);
    // Rebuild the union so shared endpoints remain selected after a toggle.
    this.selectedVertexMarkers.clear();

    for (const selectedEdge of this.selectedEdgeMarkers) {
      this.selectedVertexMarkers.add(
        selectedEdge.userData.startMarker
      );

      this.selectedVertexMarkers.add(
        selectedEdge.userData.endMarker
      );
    }

    for (const item of this.edgeMarkers) {
      item.material = this.selectedEdgeMarkers.has(item)
        ? this.selectedEdgeMaterial
        : this.edgeMarkerMaterial;
    }

    this.updateVertexSelectionGizmo();
    this.editor.ui.updateButtons();
  };

  rebuildEdgeSelection = (pairs) => {
    this.showCubeVertices(this.editor.state.selectedObject);
    for (const marker of this.vertexMarkers) marker.visible = false;
    this.showCubeEdges();
    const byIndex = new Map();
    for (const marker of this.vertexMarkers) {
      for (const index of marker.userData.vertexIndices) byIndex.set(index, marker);
    }
    const edgeKey = (a, b) => [a.uuid, b.uuid].sort().join(':');
    const byMarkers = new Map(this.edgeMarkers.map(edge => [
      edgeKey(edge.userData.startMarker, edge.userData.endMarker), edge
    ]));
    for (const [a, b] of pairs) {
      const start = byIndex.get(a), end = byIndex.get(b);
      const edge = start && end ? byMarkers.get(edgeKey(start, end)) : null;
      if (edge) this.selectedEdgeMarkers.add(edge);
    }
    this.updateEdgeSelection();
  };

  updateFaceHighlight = () => {
    if (
      !this.editor.state.selectedObject ||
      this.selectedFaceIndices.size === 0
    ) {
      this.faceHighlight.removeFromParent();
      return;
    }

    const geometry = this.editor.state.selectedObject.geometry;
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();

    // Each editable quad uses 2 triangles = 6 indices.
    if (
      !index ||
      positions.count % 4 !== 0 ||
      index.count !== positions.count / 4 * 6
    ) {
      this.faceHighlight.removeFromParent();
      return;
    }

    let highlightPositions =
      this.faceHighlightGeometry.getAttribute('position');

    const vertexCount = this.selectedFaceIndices.size * 6;
    if (highlightPositions.count !== vertexCount) {
      // Release the old GPU buffer before replacing it with a different size.
      this.faceHighlightGeometry.dispose();
      highlightPositions = new THREE.Float32BufferAttribute(
        new Float32Array(vertexCount * 3), 3
      );
      this.faceHighlightGeometry.setAttribute('position', highlightPositions);
    }

    let offset = 0;
    for (const face of this.selectedFaceIndices) {
      const start = face * 6;
      for (let i = 0; i < 6; i++) {
        const vertexIndex = index.getX(start + i);

        highlightPositions.setXYZ(
          offset++,
          positions.getX(vertexIndex),
          positions.getY(vertexIndex),
          positions.getZ(vertexIndex)
        );
      }
    }

    highlightPositions.needsUpdate = true;
    this.faceHighlightGeometry.computeBoundingSphere();

    if (this.faceHighlight.parent !== this.editor.state.selectedObject) {
      this.faceHighlight.removeFromParent();
      this.editor.state.selectedObject.add(this.faceHighlight);
    }
  };

  selectFaceByTriangle = (triangleIndex, multiSelect = false) => {
    if (!this.editMode || this.meshSelectionMode !== 'face') {
      return;
    }

    const geometry = this.editor.state.selectedObject.geometry;
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();

    if (!multiSelect) {
      this.selectedFaceIndices.clear();
    }

    // Every two triangles form one editable quad face.
    if (
      Number.isInteger(triangleIndex) &&
      triangleIndex >= 0 &&
      triangleIndex < (index?.count ?? 0) / 3 &&
      index &&
      positions.count % 4 === 0 &&
      index.count === positions.count / 4 * 6
    ) {
      const face = Math.floor(triangleIndex / 2);
      if (multiSelect && this.selectedFaceIndices.has(face)) {
        this.selectedFaceIndices.delete(face);
      } else {
        this.selectedFaceIndices.add(face);
      }
    }

    this.selectedVertexMarkers.clear();
    for (const face of this.selectedFaceIndices) {
      // Every editable quad retains four independent position entries.
      const faceStart = face * 4;

      // A Set moves shared physical corners exactly once.
      for (let i = faceStart; i < faceStart + 4; i++) {
        const marker = this.vertexMarkers.find(item =>
          item.userData.vertexIndices.includes(i)
        );

        if (marker) {
          this.selectedVertexMarkers.add(marker);
        }
      }
    }

    for (const tool of [this.editor.extrudeTool, this.editor.insetTool]) {
      if (tool?.active && !tool.canActivate()) tool.setActive(false);
    }
    this.updateVertexSelectionGizmo();
    this.updateFaceHighlight();
    if (this.editor.extrudeTool?.active || this.editor.insetTool?.active) this.editor.viewport.transformControls.detach();
    this.editor.ui.updateButtons();
  };

  setMeshSelectionMode = (mode) => {
    if (
      !this.editMode ||
      (this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction) ||
      mode === this.meshSelectionMode
    ) {
      return;
    }

    if (
      mode !== 'vertex' &&
      mode !== 'edge' &&
      mode !== 'face'
    ) {
      return;
    }

    if (this.editor.extrudeTool?.active) this.editor.extrudeTool.setActive(false);
    if (this.editor.insetTool?.active) this.editor.insetTool.setActive(false);
    if (this.editor.bevelTool?.active) this.editor.bevelTool.setActive(false);
    // Reset previous mode selection
    this.selectedVertexMarkers.clear();

    this.clearEdgeMarkers();
    this.clearFaceSelection();

    this.meshSelectionMode = mode;

    this.updateVertexSelectionGizmo();

    // Vertex markers are visible only in Vertex Mode.
    for (const marker of this.vertexMarkers) {
      marker.visible = mode === 'vertex';
    }

    if (mode === 'edge') {
      this.showCubeEdges();
    }

    this.editor.ui.updateButtons();
  };

  captureVertexTransform = () => {
    const object = this.editor.state.selectedObject;
    if (
      !this.editMode ||
      !object ||
      this.selectedVertexMarkers.size === 0 ||
      this.editor.viewport.transformControls.object !== this.vertexPivot
    ) {
      return null;
    }

    object.updateWorldMatrix(true, false);
    if (Math.abs(object.matrixWorld.determinant()) < 1e-12) return null;
    this.vertexPivot.updateMatrixWorld(true);
    return {
      object,
      position: this.vertexPivot.position.clone(),
      quaternion: this.vertexPivot.quaternion.clone(),
      objectWorld: object.matrixWorld.clone(),
      objectInverse: object.matrixWorld.clone().invert(),
      pivotInverse: this.vertexPivot.matrixWorld.clone().invert(),
      vertices: [...this.selectedVertexMarkers].map(marker => ({
        marker, position: marker.position.clone()
      }))
    };
  };

  beginVertexTransform = () => {
    this.vertexTransform = this.captureVertexTransform();
    if (!this.vertexTransform) return;
    this.resetComponentTransform();
    this.editor.ui.updateProperties();
  };

  endVertexTransform = () => {
    if (!this.vertexTransform) return;
    this.componentTransformBase = this.vertexTransform;
    this.vertexTransform = null;
    // Bake the deformation into geometry and reset the gizmo's rotation/scale.
    if (this.editMode) this.updateVertexSelectionGizmo({preserveTransform: true});
  };

  setComponentTransformValue = (property, axis, value) => {
    if (!this.canEditComponentTransform() || !['position', 'rotation', 'scale'].includes(property) ||
      !['x', 'y', 'z'].includes(axis) || !Number.isFinite(value)) return false;
    const transform = this.componentTransformBase ?? this.captureVertexTransform();
    if (!transform) return false;
    const before = this.editor.history.takeSnapshot();
    const values = this.componentTransformValues;
    const previous = {
      position: values.position.clone(), rotation: values.rotation.clone(), scale: values.scale.clone()
    };
    values[property][axis] = property === 'rotation' ? THREE.MathUtils.degToRad(value) : value;
    this.vertexPivot.position.copy(transform.position)
      .add(values.position.clone().applyQuaternion(transform.quaternion));
    this.vertexPivot.quaternion.copy(transform.quaternion)
      .multiply(new THREE.Quaternion().setFromEuler(values.rotation));
    this.vertexPivot.scale.copy(values.scale);
    this.vertexTransform = transform;
    if (!this.updateSelectedVertexGeometry()) {
      this.vertexTransform = null;
      for (const key of ['position', 'rotation', 'scale']) values[key].copy(previous[key]);
      this.updateVertexSelectionGizmo({preserveTransform: true});
      return false;
    }
    this.endVertexTransform();
    this.editor.history.recordAction(before);
    return true;
  };

  updateSelectedVertexGeometry = () => {
    const transform = this.vertexTransform;
    if (!this.editMode || !transform || transform.object !== this.editor.state.selectedObject) {
      return;
    }

    this.vertexPivot.updateMatrixWorld(true);
    // Convert the gizmo's world transform back into geometry coordinates.
    const delta = transform.objectInverse.clone()
      .multiply(this.vertexPivot.matrixWorld)
      .multiply(transform.pivotInverse)
      .multiply(transform.objectWorld);
    if (!delta.elements.every(Number.isFinite)) return false;
    const identity = delta.elements.every((value, i) =>
      Math.abs(value - (i % 5 === 0 ? 1 : 0)) < 1e-12
    );

    const updates = transform.vertices.map(({marker, position}) => ({
      marker, position: identity ? position.clone() : position.clone().applyMatrix4(delta)
    }));
    if (!updates.every(({position}) => position.toArray().every(value => Number.isFinite(Math.fround(value))))) return false;

    // These are relative values for the last edit, not object Euler angles.
    const frameInverse = transform.quaternion.clone().invert();
    this.componentTransformValues.position.copy(this.vertexPivot.position)
      .sub(transform.position).applyQuaternion(frameInverse);
    this.componentTransformValues.rotation.setFromQuaternion(
      frameInverse.multiply(this.vertexPivot.quaternion), 'XYZ'
    );
    this.componentTransformValues.scale.copy(this.vertexPivot.scale);

    const geometry = transform.object.geometry;
    const positions = geometry.getAttribute('position');

    // Always start from the drag's original positions, including when returning
    // to the starting transform. Shared corners and duplicate entries stay welded.
    for (const {marker, position} of updates) {
      marker.position.copy(position);

      // Keep duplicate BoxGeometry entries together.
      for (const index of marker.userData.vertexIndices) {
        positions.setXYZ(
          index,
          marker.position.x,
          marker.position.y,
          marker.position.z
        );
      }
    }

    positions.needsUpdate = true;

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Refresh edges after moving their endpoints.
    if (this.meshSelectionMode === 'edge') {
      this.updateEdgeMarkers();
    }

    // Refresh face highlight after deformation.
    if (this.meshSelectionMode === 'face') {
      this.updateFaceHighlight();
    }
    return true;
  };

  toggleEditMode = () => {
    if (!this.editor.modifiers?.transaction && this.editor.bevelTool?.active) this.editor.bevelTool.setActive(false);
    if (!this.editor.modifiers?.transaction && this.editor.insetTool?.active) this.editor.insetTool.setActive(false);
    if (!this.editor.modifiers?.transaction && this.editor.bendTool?.active) this.editor.bendTool.setActive(false);
    if (!this.editor.modifiers?.transaction && this.editor.extrudeTool?.active) this.editor.extrudeTool.setActive(false);
    if (!this.editor.modifiers?.transaction && this.editor.taperTool?.active) this.editor.taperTool.setActive(false);
    if (!this.editor.modifiers?.transaction && this.editor.skewTool?.active) this.editor.skewTool.setActive(false);
    if ((this.editor.viewport.transformControls.dragging || !!this.editor.modifiers?.transaction)) return;

    if (this.editMode) {
      this.editMode = false;

      this.clearVertexMarkers();

      this.editor.viewport.transformControls.setMode(
        this.previousObjectTransformMode
      );

      if (this.editor.state.selectedObject) {
        this.editor.viewport.transformControls.attach(this.editor.state.selectedObject);
      }

    } else {
      if (this.editor.state.selectedObjects.length !== 1 || !this.editor.workflow.transformable(this.editor.state.selectedObject)) return;
      if (
        !this.editor.state.selectedObject ||
        this.editor.state.selectedObject.userData.type !== 'Cube'
      ) {
        return;
      }

      this.previousObjectTransformMode =
        this.editor.viewport.transformControls.getMode();

      this.editMode = true;
      this.meshSelectionMode = 'vertex';
      this.editTransformMode = 'translate';

      this.editor.viewport.transformControls.detach();
      this.editor.viewport.transformControls.setMode('translate');

      this.showCubeVertices(this.editor.state.selectedObject);
    }

    this.editor.ui.updateProperties();
    this.editor.ui.updateButtons();
  };
}
