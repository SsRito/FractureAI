/**
 * FractureAI — main.js
 *
 * Handles:
 *  1. File drag-and-drop / file picker
 *  2. State transitions (upload → ready → analyzing → result)
 *  3. POST to Flask backend /api/analyze
 *  4. Displaying result data returned by the model
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_BASE = window.location.origin;
const ANALYZE_ENDPOINT = `${API_BASE}/api/analyze`;

// ─── STATE ─────────────────────────────────────────────────────────────────
let selectedFile = null;
let analysisStartTime = null;

// ─── DOM REFERENCES ────────────────────────────────────────────────────────
const stateUpload    = document.getElementById("state-upload");
const stateReady     = document.getElementById("state-ready");
const stateAnalyzing = document.getElementById("state-analyzing");
const stateResult    = document.getElementById("state-result");

const fileInput      = document.getElementById("fileInput");
const selectBtn      = document.getElementById("selectBtn");
const dropZone       = document.getElementById("dropZone");
const startBtn       = document.getElementById("startBtn");

const previewImg     = document.getElementById("previewImg");
const uploadFilename = document.getElementById("uploadFilename");
const analyzingImg   = document.getElementById("analyzingImg");

const circleArc      = document.getElementById("circleArc");
const pctDisplay     = document.getElementById("pctDisplay");
const stepItems      = document.querySelectorAll(".step-item");

const errorBox       = document.getElementById("errorBox");
const errorMsg       = document.getElementById("errorMsg");

const resultOriginal  = document.getElementById("resultOriginal");
const resultHeatmap   = document.getElementById("resultHeatmap");
const resultLightboard = document.getElementById("resultLightboard");
const scoreValue      = document.getElementById("scoreValue");
const scoreBarFill    = document.getElementById("scoreBarFill");
const classificationBadge = document.getElementById("classificationBadge");
const processTime     = document.getElementById("processTime");
const downloadBtn     = document.getElementById("downloadBtn");

// Circle geometry
const CIRCUMFERENCE = 2 * Math.PI * 68; // r=68 → ≈ 427.26

// ─── FILE SELECTION ────────────────────────────────────────────────────────
selectBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

// Drag & drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function createGrayscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Could not read the uploaded image."));
    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error("Could not process the uploaded image."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;

        for (let i = 0; i < pixels.length; i += 4) {
          const gray = Math.round(
            pixels[i] * 0.299 +
            pixels[i + 1] * 0.587 +
            pixels[i + 2] * 0.114
          );
          pixels[i] = gray;
          pixels[i + 1] = gray;
          pixels[i + 2] = gray;
        }

        ctx.putImageData(imageData, 0, 0);

        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, 0.92);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Could not create a grayscale version of the image."));
            return;
          }

          const grayscaleFile = new File([blob], file.name, {
            type: mimeType,
            lastModified: Date.now(),
          });

          resolve({ file: grayscaleFile, dataUrl });
        }, mimeType, 0.92);
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Called when a file is chosen. Shows the "ready" state.
 * @param {File} file
 */
async function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    showError("Please upload a valid image file (PNG or JPEG).");
    return;
  }

  try {
    const grayscaleImage = await createGrayscaleImage(file);
    const lightboardDataUrl = await generateLightboard(grayscaleImage.dataUrl);

    selectedFile = grayscaleImage.file;

    previewImg.src = grayscaleImage.dataUrl;
    analyzingImg.src = grayscaleImage.dataUrl;
    resultOriginal.src = grayscaleImage.dataUrl;
    resultLightboard.src = lightboardDataUrl;

    uploadFilename.textContent = file.name;
    showState("ready");
  } catch (err) {
    showError(err.message || "Could not process the uploaded image.");
  }
}

// ─── START ANALYSIS ────────────────────────────────────────────────────────
startBtn.addEventListener("click", runAnalysis);

async function runAnalysis() {
  if (!selectedFile) return;

  showState("analyzing");
  resetSteps();
  analysisStartTime = performance.now();

  // Run the animated checklist in parallel with the actual API call
  const animationDone = animateSteps();
  const apiFetch = fetchAnalysis(selectedFile);

  try {
    const [_, result] = await Promise.all([animationDone, apiFetch]);
    displayResult(result);
    showState("result");
  } catch (err) {
    showError(err.message || "Analysis failed. Check your server connection.");
    showState("analyzing"); // Stay on analyzing page but show error
  }
}

