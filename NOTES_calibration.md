Calibration Notes

Location
- Calibration UI and logic live in `pages/editor.php`.

How calibration works (existing behavior)
- When the user draws a calibration line, the pixel length is computed as:
  - `distPx = Math.sqrt(dx*dx + dy*dy)` in `finishLineLogic()`.
- When the user inputs feet (`#cal-val`) and confirms, the internal ratio is set as:
  - `pixelsPerFoot = canvas.tempDist / val` in `finishCal()`.
- Measurements use the inverse to show real-world feet:
  - `feet = distPx / pixelsPerFoot` in `updateMeasureLabel()` and `finishLineLogic()`.
- Internal units are `pixelsPerFoot` (pixels per real-world foot).
- Calibration is persisted via `localStorage` key `cal_data_file_<fileId>`.

Scale presets (new)
- Presets are defined in `pages/editor.php` as label/category pairs, parsed to `feetPerInch`.
- Preset mode calibrates without drawing a line:
  - `pixelsPerFoot = pixelsPerInch / feetPerInch`
- Manual mode keeps the original line-based flow (`pixelsPerFoot = distPx / feet`).
- For PDFs only, `pixelsPerInch` is computed from the current background render:
  - `renderScale = backgroundWidth / viewportWidth`
  - `pixelsPerInch = 72 * renderScale`

Examples from code
- Calibration ratio set: `pixelsPerFoot = canvas.tempDist / val`.
- Measurement display: `const feet = distPx / pixelsPerFoot; textVal = feet.toFixed(2) + " ft";`.

Manual verification (no test framework)
- In the browser console (Editor page), run:
  - `window.__scalePresetSelfCheck()`
  - Expect `ok: true` for:
    - `1/8" = 1'` -> `feetPerInch = 8`
    - `1 1/2" = 1'` -> `feetPerInch = 0.666666...`
    - `1" = 500'` -> `feetPerInch = 500`
- Visual check (PDF):
  - Preset mode: select `1/8" = 1'` and verify a 1-inch measured line shows ~`8.00 ft`.
  - Manual mode: draw a 1-inch line, enter `8`, finish calibration, and verify the same result.
