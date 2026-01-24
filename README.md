# AI Passport & ID Photo (Static / GitHub Pages)

A fast, studio-ready **passport & ID photo** web app built with **HTML + CSS + vanilla JavaScript** only.

## Features

- **Live camera preview** (getUserMedia)
- **35×45 overlay + face guide**
- **Mandatory face validation** (blocks capture if no face / bad distance)
- **Automatic processing**
  - Background removal → **pure white**
  - Lighting / brightness / contrast
  - Mild shadow lift + sharpening
- **Print sheet generator (A4 @ 300 DPI)**
  - Quantity: **1 / 4 / 8 / 12**
  - Export: **JPG** or **PDF**

## File Structure

- `index.html`
- `styles.css`
- `app.js`

## Run Locally

Camera access requires HTTPS or localhost.

- **Option A (recommended):** open with a local server (VS Code “Live Server”, etc.)
- **Option B:** deploy to GitHub Pages (below)

## Deploy on GitHub Pages

1. Create a GitHub repository and upload these files to the repo root.
2. In GitHub: **Settings → Pages**
3. **Source:** Deploy from a branch → select `main` and `/ (root)`
4. Open your Pages URL (HTTPS) and allow camera permissions.

## Notes (Studio / Mobile)

- On **iPhone/iPad**, use **Safari** (Chrome on iOS uses Safari engine and may block camera in some cases).
- For best results: even lighting, plain background, subject faces camera directly.

## Customization

Key values are in `app.js`:

- Output DPI: `OUTPUT_DPI` (default 300)
- Photo size: `PHOTO_MM` (default 35×45)
- Face distance thresholds: `TOO_FAR` / `TOO_CLOSE` in `validateFromFaceResults()`

## Demo Link

After deploying on GitHub Pages, paste your live URL here:

- `https://<username>.github.io/<repo>/`

# AI Passport & ID Photo (Mobile)

## Run (from this folder)

1) Install:

```bash
npm run install:client
```

2) Start dev server:

```bash
npm run dev
```

Then open the shown local URL.

## Notes

- The app code is in `client/`.
- If you previously ran a different project, stop it with **Ctrl+C** then run the commands above from this folder.

