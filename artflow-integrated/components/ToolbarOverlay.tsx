import React from 'react';
import { Element, ImageElement, Rect } from '../types';
import { getElementBounds, getSelectionBounds } from '../utils/canvasUtils';
import { SelectionToolbar, getSelectionToolbarScreenSize } from './SelectionToolbar';
import { ElementToolbar } from './ElementToolbar';

interface ToolbarOverlayProps {
    zoom: number;
    panOffset?: {x:number;y:number};
    viewportSize?: {width:number;height:number};
    selectedElementIds: string[];
    elements: Element[];
    singleSelectedElement: Element | null;
    croppingState: any;
    editingElement: any;
    aiRotationState: any;
    handleCopySelection: () => void;
    handleGroup: () => void;
    handleRasterizeSelection: () => void;
    handleSelectionPropertyChange: (updates: { [key: string]: any }) => void;
    handleAlignSelection: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
    handleMasonryLayout: () => void;
    handleCopyElement: (el: Element) => void;
    handleFrameAspectRatioChange: (id: string, ratio: string) => void;
    handleUngroup: () => void;
    handleMergeGroup: () => void;
    handleDownloadImage: (el: ImageElement) => void;
    handleStartCrop: (el: ImageElement) => void;
    handlePropertyChange: (id: string, updates: Partial<Element>) => void;
    handleDeleteElement: (id: string) => void;
    // Updated t signature to match useSettings hook for better type compatibility
    t: (key: string, ...args: any[]) => any;
}

export const ToolbarOverlay: React.FC<ToolbarOverlayProps> = ({
    zoom,
    panOffset = {x:0,y:0},
    viewportSize,
    selectedElementIds,
    elements,
    singleSelectedElement,
    croppingState,
    editingElement,
    aiRotationState,
    handleCopySelection,
    handleGroup,
    handleRasterizeSelection,
    handleSelectionPropertyChange,
    handleAlignSelection,
    handleMasonryLayout,
    handleCopyElement,
    handleFrameAspectRatioChange,
    handleUngroup,
    handleMergeGroup,
    handleDownloadImage,
    handleStartCrop,
    handlePropertyChange,
    handleDeleteElement,
    t,
}) => {
    if (selectedElementIds.length === 0 || croppingState || editingElement || aiRotationState) {
        return null;
    }

    if (selectedElementIds.length > 1) {
        const bounds = getSelectionBounds(selectedElementIds, elements);
        const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
        const { width: toolbarScreenWidth, height: toolbarScreenHeight } = getSelectionToolbarScreenSize(selectedElements);
        const toolbarCanvasWidth = toolbarScreenWidth / zoom;
        const toolbarCanvasHeight = toolbarScreenHeight / zoom;
        const x = bounds.x + bounds.width / 2 - toolbarCanvasWidth / 2;
        const y = bounds.y - toolbarCanvasHeight - (10 / zoom);

        return (
            <g transform={`translate(${x}, ${y})`}>
                {/* Hit area must cover only the toolbar itself: a percentage-sized foreignObject
                    would span the whole viewport and swallow clicks on every element it covers. */}
                <foreignObject width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                    <SelectionToolbar
                        zoom={zoom}
                        selectedElementIds={selectedElementIds}
                        elements={elements}
                        handleCopySelection={handleCopySelection}
                        handleGroup={handleGroup}
                        handleRasterizeSelection={handleRasterizeSelection}
                        handleSelectionPropertyChange={handleSelectionPropertyChange}
                        handleAlignSelection={handleAlignSelection}
                        handleMasonryLayout={handleMasonryLayout}
                        t={t}
                    />
                </foreignObject>
            </g>
        );
    } else if (singleSelectedElement) {
        const element = singleSelectedElement;
        const bounds = getElementBounds(element, elements);
        
        // Calculate toolbar dimensions for foreignObject
        let toolbarScreenWidth = 120; // Default
        if (element.type === 'shape') {
            toolbarScreenWidth = 502 + 37 + (element.shapeType === 'rectangle' ? 156 : 0);
        } else if (element.type === 'text') {
            toolbarScreenWidth = 178 + 37;
        } else if (element.type === 'arrow' || element.type === 'line') {
            toolbarScreenWidth = 251 + 37;
        } else if (element.type === 'image') {
            toolbarScreenWidth = 315 + 156;
        } else if (element.type === 'video') {
            toolbarScreenWidth = 115;
        } else if (element.type === 'group') {
            toolbarScreenWidth = 160;
        } else if (element.type === 'path') {
            toolbarScreenWidth = 331 + 37;
        } else if (element.type === 'frame') {
            toolbarScreenWidth = 270;
        }

        const isMedia = ['image', 'video', 'audio'].includes(element.type);
        // Media controls stay readable at every zoom, outside the image and its drag icon.
        if (isMedia) toolbarScreenWidth = element.type === 'image' ? 192 : 112;
        const toolbarZoom = zoom;
        const toolbarScreenHeight = isMedia ? 40 : 48;
        const toolbarCanvasWidth = toolbarScreenWidth / toolbarZoom;
        const toolbarCanvasHeight = toolbarScreenHeight / toolbarZoom;
        
        let x = bounds.x + bounds.width / 2 - toolbarCanvasWidth / 2;
        let y = bounds.y - toolbarCanvasHeight - 35 / zoom;
        if(isMedia){
            const placement=placeMediaToolbar(getSelectionBounds([element.id],elements),zoom,panOffset,viewportSize,toolbarScreenWidth,toolbarScreenHeight);
            x=placement.x;y=placement.y;
        }

        return (
            <foreignObject x={x} y={y} width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                <ElementToolbar
                    zoom={toolbarZoom}
                    element={element}
                    handleCopyElement={handleCopyElement}
                    handleFrameAspectRatioChange={handleFrameAspectRatioChange}
                    handleUngroup={handleUngroup}
                    handleMergeGroup={handleMergeGroup}
                    handleDownloadImage={handleDownloadImage as any}
                    handleStartCrop={handleStartCrop as any}
                    handlePropertyChange={handlePropertyChange}
                    handleDeleteElement={handleDeleteElement}
                    t={t}
                />
            </foreignObject>
        );
    }

    return null;
};

export function placeMediaToolbar(bounds:Rect,zoom:number,pan:{x:number;y:number},viewport:{width:number;height:number}|undefined,width:number,height:number){
    const gap=12,margin=8;
    const left=bounds.x*zoom+pan.x,right=(bounds.x+bounds.width)*zoom+pan.x;
    const top=bounds.y*zoom+pan.y,bottom=(bounds.y+bounds.height)*zoom+pan.y;
    const maxX=viewport?Math.max(margin,viewport.width-width-margin):Infinity;
    const screenX=Math.min(maxX,Math.max(margin,(left+right-width)/2));
    // Leave room for the selection's rotation handle above the image.
    const above=top-height-36;
    const screenY=above>=margin?above:bottom+gap;
    return {x:(screenX-pan.x)/zoom,y:(screenY-pan.y)/zoom};
}
