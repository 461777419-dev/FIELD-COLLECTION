import React from 'react';
export function BoardAppearance({color,onColor,grid,onGrid,onClose}:{color:string;onColor:(color:string)=>void;grid:boolean;onGrid:(grid:boolean)=>void;onClose:()=>void}){
  return <div role="dialog" aria-label="画板外观" data-bp-tool-menu="" className="absolute right-4 top-20 z-50 w-64 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-color)] p-4 text-sm text-[var(--ui-text)] shadow-xl">
    <div className="mb-4 flex justify-between"><strong>画板外观</strong><button aria-label="关闭画板外观" onClick={onClose}>×</button></div>
    <label className="flex items-center justify-between">当前画板背景<input aria-label="画板背景颜色" type="color" value={/^#[0-9a-f]{6}$/i.test(color)?color:'#fff8fb'} onChange={event=>onColor(event.target.value)}/></label>
    <div className="my-3 flex gap-2">{['#fff8fb','#ffffff','#f1f5f9','#e9f1ec','#282b36'].map(value=><button key={value} aria-label={`背景 ${value}`} onClick={()=>onColor(value)} style={{background:value}} className="h-7 w-7 rounded-full border border-[var(--ui-border)]"/>)}</div>
    <label className="my-4 flex gap-2"><input type="checkbox" checked={grid} onChange={event=>onGrid(event.target.checked)}/>显示画布网格</label>
    <button onClick={()=>onColor('')} className="rounded-full bg-[var(--bp-accent-soft)] px-3 py-2">恢复默认背景</button>
    <p className="mt-3 text-xs opacity-70">背景随当前画板保存；不改变图片和 PPT 页面颜色。</p>
  </div>;
}
