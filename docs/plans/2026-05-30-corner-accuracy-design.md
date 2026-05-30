# Design: Fix consistent corner-keypoint offset (detection accuracy)

- **Date:** 2026-05-30
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Scope:** Approach A (coordinate/viewport fix) + Approach B (measurement + calibration). Approach C (retrain) is out of scope.

## Problem

The detector finds the door/window, but the four corner keypoints don't sit
tightly on the real opening — they land with a **consistent, same-direction
offset** (a systematic bias, mostly vertical, observed on mobile). The green
detection outline is drawn from the actual four corners (`drawQuad`), so loose
corners there mean the keypoints themselves (or their mapping to screen) are off.

## Diagnosis (root cause)

The capture/display pipeline references **two different viewport boxes**:

| Stage | Reference box | File |
|-------|---------------|------|
| Send-crop (frame to detector) | `window.innerWidth / innerHeight` (current **visible** viewport) | `frontend/src/DetectionView.js:226-240` |
| Video display (`object-fit: cover`) | `100vw × 100vh` element box (**large** viewport) | `frontend/src/DetectionView.js:389-397` |
| Corner rescale (`scaleCorners`) | `overlay.clientWidth/clientHeight` = `100vw × 100vh` | `frontend/src/DetectionView.js:296-302` |

On mobile, `window.innerHeight` shrinks by the browser URL-bar height while
`100vh` does not. So the detector receives a frame cropped to one height, but the
returned corners are scaled back against a taller box. The fixed difference
(`100vh − window.innerHeight`) produces a **fixed vertical offset/scale** on every
corner. Desktop has no URL bar → no visible error, which matches the symptom.

## Goals / non-goals

**Goals**
- Remove the systematic corner offset so the outline hugs the opening on mobile,
  stable as the URL bar shows/hides.
- Keep the change small, frontend-only, no model/backend change.

**Non-goals (YAGNI)**
- No model retrain (Approach C) — reserved for a confirmed label-convention bias.
- No jitter/temporal filter beyond the existing EMA (that's the "wobble" pattern,
  not this one).
- No perspective-warp of the replacement image (separate "skewed overlay" issue).
- No affine/skew calibration unless measurement proves it's needed.

## Approach A — coordinate/viewport fix (root cause, free)

Make the send-crop reference the **same box** the video and overlay use.

1. Add a pure helper `computeCoverCrop(videoW, videoH, boxW, boxH) → {sx, sy, sw, sh}`
   that reproduces `object-fit: cover` (centre-crop to the box aspect).
2. In `captureFrame()`, replace the `window.innerWidth/innerHeight` block with
   `computeCoverCrop(video.videoWidth, video.videoHeight, box.width, box.height)`,
   where `box = video.getBoundingClientRect()`.

Now send-crop, display, and rescale all reference the identical `100vw × 100vh`
element → the URL-bar/`vh` mismatch disappears.

### Data flow (changed stage marked ⬅)

```
camera frame (videoWidth×videoHeight)
   ▼  cover-crop to the VIDEO ELEMENT box (getBoundingClientRect)   ⬅ was window.inner*
  JPEG → WebSocket → YOLO → corners normalized [0,1] of the cropped frame
   ▼  applyCalibration(·, CORNER_CALIB)   (identity no-op by default — see B)
   ▼  scaleCorners(overlay.clientWidth, clientHeight)   (unchanged — same box)
   ▼  smoothCorners → drawQuad / placed <img>
```

### Files touched (A)
- `frontend/src/geom.js` — add pure `computeCoverCrop(...)`
- `frontend/src/geom.test.js` — unit tests
- `frontend/src/DetectionView.js` — use the helper; remove `window.inner*` crop

## Approach B — measurement + calibration (no retrain; inert until tuned)

Activates only if a residual bias remains after A. Defaults to a no-op, so A can
ship alone.

1. **Measurement (dev-only):** a `?calib=1` URL flag that, on tap, dumps the
   current detected normalized corners (console / JSON download). Collect ~10–20
   against openings with known true corners; compute the mean residual.
2. **Correction model:** a single constant, applied by a pure function before
   smoothing/scaling:
   ```js
   const CORNER_CALIB = { scale: 1.0, dx: 0, dy: 0 }; // identity by default
   // scale: expand/shrink the quad about its centroid (fixes inward/outward bias)
   // dx, dy: shift in normalized space (fixes directional offset)
   ```
   Three numbers — all a *consistent* error needs. Upgrade to a 6-param affine
   only if measurement reveals skew/shear.

### Files touched (B)
- `frontend/src/geom.js` — `applyCalibration(corners, calib)` (pure) + tests
- `frontend/src/DetectionView.js` — call it in `onmessage`; add `CORNER_CALIB` and the `?calib=1` dump
- No new files; no backend changes.

## Testing

**Unit (Jest, extends `geom.test.js`):**
- `computeCoverCrop`: video wider/taller/equal aspect vs box → assert `{sx,sy,sw,sh}` + centring; guard zero dims.
- `applyCalibration`: identity no-op; `scale` symmetric about centroid; `dx/dy` shift; combined.

**Device:**
1. Phone, URL bar visible → outline hugs the opening.
2. Hide/show URL bar (scroll) → outline stays locked (old jump gone).
3. Desktop → unchanged (regression).

**Success criteria:** corners sit on the opening's edges on mobile, stable across
URL-bar state; existing 24 tests still pass; no desktop regression.

## Ship sequence
1. **A** — helper + tests + wire into `captureFrame`; verify on phone (likely the whole fix).
2. **Measure** residual; **B** only if needed — set the 3 calibration numbers; re-verify.
3. Commit.

## Implementation note
The change lands in the **frontend source**. The app is currently run from the
original `...\ARDoor`, while the canonical copy is `ar-door-replacement\frontend`
(byte-identical today). The fix must go to whichever copy is actually run/pushed;
flag this in the implementation plan so the two copies don't drift.

## Risks
- **Low.** Frontend-only; pure-function core; no backend/model change. If a label
  bias also exists, B mops up the residual without a retrain.

## Out of scope / future
- Approach C: relabel + fine-tune YOLOv8-pose (if a directional bias persists after A+B).
- Perspective-warp the replacement image via `homography.js` (the "skewed overlay" issue).
- Affine/skew calibration; temporal/Kalman filtering for jitter.
