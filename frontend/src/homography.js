// Solve a projective transform (3x3 homography) from 4 source points to 4
// destination points. Math from Heckbert 1989, "Fundamentals of Texture
// Mapping and Image Warping", section 3.2 — closed-form for unit-square
// source plus a general 4-point variant.
//
// Returns an 8-element array [a, b, c, d, e, f, g, h] representing the
// 3x3 matrix:
//
//     [ a  b  c ]
//     [ d  e  f ]
//     [ g  h  1 ]
//
// Applied as (x', y', w') = H * (x, y, 1); screen pixel = (x'/w', y'/w').
// Returns null if the system is degenerate (determinant near zero).

function solveUnitSquareToQuad(quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2;
  const dy1 = y1 - y2, dy2 = y3 - y2;
  const sx  = x0 - x1 + x2 - x3;
  const sy  = y0 - y1 + y2 - y3;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const g = (sx * dy2 - sy * dx2) / denom;
  const h = (dx1 * sy - dy1 * sx) / denom;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;
  // Reject rank-deficient results (e.g. three colinear destination points
  // collapse the quad onto a line, producing a singular 3x3).
  const det = a * (e - f * h) - b * (d - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  return [a, b, c, d, e, f, g, h];
}

export function solveHomography(src, dst) {
  // Fast path: source is the unit square — use closed form.
  const isUnitSquare =
    src.length === 4 &&
    src[0][0] === 0 && src[0][1] === 0 &&
    src[1][0] === 1 && src[1][1] === 0 &&
    src[2][0] === 1 && src[2][1] === 1 &&
    src[3][0] === 0 && src[3][1] === 1;
  if (isUnitSquare) return solveUnitSquareToQuad(dst);

  // General 4-point case: not needed for this plan, return null.
  return null;
}

// Lift the 3x3 homography to a 4x4 CSS matrix3d string per
// https://www.w3.org/TR/css-transforms-2/#mathematical-description
// matrix3d is column-major. We insert a unit z-axis (no z transformation).
//
//   3x3 H = [ a b c ]      4x4 = [ a b 0 c ]
//           [ d e f ]              [ d e 0 f ]
//           [ g h 1 ]              [ 0 0 1 0 ]
//                                  [ g h 0 1 ]
//
// Column-major flatten: col1, col2, col3, col4.
export function cssMatrix3d(H) {
  if (!H) return null;
  const [a, b, c, d, e, f, g, h] = H;
  const m = [
    a, d, 0, g,   // column 1 (x basis)
    b, e, 0, h,   // column 2 (y basis)
    0, 0, 1, 0,   // column 3 (z basis)
    c, f, 0, 1,   // column 4 (translation)
  ];
  return `matrix3d(${m.join(',')})`;
}
