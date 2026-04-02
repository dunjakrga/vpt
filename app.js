const video         = document.getElementById('video');
const drawCanvas    = document.getElementById('drawCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const drawCtx       = drawCanvas.getContext('2d');
const overlayCtx    = overlayCanvas.getContext('2d');
const status        = document.getElementById('status');

let currentColor         = '#2563eb';
let brushSize            = 7;
let isEraser             = false;
let prevX                = null, prevY = null;
let colorSwitchTriggered = false;

const brushRange = document.getElementById('brushRange');
const brushVal   = document.getElementById('brushVal');
brushRange.oninput = () => {
  brushSize            = parseInt(brushRange.value);
  brushVal.textContent = brushSize;
};

document.getElementById('startBtn').onclick = async () => {
  status.textContent = 'Starting camera...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      document.getElementById('placeholder').style.display  = 'none';
      document.getElementById('videoWrapper').style.display = 'block';
      document.getElementById('controls').style.display     = 'flex';
      document.getElementById('gestureHint').style.display  = 'block';
      resizeCanvases();
      initMediaPipe();
    };
  } catch(e) {
    status.textContent = 'Camera access denied. Please allow camera permissions.';
  }
};

function resizeCanvases() {
  const w = video.videoWidth  || 640;
  const h = video.videoHeight || 480;
  drawCanvas.width    = w; drawCanvas.height    = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
}

document.querySelectorAll('.colorBtn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.colorBtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentColor = btn.dataset.color;
    isEraser     = btn.dataset.eraser === 'true';
  };
});

document.getElementById('clearBtn').onclick = () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
};

document.getElementById('saveBtn').onclick = () => {
  const tmp  = document.createElement('canvas');
  tmp.width  = drawCanvas.width;
  tmp.height = drawCanvas.height;
  const tCtx = tmp.getContext('2d');
  tCtx.fillStyle = '#000';
  tCtx.fillRect(0, 0, tmp.width, tmp.height);
  tCtx.drawImage(drawCanvas, 0, 0);
  const a    = document.createElement('a');
  a.href     = tmp.toDataURL('image/png');
  a.download = 'drawing.png';
  a.click();
};

function initMediaPipe() {
  if (typeof Hands === 'undefined') {
    status.textContent = 'MediaPipe failed to load. Try refreshing.';
    return;
  }

  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });

  hands.setOptions({
    maxNumHands:            1,
    modelComplexity:        1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.5
  });

  hands.onResults(onResults);

  const camera = new Camera(video, {
    onFrame: async () => { await hands.send({ image: video }); },
    width: 640, height: 480
  });

  camera.start();
  status.textContent = 'Hand tracking active';
  setTimeout(() => { status.textContent = ''; }, 3000);
}

function getDist(a, b, W, H) {
  const dx = (a.x - b.x) * W;
  const dy = (a.y - b.y) * H;
  return Math.sqrt(dx*dx + dy*dy);
}

// Mirror X helper — all coordinates go through this
function mx(x, W) { return (1 - x) * W; }

