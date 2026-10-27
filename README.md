# PATHAI Junction Simulator — Surampatti Four Road, Erode

HCL Jigsaw Edition 7 · Grade 8 · Traffic Flow Optimizer · Amrita Vidyalayam, Erode

Fixed timer (27 s each, 120 s cycle) vs PATHAI adaptive signal (Webster's method, PCU-weighted,
safety-clamped), fed the identical vehicles from our Round 1 survey (weekday 18:15–18:25).

Open `index.html` in any browser — no install, no login, works offline.

The live view is 3D (Three.js r158, bundled in `vendor/`, MIT licence). Drag to turn the camera,
right-drag to move it, mouse wheel to zoom, double-click to reset; the Camera menu has preset views,
including one that follows the ambulance. The 3D vehicles only animate what the engine (`engine.js`)
decides; every number comes from the engine. Without WebGL the app falls back to the 2D top-down view.

## Publish on GitHub Pages
1. Create a public repo named `pathai-surampatti` on github.com.
2. Upload every file in this folder (keep the folder layout).
3. Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
4. After a minute the app is live at `https://<your-github-username>.github.io/pathai-surampatti/`.
   Put that link on Slide 2.

## Re-generate the numbers and slides
```
node tools/edge_tests.js                 # safety / edge-case checks
node tools/slide_numbers.js > results.json
python tools/capture.py ../screenshots 1 780
python tools/build_ppt.py ../PPT_Template_Grade8_AI_TrafficFlowOptimizer.pptx results.json ../screenshots "../Traffic Flow Optimizer - Round 2 - PATHAI Erode.pptx"
```
