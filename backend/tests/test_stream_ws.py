import json
import os

import websocket


def _jpeg_bytes():
    with open(os.path.join("uploads", "door.jpeg"), "rb") as f:
        return f.read()


def test_ws_returns_expected_top_level_keys(live_server):
    ws = websocket.create_connection(live_server, timeout=20)
    try:
        ws.send_binary(_jpeg_bytes())
        msg = json.loads(ws.recv())
    finally:
        ws.close()

    assert set(msg.keys()) >= {"frameId", "inferMs", "door", "window"}
    assert msg["frameId"] == 0
    assert isinstance(msg["inferMs"], int)


def test_ws_door_corners_are_normalized(live_server):
    ws = websocket.create_connection(live_server, timeout=20)
    try:
        ws.send_binary(_jpeg_bytes())
        msg = json.loads(ws.recv())
    finally:
        ws.close()

    assert msg["door"] is not None, "door.jpeg should produce a door detection"
    for corner_name in ("topLeft", "topRight", "bottomRight", "bottomLeft"):
        c = msg["door"][corner_name]
        assert 0.0 <= c["x"] <= 1.0, f"{corner_name}.x out of range: {c['x']}"
        assert 0.0 <= c["y"] <= 1.0, f"{corner_name}.y out of range: {c['y']}"
    assert isinstance(msg["door"]["isTilted"], bool)


def test_ws_handles_five_frames_with_monotonic_frame_ids(live_server):
    payload = _jpeg_bytes()
    ws = websocket.create_connection(live_server, timeout=30)
    ids = []
    try:
        for _ in range(5):
            ws.send_binary(payload)
            msg = json.loads(ws.recv())
            ids.append(msg["frameId"])
    finally:
        ws.close()

    assert ids == [0, 1, 2, 3, 4]


def test_ws_returns_decode_failed_on_bad_bytes(live_server):
    ws = websocket.create_connection(live_server, timeout=20)
    try:
        ws.send_binary(b"this is not a JPEG")
        err = json.loads(ws.recv())
        # connection stays alive — send a real frame after
        ws.send_binary(_jpeg_bytes())
        ok = json.loads(ws.recv())
    finally:
        ws.close()

    assert err["error"] == "decode_failed"
    assert err["frameId"] == 0
    assert ok["frameId"] == 1
    assert "door" in ok
