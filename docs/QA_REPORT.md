# Scan2Plan — QA report

QA agent · 2026-11-15 · commit under test `5e2ef95` · spec `docs/REQUIREMENTS.md` v1.0

## 1. Verdict

**Not ready to release as-is. Two BLOCKERs must be fixed first. Both are small, local fixes.**

The geometry core is strong. Slicing, dimensions, elevations, sections, terrain volumes and the
SVG/PDF/DXF writers held up under every adversarial test I wrote. That includes analytic pyramid
volumes, holey and non-manifold meshes, rotated rooms, and independent parsers (`dxf-parser`,
`qpdf --check`, expat). Offline operation, the share flow, layout at four iPhone sizes and XSS
hardening all pass in the browser.

The defects that matter are about data integrity and real-world input, not the maths:

- **DEF-01 (BLOCKER).** Restoring a backup of a *calibrated* project applies the calibration a
  second time after the first save and reopen. All dimensions are then wrong by the calibration
  factor, and the title block still says "calibrated".
- **DEF-02 (BLOCKER).** Starting a second import while a project is open, then cancelling it,
  leaves the open project drawing (and backing up) the *other* scan.
- **DEF-03 / DEF-04 / DEF-05 (MAJOR).** These cause wrong orientation or geometry on realistic
  scans that the spec fixtures do not cover:
  - OBJ/PLY bathrooms, WCs, corridors and rooms with a partly scanned floor tip over or flip.
  - A bed or sofa tilts the levelled floor by 1–4°.
  - Georeferenced coordinates are quantised to 0.5 m.

After DEF-01 and DEF-02 are fixed (and ideally DEF-03 and DEF-04), the build is ready for the
owner's device acceptance checklist (§7).

**Counts (57 REQ ids):** PASS **49** · PARTIAL **4** · FAIL **1** · not implemented **3**
(all COULD, so not counted as failures).
**Defects:** 2 BLOCKER · 3 MAJOR · 13 MINOR.

Status rule used in §4: a requirement is PARTIAL when a stated part of it is missing or a MAJOR
defect breaks behaviour its text describes. It is FAIL when a BLOCKER breaks it. Robustness
defects outside the requirement's text (e.g. georeferenced input) are listed in §5 but do not
change the status.

## 2. What was run

