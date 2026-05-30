import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DetectionView from './DetectionView';

describe('DetectionView splash', () => {
  test('renders Start Detection button when not started', () => {
    render(<DetectionView />);
    expect(screen.getByRole('button', { name: /start detection/i })).toBeInTheDocument();
  });

  test('renders product name on splash', () => {
    render(<DetectionView />);
    expect(screen.getByText(/AR Door Placer/i)).toBeInTheDocument();
  });
});

describe('DetectionView camera', () => {
  let getUserMediaMock;
  let originalMediaDevices;

  beforeEach(() => {
    originalMediaDevices = navigator.mediaDevices;
    const fakeTrack = { stop: jest.fn(), kind: 'video' };
    const fakeStream = { getTracks: () => [fakeTrack] };
    getUserMediaMock = jest.fn().mockResolvedValue(fakeStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  test('requests rear camera when start clicked', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));
    const arg = getUserMediaMock.mock.calls[0][0];
    expect(arg.video).toBeDefined();
    expect(arg.audio).toBe(false);
  });

  test('shows error if permission denied', async () => {
    getUserMediaMock.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    );
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
  });
});

describe('DetectionView WebSocket', () => {
  let wsInstances;
  let OriginalWebSocket;

  beforeEach(() => {
    wsInstances = [];
    OriginalWebSocket = global.WebSocket;
    global.WebSocket = jest.fn(function (url) {
      this.url = url;
      this.readyState = 0;
      this.send = jest.fn();
      this.close = jest.fn();
      this.binaryType = '';
      wsInstances.push(this);
    });

    const fakeTrack = { stop: jest.fn(), kind: 'video' };
    const fakeStream = { getTracks: () => [fakeTrack] };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });
  });

  afterEach(() => {
    global.WebSocket = OriginalWebSocket;
  });

  test('opens WebSocket to env-configured URL when started', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(wsInstances.length).toBe(1));
    expect(wsInstances[0].url).toMatch(/\/ws\/detect-stream$/);
  });

  test('updates liveCorners from message and exposes them via data attr', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(wsInstances.length).toBe(1));
    const ws = wsInstances[0];
    ws.readyState = 1;
    if (ws.onopen) ws.onopen();
    ws.onmessage({
      data: JSON.stringify({
        frameId: 0,
        inferMs: 100,
        door: {
          topLeft:     { x: 0.1, y: 0.1 },
          topRight:    { x: 0.5, y: 0.1 },
          bottomRight: { x: 0.5, y: 0.9 },
          bottomLeft:  { x: 0.1, y: 0.9 },
          isTilted: false,
        },
        window: null,
      }),
    });
    await waitFor(() => {
      const overlay = document.getElementById('detection-overlay');
      expect(overlay.dataset.lastDoor).toBe('present');
    });
  });
});

describe('DetectionView outline drawing', () => {
  let drawCalls;
  let OriginalWebSocket;

  beforeEach(() => {
    drawCalls = [];
    const ctx2d = {
      clearRect: jest.fn((...a) => drawCalls.push(['clear', ...a])),
      beginPath: jest.fn(() => drawCalls.push(['begin'])),
      moveTo:    jest.fn((x, y) => drawCalls.push(['moveTo', x, y])),
      lineTo:    jest.fn((x, y) => drawCalls.push(['lineTo', x, y])),
      closePath: jest.fn(() => drawCalls.push(['close'])),
      stroke:    jest.fn(() => drawCalls.push(['stroke'])),
      arc:       jest.fn(),
      fill:      jest.fn(),
      set strokeStyle(v) {},
      set fillStyle(v) {},
      set lineWidth(v) {},
    };
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx2d);

    OriginalWebSocket = global.WebSocket;
    const fakeTrack = { stop: jest.fn(), kind: 'video' };
    const fakeStream = { getTracks: () => [fakeTrack] };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });
    global.WebSocket = jest.fn(function () {
      this.send = jest.fn();
      this.close = jest.fn();
      this.readyState = 1;
      this.binaryType = '';
      setTimeout(() => this.onopen && this.onopen(), 0);
    });
  });

  afterEach(() => {
    global.WebSocket = OriginalWebSocket;
  });

  test('draws a quad when door is detected', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));

    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const ws = global.WebSocket.mock.instances[0];

    ws.onmessage({
      data: JSON.stringify({
        frameId: 0,
        inferMs: 100,
        door: {
          topLeft:     { x: 0.1, y: 0.1 },
          topRight:    { x: 0.5, y: 0.1 },
          bottomRight: { x: 0.5, y: 0.9 },
          bottomLeft:  { x: 0.1, y: 0.9 },
          isTilted: false,
        },
        window: null,
      }),
    });

    await waitFor(() => {
      expect(drawCalls.some((c) => c[0] === 'moveTo')).toBe(true);
      expect(drawCalls.some((c) => c[0] === 'stroke')).toBe(true);
    });
  });
});

