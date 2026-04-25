document.addEventListener("click", async (event) => {
  const resultDownloadButton = event.target.closest("#downloadBtn");
  if (resultDownloadButton) {
    event.preventDefault();
    event.stopPropagation();

    try {
      const confidence = (document.getElementById("scoreValue")?.textContent || "0").replace("%", "").trim();
      const prediction = document.getElementById("classificationBadge")?.textContent?.trim() || "Unknown";
      const elapsed = document.getElementById("processTime")?.textContent?.trim() || "0.0s";
      const originalSrc = document.getElementById("resultOriginal")?.src || "";
      const heatmapSrc = document.getElementById("resultHeatmap")?.src || originalSrc;
      const lightboardSrc = document.getElementById("resultLightboard")?.src || originalSrc;

      await generateFractureReportPdf({
        confidence,
        prediction,
        elapsed,
        date: new Date().toLocaleString(),
        originalSrc,
        heatmapSrc,
        lightboardSrc,
        filenamePrefix: "fractureai-report",
      });
    } catch (error) {
      console.error("PDF download failed:", error);
      if (typeof showError === "function") {
        showError(error.message || "Could not generate PDF report.");
      }
    }

    return;
  }

  const historyDownloadButton = event.target.closest(".download-btn");
  if (historyDownloadButton) {
    event.preventDefault();
    event.stopPropagation();

    try {
      const entry = historyDownloadButton.closest(".history-entry");
      const prediction = entry?.querySelector("strong")?.textContent?.trim() || "Unknown";
      const confidenceText = entry?.querySelector("strong + div")?.textContent?.trim() || "0%";
      const date = entry?.querySelector("strong + div + div")?.textContent?.trim() || new Date().toLocaleString();
      const body = entry?.querySelector(".entry-body");
      const images = body ? Array.from(body.querySelectorAll("img")) : [];

      await generateFractureReportPdf({
        confidence: confidenceText.replace("%", "").trim(),
        prediction,
        elapsed: "Saved result",
        date,
        originalSrc: images[0]?.src || "",
        heatmapSrc: images[1]?.src || images[0]?.src || "",
        lightboardSrc: images[2]?.src || images[0]?.src || "",
        filenamePrefix: "fractureai-history-report",
      });
    } catch (error) {
      console.error("History PDF download failed:", error);
      alert("Could not generate PDF report.");
    }
  }
}, true);
