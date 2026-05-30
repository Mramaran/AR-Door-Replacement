# Corner-Keypoint Accuracy Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each code task follows TDD (@superpowers:test-driven-development).

**Goal:** Remove the consistent corner-keypoint offset so the detection outline hugs the real door/window on mobile, stable as the browser URL bar shows/hides.

**Architecture:** Unify the capture pipeline on one viewport box. Extract a pure `computeCoverCrop` helper (replicates `object-fit: cover`) and feed it the `<video>` element's rendered box instead of `window.innerWidth/innerHeight`, eliminating the mobile `100vh` vs `innerHeight` mismatch. Add an inert `applyCalibration` correction (3 constants) and a `?calib=1` dump to mop up any residual bias without a retrain.

**Tech Stack:** React (CRA / react-scripts), Jest (`@testing-library`), plain JS. Frontend-only — no backend/model change.

**Design reference:** `docs/plans/2026-05-30-corner-accuracy-design.md`

---

## Task 0: Pick the source of truth (one-time setup)

The frontend exists in two byte-identical copies: the original `...\ARDoor` (has `node_modules`, where you currently run) and `ar-door-replacement\frontend` (canonical git repo, **no** `node_modules` yet). To avoid drift, **make `ar-door-replacement\frontend` the single source of truth**: do the work and commits there, run it there, and leave `...\ARDoor` untouched. The backend keeps running from the original `...\visualiser\visualiser` — the frontend proxies to `:5000` regardless of where it runs.

**Step 1: Install deps in the canonical frontend (first time only)**

Run (PowerShell):
```powershell
cd "D:\Works\Designzz media\AR door placement\ar-door-replacement\frontend"
npm install
```
Expected: `node_modules/` created; no errors.

**Step 2: Confirm the existing test suite is green before changing anything**

Run:
```powershell
npm test -- --watchAll=false
```
Expected: all existing suites PASS (App, DetectionView, geom, homography).

> If you instead choose to keep running from `...\ARDoor`, apply every edit below to that copy too (see Task 7). Decide now; don't split work across both.

---

## Task 1: `computeCoverCrop` pure helper (TDD)

**Files:**
- Modify: `ar-door-replacement/frontend/src/geom.js`
- Test: `ar-door-replacement/frontend/src/geom.test.js`

**Step 1: Write the failing tests**

Append to `src/geom.test.js`:
```js
import { computeCoverCrop } from './geom';

describe('computeCoverCrop (object-fit: cover replication)', () => {
  test('video wider than box crops left/right, centered', () => {
    // video 1920x1080 (16:9), box 1000x1000 (1:1)
    const { sx, sy, sw, sh } = computeCoverCrop(1920, 1080, 1000, 1000);
    expect(sh).toBeCloseTo(1080);            // full height kept
    expect(sw).toBeCloseTo(1080);            // width = height * boxAspect(1.0)
    expect(sx).toBeCloseTo((1920 - 1080) / 2); // 420 — centered
    expect(sy).toBeCloseTo(0);
  });

  test('video taller than box crops top/bottom, centered', () => {
    // video 1080x1920 (portrait), box 1000x1000 (1:1)
    const { sx, sy, sw, sh } = computeCoverCrop(1080, 1920, 1000, 1000);
    expect(sw).toBeCloseTo(1080);
    expect(sh).toBeCloseTo(1080);            // height = width / boxAspect(1.0)
    expect(sy).toBeCloseTo((1920 - 1080) / 2);
    expect(sx).toBeCloseTo(0);
  });

  test('matching aspect keeps the full frame', () => {
    const { sx, sy, sw, sh } = computeCoverCrop(1920, 1080, 1280, 720); // both 16:9
    expect(sx).toBeCloseTo(0);
    expect(sy).toBeCloseTo(0);
    expect(sw).toBeCloseTo(1920);
    expect(sh).toBeCloseTo(1080);
  });

  test('degenerate box dims fall back to the full frame', () => {
    expect(computeCoverCrop(1920, 1080, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });
});
```

**Step 2: Run the tests to verify they fail**

Run:
```powershell
npm test -- --watchAll=false --testPathPattern=geom
```
Expected: FAIL — `computeCoverCrop is not a function` / import undefined.

**Step 3: Write the minimal implementation**

