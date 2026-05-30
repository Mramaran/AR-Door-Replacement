import os
import cv2
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from ultralytics import YOLO
from werkzeug.utils import secure_filename
from datetime import datetime
from utils import resize_image, process_detections, save_image
from detectAlignment import detect_image_tilt, detect_tilt
from flask_sock import Sock
from stream import register_routes as register_stream_routes

app = Flask(__name__)
sock = Sock(app)

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

CORS(app, resources={r"/api/*": {"origins": "*"}}, methods=["GET", "POST"])

CWD = os.getcwd()

MODEL_PATH = f"{CWD}/make-over/model/weights/best.pt"
BB_MODEL_PATH = f"{CWD}/make-over/model/weights/BB_best.pt"

def get_yolo_model(local_path: str) -> YOLO:
    # Load and return the YOLOv8 model
    model = YOLO(local_path)
    return model

# model = YOLO(f"{CWD}/make-over/model/weights/best.pt")
model = get_yolo_model(MODEL_PATH)
register_stream_routes(sock, model)

IMG_WIDTH = 960
IMG_HEIGHT = 425

@app.route("/")
def index():
    return jsonify({
        'msg': "You've successfully accessed our site",
    }), 200


@app.route("/stream_test.html")
def stream_test_page():
    return send_from_directory(os.getcwd(), "stream_test.html")


@app.route('/api/detect', methods=['POST'])
def detect():
    if 'image' not in request.files:
        return jsonify({"error": "No image part in the request"}), 400

    image = request.files['image']

    if image.filename == '':
        return jsonify({"error": "No image selected for uploading"}), 400

    try:
        max_width = int(request.form.get('width', IMG_WIDTH))
        max_height = int(request.form.get('height', IMG_HEIGHT))

    except ValueError:
        return jsonify({"error": "Invalid width or height"}), 400

    try:
        # Create dynamic filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{secure_filename(image.filename)}"
        image_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        # Resize to exact 960x425 and save
        resize_image(image, image_path, max_width, max_height)

        # Pass resized image to model
        results = model(image_path)
        detections = []

        for r in results:
            boxes = r.boxes
            cv2Image = cv2.imread(image_path)

            for i, kpts in enumerate(r.keypoints.xy):
                if kpts.shape[0] < 4:
                    continue

                keypoint_coords = []
                for x, y in kpts[:4]:  # take only first 4
                    keypoint_coords.append([round(float(x), 2), round(float(y), 2)])

                box = boxes[i]
                isTilted = detect_tilt(cv2Image, box)

                detections.append({
                    "label": "keypoints",
                    "coordinates": keypoint_coords,
                    "isTilted": isTilted
                })

        detections =  process_detections(detections=detections)
        return jsonify({"detections": detections}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        # Cleanup: delete the uploaded image after processing
        if image_path and os.path.exists(image_path):
            try:
                os.remove(image_path)
            except Exception as cleanup_err:
                app.logger.warning(f"Failed to delete file {image_path}: {cleanup_err}")

@app.route('/api/detect-alignment', methods=['POST'])
def detectAlignment():
    if 'image' not in request.files:
        return jsonify({"error": "No image part in the request"}), 400

    image = request.files['image']
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{secure_filename(image.filename)}"
    image_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    save_image(img_file=image, output_path=image_path)

    try:
        img = cv2.imread(image_path)

        if img is None:
            return jsonify({"error": "Failed to read image"}), 400

        isTilted = detect_image_tilt(img=img)

        return jsonify({'isTilted': isTilted}), 200
    except Exception as e:
        return jsonify({"err": str(e)}), 400

debug = os.getenv('FLASK_DEBUG', True)

if __name__ == '__main__':
    # Bind 0.0.0.0 so phones on the same Wi-Fi (LAN) can reach the server.
    app.run(host='0.0.0.0', port=5000, debug=debug)