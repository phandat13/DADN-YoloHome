// Trích vector đặc trưng khuôn mặt 128 chiều từ webcam bằng face-api.js (@vladmandic/face-api).
// Backend so khớp bằng khoảng cách Euclid (< 0.6) — đúng chuẩn descriptor của face-api.js.
// Thư viện + mô hình (~8 MB) chỉ tải khi người dùng bấm "Lấy vector" lần đầu.
const VERSION = '1.7.15';
const BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VERSION}`;

let loading = null;

export function loadFaceApi() {
  loading ??= (async () => {
    const faceapi = await import(`${BASE}/dist/face-api.esm.js`);
    await faceapi.tf?.ready?.();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(`${BASE}/model`),
      faceapi.nets.faceLandmark68Net.loadFromUri(`${BASE}/model`),
      faceapi.nets.faceRecognitionNet.loadFromUri(`${BASE}/model`),
    ]);
    return faceapi;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

// Trả về mảng 128 số thực, hoặc null nếu không thấy khuôn mặt.
export async function extractDescriptor(video) {
  const faceapi = await loadFaceApi();
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  return Array.from(result.descriptor, (v) => Math.round(v * 1e6) / 1e6);
}

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt không hỗ trợ camera (cần HTTPS hoặc localhost)');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera(stream, video) {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}

// Đọc vector người dùng dán vào: JSON "[0.1, 0.2, ...]" hoặc "0.1, 0.2, ...".
export function parseVector(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  let arr;
  try { arr = JSON.parse(s.startsWith('[') ? s : `[${s}]`); } catch { return null; }
  if (!Array.isArray(arr) || !arr.length || !arr.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return arr;
}
