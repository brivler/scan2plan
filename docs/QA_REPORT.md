# Scan2Plan — QA report

QA agent · 2026-11-15 · commit under test `5e2ef95` · spec `docs/REQUIREMENTS.md` v1.0

> **Re-verification (round 2, commit `c4028f3`): see §8.** All 18 round-1 defects verified fixed
> except DEF-10. That one is partly fixed: the WebKit CI job exists but has never run. No
> regressions. 5 new MINOR defects (DEF-20…24). Counts now 53 PASS · 1 PARTIAL · 0 FAIL ·
> 3 not implemented (COULD). **Verdict: go for the owner's iPhone acceptance test (§8.6),
> on condition that the first GitHub Actions run of the WebKit job passes.**
> §1–§7 below are the round-1 report, kept unchanged for traceability.

## 1. Verdict (round 1)

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

---

## 8. Re-verification (round 2)

QA agent · 2026-11-15 · commits under test `ceae9f0`, `892dc74`, `30991de`, `c4028f3` (HEAD `c4028f3`)

### 8.1 What was run

| Item | Result |
|---|---|
| `npm test` (coder suite) | **84/84** pass (3 new coder tests) |
| `npm run test:qa` (round-1 QA suite + new `qa-reverify.test.js`) | **69 tests: 65 pass, 4 `todo`** (= new MINOR DEF-20, DEF-21), 0 failures |
| Smoke `npx playwright test` (Chrome; WebKit still not installable here, the proxy blocks Playwright's download hosts) | **3/3** (now split into `offline`, `orbit`, `layout 390`) |
| `npm run smoke:qa` (round-1 UI spec + new `qa-reverify.spec.mjs`, Chrome) | **14/14** |
| `actionlint` 1.7.12 on both workflows | 0 errors (the shellcheck sub-rule was unavailable) |
| Coverage `src/core` + `src/export` | Unchanged; aggregate ≥ 80 % |

**Were the QA tests weakened?** No. `git diff 4e55cb4..c4028f3 -- test/qa/` shows only the 14
`todo` markers and the one `test.fail` marker removed. No assertion, fixture or tolerance changed.
The coder's own test changes add tests. One assertion changed by design: a restored calibration
is now `{factor: 1, refCm, baked: 1.01}`. The smoke-test split kept every assertion of the old
single test.

### 8.2 Per-defect verification

New adversarial tests are in `test/qa/qa-reverify.test.js` (Node) and
`test/qa/qa-reverify.spec.mjs` (browser).

| DEF | Sev | Status | Evidence |
|---|---|---|---|
| DEF-01 | BLOCKER | **VERIFIED** | Root cause fixed: calibration is stored as `{factor, refCm, baked}` (`store/backup.js`, `Session.setCalibration`), so the transform only ever carries `factor`. New test `DEF-01 r2: calibrate → backup → restore → recalibrate → backup → restore → reopen` passes: stored scale 1, mesh = 4 × 1.02 × 1.01, `baked` accumulates (1.0302), title text correct, markup stays on the wall. `DEF-01 r2: undo … Reset keeps baked info` also passes. |
| DEF-02 | BLOCKER | **VERIFIED** | `restoreOpenSession` reloads the open project whenever an import or open does not end in a new session. Browser tests at every stage: name-prompt Cancel, Cancel while parsing a 1 M-triangle OBJ, parse error (splat), damaged backup (fails after parsing), Cancel while opening another large project. After each, Room A's freshly computed plan shows 400, and **the Backup file's mesh is 4×3 m and named Room A**. New related finding: DEF-22. |
| DEF-03 | MAJOR | **VERIFIED** (with accepted deviation, §8.3) | Bathroom, WC, corridor and 60 % floor cases now pass. Typical German rooms 2.40–2.80 m: **0 of 6,630** sizes wrong. Residual limits: DEF-20. |
| DEF-04 | MAJOR | **VERIFIED** for the reported case | Bed 0.45 m: 0.00°. Furniture on 40 % of the floor, 30 % at 0.75 m, sloped floors of 3° and 4.5° with furniture, ±8 mm noise, 17 cm step: tilt correct within 0.05°, floor within 1 cm. Residual limits: DEF-21. |
| DEF-05 | MAJOR | **VERIFIED** | Float64 parsing plus whole-metre re-centring beyond ±10 km. New tests: UTM OBJ → plan → DXF (true 4.13 × 3.07 m, local coordinates < 100 m); binary-double PLY gives the same origin on re-import (reopen is deterministic); UTM terrain excavation 6.00 m³ (analytic) with 100 % coverage. Note: exports are in the shifted local frame, and `origin` is not written into backups. Acceptable, since the spec requires no world coordinates. |
| DEF-06 | MINOR | VERIFIED | `scaleAnnotations` runs inside the same undo step; checked in the DEF-01 chain test (markup follows two calibrations and restores). Scanned heights scale; entered thickness and excavation levels do not (correct). |
| DEF-07 | MINOR | VERIFIED | `qa-export › DXF stays valid when a markup note contains a line break` |
| DEF-08 | MINOR | VERIFIED | `S2P_BUILD` content hash in the cache name; `pwa › precache complete` fails when stale; `updateViaCache: 'none'`; Pages workflow regenerates the list. Workflow notes: DEF-24. |
| DEF-09 | MINOR | VERIFIED | Views has Save for measurements (drawn and exported, `section › saved view measurements appear in the drawing`) and a Redo button. The 300 ms raycast stays on the device checklist. |
| DEF-10 | MINOR | **PARTLY FIXED / not verifiable here** | Smoke test split into the §7 names; `layout 390` covers every tab. The WebKit job is in `ci.yml` but has never run. Confirm with the first GitHub Actions run. |
| DEF-11 | MINOR | VERIFIED | `qa-export › /Info is an indirect reference`; `qpdf --check` clean |
| DEF-12 | MINOR | VERIFIED | `qa-worker-session › vertex colours survive a GLB round trip` (128 → 128) |
| DEF-13 | MINOR | VERIFIED (code review) | Thumbnail URLs revoked; overlay, section-line and wire geometry/materials disposed; Views cache is an LRU of 3 |
| DEF-14 | MINOR | VERIFIED (code review; device check) | `88dvh` with `88vh` fallback; context-loss `preventDefault` and redraw on restore |
| DEF-15 | MINOR | VERIFIED | `qa-import › compressed splat PLY → E-IMP-03` |
| DEF-16 | MINOR | VERIFIED | `qa-import › OBJ with long comment header` |
| DEF-17 | MINOR | VERIFIED | `qa-export › control character` |
| DEF-18 | MINOR | VERIFIED | Browser test `DEF-18 r2`: a textured GLB is backed up with texture and UVs, and the backup restores through the UI. Note: the texture is re-encoded as JPEG on every backup (some generational quality loss), and decoding a 4096² texture on iPhone needs about 64 MB transiently. Added to the device checklist. |

**Regressions:** none found. All 84 coder and 69 QA Node tests pass, as do all 17 browser tests.
I re-swept the full requirements table (§8.4).

### 8.3 Judgement: new REQ-020 algorithm and the tall-room limitation

The coder replaced the spec's up-axis vote with a prior: default +Y, and switch only to an axis
whose extent is a *clearly more typical storey height* (≥ 0.3 m closer to 2.5 m). Floor
detection now uses the height mode with an inlier refit. I quantified the new rule on 1 m–6 m
rooms in 0.1 m steps (inward normals):

| Case (OBJ/PLY only; GLB is always +Y) | Wrong up axis | Hint shown? |
|---|---|---|
| Y-up, ceiling 2.40–2.80 m (German new builds, typical post-war stock) | **0 %** (0/6,630) | n/a |
| Y-up Altbau, ceiling 3.00 m | 11.3 % of sizes (a side of 2.3–2.7 m) | yes, 6 s toast |
| Y-up Altbau, ceiling 3.20 m | 25.3 % | yes |
| Y-up Altbau, ceiling 3.50 m | 44.1 % | yes |
| Y-up, ceiling not scanned (walls only to 2.0 m) | 11.3 % | yes |
| Floor visible on ≤ 30 % of its area (3× rule) | flips to −Y | yes |
| **Z-up** OBJ (from desktop tools), side 2.2–2.8 m | 25.2 % stay sideways | **no** (axis stays +Y) |
| Y-up **facade** OBJ, 6 m tall with a 3 m ground strip | turned sideways | yes |

**Judgement: acceptable for release.** Reasons:

1. The spec's own algorithm is demonstrably wrong for interior scans (round 1), so a deviation
   is necessary. This one is well-reasoned and documented.
2. The primary path (Scaniverse GLB, §3 workflow) never uses it.
3. For typical German ceiling heights, the error rate on OBJ/PLY is zero.
4. The failure is obvious in the 3D view, and *Orient → Up = …* fixes it in one tap. Except for
   Z-up and facade inputs, a hint names the detected axis.

Altbau is common in Germany, so the owner should use GLB (as the help already recommends).

Residual items worth fixing in a later release are filed as DEF-20 and DEF-21. The spec author
should replace the REQ-020 up-axis paragraph with the implemented rule.

### 8.4 Requirement table, round 2 (changes only; all other rows unchanged from §4)

| REQ | Round 1 | Round 2 | Reason |
|---|---|---|---|
| REQ-004 | PARTIAL | **PASS** | DEF-02 verified. DEF-22 is minor: state stays consistent. |
| REQ-012 | FAIL | **PASS** | DEF-01 and DEF-18 verified |
| REQ-020 | PARTIAL | **PASS** (accepted deviation, §8.3) | DEF-03 and DEF-04 verified; acceptance tests pass; residual DEF-20, 21, 23 are minor |
| REQ-030 | PARTIAL | **PASS** | DEF-09: Views measurements can be saved; raycast timing on device |
| REQ-090 | PARTIAL | PARTIAL | WebKit job not yet run (DEF-10) |

**Counts (57): PASS 53 · PARTIAL 1 (REQ-090) · FAIL 0 · not implemented 3 (REQ-007, 018, 048; COULD).**

### 8.5 New defects (round 2)

**DEF-20 · MINOR · REQ-020: residual up-axis misdetection for OBJ/PLY (see §8.3 table).**
- Z-up files with a horizontal side near 2.5 m stay sideways *without* a hint.
- Y-up facade OBJs with a 2.5–3 m ground strip are turned sideways.
- Altbau rooms (3.0–3.5 m) with a side near 2.5 m are turned sideways (hint shown).
- The hint is a 6-second toast, shown only when the axis is not +Y.

*Tests:* `qa-reverify › Z-up OBJ with a horizontal side near 2.5 m`, `› Y-up facade OBJ`
(`todo`); `› tall-room limitation, quantified` guards the documented envelope.
*Fix:* after every OBJ/PLY import, show a persistent "Check orientation" card with one-tap
Up = buttons. Do not count an axis as a storey candidate when its "horizontal-looking" faces at
the ends are the scan's ground plane (they face +Y).

**DEF-21 · MINOR · REQ-020: floor levelling residuals.**
- Flat low objects 1–6 cm high (rugs, mats, platforms) covering ≥ 20 % of the floor fall inside
  the ±5 cm / 2 cm inlier bands and are fitted as slope. A 2 cm rug on 40 % of the floor gives
  0.33° (≈ 3 cm over 5 m) and lifts the floor 2.3 cm; a 6 cm platform gives about 1°.
- Flat furniture tops covering > 50 % of the floor at one height are taken as the floor
  (floor set 45 cm too high).

*Tests:* `qa-reverify › flat low object…`, `› furniture tops covering > 50 %…` (`todo`).
*Fix:* seed the fit from the *lowest* height cluster holding ≥ 15–20 % of candidate area, use a
±1 cm band, and reject a tilt when the residuals are bimodal (a step rather than a slope).

**DEF-22 · MINOR · REQ-004: Cancel is ignored while the file or the stored source is still being read.**
`importFile` and `openProject` (`app/projects-view.js:124-131, 203-212`) set `cancelled = true`
and restart the worker, but do not check the flag after `await file.arrayBuffer()` /
`getProject()`. The load is then posted to the new worker and the import or open continues.
State stays consistent, so this is not a DEF-02 regression. But on an iPhone, reading a
100–300 MB file takes seconds, and Cancel appears not to work. Reproduced in
`qa-reverify.spec › Cancel while opening another (large) project` (recorded as a DEF-22
annotation). *Fix:* `if (cancelled) return false;` after each `await` before posting `load`.

**DEF-23 · MINOR · REQ-020/040: orientation changes after markup do not move annotations.**
This is the counterpart of DEF-06. *Rotate 90°*, *Align to tapped wall*, *Tap floor to level*,
*Set ±0.00* and *Up = …* (`viewer3d.js` `applyOrientation`) change the transform, but markup,
sections, measurements and excavations stay in the old plan frame. Pre-existing, not found in
round 1. *Fix:* apply the yaw/translation delta to annotations in the same undo step, or warn
before reorienting a project that has annotations.

**DEF-24 · MINOR · REQ-071/090: GitHub Actions workflow hardening (static review).**
- `ci.yml` has no `permissions:` block (add `contents: read`).
- `ci.yml` runs `apt-get install qpdf` without `apt-get update` first, which can fail on a stale
  runner package index.
- `pages.yml` deploys on every push to `main` without waiting for the Tests workflow, so a red
  build still goes live. Gate it with `workflow_run` on *Tests* succeeding, or make deploy a job
  that `needs` the tests.
- A browser-only upload that changes app files leaves the committed `S2P_BUILD` stale. The Tests
  run then fails `pwa › precache complete` even though Pages regenerates the list correctly.
  Document this, or regenerate in CI before testing.

The rest is correct: Pages `permissions` (`pages: write`, `id-token: write`), `concurrency`,
the `github-pages` environment, `configure-pages@v5` / `upload-pages-artifact@v3` /
`deploy-pages@v4`, the copied file set matches the precache roots, and the README's
"Source: GitHub Actions" step is documented.

### 8.6 Final release verdict

**GO for the owner's iPhone acceptance test.** No BLOCKER or MAJOR defects remain open; the
remaining 6 items are MINOR (DEF-10 partly, DEF-20…24).

Conditions and recommendations:
1. Push to GitHub and confirm that the *Tests* workflow, including the WebKit smoke and QA
   browser suites, is green. That run closes REQ-090 / DEF-10. If WebKit fails there, treat it
   as a blocker until analysed.
2. Fix DEF-22 (two lines) and the DEF-24 workflow items before or with the first deploy.
3. Use **GLB** from Scaniverse (the documented workflow). The OBJ/PLY orientation residuals
   (DEF-20/21) then do not apply.

### 8.7 Final real-iPhone checklist (owner)

Replaces §7.

1. [ ] **Deploy:** push → *Actions*: *Tests* green (WebKit) and *Deploy to GitHub Pages* green
   → open `https://<user>.github.io/scan2plan/` in Safari.
2. [ ] **Install and offline:** Share → Add to Home Screen → launches standalone. Airplane mode
   → cold start ≤ 2 s, project list shown.
3. [ ] **Files picker:** `.glb`, `.obj` and `.ply` in *On My iPhone* and *iCloud Drive* are
   selectable.
4. [ ] **Import timing:** Scaniverse GLB of one room (≤ 300k triangles) imported and oriented in
   ≤ 4 s; a ~1 M-triangle file in ≤ 10 s. A > 100 MB file shows the warning; no "A problem
   repeatedly occurred" reload with ~2 M triangles.
5. [ ] **Cancel:** with a project open, import a large file and tap Cancel early and late. The
   app stays usable and the open project's Plan is unchanged. (Early Cancel may be ignored:
   DEF-22.)
