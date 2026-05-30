// Ray-casting point-in-polygon for a 4-corner convex quad.
// Reference: https://wrfranklin.org/Research/Short_Notes/pnpoly.html
export function pointInQuad(px, py, corners) {
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersects = ((yi > py) !== (yj > py)) &&
                       (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}
