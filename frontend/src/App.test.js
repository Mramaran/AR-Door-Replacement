// WebXR + Three.js WebGLRenderer cannot be exercised in jsdom — the renderer
// throws on construction (no real WebGL context). Per the prior PNG-overlay
// implementation plan, WebXR rendering is verified manually on an Android
// Chrome device with ARCore, not in unit tests.
//
// We keep this smoke test to guard against accidental breakage of the App
// module itself (broken imports, syntax errors, etc.) without trying to
// render the WebXR scene.
test('App module loads without errors', () => {
  const App = require('./App').default;
  expect(typeof App).toBe('function');
});