Append to `src/geom.js`:
```js
// Replicate CSS `object-fit: cover`: centre-crop a source image of
// (videoW x videoH) to the aspect ratio of a (boxW x boxH) box, returning the
// source rectangle {sx, sy, sw, sh} to draw. Degenerate dims → full frame.
export function computeCoverCrop(videoW, videoH, boxW, boxH) {
  if (!videoW || !videoH || !boxW || !boxH) {
    return { sx: 0, sy: 0, sw: videoW || 0, sh: videoH || 0 };
  }
  const boxAspect = boxW / boxH;
  const videoAspect = videoW / videoH;
  let sx = 0, sy = 0, sw = videoW, sh = videoH;
  if (videoAspect > boxAspect) {
    sw = videoH * boxAspect;          // crop left/right
    sx = (videoW - sw) / 2;
  } else {
    sh = videoW / boxAspect;          // crop top/bottom
    sy = (videoH - sh) / 2;
  }
  return { sx, sy, sw, sh };
}
```

**Step 4: Run the tests to verify they pass**

Run:
```powershell
npm test -- --watchAll=false --testPathPattern=geom
```
Expected: PASS (all `computeCoverCrop` tests green).

**Step 5: Commit**

```powershell
git add src/geom.js src/geom.test.js
git commit -m "feat: add computeCoverCrop (object-fit cover replication) + tests"
```

---

## Task 2: Wire `computeCoverCrop` into the capture loop

**Files:**
- Modify: `ar-door-replacement/frontend/src/DetectionView.js` (import; replace the crop block at ~lines 221-245)

**Step 1: Add the import**

At the top of `src/DetectionView.js`, after `import './App.css';`, add:
```js
import { computeCoverCrop } from './geom';
```

**Step 2: Replace the `window.inner*` crop block**

Find this block inside `captureFrame()` (currently ~lines 221-245):
```js
      // Letterbox / centre-crop the video to the SCREEN aspect ratio before
      // sending to the detector. The video element uses object-fit:cover, so
      // the on-screen view is already centre-cropped to screen aspect. We
      // mirror that crop here so the detector sees the same frame the user
      // sees — which then matches WebXR's viewport later in AR mode.
      const screenW = window.innerWidth  || 1;
      const screenH = window.innerHeight || 1;
      const screenAspect = screenW / screenH;
      const videoAspect  = video.videoWidth / video.videoHeight;

      let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
      if (videoAspect > screenAspect) {
        // video wider than screen — crop horizontally
        sw = video.videoHeight * screenAspect;
        sx = (video.videoWidth - sw) / 2;
      } else {
        // video taller than screen — crop vertically
        sh = video.videoWidth / screenAspect;
        sy = (video.videoHeight - sh) / 2;
      }

      // Canvas matches the CROPPED dimensions (not raw video), so detection
      // corners come back in [0,1] of the cropped frame = screen aspect.
      const capW = Math.round(sw);
      const capH = Math.round(sh);
```
Replace it with:
```js
      // Centre-crop the camera frame to the SAME box the <video> and overlay
      // use (object-fit:cover against the element's rendered box). Referencing
      // the element box via getBoundingClientRect — not window.innerWidth/Height
      // — keeps the detector's frame aligned with what the user sees on mobile,
      // where the URL bar makes window.innerHeight < 100vh and biased every
      // returned corner. See docs/plans/2026-05-30-corner-accuracy-design.md.
      const box = video.getBoundingClientRect();
      const { sx, sy, sw, sh } = computeCoverCrop(
        video.videoWidth, video.videoHeight, box.width, box.height,
      );
      const capW = Math.round(sw);
      const capH = Math.round(sh);
```
(The lines below — canvas sizing and `ctx.drawImage(video, sx, sy, sw, sh, 0, 0, capW, capH)` — stay unchanged.)

**Step 3: Run the full suite to confirm no regression**

Run:
```powershell
npm test -- --watchAll=false
```
Expected: all suites PASS (logic moved into the tested helper; no behavior tests broken).

**Step 4: Commit**

```powershell
git add src/DetectionView.js
git commit -m "fix: crop capture frame to the video element box, not window.inner* (removes mobile URL-bar corner offset)"
```

---

## Task 3: `applyCalibration` pure helper (TDD)

**Files:**
- Modify: `ar-door-replacement/frontend/src/geom.js`
- Test: `ar-door-replacement/frontend/src/geom.test.js`

**Step 1: Write the failing tests**

