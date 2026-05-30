import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./App.css";
import DetectionView from "./DetectionView";

const CATALOGUE = [
  { id: "wooden",  label: "Wooden Door",   img: "/WoodenDoor.png",               type: "door"   },
  { id: "metal",   label: "Metal Door",    img: "/MetalDoor.png",                type: "door"   },
  { id: "pink",    label: "Pink Door",     img: "/PinkDoor.png.png",             type: "door"   },
  { id: "violet",  label: "Violet Door",   img: "/violetDoorWithHandle.png.png", type: "door"   },
  { id: "green-w", label: "Green Window",  img: "/GreenWindow.png",              type: "window" },
  { id: "wood-w",  label: "Wooden Window", img: "/WoodenWindow.png",             type: "window" },
];

const doorCorners = {
  topLeft:     { x: 270, y: 150  },
  topRight:    { x: 960, y: 150  },
  bottomLeft:  { x: 270, y: 1510 },
  bottomRight: { x: 960, y: 1510 },
};
const windowCorners = {
  topLeft:     { x: 285, y: 185  },
  topRight:    { x: 895, y: 185  },
  bottomLeft:  { x: 285, y: 1125 },
  bottomRight: { x: 895, y: 1125 },
};

const aspectFor = (c) =>
  (c.topRight.x - c.topLeft.x) / (c.bottomLeft.y - c.topLeft.y);

const DOOR_H = 2.1;
const DOOR_W = DOOR_H * aspectFor(doorCorners);
const WIN_H  = 1.4;
const WIN_W  = WIN_H  * aspectFor(windowCorners);

const sizeForType = (type) =>
  type === "window" ? { w: WIN_W, h: WIN_H } : { w: DOOR_W, h: DOOR_H };

// Fallback depth when ARCore hasn't returned a hit yet.
const RETICLE_DISTANCE_M = 1.5;

