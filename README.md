# AI Passport & ID Photo (Static / GitHub Pages)

A fast, studio-ready **passport & ID photo** web app built with **HTML + CSS + vanilla JavaScript** only.

## Features

- **Live camera preview** (getUserMedia)
- **Upload Image** (process external photos the same way)
- **35×45 overlay + face guide**
- **Mandatory face validation** (blocks capture if no face / bad distance)
- **Automatic processing**
  - Background removal → **pure white**
  - Lighting / brightness / contrast
  - Mild shadow lift + sharpening
- **Print sheet generator (A4 @ 300 DPI)**
  - Quantity: **1 / 4 / 8 / 12**
  - Export: **JPG** or **PDF**
  - **Top-left layout** (saves paper for second batch)

## Best Background Quality (Studio Mode)

For **embassy/government-grade edges** (no halos, no yellow outline), use:

- **Background → Studio (remove.bg HD)**
- Paste your **remove.bg API key** (saved locally in your browser)

Notes:
- This project is static-only; the key is stored in your browser (not on a server).
- For production studio use, prefer a dedicated key and keep it private.

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

- Sheet DPI: `SHEET_DPI` (default 300)
- Photo DPI: `PHOTO_DPI` (default 450)
- Photo size: `PHOTO_MM` (default 35×45)

## Demo Link

After deploying on GitHub Pages, paste your live URL here:

- `https://<username>.github.io/<repo>/`

# Notes

- Camera access requires HTTPS (GitHub Pages is OK).
- For best background quality, use **Studio (remove.bg HD)**.
