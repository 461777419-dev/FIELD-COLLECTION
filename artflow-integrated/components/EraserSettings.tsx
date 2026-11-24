import React from 'react';
import {ToolSettingsPopover} from './ToolSettingsPopover';

interface Props {
  x:number; y:number; size:number; mode:'area'|'object';
  onSize:(size:number)=>void; onMode:(mode:'area'|'object')=>void; onClose:()=>void;
}
export function EraserSettings({x,y,size,mode,onSize,onMode,onClose}:Props){
  return <ToolSettingsPopover x={x} y={y} title="橡皮设置" onClose={onClose}>
    <fieldset className="space-y-2"><legend className="mb-2 text-xs opacity-70">擦除模式</legend>
      <label className="flex items-center gap-2"><input type="radio" name="eraser-mode" checked={mode==='area'} onChange={()=>onMode('area')}/>按范围擦除</label>
      <label className="flex items-center gap-2"><input type="radio" name="eraser-mode" checked={mode==='object'} onChange={()=>onMode('object')}/>整项擦除</label>
    </fieldset>
    <label className="mt-4 flex items-center justify-between" htmlFor="eraser-popup-size">橡皮大小 <span>{size}px</span></label>
    <input id="eraser-popup-size" aria-label="橡皮大小" type="range" min="12" max="99" step="1" value={size} onChange={event=>onSize(Number(event.target.value))} className="mt-2 w-full"/>
    <p className="mt-3 text-xs leading-5 opacity-70">{mode==='area'?'只擦除圆圈覆盖的部分，保留其余内容。':'命中后删除整个笔迹、形状或文字对象。'}图片与锁定内容不受影响。</p>
  </ToolSettingsPopover>;
}
