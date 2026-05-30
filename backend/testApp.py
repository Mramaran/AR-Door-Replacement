from ultralytics import YOLO
import cv2
import numpy as np
import os

CWD = os.getcwd()
# ----- CONFIG -----
model_path = f"{CWD}/make-over/model/weights/best.pt"
test_image = f"{CWD}/uploads/0a7845f5710bc07cd54d1218f76ab6be.jpg"
save_path = f"{CWD}/uploads/output_result_coords.jpg"
confidence_threshold = 0.3
# ------------------
# Load model and image
model = YOLO(model_path)
image = cv2.imread(test_image)
# Run inference
results = model(test_image)
for result in results:
    if result.keypoints is None or result.keypoints.xy is None:
        print(":warning: No keypoints detected.")
        continue
    keypoints_list = result.keypoints.xy  # shape: (instances, 17, 2)
    scores_list = result.keypoints.conf  # shape: (instances, 17)
    
    for instance_idx, (kps, confs) in enumerate(zip(keypoints_list, scores_list)):
        kps = kps.cpu().numpy()
        confs = confs.cpu().numpy()
        print(f"\n:large_green_circle: Instance {instance_idx + 1} Keypoints:")
        for i, ((x, y), conf) in enumerate(zip(kps, confs)):
            if conf > confidence_threshold:
                pt = (int(x), int(y))
                print(f"  Keypoint {i+1}: ({pt[0]}, {pt[1]})")
                # Draw dot and number on image
                cv2.circle(image, pt, 4, (0, 255, 0), -1)
                cv2.putText(image, str(i + 1), (pt[0] + 3, pt[1] - 3),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
# Save and show
cv2.imwrite(save_path, image)
cv2.imshow("Keypoints Only (No Lines)", image)
cv2.waitKey(0)
cv2.destroyAllWindows()