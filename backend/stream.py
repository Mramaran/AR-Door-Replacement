"""WebSocket video-stream detection endpoint.

Wire contract: see docs/plans/2026-05-21-visualiser-video-mode-design.md
"""
import json
import time
import traceback

import cv2
import numpy as np

from detectAlignment import detect_tilt
from utils import to_normalized_corners


def _build_payload(img, box, kpts, w, h, tilt_model_kind):
    """Build the per-class JSON payload, or None if no detection."""
    if box is None or kpts is None:
        return None
    tilt = detect_tilt(img, box)
    payload = to_normalized_corners(kpts, w, h)
    payload["isTilted"] = bool(tilt == 1)
    return payload


from utils import pick_best_for_class


def register_routes(sock, yolo_model):
    @sock.route("/ws/detect-stream")
    def detect_stream(ws):
        print("[stream] client connected", flush=True)
        frame_id = 0
        try:
            while True:
                raw = ws.receive()
                if raw is None:
                    break
                if not isinstance(raw, (bytes, bytearray)):
                    ws.send(json.dumps({"frameId": frame_id, "error": "expected_binary"}))
                    frame_id += 1
                    continue

                # Catch ALL errors per-frame so one bad frame doesn't kill the
                # whole WebSocket connection.
                try:
                    arr = np.frombuffer(raw, dtype=np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is None:
                        print(f"[stream] frame {frame_id}: decode_failed (size={len(raw)} bytes)", flush=True)
                        ws.send(json.dumps({"frameId": frame_id, "error": "decode_failed"}))
                        frame_id += 1
                        continue

                    h, w = img.shape[:2]
                    t0 = time.perf_counter()
                    try:
                        result = yolo_model(img, verbose=False)[0]
                    except Exception as e:
                        print(f"[stream] frame {frame_id}: infer_failed: {e}", flush=True)
                        ws.send(json.dumps({
                            "frameId": frame_id, "error": "infer_failed", "detail": str(e),
                        }))
                        frame_id += 1
                        continue

                    door_box, door_kpts     = pick_best_for_class(result, cls=0)
                    window_box, window_kpts = pick_best_for_class(result, cls=1)

                    door   = _build_payload(img, door_box,   door_kpts,   w, h, "door")
                    window = _build_payload(img, window_box, window_kpts, w, h, "window")

                    infer_ms = int((time.perf_counter() - t0) * 1000)
                    if frame_id % 10 == 0:
                        print(f"[stream] frame {frame_id}: {w}x{h}, infer={infer_ms}ms, door={'Y' if door else 'N'}, window={'Y' if window else 'N'}", flush=True)
                    ws.send(json.dumps({
                        "frameId": frame_id,
                        "inferMs": infer_ms,
                        "door":    door,
                        "window":  window,
                    }))
                    frame_id += 1
                except Exception as e:
                    print(f"[stream] frame {frame_id}: UNEXPECTED ERROR: {e}", flush=True)
                    traceback.print_exc()
                    try:
                        ws.send(json.dumps({
                            "frameId": frame_id, "error": "internal", "detail": str(e),
                        }))
                    except Exception:
                        pass
                    frame_id += 1
                    continue
        except Exception as outer:
            print(f"[stream] OUTER FAILURE: {outer}", flush=True)
            traceback.print_exc()
        finally:
            print("[stream] client disconnected after", frame_id, "frames", flush=True)
