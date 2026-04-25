---
title: FractureAI
emoji: 🩻
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
suggested_hardware: cpu-basic
short_description: Fracture detection web app with TensorFlow and Grad-CAM.
---

# FractureAI

FractureAI is a Flask + TensorFlow web app for bone fracture analysis. It serves the frontend and backend from one app and runs in a Hugging Face Docker Space.

## What this Space includes

- Static frontend pages from this repository
- Flask API endpoints such as `/api/health` and `/api/analyze`
- TensorFlow model loading from `ResNet101/model2.h5`
- Grad-CAM heatmap generation for uploaded X-ray images

## Deploy on Hugging Face Spaces

1. Create a new Space on Hugging Face.
2. Choose `Docker` as the SDK.
3. Push this repository to the Space.
4. Wait for the Docker build to finish.

Once the Space is live:

- `/` opens the full website
- `/api/health` returns backend status
- Uploading an image from the site calls `/api/analyze`

## Notes

- The first analysis request may be slower because the model loads lazily on first use.
- The model files are tracked with Git LFS and need to be present in the Space repository.
