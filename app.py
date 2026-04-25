"""
FractureAI — app.py  (ResNet101 — Optimized)

Optimizations applied:
  1. grad_model built ONCE at startup — not rebuilt per request
  2. @tf.function on the Grad-CAM forward pass — compiles to static graph
  3. Single forward pass — inference + Grad-CAM in one call (was 2)
  4. Warm-up runs _run_gradcam (not just model) — full graph compiled at startup
  5. INTER_LINEAR instead of INTER_CUBIC — free speed, imperceptible difference
  6. debug=False — avoids Flask reloader overhead

Install:
    pip install flask flask-cors tensorflow pillow numpy opencv-python h5py

Run:
    python app.py
"""

import io
import os
import base64
import time
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PIL import Image
import tensorflow as tf

# ── Config ────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent
RESNET_PATH = os.environ.get(
    "MODEL_PATH",
    str(BASE_DIR / "ResNet101" / "model2.h5")
)
CLASS_NAMES = ["Fractured", "Non Fractured"]
IMG_HEIGHT  = 224
IMG_WIDTH   = 224

# ── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
CORS(app)

# ── Load model ────────────────────────────────────────────────────────────────

print("\n" + "="*60)
print("Loading ResNet101 model...")
print("="*60)

# Use the public Keras loader so built-in layers like BatchNormalization
# deserialize correctly across environments such as Render.
model = tf.keras.models.load_model(RESNET_PATH, compile=False)

print(f"  Loaded: {RESNET_PATH}")

# ── Helper: flatten nested layers (unchanged from your original) ──────────────

def get_all_layers_flat(m):
    result = []
    for layer in m.layers:
        result.append(layer)
        if hasattr(layer, 'layers'):
            result.extend(get_all_layers_flat(layer))
    return result

# ── Build Grad-CAM model ONCE at startup ──────────────────────────────────────
#
# OPTIMIZATION 1:
# Your original code called tf.keras.models.Model(...) inside
# make_gradcam_heatmap() — rebuilding the whole model on every single
# request. Building a Keras model costs ~0.5–1s each time.
# Built once here, reused forever.

def _build_gradcam_model(m):
    all_layers = get_all_layers_flat(m)

    # Try the known ResNet101 last conv layer name first
    for layer in reversed(all_layers):
        if layer.name == "conv5_block3_3_conv":
            print(f"  Grad-CAM using: conv5_block3_3_conv")
            return tf.keras.models.Model(
                inputs  = m.inputs,
                outputs = [layer.output, m.output]
            )

    # Fall back to the last Conv2D found
    for layer in reversed(all_layers):
        if isinstance(layer, tf.keras.layers.Conv2D):
            print(f"  Grad-CAM using Conv2D fallback: {layer.name}")
            return tf.keras.models.Model(
                inputs  = m.inputs,
                outputs = [layer.output, m.output]
            )

    raise ValueError("No Conv2D layer found in model.")


grad_model = _build_gradcam_model(model)
print("  Grad-CAM model built.")

# ── @tf.function: compile the forward pass into a static graph ────────────────
#
# OPTIMIZATION 2:
# @tf.function traces the Python function once and compiles it into an
# optimized TensorFlow graph. Every subsequent call skips Python and runs
# the compiled graph directly — ~30–50% faster on CPU for ResNet101.
#
# OPTIMIZATION 3:
# Your original code called model() for inference THEN grad_model() for
# Grad-CAM — that was TWO full forward passes through all 101 layers.
# This single function does both at once. The GradientTape records the
# forward pass and computes gradients in the same call — no extra work.

@tf.function
def _run_gradcam(img_tensor):
    """
    Single forward pass that returns predictions + gradients together.
    training=False disables dropout and batch-norm update computations.
    """
    with tf.GradientTape() as tape:
        conv_outputs, predictions = grad_model(img_tensor, training=False)
        pred_index    = tf.argmax(predictions[0])
        class_channel = predictions[:, pred_index]

    grads = tape.gradient(class_channel, conv_outputs)
    return conv_outputs, predictions, grads, pred_index

# ── Warm up: compile the full graph before the first request ──────────────────
#
# OPTIMIZATION 4:
# @tf.function compiles on the very first real call — making it slow.
# Running a dummy image now means that compilation cost is paid at
# startup, so the first user request is just as fast as any other.
#
# Your original warm-up only called model() — this warms up _run_gradcam
# so the entire Grad-CAM graph is compiled too.

print("  Warming up (compiling tf.function graph)...")
_dummy = tf.zeros((1, IMG_HEIGHT, IMG_WIDTH, 3), dtype=tf.float32)
_run_gradcam(_dummy)
print("  Warm-up complete.")
print("="*60 + "\n")

# ── Preprocessing (logic unchanged from your version) ────────────────────────

def preprocess(pil_image):
    img = pil_image.convert("RGB")
    img = img.resize((IMG_WIDTH, IMG_HEIGHT), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32)

    arr_min, arr_max = arr.min(), arr.max()
    if arr_max > arr_min:
        arr = (arr - arr_min) / (arr_max - arr_min) * 255.0

    # Return tf.Tensor directly — avoids an extra numpy→tensor copy later
    return tf.expand_dims(arr, axis=0)

