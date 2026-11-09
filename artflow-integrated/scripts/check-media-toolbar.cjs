const assert = require('node:assert/strict');
require('./register-typescript.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ElementToolbar } = require('../components/ElementToolbar.tsx');
const { ToolbarOverlay,placeMediaToolbar } = require('../components/ToolbarOverlay.tsx');
let called = '';
const props = { zoom: 1, t: key => key, handleCopyElement: () => called = 'copy', handleDownloadImage: () => called = 'download', handleStartCrop: () => called = 'crop', handleDeleteElement: () => called = 'delete', handlePropertyChange: () => {}, handleFrameAspectRatioChange: () => {}, handleUngroup: () => {}, handleMergeGroup: () => {} };
const walk = (node, result = []) => { if (!React.isValidElement(node)) return result; result.push(node); React.Children.forEach(node.props.children, child => walk(child, result)); return result; };
for (const type of ['image', 'video', 'audio']) {
  const element = { id: type, type, x: 50, y: 60, width: 400, height: 240, href: 'https://example.com/media' };
  const tree = ElementToolbar({ ...props, element });
  assert.equal(tree.props['data-media-toolbar'], true);
  for (const name of ['onPointerDown', 'onMouseDown', 'onTouchStart', 'onWheel', 'onKeyDown', 'onKeyUp']) {
    let stopped = false; tree.props[name]({ stopPropagation() { stopped = true; } }); assert.ok(stopped);
  }
  const nodes = walk(tree);
  for (const action of ['copy', 'delete', ...(type === 'image' ? ['download', 'crop'] : [])]) {
    const button = nodes.find(node => node.type === 'button' && node.props.title === `contextMenu.${action}`);
    button.props.onClick(); assert.equal(called, action);
  }
  if (type === 'image') assert.ok(nodes.some(node => node.type === 'details'));
  const markup = renderToStaticMarkup(tree); assert.ok(!markup.includes('shadow-2xl'));
  for (const zoom of [0.1, 1, 3]) {
    const overlay = ToolbarOverlay({ ...props, zoom, elements: [element], selectedElementIds: [element.id], singleSelectedElement: element });
    assert.equal(overlay.type, 'foreignObject');
    assert.ok(overlay.props.y + overlay.props.height <= element.y || overlay.props.y >= element.y+element.height,'toolbar stays outside the image');
    assert.equal(overlay.props.height*zoom,40,'toolbar keeps its screen size');
  }
}
for(const zoom of [0.1,1,3]){
  const viewport={width:800,height:600},pan={x:80,y:100};
  for(const top of [4,180]){
    const bounds={x:10,y:(top-pan.y)/zoom,width:30,height:40};
    const placed=placeMediaToolbar(bounds,zoom,pan,viewport,192,40);
    const screenX=placed.x*zoom+pan.x,screenY=placed.y*zoom+pan.y;
    assert.ok(screenX>=8&&screenX+192<=792,'horizontal viewport edges');
    if(top===4)assert.ok(screenY>=(bounds.y+bounds.height)*zoom+pan.y+12,'top-edge fallback goes below');
    else assert.ok(screenY+40<=top-36,'rotation handle has its own space');
  }
}
console.log('media-toolbar: outside-image placement, top-edge fallback, zoom, actions and event isolation passed');
