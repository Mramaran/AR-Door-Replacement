import torch
from utils import to_normalized_corners


def test_normalizes_to_unit_square():
    kpts = torch.tensor([
        [  0.0,   0.0],   # TL
        [800.0,   0.0],   # TR
        [800.0, 600.0],   # BR
        [  0.0, 600.0],   # BL
    ])
    out = to_normalized_corners(kpts, w=800, h=600)
    assert out == {
        "topLeft":     {"x": 0.0, "y": 0.0},
        "topRight":    {"x": 1.0, "y": 0.0},
        "bottomRight": {"x": 1.0, "y": 1.0},
        "bottomLeft":  {"x": 0.0, "y": 1.0},
    }


def test_preserves_ordering_and_floats():
    kpts = torch.tensor([
        [200.0, 100.0],
        [600.0, 120.0],
        [580.0, 480.0],
        [220.0, 500.0],
    ])
    out = to_normalized_corners(kpts, w=800, h=600)
    assert out["topLeft"]    == {"x": 0.25,    "y": 100/600}
    assert out["topRight"]   == {"x": 0.75,    "y": 120/600}
    assert out["bottomRight"]== {"x": 580/800, "y": 0.8}
    assert out["bottomLeft"] == {"x": 0.275,   "y": 500/600}
    # all values must be plain floats, not tensors
    for c in out.values():
        assert isinstance(c["x"], float) and isinstance(c["y"], float)
