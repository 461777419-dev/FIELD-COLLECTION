import React, { useEffect, useRef } from 'react';
import { Element } from '../types';
import {getElementBounds} from '../utils/canvasUtils';
import {groupColor} from '../utils/groupAppearance';

interface EditingOverlayProps {
  zoom: number;
  editingElement: { id: string; text: string } | null;
  elements: Element[];
  setEditingElement: (val: { id: string; text: string } | null) => void;
  handleStopEditing: () => void;
  setElements: (elements: Element[] | ((prev: Element[]) => Element[]), commit?: boolean) => void;
}

export const EditingOverlay: React.FC<EditingOverlayProps> = ({
  zoom,
  editingElement,
  elements,
  setEditingElement,
  handleStopEditing,
  setElements,
}) => {
  const editingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editingInputRef = useRef<HTMLInputElement>(null);
  const cancelled=useRef(false);

  useEffect(() => {
    if (editingElement) {
      cancelled.current=false;
      const element = elements.find(el => el.id === editingElement.id);
      setTimeout(() => {
        if (element?.type === 'text' && editingTextareaRef.current) {
          editingTextareaRef.current.focus();
          editingTextareaRef.current.select();
        } else if ((element?.type === 'frame'||element?.type==='group') && editingInputRef.current) {
          editingInputRef.current.focus();
          editingInputRef.current.select();
        }
      }, 0);
    }
  }, [editingElement?.id]);

  useEffect(() => {
    if (editingElement && editingTextareaRef.current) {
      const textarea = editingTextareaRef.current;
      textarea.style.height = 'auto';
      const newHeight = textarea.scrollHeight;
      textarea.style.height = '';

      const currentElement = elements.find(el => el.id === editingElement.id);
      if (currentElement && currentElement.type === 'text' && currentElement.height !== newHeight) {
        setElements(prev => prev.map(el =>
          el.id === editingElement.id && el.type === 'text'
            ? { ...el, height: newHeight }
            : el
        ), false);
      }
    }
  }, [editingElement?.text, elements, setElements]);

  if (!editingElement) return null;

  const element = elements.find(el => el.id === editingElement.id);
  if (!element) return null;

  if(element.type==='group'){
    const bounds=getElementBounds(element,elements);
    return <foreignObject x={bounds.x+12} y={bounds.y+6} width={Math.max(80,bounds.width-24)} height={32} style={{overflow:'visible'}}
      onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onKeyUp={event=>event.stopPropagation()}>
      <input ref={editingInputRef} aria-label="编组名称" maxLength={100} value={editingElement.text}
        onChange={event=>setEditingElement({...editingElement,text:event.target.value})}
        onBlur={()=>{if(!cancelled.current)handleStopEditing();}}
        onKeyDown={event=>{event.stopPropagation();if(event.nativeEvent.isComposing)return;if(event.key==='Enter'){event.preventDefault();handleStopEditing();}if(event.key==='Escape'){event.preventDefault();cancelled.current=true;setEditingElement(null);}}}
        style={{width:'100%',height:30,boxSizing:'border-box',font:'600 16px system-ui,sans-serif',color:groupColor(element),background:'#fffffff2',border:`1px solid ${groupColor(element)}`,borderRadius:4,padding:'3px 4px',outline:'none'}}/>
    </foreignObject>;
  }
  if (element.type === 'text') {
    return (
      <foreignObject
        x={element.x - (2 / zoom)}
        y={element.y - (2 / zoom)}
        width={element.width + (4 / zoom)}
        height={element.height + (4 / zoom)}
        style={{ overflow: 'visible' }}
      >
        <textarea
          ref={editingTextareaRef}
          value={editingElement.text}
          onChange={e => setEditingElement({ ...editingElement, text: e.target.value })}
          onBlur={handleStopEditing}
          style={{
            width: `${element.width}px`,
            fontSize: `${element.fontSize}px`,
            color: element.fontColor,
            lineHeight: 1.2,
            border: `${2 / zoom}px solid #3b82f6`,
            outline: 'none',
            padding: 0,
            margin: 0,
            background: 'transparent',
            resize: 'none',
            overflow: 'hidden'
          }}
        />
      </foreignObject>
    );
  } else if (element.type === 'frame') {
    return (
      <foreignObject
        x={element.x + (8 / zoom)}
        y={element.y - (8 / zoom) - (16 / zoom)}
        width={200 / zoom}
        height={24 / zoom}
        style={{ overflow: 'visible', pointerEvents: 'all' }}
      >
        <input
          ref={editingInputRef}
          type="text"
          value={editingElement.text}
          onChange={e => setEditingElement({ ...editingElement, text: e.target.value })}
          onBlur={handleStopEditing}
          onKeyDown={(e) => e.key === 'Enter' && handleStopEditing()}
          style={{
            fontSize: `${16 / zoom}px`,
            background: 'var(--bp-canvas-bg, #111827)',
            color: 'white',
            border: `1px solid #3b82f6`,
            borderRadius: `${4 / zoom}px`,
            padding: `${4 / zoom}px`,
            width: '100%',
            height: '100%',
            outline: 'none',
          }}
        />
      </foreignObject>
    );
  }

  return null;
};
