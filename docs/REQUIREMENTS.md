# Scan2Plan — Requirements Specification

Version 1.0 · 2026-11-15 · Status: ready for implementation
Audience: coding agent (implements), QA agent (verifies), owner (confirms open questions in §10).

Keywords MUST / SHOULD / COULD as in RFC 2119 (COULD = MAY). Units: meters internally, centimeters in the UI unless stated. Decimal separator in the UI is "." (English UI).

---

## 1. Goal and scope

**Goal.** An installable, offline-capable web app (PWA) for iPhone that opens a LiDAR scan exported from a free scanner app and produces, entirely on the device: an aligned 3D model, a 2D floor plan, vertical sections, elevations, dimensions, renovation markup (existing / demolition / new), excavation volumes, and exports (SVG, PDF, DXF, GLB). The owner is renovating a house in Germany and needs plans for wall removal, structural changes and soil removal.

### 1.1 MVP (this delivery)
Everything with priority MUST in §4. SHOULD items are expected in the MVP unless they block the delivery date; COULD items are for later.

### 1.2 Later (not in MVP)
Multi-scan registration (merging several scans of different rooms into one model), USDZ / LAS / E57 import, RoomPlan parametric import, automatic door/window classification beyond the gap heuristic in REQ-024, slopes on excavations with variable soil classes, multi-storey management.

### 1.3 Explicit non-goals
- **No video-to-3D in the browser.** Reconstructing geometry from an RGB video (photogrammetry, NeRF, Gaussian splatting) in Safari is not feasible for this product: (a) it needs GPU compute and multiple GB of memory that an iOS Safari tab does not get, and processing would take tens of minutes per room; (b) a monocular video has no absolute scale, so every model would need manual scaling; (c) published field tests of phone-based capture show room/facade errors of several centimeters even *with* LiDAR (RMS ≈1.3 cm on small objects, ≈4.6 cm on building facades, EGU26-2752), and photo-only reconstruction is worse on the plain, textureless walls typical of interiors. A browser web app also cannot access the LiDAR sensor (only RGB camera streams are exposed to the web). The only route to the owner's ±1–2 cm target on a phone is a native LiDAR capture app plus a user-measured scale check — hence the hybrid workflow below.
- No backend, no accounts, no cloud processing, no analytics, no telemetry, no paid API.
- No native iOS app (owner has no Mac).
- No structural engineering calculation (load-bearing assessment, statics). The app only documents geometry; the help screen MUST state that wall removal requires a structural engineer (Tragwerksplaner) and possibly a building permit.
- Not a legally binding survey or a permit-ready drawing (Bauvorlage).

---

## 2. Research findings that drive the design (verified 2026-11-15)

### 2.1 Scanner apps (iPhone Pro with LiDAR)

| App | Cost | Free mesh/point export | Notes |
|---|---|---|---|
| **Scaniverse** (Niantic Spatial) — **PRIMARY** | Free; "Classic" experience is "completely free … processing on-device"; paid tiers ($20/$50 per month) only add cloud/360° features | Mesh: **OBJ, FBX, GLB, USDZ, STL**, LAS. PLY/SPZ exports are **Gaussian splats**, not meshes | Version 5.2.x (Oct 2026). LiDAR mode retained; an option exists to *ignore* LiDAR — the user must keep LiDAR on. |
| **3d Scanner App** (Laan Labs) — **FALLBACK** | Free download with weekly/yearly subscription for "premium features" | Lists OBJ, GLTF, GLB, DAE, STL, USDZ; point clouds PTS, PCD, PLY, XYZ, LAS; DXF floor plan | Which exports are paywalled is not documented publicly (store listing updated Sep 2025); user reviews report features moving behind a subscription. Owner must verify GLB/OBJ export is still free (see §10). |
| Polycam | Free tier: **glTF export only**, capped capture count, free models shared via public links | glTF/GLB only | Usable as second fallback because GLB is our primary format; privacy concern (public links). |
| RoomPlan apps (e.g. "RoomPlan – Interior 3D Scanner") | Free tier USDZ/USD, 5 models; Pro paid | USDZ (parametric boxes) | Parametric walls are not a measured surface; not suitable for ±1–2 cm or terrain. Later/COULD. |

**Primary import format: GLB (binary glTF 2.0).** Reason: the glTF 2.0 specification fixes units (**meters**) and axes (**right-handed, +Y up**), so a GLB from any app is unambiguous; it is compact, binary, and loaded by three.js's mature `GLTFLoader`. **Secondary: OBJ** (unitless by spec; scanner apps write meters, ARKit convention +Y up — treated as assumption, verified by REQ-005 heuristics). **Tertiary: PLY** (mesh or point cloud; Scaniverse PLY files are splats and MUST be rejected with a specific message, REQ-003).

### 2.2 Accuracy reality
- Literature: Scaniverse errors < 1 % of object dimensions for small/medium objects (Geodetski vestnik 2026/1); RMS ≈ 1.34 cm small objects, ≈ 4.6 cm building facades, glass/reflective surfaces cause the largest errors (EGU26-2752). Practical LiDAR range ≈ 5 m.
- Consequence: ±1–2 cm is achievable for single rooms when the user calibrates scale against a tape-measured reference (REQ-030). Facades and terrain will typically be ±3–5 cm; the UI MUST state this (REQ-061).

### 2.3 iOS Safari / home-screen web app constraints
- **Storage:** Since Safari 17 / iOS 17, an origin may use up to 60 % of disk when running as a browser app, and a Home Screen Web App gets the same quotas as a browser app (WebKit "Updates to Storage Policy"). Data in best-effort mode can be evicted under storage pressure or after a period of non-use (LRU); `navigator.storage.persist()` may be granted, with "opened as a Home Screen Web App" being one of WebKit's heuristics. Older articles cite a 50 MB cap and 7-day eviction — this is outdated for iOS 17+ but eviction remains possible, so backups (REQ-012) are required.
- **Downloads:** In an installed (standalone) PWA on iOS, `<a download href=blob:…>` silently fails (WebKit bug 275288, open). Exports MUST use the Web Share API with files (`navigator.share({files})`, Safari ≥ 14 for `canShare`) as the primary path (REQ-050).
- **Web Share Target is not supported on iOS**, so the scanner app cannot "share into" the PWA; import goes through Files (`<input type="file">`). File System Access API is not supported.
- **Memory:** iOS kills a WebContent process that exceeds its memory budget (page reloads, "a problem repeatedly occurred"); no official number is published. Design budget in §5.3.
- **Service worker:** supported; caches aggressively — the app MUST call `registration.update()` on launch (REQ-071). Background sync not available (not needed).

### 2.4 three.js (current release r187, npm `three@0.187.0`)
`GLTFLoader`, `OBJLoader`, `PLYLoader`, `GLTFExporter`, `OrbitControls` are long-standing addons and reliable. `USDLoader` (handles USDA, USDC and USDZ) exists in current addons but is newer; USDZ import is therefore COULD (REQ-007).

