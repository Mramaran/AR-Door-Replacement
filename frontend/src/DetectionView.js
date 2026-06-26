import { useEffect, useRef, useState } from 'react';
import './App.css';

// Same-origin default so the dev-server proxy (src/setupProxy.js) carries
// the WebSocket through whichever URL is serving the page — localhost, LAN
// IP, or ngrok. Override with REACT_APP_VISUALISER_WS only if pointing at a
// different visualiser host.
const WS_URL = (() => {
  // Create React App replaces `process.env.REACT_APP_VISUALISER_WS` with a
  // string literal at build time, so reference it directly. Do NOT gate this on
  // `typeof process !== 'undefined'`: webpack 5 / CRA 5 don't define a `process`
  // global in the browser, so that guard is ALWAYS false at runtime and the
  // production override (the deployed backend's wss:// URL) would silently never
  // be read — the app would fall back to same-origin and the socket would close.
  const fromEnv = process.env.REACT_APP_VISUALISER_WS;
  if (fromEnv) {
    return fromEnv;
  }
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/detect-stream`;
  }
  return 'ws://localhost:3000/ws/detect-stream';
})();

const JPEG_QUALITY = 0.75;

const CATALOGUE = [
  { id: 'wooden',  label: 'Wooden Door',   img: '/WoodenDoor.png',               type: 'door'   },
  { id: 'metal',   label: 'Metal Door',    img: '/MetalDoor.png',                type: 'door'   },
  { id: 'pink',    label: 'Pink Door',     img: '/PinkDoor.png.png',             type: 'door'   },
  { id: 'violet',  label: 'Violet Door',   img: '/violetDoorWithHandle.png.png', type: 'door'   },
  { id: 'green-w', label: 'Green Window',  img: '/GreenWindow.png',              type: 'window' },
  { id: 'wood-w',  label: 'Wooden Window', img: '/WoodenWindow.png',             type: 'window' },
];

const toggleBtnStyle = (active) => ({
  flex: 1,
  padding: '0.5rem 0.75rem',
  background: active ? 'rgba(41, 121, 255, 0.45)' : 'rgba(255, 255, 255, 0.08)',
  color: '#fff',
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  border: active ? '1.5px solid #2979ff' : '1.5px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '1rem',
  cursor: 'pointer',
  pointerEvents: 'all',
});

function scaleCorners(c, w, h) {
  if (!c) return null;
  return {
    topLeft:     { x: c.topLeft.x     * w, y: c.topLeft.y     * h },
    topRight:    { x: c.topRight.x    * w, y: c.topRight.y    * h },
    bottomRight: { x: c.bottomRight.x * w, y: c.bottomRight.y * h },
    bottomLeft:  { x: c.bottomLeft.x  * w, y: c.bottomLeft.y  * h },
    isTilted: !!c.isTilted,
  };
}

// Exponential moving average on a corner: out = prev * (1 - alpha) + next * alpha.
// Kills frame-to-frame jitter from the visualiser while still allowing the
// overlay to follow the real door as the phone pans. Lower alpha = smoother
// but laggier; higher alpha = snappier but more jittery. 0.25 is a balanced
// default at ~5 fps detection.
const SMOOTH_ALPHA = 0.25;

function lerp(a, b, t) { return a * (1 - t) + b * t; }

function smoothCorners(prev, next, alpha) {
  if (!next) return null;
  if (!prev) return next;
  const blend = (p, n) => ({ x: lerp(p.x, n.x, alpha), y: lerp(p.y, n.y, alpha) });
  return {
    topLeft:     blend(prev.topLeft,     next.topLeft),
    topRight:    blend(prev.topRight,    next.topRight),
    bottomRight: blend(prev.bottomRight, next.bottomRight),
    bottomLeft:  blend(prev.bottomLeft,  next.bottomLeft),
    isTilted: !!next.isTilted,
  };
}

function drawQuad(ctx, corners, color) {
  if (!corners) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Axis-aligned CSS box derived from the detection corners. Matches the fitting
// formula from docs/plans/2026-05-20-png-overlay-door-window-design.md — the
// PNG is stretched into the rectangle defined by topLeft, topRight (width),
// and bottomLeft (height). No perspective warp, no per-frame recomputation.
function boxFromCorners(corners) {
  if (!corners) return null;
  return {
    left:   corners.topLeft.x,
    top:    corners.topLeft.y,
    width:  corners.topRight.x - corners.topLeft.x,
    height: corners.bottomLeft.y - corners.topLeft.y,
  };
}

export default function DetectionView({ onEnterAR } = {}) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const wsRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const inflightRef = useRef(false);
  const liveCornersRef = useRef({ door: null, window: null });

  // Smoothed live corners drive both the green outline and the placed image.
  // The placed image follows the real-world door (world-anchored to the
  // detected plane); smoothing kills frame-to-frame jitter.
  const [liveCorners, setLiveCorners] = useState({ door: null, window: null });

  const [placed, setPlaced] = useState([]);
  const placedIdRef = useRef(0);

  const [filterType, setFilterType] = useState('door');
  const [selectedId, setSelectedId] = useState(CATALOGUE[0].id);

  const [started, setStarted] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Connecting to detector…');

  const visibleItems = CATALOGUE.filter((c) => c.type === filterType);

  const changeFilter = (type) => {
    if (type === filterType) return;
    setFilterType(type);
    const firstOfType = CATALOGUE.find((c) => c.type === type);
    if (firstOfType) setSelectedId(firstOfType.id);
  };

  const onUndo = () => {
    setPlaced((prev) => prev.slice(0, -1));
    setStatus('Undid last placement');
  };

  const onPick = (item) => {
    setSelectedId(item.id);
    // In preview-for-AR mode (onEnterAR provided), picker only selects the
    // style — the actual placement happens in AR after tapping Enter AR.
    if (onEnterAR) {
      setStatus(`${item.label} selected — tap Enter AR when door is detected`);
      return;
    }
    const live = liveCornersRef.current[item.type];
    if (!live) {
      setStatus(`No ${item.type} detected — point at one first`);
      return;
    }
    const id = ++placedIdRef.current;
    setPlaced((prev) => [...prev, {
      id,
      img: item.img,
      type: item.type,
    }]);
    setStatus(`Placed ${item.label}`);
  };

  // Camera lifecycle
  useEffect(() => {
    if (!started) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // Request HD from the camera. Default getUserMedia constraints often
        // resolve to 640x480 which looks bad on a phone screen and gives the
        // detector less to work with. `ideal` keeps fallback graceful when
        // the device can't honour 1080p.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        if (cancelled) return;
        if (e.name === 'NotAllowedError') setError('Camera permission denied. Reload to try again.');
        else if (e.name === 'NotFoundError') setError('No camera found on this device.');
        else setError(`Camera error: ${e.name}`);
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [started]);

  // WebSocket lifecycle + capture loop
  useEffect(() => {
    if (!started) return undefined;

    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    inflightRef.current = false;

    const captureFrame = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      if (!ws || ws.readyState !== 1 || inflightRef.current) return;

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
      if (!captureCanvasRef.current ||
          captureCanvasRef.current.width !== capW ||
          captureCanvasRef.current.height !== capH) {
        captureCanvasRef.current = (typeof OffscreenCanvas !== 'undefined')
          ? new OffscreenCanvas(capW, capH)
          : Object.assign(document.createElement('canvas'), { width: capW, height: capH });
      }
      const cap = captureCanvasRef.current;
      const ctx = cap.getContext('2d');
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, capW, capH);

      let blob;
      if (cap.convertToBlob) {
        blob = await cap.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
      } else {
        blob = await new Promise((res) =>
          cap.toBlob(res, 'image/jpeg', JPEG_QUALITY));
      }
      if (!blob || ws.readyState !== 1) return;
      const buf = await blob.arrayBuffer();
      ws.send(buf);
      inflightRef.current = true;
    };

    // The capture loop is normally pumped by ws.onmessage. But the very first
    // frame has to be kicked off by ws.onopen — and if onopen fires before the
    // camera <video> has loaded its metadata, captureFrame() bails out and the
    // loop never starts. Poll until the video is ready, then send frame #1.
    let kickoffTimer = null;
    const kickoff = () => {
      const v = videoRef.current;
      if (!ws || ws.readyState !== 1) return;
      if (v && v.readyState >= 2 && v.videoWidth) {
        captureFrame();
      } else {
        kickoffTimer = setTimeout(kickoff, 150);
      }
    };

    ws.onopen = () => {
      setStatus('Connected — point at a door or window');
      kickoff();
    };

    ws.onmessage = (e) => {
      inflightRef.current = false;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && !msg.error) {
        const overlay = overlayRef.current;
        const v = overlay
          ? { w: overlay.clientWidth, h: overlay.clientHeight }
          : { w: 1, h: 1 };
        const rawLive = {
          door:   scaleCorners(msg.door,   v.w, v.h),
          window: scaleCorners(msg.window, v.w, v.h),
        };
        // Blend against the previous smoothed corners so the overlay rides
        // the detected door without dancing on every frame.
        const prev = liveCornersRef.current;
        const smoothed = {
          door:   smoothCorners(prev.door,   rawLive.door,   SMOOTH_ALPHA),
          window: smoothCorners(prev.window, rawLive.window, SMOOTH_ALPHA),
        };
        liveCornersRef.current = smoothed;
        // Drive the placed <img> render via state so React re-renders each
        // detection tick — that's what makes the overlay track the door.
        setLiveCorners(smoothed);

        if (overlay) {
          overlay.dataset.lastDoor   = smoothed.door   ? 'present' : 'absent';
          overlay.dataset.lastWindow = smoothed.window ? 'present' : 'absent';
        }
        const ctx = overlay && overlay.getContext('2d');
        if (ctx) {
          if (overlay.width  !== overlay.clientWidth)  overlay.width  = overlay.clientWidth;
          if (overlay.height !== overlay.clientHeight) overlay.height = overlay.clientHeight;
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          if (smoothed.door) {
            drawQuad(ctx, smoothed.door,
              smoothed.door.isTilted ? '#ff7043' : '#42e695');
          }
          if (smoothed.window) {
            drawQuad(ctx, smoothed.window,
              smoothed.window.isTilted ? '#ff7043' : '#42e695');
          }
        }

        // Surface the live detection state in the status pill so it's obvious
        // when the detector is connected but seeing nothing vs. seeing a door.
        if (smoothed.door && smoothed.window) {
          setStatus('Door + window detected — tap to place');
        } else if (smoothed.door) {
          setStatus('Door detected — tap to place');
        } else if (smoothed.window) {
          setStatus('Window detected — tap to place');
        } else {
          setStatus('Connected — no door/window in view');
        }
      }
      captureFrame();
    };

    ws.onerror = () => setStatus('Detector offline — check visualiser');
    ws.onclose = () => setStatus('Connection closed — reload to retry');

    const onVis = () => {
      if (document.hidden) {
        inflightRef.current = true;
      } else {
        inflightRef.current = false;
        captureFrame();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
      try { ws.close(); } catch { /* noop */ }
      wsRef.current = null;
    };
  }, [started]);

  if (!started) {
    return (
      <div id="xr-overlay">
        <div id="splash">
          <div className="splash-inner">
            <h1>AR Door Placer</h1>
            <p>Aim at a <strong>wall</strong>. When the detection outline appears, tap a door or window from the picker below to place it.</p>
            <p className="sub">Live detection via visualiser WebSocket</p>
            <button type="button" className="btn-primary" onClick={() => setStarted(true)}>
              Start Detection
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="xr-overlay">
      <video
        ref={videoRef}
        id="detection-video"
        autoPlay playsInline muted
        style={{
          position: 'absolute', inset: 0, width: '100vw', height: '100vh',
          objectFit: 'cover', background: '#000', zIndex: 1,
        }}
      />
      <canvas
        ref={overlayRef}
        id="detection-overlay"
        style={{
          position: 'absolute', inset: 0, width: '100vw', height: '100vh',
          pointerEvents: 'none', zIndex: 2,
        }}
      />
      {(() => {
        // World-anchored: each placed item rides the smoothed live detection
        // of its type. As the phone pans, the box updates each tick and the
        // <img> tracks the real door/window. Smoothing (SMOOTH_ALPHA) keeps
        // it from jittering when the phone is still.
        const latestByType = {};
        for (const p of placed) latestByType[p.type] = p;
        const items = [];
        for (const type of ['door', 'window']) {
          const p = latestByType[type];
          if (!p) continue;
          const box = boxFromCorners(liveCorners[type]);
          if (!box) continue;
          items.push({ p, box });
        }
        return items.map(({ p, box }) => (
          <img
            key={p.id}
            src={p.img}
            alt=""
            data-placed="true"
            draggable={false}
            style={{
              position: 'absolute',
              left:   `${box.left}px`,
              top:    `${box.top}px`,
              width:  `${box.width}px`,
              height: `${box.height}px`,
              pointerEvents: 'none',
              userSelect: 'none',
              zIndex: 3,
            }}
          />
        ));
      })()}
      <div id="status-hint" style={{
        position: 'absolute', top: 12, left: 12, padding: '0.3rem 0.75rem',
        background: 'rgba(0,0,0,0.5)', borderRadius: '1rem',
        color: '#fff', fontSize: '0.8rem', zIndex: 5,
      }}>
        {status}
      </div>
      {error && (
        <div id="detection-error" style={{
          position: 'absolute', top: 60, left: 20, right: 20,
          background: 'rgba(0,0,0,0.8)', padding: '1rem',
          borderRadius: 8, color: '#ff7043', zIndex: 10,
        }}>
          {error}
        </div>
      )}
      <div id="overlay-ui" style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end',
        pointerEvents: 'none', zIndex: 5,
      }}>
        <div id="bottom-sheet" style={{
          flexDirection: 'column', alignItems: 'stretch',
          display: 'flex', gap: '0.4rem', padding: '0.75rem 1rem 1.4rem',
          background: 'linear-gradient(to top, rgba(0, 0, 0, 0.82) 70%, transparent)',
          pointerEvents: 'all',
        }}>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem' }}>
            <button type="button" style={toggleBtnStyle(filterType === 'door')}
              onClick={() => changeFilter('door')}
            >Doors</button>
            <button type="button" style={toggleBtnStyle(filterType === 'window')}
              onClick={() => changeFilter('window')}
            >Windows</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <p className="picker-label">STYLE</p>
            <div id="picker-scroll">
              {visibleItems.map((it) => (
                <button
                  key={it.id}
                  className={'picker-item' + (it.id === selectedId ? ' selected' : '')}
                  onClick={() => onPick(it)}
                >
                  <img src={it.img} alt={it.label} className="picker-img" />
                  <span className="picker-label-text">{it.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-delete"
              onClick={onUndo}
            >↩ Undo</button>
            {onEnterAR && (
              <button
                type="button"
                onClick={() => {
                  const c = liveCornersRef.current[filterType];
                  if (!c) return;
                  // liveCornersRef stores pixel-scaled corners; renormalise to
                  // [0,1] image coords for the AR side. This is the coord system
                  // AR expects so it can unproject through the WebXR projection
                  // matrix and size the reticle to match what the user just saw.
                  const overlay = overlayRef.current;
                  const W = (overlay && overlay.clientWidth)  || 1;
                  const H = (overlay && overlay.clientHeight) || 1;
                  onEnterAR({
                    id: selectedId,
                    type: filterType,
                    corners: {
                      topLeft:     { x: c.topLeft.x     / W, y: c.topLeft.y     / H },
                      topRight:    { x: c.topRight.x    / W, y: c.topRight.y    / H },
                      bottomRight: { x: c.bottomRight.x / W, y: c.bottomRight.y / H },
                      bottomLeft:  { x: c.bottomLeft.x  / W, y: c.bottomLeft.y  / H },
                    },
                  });
                }}
                disabled={!liveCorners[filterType]}
                style={{
                  padding: '0.5rem 0.85rem',
                  background: liveCorners[filterType]
                    ? 'linear-gradient(135deg, #2979ff, #1565c0)'
                    : 'rgba(255,255,255,0.08)',
                  color: liveCorners[filterType] ? '#fff' : 'rgba(255,255,255,0.4)',
                  border: liveCorners[filterType]
                    ? '1.5px solid #82b1ff'
                    : '1.5px solid rgba(255,255,255,0.12)',
                  borderRadius: '1rem',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: liveCorners[filterType] ? 'pointer' : 'not-allowed',
                  pointerEvents: 'all',
                }}
              >
                {liveCorners[filterType] ? 'Enter AR →' : 'No ' + filterType}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
