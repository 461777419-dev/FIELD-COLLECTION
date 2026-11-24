import React from 'react';
import {ToolSettingsPopover} from './ToolSettingsPopover';

interface Options {strokeColor:string;strokeWidth:number;opacity:number}
export function DrawingSettings({x,y,fill,options,onChange,onClose}:{x:number;y:number;fill:boolean;options:Options;onChange:(options:Options)=>void;onClose:()=>void}){
  return <ToolSettingsPopover x={x} y={y} title="绘图设置" onClose={onClose}>
    <label className="flex items-center justify-between">{fill?'填充颜色':'笔迹颜色'}<input aria-label="绘图颜色" type="color" value={options.strokeColor} onChange={event=>onChange({...options,strokeColor:event.target.value})} className="h-8 w-12 cursor-pointer rounded-lg"/></label>
    {!fill&&<label className="mt-4 block">粗细 <span className="float-right">{options.strokeWidth}px</span><input aria-label="绘图粗细" type="range" min="1" max="50" value={options.strokeWidth} onChange={event=>onChange({...options,strokeWidth:Number(event.target.value)})} className="mt-2 w-full"/></label>}
    <label className="mt-4 block">不透明度 <span className="float-right">{Math.round(options.opacity*100)}%</span><input aria-label="绘图不透明度" type="range" min="0.1" max="1" step="0.05" value={options.opacity} onChange={event=>onChange({...options,opacity:Number(event.target.value)})} className="mt-2 w-full"/></label>
    <p className="mt-3 text-xs leading-5 opacity-70">{fill?'松开鼠标自动闭合并填色，可撤销。':'设置应用于接下来绘制的笔迹。'}</p>
  </ToolSettingsPopover>;
}
