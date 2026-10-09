# JARVIS — Hand-Controlled 3D Car Visualizer

A browser-based 3D car visualizer you control with your bare hands. Webcam hand-tracking (MediaPipe) drives a real-time [Three.js](https://threejs.org/) scene — rotate, inspect, and interact with a car model using gestures, no mouse required.

## Features

- **Real-time hand tracking** via [`@mediapipe/tasks-vision`](https://developers.google.com/mediapipe) straight from the webcam.
- **Gesture-driven control** — map hand position and poses to camera/model manipulation (orbit, zoom, interact).
- **3D car rendering** with Three.js, loaded over an import map from a CDN (no bundled vendor code).
- **JARVIS-style HUD** overlay ("CAR BAY 01") for a heads-up, sci-fi feel.
- **Zero build required to view** — the import map lets `index.html` run directly, or use Vite for a dev server.

## Tech stack

- **Three.js** `^0.160.0` — 3D rendering.
- **MediaPipe Tasks Vision** `^0.10.14` — hand landmark detection.
- **Vite** `^5.4.0` — dev server and build tooling.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Entry point, HUD markup, and import map. |
| `main.js` | Scene setup, render loop, and wiring. |
| `car-model.js` | Builds / loads the 3D car model. |
| `hand-tracking.js` | Webcam capture and MediaPipe hand-landmark pipeline. |
| `gestures.js` | Interprets landmarks into gestures and control actions. |
| `style.css` | HUD and layout styling. |

## Requirements

- A modern browser with WebGL and webcam access.
- [Node.js](https://nodejs.org/) 18+ (for the Vite dev server).

## Running

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Open the URL Vite prints, then **allow camera access** when prompted. Hold your hand up to the webcam and move it to control the scene.

Build for production:

```bash
npm run build
npm run preview
```

## Notes

- Hand tracking runs entirely in the browser — no video leaves your machine.
- Good, even lighting and a plain background improve tracking stability.
