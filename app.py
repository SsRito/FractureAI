"""
FractureAI Flask app for local use and Render deployment.
"""

import base64
import io
import os
import time
from pathlib import Path

import cv2
import numpy as np
import tensorflow as tf
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image

BASE_DIR = Path(__file__).resolve().parent
RESNET_PATH = os.environ.get(
    "MODEL_PATH",
    str(BASE_DIR / "ResNet101" / "model2.h5"),
)
CLASS_NAMES = ["Fractured", "Non Fractured"]
IMG_HEIGHT = 224
IMG_WIDTH = 224

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
CORS(app)

print("\n" + "=" * 60)
print("FractureAI startup")
print("=" * 60)
print(f"  Model path: {RESNET_PATH}")

model = None
grad_model = None
model_load_error = None


def get_all_layers_flat(m):
    result = []
    for layer in m.layers:
        result.append(layer)
        if hasattr(layer, "layers"):
            result.extend(get_all_layers_flat(layer))
    return result


def build_gradcam_model(m):
    all_layers = get_all_layers_flat(m)

    for layer in reversed(all_layers):
        if layer.name == "conv5_block3_3_conv":
            print("  Grad-CAM using: conv5_block3_3_conv")
            return tf.keras.models.Model(inputs=m.inputs, outputs=[layer.output, m.output])

    for layer in reversed(all_layers):
        if isinstance(layer, tf.keras.layers.Conv2D):
            print(f"  Grad-CAM using Conv2D fallback: {layer.name}")
            return tf.keras.models.Model(inputs=m.inputs, outputs=[layer.output, m.output])

    raise ValueError("No Conv2D layer found in model.")


@tf.function
def run_gradcam_graph(img_tensor, active_grad_model):
    with tf.GradientTape() as tape:
        conv_outputs, predictions = active_grad_model(img_tensor, training=False)
        pred_index = tf.argmax(predictions[0])
        class_channel = predictions[:, pred_index]

    grads = tape.gradient(class_channel, conv_outputs)
    return conv_outputs, predictions, grads, pred_index


def ensure_model_loaded():
    global model, grad_model, model_load_error

    if model is not None and grad_model is not None:
        return

    if model_load_error is not None:
        raise RuntimeError(model_load_error)

    try:
        print("Loading ResNet101 model...")
        loaded_model = tf.keras.models.load_model(RESNET_PATH, compile=False)
        loaded_grad_model = build_gradcam_model(loaded_model)

        print("  Grad-CAM model built.")
        print("  Warming up (compiling tf.function graph)...")
        dummy = tf.zeros((1, IMG_HEIGHT, IMG_WIDTH, 3), dtype=tf.float32)
        run_gradcam_graph(dummy, loaded_grad_model)
        print("  Warm-up complete.")
        print("=" * 60 + "\n")

        model = loaded_model
        grad_model = loaded_grad_model
    except Exception as exc:
        model_load_error = f"{type(exc).__name__}: {exc}"
        print(f"Model failed to load: {model_load_error}")
        raise


def preprocess(pil_image):
    img = pil_image.convert("RGB")
    img = img.resize((IMG_WIDTH, IMG_HEIGHT), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32)

    arr_min, arr_max = arr.min(), arr.max()
    if arr_max > arr_min:
        arr = (arr - arr_min) / (arr_max - arr_min) * 255.0

    return tf.expand_dims(arr, axis=0)


def run_inference(img_tensor):
    ensure_model_loaded()
    conv_outputs, predictions, grads, pred_index_tensor = run_gradcam_graph(img_tensor, grad_model)

    pred_index = int(pred_index_tensor.numpy())
    confidence = round(float(predictions[0][pred_index].numpy()) * 100, 1)

    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
    heatmap = conv_outputs[0] @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap)
    heatmap = tf.maximum(heatmap, 0)

    heatmap_max = tf.math.reduce_max(heatmap)
    heatmap = tf.cond(
        heatmap_max > 0,
        lambda: heatmap / heatmap_max,
        lambda: heatmap,
    )

    return pred_index, confidence, heatmap.numpy()


def generate_gradcam_overlay(pil_image, heatmap, alpha=0.3):
    try:
        img = pil_image.convert("RGB").resize((IMG_WIDTH, IMG_HEIGHT), Image.BILINEAR)
        img = np.array(img, dtype=np.uint8)

        heatmap_f = np.clip(np.array(heatmap, dtype=np.float32), 0, 1)
        heatmap_f = cv2.resize(
            heatmap_f,
            (img.shape[1], img.shape[0]),
            interpolation=cv2.INTER_LINEAR,
        )
        heatmap_color = cv2.applyColorMap(np.uint8(255 * heatmap_f), cv2.COLORMAP_JET)

        img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        overlay_bgr = cv2.addWeighted(img_bgr, 1 - alpha, heatmap_color, alpha, 0)
        overlay_pil = Image.fromarray(cv2.cvtColor(overlay_bgr, cv2.COLOR_BGR2RGB))

        buf = io.BytesIO()
        overlay_pil.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as exc:
        print(f"Grad-CAM overlay error (non-critical): {exc}")
        return None


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "model": RESNET_PATH,
            "model_loaded": model is not None and grad_model is not None,
            "model_load_error": model_load_error,
        }
    )


@app.route("/api/layers", methods=["GET"])
def list_layers():
    ensure_model_loaded()
    all_layers = get_all_layers_flat(model)
    return jsonify([{"class": layer.__class__.__name__, "name": layer.name} for layer in all_layers])


@app.route("/api/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image provided. Use form key 'image'."}), 400

    file = request.files["image"]

    if file.filename == "":
        return jsonify({"error": "Empty filename."}), 400

    if not file.filename.lower().endswith((".png", ".jpg", ".jpeg")):
        return jsonify({"error": "Only PNG and JPG files are supported."}), 422

    try:
        pil_image = Image.open(file.stream)
        pil_image.verify()
        file.stream.seek(0)
        pil_image = Image.open(file.stream)
    except Exception:
        return jsonify({"error": "Could not read image. Upload a valid PNG or JPG."}), 422

    start = time.perf_counter()
    img_tensor = preprocess(pil_image)

    try:
        pred_index, confidence, heatmap = run_inference(img_tensor)
    except Exception as exc:
        return jsonify({"error": f"Model inference failed: {exc}"}), 500

    elapsed = round(time.perf_counter() - start, 2)
    prediction = CLASS_NAMES[pred_index]

    print(f"  Prediction : {prediction}")
    print(f"  Confidence : {confidence}%")
    print(f"  Time       : {elapsed}s")

    want_gradcam = request.args.get("gradcam", "true").lower() == "true"
    heatmap_b64 = generate_gradcam_overlay(pil_image, heatmap) if want_gradcam else None

    response = {
        "prediction": prediction,
        "confidence": confidence,
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
