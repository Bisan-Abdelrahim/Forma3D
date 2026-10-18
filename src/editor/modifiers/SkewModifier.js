
export class SkewModifier {
  apply(geometry, options = {}) {
    const {
      axis = 'x',
      relativeTo = 'y',
      amount = 0
    } = options;

    const axisIndex = {
      x: 0,
      y: 1,
      z: 2
    };

    // Validate geometry
    if (!geometry?.isBufferGeometry) {
      throw new Error('Invalid geometry');
    }

    // Validate axes
    if (
      !(axis in axisIndex) ||
      !(relativeTo in axisIndex) ||
      axis === relativeTo
    ) {
      throw new Error('Invalid skew axes');
    }

    // Validate amount
    if (!Number.isFinite(amount)) {
      throw new Error('Invalid skew amount');
    }

    // Do not modify the original geometry
    const newGeometry = geometry.clone();
    const positions = newGeometry.getAttribute('position');

    if (!positions) {
      newGeometry.dispose();
      throw new Error('Geometry has no positions');
    }

    for (let i = 0; i < positions.count; i++) {
      const point = [
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i)
      ];

      point[axisIndex[axis]] +=
        amount * point[axisIndex[relativeTo]];

      positions.setXYZ(
        i,
        point[0],
        point[1],
        point[2]
      );
    }

    positions.needsUpdate = true;

    newGeometry.computeVertexNormals();
    newGeometry.computeBoundingBox();
    newGeometry.computeBoundingSphere();

    return newGeometry;
  }
}
