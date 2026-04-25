async function generateFractureReportPdf({
  confidence,
  prediction,
  elapsed,
  date,
  originalSrc,
  heatmapSrc,
  lightboardSrc,
  filenamePrefix = "fractureai-report",
}) {
  const jsPdfLib = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfLib) {
    throw new Error("PDF generator failed to load.");
  }

  const doc = new jsPdfLib("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  const safeConfidence = Number.parseFloat(confidence || 0).toFixed(1);
  const safeElapsed = String(elapsed || "0.0s");
  const safePrediction = prediction || "Unknown";
  const safeDate = date || new Date().toLocaleString();

  const badgeColor = safePrediction === "Fractured" ? [204, 0, 0] : [0, 122, 61];
  const badgeBg = safePrediction === "Fractured" ? [255, 240, 240] : [240, 255, 245];

  doc.setFillColor(13, 17, 23);
  doc.rect(0, 0, pageWidth, 24, "F");
  doc.setTextColor(232, 237, 243);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("FractureAI", margin, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Generated: ${safeDate}`, pageWidth - margin, 15, { align: "right" });

  let y = 34;
  doc.setTextColor(26, 31, 46);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("ANALYSIS SUMMARY", margin, y);
  y += 6;

  const cardGap = 4;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  const cardHeight = 24;
  const cards = [
    { label: "Classification", value: safePrediction, badge: true },
    { label: "Confidence Score", value: `${safeConfidence}%` },
    { label: "Process Time", value: safeElapsed },
    { label: "Model", value: "ResNet101" },
  ];

  cards.forEach((card, index) => {
    const x = margin + index * (cardWidth + cardGap);
    doc.setFillColor(248, 249, 251);
    doc.setDrawColor(228, 232, 239);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, "FD");
    doc.setTextColor(154, 163, 176);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(card.label.toUpperCase(), x + 3, y + 6);

    if (card.badge) {
      doc.setFillColor(...badgeBg);
      doc.setDrawColor(...badgeColor);
      doc.roundedRect(x + 3, y + 10, cardWidth - 6, 8, 2, 2, "FD");
      doc.setTextColor(...badgeColor);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(card.value, x + cardWidth / 2, y + 15.5, { align: "center" });
    } else {
      doc.setTextColor(26, 31, 46);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(card.value, x + 3, y + 15);
    }
  });

  y += cardHeight + 12;
  doc.setTextColor(26, 31, 46);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("CONFIDENCE", margin, y);
  y += 8;
  doc.setFontSize(18);
  doc.text(`${safeConfidence}%`, margin, y);
  doc.setFillColor(228, 232, 239);
  doc.roundedRect(margin + 32, y - 4.5, contentWidth - 32, 5, 2, 2, "F");
  doc.setFillColor(0, 200, 83);
  doc.roundedRect(margin + 32, y - 4.5, (contentWidth - 32) * (Number.parseFloat(safeConfidence) / 100), 5, 2, 2, "F");

  y += 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("IMAGE VIEWS", margin, y);
  y += 6;

  const imageConfigs = [
    { label: "Original", src: originalSrc },
    { label: "Heatmap", src: heatmapSrc || originalSrc },
    { label: "Light Board", src: lightboardSrc || originalSrc },
  ];

  const panelGap = 4;
  const panelWidth = (contentWidth - panelGap * 2) / 3;
  const panelHeight = 58;

  for (let i = 0; i < imageConfigs.length; i += 1) {
    const panelX = margin + i * (panelWidth + panelGap);
    doc.setFillColor(248, 249, 251);
    doc.setDrawColor(228, 232, 239);
    doc.roundedRect(panelX, y, panelWidth, panelHeight, 2, 2, "FD");

    try {
      const imageData = await loadImageAsDataUrl(imageConfigs[i].src);
      addImageContain(doc, imageData, panelX + 2, y + 2, panelWidth - 4, panelHeight - 10);
    } catch (error) {
      doc.setTextColor(154, 163, 176);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Image unavailable", panelX + panelWidth / 2, y + panelHeight / 2, { align: "center" });
    }

    doc.setTextColor(123, 138, 154);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(imageConfigs[i].label, panelX + panelWidth / 2, y + panelHeight - 3, { align: "center" });
  }

  y += panelHeight + 12;
  const disclaimerHeight = 26;
  if (y + disclaimerHeight > pageHeight - 20) {
    doc.addPage();
    y = 20;
  }

  doc.setFillColor(255, 248, 240);
  doc.setDrawColor(255, 213, 128);
  doc.roundedRect(margin, y, contentWidth, disclaimerHeight, 2, 2, "FD");
  doc.setTextColor(204, 122, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("MEDICAL DISCLAIMER", margin + 4, y + 6);
  doc.setTextColor(138, 96, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const disclaimerText = doc.splitTextToSize(
    "This AI analysis is intended for research and educational purposes only. It does not constitute a medical diagnosis. Always consult a licensed radiologist or physician for clinical interpretation and treatment decisions.",
    contentWidth - 8
  );
  doc.text(disclaimerText, margin + 4, y + 12);

  doc.setDrawColor(228, 232, 239);
  doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
  doc.setTextColor(154, 163, 176);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Model: ResNet101 · TensorFlow 2.6.0", margin, pageHeight - 8);
  doc.text("FractureAI · Automated Fracture Classification", pageWidth - margin, pageHeight - 8, { align: "right" });

  const fileStamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  doc.save(`${filenamePrefix}-${fileStamp}.pdf`);
}

function loadImageAsDataUrl(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("Missing image source"));
      return;
    }

    if (src.startsWith("data:image/")) {
      resolve(src);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function addImageContain(doc, imageData, x, y, maxWidth, maxHeight) {
  const imageProps = doc.getImageProperties(imageData);
  const widthRatio = maxWidth / imageProps.width;
  const heightRatio = maxHeight / imageProps.height;
  const ratio = Math.min(widthRatio, heightRatio);
  const renderWidth = imageProps.width * ratio;
  const renderHeight = imageProps.height * ratio;
  const renderX = x + (maxWidth - renderWidth) / 2;
  const renderY = y + (maxHeight - renderHeight) / 2;
  doc.addImage(imageData, "PNG", renderX, renderY, renderWidth, renderHeight);
}
