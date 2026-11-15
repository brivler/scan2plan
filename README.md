# Scan2Plan

An offline web app (PWA) for iPhone that turns a LiDAR scan from a free scanner app
(Scaniverse recommended) into:

- a 3D view you can orbit, measure in and level,
- a floor plan (horizontal section at 1.00 m) with automatic dimensions, wall thicknesses,
  doors and windows,
- vertical sections and four elevations,
- renovation markup in the German convention: **Bestand** (existing, black/grey),
  **Abbruch** (demolition, yellow dashed), **Neubau** (new, red), with areas and volumes,
- terrain height maps with contour lines and excavation volumes (cut/fill, truck loads),
- exports as **PDF** (exact scale, A4/A3), **SVG**, **DXF** (metres, layers), **GLB** and **CSV**.

Everything runs on the phone. There is no server, no account and no running cost: the app is a
set of static files (hosted free on GitHub Pages). Scan data never leaves the phone unless you
share an export yourself.

> Removing walls can affect the structure of your house. Consult a structural engineer
> (Tragwerksplaner) and check whether you need a building permit. These drawings are not a
> legally binding survey.

The requirements are in [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md). Decisions made while
implementing them are in [`docs/IMPLEMENTATION_NOTES.md`](docs/IMPLEMENTATION_NOTES.md).

## Using it

1. Scan a room in **Scaniverse** with LiDAR on. Put a tape-measured reference in view, such as an
   unfolded folding rule.
2. In Scaniverse: open the scan → *Share/Export* → *Mesh* → **GLB** → *Save to Files*.
3. In Scan2Plan: *New project / import scan* → pick the GLB.
4. In **3D**, tap *Calibrate*, tap both ends of the reference and enter its real length.
5. Use **Plan**, **Views** and **Terrain**. Tap *Export* to share files.
6. Tap **Backup** on the Projects screen now and then. It saves one `.s2p.glb` file that restores
   the whole project. iOS can delete website data when the phone runs low on space.

The in-app **Help** (the ? button) has the full scanning guide.

## Run it locally

You need any static web server. No build step is required.

```bash
cd scan2plan
python3 -m http.server 8080      # or: npx serve .
```

Then open <http://localhost:8080/>. Service workers only work on `localhost` or over HTTPS.

## Tests

You need Node.js 22 or newer.

```bash
npm install                 # dev tools only: three (for tests), fake-indexeddb, xmldom, playwright
npm test                    # node --test test/*.test.js (unit + acceptance tests, about 20 s)
npm run coverage            # same, with line coverage
```

Headless smoke test (offline reload, import, orbit, plan, export):

```bash
npx playwright install webkit      # once
npx playwright test                # WebKit at iPhone 14 size (390×844)
S2P_BROWSER=chrome npx playwright test   # alternative: use an installed Google Chrome
```

Helper scripts:

| Command | What it does |
|---|---|
| `npm run precache` | Rebuilds `src/precache-list.js` (the offline file list). **Run it after you add or remove files.** |
| `npm run icons` | Regenerates the PNG app icons in `icons/` |
| `npm run fixtures` | Regenerates `test/fixtures/room.glb` for the smoke test |

To update three.js, copy the files from `node_modules/three` into `vendor/three/` (the same
files that are there now) and update `vendor/three/VERSION`.

## Deploy to GitHub Pages (step by step)

You need a free GitHub account. You do not need to install anything if you use the website.

1. Sign in at <https://github.com>. Click **+** (top right) → **New repository**.
   Name it `scan2plan`, choose **Public** (Pages is free for public repositories) and click
   **Create repository**. The repository contains only app code and never any scan data.
2. Upload the files:
   - **In the browser:** on the new repository page click **uploading an existing file**.
     Drag in everything in this folder **except** `node_modules`, `test-results` and
     `playwright-report`. Click **Commit changes**.
   - **Or with git:**
     ```bash
     git remote add origin https://github.com/<your-user>/scan2plan.git
     git push -u origin main
     ```
3. In the repository, open **Settings** → **Pages**. Under *Build and deployment*, set
   *Source* to **Deploy from a branch**, *Branch* to **main** and the folder to **/ (root)**.
   Click **Save**.
4. Wait one or two minutes and reload the Pages settings. It shows the address,
   `https://<your-user>.github.io/scan2plan/`.
5. **Publishing an update:** change the `version` in `package.json` (for example `1.0.1`), run
   `npm run precache` and upload the changed files again. On the phone, the app shows
   "Update available — Reload".

All paths in the app are relative, so it works under the `/scan2plan/` sub-path.

## Install on the iPhone home screen

1. Open `https://<your-user>.github.io/scan2plan/` in **Safari**. Other browsers on iOS
   cannot install web apps on every iOS version.
2. Tap the **Share** button (the square with an arrow) → **Add to Home Screen** → **Add**.
3. Start Scan2Plan from the new icon. It opens full screen, like a normal app.
4. Open it once while you are online. After that it works in airplane mode.

To check: switch on airplane mode, close the app completely, then open it again. Your projects
should still be listed.

## Project layout

```
index.html, manifest.webmanifest, sw.js, icons/
src/app/      UI: tabs, 3D viewer, plan/views/terrain screens, dialogs (browser only)
src/core/     geometry: parsers, orientation, slicing, rasterizer, walls, dims, terrain (pure, Node-testable)
src/export/   sheet layout, svg.js, pdf.js, dxf.js, glb.js, share.js, filename.js
src/store/    idb.js, project.js, annotations.js (undo/redo), backup.js
src/worker/   geometry.worker.js (runs src/core off the main thread)
vendor/three/ three.js r187 (+ addons, LICENSE, VERSION)
test/         node:test suites, helpers, smoke/ (Playwright), fixtures/
tools/        gen-precache.mjs, make-icons.mjs, make-fixtures.mjs
docs/         REQUIREMENTS.md, IMPLEMENTATION_NOTES.md
```

## License

App code: MIT (declared in `package.json`). three.js: MIT (see `vendor/three/LICENSE`).
