from PIL import Image
from io import BytesIO

# Compatibility with Pillow 10+
try:
    resample = Image.Resampling.LANCZOS
except AttributeError:
    resample = Image.LANCZOS

def resize_image(img_file, output_path, max_width, max_height):
    # Read and load the image
    image_bytes = img_file.read()
    image = Image.open(BytesIO(image_bytes))

    if image.mode == "RGBA":
        image = image.convert("RGB")

    image = image.resize((max_width, max_height), resample)
    image.save(output_path, format=image.format)

def save_image(img_file, output_path):
    image_bytes = img_file.read()
    image = Image.open(BytesIO(image_bytes))

    if image.mode == "RGBA":
        image = image.convert("RGB")

    image.save(output_path, format=image.format)

def process_detections(detections):
    if not detections:
        return []

    coordinates_out = []

    for e in detections:
        zero_count = sum(1 for x, y in e["coordinates"] if x == 0 and y == 0)
        if zero_count >= 2:
            continue

        a, b, c, d = [None, None, None, None]
        if e.get("isTilted", False) == 0:
            a, b, c, d = straightenCoordinates(e["coordinates"])
        else:
            a, b, c, d = straightenTiltedCoordinates(e["coordinates"])

        coordinates_out.append({
            "x1": a[0], "y1": a[1],
            "x2": b[0], "y2": b[1],
            "x3": c[0], "y3": c[1],
            "x4": d[0], "y4": d[1],
            "visible": True,
            "canPlaceItem": True,
            "IsTilted": e['isTilted'] == 1
        })

    return coordinates_out

def straightenTiltedCoordinates(coords, threshold=2):
    if not isinstance(coords, list) or len(coords) < 4:
        raise ValueError("coords must be an array of 4 points")

    tl, tr, br, bl = coords

    tl_y = tl[1]
    tr_y = tr[1]
    br_y = br[1]
    bl_y = bl[1]

    tr_variation = 5 
    br_variation = 3

    if abs(tl_y - tr_y) > threshold: #top-right
        tr[1] += tr_variation

    if abs(br_y - bl_y) > threshold: #bottom-right
        br[1] -= br_variation

    return [tl, tr, br, bl]

def straightenCoordinates(coords, threshold=2):
    if not isinstance(coords, list) or len(coords) < 4:
        raise ValueError("coords must be an array of 4 points")

    tl, tr, br, bl = coords

    # Average top and bottom
    top_y = int((tl[1] + tr[1]) / 2)
    bottom_y = int((bl[1] + br[1]) / 2)

    # Average left and right
    left_x = int((tl[0] + bl[0]) / 2)
    right_x = int((tr[0] + br[0]) / 2)

    return [
        [left_x,  top_y],
        [right_x, top_y],
        [right_x, bottom_y],
        [left_x,  bottom_y]
    ]

def pick_best_for_class(yolo_result, cls):
    """Return (box, kpts) for the largest detection of `cls`, or (None, None).

    Filters:
      - skip detections with fewer than 4 keypoints
      - skip detections with >=2 zero-valued keypoints (mirrors process_detections)
    """
    best_box = None
    best_kpts = None
    best_area = 0.0

    boxes = yolo_result.boxes
    kpts_all = yolo_result.keypoints.xy

    for i, box in enumerate(boxes):
        if int(box.cls[0]) != cls:
            continue
        kpts = kpts_all[i]
        if kpts.shape[0] < 4:
            continue
        kpts4 = kpts[:4]
        zero_count = int(((kpts4[:, 0] == 0) & (kpts4[:, 1] == 0)).sum())
        if zero_count >= 2:
            continue
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        area = (x2 - x1) * (y2 - y1)
        if area > best_area:
            best_area = area
            best_box = box
            best_kpts = kpts4

    return best_box, best_kpts

def to_normalized_corners(kpts_xy, w, h):
    """Convert a (4,2) keypoint tensor (TL, TR, BR, BL order) to the
    cooridinates.md shape with values normalized to [0, 1].
    """
    tl, tr, br, bl = kpts_xy
    return {
        "topLeft":     {"x": float(tl[0]) / w, "y": float(tl[1]) / h},
        "topRight":    {"x": float(tr[0]) / w, "y": float(tr[1]) / h},
        "bottomRight": {"x": float(br[0]) / w, "y": float(br[1]) / h},
        "bottomLeft":  {"x": float(bl[0]) / w, "y": float(bl[1]) / h},
    }
