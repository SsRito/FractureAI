// history.js
// Builds the History page UI and uses the same report-print logic as main.js's Download button.

(function () {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  function normalizeImageSrc(value, fallback) {
    const src = (value === null || value === undefined) ? "" : String(value).trim();
    if (!src || src.indexOf("${") !== -1) return fallback || "";
    return src;
  }

  function parseConfidence(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  function parseProcessSeconds(value) {
    // Accepts "2.6s", 2.6, "2.6", etc.
    const raw = (value === null || value === undefined) ? "" : String(value);
    const m = raw.match(/([0-9]+(?:\.[0-9]+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function openPrintableReportFromEntry(entry) {
    const confidence = parseConfidence(entry.confidence).toFixed(1);
    const prediction = (entry.prediction === null || entry.prediction === undefined) ? "Unknown" : String(entry.prediction);
    const elapsed = parseProcessSeconds(entry.processTime || entry.processingTime || entry.process_time).toFixed(1);
    const date = (entry.date === null || entry.date === undefined) ? new Date().toLocaleString() : String(entry.date);
    const isFractured = prediction === "Fractured";

    const originalSrc = normalizeImageSrc(entry.originalSrc, "");
    const heatmapSrc = normalizeImageSrc(entry.heatmapSrc, originalSrc);
    const lightboardSrc = normalizeImageSrc(entry.lightboardSrc, originalSrc);

    const badgeColor = isFractured ? "#cc0000" : "#007a3d";
    const badgeBg = isFractured ? "#fff0f0" : "#f0fff5";
    const badgeBorder = isFractured ? "#ffaaaa" : "#99eebb";

    // Note: This matches the approach used in main.js: open a new window, write the HTML, then auto-print.
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
    window.onload = function() {
      setTimeout(function() { window.print(); }, 500);
    };
  </script>
</body>
</html>`;

    const printWin = window.open("", "_blank", "width=900,height=700");
    if (!printWin) return;
    printWin.document.write(html);
    printWin.document.close();
  }

  async function deleteEntry(id) {
    await deleteHistoryEntry(id);
    renderHistory();
  }

  async function downloadEntry(id) {
    const history = await getHistory(user.email);
    const entry = history.find((e) => e.id === id);
    if (!entry) return;
    openPrintableReportFromEntry(entry);
  }

  async function clearHistoryUI() {
    await clearAllHistory(user.email);
    renderHistory();
  }

  async function renderHistory() {
    const history = await getHistory(user.email);
    const container = document.getElementById("historyContent");
    const countEl = document.getElementById("historyCount");
    const clearBtn = document.getElementById("clearBtn");

    countEl.textContent = String(history.length) + " entries";
    clearBtn.style.display = history.length ? "block" : "none";

    if (!history.length) {
      container.innerHTML = "<p>No history</p>";
      return;
    }

    container.innerHTML = "";

    history.forEach((entry) => {
      const originalSrc = normalizeImageSrc(entry.originalSrc, "");
      const heatmapSrc = normalizeImageSrc(entry.heatmapSrc, originalSrc);
      const lightboardSrc = normalizeImageSrc(entry.lightboardSrc, originalSrc);

      const wrap = document.createElement("div");
      wrap.className = "history-entry";

      const header = document.createElement("div");
      header.className = "entry-header";

      const left = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = (entry.prediction === null || entry.prediction === undefined) ? "" : String(entry.prediction);
      const conf = document.createElement("div");
      conf.textContent = String((entry.confidence === null || entry.confidence === undefined) ? "" : entry.confidence) + "%";
      const date = document.createElement("div");
      date.textContent = (entry.date === null || entry.date === undefined) ? "" : String(entry.date);
      left.appendChild(strong);
      left.appendChild(conf);
      left.appendChild(date);

      const right = document.createElement("div");

      const dl = document.createElement("button");
      dl.className = "clear-btn download-btn";
      dl.type = "button";
      dl.textContent = "Download";
      dl.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadEntry(entry.id);
      });

      const del = document.createElement("button");
      del.className = "clear-btn delete-btn";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteEntry(entry.id);
      });

      right.appendChild(dl);
      right.appendChild(del);

      header.appendChild(left);
      header.appendChild(right);

      const body = document.createElement("div");
      body.className = "entry-body";

      const img1 = document.createElement("img");
      img1.width = 120;
      img1.src = originalSrc;
      const img2 = document.createElement("img");
      img2.width = 120;
      img2.src = heatmapSrc;
      const img3 = document.createElement("img");
      img3.width = 120;
      img3.src = lightboardSrc;

      body.appendChild(img1);
      body.appendChild(img2);
      body.appendChild(img3);

      wrap.appendChild(header);
      wrap.appendChild(body);
      container.appendChild(wrap);
    });
  }

  document.getElementById("clearBtn").onclick = clearHistoryUI;
  renderHistory();
})();