const textureLoader = new THREE.TextureLoader();
const textureCache  = {};
function loadTexture(url) {
  return new Promise((resolve, reject) => {
    if (textureCache[url]) { resolve(textureCache[url]); return; }
    textureLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        textureCache[url] = tex;
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

function XRView({ initialSelection, onExit } = {}) {
  const overlayRef  = useRef(null);
  const initialId   = (initialSelection && initialSelection.id)   || CATALOGUE[0].id;
  const initialType = (initialSelection && initialSelection.type) || "door";
  const selectedRef = useRef(initialId);
  const onExitRef   = useRef(onExit);
  onExitRef.current = onExit;
  const statusRef   = useRef(null);
  const [inAR, setInAR] = useState(false);
  const [selectedId, setSelectedId] = useState(initialId);
  const [filterType, setFilterType] = useState(initialType);

  const setStatus = (msg) => {
    if (statusRef.current) statusRef.current.textContent = msg;
  };

  const visibleItems = CATALOGUE.filter((c) => c.type === filterType);

  const changeFilter = (type) => {
    if (type === filterType) return;
    setFilterType(type);
    const firstOfType = CATALOGUE.find((c) => c.type === type);
    if (firstOfType) {
      selectedRef.current = firstOfType.id;
      setSelectedId(firstOfType.id);
    }
  };

  useEffect(() => {
    let lastStatusText = '';
    const updateStatus = (msg) => {
      if (msg === lastStatusText) return;
      lastStatusText = msg;
      setStatus(msg);
    };

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled       = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    const buildReticle = (w, h) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x2979ff, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x82b1ff })
      ));
      mesh.visible = false;
      return mesh;
    };

    // Size the reticle from the detected aspect ratio paired with a known
    // physical height (2.1 m door / 1.4 m window). The corners passed from
    // DetectionView are in [0,1] of the screen-aspect-cropped frame, so the
    // raw (W/H) ratio is the SCREEN-FRACTION aspect, not the pixel-aspect
    // (which equals the real-world aspect for a wall-facing plane). They
    // differ by the screen aspect factor:
    //   pixel_aspect = (W_frac * screen_W_px) / (H_frac * screen_H_px)
    //                = (W_frac / H_frac) * (screen_W_px / screen_H_px)
    //                = [0,1]_aspect * screen_aspect
    // Multiplying by window.innerWidth/innerHeight recovers the real aspect.
    // Verified against the original aspectFor(doorCorners) calibration:
    // 0.902 * 0.563 = 0.507, matching pixel-aspect 690/1360 = 0.507.
    const sizeFromInitial = () => {
      if (!initialSelection || !initialSelection.corners) return null;
      const c = initialSelection.corners;
      const detW = (c.topRight.x - c.topLeft.x);
      const detH = (c.bottomLeft.y - c.topLeft.y);
      if (detW <= 0 || detH <= 0) return null;
      const screenAspect = (window.innerWidth || 1) / (window.innerHeight || 1);
      const aspect = (detW / detH) * screenAspect;
      const h = initialSelection.type === 'window' ? WIN_H : DOOR_H;
      return { w: h * aspect, h };
    };

    let reticleType = CATALOGUE.find((c) => c.id === selectedRef.current).type;
    let reticleSize = sizeFromInitial() || sizeForType(reticleType);
    let reticle     = buildReticle(reticleSize.w, reticleSize.h);
    scene.add(reticle);

    const disposeReticle = (r) => {
      r.geometry.dispose();
      r.material.dispose();
      r.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
    };

    // When the user switches door↔window, rebuild the reticle at catalogue
    // default size (detected aspect is no longer meaningful for the new type).
    const ensureReticleMatchesSelection = () => {
      const item = CATALOGUE.find((c) => c.id === selectedRef.current);
      if (!item || item.type === reticleType) return;
      scene.remove(reticle);
      disposeReticle(reticle);
      reticleType = item.type;
      reticleSize = sizeForType(reticleType);
      reticle     = buildReticle(reticleSize.w, reticleSize.h);
      scene.add(reticle);
    };

    let placedMeshes  = [];
    let xrSession     = null;
    let viewerSpace   = null;
    let hitTestSource = null;

    async function startAR() {
      try {
        if (!navigator.xr) { alert("WebXR not available. Use Chrome on Android."); return; }
        if (!(await navigator.xr.isSessionSupported("immersive-ar"))) {
          alert("AR not supported on this device."); return;
        }
        xrSession = await navigator.xr.requestSession("immersive-ar", {
          requiredFeatures: ["dom-overlay", "hit-test"],
          optionalFeatures: [],
          domOverlay: { root: overlayRef.current },
        });
        renderer.xr.setReferenceSpaceType("local");
        await renderer.xr.setSession(xrSession);

        try {
          viewerSpace   = await xrSession.requestReferenceSpace("viewer");
          hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });
        } catch (e) {
          console.warn("[xr] hit-test setup failed:", e && e.message);
        }

        setInAR(true);
        setStatus("Point at a wall…");
        xrSession.addEventListener("end",    onEnd);
        xrSession.addEventListener("select", onTap);
        renderer.setAnimationLoop((ts, frame) => {
          try { onFrame(ts, frame); }
          catch (e) {
            console.error("[xr] onFrame threw:", e);
            setStatus("[ERR] onFrame: " + ((e && e.message) || e).toString().slice(0, 80));
          }
        });
      } catch (e) {
        console.error("[xr] startAR failed:", e);
        alert("startAR failed: " + ((e && e.message) || e));
      }
    }

    function onEnd() {
      placedMeshes.forEach((m) => {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      });
      placedMeshes    = [];
      reticle.visible = false;
      renderer.setAnimationLoop(null);
      setInAR(false);
      xrSession = null;

      if (hitTestSource) {
        try { hitTestSource.cancel(); } catch { /* noop */ }
        hitTestSource = null;
      }
      viewerSpace = null;

      if (onExitRef.current) onExitRef.current();
    }

    async function placeMeshAt(item, position, quaternion, scale) {
      let texture;
      try   { texture = await loadTexture(item.img); }
      catch { setStatus("Could not load " + item.img); return null; }

      const geo  = new THREE.PlaneGeometry(reticleSize.w, reticleSize.h);
      const mat  = new THREE.MeshBasicMaterial({
        map: texture, side: THREE.DoubleSide, transparent: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      mesh.quaternion.copy(quaternion);
      // Apply the same scale the reticle had — this is what makes the placed
      // door match the reticle's displayed size exactly.
      if (scale) mesh.scale.copy(scale);

      scene.add(mesh);
      placedMeshes.push(mesh);
      return mesh;
    }

    async function onTap() {
      const item = CATALOGUE.find((c) => c.id === selectedRef.current);
      if (!item || !reticle.visible) return;
      setStatus("Placing " + item.label + "...");
      // Snapshot at tap time — reticle updates every frame, so capture
      // position/quaternion/scale before the async texture load.
      const snapPos   = reticle.position.clone();
      const snapQuat  = reticle.quaternion.clone();
      const snapScale = reticle.scale.clone();
      const mesh = await placeMeshAt(item, snapPos, snapQuat, snapScale);
      if (mesh) setStatus("Placed! Aim and tap to add another");
    }

    // Position AND size the reticle from the detection JSON corners so its
    // four screen-space corners project exactly back to the four [0,1] image
    // coords passed in initialSelection.corners.
    //
    // Each frame:
    //   1) Hit-test along the viewer's -Z ray to get the wall's perpendicular
    //      depth D (https://immersive-web.github.io/hit-test/).
    //   2) For each of the 4 detection corners, unproject from NDC at depth D
    //      to a world-space point on a plane perpendicular to the camera:
    //        cam_x = ndc_x * D / proj[0]   (proj[0] = 1/tan(HFOV/2))
    //        cam_y = ndc_y * D / proj[5]   (proj[5] = 1/tan(VFOV/2))
    //        cam_z = -D
    //        world = viewerPos + cam_x*right + cam_y*up + D*forward
    //   3) Reticle position = centroid of the 4 world corners.
    //      Reticle scale = world spans (TL→TR and TL→BL) divided by base size.
    //      Reticle orientation = aligned with hit-test surface normal (Hit Test
    //      spec §4.3: pose's local +Y is the surface normal).
    //
    // The reticle therefore appears at the same screen rectangle as the
    // detection box, at the wall's depth, oriented flush to the wall.
    function onFrame(timestamp, frame) {
      if (!frame) { renderer.render(scene, camera); return; }
      const refSpace   = renderer.xr.getReferenceSpace();
      const viewerPose = frame.getViewerPose(refSpace);
      if (!viewerPose) { renderer.render(scene, camera); return; }

      ensureReticleMatchesSelection();

      const t       = viewerPose.transform;
      const camQuat = new THREE.Quaternion(
        t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w
      );
      const forward     = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
      const cameraRight = new THREE.Vector3(1, 0,  0).applyQuaternion(camQuat);
      const cameraUp    = new THREE.Vector3(0, 1,  0).applyQuaternion(camQuat);
      const viewerPos   = new THREE.Vector3(t.position.x, t.position.y, t.position.z);

      // WebXR projection matrix (column-major, OpenGL convention).
      // proj[0] = 1/tan(HFOV/2), proj[5] = 1/tan(VFOV/2).
      const proj = viewerPose.views.length > 0
        ? viewerPose.views[0].projectionMatrix
        : null;

      let hitPose = null;
      if (hitTestSource) {
        const hits = frame.getHitTestResults(hitTestSource);
        if (hits.length > 0) hitPose = hits[0].getPose(refSpace);
      }

      // Wall depth D = perpendicular distance from camera plane to hit point.
      // Since the hit-test ray fires along -Z in viewer space, the hit point's
      // camera-space Z magnitude IS its perpendicular depth. Use dot(forward)
      // to get this from the world-space delta.
      let wallDepth   = RETICLE_DISTANCE_M;
      let planeNormal = forward.clone().negate();

      if (hitPose) {
        const hitPos = new THREE.Vector3(
          hitPose.transform.position.x,
          hitPose.transform.position.y,
          hitPose.transform.position.z
        );
        const projected = hitPos.clone().sub(viewerPos).dot(forward);
        if (projected > 0.05) wallDepth = projected;

        const poseQuat = new THREE.Quaternion(
          hitPose.transform.orientation.x,
          hitPose.transform.orientation.y,
          hitPose.transform.orientation.z,
          hitPose.transform.orientation.w
        );
        // Hit result local +Y = surface normal (WebXR Hit Test spec §4.3).
        const surfaceNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(poseQuat);
        if (Math.abs(surfaceNormal.y) < 0.7) {
          planeNormal = surfaceNormal.clone().normalize();
        } else {
          const forwardFlat = new THREE.Vector3(forward.x, 0, forward.z);
          if (forwardFlat.lengthSq() < 0.0001) forwardFlat.set(0, 0, -1);
          forwardFlat.normalize();
          planeNormal = forwardFlat.clone().negate();
        }
      }

      const corners = initialSelection && initialSelection.corners;
      if (corners && proj && wallDepth > 0) {
        // [0,1] image coords (Y-down) → NDC ([-1,+1], Y-up).
        const toNDC = (c) => ({ x: c.x * 2 - 1, y: 1 - c.y * 2 });
        const ndcToWorld = (ndcX, ndcY) =>
          viewerPos.clone()
            .addScaledVector(forward,     wallDepth)
            .addScaledVector(cameraRight, (ndcX * wallDepth) / proj[0])
            .addScaledVector(cameraUp,    (ndcY * wallDepth) / proj[5]);

        const nTL = toNDC(corners.topLeft);
        const nTR = toNDC(corners.topRight);
        const nBL = toNDC(corners.bottomLeft);
        const nBR = toNDC(corners.bottomRight);

        const wTL = ndcToWorld(nTL.x, nTL.y);
        const wTR = ndcToWorld(nTR.x, nTR.y);
        const wBL = ndcToWorld(nBL.x, nBL.y);
        const wBR = ndcToWorld(nBR.x, nBR.y);

        const centroid = new THREE.Vector3()
          .add(wTL).add(wTR).add(wBL).add(wBR)
          .multiplyScalar(0.25);

        // World spans of the detection rectangle at wallDepth. TL→TR is the
        // width direction, TL→BL the height direction (in screen space).
        const worldW = wTL.distanceTo(wTR);
        const worldH = wTL.distanceTo(wBL);

        // Wall-aligned basis (right, up, normal) so the reticle sits flush.
        // When the wall is perpendicular to the camera (typical), this also
        // perfectly preserves the screen rect; if the wall tilts, the rect
        // gets a small perspective foreshortening — acceptable for AR.
        const worldUp = new THREE.Vector3(0, 1, 0);
        const right   = new THREE.Vector3().crossVectors(worldUp, planeNormal).normalize();
        const up      = new THREE.Vector3().crossVectors(planeNormal, right).normalize();
        const rm      = new THREE.Matrix4().makeBasis(right, up, planeNormal);

        reticle.position.copy(centroid);
        reticle.quaternion.setFromRotationMatrix(rm);
        reticle.scale.set(worldW / reticleSize.w, worldH / reticleSize.h, 1);
        reticle.visible = true;
        updateStatus(hitPose ? 'Tap to place' : 'Point at a wall…');
      } else {
        reticle.visible = false;
      }

      renderer.render(scene, camera);
    }

    const clickHandler = (e) => {
      const id = e.target && e.target.id;
      if (id === "enter-ar-btn") startAR();
      if (id === "stop-ar-btn")  xrSession && xrSession.end();
      if (id === "delete-btn") {
        const last = placedMeshes.pop();
        if (last) {
          scene.remove(last);
          last.geometry.dispose();
          last.material.dispose();
        }
        setStatus(placedMeshes.length ? "Aim and tap to place" : "All removed");
      }
    };
    document.addEventListener("click", clickHandler);

    const beforeXRSelect = (e) => e.preventDefault();
    const overlayNode    = overlayRef.current;
    overlayNode && overlayNode.addEventListener("beforexrselect", beforeXRSelect);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("click", clickHandler);
      overlayNode && overlayNode.removeEventListener("beforexrselect", beforeXRSelect);
      renderer.domElement.parentNode && renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleBtnStyle = (active) => ({
    flex: 1,
    padding: "0.5rem 0.75rem",
    background: active ? "rgba(41, 121, 255, 0.45)" : "rgba(255, 255, 255, 0.08)",
    color: "#fff",
    fontSize: "0.78rem",
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    border: active ? "1.5px solid #2979ff" : "1.5px solid rgba(255, 255, 255, 0.12)",
    borderRadius: "1rem",
    cursor: "pointer",
    pointerEvents: "all",
    transition: "background 0.15s, border-color 0.15s",
  });

  return (
    <div ref={overlayRef} id="xr-overlay">

      {!inAR && (
        <div id="splash">
          <div className="splash-inner">
            <h1>AR Door Placer</h1>
            <p>Aim at the door you detected, then tap <strong>Enter AR</strong>.</p>
            <p className="sub">Requires Android Chrome + ARCore</p>
            <button id="enter-ar-btn" className="btn-primary">Enter AR</button>
          </div>
        </div>
      )}

      {inAR && (
        <div id="overlay-ui">
          <div id="top-bar">
            <span id="status-hint" ref={statusRef}>Initialising AR…</span>
            <button id="stop-ar-btn" className="btn-stop">✕ Exit</button>
          </div>

          <div
            id="bottom-sheet"
            style={{ flexDirection: "column", alignItems: "stretch" }}
          >
            <div
              id="type-toggle"
              style={{ display: "flex", gap: "0.4rem", width: "100%", marginBottom: "0.6rem" }}
            >
              <button
                type="button"
                style={toggleBtnStyle(filterType === "door")}
                onClick={() => changeFilter("door")}
              >
                Doors
              </button>
              <button
                type="button"
                style={toggleBtnStyle(filterType === "window")}
                onClick={() => changeFilter("window")}
              >
                Windows
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", width: "100%" }}>
              <p className="picker-label">STYLE</p>
              <div id="picker-scroll">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    className={"picker-item" + (item.id === selectedId ? " selected" : "")}
                    id={"pick-" + item.id}
                    onClick={() => {
                      selectedRef.current = item.id;
                      setSelectedId(item.id);
                    }}
                  >
                    <img src={item.img} alt={item.label} className="picker-img" />
                    <span className="picker-label-text">{item.label}</span>
                  </button>
                ))}
              </div>
              <button id="delete-btn" className="btn-delete">↩ Undo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // Two-step flow:
  // 1. 'preview' — DetectionView runs the visualiser WS. User sees a green box
  //    on the real door. When detected, "Enter AR" becomes active; tapping it
  //    captures the door's style + aspect ratio and switches to AR mode.
  // 2. 'ar' — XRView starts a WebXR immersive-ar session. The reticle is
  //    positioned via WebXR hit-test (screen-centre ray) and sized using the
  //    detected aspect ratio × standard door height — no FOV reconciliation.
  const [mode, setMode]           = useState('preview');
  const [arInitial, setArInitial] = useState(null);

  if (mode === 'ar') {
    return (
      <XRView
        initialSelection={arInitial}
        onExit={() => setMode('preview')}
      />
    );
  }
  return (
    <DetectionView
      onEnterAR={(sel) => { setArInitial(sel); setMode('ar'); }}
    />
  );
}
