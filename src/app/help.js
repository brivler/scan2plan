/**
 * Help screen content (REQ-061): scanning guide (spec §8), Scaniverse export steps (§3),
 * accuracy expectations (§2.2) and the structural-safety disclaimer (§1.3).
 */
import { el, modal } from './ui.js';

export const HELP_HTML = `
<div class="help">
<p><strong>Scan2Plan</strong> turns a LiDAR scan from a free iPhone scanner app into 3D views, floor plans,
sections, elevations, renovation markup and excavation volumes — entirely on your phone, also offline.</p>

<h3>Workflow</h3>
<ol>
<li>Scan in <strong>Scaniverse</strong> (see guide below).</li>
<li>Export: open the scan → <em>Share/Export</em> → <em>Mesh</em> → <strong>GLB</strong> → <em>Save to Files</em> (e.g. On My iPhone › Scans).</li>
<li>In Scan2Plan tap <em>New project</em>, enter a name and pick the GLB in Files. OBJ and PLY meshes also work.</li>
<li>Check the orientation in <em>3D</em> (floor level, walls aligned), then <em>Calibrate scale</em> on your reference.</li>
<li>Use <em>Plan</em>, <em>Views</em> and <em>Terrain</em>; export via the share sheet (Save to Files, AirDrop, Mail).</li>
<li>Use <em>Backup</em> regularly: it saves one <code>.s2p.glb</code> file that restores the whole project.</li>
</ol>

<h3>Scanning guide — before you scan</h3>
<ul>
<li>Use <strong>Scaniverse</strong> (free). Keep <strong>LiDAR enabled</strong> (do not switch on "Ignore LiDAR"). Use the <em>Classic</em> experience; no account needed.</li>
<li>Put a <strong>reference of known length</strong> in view: an unfolded 2 m folding rule, or measure a door opening or wall with a tape measure and note it. You will enter it in Scan2Plan → <em>Calibrate scale</em>. This is what gets you to ±1–2 cm.</li>
<li>Turn on all room lights, open curtains. Remove or cover large mirrors; LiDAR and tracking struggle with glass, mirrors, glossy tiles and black surfaces.</li>
<li>Clear the floor along walls if you want clean wall lines at 1 m height.</li>
</ul>

<h3>Rooms (interior)</h3>
<ul>
<li>One room per scan (≤ ~ 6 × 6 m). For two adjoining rooms, scan through the open door in one continuous scan so the wall thickness becomes visible.</li>
<li>Walk slowly (≈ 0.5 m/s), phone 1–2 m from the walls. LiDAR range is about <strong>5 m</strong> — stay closer than that to every surface.</li>
<li>Sweep each wall bottom-to-top, include floor and ceiling edges and every corner. Finish where you started (closing the loop reduces drift).</li>
<li>Scan door and window reveals from an angle so their depth is captured.</li>
</ul>

<h3>Facades (exterior)</h3>
<ul>
<li>Scan in overcast daylight or dusk; bright sun reduces LiDAR range.</li>
<li>Walk parallel to the facade at 2–4 m distance. Upper floors beyond ~ 5 m will be incomplete or less accurate; expect ±3–5 cm.</li>
<li>Measure one long distance on the facade (e.g. window-to-window or the corner-to-corner base length) for calibration.</li>
</ul>

<h3>Terrain / excavation</h3>
<ul>
<li>Mark the area corners with stakes or spray paint so you can find them in the scan.</li>
<li>Walk a grid pattern (lines 2–3 m apart), phone pointed down at ~45°. Cover 1 m beyond the planned excavation edge.</li>
<li>Mark a <strong>height reference</strong> (e.g. the finished floor level at the door threshold) and include it — you will tap it as ±0.00.</li>
<li>Avoid tall grass and water puddles; they produce false surfaces.</li>
</ul>

<h3>Export from Scaniverse</h3>
<ul>
<li>In Scaniverse: open the scan → <em>Share/Export</em> → <em>Mesh</em> → <strong>GLB</strong> → <em>Save to Files</em>. Then open Scan2Plan → <em>Import scan</em>.</li>
<li>Do not export PLY or SPZ from Scaniverse: those are Gaussian splats, not meshes.</li>
</ul>

<h3>Accuracy to expect</h3>
<p>Rooms <strong>±1–2 cm</strong> after calibration (±2 cm typical); facades and terrain <strong>±3–5 cm</strong>.
Published tests of iPhone LiDAR scans report about 1.3 cm RMS on small objects and about 4.6 cm on building facades;
glass and reflective surfaces cause the largest errors and the practical range is about 5 m.
Always verify critical dimensions with a tape measure before ordering materials or starting work.</p>

<h3>Safety and legal notice</h3>
<p class="warn">Removing walls can affect the structure of your house — consult a structural engineer (Tragwerksplaner)
and check whether a building permit is required. Scan2Plan only documents geometry; it does not assess load-bearing
walls and its drawings are not a legally binding survey or permit drawing (Bauvorlage).
Excavation volumes are estimates, not a site safety plan.</p>

<h3>Drawing conventions</h3>
<ul>
<li>Existing (Bestand): black cut lines, grey wall fill. Demolition (Abbruch): yellow, dashed outline. New (Neubau): red.</li>
<li>Plan cut height default 1.00 m above ±0.00. Dimensions in cm.</li>
<li>Printing PDFs: always print at <strong>100 % / actual size</strong> so the scale is exact.</li>
</ul>

<h3>Storage</h3>
<p>Projects are stored only on this iPhone. iOS may delete app data if the phone runs low on space — keep a <em>Backup</em> in Files.</p>
</div>`;

/** Opens the help screen as a sheet. */
export function showHelp() {
  const body = el('div', { html: HELP_HTML });
  return modal({ title: 'Help', body, actions: [{ label: 'Close', value: true, primary: true }] });
}
