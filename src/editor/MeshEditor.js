import { faceLoop } from './QuadTopology.js';
import * as THREE from 'three';

export class MeshEditor {
  constructor(editor) { this.editor = editor; }

  initialize() {
    this.editMode = false;
    this.meshSelectionMode = 'vertex';
    this.previousObjectTransformMode = 'translate';
    this.vertexMarkers = [];
    this.selectedVertexMarkers = new Set();
    this.vertexPivot = new THREE.Object3D();
    this.previousPivotPosition = new THREE.Vector3();
    this.edgeMarkers = [];
    this.selectedEdgeMarker = null;
    this.selectedFaceIndex = null;
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

  updateVertexSelectionGizmo = () => {
    // Refresh vertex colors
    for (const marker of this.vertexMarkers) {
      marker.material = this.selectedVertexMarkers.has(marker)
        ? this.selectedVertexMaterial
        : this.vertexMarkerMaterial;
    }

    if (
      !this.editMode ||
      !this.editor.state.selectedObject ||
      this.selectedVertexMarkers.size === 0
    ) {
      this.editor.viewport.transformControls.detach();
      this.vertexPivot.removeFromParent();
      return;
    }

    const center = new THREE.Vector3();

    for (const marker of this.selectedVertexMarkers) {
      center.add(marker.position);
    }

    center.divideScalar(this.selectedVertexMarkers.size);

    if (this.vertexPivot.parent !== this.editor.state.selectedObject) {
      this.vertexPivot.removeFromParent();
      this.editor.state.selectedObject.add(this.vertexPivot);
    }

    this.vertexPivot.position.copy(center);
    this.previousPivotPosition.copy(center);

    this.editor.viewport.transformControls.setMode('translate');
    this.editor.viewport.transformControls.attach(this.vertexPivot);
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
    this.selectedFaceIndex = null;
    this.faceHighlight.removeFromParent();
  };

  clearEdgeMarkers = () => {
    this.selectedEdgeMarker = null;

    for (const edge of this.edgeMarkers) {
      edge.removeFromParent();
    }

    this.edgeMarkers.length = 0;
  };

  clearVertexMarkers = () => {
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

  selectEdgeMarker = (edge) => {
    if (!this.editMode || this.meshSelectionMode !== 'edge') {
      return;
    }

    this.selectedEdgeMarker = edge;
    this.selectedVertexMarkers.clear();

    if (edge) {
      this.selectedVertexMarkers.add(
        edge.userData.startMarker
      );

      this.selectedVertexMarkers.add(
        edge.userData.endMarker
      );
    }

    for (const item of this.edgeMarkers) {
      item.material = item === this.selectedEdgeMarker
        ? this.selectedEdgeMaterial
        : this.edgeMarkerMaterial;
    }

    this.updateVertexSelectionGizmo();
  };

  updateFaceHighlight = () => {
    if (
      !this.editor.state.selectedObject ||
      this.selectedFaceIndex === null
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

    const highlightPositions =
      this.faceHighlightGeometry.getAttribute('position');

    const start = this.selectedFaceIndex * 6;

    for (let i = 0; i < 6; i++) {
      const vertexIndex = index.getX(start + i);

      highlightPositions.setXYZ(
        i,
        positions.getX(vertexIndex),
        positions.getY(vertexIndex),
        positions.getZ(vertexIndex)
      );
    }

    highlightPositions.needsUpdate = true;
    this.faceHighlightGeometry.computeBoundingSphere();

    if (this.faceHighlight.parent !== this.editor.state.selectedObject) {
      this.faceHighlight.removeFromParent();
      this.editor.state.selectedObject.add(this.faceHighlight);
    }
  };

  selectFaceByTriangle = (triangleIndex) => {
    if (!this.editMode || this.meshSelectionMode !== 'face') {
      return;
    }

    this.selectedVertexMarkers.clear();

    const geometry = this.editor.state.selectedObject.geometry;
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();

    if (
      triangleIndex === null ||
      triangleIndex === undefined ||
      !Number.isInteger(triangleIndex) ||
      triangleIndex < 0 ||
      triangleIndex >= (index?.count ?? 0) / 3 ||
      !index ||
      positions.count % 4 !== 0 ||
      index.count !== positions.count / 4 * 6
    ) {
      this.clearFaceSelection();
      this.updateVertexSelectionGizmo();
      this.editor.ui.updateButtons();
      return;
    }

    // Every two triangles form one editable quad face.
    this.selectedFaceIndex = Math.floor(triangleIndex / 2);

    // Every editable quad retains four independent position entries.
    const faceStart = this.selectedFaceIndex * 4;

    // Find the four physical corner markers.
    for (let i = faceStart; i < faceStart + 4; i++) {
      const marker = this.vertexMarkers.find(item =>
        item.userData.vertexIndices.includes(i)
      );

      if (marker) {
        this.selectedVertexMarkers.add(marker);
      }
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

  updateSelectedVertexGeometry = () => {
    if (
      !this.editMode ||
      !this.editor.state.selectedObject ||
      this.selectedVertexMarkers.size === 0 ||
      this.vertexPivot.parent !== this.editor.state.selectedObject
    ) {
      return;
    }

    const delta = new THREE.Vector3().subVectors(
      this.vertexPivot.position,
      this.previousPivotPosition
    );

    if (delta.lengthSq() < 1e-16) {
      return;
    }

    const geometry = this.editor.state.selectedObject.geometry;
    const positions = geometry.getAttribute('position');

    // Move all selected physical vertices.
    for (const marker of this.selectedVertexMarkers) {
      marker.position.add(delta);

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

    this.previousPivotPosition.copy(this.vertexPivot.position);

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

      this.editor.viewport.transformControls.detach();
      this.editor.viewport.transformControls.setMode('translate');

      this.showCubeVertices(this.editor.state.selectedObject);
    }

    this.editor.ui.updateProperties();
    this.editor.ui.updateButtons();
  };
}