Append to `src/geom.test.js`:
```js
import { applyCalibration } from './geom';

const SQUARE = {
  topLeft:     { x: 0.4, y: 0.4 },
  topRight:    { x: 0.6, y: 0.4 },
  bottomRight: { x: 0.6, y: 0.6 },
  bottomLeft:  { x: 0.4, y: 0.6 },
  isTilted: false,
};

describe('applyCalibration (constant systematic-bias correction)', () => {
  test('identity returns the same object (no-op)', () => {
    expect(applyCalibration(SQUARE, { scale: 1, dx: 0, dy: 0 })).toBe(SQUARE);
  });

  test('null corners → null', () => {
    expect(applyCalibration(null, { scale: 1.1 })).toBeNull();
  });

  test('scale expands about the centroid', () => {
    const out = applyCalibration(SQUARE, { scale: 2 }); // centroid (0.5,0.5)
    expect(out.topLeft.x).toBeCloseTo(0.3);     // 0.5 + (0.4-0.5)*2
    expect(out.topLeft.y).toBeCloseTo(0.3);
    expect(out.bottomRight.x).toBeCloseTo(0.7);
    expect(out.bottomRight.y).toBeCloseTo(0.7);
  });

  test('dx/dy shift all corners', () => {
    const out = applyCalibration(SQUARE, { dx: 0.05, dy: -0.02 });
    expect(out.topLeft.x).toBeCloseTo(0.45);
    expect(out.topLeft.y).toBeCloseTo(0.38);
    expect(out.topRight.x).toBeCloseTo(0.65);
  });

  test('preserves isTilted', () => {
    expect(applyCalibration(SQUARE, { scale: 1.1 }).isTilted).toBe(false);
  });
});
```

**Step 2: Run to verify failure**

Run:
```powershell
npm test -- --watchAll=false --testPathPattern=geom
```
Expected: FAIL — `applyCalibration is not a function`.

**Step 3: Minimal implementation**

Append to `src/geom.js`:
```js
// Apply a constant correction to detection corners (normalized [0,1]) to remove
// a measured systematic bias. `scale` expands/shrinks the quad about its
// centroid; `dx`/`dy` shift it. Identity ({scale:1,dx:0,dy:0}) is a no-op.
// Extra props (e.g. isTilted) are preserved.
export function applyCalibration(corners, calib) {
  if (!corners) return null;
  const { scale = 1, dx = 0, dy = 0 } = calib || {};
  if (scale === 1 && dx === 0 && dy === 0) return corners;
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
  const cx = (corners.topLeft.x + corners.topRight.x + corners.bottomRight.x + corners.bottomLeft.x) / 4;
  const cy = (corners.topLeft.y + corners.topRight.y + corners.bottomRight.y + corners.bottomLeft.y) / 4;
  const out = { ...corners };
  for (const k of keys) {
    out[k] = {
      x: cx + (corners[k].x - cx) * scale + dx,
      y: cy + (corners[k].y - cy) * scale + dy,
    };
  }
  return out;
}
```

**Step 4: Run to verify pass**

Run:
```powershell
npm test -- --watchAll=false --testPathPattern=geom
```
Expected: PASS.

**Step 5: Commit**

```powershell
git add src/geom.js src/geom.test.js
git commit -m "feat: add applyCalibration corner-bias correction + tests"
```

---

## Task 4: Wire `applyCalibration` + `CORNER_CALIB` into the receive path

**Files:**
- Modify: `ar-door-replacement/frontend/src/DetectionView.js`

**Step 1: Extend the import**

Change the geom import added in Task 2 to:
```js
import { computeCoverCrop, applyCalibration } from './geom';
```

**Step 2: Add the calibration constant**

After `const JPEG_QUALITY = 0.75;` (~line 19), add:
```js
// Constant correction for any residual systematic corner bias measured after the
// coordinate fix. Identity = no-op. Tune via ?calib=1 (see below). scale expands
// about the centroid; dx/dy shift in normalized [0,1] space.
const CORNER_CALIB = { scale: 1.0, dx: 0, dy: 0 };
```

**Step 3: Apply it where corners arrive**

Find (in `ws.onmessage`, ~lines 299-302):
```js
        const rawLive = {
          door:   scaleCorners(msg.door,   v.w, v.h),
          window: scaleCorners(msg.window, v.w, v.h),
        };
```
Replace with:
```js
        const rawLive = {
          door:   scaleCorners(applyCalibration(msg.door,   CORNER_CALIB), v.w, v.h),
          window: scaleCorners(applyCalibration(msg.window, CORNER_CALIB), v.w, v.h),
        };
```

