from types import SimpleNamespace
import numpy as np
import torch

from utils import pick_best_for_class


def _fake_result(boxes_data, kpts_data):
    """Build a duck-typed Ultralytics result.
    boxes_data: list of (cls, x1, y1, x2, y2)
    kpts_data:  list of (4, 2) keypoint arrays
    """
    box_objs = []
    for cls, x1, y1, x2, y2 in boxes_data:
        box_objs.append(SimpleNamespace(
            cls=torch.tensor([float(cls)]),
            xyxy=torch.tensor([[float(x1), float(y1), float(x2), float(y2)]]),
        ))
    return SimpleNamespace(
        boxes=box_objs,
        keypoints=SimpleNamespace(xy=torch.tensor(np.asarray(kpts_data, dtype=np.float32))),
    )


def test_picks_largest_area_for_class():
    result = _fake_result(
        boxes_data=[
            (0,  10,  10,  60,  60),    # door, area 2500
            (0,  100, 100, 300, 400),   # door, area 60000  ← winner
            (1,  20,  20,  80,  80),    # window
        ],
        kpts_data=[
            [[10,10],[60,10],[60,60],[10,60]],
            [[100,100],[300,100],[300,400],[100,400]],
            [[20,20],[80,20],[80,80],[20,80]],
        ],
    )
    box, kpts = pick_best_for_class(result, cls=0)
    assert box is not None
    assert tuple(box.xyxy[0].tolist()) == (100.0, 100.0, 300.0, 400.0)


def test_returns_none_when_no_match():
    result = _fake_result(
        boxes_data=[(1, 10, 10, 60, 60)],
        kpts_data=[[[10,10],[60,10],[60,60],[10,60]]],
    )
    box, kpts = pick_best_for_class(result, cls=0)
    assert box is None and kpts is None


def test_filters_detections_with_two_zero_keypoints():
    result = _fake_result(
        boxes_data=[(0, 10, 10, 200, 200)],
        kpts_data=[[[0,0],[0,0],[200,200],[10,200]]],   # 2 zeros → garbage
    )
    box, kpts = pick_best_for_class(result, cls=0)
    assert box is None
