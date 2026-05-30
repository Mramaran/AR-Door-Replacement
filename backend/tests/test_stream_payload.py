from types import SimpleNamespace
import numpy as np
import torch

from stream import _build_payload


class FakeTiltModel:
    def __init__(self, returns):
        self.returns = returns
        self.calls = []
    def __call__(self, *a, **kw):
        self.calls.append((a, kw))
        return self.returns


def test_build_payload_returns_normalized_corners_and_tilt_flag(monkeypatch):
    img = np.zeros((600, 800, 3), dtype=np.uint8)
    box = SimpleNamespace(
        cls=torch.tensor([0.0]),
        xyxy=torch.tensor([[100.0, 100.0, 400.0, 400.0]]),
    )
    kpts = torch.tensor([
        [200.0, 100.0],
        [600.0, 120.0],
        [580.0, 480.0],
        [220.0, 500.0],
    ])
    # patch detect_tilt so we don't need real torch weights
    import stream as stream_mod
    monkeypatch.setattr(stream_mod, "detect_tilt", lambda image, b: 1)

    payload = _build_payload(img, box, kpts, w=800, h=600, tilt_model_kind="door")
    assert payload["topLeft"]["x"] == 0.25
    assert payload["topRight"]["y"] == 120 / 600
    assert payload["isTilted"] is True


def test_build_payload_returns_none_when_box_is_none():
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    assert _build_payload(img, box=None, kpts=None, w=10, h=10, tilt_model_kind="door") is None
