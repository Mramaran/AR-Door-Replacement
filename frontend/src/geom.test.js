import { pointInQuad } from './geom';

const square = {
  topLeft:     { x: 0,   y: 0   },
  topRight:    { x: 100, y: 0   },
  bottomRight: { x: 100, y: 100 },
  bottomLeft:  { x: 0,   y: 100 },
};

const tilted = {
  topLeft:     { x: 50,  y: 10  },
  topRight:    { x: 150, y: 30  },
  bottomRight: { x: 140, y: 130 },
  bottomLeft:  { x: 40,  y: 110 },
};

describe('pointInQuad', () => {
  test('center of axis-aligned square is inside', () => {
    expect(pointInQuad(50, 50, square)).toBe(true);
  });

  test('point outside square is outside', () => {
    expect(pointInQuad(200, 200, square)).toBe(false);
    expect(pointInQuad(-10, 50, square)).toBe(false);
    expect(pointInQuad(50, -10, square)).toBe(false);
    expect(pointInQuad(150, 50, square)).toBe(false);
  });

  test('center of tilted quad is inside', () => {
    const cx = (50 + 150 + 140 + 40) / 4;
    const cy = (10 + 30 + 130 + 110) / 4;
    expect(pointInQuad(cx, cy, tilted)).toBe(true);
  });

  test('point clearly outside tilted quad is outside', () => {
    expect(pointInQuad(0, 0, tilted)).toBe(false);
    expect(pointInQuad(200, 200, tilted)).toBe(false);
  });
});
