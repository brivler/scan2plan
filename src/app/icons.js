/**
 * Inline SVG icons (stroke style, 24×24). Browser-only UI module.
 */
const P = {
  projects: 'M3 7h7l2 2h9v10H3z',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  plan: 'M3 3h18v18H3zM3 12h8v9M11 3v5M15 12h6',
  views: 'M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6',
  terrain: 'M2 19l6-9 4 5 3-4 7 8zM2 21h20',
  plus: 'M12 5v14M5 12h14',
  help: 'M12 21a9 9 0 110-18 9 9 0 010 18zM9.5 9a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-4l-.5 2.5-1.5 1L7 7 5 11l2 1v0l-2 1 2 4 2-.5 1.5 1L11 20h4l.5-2.5 1.5-1 2 .5 2-4z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  reset: 'M4 12a8 8 0 108-8M4 4v5h5',
  top: 'M12 4v16M6 10l6-6 6 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  level: 'M3 12h18M12 3v6M9 6l3 3 3-3',
  rotate: 'M20 12a8 8 0 11-3-6.3M20 4v5h-5',
  scale: 'M4 20L20 4M14 4h6v6M4 14v6h6',
  demolish: 'M4 4l16 16M20 4L4 20M3 9h18v6H3z',
  wall: 'M3 9h18v6H3zM8 9v6M14 9v6',
  section: 'M4 12h4M10 12h4M16 12h4M6 6l-2 6 2 6M18 6l2 6-2 6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12l5 5 9-10',
  close: 'M6 6l12 12M18 6L6 18',
  polygon: 'M5 18l2-12 10 2 2 9zM5 18h.01',
  mode: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  marker: 'M12 21l-4-6h8zM12 3v12',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  backup: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  copy: 'M8 8h12v12H8zM4 16V4h12',
};

/**
 * @param {keyof P} name
 * @returns {string} SVG markup
 */
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || ''}"/></svg>`;
}
