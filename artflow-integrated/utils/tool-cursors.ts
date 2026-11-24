import type {Tool} from '../types';

// All glyphs use the same screen-pixel size and visible hotspot, independent of zoom.
const glyphs:Partial<Record<Tool,string>>={
  draw:'<path d="m9 23 3-8L23 4l5 5-11 11Z" fill="#edcfe1"/><path d="m12 15 5 5m4-14 5 5M9 23l5-2"/>',
  rectangle:'<rect x="10" y="5" width="18" height="17" rx="2" fill="#edcfe1"/>',
  circle:'<ellipse cx="19" cy="13" rx="9" ry="9" fill="#edcfe1"/>',
  triangle:'<path d="M19 4 29 22H9Z" fill="#edcfe1"/>',
  line:'<path d="m10 22 18-18"/><circle cx="10" cy="22" r="1.8" fill="#edcfe1"/><circle cx="28" cy="4" r="1.8" fill="#edcfe1"/>',
  arrow:'<path d="m10 22 17-17M18 5h9v9"/>',
  lasso:'<path d="M14 21c-8-2-7-13 3-15 12-2 16 8 8 14-4 3-12 3-14-1-2-4 5-4 4 0-1 4-4 7-7 6" stroke-dasharray="3 2"/>',
  'lasso-fill':'<path d="M14 21c-8-2-7-13 3-15 12-2 16 8 8 14-4 3-12 3-14-1Z" fill="#edcfe1"/><path d="m11 21-3 4"/>',
  text:'<path d="M11 6h17M19.5 6v16M15 22h9M11 6v3m17-3v3"/>',
  frame:'<path d="M12 3v21M25 3v21M9 7h20M9 20h20"/>',
};
const buildCursor=(glyph:string)=>{
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="#fffafd" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${glyph}</g><g fill="none" stroke="#594251" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyph}</g><circle cx="6" cy="26" r="2.5" fill="#594251" stroke="#fffafd" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 26, crosshair`;
};
const cursors=new Map(Object.entries(glyphs).map(([tool,glyph])=>[tool,buildCursor(glyph)]));
export const drawingToolCursor=(tool:Tool):string|undefined=>cursors.get(tool);
