# AR Door &amp; Window Replacement

> Real-time augmented-reality door &amp; window replacement. Point a phone or webcam
> at a door or window — the app detects the opening and overlays a replacement
> design that **tracks the real opening live**, with an optional immersive
> **WebXR AR** mode on supported Android devices.

---

## 🎯 About

**AR Door &amp; Window Replacement** lets you preview a new door or window *in place
of an existing one*, in real time, using your device camera. It is made of two
parts that run together:

- **Frontend** — a **React + three.js + WebXR** app that captures the camera,
  renders the replacement overlay / 3D models, and offers an immersive AR mode
  with hit-testing, real-time environment light estimation, and a dom-overlay UI.
  *(Adapted from the open-source [3D WebXR Furniture](https://github.com/cynthiachiu/3D-WebXR-Furniture)
  placement project, reworked for doors &amp; windows.)*
- **Backend** — a **Flask + YOLOv8** keypoint-detection inference server. A YOLOv8
  pose model locates the four corners of each door/window in every frame, and two
  ResNet-18 classifiers report whether the opening is *tilted* or *straight*.
  Results stream to the frontend over a WebSocket.

```
┌────────────────────────┐   JPEG frames (WebSocket)    ┌──────────────────────────┐
│  frontend  :3000        │ ───────────────────────────▶ │  backend  :5000           │
│  React / three.js       │                              │  Flask + flask-sock       │
│  • getUserMedia camera  │ ◀─────────────────────────── │  • YOLOv8 pose (best.pt)  │
│  • PNG overlay on opening│  {door, window} corners JSON │  • ResNet-18 tilt models  │
└────────────────────────┘                              └──────────────────────────┘
        the React dev server proxies  /ws/detect-stream  ──▶  localhost:5000
```

The browser only ever talks to port `3000`; the dev server proxies the
`/ws/detect-stream` WebSocket through to the backend (`frontend/src/setupProxy.js`).

---

## ✨ Features

- Real-time door/window **corner detection** (YOLOv8 pose) streamed over WebSocket
- **Tilt** (straight / tilted) classification with ResNet-18
- Replacement **overlay that tracks** the detected opening as the camera moves
- Immersive **WebXR AR** with hit-testing &amp; real-time environment light estimation
- Realistic **3D models** with textures + a horizontally scrollable style catalogue
- Dom-overlay UI; also works on a plain **desktop webcam** (detection + 2D overlay)

## 🚀 Tech stack

**Frontend:** React (Create React App), three.js, WebXR
**Backend:** Python, Flask, flask-sock, Ultralytics YOLOv8, PyTorch, OpenCV, NumPy

---

## 📂 Project structure

```
ar-door-replacement/
├── frontend/   React app — public/ (PNGs + GLB models), src/ (App.js AR,
│               DetectionView.js detect+overlay, setupProxy.js WS proxy), .env
└── backend/    Flask detector — app.py, stream.py (/ws/detect-stream),
                detectAlignment.py (tilt), requirements.txt,
                make-over/model/weights/ (best.pt + *_tilt_*.pth, Git LFS)
```

> The same frontend &amp; backend code also lives in the original working folders
> (`...\ARDoor` and `...\visualiser\visualiser`), which already have their
> `node_modules` / `.venv` set up. The run commands below use those.

---

## 🏁 How to run

Run the **backend first**, then the **frontend** in a second terminal.

**1. Backend — detector API + WebSocket (port 5000):**

```powershell
cd "D:\Works\Designzz media\AR door placement\visualiser\visualiser"
& ".\.venv\Scripts\python.exe" app.py
```

**2. Frontend — React app (port 3000):**

```powershell
cd "D:\Works\Designzz media\AR door placement\ARDoor"
npm install      # first run only
npm start
```

Then open **http://localhost:3000** on the same machine and grant camera access.

**3. Test on a phone over HTTPS (camera/WebXR need a secure context):**

```powershell
ngrok http 3000
```

Open the `https://…ngrok-free.app` URL on an Android phone (Chrome + ARCore for AR).
Only port 3000 needs exposing — the WebSocket is same-origin and still proxies to `:5000`.

> **First-time backend setup** (only if `.venv` doesn't exist yet):
> ```powershell
> python -m venv .venv
> .\.venv\Scripts\python.exe -m pip install -r requirements.txt
> ```

---

## 🧭 Using it

1. Open the app and grant **camera** permission.
2. Point at a **door** or **window**. When the detector locks on, a green box
   appears over it — the backend terminal logs `… door=Y` / `window=Y`.
3. Pick a style from the catalogue → the replacement snaps onto the detected
   opening and rides it as you move the camera.
4. *(Optional)* tap **Enter AR →** for immersive WebXR with the same selection
   (Android + ARCore + HTTPS only); tap **Stop AR** to exit.

---

## 🔌 Backend API

| Endpoint                 | Type      | Purpose                                              |
|--------------------------|-----------|------------------------------------------------------|
| `/ws/detect-stream`      | WebSocket | Binary JPEG in → `{frameId, door, window}` JSON out  |
| `/api/detect`            | POST      | One-shot detection on an uploaded image              |
| `/api/detect-alignment`  | POST      | Tilt (straight / tilted) classification for an image |

Each `door` / `window` payload holds the four normalized corner keypoints of the
opening plus an `isTilted` flag. The server is **inference-only** (no training deps).

## 🧪 Tests

```bash
cd frontend && npm test          # React / Jest unit tests
cd backend  && python -m pytest  # backend tests (tests/)
```

## 📦 Model weights (Git LFS)

`backend/make-over/model/weights/` holds three LFS-tracked models — `best.pt`
(YOLOv8 pose) and the two `*_tilt_straight_resnet18.pth` tilt classifiers. Cloned
without LFS? Run `git lfs install &amp;&amp; git lfs pull`.