# ── Core: single-pass inference + heatmap computation ────────────────────────

def run_inference(img_tensor):
    """
    Runs one forward pass via _run_gradcam and returns:
      pred_index  (int)        — winning class index
      confidence  (float)      — softmax probability × 100
      heatmap     (np.ndarray) — normalised Grad-CAM map, shape (H, W)
    """
    conv_outputs, predictions, grads, pred_index_tensor = _run_gradcam(img_tensor)

    pred_index = int(pred_index_tensor.numpy())
    confidence = round(float(predictions[0][pred_index].numpy()) * 100, 1)

    # Weight feature maps by pooled gradients
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
    heatmap      = conv_outputs[0] @ pooled_grads[..., tf.newaxis]
    heatmap      = tf.squeeze(heatmap)
    heatmap      = tf.maximum(heatmap, 0)

    # Safe normalisation — handles blank/uniform images without div-by-zero
    heatmap_max = tf.math.reduce_max(heatmap)
    heatmap = tf.cond(
        heatmap_max > 0,
        lambda: heatmap / heatmap_max,
        lambda: heatmap
    )

    return pred_index, confidence, heatmap.numpy()

# ── Grad-CAM overlay renderer ─────────────────────────────────────────────────

def generate_gradcam_overlay(pil_image, heatmap, alpha=0.3):
    """
    Converts the raw heatmap array to a JET-coloured overlay PNG
    and returns it as a base64 string.

    OPTIMIZATION 5:
    INTER_LINEAR replaces INTER_CUBIC. For a heatmap blended at 30%
    opacity the visual difference is imperceptible but INTER_LINEAR
    is noticeably faster on CPU.
    """
    try:
        img = pil_image.convert("RGB").resize((IMG_WIDTH, IMG_HEIGHT), Image.BILINEAR)
        img = np.array(img, dtype=np.uint8)

        heatmap_f = np.clip(np.array(heatmap, dtype=np.float32), 0, 1)
        heatmap_f = cv2.resize(
            heatmap_f,
            (img.shape[1], img.shape[0]),
            interpolation=cv2.INTER_LINEAR        # was INTER_CUBIC
        )
        heatmap_color = cv2.applyColorMap(np.uint8(255 * heatmap_f), cv2.COLORMAP_JET)

        img_bgr     = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        overlay_bgr = cv2.addWeighted(img_bgr, 1 - alpha, heatmap_color, alpha, 0)
        overlay_pil = Image.fromarray(cv2.cvtColor(overlay_bgr, cv2.COLOR_BGR2RGB))

        buf = io.BytesIO()
        overlay_pil.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    except Exception as e:
        print(f"Grad-CAM overlay error (non-critical): {e}")
        return None

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": RESNET_PATH})


@app.route("/api/layers", methods=["GET"])
def list_layers():
    all_layers = get_all_layers_flat(model)
    return jsonify([{"class": l.__class__.__name__, "name": l.name} for l in all_layers])


@app.route("/api/analyze", methods=["POST"])
def analyze():

    # 1. Validate file
    if "image" not in request.files:
        return jsonify({"error": "No image provided. Use form key 'image'."}), 400

    file = request.files["image"]

    if file.filename == "":
        return jsonify({"error": "Empty filename."}), 400

    if not file.filename.lower().endswith((".png", ".jpg", ".jpeg")):
        return jsonify({"error": "Only PNG and JPG files are supported."}), 422

    # 2. Open image
    try:
        pil_image = Image.open(file.stream)
        pil_image.verify()
        file.stream.seek(0)
        pil_image = Image.open(file.stream)
    except Exception:
        return jsonify({"error": "Could not read image. Upload a valid PNG or JPG."}), 422

    # 3. Single forward pass — inference + Grad-CAM together
    start                           = time.perf_counter()
    img_tensor                      = preprocess(pil_image)
    pred_index, confidence, heatmap = run_inference(img_tensor)
    elapsed                         = round(time.perf_counter() - start, 2)

    prediction = CLASS_NAMES[pred_index]

    print(f"  Prediction : {prediction}")
    print(f"  Confidence : {confidence}%")
    print(f"  Time       : {elapsed}s")

    # 4. Render heatmap overlay (skip with ?gradcam=false)
    want_gradcam = request.args.get("gradcam", "true").lower() == "true"
    heatmap_b64  = generate_gradcam_overlay(pil_image, heatmap) if want_gradcam else None

    # 5. Return response
    response = {
        "prediction":   prediction,
        "confidence":   confidence,
        "process_time": elapsed,
    }

    if heatmap_b64:
        response["heatmap_base64"] = heatmap_b64

    return jsonify(response)


@app.route("/", methods=["GET"])
def serve_index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:path>", methods=["GET"])
def serve_static(path):
    file_path = BASE_DIR / path
    if file_path.is_file():
        return send_from_directory(BASE_DIR, path)
    return send_from_directory(BASE_DIR, "index.html")

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