describe('DetectionView placement via catalogue tap', () => {
  let OriginalWebSocket;

  beforeEach(() => {
    OriginalWebSocket = global.WebSocket;
    const fakeTrack = { stop: jest.fn(), kind: 'video' };
    const fakeStream = { getTracks: () => [fakeTrack] };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });
    global.WebSocket = jest.fn(function () {
      this.send = jest.fn();
      this.close = jest.fn();
      this.readyState = 1;
      this.binaryType = '';
      setTimeout(() => this.onopen && this.onopen(), 0);
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth',  { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1000 });
  });

  afterEach(() => { global.WebSocket = OriginalWebSocket; });

  test('clicking a catalogue door item with a detected door places it', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));

    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const ws = global.WebSocket.mock.instances[0];

    // Feed a detection so liveCornersRef.current.door is non-null.
    ws.onmessage({
      data: JSON.stringify({
        frameId: 0,
        inferMs: 100,
        door: {
          topLeft:     { x: 0.1, y: 0.1 },
          topRight:    { x: 0.5, y: 0.1 },
          bottomRight: { x: 0.5, y: 0.9 },
          bottomLeft:  { x: 0.1, y: 0.9 },
          isTilted: false,
        },
        window: null,
      }),
    });

    // Tap "Wooden Door" picker item → places it at the live detection.
    const woodenButton = screen.getByAltText(/wooden door/i).closest('button');
    fireEvent.click(woodenButton);

    await waitFor(() => {
      const imgs = document.querySelectorAll('img[data-placed="true"]');
      expect(imgs.length).toBe(1);
    });
    const img = document.querySelector('img[data-placed="true"]');
    // The image is positioned with axis-aligned CSS box derived from the
    // CURRENT live detection (world-anchored), not a matrix3d perspective warp.
    expect(img.style.left).toMatch(/px$/);
    expect(img.style.top).toMatch(/px$/);
    expect(img.style.width).toMatch(/px$/);
    expect(img.style.height).toMatch(/px$/);
    expect(img.style.transform).toBe('');
  });

  test('clicking a catalogue item without any live detection does not place', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    // No onmessage call — no detection ever recorded in liveCornersRef.

    const woodenButton = screen.getByAltText(/wooden door/i).closest('button');
    fireEvent.click(woodenButton);

    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelectorAll('img[data-placed="true"]').length).toBe(0);
  });

  test('placed image follows the live detection corners across frames', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const ws = global.WebSocket.mock.instances[0];

    ws.onmessage({
      data: JSON.stringify({
        frameId: 0, inferMs: 100,
        door: {
          topLeft:     { x: 0.1, y: 0.1 },
          topRight:    { x: 0.5, y: 0.1 },
          bottomRight: { x: 0.5, y: 0.9 },
          bottomLeft:  { x: 0.1, y: 0.9 },
          isTilted: false,
        },
        window: null,
      }),
    });

    const woodenButton = screen.getByAltText(/wooden door/i).closest('button');
    fireEvent.click(woodenButton);
    await waitFor(() =>
      expect(document.querySelectorAll('img[data-placed="true"]').length).toBe(1)
    );
    const initialLeft = document.querySelector('img[data-placed="true"]').style.left;

    // Door visibly moved on screen (phone moved). World-anchored: image
    // should move with the wall — i.e. the rendered box updates.
    ws.onmessage({
      data: JSON.stringify({
        frameId: 1, inferMs: 100,
        door: {
          topLeft:     { x: 0.3, y: 0.2 },
          topRight:    { x: 0.7, y: 0.2 },
          bottomRight: { x: 0.7, y: 0.8 },
          bottomLeft:  { x: 0.3, y: 0.8 },
          isTilted: false,
        },
        window: null,
      }),
    });

    await waitFor(() => {
      const updated = document.querySelector('img[data-placed="true"]').style.left;
      expect(updated).not.toBe(initialLeft);
    });
  });

  test('placed image hides when detection of its type drops', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const ws = global.WebSocket.mock.instances[0];

    ws.onmessage({
      data: JSON.stringify({
        frameId: 0, inferMs: 100,
        door: {
          topLeft:     { x: 0.1, y: 0.1 },
          topRight:    { x: 0.5, y: 0.1 },
          bottomRight: { x: 0.5, y: 0.9 },
          bottomLeft:  { x: 0.1, y: 0.9 },
          isTilted: false,
        },
        window: null,
      }),
    });

    const woodenButton = screen.getByAltText(/wooden door/i).closest('button');
    fireEvent.click(woodenButton);
    await waitFor(() =>
      expect(document.querySelectorAll('img[data-placed="true"]').length).toBe(1)
    );

    // Real-world door now out of view → visualiser sees no door.
    ws.onmessage({
      data: JSON.stringify({
        frameId: 1, inferMs: 100,
        door: null,
        window: null,
      }),
    });

    await waitFor(() =>
      expect(document.querySelectorAll('img[data-placed="true"]').length).toBe(0)
    );
  });
});

