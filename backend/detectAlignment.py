import os
import torch
from torchvision import models, transforms
from ultralytics import YOLO

CWD = os.getcwd()
BASE_PATH = f"{CWD}/make-over/model/weights/"

YOLO_MODEL_PATH = f"{BASE_PATH}/best.pt"
DOOR_MODEL_PATH = f"{BASE_PATH}/door_tilt_straight_resnet18.pth"
WINDOW_MODEL_PATH = f"{BASE_PATH}/window_tilt_straight_resnet18.pth"

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

yolo_model = YOLO(YOLO_MODEL_PATH)

def load_resnet(weight_path):
    model = models.resnet18(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, 1)
    model.load_state_dict(torch.load(weight_path, map_location=DEVICE))
    model.to(DEVICE)
    model.eval()
    return model

door_model = load_resnet(DOOR_MODEL_PATH)
window_model = load_resnet(WINDOW_MODEL_PATH)

transform = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

@torch.no_grad()
def classify_crop(img, model):
    tensor = transform(img).unsqueeze(0).to(DEVICE)
    prob = torch.sigmoid(model(tensor)).item()
    return 1 if prob > 0.5 else 0  # 1 = tilted, 0 = straight

@torch.no_grad()
def detect_image_tilt(img, conf=0.4):
    """
    Args:
        img (np.ndarray): OpenCV image (BGR)
        conf (float): YOLO confidence threshold

    Returns:
        int: 1 = tilted, 0 = straight
    """

    if img is None:
        raise ValueError("Invalid image input")

    results = yolo_model(img)[0]

    for box in results.boxes:
        cls = int(box.cls[0])
        x1, y1, x2, y2 = map(int, box.xyxy[0])

        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        # Door
        if cls == 0:
            result = classify_crop(crop, door_model)

        # Window
        elif cls == 1:
            result = classify_crop(crop, window_model)

        else:
            continue

        if result == 1:
            return 1

    return 0


def detect_tilt(img, box): #img must be from cv2
    cls = int(box.cls[0])
    x1, y1, x2, y2 = map(int, box.xyxy[0])

    crop = img[y1:y2, x1:x2]
    if crop.size == 0:
        return 1

    # Door
    if cls == 0:
        result = classify_crop(crop, door_model)

    # Window
    elif cls == 1:
        result = classify_crop(crop, window_model)

    if result == 1:
        return 1

    return 0