function onResults(results) {
  const W = drawCanvas.width, H = drawCanvas.height;
  overlayCtx.clearRect(0, 0, W, H);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    prevX = null; prevY = null;
    return;
  }

  const lm = results.multiHandLandmarks[0];

  const indexTip  = lm[8],  indexPip  = lm[6];
  const middleTip = lm[12], middlePip = lm[10];
  const ringTip   = lm[16], ringPip   = lm[14];
  const pinkyTip  = lm[20], pinkyPip  = lm[18];
  const thumbTip  = lm[4];

  const indexUp  = indexTip.y  < indexPip.y;
  const middleUp = middleTip.y < middlePip.y;
  const ringUp   = ringTip.y   < ringPip.y;
  const pinkyUp  = pinkyTip.y  < pinkyPip.y;

  // All screen coordinates mirrored
  const ix = mx(indexTip.x, W), iy = indexTip.y * H;
  const tx = mx(thumbTip.x, W), ty = thumbTip.y * H;

  // Draw hand skeleton — mirrored to match video
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
  ];

  overlayCtx.strokeStyle = 'rgba(255,255,255,0.6)';
  overlayCtx.lineWidth   = 2;
  connections.forEach(([a, b]) => {
    const ax = mx(lm[a].x, W), ay = lm[a].y * H;
    const bx = mx(lm[b].x, W), by = lm[b].y * H;
    overlayCtx.beginPath();
    overlayCtx.moveTo(ax, ay);
    overlayCtx.lineTo(bx, by);
    overlayCtx.stroke();
  });

  // Landmark dots — mirrored
  lm.forEach((point, i) => {
    const px = mx(point.x, W), py = point.y * H;
    overlayCtx.beginPath();
    overlayCtx.arc(px, py, i === 8 ? 8 : 4, 0, Math.PI * 2);
    overlayCtx.fillStyle = i === 8 ? currentColor : 'rgba(255,255,255,0.9)';
    overlayCtx.fill();
  });

  // 3 fingers up + pinch = brush size
  if (indexUp && middleUp && ringUp && !pinkyUp) {
    const pinchDist = getDist(thumbTip, indexTip, W, H);
    const newSize   = Math.round(Math.min(40, Math.max(2, (pinchDist - 20) / 180 * 38 + 2)));
    if (newSize !== brushSize) {
      brushSize            = newSize;
      brushRange.value     = brushSize;
      brushVal.textContent = brushSize;
    }

    // Yellow line between thumb and index
    overlayCtx.beginPath();
    overlayCtx.moveTo(ix, iy);
    overlayCtx.lineTo(tx, ty);
    overlayCtx.strokeStyle = 'rgba(255,200,0,0.8)';
    overlayCtx.lineWidth   = 2;
    overlayCtx.stroke();

    // Circle at midpoint showing current brush size
    const midX = (ix + tx) / 2, midY = (iy + ty) / 2;
    overlayCtx.beginPath();
    overlayCtx.arc(midX, midY, brushSize / 2, 0, Math.PI * 2);
    overlayCtx.strokeStyle = 'rgba(255,200,0,0.8)';
    overlayCtx.lineWidth   = 1.5;
    overlayCtx.stroke();

    prevX = null; prevY = null;
    return;
  }

  // 4 fingers up = cycle color
  if (indexUp && middleUp && ringUp && pinkyUp) {
    if (!colorSwitchTriggered) {
      const btns = document.querySelectorAll('.colorBtn');
      let currentIndex = -1;
      btns.forEach((btn, i) => { if (btn.classList.contains('active')) currentIndex = i; });
      const nextIndex = (currentIndex + 1) % btns.length;
      btns.forEach(b => b.classList.remove('active'));
      btns[nextIndex].classList.add('active');
      currentColor = btns[nextIndex].dataset.color;
      isEraser     = btns[nextIndex].dataset.eraser === 'true';
      colorSwitchTriggered = true;
      status.textContent   = isEraser ? 'Eraser' : btns[nextIndex].title;
      setTimeout(() => { status.textContent = ''; }, 1000);
    }
    prevX = null; prevY = null;
    return;
  } else {
    colorSwitchTriggered = false;
  }

  // Cursor circle
  overlayCtx.beginPath();
  overlayCtx.arc(ix, iy, isEraser ? 20 : Math.max(brushSize / 2, 6), 0, Math.PI * 2);
  overlayCtx.strokeStyle = isEraser ? '#888' : currentColor;
  overlayCtx.lineWidth   = 2;
  overlayCtx.stroke();

  // 1 finger = draw, 2 fingers = pause
  if (indexUp && !middleUp && !ringUp && !pinkyUp) {
    if (prevX !== null) {
      drawCtx.save();
      if (isEraser) {
        drawCtx.globalCompositeOperation = 'destination-out';
        drawCtx.strokeStyle = 'rgba(0,0,0,1)';
        drawCtx.lineWidth   = brushSize * 3;
      } else {
        drawCtx.globalCompositeOperation = 'source-over';
        drawCtx.strokeStyle = currentColor;
        drawCtx.lineWidth   = brushSize;
      }
      drawCtx.lineCap  = 'round';
      drawCtx.lineJoin = 'round';
      drawCtx.beginPath();
      drawCtx.moveTo(prevX, prevY);
      drawCtx.lineTo(ix, iy);
      drawCtx.stroke();
      drawCtx.restore();
    }
    prevX = ix; prevY = iy;
  } else {
    prevX = null; prevY = null;
  }
}