6. [ ] **3D:** ≥ 30 fps orbit on 500k triangles; orbit, pan, pinch and double-tap work; Measure
   taps respond in < 300 ms; the texture shows the right way up.
7. [ ] **Orientation:** floor level and walls aligned in your real rooms, including one with a
   bed or sofa. In an Altbau room, check the GLB import; if you ever use OBJ, check the hint and
   *Up = …*.
8. [ ] **Calibration:** calibrate on 100.0 cm and re-measure a taped wall (≤ 2 cm deviation).
   Then Backup → delete → restore → reopen → re-measure the same wall (same value) and check
   the markup is still on its walls.
9. [ ] **Textured backup:** the restored project shows the texture (not grey); a large texture
   does not crash the backup.
10. [ ] **Share sheet:** PDF/SVG/DXF/GLB/CSV/Backup open the share sheet; *Save to Files* works.
11. [ ] **Print:** PDF A4 1:50 at 100 % → a 4.00 m wall measures 80 mm ± 0.5 mm.
12. [ ] **DXF:** opens in a free CAD viewer with the 8 layers, metres, and DASHED demolition.
13. [ ] **Number inputs:** cut height and calibration accept "1,10" from the German keyboard.
14. [ ] **Layout:** safe areas in portrait and landscape; bottom sheets fully visible in Safari
    (non-standalone); dark mode.
15. [ ] **Persistence and background:** kill → reopen → project and markup intact. Leave the
    app in the background for a while → the 3D view is redrawn, not blank.
16. [ ] **Update:** push a trivial change (no version bump) → after the Pages deploy the app
    shows "Update available — Reload", and nothing reloads by itself during editing.