### 2.5 German drawing convention (Bestand / Abbruch / Neubau)
Colour is not mandatory in German permit drawings and varies by state Bauvorlagenverordnung; common practice (practitioners' forum, bau.net) is: **existing = black or grey, demolition = dashed outline + yellow, new = red.** The app uses exactly this (REQ-040) and offers a black-and-white mode (REQ-041).

---

## 3. End-to-end user workflow

1. **Scan** in Scaniverse (Classic, LiDAR on, "Area"/"Large" mode; see Scanning guide §8). Place a tape-measured reference (e.g. a 1.000 m folding rule or a measured door width) in the scene.
2. **Export** from Scaniverse: Share → Export Mesh → **GLB** → "Save to Files" (e.g. *On My iPhone › Scans*).
3. **Open Scan2Plan** from the home-screen icon (works offline). Tap **New project** → enter name → **Import scan** → pick the GLB in Files.
4. App parses in a worker, shows progress, auto-orients (floor level, walls aligned to axes) and shows the **3D view**. User confirms or corrects orientation (tap floor; rotate 90°).
5. **Calibrate** (recommended): tap the two ends of the reference, enter the true length → scale applied, shown in title block.
6. **Plan**: horizontal section at 1.00 m (slider). Auto dimensions. Optional: mark wall segments **Demolition**, draw **New** walls.
7. **Sections / Elevations**: front/right/back/left elevations and a user-drawn cut line section.
8. **Terrain** (garden/excavation scans): draw excavation polygon, enter target level or depth → cut/fill volume in m³ and truck loads.
9. **Export**: SVG / PDF (A4/A3, 1:50/1:100…) / DXF / GLB via the iOS share sheet → Save to Files, AirDrop, Mail.
10. Project (scan + markup) stays in on-device storage; **Backup** exports a single `.s2p.glb` file that re-imports the full project.

---

## 4. Functional requirements

Conventions used in acceptance criteria:
- **World frame** after orientation: meters, right-handed, **+Y up**, floor (or reference datum) at Y = 0, dominant wall directions parallel to X and Z.
- **Plan frame:** plan x = world X, plan y = −world Z (viewed from above). SVG/PDF y-axis is flipped accordingly.
- Geometry core = pure ES module functions on `{positions: Float32Array, indices: Uint32Array}` with no DOM or three.js dependency (so Node tests run them directly). Test names refer to `node --test` files under `test/`.
- Synthetic fixtures are generated in test code: `box(w,d,h)` = closed axis-aligned box mesh, outward normals, 12 triangles, min corner at origin unless stated.

### 4.1 Import

**REQ-001 Import GLB/glTF — MUST**
Import `.glb` and self-contained `.gltf` (embedded buffers) via `<input type="file">`. All meshes in the scene graph are merged into one indexed triangle mesh with world transforms applied. Vertex colors and the first base-color texture are retained for display if present; otherwise a neutral grey `#B0B0B0` with lighting.
Acceptance:
- `test/import.test.js › glb box roundtrip`: a GLB generated in the test (box 4×3×2.5 m with a node translation of (1,0,2) and scale 1) imports to 12 triangles whose bounding box is min (1,0,2) max (5,2.5,5) ± 1e-6.
- A GLB with two mesh nodes yields one merged mesh with summed triangle count.
- Draco- or meshopt-compressed GLB: if the extension is required and no decoder is vendored, the app shows error E-IMP-04 (see REQ-004) instead of crashing.

**REQ-002 Import OBJ — MUST**
Import `.obj` (v/f, polygons triangulated as fans, negative indices supported, `mtllib`/`usemtl` ignored, no texture). Units assumed meters, up-axis assumed +Y, then checked by REQ-005.
Acceptance: `test/import.test.js › obj quad and negative indices`: an OBJ with one quad face using negative indices produces 2 triangles with correct vertex positions; an OBJ with 3 `o` groups is merged.

**REQ-003 Import PLY (mesh and point cloud), reject splat PLY — MUST**
Import ASCII and binary little-endian PLY. If faces exist → mesh. If no faces → point cloud (display as points; plan/section use point slicing REQ-022b). If the vertex element contains any of the properties `f_dc_0`, `opacity`, `scale_0`, `rot_0` → reject with E-IMP-03.
Acceptance: `test/import.test.js › ply mesh`, `› ply points`, `› ply splat rejected` (each with small generated PLY files); splat file yields error code `E-IMP-03`.

**REQ-004 Import limits and error messages — MUST**
- Max file size **300 MB**; files > 100 MB show warning W-IMP-01 before parsing ("Large file — loading may take up to 1 minute and can fail on older iPhones.") with Continue/Cancel.
- Max **5,000,000 triangles** (or 10,000,000 points) after parsing; above → E-IMP-05.
- Parsing runs in a Web Worker; progress bar updated at least every 500 ms; Cancel button terminates the worker within 1 s.
- Error codes and exact texts (all errors keep the app usable; nothing is stored on failure):

| Code | Message |
|---|---|
| E-IMP-01 | "Unsupported file type. Please export GLB (recommended), OBJ or PLY from your scanner app." |
| E-IMP-02 | "The file could not be read. It may be damaged or incomplete — export it again." |
| E-IMP-03 | "This PLY file is a Gaussian splat, not a mesh. In Scaniverse choose Export → Mesh → GLB." |
| E-IMP-04 | "This file uses compression that is not supported. Export without Draco/mesh compression." |
| E-IMP-05 | "The scan is too large (more than 5 million triangles). Export a smaller area or lower detail." |
| E-IMP-06 | "File larger than 300 MB cannot be opened on iPhone." |
| E-IMP-07 | "The file contains no geometry." |

- File type detection by content (magic bytes `glTF` for GLB, `ply\n` header, OBJ by lines starting `v `), not only by extension. The file input MUST NOT use a restrictive `accept` attribute (iOS greys out unknown extensions); validation happens after selection.
Acceptance: `test/import.test.js › error codes` feeds a PNG header, an empty file, a truncated GLB and a GLB with `extensionsRequired:["KHR_draco_mesh_compression"]` and asserts E-IMP-01, E-IMP-07, E-IMP-02, E-IMP-04 respectively. Code review: `index.html`/import module contains no `accept=".glb` restriction; size thresholds are constants `MAX_FILE_BYTES = 300*1024*1024`, `WARN_FILE_BYTES = 100*1024*1024`, `MAX_TRIANGLES = 5_000_000`.

**REQ-005 Unit and up-axis plausibility — MUST**
After import: if the bounding-box diagonal > 500 → assume millimeters and prompt "Model looks like it is in millimeters. Scale ×0.001?"; if 50 < diagonal ≤ 500 and the file is not glTF → prompt for centimeters (×0.01); if diagonal < 0.05 → E-IMP-07-like warning "Model is very small — check units". User can accept or ignore. For OBJ/PLY the up-axis candidate is chosen by REQ-020; for glTF +Y is assumed.
Acceptance: `test/orient.test.js › unit heuristic`: box(4000,3000,2500) → suggests 0.001; box(400,300,250) from OBJ → suggests 0.01; box(4,3,2.5) → no suggestion.

**REQ-006 Point-cloud formats (XYZ/PTS ASCII) — COULD**
Import whitespace-separated `x y z [...]` text point clouds up to 10 M points.

**REQ-007 USDZ import via three.js USDLoader — COULD**
Acceptance (if implemented): a USDZ exported by three.js `USDZExporter` from box(4,3,2.5) imports with bbox 4×2.5×3 ± 1 mm.

### 4.2 Projects and local persistence

**REQ-010 Project storage in IndexedDB — MUST**
A project = `{id (uuid), name, createdAt, updatedAt, sourceFile (Blob, original bytes), sourceName, transform (4×4 matrix: orientation+calibration), scale, annotations (JSON), settings (section height, paper, scale)}`. Stored in IndexedDB database `scan2plan`, version-numbered schema with upgrade function. All edits auto-save within 1 s (debounced). Project list shows name, date, thumbnail (256×256 JPEG ≤ 30 KB), storage size; rename, duplicate, delete (with confirmation).
Acceptance: `test/store.test.js` (using `fake-indexeddb` dev dependency) creates, reads, updates, lists and deletes a project; reopening restores `transform` and `annotations` byte-identical (deep equal).

**REQ-011 Persistent storage request and usage display — MUST**
On first successful import call `navigator.storage.persist()` (if available) and record the result. Settings screen shows `navigator.storage.estimate()` usage/quota in MB and whether storage is persistent. If not persistent, show once: "iOS may delete app data if the phone runs low on space. Use Backup to keep a copy in Files."
Acceptance: code review — `persist()` is called only after a user-initiated import; the estimate is displayed; the warning text matches.

**REQ-012 Project backup and restore — MUST**
"Backup" writes one file `<name>.s2p.glb`: the oriented, calibrated mesh as GLB with the full project JSON in `asset.extras.scan2plan` (schema version included). Importing such a file restores the project including annotations (import path detects `extras.scan2plan`).
Acceptance: `test/backup.test.js › roundtrip`: project with 3 annotations → backup → import → deep-equal annotations, transform equals identity (already baked) and bbox equal ± 1e-5.

**REQ-013 Offline operation — MUST**
No network request is made after the service worker has installed, for any feature. Acceptance: smoke test (REQ-090) sets the browser context offline after first load, reloads, imports a fixture and generates a plan with zero failed requests; code review: no `fetch`/`XMLHttpRequest`/`import()` to absolute `http(s)` URLs anywhere in `src/`.

### 4.3 3D viewer

**REQ-015 3D view with touch navigation — MUST**
three.js WebGL2 renderer. One-finger drag = orbit, two-finger drag = pan, pinch = zoom, double-tap = focus on tapped point. Buttons: Reset view, Top, Front, Right, Back, Left, Perspective/Orthographic toggle. Axis gizmo and floor grid (1 m major, 0.1 m minor when zoomed < 5 m). Pixel ratio capped at `min(devicePixelRatio, 2)`.
Acceptance: code review of controls mapping; smoke test performs a synthetic drag and asserts camera position changed.

**REQ-016 Display decimation — MUST**
If the mesh has > 500,000 triangles, a display copy is created by vertex clustering (uniform grid; cell size chosen by doubling from 5 mm until triangle count ≤ 500,000). All measurements, sections and volumes use the **full-resolution** mesh, never the display copy.
Acceptance: `test/decimate.test.js`: a subdivided plane of 1,000,000 triangles decimates to ≤ 500,000 triangles, bbox preserved ± cell size; a 10,000-triangle mesh is returned unchanged.

**REQ-017 Rendering modes — SHOULD**
Toggles: textured/colored, shaded grey, wireframe-over-shaded, X-ray (50 % opacity), clipping box (6 sliders) and live section plane matching the plan height (REQ-022) shown as a red line on the model.

**REQ-018 Markup in 3D — COULD**
Demolition/new elements from REQ-040 shown as yellow/red overlays extruded from floor to ceiling height.

### 4.4 Orientation

**REQ-020 Automatic leveling (up-axis and floor) — MUST**
Compute area-weighted face-normal histogram. Up-axis candidates: ±X, ±Y, ±Z. For glTF, +Y is used. For OBJ/PLY, choose the candidate axis `a` maximizing area of faces with `n·a > 0.97` (upward-facing) among faces in the lowest 20 % of the extent along `a`; ties → +Y. Then refine tilt: fit a plane (area-weighted least squares) to faces with `n·up > 0.97` in the lowest 20 %; rotate so its normal is exactly +Y (only if correction ≤ 5°). Floor level = area-weighted median Y of those faces → translate so floor is Y = 0. If fewer than 0.5 m² of floor-like faces exist (facade/terrain), set Y = 0 at the minimum Y and keep tilt.
Manual override: buttons "Up = +X/−X/+Y/−Y/+Z/−Z", "Tap floor to level" (fit plane to full-res faces within 0.3 m of tap with normal within 15° of tap normal), "Set ±0.00 here" (tap any point → that Y becomes 0, e.g. OKFF finished floor level).
Acceptance (`test/orient.test.js`):
- `› z-up box`: box(4,3,2.5) given in Z-up OBJ convention (height along Z) → after leveling, extent along Y = 2.500 ± 0.001.
- `› tilted floor`: box rotated 2° about X → leveled; floor normal angle to +Y < 0.05°; floor Y = 0 ± 0.001.
- `› facade no floor`: single vertical 10×6 m plane → no tilt change, min Y = 0.

**REQ-021 Automatic wall alignment (yaw) — MUST**
Take faces with `|n·up| < 0.2`; compute the yaw angle of each horizontal normal modulo 90°, area-weighted histogram with 0.5° bins over [0°, 90°), circular smoothing (±1 bin), peak bin refined by area-weighted circular mean within ±1°. Rotate about Y so dominant walls are parallel to X/Z. User buttons: "Rotate 90°" and "Align to tapped wall" (tap a wall → that wall's normal becomes axis-parallel).
Acceptance: `test/orient.test.js › yaw 23deg`: box(4,3,2.5) rotated 23° about Y → detected rotation 23.0° ± 0.5° (mod 90°) and after alignment all wall normals within 0.5° of ±X/±Z. Same for 67° and 89.7°.

### 4.5 2D plan, sections, elevations

**REQ-022 Floor plan by horizontal section — MUST**
Intersect the full-res mesh with plane Y = h. Default h = **1.00 m** (above ±0.00); slider and numeric input, range 0.05 m to (maxY − 0.05 m), step 0.01 m; updates plan in < 1.5 s for 1 M triangles. Algorithm: triangle–plane intersection → segments → weld endpoints with tolerance 1 mm → chain to polylines (closed where possible) → Douglas–Peucker simplification ε = 10 mm (user setting 0–50 mm) → optional orthogonal snapping (segments within 3° of X or Z snapped, default ON).
Triangles exactly on the plane are ignored; vertices exactly on the plane are perturbed by +1e-7 m.
Acceptance (`test/slice.test.js`):
- `› box perimeter`: box(4,3,2.5) sliced at 1.2 → one closed polyline, perimeter 14.000 ± 0.005 m, area 12.000 ± 0.005 m².
- `› L-shape`: L-shaped prism (6×4 m minus 3×2 m corner, height 2.5) → perimeter 20.000 ± 0.005, 6 vertices after simplification.
- `› noise`: box vertices jittered ±3 mm (seeded RNG, subdivided to 2 cm triangles) → simplified polyline has 4 vertices and perimeter 14.00 ± 0.02.
- `› performance`: 1,000,000-triangle mesh sliced in < 1500 ms on Node 22 CI (lower bound check for the device budget).

**REQ-022b Point-cloud slicing — SHOULD**
For point clouds: take points with |Y − h| ≤ 0.02 m, rasterize to 1 cm grid, extract boundary polylines (marching squares) and simplify as REQ-022.
Acceptance: `test/slice.test.js › points ring`: points sampled at 5 mm on the walls of box(4,3,2.5) → perimeter 14.0 ± 0.05.

**REQ-023 Wall thickness (poche) — SHOULD**
Where two simplified plan segments are parallel (angle ≤ 2°), 0.05 m ≤ distance ≤ 0.60 m, and overlap ≥ 50 % of the shorter one, render the region between them as wall fill (Existing style) and report thickness. Single-sided walls (only one face scanned) are drawn as a 0.35 mm line and labelled nothing.
Acceptance: `test/walls.test.js › double wall`: two boxes 4×3 m and 3×3 m separated by a 0.24 m gap (two rooms scanned together) → one wall pair detected, thickness 0.240 ± 0.005 m.

**REQ-024 Openings (doors/windows) — SHOULD**
Slice additionally at h₁ = 0.30 m and h₂ = 1.00 m (relative to ±0.00). Along each straight wall line (simplified segments, length ≥ 0.5 m, collinear within 2 cm), a gap of 0.50–3.00 m at h₂ that also exists at h₁ → **door** (drawn as gap + 90° swing arc symbol omitted, label "D w=…cm"); gap at h₂ but closed at h₁ → **window** (drawn as gap with double line, label "W w=…cm"). Gap = no section segment within 5 cm of the wall line over that interval.
Acceptance: `test/openings.test.js`: box(5,4,2.5) with a door hole 0.90×2.00 m in one wall and a window hole 1.20×1.00 m (sill at 0.90 m) in another (fixture built from quads) → exactly 1 door width 0.90 ± 0.01 and 1 window width 1.20 ± 0.01.

**REQ-025 Elevations (4 directions) — MUST**
Orthographic views from front (−Z looking +Z… defined as: Front = view direction +Z i.e. camera at −Z), Right (camera at +X), Back (camera at +Z), Left (camera at −X) of the aligned model. Implemented with a **pure-JS software depth rasterizer** (testable in Node): resolution 1 cm/px by default, automatically coarsened so the longest side ≤ 4096 px. Output: (a) shaded image (Lambert shading from normals, depth fog), (b) vector outline = boundary of the coverage mask plus depth discontinuities > 0.05 m, extracted by marching squares and simplified with ε = 1 px. Elevations include a ±0.00 level line and height labels at top and bottom of the model in meters (e.g. "+2.50").
Acceptance: `test/elevation.test.js › box front`: box(4,3,2.5) Front elevation → outline bbox width 4.00 ± 0.02 m, height 2.50 ± 0.02 m; Right elevation width 3.00 ± 0.02. `› resolution cap`: 60 m long box → image longest side ≤ 4096 px.

**REQ-026 User-defined vertical section — MUST**
In plan view the user taps two points to define a cut line, then a direction arrow (which side is viewed). Section = intersection of the full-res mesh with the vertical plane through the line (cut outline, bold 0.5 mm) plus the elevation of geometry beyond the plane within a depth of 0–20 m (setting, default 5 m) using REQ-025 (thin lines/grey image). Cut line drawn in plan with labels "A–A", "B–B"… Up to 26 sections per project.
Acceptance: `test/section.test.js › box section`: box(4,3,2.5), cut line from (2,−1) to (2,4) in plan → cut outline is a rectangle 3.00 × 2.50 ± 0.005 m (perimeter 11.00 ± 0.01).

**REQ-027 Level (height) annotations — SHOULD**
In sections/elevations the user can tap a point to place a level marker showing height relative to ±0.00 in meters with sign and 2 decimals (e.g. "+2.47", "−0.18").

### 4.6 Boundaries and dimensions

**REQ-028 Clear boundaries display — MUST**
Plan rendering: section outlines (cut lines) 0.50 mm black; elements beyond/below (optional "show floor edges below" from an additional slice at h = 0.05 m) 0.18 mm grey `#808080`; paper background white. In the app, line widths scale so that cut lines are ≥ 2 CSS px at any zoom. Plan supports pinch-zoom and pan, and a "Fit" button.
Acceptance: code review of style constants `LINE_CUT_MM = 0.5`, `LINE_BEYOND_MM = 0.18`; SVG export test (REQ-051) checks stroke widths.

**REQ-029 Automatic dimensions — MUST**
For the plan: overall dimension chains on all four sides of the outline's axis-aligned bounding box (overall length + one chain of every outline vertex projected onto that side, merged where < 5 cm apart), and an individual dimension on every straight segment ≥ 0.30 m. Openings (REQ-024) get width dimensions. Text = length in **cm, rounded to integer** (e.g. "345"); the dimension style follows DIN 406 look: dimension line, 45° oblique ticks 2 mm, text above line, 2.5 mm text height at paper scale. Toggle to hide.
Acceptance: `test/dims.test.js › box dims`: box(4,3,2.5) plan → overall dimensions texts include "400" (×2) and "300" (×2). `› rounding`: segment 3.4549 m → "345", 3.455 m → "346" (round half up).

**REQ-030 Tap-to-measure — MUST**
In 3D, plan, section and elevation views: tap point A, tap point B → straight distance shown in cm with 1 decimal ("345.2 cm") plus, in 3D, horizontal and vertical components ("Δh 340.1 cm, Δv 58.3 cm"). In 3D, taps raycast against the display mesh then snap to the nearest full-res vertex within 2 cm if any; in 2D views, snap to polyline vertices within 24 CSS px and onto lines otherwise. Measurements can be saved as annotations (persisted, exported in drawings). Raycast completes < 300 ms on a 500k-triangle display mesh.
Acceptance: `test/measure.test.js › distance format`: points (0,0,0)-(3,0.583,1) → "317.0 cm" components formatted as specified; code review of snapping radii constants.

**REQ-031 Scale calibration override — MUST**
"Calibrate scale": user measures a known reference (REQ-030 flow) and enters the real length in cm (numeric input, 1 decimal). Factor s = real / measured; accepted range 0.80–1.25, outside → confirm dialog "Scale change of X % is unusual. Apply anyway?". Applied uniformly about the origin to the project transform; all derived drawings recompute. A second calibration multiplies onto the current scale. "Reset scale" restores s = 1. Current factor shown in project info and title block ("Scale calibrated ×1.0123 on 100.0 cm reference" or "Scale: as scanned (not calibrated)").
Acceptance: `test/calibrate.test.js`: measured 98.7 cm, real 100.0 → s = 1.01317 ± 1e-5; box(4,3,2.5) after scaling slices to perimeter 14.184 ± 0.005; factor 1.4 triggers the warning path.

**REQ-032 Scale bar and north/orientation marker — MUST (scale bar), COULD (north)**
Every plan/section/elevation in app and export shows a graphical scale bar (0–1–2–5 m for 1:100; 0–0.5–1–2 m for 1:50; chosen so the bar is 40–100 mm on paper) and the numeric scale. COULD: user-set north arrow angle in plan.
Acceptance: `test/export-svg.test.js › scale bar`: at 1:100 the 1 m tick is 10.00 mm from 0 in SVG units (mm).

### 4.7 Renovation markup

**REQ-040 Existing / Demolition / New markup in plan — MUST**
Annotation types in plan view:
- **Existing (Bestand)** — default for all scanned geometry: black cut lines, wall poche grey `#808080` (or black in B/W).
- **Demolition (Abbruch)** — user selects a wall segment (tap segment, then drag handles to trim start/end along the segment, snapping to 1 cm) or draws a polygon. Rendering: fill **yellow `#FFD600`**, outline **dashed** (dash 3 mm / gap 1.5 mm on paper), black 0.35 mm.
- **New (Neubau)** — user draws a wall by two points + thickness from presets **11.5 / 17.5 / 24 / 30 / 36.5 cm** (German masonry sizes) or custom (1–100 cm), with alignment left/center/right of the drawn line; or a polygon. Rendering: fill **red `#E30613`**, solid 0.5 mm outline.
- Each element has optional note text (≤ 200 chars) and shows its length (cm) and, for Demolition, the **area of wall to remove in m²** = length × height (height defaults to scanned floor-to-ceiling at that location, editable) and **volume m³** = area × thickness (thickness from REQ-023 if detected, else user input).
- Legend block with the three categories is added to every exported plan containing markup.
Acceptance: `test/markup.test.js`: demolition on a 3.00 m segment with height 2.50 and thickness 0.24 → area 7.50 m², volume 1.800 m³; SVG export contains a path with `fill="#FFD600"` and `stroke-dasharray`, and a path with `fill="#E30613"`; undo/redo stack of ≥ 50 steps works for add/move/delete (unit test on the annotation store).

**REQ-041 Black-and-white mode — SHOULD**
Toggle for exports: Demolition = dashed outline + diagonal cross (X) through the element, no fill; New = 45° hatch 2 mm spacing; Existing = solid black poche.
Acceptance: SVG export in B/W mode contains no `#FFD600`/`#E30613`.

**REQ-042 Markup list — SHOULD**
A list of all markup elements with type, length, area, volume, note, and totals per type; exportable as CSV (UTF-8, `;` separator, decimal comma for German spreadsheets — explicit exception to §0 decimal-point rule).

### 4.8 Terrain and excavation

**REQ-045 Terrain view — MUST**
Top-down orthographic height map of the model (software rasterizer, top surface = max Y per cell, cell 5 cm default, 2–20 cm setting) with hypsometric color ramp and contour lines every 0.10 m (major every 0.50 m, labelled in m relative to ±0.00). Cells with no data are transparent and counted.
Acceptance: `test/terrain.test.js › heightmap`: plane y = 0.1·x over 10×10 m, cell 0.05 → cell at x = 5.025 has height 0.5025 ± 0.002.

**REQ-046 Excavation volume — MUST**
User draws a closed polygon (≥ 3 vertices, tap to add, drag to move, numeric vertex editing in m) on the terrain view and chooses target mode:
- **(a) Target level**: absolute level L relative to ±0.00 (e.g. −0.80 m), or
- **(b) Constant depth**: depth d below existing surface (e.g. 0.30 m topsoil removal), or
- **(c) Sloped target plane** (COULD): level at two points.
Computation on cells whose center lies inside the polygon: cut = Σ max(0, h − t)·A_cell, fill = Σ max(0, t − h)·A_cell; for (b) cut = Σ d·A_cell. Results: polygon area (m², 2 decimals), cut and fill volume (m³, 2 decimals), **loose volume** = cut × bulking factor (default **1.25**, editable 1.00–1.60), and **truck loads** = ceil(loose / truck capacity) with capacity default 10 m³ (editable). Data coverage % inside polygon; < 95 % → warning "Only X % of the area has scan data; missing cells were interpolated." Missing cells filled by inverse-distance weighting of valid cells within 0.5 m; if none, excluded and reported.
Acceptance (`test/terrain.test.js`):
- `› volume level`: terrain y = 0.1·x over 10×10 m, polygon rectangle x∈[2,6], z∈[1,6] (area 20 m²), target level −0.5 → mean height in polygon 0.4 → cut = 20 × 0.9 = **18.00 ± 0.10 m³**, fill = 0.
- `› constant depth`: same polygon, depth 0.30 → cut 6.00 ± 0.05 m³.
- `› trucks`: cut 18.00, factor 1.25, capacity 10 → loose 22.50, trucks 3.
- `› coverage`: 10 % of cells removed → coverage 90 % ± 1 and warning flag true.

**REQ-047 Excavation section — SHOULD**
A vertical section (REQ-026) through an excavation polygon draws the existing terrain line and the target line, with the cut area hatched brown `#8B5A2B`.

**REQ-048 Slopes (Böschung) — COULD**
Excavation sides with slope angle β (default 60° for cohesive / 45° for non-cohesive soil, ref. DIN 4124 for trenches > 1.25 m deep) — the polygon is the bottom outline and the top outline is offset outward by depth / tan β. Help text must state this is an estimate, not a site safety plan.

### 4.9 Exports

**REQ-050 Export delivery on iOS — MUST**
All exports produce a `File` and are delivered by: (1) `navigator.share({files:[file], title})` if `navigator.canShare({files:[file]})` is true; (2) otherwise `<a download>` with an object URL; (3) otherwise open the object URL in a new window. File names: `<project>_<view>_<scale>_<YYYY-MM-DD>.<ext>`, ASCII-safe (umlauts transliterated ä→ae, ö→oe, ü→ue, ß→ss; other non-[A-Za-z0-9._-] → `_`). Share is invoked directly inside the tap handler (user activation), so generation of files > 1 s MUST happen first with a "Ready — tap Share" second button.
Acceptance: `test/export-util.test.js › filename`: project "Küche Süd" plan 1:50 on 2026-11-15 → `Kueche_Sued_plan_1-50_2026-11-15.pdf`. Code review of the 3-step fallback.

**REQ-051 SVG export — MUST**
Vector SVG of the current view sheet (plan, section, elevation, terrain) in real paper millimeters (`width="297mm" height="210mm" viewBox="0 0 297 210"` for A4 landscape), containing: drawing at chosen scale, dimensions, markup, legend, scale bar, title block (REQ-053). Elevation/terrain raster images embedded as `<image href="data:image/jpeg;base64,…">` (JPEG quality 0.85) beneath vector outlines.
Acceptance: `test/export-svg.test.js`: box(4,3,2.5) plan at 1:50 on A4 landscape → the outline path's bbox is 80.0 × 60.0 ± 0.1 SVG units; output parses as well-formed XML (`DOMParser` from a dev dependency, e.g. `@xmldom/xmldom`); cut-line stroke-width = 0.5.

**REQ-052 PDF export — MUST**
Single-page vector PDF (PDF 1.4) written by an in-repo minimal PDF writer (no PDF library): lines, polylines, fills, dash patterns, standard font Helvetica (WinAnsiEncoding; covers ä ö ü ß), embedded JPEG via DCTDecode for raster parts. Paper **A4 and A3**, portrait/landscape. Scales **1:20, 1:25, 1:50, 1:100, 1:200, 1:500**, plus "Fit" = largest of these at which the drawing fits the drawing area; if none fits, show "Drawing does not fit A3 at 1:500" and offer 1:1000. Exact scale guaranteed: printing at 100 % yields correct lengths. Drawing area margins: 20 mm left (binding edge per DIN 824 folding convention), 10 mm others.
Acceptance: `test/export-pdf.test.js`: PDF for box plan at 1:100 on A4 → starts with `%PDF-1.4`, ends with `%%EOF`, xref offsets valid (test parses xref and checks each object offset points at `n 0 obj`), page MediaBox `[0 0 841.89 595.28]` ± 0.01 for A4 landscape; the outline polygon in content stream spans 4 m / 100 = 40 mm = 113.39 ± 0.1 pt. `› fit`: 30 m long outline on A4 → chosen scale 1:200.

**REQ-053 Title block — MUST**
Bottom-right box 180 × 30 mm (A4: full width of drawing area if narrower) with: project name, view name ("Floor plan +1.00", "Section A–A", "Elevation Front", "Excavation 1"), scale, paper, date (YYYY-MM-DD), calibration status (REQ-031), accuracy note "Dimensions from LiDAR scan, typical tolerance ±2 cm (facades/terrain ±5 cm). Verify on site before construction.", and "Scan2Plan". Optional user field "Author".
Acceptance: `test/export-svg.test.js › title block` asserts all fields' texts present.

**REQ-054 DXF export — MUST**
ASCII DXF R12 (`$ACADVER AC1009`) with header `$INSUNITS 6` (meters; ignored by strict R12 readers, honored by modern CAD), coordinates in **meters** at 1:1 (plan in X/Y = plan frame; sections/elevations in X/Y = horizontal/vertical of that view). Entities: LINE, POLYLINE/VERTEX (closed flag 1 where closed), TEXT, and dimensions as plain LINE+TEXT (no DIMENSION entities). Layers with ACI colors: `S2P_EXISTING` (7), `S2P_BEYOND` (8), `S2P_DEMOLITION` (2, linetype DASHED defined in LTYPE table), `S2P_NEW` (1), `S2P_DIMENSIONS` (3), `S2P_TEXT` (7), `S2P_SECTIONLINES` (4), `S2P_EXCAVATION` (30). Raster images are not exported to DXF.
Acceptance: `test/export-dxf.test.js`: box plan DXF parsed by the test's minimal group-code parser (or `dxf-parser` dev dependency) → a closed polyline on `S2P_EXISTING` with vertices forming a 4 × 3 rectangle ± 1e-4; layers table contains all 8 layers; file uses CRLF or LF consistently and ends with `0\nEOF`.

**REQ-055 GLB export — MUST**
Export the oriented and calibrated model (full-res if ≤ 2 M triangles, else the display copy with a notice) as GLB via three.js `GLTFExporter`, +Y up, meters. Optional: include markup as separate colored meshes (COULD).
Acceptance: `test/export-glb.test.js` (runs `GLTFExporter` in Node with a minimal `FileReader`/`Blob` shim if needed) → re-import bbox equals pre-export bbox ± 1e-5.

**REQ-056 PNG snapshot — COULD**
Export current 3D view as PNG at 2× screen resolution.

### 4.10 PWA, help, usability

**REQ-060 Installable PWA — MUST**
`manifest.webmanifest` with `name "Scan2Plan"`, `short_name "Scan2Plan"`, `display "standalone"`, `start_url "./"`, `scope "./"`, `background_color`, `theme_color`, icons 192, 512 and 512 maskable PNG; `<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">`; `<meta name="apple-mobile-web-app-capable" content="yes">` (+ `mobile-web-app-capable`), `apple-mobile-web-app-status-bar-style` `black-translucent`, `viewport-fit=cover`. All paths relative so it works under a GitHub Pages sub-path (`https://<user>.github.io/scan2plan/`). First-run screen explains "Share → Add to Home Screen" when not in standalone mode (`navigator.standalone !== true` and `display-mode: standalone` not matched).
Acceptance: `test/pwa.test.js` reads manifest JSON and index.html and asserts the listed fields, icon files exist with the stated pixel sizes (PNG IHDR check), and no absolute `/` paths in manifest/index/sw.

**REQ-061 Help screen and accuracy notice — MUST**
In-app Help contains the Scanning guide (§8) verbatim (may be reformatted), the export-from-Scaniverse steps (§3 step 2), the accuracy expectations from §2.2, and the structural-safety disclaimer from §1.3.
Acceptance: code review / `test/pwa.test.js › help content` greps the help source for "structural engineer", "±2 cm", "GLB".

**REQ-062 Usability on iPhone — MUST**
- Layouts for 375–440 CSS px width portrait and landscape; no horizontal page scroll; respects `env(safe-area-inset-*)`.
- Tap targets ≥ 44 × 44 CSS px; form inputs font-size ≥ 16 px (prevents iOS focus zoom); numeric inputs use `inputmode="decimal"`.
- Bottom tab bar: **Projects · 3D · Plan · Views · Terrain**; toolbar actions with icon + text label.
- Contrast ≥ 4.5:1 for text (WCAG 2.2 AA); all buttons have accessible names; supports light and dark mode for app chrome (drawings always on white).
- Long operations (> 300 ms) show a progress/spinner and never block input for > 200 ms on the main thread (heavy geometry in a Worker).
Acceptance: smoke test at 390×844 viewport asserts `document.documentElement.scrollWidth <= 390`, every `button` has non-empty accessible name and bounding box ≥ 44×44; CSS review for `font-size` on inputs.

**REQ-063 Undo/redo — SHOULD**
Undo/redo for orientation changes, calibration and all markup (≥ 50 steps per session).

**REQ-064 Update notification — SHOULD**
When a new service-worker version is installed, show a banner "Update available — Reload"; never auto-reload during editing.

---

## 5. Non-functional requirements

**REQ-070 No backend / zero running cost — MUST.** Static files only, hosted on GitHub Pages (HTTPS, free). No server code, no accounts, no API keys, no analytics, no third-party requests at runtime. Acceptance: code review + REQ-013 smoke test; `grep -R "https\?://" src/ index.html sw.js` finds only comments/docs links.

**REQ-071 Service worker and offline — MUST.** `sw.js` precaches every app file (list generated by a script `tools/gen-precache.mjs` into `src/precache-list.js`, or hand-maintained and verified by test) with cache name `scan2plan-v<APP_VERSION>`; cache-first for app assets; old caches deleted on `activate`; app calls `registration.update()` at launch. Acceptance: `test/pwa.test.js › precache complete` asserts every file under `src/`, `vendor/`, `icons/`, `index.html`, `manifest.webmanifest` is in the precache list; smoke test offline reload works (REQ-090).

**REQ-072 Dependencies vendored, minimal — MUST.** Runtime dependencies: **three.js r187 only** (`vendor/three/three.module.min.js` and the addons `GLTFLoader`, `OBJLoader`, `PLYLoader`, `GLTFExporter`, `OrbitControls`, `BufferGeometryUtils`; `USDLoader` only if REQ-007). Loaded via an `<script type="importmap">` mapping `three` and `three/addons/` to `./vendor/...`. No CDN. License files copied into `vendor/`. Dev-only (tests): `fake-indexeddb`, `@xmldom/xmldom`, optionally `dxf-parser`, `playwright`. Acceptance: `package.json` has no `dependencies` (only `devDependencies`); `vendor/three/VERSION` contains `0.187.0`.

**REQ-073 No build step — MUST.** Plain ES modules (ES2022), served as-is. Justification: zero build tooling to maintain, the repo can be edited and deployed from any machine (or GitHub's web editor) without Node, and the GitHub Pages deploy is a plain push. The only tooling is optional Node scripts for tests and the precache list. JSDoc type comments are encouraged; no TypeScript compilation.

**REQ-074 Code structure — MUST.**
```
index.html, manifest.webmanifest, sw.js, icons/
src/app/      UI (views, controls, DOM)          – browser only
src/core/     geometry: import parsers glue, slice, orient, decimate, raster, terrain, dims – pure, Node-testable
src/export/   svg.js, pdf.js, dxf.js, glb.js, share.js
src/store/    idb.js, project.js, annotations.js
src/worker/   geometry.worker.js (wraps src/core)
vendor/three/ test/ tools/ docs/
```
Files ≤ 600 lines each; `src/core` has no imports from `src/app` or DOM globals.

**REQ-075 Performance budgets — MUST** (reference device iPhone 15 Pro, iOS 26/Safari; QA checks Node proxies in CI and the owner checks on device)

| Operation | Budget |
|---|---|
| Cold start (cached) to interactive project list | ≤ 2 s |
| Import 50 MB GLB / 1 M triangles incl. orientation | ≤ 10 s |
| Import 300k-triangle GLB incl. orientation | ≤ 4 s |
| 3D view frame rate with ≤ 500k display triangles | ≥ 30 fps |
| Plan section (1 M tris) | ≤ 1.5 s (Node CI: ≤ 1.5 s) |
| Elevation raster (1 M tris, 1024×768 px) | ≤ 3 s |
| Terrain volume (100 m², 5 cm cells) | ≤ 1 s |
| PDF/SVG/DXF generation | ≤ 2 s |
| Peak memory (2 M triangle input) | ≤ 800 MB estimated (positions+indices+display copy+GPU) — full-res arrays transferred (not copied) between worker and main thread |

Acceptance: `test/perf.test.js` covers the Node-measurable rows with synthetic meshes (thresholds ×1.0 on CI); device rows go to the owner checklist in §9.

**REQ-076 Privacy — MUST.** Scan data never leaves the device except via user-initiated share. No `localStorage` of scan data (IndexedDB only).

**REQ-077 Browser support — MUST.** iOS/iPadOS Safari 17+ (home-screen mode is the target); also works in current desktop Chrome/Firefox/Safari for testing. Requires WebGL2; without it show "This device does not support WebGL2."

---

## 6. Test strategy

- **Unit tests (MUST):** `node --test test/` on Node 22, no browser. Cover all `src/core` and `src/export` logic with synthetic fixtures generated in code (seeded RNG `mulberry32(42)` for noise). Each acceptance test named in §7 exists as a `test()` with exactly that name (`file › name`).
- **Smoke test (SHOULD, REQ-090):** `test/smoke/smoke.spec.mjs` with Playwright **WebKit** at iPhone 14 viewport (390×844, `isMobile`, `hasTouch`): serve repo with a static server, load, wait for SW `ready`, go offline, reload, import `test/fixtures/room.glb` (generated by `tools/make-fixtures.mjs`), open Plan, assert an SVG/canvas outline exists and dimension text "400" is visible, export SVG (intercept share/download), assert zero failed network requests.
- **Device checklist (owner, §9):** manual steps on the real iPhone.
- **Coverage target:** ≥ 80 % lines in `src/core` and `src/export` (`node --test --experimental-test-coverage`).

**REQ-090 Headless smoke test — SHOULD.** As described above. Acceptance: `npx playwright test` passes locally (QA may skip if WebKit cannot be installed, but must report it).

---

## 7. Traceability

| REQ | Priority | Acceptance test(s) |
|---|---|---|
| REQ-001 | MUST | import.test.js › glb box roundtrip; › glb two nodes; › draco required |
| REQ-002 | MUST | import.test.js › obj quad and negative indices; › obj groups merged |
| REQ-003 | MUST | import.test.js › ply mesh; › ply points; › ply splat rejected |
| REQ-004 | MUST | import.test.js › error codes; code review constants/accept |
| REQ-005 | MUST | orient.test.js › unit heuristic |
| REQ-006 | COULD | import.test.js › xyz points (if implemented) |
| REQ-007 | COULD | import.test.js › usdz box (if implemented) |
| REQ-010 | MUST | store.test.js › crud; › reopen deep-equal |
| REQ-011 | MUST | code review |
| REQ-012 | MUST | backup.test.js › roundtrip |
| REQ-013 | MUST | smoke › offline; code review no remote URLs |
| REQ-015 | MUST | code review; smoke › orbit |
| REQ-016 | MUST | decimate.test.js › 1M to 500k; › small unchanged |
| REQ-017 | SHOULD | code review |
| REQ-018 | COULD | code review |
| REQ-020 | MUST | orient.test.js › z-up box; › tilted floor; › facade no floor |
| REQ-021 | MUST | orient.test.js › yaw 23deg; › yaw 67deg; › yaw 89.7deg |
| REQ-022 | MUST | slice.test.js › box perimeter; › L-shape; › noise; › performance |
| REQ-022b | SHOULD | slice.test.js › points ring |
| REQ-023 | SHOULD | walls.test.js › double wall |
| REQ-024 | SHOULD | openings.test.js › door and window |
| REQ-025 | MUST | elevation.test.js › box front; › resolution cap |
| REQ-026 | MUST | section.test.js › box section |
| REQ-027 | SHOULD | section.test.js › level label format |
| REQ-028 | MUST | export-svg.test.js › stroke widths; code review |
| REQ-029 | MUST | dims.test.js › box dims; › rounding |
| REQ-030 | MUST | measure.test.js › distance format; code review snapping |
| REQ-031 | MUST | calibrate.test.js › factor; › rescaled perimeter; › warning range |
| REQ-032 | MUST/COULD | export-svg.test.js › scale bar |
| REQ-040 | MUST | markup.test.js › demolition quantities; › svg colors; › undo redo |
| REQ-041 | SHOULD | markup.test.js › bw mode |
| REQ-042 | SHOULD | markup.test.js › csv |
| REQ-045 | MUST | terrain.test.js › heightmap |
| REQ-046 | MUST | terrain.test.js › volume level; › constant depth; › trucks; › coverage |
| REQ-047 | SHOULD | section.test.js › excavation hatch |
| REQ-048 | COULD | terrain.test.js › slope offset (if implemented) |
| REQ-050 | MUST | export-util.test.js › filename; code review share fallback |
| REQ-051 | MUST | export-svg.test.js › box plan 1:50; › well-formed |
| REQ-052 | MUST | export-pdf.test.js › structure; › scale 1:100; › fit |
| REQ-053 | MUST | export-svg.test.js › title block |
| REQ-054 | MUST | export-dxf.test.js › box polyline; › layers |
| REQ-055 | MUST | export-glb.test.js › roundtrip bbox |
| REQ-056 | COULD | code review |
| REQ-060 | MUST | pwa.test.js › manifest; › icons; › relative paths |
| REQ-061 | MUST | pwa.test.js › help content |
| REQ-062 | MUST | smoke › layout 390; CSS review |
| REQ-063 | SHOULD | markup.test.js › undo redo |
| REQ-064 | SHOULD | code review |
| REQ-070 | MUST | code review grep; smoke › offline |
| REQ-071 | MUST | pwa.test.js › precache complete; smoke › offline |
| REQ-072 | MUST | pwa.test.js › vendor version; code review package.json |
| REQ-073 | MUST | code review |
| REQ-074 | MUST | code review (core has no DOM imports — `test/structure.test.js › core is pure`) |
| REQ-075 | MUST | perf.test.js; owner device checklist |
| REQ-076 | MUST | code review |
| REQ-077 | MUST | code review WebGL2 check |
| REQ-090 | SHOULD | smoke.spec.mjs |

Counts: **MUST 41**, **SHOULD 11**, **COULD 5** (57 total) (REQ-032 counted as MUST; its north-arrow part is COULD).

---

## 8. Scanning guide (for the in-app Help screen)

**Before you scan**
- Use **Scaniverse** (free). Keep **LiDAR enabled** (do not switch on "Ignore LiDAR"). Use the *Classic* experience; no account needed.
- Put a **reference of known length** in view: an unfolded 2 m folding rule, or measure a door opening or wall with a tape measure and note it. You will enter it in Scan2Plan → *Calibrate scale*. This is what gets you to ±1–2 cm.
- Turn on all room lights, open curtains. Remove or cover large mirrors; LiDAR and tracking struggle with glass, mirrors, glossy tiles and black surfaces.
- Clear the floor along walls if you want clean wall lines at 1 m height.

**Rooms (interior)**
- One room per scan (≤ ~ 6 × 6 m). For two adjoining rooms, scan through the open door in one continuous scan so the wall thickness becomes visible.
- Walk slowly (≈ 0.5 m/s), phone 1–2 m from the walls. LiDAR range is about **5 m** — stay closer than that to every surface.
- Sweep each wall bottom-to-top, include floor and ceiling edges and every corner. Finish where you started (closing the loop reduces drift).
- Scan door and window reveals from an angle so their depth is captured.

**Facades (exterior)**
- Scan in overcast daylight or dusk; bright sun reduces LiDAR range.
- Walk parallel to the facade at 2–4 m distance. Upper floors beyond ~ 5 m will be incomplete or less accurate; expect ±3–5 cm.
- Measure one long distance on the facade (e.g. window-to-window or the corner-to-corner base length) for calibration.

**Terrain / excavation**
- Mark the area corners with stakes or spray paint so you can find them in the scan.
- Walk a grid pattern (lines 2–3 m apart), phone pointed down at ~45°. Cover 1 m beyond the planned excavation edge.
- Mark a **height reference** (e.g. the finished floor level at the door threshold) and include it — you will tap it as ±0.00.
- Avoid tall grass and water puddles; they produce false surfaces.

**Export**
- In Scaniverse: open the scan → *Share/Export* → *Mesh* → **GLB** → *Save to Files*. Then open Scan2Plan → *Import scan*.

**Accuracy to expect:** rooms ±1–2 cm after calibration; facades and terrain ±3–5 cm. Always verify critical dimensions with a tape measure before ordering materials or starting work. Removing walls can affect the structure of your house — consult a structural engineer (Tragwerksplaner) and check whether a building permit is required.

---

## 9. Owner device acceptance checklist (iPhone)

1. Open the GitHub Pages URL in Safari → Share → Add to Home Screen → icon appears; launch opens standalone (no Safari UI).
2. Airplane mode on → app launches and lists projects.
3. Import a Scaniverse GLB of one room (≤ 300k triangles) in ≤ 4 s; floor is horizontal, walls aligned.
4. Calibrate on a 100.0 cm folding-rule segment; re-measure a tape-measured wall: deviation ≤ 2 cm.
5. Plan at 1.00 m shows closed outline with dimensions; mark one wall as demolition, draw one 11.5 cm new wall.
6. Export PDF A4 1:50 → Save to Files → print at 100 % → a 4.00 m wall measures 80 mm on paper ± 0.5 mm.
7. Export DXF → opens in a free CAD viewer (e.g. QCAD / LibreCAD) with correct layers and meters.
8. Terrain scan: polygon + target level → volume shown; compare to hand estimate.
9. Kill the app, reopen → project and markup intact.

---

## 10. Open questions and assumptions (owner please confirm)

1. **Scanner app:** Primary Scaniverse (free GLB export verified via store listing, Oct 2026). Fallback 3d Scanner App — **please check on your iPhone that GLB or OBJ export works without a subscription**; if not, Polycam free (glTF only, but scans are shared via public links) is the second fallback.
2. **Scaniverse exports in meters, +Y up** — assumed (glTF mandates it; ARKit works in meters). Calibration (REQ-031) covers residual scale error.
3. **Accuracy:** ±1–2 cm is realistic for single rooms *with calibration*; facades/terrain ±3–5 cm per published tests. Accept?
4. **Section height default 1.00 m** above ±0.00 (German convention places the plan cut at ~1.00 m to show windows). OK?
5. **Colors** Existing black/grey, Demolition yellow dashed, New red — common German practice but not mandated; your Bauamt may want B/W (REQ-041). OK?
6. **One scan = one project** in MVP; merging multiple rooms into one floor plan is "later". Is this acceptable, or is multi-room merging needed early?
7. **Bulking factor 1.25 and truck 10 m³** as defaults for soil removal — adjust to your contractor's figures.
8. **iOS version:** assumed iOS 17 or newer (needed for current storage quotas). Please confirm your iOS version.
9. **Hosting:** GitHub Pages under your GitHub account (free; repository can be public — no scan data is ever in it). Do you have a GitHub account?
10. **Dimension text in integer cm** ("345") on plans; tap-measure in cm with 1 decimal. OK, or prefer meters ("3.45")?

---

## 11. Sources

- Scaniverse App Store (DE), formats & version: https://apps.apple.com/DE/app/id1541433223
- Scaniverse Classic FAQ (free, on-device): https://www.nianticspatial.com/faq/scaniverse-classic
- Scaniverse export formats: https://community.scaniverse.com/t/which-formats-can-scaniverse-export-to/50
- Scaniverse 2026 platform update: https://radiancefields.com/niantic-releases-major-scaniverse-update
- Polycam vs Scaniverse 2026: https://www.skyebrowse.com/news/posts/polycam-vs-scaniverse.md
- Polycam export formats by plan: https://learn.poly.cam/hc/en-us/articles/27756102599572
- Polycam review 2026: https://www.skyebrowse.com/news/posts/polycam-review.md
- 3d Scanner App listing: https://apps.apple.com/us/app/-/id1419913995 , https://apps.appfollow.io/ios/3d-scanner-apptm/1419913995?country=us
- RoomPlan – Interior 3D Scanner: https://apps.apple.com/app/id1658425563
- iPhone LiDAR accuracy (EGU26-2752): https://meetingorganizer.copernicus.org/EGU26/EGU26-2752.html
- iPhone LiDAR / Scaniverse accuracy (Geodetski vestnik 2026): https://geodetski-vestnik.com/en/clanek/10.15292/geodetski-vestnik.2026.01.47-61
- WebKit storage policy: https://webkit.org/?p=14403
- PWA iOS limitations (2026, partly outdated storage claims): https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- WebKit bug 275288 (downloads in installed PWA): https://lists.webkit.org/pipermail/webkit-unassigned/2024-June/1169406.html
- Web Share API: https://web.dev/articles/web-share
- three.js USDLoader docs: https://threejs.org/docs/pages/USDLoader.html
- three.js npm version 0.187.0 (npm registry, 2026-10-30)
- glTF 2.0 spec (meters, +Y up): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- German plan colours (practice): https://bau.net/forum/planung/11676.php
