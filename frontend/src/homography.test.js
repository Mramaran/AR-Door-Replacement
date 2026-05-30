import { solveHomography, cssMatrix3d } from './homography';

const unitSquare = [[0, 0], [1, 0], [1, 1], [0, 1]];

function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + 1;
  return [
    (H[0] * x + H[1] * y + H[2]) / w,
    (H[3] * x + H[4] * y + H[5]) / w,
  ];
}

describe('solveHomography', () => {
  test('identity maps unit square to itself', () => {
    const H = solveHomography(unitSquare, unitSquare);
    expect(H).not.toBeNull();
    for (const [x, y] of unitSquare) {
      const [u, v] = applyH(H, x, y);
      expect(u).toBeCloseTo(x, 6);
      expect(v).toBeCloseTo(y, 6);
    }
  });

  test('recovers arbitrary destination corners', () => {
    const dst = [[100, 100], [500, 120], [480, 400], [80, 380]];
    const H = solveHomography(unitSquare, dst);
    expect(H).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const [u, v] = applyH(H, unitSquare[i][0], unitSquare[i][1]);
      expect(u).toBeCloseTo(dst[i][0], 4);
      expect(v).toBeCloseTo(dst[i][1], 4);
    }
  });

  test('returns null for degenerate quad (three colinear)', () => {
    const degen = [[0, 0], [1, 0], [2, 0], [0, 1]];
    const H = solveHomography(unitSquare, degen);
    expect(H).toBeNull();
  });
});

describe('cssMatrix3d', () => {
  test('produces 16 numbers in column-major order', () => {
    const H = [1, 0, 10, 0, 1, 20, 0, 0];
    const s = cssMatrix3d(H);
    expect(s).toMatch(/^matrix3d\(/);
    expect(s).toMatch(/\)$/);
    const nums = s.slice(9, -1).split(',').map(n => Number(n.trim()));
    expect(nums).toHaveLength(16);
    // column 1: a, d, 0, g -> 1, 0, 0, 0
    expect(nums.slice(0, 4)).toEqual([1, 0, 0, 0]);
    // column 4: c, f, 0, i -> 10, 20, 0, 1
    expect(nums.slice(12, 16)).toEqual([10, 20, 0, 1]);
  });
});
