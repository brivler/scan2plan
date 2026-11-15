/**
 * Drawing style constants (REQ-028, REQ-040, REQ-041, REQ-054). Widths in paper millimetres.
 * Shared by the in-app plan renderer and all exporters. Pure data.
 */

export const LINE_CUT_MM = 0.5;
export const LINE_BEYOND_MM = 0.18;
export const LINE_MARKUP_MM = 0.35;
export const LINE_DIM_MM = 0.18;
export const TEXT_MM = 2.5;
export const DIM_TICK_MM = 2;

export const COLOR_EXISTING = '#000000';
export const COLOR_BEYOND = '#808080';
export const COLOR_POCHE = '#808080';
export const COLOR_DEMOLITION = '#FFD600';
export const COLOR_NEW = '#E30613';
export const COLOR_EXCAVATION = '#8B5A2B';
export const COLOR_SECTION = '#0055A4';
export const DEMOLITION_DASH_MM = [3, 1.5];
export const HATCH_SPACING_MM = 2;

/**
 * Line/fill styles keyed by drawing style name.
 * `bw` overrides apply in black-and-white mode (REQ-041).
 * `layer` is the DXF layer (REQ-054).
 */
export const STYLES = Object.freeze({
  cut: { stroke: COLOR_EXISTING, width: LINE_CUT_MM, layer: 'S2P_EXISTING' },
  beyond: { stroke: COLOR_BEYOND, width: LINE_BEYOND_MM, layer: 'S2P_BEYOND' },
  edge: { stroke: '#404040', width: LINE_BEYOND_MM, layer: 'S2P_BEYOND' },
  poche: { fill: COLOR_POCHE, width: 0, layer: 'S2P_EXISTING', bw: { fill: COLOR_EXISTING } },
  demolition: { fill: COLOR_DEMOLITION, stroke: COLOR_EXISTING, width: LINE_MARKUP_MM, dash: DEMOLITION_DASH_MM, layer: 'S2P_DEMOLITION', bw: { fill: null, cross: true } },
  new: { fill: COLOR_NEW, stroke: COLOR_EXISTING, width: LINE_CUT_MM, layer: 'S2P_NEW', bw: { fill: null, hatch: HATCH_SPACING_MM } },
  dim: { stroke: COLOR_EXISTING, width: LINE_DIM_MM, layer: 'S2P_DIMENSIONS' },
  text: { fill: COLOR_EXISTING, layer: 'S2P_TEXT' },
  sectionLine: { stroke: COLOR_SECTION, width: LINE_MARKUP_MM, dash: [6, 1.5, 1, 1.5], layer: 'S2P_SECTIONLINES', bw: { stroke: COLOR_EXISTING } },
  level: { stroke: COLOR_EXISTING, width: LINE_BEYOND_MM, dash: [4, 1, 1, 1], layer: 'S2P_TEXT' },
  contour: { stroke: '#6B4E2E', width: 0.13, layer: 'S2P_BEYOND', bw: { stroke: '#606060' } },
  contourMajor: { stroke: '#6B4E2E', width: 0.3, layer: 'S2P_BEYOND', bw: { stroke: COLOR_EXISTING } },
  excavation: { stroke: COLOR_EXCAVATION, width: LINE_CUT_MM, layer: 'S2P_EXCAVATION', bw: { stroke: COLOR_EXISTING } },
  target: { stroke: COLOR_EXCAVATION, width: LINE_MARKUP_MM, dash: [3, 1.5], layer: 'S2P_EXCAVATION', bw: { stroke: COLOR_EXISTING } },
  cutHatch: { hatch: HATCH_SPACING_MM, hatchColor: COLOR_EXCAVATION, stroke: COLOR_EXCAVATION, width: LINE_BEYOND_MM, layer: 'S2P_EXCAVATION', bw: { hatchColor: COLOR_EXISTING, stroke: COLOR_EXISTING } },
  measure: { stroke: COLOR_SECTION, width: LINE_BEYOND_MM, layer: 'S2P_DIMENSIONS', bw: { stroke: COLOR_EXISTING } },
});

/** All DXF layers with ACI colour numbers. */
export const DXF_LAYERS = Object.freeze([
  ['S2P_EXISTING', 7], ['S2P_BEYOND', 8], ['S2P_DEMOLITION', 2], ['S2P_NEW', 1],
  ['S2P_DIMENSIONS', 3], ['S2P_TEXT', 7], ['S2P_SECTIONLINES', 4], ['S2P_EXCAVATION', 30],
]);

/**
 * Resolved style for a mode.
 * @param {string} name
 * @param {boolean} bw
 */
export function resolveStyle(name, bw) {
  const s = STYLES[name];
  if (!s) throw new Error(`Unknown style ${name}`);
  return bw && s.bw ? { ...s, ...s.bw } : s;
}