describe('DetectionView catalogue UI', () => {
  let OriginalWebSocket;

  beforeEach(() => {
    OriginalWebSocket = global.WebSocket;
    const fakeTrack = { stop: jest.fn(), kind: 'video' };
    const fakeStream = { getTracks: () => [fakeTrack] };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });
    global.WebSocket = jest.fn(function () {
      this.send = jest.fn();
      this.close = jest.fn();
      this.readyState = 1;
      this.binaryType = '';
      setTimeout(() => this.onopen && this.onopen(), 0);
    });
  });

  afterEach(() => { global.WebSocket = OriginalWebSocket; });

  test('shows type-toggle and door picker when started', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^doors$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^windows$/i })).toBeInTheDocument();
    });
    expect(screen.getByAltText(/wooden door/i)).toBeInTheDocument();
  });

  test('switching to Windows hides door items', async () => {
    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^windows$/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /^windows$/i }));
    expect(screen.queryByAltText(/wooden door/i)).not.toBeInTheDocument();
    expect(screen.getByAltText(/green window/i)).toBeInTheDocument();
  });

  test('undo removes the last placed image', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth',  { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1000 });

    render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const ws = global.WebSocket.mock.instances[0];
    ws.onmessage({
      data: JSON.stringify({
        frameId: 0, inferMs: 100,
        door: {
          topLeft:     { x: 0.1, y: 0.1 },
          topRight:    { x: 0.5, y: 0.1 },
          bottomRight: { x: 0.5, y: 0.9 },
          bottomLeft:  { x: 0.1, y: 0.9 },
          isTilted: false,
        },
        window: null,
      }),
    });
    const woodenButton = screen.getByAltText(/wooden door/i).closest('button');
    fireEvent.click(woodenButton);
    await waitFor(() =>
      expect(document.querySelectorAll('img[data-placed="true"]').length).toBe(1)
    );
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(document.querySelectorAll('img[data-placed="true"]').length).toBe(0);
  });
});

describe('DetectionView visibility handling', () => {
  let OriginalWebSocket;

  beforeEach(() => {
    OriginalWebSocket = global.WebSocket;
    const fakeTrack = { stop: jest.fn(), kind: 'video' };
    const fakeStream = { getTracks: () => [fakeTrack] };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });
    global.WebSocket = jest.fn(function () {
      this.send = jest.fn();
      this.close = jest.fn();
      this.readyState = 1;
      this.binaryType = '';
      setTimeout(() => this.onopen && this.onopen(), 0);
    });
  });

  afterEach(() => { global.WebSocket = OriginalWebSocket; });

  test('closes the WebSocket on unmount', async () => {
    const { unmount } = render(<DetectionView />);
    fireEvent.click(screen.getByRole('button', { name: /start detection/i }));
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const ws = global.WebSocket.mock.instances[0];
    unmount();
    expect(ws.close).toHaveBeenCalled();
  });
});