// ─── API CALL ──────────────────────────────────────────────────────────────
/**
 * Sends the image to the Flask backend and returns parsed result.
 *
 * Expected JSON response from Flask:
 * {
 *   "prediction":  "Fractured" | "Non-Fractured",
 *   "confidence":  85.6,           // float 0–100
 *   "process_time": 2.3,           // seconds
 *   "heatmap_base64": "<base64>"   // optional: base64-encoded heatmap PNG
 * }
 *
 * @param {File} file
 * @returns {Promise<Object>}
 */
async function fetchAnalysis(file) {
  const formData = new FormData();
  formData.append("image", file);  // "image" must match Flask's request.files["image"]

  const response = await fetch(ANALYZE_ENDPOINT, {
    method: "POST",
    body: formData,
    // Do NOT set Content-Type header — browser sets it with boundary automatically
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server error: ${response.status}`);
  }

  return await response.json();
}

// ─── ANIMATED CHECKLIST ────────────────────────────────────────────────────
const STEP_DELAYS = [200, 600, 1100, 1700, 2300]; // ms after analysis starts

/**
 * Animates the 5-step checklist and circle progress.
 * Returns a Promise that resolves when all steps are done.
 */
function animateSteps() {
  return new Promise((resolve) => {
    let completed = 0;

    STEP_DELAYS.forEach((delay, i) => {
      setTimeout(() => {
        stepItems[i].classList.add("done");

        const pct = Math.round(((i + 1) / stepItems.length) * 100);
        setCircleProgress(pct);
        pctDisplay.textContent = `${pct}%`;

        completed++;
        if (completed === stepItems.length) resolve();
      }, delay);
    });
  });
}

function setCircleProgress(pct) {
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  circleArc.style.strokeDashoffset = offset;
}

function resetSteps() {
  stepItems.forEach((s) => s.classList.remove("done"));
  circleArc.style.strokeDashoffset = CIRCUMFERENCE;
  pctDisplay.textContent = "0%";
  errorBox.classList.add("hidden");
}

// ─── DISPLAY RESULT ────────────────────────────────────────────────────────
/**
 * Populates the result section with API response data.
 * @param {Object} data  Parsed JSON from Flask
 */
async function displayResult(data) {
  const confidence = parseFloat(data.confidence).toFixed(1);
  const prediction = data.prediction;          // "Fractured" or "Non-Fractured"
  const elapsed    = data.process_time != null
    ? parseFloat(data.process_time).toFixed(1) + "s"
    : ((performance.now() - analysisStartTime) / 1000).toFixed(1) + "s";

  // Score
  scoreValue.textContent = `${confidence}%`;
  setTimeout(() => {
    scoreBarFill.style.width = `${confidence}%`;
  }, 200);

  // Classification badge
  const isFractured = prediction === "Fractured";
  classificationBadge.textContent = prediction;
  classificationBadge.className = "classification-badge " +
    (isFractured ? "fractured" : "non-fractured");

  // Time
  processTime.textContent = elapsed;

  // Heatmap panel (if backend returns one)
  if (data.heatmap_base64) {
    resultHeatmap.src = `data:image/png;base64,${data.heatmap_base64}`;
  } else {
    // Fallback: show original in heatmap panel if no heatmap returned
    resultHeatmap.src = resultOriginal.src;
  }

  // Download button
  downloadBtn.onclick = async () => {
    await downloadReport(data);
  };

  // Save to history if user is logged in
  const user = getCurrentUser();
  console.log("Current user:", user);
  if (user) {
    try {
      console.log("Saving history for user:", user.email);
      
      // Prepare the three different images for history
      const originalForHistory = resultOriginal.src;

      const heatmapForHistory = data.heatmap_base64
        ? `data:image/png;base64,${data.heatmap_base64}`
        : resultOriginal.src;

      const lightboardForHistory = await generateLightboard(resultOriginal.src);

      const historyEntry = {
        date: new Date().toLocaleString(),
        prediction,
        confidence,
        processTime: elapsed,
        originalSrc: originalForHistory,
        heatmapSrc: heatmapForHistory,
        lightboardSrc: lightboardForHistory,
      };

      await addHistoryEntry(user.email, historyEntry);
            
            console.log("History saved successfully");
          } catch (err) {
            console.error("Failed to save history entry:", err);
          }
        } else {
          console.log("No user logged in - history not saved");
        }
      }

// ─── RESET ─────────────────────────────────────────────────────────────────
function resetToUpload() {
  selectedFile = null;
  fileInput.value = "";
  previewImg.src = "";
  analyzingImg.src = "";
  resultOriginal.src = "";
  resultHeatmap.src = "";
  resultLightboard.src = "";
  scoreBarFill.style.width = "0%";
  classificationBadge.textContent = "—";
  classificationBadge.className = "classification-badge";
  resetSteps();
  showState("upload");
}

// ─── ERROR ─────────────────────────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorBox.classList.remove("hidden");
}

// ─── STATE MANAGER ─────────────────────────────────────────────────────────
/**
 * Shows one state section and hides the others.
 * @param {"upload"|"ready"|"analyzing"|"result"} name
 */
function showState(name) {
  stateUpload.classList.add("hidden");
  stateReady.classList.add("hidden");
  stateAnalyzing.classList.add("hidden");
  stateResult.classList.add("hidden");

  const map = {
    upload:    stateUpload,
    ready:     stateReady,
    analyzing: stateAnalyzing,
    result:    stateResult,
  };

  if (map[name]) map[name].classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── DOWNLOAD ──────────────────────────────────────────────────────────────
async function downloadReport(data) {
  const printWin = window.open("", "_blank", "width=900,height=700");
  if (!printWin) {
    showError("Download was blocked by the browser. Please allow pop-ups and try again.");
    return;
  }

  printWin.document.write(`<!DOCTYPE html><html><head><title>Preparing report...</title></head><body style="font-family: Arial, sans-serif; padding: 24px;">Preparing report...</body></html>`);
  printWin.document.close();

  const confidence  = parseFloat(data.confidence).toFixed(1);
  const prediction  = data.prediction;
  const elapsed     = parseFloat(data.process_time ?? 0).toFixed(1);
  const date        = new Date().toLocaleString();
  const isFractured = prediction === "Fractured";

  const originalSrc   = resultOriginal.src;
  const heatmapSrc    = resultHeatmap.src;
  const lightboardSrc = await generateLightboard(resultOriginal.src);

  const badgeColor  = isFractured ? "#cc0000" : "#007a3d";
  const badgeBg     = isFractured ? "#fff0f0"  : "#f0fff5";
  const badgeBorder = isFractured ? "#ffaaaa"  : "#99eebb";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>FractureAI Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #fff; color: #1a1f2e; }
    .header { background: #0d1117; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
    .logo { color: #e8edf3; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; background: #00d4ff; border-radius: 50%; display: inline-block; }
    .date { color: #7b8a9a; font-size: 11px; }
    .body { padding: 28px 32px; }
    .section-label { font-size: 10px; letter-spacing: 1.2px; color: #9aa3b0; text-transform: uppercase; margin-bottom: 12px; }
    .cards { display: flex; gap: 12px; margin-bottom: 28px; }
    .card { flex: 1; background: #f8f9fb; border: 1px solid #e4e8ef; border-radius: 8px; padding: 14px 16px; }
    .card-label { font-size: 10px; letter-spacing: 1px; color: #9aa3b0; text-transform: uppercase; margin-bottom: 6px; }
    .card-value { font-size: 24px; font-weight: 700; color: #1a1f2e; }
    .card-value.blue { color: #0077aa; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 6px; font-size: 14px; font-weight: 700; background: ${badgeBg}; border: 1px solid ${badgeBorder}; color: ${badgeColor}; }
    .bar-wrap { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
    .bar-val { font-size: 28px; font-weight: 700; min-width: 64px; }
    .bar-bg { flex: 1; height: 10px; background: #e4e8ef; border-radius: 5px; overflow: hidden; }
    .bar-fill { height: 100%; width: ${confidence}%; background: #00c853; border-radius: 5px; }
    .images { display: flex; gap: 12px; margin-bottom: 28px; }
    .img-panel { flex: 1; text-align: center; }
    .img-box { border: 1px solid #e4e8ef; border-radius: 8px; overflow: hidden; background: #f8f9fb; height: 180px; display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
    .img-box.lightboard { background: #fff; border-color: #ccc; }
    .img-box img { max-width: 100%; max-height: 180px; object-fit: contain; display: block; }
    .img-label { font-size: 11px; color: #7b8a9a; }
    .img-sublabel { font-size: 10px; color: #b0b8c4; }
    .disclaimer { background: #fff8f0; border: 1px solid #ffd580; border-radius: 8px; padding: 16px 18px; }
    .disclaimer-title { font-size: 10px; letter-spacing: 1px; color: #cc7a00; text-transform: uppercase; margin-bottom: 6px; }
    .disclaimer-text { font-size: 12px; color: #8a6030; line-height: 1.6; }
    .footer { background: #f8f9fb; border-top: 1px solid #e4e8ef; padding: 12px 32px; display: flex; justify-content: space-between; margin-top: 28px; }
    .footer span { font-size: 11px; color: #9aa3b0; }
    @media print {
      @page { margin: 10mm; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo"><span class="dot"></span> FractureAI</div>
    <div class="date">Generated: ${date}</div>
  </div>

  <div class="body">
    <div class="section-label">Analysis Summary</div>
    <div class="cards">
      <div class="card">
        <div class="card-label">Classification</div>
        <div class="badge">${prediction}</div>
      </div>
      <div class="card">
        <div class="card-label">Confidence Score</div>
        <div class="card-value">${confidence}%</div>
      </div>
      <div class="card">
        <div class="card-label">Process Time</div>
        <div class="card-value blue">${elapsed}s</div>
      </div>
      <div class="card">
        <div class="card-label">Model</div>
        <div style="font-size:13px;font-weight:600;margin-top:4px;">ResNet101</div>
      </div>
    </div>

    <div class="section-label">Confidence</div>
    <div class="bar-wrap">
      <div class="bar-val">${confidence}%</div>
      <div class="bar-bg"><div class="bar-fill"></div></div>
    </div>

    <div class="section-label">Image Views</div>
    <div class="images">
      <div class="img-panel">
        <div class="img-box"><img src="${originalSrc}" /></div>
        <div class="img-label">Original</div>
      </div>
      <div class="img-panel">
        <div class="img-box"><img src="${heatmapSrc}" /></div>
        <div class="img-label">Heatmap</div>
      </div>
      <div class="img-panel">
        <div class="img-box lightboard"><img src="${lightboardSrc}" /></div>
        <div class="img-label">Light Board</div>
        <div class="img-sublabel">Negatoscope</div>
      </div>
    </div>

    <div class="disclaimer">
      <div class="disclaimer-title">Medical Disclaimer</div>
      <div class="disclaimer-text">
        This AI analysis is intended for research and educational purposes only.
        It does not constitute a medical diagnosis. Always consult a licensed
        radiologist or physician for clinical interpretation and treatment decisions.
      </div>
    </div>
  </div>

  <div class="footer">
    <span>Model: ResNet101 · TensorFlow 2.6.0</span>
    <span>FractureAI — Automated Fracture Classification</span>
  </div>

  <script>
    // Auto-trigger print dialog as soon as images are loaded
    window.onload = function() {
      setTimeout(function() { window.print(); }, 500);
    };
  </script>
</body>
</html>`;

  printWin.document.write(html);
  printWin.document.close();
}

/**
 * Draws the original image onto a canvas with invert filter
 * and returns a data URL — used to embed the light board view in the report.
 * @param {string} src  data URL of the original image
 * @returns {Promise<string>}    data URL of the inverted image
 */
function generateLightboard(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = dataUrl;

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = img.width;
      canvas.height = img.height;

      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
  });
}


