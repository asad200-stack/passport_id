/* AI Passport & ID Photo (static, browser-only)
   - Camera capture + face validation (MediaPipe Face Detection)
   - Auto background to pure white (MediaPipe Selfie Segmentation)
   - Canvas-based enhancement + sharpening
   - A4 print sheet generator + JPG/PDF export
*/

(() => {
  "use strict";

  // --- Constants (print) ---
  const MM_PER_INCH = 25.4;
  // Keep the A4 sheet at 300DPI for mobile performance.
  // Render the passport crop at higher DPI for sharper output (then downsample onto the sheet).
  const SHEET_DPI = 300;
  const PHOTO_DPI = 450;
  const A4_MM = { w: 210, h: 297 };
  const PHOTO_MM = { w: 35, h: 45 };
  const PHOTO_AR = PHOTO_MM.w / PHOTO_MM.h; // 35:45

  const pxFromMm = (mm, dpi) => Math.round((mm / MM_PER_INCH) * dpi);
  const PHOTO_PX = { w: pxFromMm(PHOTO_MM.w, PHOTO_DPI), h: pxFromMm(PHOTO_MM.h, PHOTO_DPI) };
  const PHOTO_SHEET_PX = { w: pxFromMm(PHOTO_MM.w, SHEET_DPI), h: pxFromMm(PHOTO_MM.h, SHEET_DPI) };
  const SHEET_PX = { w: pxFromMm(A4_MM.w, SHEET_DPI), h: pxFromMm(A4_MM.h, SHEET_DPI) };

  const MP_FACE_VERSION = "0.4.1646425229";
  const MP_SEG_VERSION = "0.1.1675465747";

  // --- Elements ---
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const video = /** @type {HTMLVideoElement} */ ($("video"));
  const cameraSelect = /** @type {HTMLSelectElement} */ ($("cameraSelect"));
  const btnStart = /** @type {HTMLButtonElement} */ ($("btnStart"));
  const btnStop = /** @type {HTMLButtonElement} */ ($("btnStop"));
  const btnCapture = /** @type {HTMLButtonElement} */ ($("btnCapture"));
  const btnRetake = /** @type {HTMLButtonElement} */ ($("btnRetake"));
  const validationMsg = $("validationMsg");
  const statusPill = $("statusPill");
  const cameraHint = $("cameraHint");

  const qtySelect = /** @type {HTMLSelectElement} */ ($("qty"));
  const btnDownloadJpg = /** @type {HTMLButtonElement} */ ($("btnDownloadJpg"));
  const btnDownloadPdf = /** @type {HTMLButtonElement} */ ($("btnDownloadPdf"));

  const workCanvas = /** @type {HTMLCanvasElement} */ ($("workCanvas"));
  const maskCanvas = /** @type {HTMLCanvasElement} */ ($("maskCanvas"));
  const photoCanvas = /** @type {HTMLCanvasElement} */ ($("photoCanvas"));
  const sheetCanvasPreview = /** @type {HTMLCanvasElement} */ ($("sheetCanvasPreview"));

  const photoMeta = $("photoMeta");
  const sheetMeta = $("sheetMeta");
  const bgEngine = /** @type {HTMLSelectElement} */ ($("bgEngine"));
  const removebgKey = /** @type {HTMLInputElement} */ ($("removebgKey"));
  const apiKeyRow = $("apiKeyRow");

  // --- State ---
  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {string | null} */
  let activeDeviceId = null;
  let detectionTimer = null;
  let isDetecting = false;
  let lastValidation = { ok: false, reason: "No camera running.", severity: "info" };

  /** @type {any} */
  let faceDetection = null;
  /** @type {any} */
  let selfieSegmentation = null;

  /** @type {any} */
  let lastFaceResults = null;
  /** @type {any} */
  let lastSegResults = null;

  // Fast detection frame (downscaled) to keep iPhone responsive.
  const detectCanvas = document.createElement("canvas");
  /** @type {number} */
  const DETECT_MAX_W = 360;
  let noFaceStreak = 0;
  const segMaskCanvas = document.createElement("canvas");

  const STORAGE = {
    bgEngine: "passport_bg_engine",
    removebgKey: "passport_removebg_key",
  };

  // Face detection fallback mode:
  // - "mediapipe" (default)
  // - "shape" (Shape Detection API FaceDetector)
  // - "blazeface" (TensorFlow.js + BlazeFace, lazy-loaded)
  /** @type {"mediapipe" | "shape" | "blazeface"} */
  let faceMode = "mediapipe";
  /** @type {any} */
  let faceDetectorApi = null;
  /** @type {any} */
  let blazeModel = null;
  let mpFaceBroken = false;

  // Full-res sheet used for export (A4 @ 300dpi)
  const sheetCanvasFull = document.createElement("canvas");
  sheetCanvasFull.width = SHEET_PX.w;
  sheetCanvasFull.height = SHEET_PX.h;

  // --- UI helpers ---
  function setStatus(text, kind = "info") {
    statusPill.textContent = text;
    const map = {
      info: "rgba(15,23,42,.04)",
      ok: "rgba(22,163,74,.14)",
      warn: "rgba(217,119,6,.14)",
      bad: "rgba(225,29,72,.14)",
    };
    statusPill.style.background = map[kind] || map.info;
    statusPill.style.borderColor =
      kind === "ok"
        ? "rgba(22,163,74,.35)"
        : kind === "warn"
          ? "rgba(217,119,6,.35)"
          : kind === "bad"
            ? "rgba(225,29,72,.35)"
            : "rgba(15,23,42,.12)";
  }

  function setValidation(text, kind = "info") {
    validationMsg.textContent = text;
    lastValidation = {
      ok: kind === "ok",
      reason: text,
      severity: kind,
    };
    setStatus(kind === "ok" ? "Face OK" : kind === "warn" ? "Adjust" : kind === "bad" ? "Blocked" : "Ready", kind);
  }

  function isProbablyPureWhite(r, g, b) {
    return r >= 252 && g >= 252 && b >= 252;
  }

  function updateBgEngineUi() {
    const engine = bgEngine?.value || "mediapipe";
    if (apiKeyRow) apiKeyRow.style.display = engine === "removebg" ? "flex" : "none";
  }

  function enable(el, on) {
    el.disabled = !on;
  }

  function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${yyyy}-${mm}-${dd}_${hh}${mi}${ss}`;
  }

  // --- MediaPipe init ---
  async function initModelsOnce() {
    if (faceDetection && selfieSegmentation) return;
    if (!("FaceDetection" in window) || !("SelfieSegmentation" in window)) {
      throw new Error("AI libraries failed to load. Check your internet connection.");
    }

    faceDetection = new window.FaceDetection({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@${MP_FACE_VERSION}/${file}`,
    });
    faceDetection.setOptions({
      modelSelection: 0, // short-range (studio)
      minDetectionConfidence: 0.5, // faster unlock on mobile
    });
    faceDetection.onResults((r) => {
      lastFaceResults = r;
    });

    selfieSegmentation = new window.SelfieSegmentation({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MP_SEG_VERSION}/${file}`,
    });
    selfieSegmentation.setOptions({
      modelSelection: 1, // landscape model is generally cleaner edges
    });
    selfieSegmentation.onResults((r) => {
      lastSegResults = r;
    });
  }

  async function removeBackgroundStudioRemoveBg(srcCanvas) {
    const key = (removebgKey?.value || "").trim();
    if (!key) {
      throw new Error("Missing remove.bg API key. Paste it in the field under Background → Studio (remove.bg HD).");
    }

    // Convert to PNG blob
    const blob = await new Promise((resolve) => srcCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to encode image.");

    const fd = new FormData();
    fd.append("image_file", blob, "photo.png");
    fd.append("size", "auto");
    fd.append("format", "png");
    fd.append("bg_color", "FFFFFF"); // pure white background

    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": key },
      body: fd,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`remove.bg error (${res.status}). ${txt}`.trim());
    }

    const outBlob = await res.blob();
    const bmp = await createImageBitmap(outBlob);

    const out = document.createElement("canvas");
    out.width = srcCanvas.width;
    out.height = srcCanvas.height;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(bmp, 0, 0, out.width, out.height);
    return out;
  }

  function removeBackgroundFastOnDevice(pctx) {
    // MediaPipe mask + refinement + edge decontamination on canvas data.
    // This is still "best effort" vs true matting, but the Studio mode is the recommended path.
    // (We keep this for offline use.)
    return pctx;
  }

  function decontaminateEdgesTowardWhite(ctx, w, h) {
    // Remove yellow/gray fringing by forcing near-edge pixels toward white.
    // Detect "background-ish" pixels based on brightness and low saturation.
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (isProbablyPureWhite(r, g, b)) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      // If it's very bright and low saturation (typical fringe), push to white.
      if (max > 210 && sat < 0.22) {
        const t = (max - 210) / 45; // 0..1
        const k = Math.max(0, Math.min(1, t));
        d[i] = Math.round(r + (255 - r) * k);
        d[i + 1] = Math.round(g + (255 - g) * k);
        d[i + 2] = Math.round(b + (255 - b) * k);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function loadScriptOnce(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-url="${url}"]`);
      if (existing) return resolve();
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.dataset.url = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.head.appendChild(s);
    });
  }

  async function ensureFaceFallbackReady() {
    // If MediaPipe face is working, do nothing.
    if (!mpFaceBroken) return;

    // 1) Try native Shape Detection API (fast, no extra downloads).
    if (typeof window.FaceDetector === "function") {
      try {
        faceDetectorApi = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        faceMode = "shape";
        setValidation("Using compatibility face detection (native).", "warn");
        return;
      } catch {
        // continue to tfjs
      }
    }

    // 2) TFJS + BlazeFace (lazy-loaded)
    if (faceMode === "blazeface" && blazeModel) return;
    setValidation("Loading compatibility face detection… (first time may take a few seconds)", "warn");
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.umd.js");
    if (!window.tf || !window.blazeface) throw new Error("Compatibility face detection failed to initialize.");
    await window.tf.ready();
    blazeModel = await window.blazeface.load();
    faceMode = "blazeface";
    setValidation("Using compatibility face detection (TFJS).", "warn");
  }

  function isMpAbortError(e) {
    const msg = String(e?.message || e || "").toLowerCase();
    return msg.includes("aborted") || msg.includes("abort()");
  }

  async function detectNormFaceBox(imageElOrCanvas) {
    // Returns a normalized bbox-like object or null.
    if (faceMode === "mediapipe" && faceDetection && !mpFaceBroken) {
      await faceDetection.send({ image: imageElOrCanvas });
      const dets = lastFaceResults?.detections || [];
      if (!Array.isArray(dets) || dets.length === 0) return null;
      if (dets.length > 1) return "multiple";
      return normBboxFromDetection(dets[0]);
    }

    if (faceMode === "shape" && faceDetectorApi) {
      const faces = await faceDetectorApi.detect(imageElOrCanvas);
      if (!faces || faces.length === 0) return null;
      if (faces.length > 1) return "multiple";
      const bb = faces[0].boundingBox; // DOMRectReadOnly
      const w = imageElOrCanvas.videoWidth || imageElOrCanvas.width;
      const h = imageElOrCanvas.videoHeight || imageElOrCanvas.height;
      if (!w || !h) return null;
      const xCenter = (bb.x + bb.width / 2) / w;
      const yCenter = (bb.y + bb.height / 2) / h;
      return { xCenter, yCenter, width: bb.width / w, height: bb.height / h, xmin: bb.x / w, ymin: bb.y / h };
    }

    if (faceMode === "blazeface" && blazeModel) {
      const preds = await blazeModel.estimateFaces(imageElOrCanvas, false);
      if (!preds || preds.length === 0) return null;
      if (preds.length > 1) return "multiple";
      const p = preds[0];
      const w = imageElOrCanvas.videoWidth || imageElOrCanvas.width;
      const h = imageElOrCanvas.videoHeight || imageElOrCanvas.height;
      if (!w || !h) return null;
      // topLeft / bottomRight are [x,y]
      const tl = p.topLeft || (p.box && [p.box.xMin, p.box.yMin]) || [0, 0];
      const br = p.bottomRight || (p.box && [p.box.xMax, p.box.yMax]) || [0, 0];
      const xMin = tl[0];
      const yMin = tl[1];
      const xMax = br[0];
      const yMax = br[1];
      const bw = Math.max(1, xMax - xMin);
      const bh = Math.max(1, yMax - yMin);
      const xCenter = (xMin + bw / 2) / w;
      const yCenter = (yMin + bh / 2) / h;
      return { xCenter, yCenter, width: bw / w, height: bh / h, xmin: xMin / w, ymin: yMin / h };
    }

    return null;
  }

  function drawDetectFrameFromVideo() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const scale = Math.min(1, DETECT_MAX_W / vw);
    const w = Math.max(160, Math.round(vw * scale));
    const h = Math.max(160, Math.round(vh * scale));
    if (detectCanvas.width !== w) detectCanvas.width = w;
    if (detectCanvas.height !== h) detectCanvas.height = h;

    const ctx = detectCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    return detectCanvas;
  }

  async function maybeSwitchToFallbackIfStuck(bb) {
    // If MediaPipe is running but isn't seeing any face for a while,
    // auto-switch to a compatibility detector (helps iPhone Safari a lot).
    if (faceMode !== "mediapipe" || mpFaceBroken) return;

    if (!bb) noFaceStreak += 1;
    else noFaceStreak = 0;

    // ~2 seconds (validateLive runs ~ every 240ms)
    if (noFaceStreak >= 8) {
      mpFaceBroken = true;
      await ensureFaceFallbackReady();
      noFaceStreak = 0;
    }
  }

  // --- Camera ---
  async function listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    cameraSelect.innerHTML = "";
    if (cams.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No camera found";
      cameraSelect.appendChild(opt);
      enable(cameraSelect, false);
      return;
    }
    enable(cameraSelect, true);
    for (const cam of cams) {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera (${cam.deviceId.slice(0, 6)}…)`;
      cameraSelect.appendChild(opt);
    }
    if (activeDeviceId && cams.some((c) => c.deviceId === activeDeviceId)) {
      cameraSelect.value = activeDeviceId;
    }
  }

  function stopCamera() {
    if (detectionTimer) {
      clearInterval(detectionTimer);
      detectionTimer = null;
    }
    isDetecting = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
    activeDeviceId = null;
    enable(btnStop, false);
    enable(btnCapture, false);
    enable(btnRetake, false);
    setValidation("No camera running.", "info");
    cameraHint.textContent = "Start camera to begin.";
  }

  async function startCamera(deviceId) {
    stopCamera();
    await initModelsOnce();

    setStatus("Starting camera…", "info");
    cameraHint.textContent = "Starting…";

    const constraints = {
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings?.() || {};
    activeDeviceId = settings.deviceId || deviceId || null;

    enable(btnStop, true);
    enable(btnRetake, true);

    // Refresh device labels after permission is granted
    try {
      await listCameras();
    } catch {
      // ignore
    }

    cameraHint.textContent = "Face detection running…";
    setValidation("Detecting face…", "info");
    noFaceStreak = 0;

    detectionTimer = setInterval(() => {
      void validateLive();
    }, 220);
  }

  // --- Face detection / validation ---
  function normBboxFromDetection(det) {
    const bb = det?.boundingBox || det?.locationData?.relativeBoundingBox;
    if (!bb) return null;
    // formats we might see:
    // - {xCenter, yCenter, width, height}
    // - {xmin, ymin, width, height}
    if (typeof bb.xCenter === "number") {
      return {
        xCenter: bb.xCenter,
        yCenter: bb.yCenter,
        width: bb.width,
        height: bb.height,
        xmin: bb.xCenter - bb.width / 2,
        ymin: bb.yCenter - bb.height / 2,
      };
    }
    if (typeof bb.xmin === "number") {
      return {
        xCenter: bb.xmin + bb.width / 2,
        yCenter: bb.ymin + bb.height / 2,
        width: bb.width,
        height: bb.height,
        xmin: bb.xmin,
        ymin: bb.ymin,
      };
    }
    return null;
  }

  function validateFromNormBox(bb) {
    if (bb === "multiple") {
      return { ok: false, kind: "bad", msg: "Multiple faces detected. Only one person must be in frame." };
    }
    if (!bb) {
      return { ok: false, kind: "bad", msg: "No face detected. Please face the camera." };
    }

    const xOff = Math.abs(bb.xCenter - 0.5);
    const yOff = Math.abs(bb.yCenter - 0.45); // slightly above center is typical for head framing
    const faceH = bb.height;

    // Distance heuristics tuned for 35x45 guidance box
    const TOO_FAR = 0.18;
    const TOO_CLOSE = 0.58;

    if (faceH < TOO_FAR) return { ok: false, kind: "warn", msg: "Face too far. Move closer to the camera." };
    if (faceH > TOO_CLOSE) return { ok: false, kind: "warn", msg: "Face too close. Move back slightly." };
    if (xOff > 0.14 || yOff > 0.20) return { ok: false, kind: "warn", msg: "Center your face inside the guide." };

    return { ok: true, kind: "ok", msg: "Face detected and correctly sized. You can take the photo." };
  }

  async function validateLive() {
    if (!stream) return;
    if (isDetecting) return;
    if (!video.videoWidth || !video.videoHeight) return;
    isDetecting = true;
    try {
      const frame = drawDetectFrameFromVideo() || video;
      let bb;
      try {
        bb = await detectNormFaceBox(frame);
        await maybeSwitchToFallbackIfStuck(bb);
        if (mpFaceBroken && faceMode !== "mediapipe") {
          // re-run immediately on new detector for faster unlock
          bb = await detectNormFaceBox(frame);
        }
      } catch (e) {
        // MediaPipe can hard-abort on some iOS builds; switch to fallback.
        if (faceMode === "mediapipe" && isMpAbortError(e)) {
          mpFaceBroken = true;
          await ensureFaceFallbackReady();
          bb = await detectNormFaceBox(frame);
        } else {
          throw e;
        }
      }

      const v = validateFromNormBox(bb);
      setValidation(v.msg, v.kind);
      enable(btnCapture, v.ok);
    } catch (e) {
      enable(btnCapture, false);
      setValidation(`Face detection error. ${e?.message || ""}`.trim(), "bad");
    } finally {
      isDetecting = false;
    }
  }

  // --- Crop logic (auto, face-centered, 35:45 ratio) ---
  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function computeCropRectFromFace(normFaceBox, srcW, srcH) {
    // Estimate crop height based on face box (bbox is roughly face region).
    // For passport photos, face region should occupy ~55% of photo height (heuristic).
    const desiredFaceFrac = 0.55;
    let cropH = (normFaceBox.height * srcH) / desiredFaceFrac;
    cropH = clamp(cropH, srcH * 0.45, srcH * 0.98);
    let cropW = cropH * PHOTO_AR;
    if (cropW > srcW) {
      cropW = srcW;
      cropH = cropW / PHOTO_AR;
    }

    const cx = normFaceBox.xCenter * srcW;
    const cy = normFaceBox.yCenter * srcH;

    // Shift up slightly so chin isn't too low
    const cyShifted = cy - cropH * 0.08;

    let sx = cx - cropW / 2;
    let sy = cyShifted - cropH / 2;

    sx = clamp(sx, 0, srcW - cropW);
    sy = clamp(sy, 0, srcH - cropH);

    return { sx, sy, sw: cropW, sh: cropH };
  }

  // --- Image processing ---
  function applySubtleEnhancements(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // Passport-safe: preserve skin texture (no beautify / no heavy shadow lift).
    const brightness = 2; // -255..255
    const contrast = 1.04; // 1 = none
    const gamma = 1.0;
    const invGamma = 1 / gamma;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      // brightness + contrast
      r = (r - 128) * contrast + 128 + brightness;
      g = (g - 128) * contrast + 128 + brightness;
      b = (b - 128) * contrast + 128 + brightness;

      // No skin tone shifting (can look artificial)

      // gamma
      r = 255 * Math.pow(clamp(r, 0, 255) / 255, invGamma);
      g = 255 * Math.pow(clamp(g, 0, 255) / 255, invGamma);
      b = 255 * Math.pow(clamp(b, 0, 255) / 255, invGamma);

      // No shadow lifting (can create blotchy/white patches on faces)

      d[i] = clamp(r, 0, 255);
      d[i + 1] = clamp(g, 0, 255);
      d[i + 2] = clamp(b, 0, 255);
      // alpha stays
    }

    ctx.putImageData(img, 0, 0);
    unsharpLow(ctx, w, h);
  }

  function unsharpLow(ctx, w, h) {
    // Very mild sharpening (keeps pores/texture intact)
    const src = ctx.getImageData(0, 0, w, h);
    const dst = ctx.createImageData(w, h);
    const s = src.data;
    const d = dst.data;
    const k = [0, -0.6, 0, -0.6, 3.4, -0.6, 0, -0.6, 0];

    const idx = (x, y) => (y * w + x) * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let r = 0,
          g = 0,
          b = 0;
        let ki = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const ii = idx(x + ox, y + oy);
            const kv = k[ki++];
            r += s[ii] * kv;
            g += s[ii + 1] * kv;
            b += s[ii + 2] * kv;
          }
        }
        const o = idx(x, y);
        d[o] = clamp(r, 0, 255);
        d[o + 1] = clamp(g, 0, 255);
        d[o + 2] = clamp(b, 0, 255);
        d[o + 3] = s[o + 3];
      }
    }
    // copy borders
    for (let x = 0; x < w; x++) {
      let o1 = idx(x, 0);
      let o2 = idx(x, h - 1);
      d[o1] = s[o1];
      d[o1 + 1] = s[o1 + 1];
      d[o1 + 2] = s[o1 + 2];
      d[o1 + 3] = s[o1 + 3];
      d[o2] = s[o2];
      d[o2 + 1] = s[o2 + 1];
      d[o2 + 2] = s[o2 + 2];
      d[o2 + 3] = s[o2 + 3];
    }
    for (let y = 0; y < h; y++) {
      let o1 = idx(0, y);
      let o2 = idx(w - 1, y);
      d[o1] = s[o1];
      d[o1 + 1] = s[o1 + 1];
      d[o1 + 2] = s[o1 + 2];
      d[o1 + 3] = s[o1 + 3];
      d[o2] = s[o2];
      d[o2 + 1] = s[o2 + 1];
      d[o2 + 2] = s[o2 + 2];
      d[o2 + 3] = s[o2 + 3];
    }
    ctx.putImageData(dst, 0, 0);
  }

  function refineSegmentationMask(segMaskImage, w, h, facePoint) {
    // Make background removal more aggressive:
    // - Threshold the mask so background becomes 100% white
    // - Slight feather for cleaner edges
    // - Morphological close (fill tiny holes)
    segMaskCanvas.width = w;
    segMaskCanvas.height = h;
    const ctx = segMaskCanvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(segMaskImage, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // Tune for "clean white" (more removal; slightly less hair detail)
    const SOFT = 145;
    const HARD = 205;

    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]; // grayscale intensity
      let a = 0;
      if (v >= HARD) a = 255;
      else if (v <= SOFT) a = 0;
      else a = Math.round(((v - SOFT) / (HARD - SOFT)) * 255);
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = a;
    }

    // Morphological close on alpha (3x3): dilate then erode
    const alpha = new Uint8ClampedArray((d.length / 4) | 0);
    for (let p = 0, j = 0; p < d.length; p += 4, j++) alpha[j] = d[p + 3];
    const dil = morphAlpha(alpha, w, h, true);
    const clo = morphAlpha(dil, w, h, false);
    // Trim edges slightly to remove background halos (especially around hair)
    const trimmed = morphAlpha(clo, w, h, false);

    // Keep only the connected component that contains the face (removes stray background blobs)
    const kept = keepComponentContainingPoint(trimmed, w, h, facePoint);

    // Tiny blur for softer edges (reduces jaggies)
    const blurred = boxBlurAlpha3x3(kept, w, h);

    for (let p = 0, j = 0; p < d.length; p += 4, j++) d[p + 3] = blurred[j];

    ctx.putImageData(img, 0, 0);
    return segMaskCanvas;
  }

  function refineSegmentationMaskLite(segMaskImage, w, h) {
    // Lite refinement:
    // - smooth alpha ramp + tiny feather (1px)
    // - preserves hair/skin detail better than aggressive masking
    segMaskCanvas.width = w;
    segMaskCanvas.height = h;
    const ctx = segMaskCanvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(segMaskImage, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const SOFT = 60;
    const HARD = 210;

    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      const t = Math.max(0, Math.min(1, (v - SOFT) / (HARD - SOFT)));
      const a = Math.round(255 * Math.pow(t, 0.9));
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = a;
    }

    const alpha = new Uint8ClampedArray((d.length / 4) | 0);
    for (let p = 0, j = 0; p < d.length; p += 4, j++) alpha[j] = d[p + 3];
    const blurred = boxBlurAlpha3x3(alpha, w, h);
    for (let p = 0, j = 0; p < d.length; p += 4, j++) d[p + 3] = blurred[j];

    ctx.putImageData(img, 0, 0);
    return segMaskCanvas;
  }

  function keepComponentContainingPoint(alpha, w, h, facePoint) {
    if (!facePoint) return alpha;
    const n = w * h;
    const th = 40; // treat low alpha as background
    let sx = Math.round(facePoint.x);
    let sy = Math.round(facePoint.y);
    sx = clamp(sx, 0, w - 1);
    sy = clamp(sy, 0, h - 1);

    const seedIndex = () => sy * w + sx;
    let sIdx = seedIndex();

    // If the exact point is not in the mask, search a small neighborhood.
    if (alpha[sIdx] < th) {
      let found = -1;
      const R = 14;
      for (let r = 1; r <= R && found < 0; r++) {
        const y0 = clamp(sy - r, 0, h - 1);
        const y1 = clamp(sy + r, 0, h - 1);
        const x0 = clamp(sx - r, 0, w - 1);
        const x1 = clamp(sx + r, 0, w - 1);
        // scan border of the square ring
        for (let x = x0; x <= x1 && found < 0; x++) {
          const a1 = alpha[y0 * w + x];
          const a2 = alpha[y1 * w + x];
          if (a1 >= th) found = y0 * w + x;
          else if (a2 >= th) found = y1 * w + x;
        }
        for (let y = y0; y <= y1 && found < 0; y++) {
          const a1 = alpha[y * w + x0];
          const a2 = alpha[y * w + x1];
          if (a1 >= th) found = y * w + x0;
          else if (a2 >= th) found = y * w + x1;
        }
      }
      if (found < 0) return alpha;
      sIdx = found;
    }

    const visited = new Uint8Array(n);
    const keep = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    q[tail++] = sIdx;
    visited[sIdx] = 1;

    while (head < tail) {
      const i = q[head++];
      keep[i] = 1;
      const x = i % w;
      const y = (i / w) | 0;
      // 4-neighborhood
      if (x > 0) {
        const ni = i - 1;
        if (!visited[ni] && alpha[ni] >= th) {
          visited[ni] = 1;
          q[tail++] = ni;
        }
      }
      if (x < w - 1) {
        const ni = i + 1;
        if (!visited[ni] && alpha[ni] >= th) {
          visited[ni] = 1;
          q[tail++] = ni;
        }
      }
      if (y > 0) {
        const ni = i - w;
        if (!visited[ni] && alpha[ni] >= th) {
          visited[ni] = 1;
          q[tail++] = ni;
        }
      }
      if (y < h - 1) {
        const ni = i + w;
        if (!visited[ni] && alpha[ni] >= th) {
          visited[ni] = 1;
          q[tail++] = ni;
        }
      }
    }

    // Zero-out everything not connected to face
    for (let i = 0; i < n; i++) {
      if (!keep[i]) alpha[i] = 0;
    }
    return alpha;
  }

  function boxBlurAlpha3x3(src, w, h) {
    const dst = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          dst[i] = src[i];
          continue;
        }
        let sum = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const row = (y + oy) * w;
          for (let ox = -1; ox <= 1; ox++) sum += src[row + (x + ox)];
        }
        dst[i] = (sum / 9) | 0;
      }
    }
    return dst;
  }

  function morphAlpha(src, w, h, dilate) {
    const dst = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          dst[i] = src[i];
          continue;
        }
        let v = dilate ? 0 : 255;
        for (let oy = -1; oy <= 1; oy++) {
          const row = (y + oy) * w;
          for (let ox = -1; ox <= 1; ox++) {
            const s = src[row + (x + ox)];
            v = dilate ? Math.max(v, s) : Math.min(v, s);
          }
        }
        dst[i] = v;
      }
    }
    return dst;
  }

  // --- Capture -> Process ---
  async function captureAndProcess() {
    if (!stream) return;
    if (!lastValidation.ok) {
      setValidation("Capture blocked. Fix the validation message first.", "bad");
      return;
    }

    // Pause live validation while processing
    if (detectionTimer) {
      clearInterval(detectionTimer);
      detectionTimer = null;
    }
    enable(btnCapture, false);
    setStatus("Processing…", "info");
    setValidation("Processing photo… (background + enhancement)", "info");

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) {
      setValidation("Camera not ready. Try again.", "bad");
      return;
    }

    workCanvas.width = srcW;
    workCanvas.height = srcH;
    const wctx = workCanvas.getContext("2d", { willReadFrequently: true });
    wctx.drawImage(video, 0, 0, srcW, srcH);

    // Re-run detection on captured frame for stable bbox.
    let bb;
    try {
      bb = await detectNormFaceBox(workCanvas);
    } catch (e) {
      if (faceMode === "mediapipe" && isMpAbortError(e)) {
        mpFaceBroken = true;
        await ensureFaceFallbackReady();
        bb = await detectNormFaceBox(workCanvas);
      } else {
        throw e;
      }
    }
    const v = validateFromNormBox(bb);
    if (!v.ok) {
      setValidation(`Capture blocked: ${v.msg}`, v.kind === "warn" ? "warn" : "bad");
      // Resume live validation
      detectionTimer = setInterval(() => void validateLive(), 240);
      return;
    }

    const crop = computeCropRectFromFace(bb, srcW, srcH);

    // Crop into a canvas that matches passport output pixels
    photoCanvas.width = PHOTO_PX.w;
    photoCanvas.height = PHOTO_PX.h;
    const pctx = photoCanvas.getContext("2d", { willReadFrequently: true });
    pctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(workCanvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, PHOTO_PX.w, PHOTO_PX.h);

    // Segmentation (remove background -> white)
    maskCanvas.width = PHOTO_PX.w;
    maskCanvas.height = PHOTO_PX.h;
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });

    const engine = bgEngine?.value || "mediapipe";
    if (engine === "removebg") {
      // Professional-grade background removal via remove.bg
      setValidation("Processing (remove.bg HD)…", "info");
      const out = await removeBackgroundStudioRemoveBg(photoCanvas);
      pctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      pctx.drawImage(out, 0, 0);
    } else {
      // On-device (best-effort)
      lastSegResults = null;
      try {
        await selfieSegmentation.send({ image: photoCanvas });
      } catch (e) {
        applySubtleEnhancements(pctx, PHOTO_PX.w, PHOTO_PX.h);
        afterProcessSuccess({ note: "Segmentation not supported on this device (kept original background)." });
        return;
      }
      if (!lastSegResults?.segmentationMask) {
        applySubtleEnhancements(pctx, PHOTO_PX.w, PHOTO_PX.h);
        afterProcessSuccess({ note: "Segmentation unavailable (kept original background)." });
        return;
      }

      // Use lite mask refinement to avoid aggressive cutouts / face corruption.
      const refinedMask = refineSegmentationMaskLite(lastSegResults.segmentationMask, PHOTO_PX.w, PHOTO_PX.h);
      mctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      mctx.drawImage(photoCanvas, 0, 0, PHOTO_PX.w, PHOTO_PX.h);
      mctx.globalCompositeOperation = "destination-in";
      mctx.drawImage(refinedMask, 0, 0, PHOTO_PX.w, PHOTO_PX.h);
      mctx.globalCompositeOperation = "source-over";

      // Composite onto pure white background
      pctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      pctx.drawImage(maskCanvas, 0, 0);
    }

    // Enhance (brightness/contrast/shadows/sharpen)
    applySubtleEnhancements(pctx, PHOTO_PX.w, PHOTO_PX.h);
    afterProcessSuccess({ note: engine === "removebg" ? "Studio background removal applied." : "Background set to pure white." });
  }

  function afterProcessSuccess({ note }) {
    photoMeta.textContent = `${PHOTO_MM.w}×${PHOTO_MM.h}mm • ${PHOTO_PX.w}×${PHOTO_PX.h}px @ ${PHOTO_DPI}DPI`;
    setValidation(`Done. ${note}`, "ok");
    enable(qtySelect, true);
    enable(btnDownloadJpg, true);
    enable(btnDownloadPdf, true);
    renderSheetAll();
  }

  // --- Sheet generation ---
  function gridForQty(qty) {
    if (qty === 1) return { cols: 1, rows: 1 };
    if (qty === 4) return { cols: 2, rows: 2 };
    if (qty === 8) return { cols: 2, rows: 4 };
    if (qty === 12) return { cols: 3, rows: 4 };
    // fallback
    return { cols: 2, rows: Math.max(1, Math.ceil(qty / 2)) };
  }

  function renderSheet(targetCanvas, targetW, targetH, qty) {
    const ctx = targetCanvas.getContext("2d", { willReadFrequently: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetW, targetH);

    // Convert print sizes to this canvas scale
    const scaleX = targetW / SHEET_PX.w;
    const scaleY = targetH / SHEET_PX.h;
    const scale = Math.min(scaleX, scaleY);

    // Keep real-world sizes correct for A4@300DPI (even if photo crop is rendered at higher DPI).
    const photoW = PHOTO_SHEET_PX.w * scale;
    const photoH = PHOTO_SHEET_PX.h * scale;
    const margin = 10 * (SHEET_DPI / MM_PER_INCH) * scale; // ~10mm in px scaled

    const { cols, rows } = gridForQty(qty);
    let gap = 7 * (SHEET_DPI / MM_PER_INCH) * scale; // ~7mm

    let gridW = cols * photoW + (cols - 1) * gap;
    let gridH = rows * photoH + (rows - 1) * gap;

    // If it doesn't fit, tighten the gap.
    const maxW = targetW - margin * 2;
    const maxH = targetH - margin * 2;
    if (gridW > maxW && cols > 1) {
      gap = Math.max(2 * scale, (maxW - cols * photoW) / (cols - 1));
      gridW = cols * photoW + (cols - 1) * gap;
    }
    if (gridH > maxH && rows > 1) {
      gap = Math.max(2 * scale, Math.min(gap, (maxH - rows * photoH) / (rows - 1)));
      gridH = rows * photoH + (rows - 1) * gap;
    }

    const startX = (targetW - gridW) / 2;
    const startY = (targetH - gridH) / 2;

    // Draw photos
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.10)";
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 3 * scale;

    const stroke = Math.max(1, Math.round(1.2 * scale));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= qty) break;
        const x = startX + c * (photoW + gap);
        const y = startY + r * (photoH + gap);
        ctx.drawImage(photoCanvas, x, y, photoW, photoH);
        ctx.shadowColor = "transparent";
        ctx.lineWidth = stroke;
        ctx.strokeStyle = "rgba(0,0,0,.18)";
        ctx.strokeRect(x, y, photoW, photoH);
        ctx.shadowColor = "rgba(0,0,0,.10)";
      }
    }
    ctx.restore();
  }

  function renderSheetAll() {
    const qty = parseInt(qtySelect.value, 10);
    // Full-res render
    renderSheet(sheetCanvasFull, SHEET_PX.w, SHEET_PX.h, qty);
    // Preview render
    const pW = sheetCanvasPreview.width;
    const pH = sheetCanvasPreview.height;
    renderSheet(sheetCanvasPreview, pW, pH, qty);

    sheetMeta.textContent = `A4 ${A4_MM.w}×${A4_MM.h}mm • ${SHEET_PX.w}×${SHEET_PX.h}px @ ${SHEET_DPI}DPI • Qty ${qty}`;
  }

  // --- Download helpers ---
  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function exportJpg() {
    const qty = parseInt(qtySelect.value, 10);
    const name = `passport_sheet_${nowStamp()}_x${qty}.jpg`;
    const dataUrl = sheetCanvasFull.toDataURL("image/jpeg", 0.95);
    downloadDataUrl(dataUrl, name);
  }

  function exportPdf() {
    const qty = parseInt(qtySelect.value, 10);
    const name = `passport_sheet_${nowStamp()}_x${qty}.pdf`;
    const dataUrl = sheetCanvasFull.toDataURL("image/jpeg", 0.95);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(dataUrl, "JPEG", 0, 0, A4_MM.w, A4_MM.h, undefined, "FAST");
    pdf.save(name);
  }

  // --- Wire up events ---
  async function boot() {
    // Restore saved settings
    try {
      const savedEngine = localStorage.getItem(STORAGE.bgEngine);
      if (savedEngine && bgEngine) bgEngine.value = savedEngine;
      const savedKey = localStorage.getItem(STORAGE.removebgKey);
      if (savedKey && removebgKey) removebgKey.value = savedKey;
    } catch {
      // ignore
    }
    updateBgEngineUi();

    setStatus("Ready", "info");
    photoCanvas.width = PHOTO_PX.w;
    photoCanvas.height = PHOTO_PX.h;

    const pctx = photoCanvas.getContext("2d");
    pctx.fillStyle = "#ffffff";
    pctx.fillRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);

    const sctx = sheetCanvasPreview.getContext("2d");
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, sheetCanvasPreview.width, sheetCanvasPreview.height);

    // Attempt device listing (labels may be blank until permission)
    try {
      await listCameras();
    } catch {
      // ignore
    }

    btnStart.addEventListener("click", async () => {
      try {
        const id = cameraSelect.value || null;
        enable(btnStart, false);
        await startCamera(id);
        enable(btnStart, true);
      } catch (e) {
        enable(btnStart, true);
        setValidation(`Camera error: ${e?.message || "Unable to start camera."}`, "bad");
        setStatus("Blocked", "bad");
        cameraHint.textContent = "Camera blocked or unavailable.";
      }
    });

    btnStop.addEventListener("click", () => stopCamera());

    btnCapture.addEventListener("click", () => {
      void captureAndProcess();
    });

    btnRetake.addEventListener("click", () => {
      // Resume live validation after retake
      if (!stream) return;
      enable(btnDownloadJpg, false);
      enable(btnDownloadPdf, false);
      enable(qtySelect, false);
      photoMeta.textContent = "—";
      sheetMeta.textContent = "—";
      setValidation("Detecting face…", "info");
      if (!detectionTimer) {
        detectionTimer = setInterval(() => void validateLive(), 240);
      }
    });

    if (bgEngine) {
      bgEngine.addEventListener("change", () => {
        try {
          localStorage.setItem(STORAGE.bgEngine, bgEngine.value);
        } catch {
          // ignore
        }
        updateBgEngineUi();
      });
    }
    if (removebgKey) {
      removebgKey.addEventListener("input", () => {
        try {
          localStorage.setItem(STORAGE.removebgKey, removebgKey.value);
        } catch {
          // ignore
        }
      });
    }

    cameraSelect.addEventListener("change", async () => {
      if (!stream) return;
      try {
        await startCamera(cameraSelect.value);
      } catch (e) {
        setValidation(`Camera switch error: ${e?.message || ""}`.trim(), "bad");
      }
    });

    qtySelect.addEventListener("change", () => renderSheetAll());
    btnDownloadJpg.addEventListener("click", () => exportJpg());
    btnDownloadPdf.addEventListener("click", () => exportPdf());

    // Stop camera on page hide (mobile reliability)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") stopCamera();
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    void boot();
  });
})();