**Step 4: Run the full suite (identity must not change behavior)**

Run:
```powershell
npm test -- --watchAll=false
```
Expected: all suites PASS (CORNER_CALIB is identity → no-op).

**Step 5: Commit**

```powershell
git add src/DetectionView.js
git commit -m "feat: apply CORNER_CALIB correction to incoming corners (identity by default)"
```

---

## Task 5: `?calib=1` corner dump (measurement aid)

**Files:**
- Modify: `ar-door-replacement/frontend/src/DetectionView.js`

**Step 1: Add the flag**

After the `CORNER_CALIB` constant, add:
```js
// Dev aid: open the app with ?calib=1 to log each frame's raw normalized corners
// to the console. Compare a handful against known-true openings, then set
// CORNER_CALIB above. Off by default — zero cost in normal use.
const CALIB_DUMP = typeof window !== 'undefined' &&
  /[?&]calib=1\b/.test(window.location.search);
```

**Step 2: Log raw corners in onmessage**

Inside `ws.onmessage`, right after the `if (msg && !msg.error) {` line, add:
```js
        if (CALIB_DUMP && (msg.door || msg.window)) {
          // eslint-disable-next-line no-console
          console.log('[calib]', msg.frameId, JSON.stringify({ door: msg.door, window: msg.window }));
        }
```

**Step 3: Run the full suite**

Run:
```powershell
npm test -- --watchAll=false
```
Expected: all suites PASS.

**Step 4: Commit**

```powershell
git add src/DetectionView.js
git commit -m "feat: add ?calib=1 raw-corner console dump for offset measurement"
```

---

## Task 6: Device verification (and tune calibration only if needed)

No code unless a residual remains. This is the real proof of Approach A.

**Step 1: Start the backend (original folder, untouched)**

```powershell
cd "D:\Works\Designzz media\AR door placement\visualiser\visualiser"
& ".\.venv\Scripts\python.exe" app.py
```
Expected: `Running on http://0.0.0.0:5000`.

**Step 2: Start the frontend (canonical copy) + tunnel**

```powershell
cd "D:\Works\Designzz media\AR door placement\ar-door-replacement\frontend"
npm start
# second terminal:
ngrok http 3000
```

**Step 3: Verify on an Android phone**

Open the `https://…ngrok-free.app` URL, grant camera, point at a door/window:
- The green outline now **hugs the opening**.
- Scroll so the URL bar hides/shows → the outline **stays locked** (the old vertical jump is gone).
- Sanity-check desktop `http://localhost:3000` is unchanged.

**Step 4: (Only if a residual offset remains) measure + set CORNER_CALIB**

Open with `?calib=1` appended, read ~10 `[calib]` lines from the console for openings whose true corners you know, compute the mean residual, and set `CORNER_CALIB` (e.g. `{ scale: 1.03, dx: 0, dy: -0.01 }`). Re-verify, then:
```powershell
git add src/DetectionView.js
git commit -m "calib: set CORNER_CALIB from measured residual offset"
```

---

## Task 7: (Conditional) keep the run/push copy in sync

Only if you chose in Task 0 to **also** run from the original `...\ARDoor`: copy the three edited files so the copies don't drift, then verify.

**Files to mirror:** `src/geom.js`, `src/geom.test.js`, `src/DetectionView.js`

```powershell
$src = "D:\Works\Designzz media\AR door placement\ar-door-replacement\frontend\src"
$dst = "D:\Works\Designzz media\AR door placement\ARDoor\src"
Copy-Item "$src\geom.js","$src\geom.test.js","$src\DetectionView.js" $dst -Force
cd "D:\Works\Designzz media\AR door placement\ARDoor"
npm test -- --watchAll=false
```
Expected: ARDoor suite PASS. (Recommended instead: retire `...\ARDoor` as a run location and use the canonical copy only.)

---

## Done criteria
- New unit tests for `computeCoverCrop` and `applyCalibration` pass; full suite green.
- On mobile, the detection outline sits on the opening and stays put across URL-bar changes.
- No desktop regression.
- `CORNER_CALIB` is identity unless measurement justified otherwise.
- Out of scope (future): retrain (Approach C), perspective-warp overlay via `homography.js`, affine/temporal calibration.