/**
 * Wraps a promise with a timeout.
 * @param {Promise} promise
 * @param {number} timeoutMs
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
  ]);
}

/**
 * Compresses an image data URL to a smaller size for storage.
 * @param {string} src  data URL of the image
 * @returns {Promise<string>} compressed data URL
 */
function compressImageForStorage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    const timeoutId = setTimeout(() => {
      console.warn("Image compression timeout");
      resolve(src); // Timeout fallback
    }, 3000);

    img.onload = () => {
      clearTimeout(timeoutId);
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Aggressively compress: reduce to 300x300 max
        let { width, height } = img;
        const maxSize = 300;
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        // Use JPEG with 60% quality for smaller file size
        const compressed = canvas.toDataURL("image/jpeg", 0.6);
        console.log("Compressed image size:", compressed.length, "bytes");
        resolve(compressed);
      } catch (e) {
        console.error("Compression error:", e);
        resolve(src);
      }
    };
    img.onerror = () => {
      clearTimeout(timeoutId);
      console.warn("Image load error");
      resolve(src);
    };
    img.src = src;
  });
}

/**
 * Resizes an image data URL to the specified dimensions.
 * @param {string} src  data URL of the image
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {Promise<string>} resized data URL
 */
function resizeImage(src, maxWidth, maxHeight) {
  return new Promise((resolve) => {
    const img = new Image();
    const timeoutId = setTimeout(() => {
      resolve(src); // Timeout fallback
    }, 5000);

    img.onload = () => {
      clearTimeout(timeoutId);
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;
        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png")); // Use PNG for lossless quality
      } catch (e) {
        resolve(src); // Fallback on error
      }
    };
    img.onerror = () => {
      clearTimeout(timeoutId);
      resolve(src); // Fallback to original if resize fails
    };
    img.src = src;
  });
}

// ─── INIT ──────────────────────────────────────────────────────────────────
// Show the initial upload state on page load
showState("upload");
