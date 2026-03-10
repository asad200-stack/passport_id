/* AI Passport & ID Photo (static, browser-only)
   - Camera capture + face validation (MediaPipe Face Detection)
   - Background removal via remove.bg (Studio HD)
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
  /** Default passport size – never changed; used for capture and for "Default" print. */
  const DEFAULT_PHOTO_MM = { w: 35, h: 45 };
  const PHOTO_MM = { w: DEFAULT_PHOTO_MM.w, h: DEFAULT_PHOTO_MM.h };
  const PHOTO_AR = PHOTO_MM.w / PHOTO_MM.h; // 35:45
  const SHEET_LAYOUT = {
    maxCols: 5, // user requested: 5 photos per row
    marginMm: 5,
    gapMm: 1,
  };

  const pxFromMm = (mm, dpi) => Math.round((mm / MM_PER_INCH) * dpi);
  const PHOTO_PX = { w: pxFromMm(PHOTO_MM.w, PHOTO_DPI), h: pxFromMm(PHOTO_MM.h, PHOTO_DPI) };
  const PHOTO_SHEET_PX = { w: pxFromMm(PHOTO_MM.w, SHEET_DPI), h: pxFromMm(PHOTO_MM.h, SHEET_DPI) };
  const SHEET_PX = { w: pxFromMm(A4_MM.w, SHEET_DPI), h: pxFromMm(A4_MM.h, SHEET_DPI) };

  const MP_FACE_VERSION = "0.4.1646425229";

  const BG_COLORS = { white: "FFFFFF", gray: "D0D0D0" };

  // --- Elements ---
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const video = /** @type {HTMLVideoElement} */ ($("video"));
  const cameraSelect = /** @type {HTMLSelectElement} */ ($("cameraSelect"));
  const btnStart = /** @type {HTMLButtonElement} */ ($("btnStart"));
  const btnStop = /** @type {HTMLButtonElement} */ ($("btnStop"));
  const btnCapture = /** @type {HTMLButtonElement} */ ($("btnCapture"));
  const btnRetake = /** @type {HTMLButtonElement} */ ($("btnRetake"));
  const btnUpload = /** @type {HTMLButtonElement} */ ($("btnUpload"));
  const fileInput = /** @type {HTMLInputElement} */ ($("fileInput"));
  const validationMsg = $("validationMsg");
  const statusPill = $("statusPill");
  const cameraHint = $("cameraHint");

  const qtyInput = /** @type {HTMLInputElement} */ ($("qty"));
  const btnDownloadJpg = /** @type {HTMLButtonElement} */ ($("btnDownloadJpg"));
  const btnDownloadPdf = /** @type {HTMLButtonElement} */ ($("btnDownloadPdf"));
  const customSizePanel = $("customSizePanel");
  const customSizeSelect = /** @type {HTMLSelectElement} */ ($("customSizeSelect"));
  const customW = /** @type {HTMLInputElement} */ ($("customW"));
  const customH = /** @type {HTMLInputElement} */ ($("customH"));
  const customName = /** @type {HTMLInputElement} */ ($("customName"));
  const btnSaveCustomSize = /** @type {HTMLButtonElement} */ ($("btnSaveCustomSize"));
  const customSizeSaveFeedback = $("customSizeSaveFeedback");

  const workCanvas = /** @type {HTMLCanvasElement} */ ($("workCanvas"));
  const maskCanvas = /** @type {HTMLCanvasElement} */ ($("maskCanvas"));
  const photoCanvas = /** @type {HTMLCanvasElement} */ ($("photoCanvas"));
  const sheetCanvasPreview = /** @type {HTMLCanvasElement} */ ($("sheetCanvasPreview"));

  const photoMeta = $("photoMeta");
  const sheetMeta = $("sheetMeta");
  const removebgKey = /** @type {HTMLInputElement} */ ($("removebgKey"));
  const btnApplyBg = /** @type {HTMLButtonElement} */ ($("btnApplyBg"));

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
  let lastFaceResults = null;

  // Fast detection frame (downscaled) to keep iPhone responsive.
  const detectCanvas = document.createElement("canvas");
  /** @type {number} */
  const DETECT_MAX_W = 360;
  let noFaceStreak = 0;

  // Keep an unprocessed crop so Studio/Fast can be re-applied without stacking filters.
  const rawPhotoCanvas = document.createElement("canvas");
  let hasRawPhoto = false;

  const STORAGE = {
    removebgKey: "passport_removebg_key",
    rawPhoto: "passport_raw_photo_v1",
    bgColor: "passport_bg_color",
    customSizes: "passport_custom_sizes",
    printSizeMode: "passport_print_size_mode",
    printSizeCustomId: "passport_print_size_custom_id",
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

  // Track last valid quantity so empty typing doesn't "snap" instantly.
  let lastGoodQty = 12;

  /** @type {{ id: string; name: string; w: number; h: number }[]} */
  let customSizesList = [];
  /** When custom mode: selected saved size id, or null if using inline W/H. */
  let selectedCustomSizeId = null;
  /** Inline custom W/H (mm) when user types but hasn't saved. */
  let inlineCustomMm = null;

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

  function updateApplyBgUi() {
    if (btnApplyBg) enable(btnApplyBg, hasRawPhoto);
  }

  function getBackgroundColorHex() {
    const radio = document.querySelector('input[name="bgColor"]:checked');
    const v = radio?.getAttribute("value");
    return typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : BG_COLORS.white;
  }

  async function restoreRawPhotoFromSession() {
    try {
      const dataUrl = sessionStorage.getItem(STORAGE.rawPhoto);
      if (!dataUrl) return false;

      const img = new Image();
      img.decoding = "async";
      img.src = dataUrl;

      if (img.decode) {
        try {
          await img.decode();
        } catch {
          await new Promise((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error("Failed to load stored photo."));
          });
        }
      } else {
        await new Promise((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("Failed to load stored photo."));
        });
      }

      rawPhotoCanvas.width = PHOTO_PX.w;
      rawPhotoCanvas.height = PHOTO_PX.h;
      const rctx = rawPhotoCanvas.getContext("2d", { willReadFrequently: true });
      rctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      rctx.drawImage(img, 0, 0, PHOTO_PX.w, PHOTO_PX.h);

      photoCanvas.width = PHOTO_PX.w;
      photoCanvas.height = PHOTO_PX.h;
      const pctx = photoCanvas.getContext("2d", { willReadFrequently: true });
      pctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      pctx.drawImage(rawPhotoCanvas, 0, 0);

      hasRawPhoto = true;
      photoMeta.textContent = `${PHOTO_MM.w}×${PHOTO_MM.h}mm • ${PHOTO_PX.w}×${PHOTO_PX.h}px @ ${PHOTO_DPI}DPI`;
      updateApplyBgUi();
      return true;
    } catch {
      return false;
    }
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

  // --- MediaPipe init (face detection only) ---
  async function initModelsOnce() {
    if (faceDetection) return;
    if (!("FaceDetection" in window)) {
      throw new Error("AI library failed to load. Check your internet connection.");
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
  }

  async function removeBackgroundStudioRemoveBg(srcCanvas, bgColorHex) {
    const key = (removebgKey?.value || "").trim();
    if (!key) {
      throw new Error("Missing remove.bg API key. Paste it in the field above.");
    }

    // Convert to PNG blob
    const blob = await new Promise((resolve) => srcCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to encode image.");

    const fd = new FormData();
    fd.append("image_file", blob, "photo.png");
    fd.append("size", "auto");
    fd.append("format", "png");
    fd.append("bg_color", (bgColorHex || BG_COLORS.white).replace(/^#/, ""));

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
    const hex = (bgColorHex || BG_COLORS.white).replace(/^#/, "");
    ctx.fillStyle = "#" + hex;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(bmp, 0, 0, out.width, out.height);
    return out;
  }
  async function applyBackgroundToCurrent() {
    if (!hasRawPhoto) {
      setValidation("No photo captured yet. Take Photo first.", "warn");
      return;
    }
    const bgHex = getBackgroundColorHex();
    const pctx = photoCanvas.getContext("2d", { willReadFrequently: true });
    setStatus("Processing…", "info");
    try {
      setValidation("Applying Studio background (remove.bg)…", "info");
      const out = await removeBackgroundStudioRemoveBg(rawPhotoCanvas, bgHex);
      pctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      pctx.fillStyle = "#" + bgHex;
      pctx.fillRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
      pctx.drawImage(out, 0, 0);

      // Subtle final adjustments (safe)
      applySubtleEnhancements(pctx, PHOTO_PX.w, PHOTO_PX.h);
      afterProcessSuccess({ note: "Studio background applied." });
    } catch (e) {
      const msg = String(e?.message || e || "Unknown error");
      setValidation(`Background apply failed: ${msg}`, "bad");
      setStatus("Blocked", "bad");
    }
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

  /** Max number of photos that fit on A4 for given photo size in mm. */
  function maxQtyForA4(photoMm) {
    const pm = photoMm || PHOTO_MM;
    const usableW = A4_MM.w - 2 * SHEET_LAYOUT.marginMm;
    const usableH = A4_MM.h - 2 * SHEET_LAYOUT.marginMm;
    const cols = Math.max(
      1,
      Math.min(SHEET_LAYOUT.maxCols, Math.floor((usableW + SHEET_LAYOUT.gapMm) / (pm.w + SHEET_LAYOUT.gapMm))),
    );
    const rows = Math.max(1, Math.floor((usableH + SHEET_LAYOUT.gapMm) / (pm.h + SHEET_LAYOUT.gapMm)));
    return cols * rows;
  }

  const MAX_QTY_A4 = maxQtyForA4(PHOTO_MM); // typically 30 (5x6) for 35x45 on A4

  function parseQtyLenient() {
    const s = String(qtyInput?.value ?? "").trim();
    if (!s) return null; // allow empty while typing
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  }

  function getMaxQtyForCurrentSize() {
    return maxQtyForA4(getEffectivePrintSize());
  }

  function clampQty(n) {
    return clamp(n, 1, getMaxQtyForCurrentSize());
  }

  function getQtyForRender() {
    const n = parseQtyLenient();
    if (n == null) return null;
    const q = clampQty(n);
    lastGoodQty = q;
    return q;
  }

  function normalizeQtyInInput() {
    const n = parseQtyLenient();
    const q = clampQty(n == null ? lastGoodQty : n);
    lastGoodQty = q;
    if (qtyInput) qtyInput.value = String(q);
    return q;
  }

  // --- Custom print sizes ---
  function loadCustomSizes() {
    try {
      const raw = localStorage.getItem(STORAGE.customSizes);
      if (!raw) {
        customSizesList = [];
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        customSizesList = [];
        return;
      }
      customSizesList = parsed.filter(
        (item) =>
          item && typeof item.id === "string" && typeof item.w === "number" && typeof item.h === "number" && item.w >= 10 && item.h >= 10 && item.w <= 80 && item.h <= 80
      ).map((item) => ({ id: item.id, name: typeof item.name === "string" ? item.name : `${item.w}×${item.h} mm`, w: item.w, h: item.h }));
    } catch {
      customSizesList = [];
    }
  }

  function saveCustomSizes() {
    try {
      localStorage.setItem(STORAGE.customSizes, JSON.stringify(customSizesList));
      const read = localStorage.getItem(STORAGE.customSizes);
      if (!read || JSON.parse(read).length !== customSizesList.length) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Returns current print size in mm { w, h }. Default size or selected custom. */
  function getEffectivePrintSize() {
    const mode = document.querySelector('input[name="printSizeMode"]:checked')?.getAttribute("value");
    if (mode !== "custom") return { w: DEFAULT_PHOTO_MM.w, h: DEFAULT_PHOTO_MM.h };

    if (selectedCustomSizeId) {
      const found = customSizesList.find((s) => s.id === selectedCustomSizeId);
      if (found) return { w: found.w, h: found.h };
    }
    const w = Number(customW?.value);
    const h = Number(customH?.value);
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 10 && h >= 10 && w <= 80 && h <= 80) {
      return { w: Math.round(w), h: Math.round(h) };
    }
    if (inlineCustomMm) return inlineCustomMm;
    if (customSizesList.length > 0) return { w: customSizesList[0].w, h: customSizesList[0].h };
    return { w: DEFAULT_PHOTO_MM.w, h: DEFAULT_PHOTO_MM.h };
  }

  /** @param {string} [preselectId] If given, select this option after building (for newly saved size). */
  function refreshCustomSizeSelect(preselectId) {
    if (!customSizeSelect) return;
    const currentId = preselectId || customSizeSelect.value;
    customSizeSelect.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Choose or add new —";
    customSizeSelect.appendChild(opt0);
    for (const s of customSizesList) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name || `${s.w}×${s.h} mm`} (${s.w}×${s.h})`;
      customSizeSelect.appendChild(opt);
    }
    const idToUse = currentId && customSizesList.some((s) => s.id === currentId) ? currentId : "";
    customSizeSelect.value = idToUse;
  }

  function updateCustomSizePanelVisibility() {
    const mode = document.querySelector('input[name="printSizeMode"]:checked')?.getAttribute("value");
    if (customSizePanel) customSizePanel.hidden = mode !== "custom";
  }

  function updateQtyMaxFromPrintSize() {
    const max = getMaxQtyForCurrentSize();
    if (qtyInput) {
      qtyInput.max = String(max);
      const n = parseQtyLenient();
      if (n != null && n > max) {
        qtyInput.value = String(max);
        lastGoodQty = max;
      }
    }
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
    await processSourceCanvas(workCanvas);
  }

  async function processSourceCanvas(srcCanvas) {
    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;

    // Detect face (required for correct crop)
    let bb;
    try {
      bb = await detectNormFaceBox(srcCanvas);
    } catch (e) {
      if (faceMode === "mediapipe" && isMpAbortError(e)) {
        mpFaceBroken = true;
        await ensureFaceFallbackReady();
        bb = await detectNormFaceBox(srcCanvas);
      } else {
        throw e;
      }
    }

    const v = validateFromNormBox(bb);
    if (!v.ok) {
      setValidation(`Blocked: ${v.msg}`, v.kind === "warn" ? "warn" : "bad");
      // Resume live validation only if camera is running
      if (stream && !detectionTimer) detectionTimer = setInterval(() => void validateLive(), 240);
      return;
    }

    const crop = computeCropRectFromFace(bb, srcW, srcH);

    // Build RAW crop
    rawPhotoCanvas.width = PHOTO_PX.w;
    rawPhotoCanvas.height = PHOTO_PX.h;
    const rctx = rawPhotoCanvas.getContext("2d", { willReadFrequently: true });
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = "high";
    rctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
    rctx.drawImage(srcCanvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, PHOTO_PX.w, PHOTO_PX.h);

    // Copy RAW into visible photo canvas
    photoCanvas.width = PHOTO_PX.w;
    photoCanvas.height = PHOTO_PX.h;
    const pctx = photoCanvas.getContext("2d", { willReadFrequently: true });
    pctx.clearRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);
    pctx.drawImage(rawPhotoCanvas, 0, 0);

    hasRawPhoto = true;
    updateApplyBgUi();

    // Persist RAW in this browser session so Apply Background remains clickable
    try {
      const dataUrl = rawPhotoCanvas.toDataURL("image/jpeg", 0.95);
      sessionStorage.setItem(STORAGE.rawPhoto, dataUrl);
    } catch {
      // ignore
    }

    await applyBackgroundToCurrent();
  }

  function afterProcessSuccess({ note }) {
    photoMeta.textContent = `${PHOTO_MM.w}×${PHOTO_MM.h}mm • ${PHOTO_PX.w}×${PHOTO_PX.h}px @ ${PHOTO_DPI}DPI`;
    setValidation(`Done. ${note}`, "ok");
    enable(qtyInput, true);
    enable(btnDownloadJpg, true);
    enable(btnDownloadPdf, true);
    renderSheetAll();
  }

  // --- Sheet generation ---
  function gridForQty(qty) {
    // Cutting-friendly layout:
    // - Up to 5 photos per row (requested)
    // - Then wrap to next row
    const cols = Math.max(1, Math.min(SHEET_LAYOUT.maxCols, qty));
    const rows = Math.max(1, Math.ceil(qty / cols));
    return { cols, rows };
  }

  /**
   * @param {HTMLCanvasElement} targetCanvas
   * @param {number} targetW
   * @param {number} targetH
   * @param {number} qty
   * @param {{ w: number; h: number }} [photoMm] Print size in mm (default: PHOTO_MM)
   */
  function renderSheet(targetCanvas, targetW, targetH, qty, photoMm) {
    const pm = photoMm || PHOTO_MM;
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

    // Photo size on sheet in px (at SHEET_DPI scale)
    const photoSheetPxW = pxFromMm(pm.w, SHEET_DPI);
    const photoSheetPxH = pxFromMm(pm.h, SHEET_DPI);
    const photoW = photoSheetPxW * scale;
    const photoH = photoSheetPxH * scale;
    const margin = SHEET_LAYOUT.marginMm * (SHEET_DPI / MM_PER_INCH) * scale;
    const { cols, rows } = gridForQty(qty);
    let gap = SHEET_LAYOUT.gapMm * (SHEET_DPI / MM_PER_INCH) * scale;

    let gridW = cols * photoW + (cols - 1) * gap;
    let gridH = rows * photoH + (rows - 1) * gap;
    const maxW = targetW - margin * 2;
    const maxH = targetH - margin * 2;
    if (gridW > maxW && cols > 1) {
      gap = Math.max(1 * scale, (maxW - cols * photoW) / (cols - 1));
      gridW = cols * photoW + (cols - 1) * gap;
    }
    if (gridH > maxH && rows > 1) {
      gap = Math.max(1 * scale, Math.min(gap, (maxH - rows * photoH) / (rows - 1)));
      gridH = rows * photoH + (rows - 1) * gap;
    }

    const startX = margin;
    const startY = margin;
    const stroke = Math.max(1, Math.round(1.2 * scale));
    const srcW = photoCanvas.width;
    const srcH = photoCanvas.height;

    ctx.save();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= qty) break;
        const x = startX + c * (photoW + gap);
        const y = startY + r * (photoH + gap);
        // Draw photo to fill cell (cover): scale to cover, center crop
        const cellAr = photoW / photoH;
        const srcAr = srcW / srcH;
        let drawW = photoW;
        let drawH = photoH;
        let drawX = x;
        let drawY = y;
        if (srcAr > cellAr) {
          drawW = photoW;
          drawH = photoW / srcAr;
          drawY = y + (photoH - drawH) / 2;
        } else if (srcAr < cellAr) {
          drawH = photoH;
          drawW = photoH * srcAr;
          drawX = x + (photoW - drawW) / 2;
        }
        ctx.drawImage(photoCanvas, 0, 0, srcW, srcH, drawX, drawY, drawW, drawH);
        ctx.lineWidth = stroke;
        ctx.strokeStyle = "rgba(0,0,0,.18)";
        ctx.strokeRect(x, y, photoW, photoH);
      }
    }
    ctx.restore();
  }

  function renderSheetAll() {
    const qty = getQtyForRender();
    if (qty == null) return;
    const effective = getEffectivePrintSize();
    const isDefault = effective.w === DEFAULT_PHOTO_MM.w && effective.h === DEFAULT_PHOTO_MM.h;
    renderSheet(sheetCanvasFull, SHEET_PX.w, SHEET_PX.h, qty, effective);
    const pW = sheetCanvasPreview.width;
    const pH = sheetCanvasPreview.height;
    renderSheet(sheetCanvasPreview, pW, pH, qty, effective);
    const sizeLabel = isDefault ? "35×45 mm" : `Custom ${effective.w}×${effective.h} mm`;
    sheetMeta.textContent = `A4 ${A4_MM.w}×${A4_MM.h}mm • Photo ${sizeLabel} • ${SHEET_PX.w}×${SHEET_PX.h}px @ ${SHEET_DPI}DPI • Qty ${qty}`;
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
    const qty = normalizeQtyInInput();
    const name = `passport_sheet_${nowStamp()}_x${qty}.jpg`;
    const dataUrl = sheetCanvasFull.toDataURL("image/jpeg", 0.95);
    downloadDataUrl(dataUrl, name);
  }

  function exportPdf() {
    const qty = normalizeQtyInInput();
    const name = `passport_sheet_${nowStamp()}_x${qty}.pdf`;
    const dataUrl = sheetCanvasFull.toDataURL("image/jpeg", 0.95);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(dataUrl, "JPEG", 0, 0, A4_MM.w, A4_MM.h, undefined, "FAST");
    pdf.save(name);
  }

  // --- Wire up events ---
  async function boot() {
    // Restore saved settings (API key + background color + print size)
    try {
      const savedKey = localStorage.getItem(STORAGE.removebgKey);
      if (savedKey && removebgKey) removebgKey.value = savedKey;

      const savedBgColor = localStorage.getItem(STORAGE.bgColor);
      if (savedBgColor) {
        const radio = document.querySelector(`input[name="bgColor"][value="${savedBgColor}"]`);
        if (radio) radio.checked = true;
      }

      loadCustomSizes();
      const savedMode = localStorage.getItem(STORAGE.printSizeMode);
      if (savedMode === "custom") {
        const radio = document.querySelector('input[name="printSizeMode"][value="custom"]');
        if (radio) radio.checked = true;
        const savedId = localStorage.getItem(STORAGE.printSizeCustomId);
        if (savedId && customSizesList.some((s) => s.id === savedId)) selectedCustomSizeId = savedId;
      }
    } catch {
      // ignore
    }
    refreshCustomSizeSelect();
    if (selectedCustomSizeId && customSizeSelect) customSizeSelect.value = selectedCustomSizeId;
    updateCustomSizePanelVisibility();
    updateQtyMaxFromPrintSize();
    updateApplyBgUi();

    setStatus("Ready", "info");
    photoCanvas.width = PHOTO_PX.w;
    photoCanvas.height = PHOTO_PX.h;

    const pctx = photoCanvas.getContext("2d");
    pctx.fillStyle = "#ffffff";
    pctx.fillRect(0, 0, PHOTO_PX.w, PHOTO_PX.h);

    const sctx = sheetCanvasPreview.getContext("2d");
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, sheetCanvasPreview.width, sheetCanvasPreview.height);

    if (qtyInput) {
      qtyInput.min = "1";
      if (!String(qtyInput.value || "").trim()) qtyInput.value = String(lastGoodQty);
    }

    // Restore last captured photo (if any) so Apply Background is clickable after refresh.
    await restoreRawPhotoFromSession();

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
      // Clear current output (works for camera + upload)
      enable(btnDownloadJpg, false);
      enable(btnDownloadPdf, false);
      enable(qtyInput, false);
      photoMeta.textContent = "—";
      sheetMeta.textContent = "—";
      hasRawPhoto = false;
      updateApplyBgUi();
      try {
        sessionStorage.removeItem(STORAGE.rawPhoto);
      } catch {
        // ignore
      }
      if (stream) {
        setValidation("Detecting face…", "info");
        if (!detectionTimer) detectionTimer = setInterval(() => void validateLive(), 240);
      } else {
        setValidation("Cleared. Upload an image or start camera.", "info");
      }
    });

    if (btnApplyBg) {
      btnApplyBg.addEventListener("click", () => {
        void applyBackgroundToCurrent();
      });
    }

    if (btnUpload && fileInput) {
      btnUpload.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        setStatus("Processing…", "info");
        setValidation("Loading image…", "info");

        // Stop camera to avoid confusion
        stopCamera();
        enable(btnRetake, true);

        try {
          let bmp;
          try {
            bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
          } catch {
            bmp = await createImageBitmap(file);
          }

          // Scale to a safe working size (keep quality, avoid memory spikes)
          const maxSide = 2200;
          const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
          const w = Math.max(1, Math.round(bmp.width * scale));
          const h = Math.max(1, Math.round(bmp.height * scale));

          workCanvas.width = w;
          workCanvas.height = h;
          const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(bmp, 0, 0, w, h);

          await initModelsOnce();
          await processSourceCanvas(workCanvas);
        } catch (e) {
          const msg = String(e?.message || e || "Upload failed");
          setValidation(`Upload failed: ${msg}`, "bad");
          setStatus("Blocked", "bad");
        } finally {
          // allow uploading same file again
          fileInput.value = "";
        }
      });
    }

    document.querySelectorAll('input[name="bgColor"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        try {
          localStorage.setItem(STORAGE.bgColor, getBackgroundColorHex());
        } catch {
          // ignore
        }
        if (hasRawPhoto) void applyBackgroundToCurrent();
      });
    });
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

    document.querySelectorAll('input[name="printSizeMode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        updateCustomSizePanelVisibility();
        try {
          localStorage.setItem(STORAGE.printSizeMode, document.querySelector('input[name="printSizeMode"]:checked')?.getAttribute("value") || "default");
        } catch {}
        updateQtyMaxFromPrintSize();
        renderSheetAll();
      });
    });

    if (customSizeSelect) {
      customSizeSelect.addEventListener("change", () => {
        const v = customSizeSelect.value;
        selectedCustomSizeId = v || null;
        inlineCustomMm = null;
        try {
          localStorage.setItem(STORAGE.printSizeCustomId, v || "");
        } catch {}
        updateQtyMaxFromPrintSize();
        renderSheetAll();
      });
    }

    function applyInlineCustomFromInputs() {
      const w = Number(customW?.value);
      const h = Number(customH?.value);
      if (Number.isFinite(w) && Number.isFinite(h) && w >= 10 && w <= 80 && h >= 10 && h <= 80) {
        inlineCustomMm = { w: Math.round(w), h: Math.round(h) };
      } else {
        inlineCustomMm = null;
      }
    }
    if (customW) customW.addEventListener("input", () => { applyInlineCustomFromInputs(); updateQtyMaxFromPrintSize(); renderSheetAll(); });
    if (customH) customH.addEventListener("input", () => { applyInlineCustomFromInputs(); updateQtyMaxFromPrintSize(); renderSheetAll(); });

    function setCustomSizeFeedback(text, kind) {
      if (!customSizeSaveFeedback) return;
      customSizeSaveFeedback.textContent = text || "";
      customSizeSaveFeedback.className = "customSizeSaveFeedback" + (kind === "ok" ? " saved" : kind === "err" ? " err" : "");
    }

    function onSaveCustomSizeClick(e) {
      e.preventDefault();
      setCustomSizeFeedback("", "");
        const rawW = (customW && customW.value !== undefined) ? customW.value : "";
        const rawH = (customH && customH.value !== undefined) ? customH.value : "";
        const w = rawW === "" ? NaN : Number(rawW);
        const h = rawH === "" ? NaN : Number(rawH);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 10 || w > 80 || h < 10 || h > 80) {
          setCustomSizeFeedback("أدخل الطول والعرض بين 10 و 80 mm", "err");
          setValidation("Enter width and height between 10 and 80 mm.", "warn");
          return;
        }
        const rw = Math.round(w);
        const rh = Math.round(h);
        const name = (customName?.value || "").trim().slice(0, 40) || `${rw}×${rh}`;
        const id = "cs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        const entry = { id, name, w: rw, h: rh };
        customSizesList.push(entry);
        const persisted = saveCustomSizes();
        refreshCustomSizeSelect(id);
        selectedCustomSizeId = id;
        inlineCustomMm = null;
        try {
          localStorage.setItem(STORAGE.printSizeCustomId, id);
        } catch {}
        updateQtyMaxFromPrintSize();
        renderSheetAll();
        setCustomSizeFeedback(persisted ? "تم الحفظ ✓ " + name + " (" + rw + "×" + rh + ")" : "مستخدم لهذه الجلسة فقط", persisted ? "ok" : "err");
        if (persisted) {
          setValidation(`Saved “${name}” (${rw}×${rh} mm). You can choose it from the list anytime.`, "ok");
        } else {
          setValidation(`“${name}” (${rw}×${rh} mm) is in use for this session. Enable storage to keep after refresh.`, "warn");
        }
    }

    const saveBtn = document.getElementById("btnSaveCustomSize");
    if (saveBtn) {
      saveBtn.addEventListener("click", onSaveCustomSizeClick);
    }

    if (qtyInput) {
      qtyInput.addEventListener("input", () => renderSheetAll());
      qtyInput.addEventListener("change", () => {
        normalizeQtyInInput();
        renderSheetAll();
      });
      qtyInput.addEventListener("blur", () => {
        normalizeQtyInInput();
        renderSheetAll();
      });
    }
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