| Item | Result |
|---|---|
| `npm test` (coder's suite, Node 22.23) | 81/81 pass, 9 s |
| `npm run test:qa` (new QA suite, `test/qa/*.test.js`) | 51 tests: 37 pass, 14 `todo` = confirmed open defects, 0 unexpected failures |
| Playwright smoke `test/smoke/smoke.spec.mjs` | **WebKit could not be installed.** The egress proxy returns 403 for every Playwright browser host (`playwright.download.prss.microsoft.com`, `cdn.playwright.dev`, `playwright*.azureedge.net`). Ran with the installed Google Chrome (`S2P_BROWSER=chrome`): 1/1 pass |
| QA Playwright `npm run smoke:qa` (`test/qa/qa-ui.spec.mjs`, Chrome) | 8/8 pass (DEF-02 test is `test.fail`-marked and fails for the documented reason: Room A's plan shows four "600" dimensions from the cancelled 6×5 m scan) |
| Coverage `src/core` + `src/export` | Aggregate ≥ 80 % lines (meets §6). Lowest file: `core/drawing.js` 77 % (elevation and terrain builders were untested; QA test added) |
| `npm run precache / fixtures / icons` | Deterministic, no diff |
| Vendored three.js | Byte-identical to npm `three@0.187.0`. Confirmed that npm ships **no** `three.module.min.js`, so the coder's REQ-072 deviation is justified |
| WCAG contrast of all CSS colour tokens (light and dark) | All ≥ 4.5:1 (lowest 6.29:1) |

Node performance proxies (real worker module, `src/worker/geometry.worker.js`, loaded with a
`self` shim):

| Operation | Node 22 | Device budget |
|---|---|---|
| 300k-triangle GLB: load + auto-orient | 0.29 s | ≤ 4 s |
| 1.2 M-triangle GLB: load + display decimation + orient | 1.5 s | ≤ 10 s |
| Worker `plan` op at 1 M triangles (cut + 1.00 m + 0.30 m + 0.05 m slices, walls, openings) | 73 ms | ≤ 1.5 s |

The coder's 1.5 s test timed only a single `slicePolylines` call. I measured the real worker op,
which slices up to four times, and it is still well within budget.

### Disputed numbers, recomputed

- **REQ-030 "317.0 cm" vs "321.6 cm".** The distance from (0,0,0) to (3, 0.583, 1) is
  √(9 + 0.339889 + 1) = √10.339889 = 3.21557 m, i.e. **"321.6 cm"**. The components are
  Δh = √10 = 3.16228 m → "316.2 cm" and Δv = "58.3 cm". **The coder is right.** The spec value is
  an arithmetic slip; no simple variant of the inputs gives 317.0 (e.g. (3, 0.583, 0) → 305.6).
  The spec should be corrected.
- **REQ-005 diagonal vs longest side.** box(400,300,250) has diagonal √312 500 = **559.0 > 500**,
  so the literal diagonal rule suggests ×0.001, while the acceptance case expects ×0.01. The spec
  contradicts itself. The coder's longest-side rule meets all three acceptance cases. **The coder
  is right; accept.** Side effect: an OBJ/PLY scan in metres longer than 50 m triggers the
  "centimetres?" prompt. The user can decline it (`qa-import › REQ-005 diagonal vs longest side`).

## 3. Judgement of the coder's declared deviations (IMPLEMENTATION_NOTES.md)

| Note | Judgement |
|---|---|
| `node --test test/*.test.js` instead of `test/` | Accept (Node 22 behaviour verified). |
| REQ-090 WebKit not run | Accept as an environment limit (reproduced). The coder's smoke checks 44 px buttons only on the Projects screen and merges "offline/orbit/layout 390" into one test (DEF-10). QA extended the layout checks to every tab at 4 sizes, and they pass. |
| REQ-072 no min build; loaders vendored but unused | Accept. Verified. The unused loaders add 220 KB to the precache, which the spec mandates. |
| In-repo parsers instead of three.js loaders | Accept. Consistent with the pure-core rule (REQ-074) and cross-checked against three.js loaders in tests. |
| `precache-list.js` classic script | Accept. |
| REQ-005 longest side | Accept (see §2). |
| REQ-020 tie rule ±5 %, abs-normal fallback | **Reject as sufficient.** It makes the spec's closed-box fixtures pass but fails on real interior scans (DEF-03). The spec's own algorithm has the same flaw. |
| REQ-022 joining open chains | Accept. |
| REQ-022b double loops for point clouds | Accept. |
| REQ-023 single-sided walls at 0.5 mm, not 0.35 mm | Accept. Real spec conflict with the REQ-028/REQ-051 acceptance tests. Spec should be clarified. |
| REQ-026 infinite cut plane; side chosen by dialog | Accept (the acceptance test requires the infinite plane). |
| REQ-030 "321.6 cm" | Accept (coder correct). "Measurements in Views cannot be saved": **reject** (DEF-09). |
| REQ-012/055 textures not exported | **Reject (minor).** Restoring a backup of a textured Scaniverse scan (usually texture-only, no vertex colours) gives a grey model (DEF-18). |
| REQ-050 always two-step share; skip `<a download>` in standalone | Accept. |
| REQ-052 "does not fit A4 at 1:500" wording | Accept. |
| REQ-054 LF, text sized for 1:50 | Accept. |
| REQ-004 GLB progress is stage-only | Accept. The bar animates (indeterminate) and the label updates every 250 ms; confirm on device. |
| REQ-064 waits for user tap | Accept. |

## 4. Requirement-by-requirement

Evidence = test name (coder's suite unless prefixed `qa-`), or file:line for code review.

| REQ | Pri | Status | Evidence / notes |
|---|---|---|---|
| REQ-001 GLB/glTF | MUST | PASS | `import › glb box roundtrip`, `› glb two nodes`, `› draco required`, `› gltf json with embedded buffer`. Only the first texture is kept (declared). Georeferenced node translation loses precision → DEF-05 |
| REQ-002 OBJ | MUST | PASS | `import › obj quad and negative indices`, `› obj groups merged`, `parsers agree with three.js loaders`. DEF-05, DEF-16 |
| REQ-003 PLY / splat reject | MUST | PASS | `import › ply mesh/points/splat rejected`. `qa-import › real Scaniverse/3DGS splat PLY layout` → E-IMP-03. Compressed splat → DEF-15 |
| REQ-004 limits, worker, errors | MUST | PARTIAL | Constants and messages exact (`core/errors.js:7-25`), no `accept` attribute (`projects-view.js:38`), cancel = `terminate()` (`geometry-client.js:48`), `qa-import › truncated/corrupt inputs`, `qa-ui › splat PLY shows E-IMP-03 and nothing is stored`. **DEF-02** breaks "all errors keep the app usable" when a project is open |
| REQ-005 unit plausibility | MUST | PASS | `orient › unit heuristic`. Longest-side deviation accepted (§2) |
| REQ-006 XYZ | COULD | PASS | `import › xyz points` |
| REQ-007 USDZ | COULD | not impl. | Declared |
| REQ-010 IndexedDB projects | MUST | PASS | `store › crud`, `› reopen deep-equal`. Versioned schema (`idb.js:14`), auto-save 800 ms (`session.js`), thumbnail 256² ≤ 30 KB (`viewer3d.js` `captureThumbnail`), rename/duplicate/delete with confirm |
| REQ-011 persist + usage | MUST | PASS | `projects-view.js:126-135`: `persist()` only after a successful import; estimate and persisted state shown in Settings; exact warning text |
| REQ-012 backup/restore | MUST | **FAIL** | Coder's `backup › roundtrip` passes, but **DEF-01**: restored calibrated projects get the calibration applied twice after the first save + reopen (`qa-worker-session › restored calibrated backup keeps its size`). Also DEF-12, DEF-18 |
| REQ-013 offline | MUST | PASS | Smoke (Chrome) offline reload + import + plan + SVG with zero failed requests. `qa-ui › every export format and Backup work offline` (PDF/SVG/DXF/GLB/CSV, Views PDF, Terrain PDF, Backup). `structure › no remote URLs`; QA grep found no fetch/XHR/CDN/analytics in `src/` (only `sw.js:28` same-origin fall-through) |
| REQ-015 3D touch navigation | MUST | PASS | `viewer3d.js:43` ONE=ROTATE / TWO=DOLLY_PAN, double-tap focus, 6 presets + Persp/Ortho, axis gizmo, 1 m / 0.1 m grid, `min(dpr,2)`. Smoke orbit check |
| REQ-016 display decimation | MUST | PASS | `decimate › 1M to 500k`, `› small unchanged`. All measurements use `S.world` in the worker |
| REQ-017 rendering modes | SHOULD | PASS | Colour/grey/wire/X-ray, 6 clip sliders, red section line (`viewer3d.js` `displaySheet`, `updateSectionLine`) |
| REQ-018 markup in 3D | COULD | not impl. | Declared |
| REQ-020 levelling / up axis | MUST | PARTIAL | Acceptance tests pass (`orient › z-up box`, `› tilted floor`, `› facade no floor`; `qa-orient › Z-up OBJ of a normal room`). **DEF-03** (wrong axis for small/narrow rooms or partial floors) and **DEF-04** (furniture tilts the floor) |
| REQ-021 yaw | MUST | PASS | `orient › yaw 23/67/89.7deg`; `qa-orient › rotated 30° and tilted 1.5°` |
| REQ-022 plan section | MUST | PASS | `slice › box perimeter`, `› L-shape`, `› noise`, `› performance`; `qa-geometry` rotated / holey / non-manifold / degenerate / on-plane; `qa-worker-session › plan update via worker` 73 ms |
| REQ-022b point slice | SHOULD | PASS | `slice › points ring` |
| REQ-023 wall poche | SHOULD | PASS | `walls › double wall`. 0.5 vs 0.35 mm accepted (spec conflict) |
| REQ-024 openings | SHOULD | PASS | `openings › door and window`; `qa-geometry › wall slightly rotated still finds the door` |
| REQ-025 elevations | MUST | PASS | `elevation › box front`, `› resolution cap`; `qa-geometry › elevation and terrain drawings build` (±0.00 and +2.50 labels) |
| REQ-026 vertical section | MUST | PASS | `section › box section`; A–Z limit (`session.js` `nextSectionLabel`), depth 0–20 m |
| REQ-027 level markers | SHOULD | PASS | `section › level label format`; Views "Level" tool |
| REQ-028 boundaries | MUST | PASS | `export-svg › stroke widths`; `styles.js:5-6`; screen width = mm×4 → cut 2 px (`svg.js` `screenWidthPx`); pinch/pan/Fit |
| REQ-029 dimensions | MUST | PASS | `dims › box dims`, `› rounding`; `qa-geometry › rotated room` segment dims 300/300/400/400 |
| REQ-030 tap-to-measure | MUST | PARTIAL | `measure › distance format` ("321.6 cm" is correct, §2), snap constants. **DEF-09**: Views measurements cannot be saved; 300 ms raycast not measured (device) |
| REQ-031 calibration | MUST | PASS | `calibrate › factor/rescaled perimeter/warning range`; `qa-worker-session › calibrating twice multiplies; Reset scale restores ×1 through Session`. Related: DEF-01, DEF-06 |
| REQ-032 scale bar | MUST | PASS | `export-svg › scale bar` (all scales 40–100 mm). North arrow (COULD) not implemented |
| REQ-040 markup | MUST | PASS | `markup › demolition quantities`, `› svg colors`, `› undo redo` (100 steps); legend on exports with markup |
| REQ-041 B/W | SHOULD | PASS | `markup › bw mode` |
| REQ-042 markup list / CSV | SHOULD | PASS | `markup › csv` (BOM, `;`, decimal comma, totals) |
| REQ-045 terrain view | MUST | PASS | `terrain › heightmap`; missing cells transparent and counted |
| REQ-046 excavation | MUST | PASS | `terrain › volume level/constant depth/trucks/coverage`; `qa-geometry › pyramid heap V = a²h/3` (±0.15 m³ of 32.0), `› diamond polygon`, `› polygon half outside` (coverage 50 %, warning) |
| REQ-047 excavation section | SHOULD | PASS | `section › excavation hatch` |
| REQ-048 slopes | COULD | not impl. | DIN 4124 note shown |
| REQ-050 share delivery | MUST | PASS | `export-util › filename`, `› share fallback order`; `share.js` 3-step; standalone skips `<a download>`; generation happens before "Ready — tap Share" |
| REQ-051 SVG | MUST | PASS | `export-svg › box plan 1:50`, `› well-formed`; `qa-export › SVG with images, markup and hostile text`. DEF-17 |
| REQ-052 PDF | MUST | PASS | `export-pdf › structure/scale 1:100/fit`; `qa-export › qpdf --check` (A3 portrait, RGB + grey JPEG, non-WinAnsi text) all clean; exact scale at 1:20 and 1:500. DEF-11 |
| REQ-053 title block | MUST | PASS | `export-svg › title block` |
| REQ-054 DXF | MUST | PASS | `export-dxf › box polyline/layers`; `qa-export › DXF opens in dxf-parser` (8 layers, closed flags, 7.24 m, DASHED, no DIMENSION entities). DEF-07 |
| REQ-055 GLB | MUST | PASS | `export-glb › roundtrip bbox`, `› three.js GLTFLoader reads the export`. DEF-12, DEF-18 |
| REQ-056 PNG | COULD | PASS | 3D "PNG" button |
| REQ-060 PWA manifest/meta | MUST | PASS | `pwa › manifest/icons/relative paths`; install hint when not standalone |
| REQ-061 help | MUST | PASS | `pwa › help content`; §8 present verbatim (reformatted) |
| REQ-062 iPhone usability | MUST | PASS | `qa-ui › layout 390×844, 375×667, 440×956, 844×390`: every tab plus the export dialog has no horizontal scroll, all buttons named and ≥ 44×44, inputs ≥ 16 px. Safe-area insets in CSS; contrast verified (§2). DEF-14 |
| REQ-063 undo/redo | SHOULD | PASS | One 100-step stack covers markup, orientation and calibration. Views has Undo but no Redo button (minor) |
| REQ-064 update banner | SHOULD | PASS | `main.js:77-100` (code review) |
| REQ-070 no backend | MUST | PASS | Grep + smoke |
| REQ-071 SW precache | MUST | PASS | `pwa › precache complete`; offline smoke. DEF-08 |
| REQ-072 vendored deps | MUST | PASS | `pwa › vendor version`; no `dependencies`. Min build absent upstream (verified) |
| REQ-073 no build step | MUST | PASS | Plain ES modules, import map |
| REQ-074 structure | MUST | PASS | `structure › core is pure`, `› file size limit` (max 481 lines) |
| REQ-075 performance | MUST | PASS | Node rows (§2 table and `perf.test.js`). Device rows pending (§7) |
| REQ-076 privacy | MUST | PASS | Only two boolean flags in localStorage (`projects-view.js:21-25`) |
| REQ-077 WebGL2 check | MUST | PASS | `main.js:20-23, 30-33` |
| REQ-090 smoke test | SHOULD | PARTIAL | Passes on Chrome; WebKit not installable here; DEF-10 |

## 5. Defects

Severity: BLOCKER = must fix before release · MAJOR = should fix before the owner relies on the
output · MINOR = fix when convenient. Each defect that can be automated has a QA test that
asserts the *correct* behaviour and is marked `todo` (Node) or `test.fail` (Playwright) until fixed.
Remove the marker when fixing.

**DEF-01 · BLOCKER · REQ-012 / REQ-031 — Restored calibrated backup gets the calibration applied twice.**
- *Repro:* calibrate a project (e.g. ×1.02) → Backup → restore the `.s2p.glb` → make any edit
  (auto-save) → close and reopen the project. All dimensions are now ×1.02 too large: 4.00 m
  shows as 4.08 m, while the title block still says "Scale calibrated ×1.0200".
- *Cause:* `store/backup.js:21-25` keeps `calibration.factor` with an identity transform (scale
  already baked into the mesh). `Session.transform` (`app/session.js:29-30`) rebuilds
  `scale(factor)·orientation`, and `Session.save()` (`session.js:66`) persists it. The next `load`
  applies it to the already scaled mesh.
- *Test:* `qa-worker-session › QA REQ-012/031: a restored calibrated backup keeps its size after save + reopen` (stored scale 1.02, expected 1).
- *Fix:* store the calibration as display-only metadata on restore (e.g.
  `calibration: {factor: 1, refCm, bakedFactor: f}`), or keep `scale` separate from
  `calibration.factor` and compose the transform from `scale`. Add the test to the main suite.

**DEF-02 · BLOCKER · REQ-004 / REQ-010 — Cancelling a second import leaves the open project bound to the other scan.**
- *Repro:* open project A (4×3 m) → Projects → New project → pick another scan (6×5 m) → Cancel
  in the name dialog (or the later `saveProject` fails, e.g. storage full) → Plan of A now shows
  6×5 m dimensions. The 3D view still shows A, so the mismatch is hidden. **Backup of A now writes
  the other scan's mesh with A's annotations**, which is silent data loss. Pressing Cancel during
  parsing restarts an empty worker, so A then fails with "No scan loaded."
- *Cause:* the worker's single state is replaced by `load` (`worker/geometry.worker.js:32`)
  before the user confirms (`projects-view.js:94-108`); the old session is not closed or reloaded.
- *Test:* `qa-ui.spec.mjs › DEF-02` (fails as documented: four "600" texts in Room A's plan).
- *Fix:* call `app.setSession(null)` before starting an import, or re-`load` the open project's
  source on cancel/failure. Better: key worker state by project id and reject calls whose id does
  not match the session.

**DEF-03 · MAJOR · REQ-020 — Up-axis vote for OBJ/PLY tips over small/narrow rooms and flips rooms with a partly scanned floor.**
- *Repro:* a Y-up OBJ interior scan (inward normals, as scanners produce) of a 2×1.5 m bathroom,
  a 1.2×1.0 m WC or a 5×2 m corridor → `chooseUpAxis` returns +Z, so the model is turned 90°.
  A 4×3 m room with 60 % of the floor visible returns −Y (upside down).
- *Cause:* `core/orient.js:40-62`. With inward normals the wall at the low end of a horizontal axis
  counts as "upward-facing" for that axis. Any wall larger than the visible floor (or a ceiling
  larger than it, for −Y) wins. The spec algorithm itself has this flaw; the ±5 % tie rule only
  hides it for the closed-box fixtures.
- *Tests:* `qa-orient › Y-up OBJ of a bathroom/corridor/WC… stays upright`, `› partly scanned floor`.
- *Fix:* default to +Y for OBJ/PLY (ARKit/Scaniverse convention, spec §2.1). Switch axis only on
  strong evidence: e.g. +Y has (almost) no horizontal faces at either extreme while another axis
  has floor *and* ceiling patterns, or require a margin like ≥ 3× the +Y score. Show a one-tap
  "Model looks sideways? Up = …" hint. Also raise this with the spec author.

**DEF-04 · MAJOR · REQ-020 — Low furniture tilts the levelled floor.**
- *Repro:* a room 4×3×2.5 m with a bed top at 0.45 m in one corner → `levelFloor` applies a 1.4° tilt
  (3.7° with a denser mesh) and floor Y = +6 cm. That is ≈ 10–25 cm of height error across the room;
  sections, elevations and terrain levels are all skewed.
- *Cause:* `core/orient.js:76-83` and `fitPlaneNormal`. The least-squares plane is fitted to all
  horizontal faces in the lowest 20 % of the height (0.5 m for a 2.5 m room), which includes beds,
  sofas and steps.
- *Test:* `qa-orient › low furniture (bed top at 0.45 m) must not tilt the floor`.
- *Fix:* fit only faces within ±2–3 cm of the area-weighted median floor height (iterate once:
  median → band → fit → re-median), or use RANSAC on the floor candidates.

**DEF-05 · MAJOR · REQ-001/002/003 — Georeferenced coordinates are silently quantised by Float32.**
- *Repro:* OBJ of a 4.13×3.07 m box at UTM E = 32 500 123.45, N = 5 500 456.78 imports as
  4.00×3.00 m (perimeter 14.00 instead of 14.40). A GLB with node translation (500 123, 0, 5 500 456)
  gives 4.156 m. No warning is shown.
- *Cause:* parsers store parsed doubles straight into `Float32Array` (`parse-obj.js:19`,
  `parse-ply.js:66`, `parse-gltf.js:150`, `import.js:45`). The float32 step size at 5.5·10⁶ is 0.5 m.
- *Tests:* `qa-import › georeferenced OBJ…`, `› GLB with large node translation…`.
- *Fix:* parse into Float64 (or track the first vertex), subtract a per-file origin before the
  Float32 conversion, and keep the offset in the project (for DXF export in world coordinates if
  ever needed).

**DEF-06 · MINOR · REQ-031 — Annotations are not rescaled when the calibration changes.**
Markup, measurements, section lines, level markers and excavation polygons are stored in plan
metres and stay put while the scan rescales about the origin. After a later (re)calibration of
1.3 %, a demolition element 6 m from the origin is 8 cm off its wall, and its length/area keep the
old scale. *Fix:* multiply annotation coordinates by the factor ratio inside the calibration undo
step (scaling is about the origin, so this is exact). *Repro:* draw markup → Calibrate ×1.05 →
markup no longer on the wall line.

**DEF-07 · MINOR · REQ-054 — DXF TEXT values are not sanitised.**
A line break in a note (possible through a restored backup JSON; the UI inputs are single-line)
breaks the group-code/value pairing and makes the file unreadable. `dxfText` (`export/dxf.js:76`)
passes ASCII control characters through. *Test:* `qa-export › DXF stays valid when a markup note
contains a line break`. *Fix:* map `\r\n\t` and other < 0x20 characters to a space.

**DEF-08 · MINOR · REQ-071 — App updates depend on a manual version bump that is easy to miss.**
The cache name comes only from `package.json` version (`sw.js:5`, `precache-list.js`). Changed code
without a bump gives a byte-identical `sw.js` and precache list, so installed apps keep the old
cached files forever (cache-first). Also, `register()` uses the default `updateViaCache: 'imports'`
(`main.js:79`), so the imported `precache-list.js` (the only file whose bytes change) may be served
from the HTTP cache (GitHub Pages `max-age=600`) and delay detection. The README's "upload in the
browser, no install needed" deploy path cannot run `npm run precache`.
*Fix:* add a content hash of all precached files to `precache-list.js` (generated), have a test
fail when it is stale, pass `updateViaCache: 'none'`, and document hand-editing the version for
browser-only deploys.

**DEF-09 · MINOR · REQ-030 — Measurements in Views (sections/elevations) cannot be saved; raycast time not verified.**
REQ-030 requires saving measurements in all views; Views only shows them (`views-view.js:110`). The
< 300 ms raycast on a 500k display mesh (three.js brute force, no BVH) is unmeasured; it goes on the
device checklist. Views also lacks a Redo button.

**DEF-10 · MINOR · REQ-090 / §6 — Smoke test gaps.**
WebKit was never run (environment). The §7 names "offline", "orbit" and "layout 390" are merged into
one test. The 44×44/name check runs only on the Projects screen before any project is open. QA's
`qa-ui.spec.mjs` covers all tabs at 4 sizes and passes. *Fix:* run `npm run smoke` and
`npm run smoke:qa` with WebKit in CI (GitHub Actions can download it) and split the named steps.

**DEF-11 · MINOR · REQ-052 — PDF trailer `/Info` is a direct dictionary.**
PDF 1.4 (ISO 32000 §7.5.5) requires an indirect reference (`pdf.js:125`). qpdf, and probably all
viewers, tolerate it. *Test:* `qa-export › PDF trailer /Info is an indirect reference`. *Fix:* emit
it as object N.

**DEF-12 · MINOR · REQ-012 / REQ-055 — Vertex colours get brighter on every GLB export → import round trip.**
The importer converts glTF linear COLOR_0 to sRGB bytes (`parse-gltf.js` `linearToSrgb`).
`export/glb.js:20` writes those sRGB bytes back as linear, so 128 → 188 after one Backup/restore.
*Test:* `qa-worker-session › vertex colours survive a GLB export → import round trip`. *Fix:*
convert sRGB → linear float (or normalised u8) before export.

**DEF-13 · MINOR · memory — Resources not released.**
- Thumbnail object URLs are created on every list render and never revoked (`projects-view.js:53`).
- 3D overlay spheres/lines and section lines are removed with `Group.clear()` without disposing
  geometry/material (`viewer3d.js:116, 276, 399`), and the wireframe material is never disposed.
- The Views cache (`views-view.js:29`) keeps the RGBA buffer plus a PNG data URL for every elevation
  and section visited, without a bound (up to 4096² px each).

On iOS's tight WebContent memory budget these add up over a long session.

**DEF-14 · MINOR · iOS specifics.**
- Modal sheets use `max-height: 88vh` (`app.css:152`). In Safari (non-standalone) `vh` is the large
  viewport, so sheet bottoms can sit under the toolbar. Use `88dvh` with a `vh` fallback.
- No `webglcontextlost`/`webglcontextrestored` handling: with on-demand rendering, a restored
  context stays blank until the next interaction. Request a render on restore.

**DEF-15 · MINOR · REQ-003 — Compressed splat PLY gives the wrong message.**
SuperSplat/PlayCanvas "compressed PLY" (`element chunk`, `packed_position`…) is reported as E-IMP-07
"no geometry" instead of E-IMP-03 (`parse-ply.js:62`). *Fix:* also treat `packed_*` properties and
an element named `chunk` as splats.

**DEF-16 · MINOR · REQ-004 — Format sniffing reads only the first 64 KB.**
An OBJ whose first `v ` line comes after 64 KB of header (comments, `vt`/`vn` blocks, large
`mtllib` sections) is rejected with E-IMP-01 (`import.js:19`). *Fix:* scan further for text files,
or fall back to the extension when the content is plain text.

**DEF-17 · MINOR · REQ-051 — XML-forbidden control characters are not stripped from SVG text.**
`xmlEscape` (`svg.js:7`) escapes markup characters but keeps U+0001–U+001F. A project name or note
containing one (possible through a crafted or restored backup) yields an SVG that expat/Safari
reject. *Test:* `qa-export › SVG stays well-formed with a control character`.

**DEF-18 · MINOR · REQ-012 / REQ-001 — Backups drop the texture.**
`backup()` calls `exportGlb(mesh, {extras})` without the texture (`projects-view.js:191-193`;
`glb.js:21`). Scaniverse GLBs are usually textured, with no vertex colours, so a restored project
shows a grey model. Geometry and markup are unaffected. *Fix:* pass the decoded texture (or the
original image bytes) to the exporter.

### Code quality and maintainability notes (no defect filed)

- Module boundaries are clean: `src/core` is pure (test-enforced), the worker owns the full-res
  mesh, and exporters share one sheet layout. Largest file 481 lines.
- Errors map to the spec's codes; unexpected exceptions become E-IMP-02/05. The UI shows every
  error in a dialog.
- No XSS sinks with user data. All `innerHTML` uses either escape text (`escapeHtml`, `xmlEscape`)
  or interpolate numbers only. Verified in the browser with a hostile project name
  (`qa-ui › XSS`).
- No runtime network calls, CDN URLs or analytics. SW precache covers every app file; old caches are
  deleted on activate; `registration.update()` runs at launch.
- Dependencies are minimal: runtime is three.js only (vendored); dev dependencies are 5 including
  QA's `dxf-parser`. README steps verified: `npm install`, `npm test`, `npm run coverage`, helper
  scripts, local server, `S2P_BROWSER=chrome npx playwright test`. Nits: the test time is about 9 s,
  not "about 20 s"; see DEF-08 for the browser-only deploy path.
- Duplication is minor (transliteration tables in `dxf.js` and `filename.js`). A few unused helpers
  (`mat4.applyToDir/isIdentity`, `mesh.bboxDiagonal/triangleCount`).

## 6. QA test inventory (committed)

- `test/qa/qa-import.test.js`: empty/whitespace files, real 62-property 3DGS splat, compressed
  splat, USDZ/STL/gzip rejection, truncated and corrupt inputs, degenerate triangles, CRLF PLY,
  REQ-005 recomputation, georeferenced OBJ/GLB, long OBJ headers.
- `test/qa/qa-orient.test.js`: inward-normal interior rooms (normal, bathroom, WC, corridor,
  partial floor), Z-up OBJ, furniture tilt, rotated + tilted room, ceiling-only and floor-only
  meshes, degenerate faces.
- `test/qa/qa-geometry.test.js`: rotated rooms (30°, 2°), holey and non-manifold meshes, on-plane
  vertices, rotated openings, elevation/terrain drawing builders, analytic terrain volumes
  (plane + diamond polygon, pyramid heap and pit), partial coverage, cell limits.
- `test/qa/qa-export.test.js`: DXF via `dxf-parser` (plan, elevation, section, newline note), PDF
  via `qpdf --check` (markup, RGB and grey JPEG, non-WinAnsi text, `/Info`), exact PDF scale at
  1:20 and 1:500, fit, SVG XML validity with images and hostile text, control characters.
- `test/qa/qa-worker-session.test.js`: the real worker module in Node (300k / 1.2 M import timing,
  plan op timing and output, error paths), backup-restore calibration through the real `Session`,
  cumulative calibration and reset, vertex colour round trip.
- `test/qa/qa-ui.spec.mjs` + `playwright.qa.config.mjs`: layout at 4 sizes on every tab and the
  export dialog, XSS, splat error path in the UI, every export format and Backup offline, DEF-02.
- Scripts: `npm run test:qa`, `npm run smoke:qa` (`S2P_BROWSER=chrome` without WebKit).

## 7. Owner checklist: only verifiable on a real iPhone

In addition to spec §9:

1. [ ] **WebKit/Safari overall:** the whole flow in Safari *and* as a Home Screen app (WebKit was
   never run in QA).
2. [ ] **Install and offline:** Add to Home Screen → standalone launch; airplane mode → cold start
   ≤ 2 s; import and plan work offline.
3. [ ] **Files picker:** "New project" opens Files and `.glb`, `.obj`, `.ply` from *On My iPhone*
   and *iCloud Drive* are selectable (not greyed out).
4. [ ] **Import timing:** a Scaniverse GLB of one room (≤ 300k triangles) imports and orients in
   ≤ 4 s; a 1 M-triangle / ~50 MB file in ≤ 10 s; Cancel during import stops within 1 s and the app
   stays usable.
5. [ ] **Large file:** a > 100 MB file shows the warning; the app does not reload ("A problem
   repeatedly occurred") on a ~2 M-triangle scan.
6. [ ] **3D:** ≥ 30 fps orbit on a 500k-triangle model; one-finger orbit, two-finger pan, pinch
   zoom, double-tap focus; taps for Measure respond in < 300 ms (DEF-09).
7. [ ] **Texture:** a textured Scaniverse GLB shows its texture the right way up
   (`createImageBitmap(..., {imageOrientation: 'flipY'})`).
8. [ ] **Orientation:** floor horizontal and walls aligned for your real rooms, especially a
   bathroom or corridor if you ever import OBJ (DEF-03) and rooms with a bed or sofa (DEF-04).
9. [ ] **Calibration:** calibrate on 100.0 cm; re-measure a taped wall, deviation ≤ 2 cm. Then
   Backup → delete → restore → reopen and re-check the same wall (DEF-01 regression).
10. [ ] **Share sheet:** PDF/SVG/DXF/GLB/CSV/Backup each open the iOS share sheet; "Save to Files"
    works; in the Home Screen app the fallback (if share fails) opens the file.
11. [ ] **Printing:** PDF A4 1:50 printed at 100 % → a 4.00 m wall measures 80 mm ± 0.5 mm.
12. [ ] **DXF:** opens in a free CAD viewer with the 8 layers, metres, and DASHED demolition.
13. [ ] **Number inputs:** cut height and calibration accept a German decimal comma ("1,10")
    from the iOS keyboard (`type=number` + `inputmode=decimal`).
14. [ ] **Layout:** notch/Dynamic Island and home-indicator safe areas in portrait and landscape;
    bottom sheets fully visible in Safari (non-standalone) (DEF-14); dark mode.
15. [ ] **Persistence:** `persist()` result shown in Settings; kill the app → reopen → project and
    markup intact; background the app for a while → 3D view is not blank on return (DEF-14).
16. [ ] **Update:** after a new deploy (with a version bump), the "Update available — Reload"
    banner appears and nothing reloads by itself during editing.
