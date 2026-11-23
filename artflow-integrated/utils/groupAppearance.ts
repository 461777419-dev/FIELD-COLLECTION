import type {GroupElement,Rect} from '../types';
export const DEFAULT_GROUP_COLOR='#477FA8';
export const groupColor=(group:GroupElement)=>/^#[0-9a-f]{6}$/i.test(group.groupColor||'')?group.groupColor!:DEFAULT_GROUP_COLOR;
export const groupHeaderHeight=(group:GroupElement)=>group.groupNote&&!group.groupNoteCollapsed?98:44;
export function groupFrameBounds(content:Rect,group:GroupElement):Rect {
  const width=Math.max(240,content.width+48),header=groupHeaderHeight(group);
  return {x:content.x-(width-content.width)/2,y:content.y-header,width,height:content.height+header+24};
}
