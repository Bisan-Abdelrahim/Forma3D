import * as THREE from 'three';

// Geometry construction stays independent of the DOM, selection and history.
export class ShapeFactory {
  constructor(color = 0x00ff88) { this.color = color; }

  create = (type, dimensions = {}) => {
    let geometry;

    if (type === 'Cube') {
      geometry = new THREE.BoxGeometry(
        dimensions.width ?? 2,
        dimensions.height ?? 2,
        dimensions.depth ?? 2
      );

    } else if (type === 'Sphere') {
      geometry = new THREE.SphereGeometry(
        dimensions.radius ?? 1,
        24,
        16
      );

    } else if (type === 'Cylinder') {
      const radius = dimensions.radius ?? 1;

      geometry = new THREE.CylinderGeometry(
        radius,
        radius,
        dimensions.height ?? 2,
        24
      );

    } else {
      throw new Error('Unsupported shape.');
    }

    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        roughness: 0.65, metalness: 0,
        color: this.color
      })
    );
  };

  getDimensions = (object) => {
    const params = object.geometry.parameters;
    const type = object.userData.type;

    if (type === 'Cube') {
      return {
        width: params.width,
        height: params.height,
        depth: params.depth
      };
    }

    if (type === 'Sphere') {
      return {
        radius: params.radius
      };
    }

    return {
      radius: params.radiusTop,
      height: params.height
    };
  };

}
