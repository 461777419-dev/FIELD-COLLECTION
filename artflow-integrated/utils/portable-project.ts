import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import type {Board} from '../types';
import {generateId} from './canvasUtils';
const LIMIT=256*1024*1024;
const mediaRef=(value:string)=>/^\/(?:board-media\/|media\/)/.test(value)||value.startsWith('blob:')||/^data:(?:image|video|audio)\//.test(value);
async function walk(value:unknown,convert:(value:string)=>Promise<string>):Promise<any>{
  if(typeof value==='string')return convert(value);
  if(Array.isArray(value)){const result=[];for(const item of value)result.push(await walk(item,convert));return result;}
  if(value&&typeof value==='object'){const result:Record<string,unknown>={};for(const [key,item]of Object.entries(value))if(!['__proto__','constructor','prototype'].includes(key))result[key]=await walk(item,convert);return result;}
  return value;
}
export async function exportPortableProject(boards:Board[],progress:(message:string)=>void):Promise<Blob>{
  const entries:Record<string,Uint8Array>={},cached=new Map<string,string>();let total=0;
  const document=await walk(boards.map(board=>({...board,operationHistory:[],operationHistoryIndex:-1})),async value=>{
    const css=/^url\(["']?(.*?)["']?\)$/.exec(value),source=css?.[1]||value;
    if(!mediaRef(source))return value;
    const wrap=(ref:string)=>css?`url(${ref})`:ref;
    if(cached.has(source))return wrap(cached.get(source)!);
    progress(`正在收集素材 · ${cached.size+1}`);
    const response=await fetch(source);if(!response.ok)throw Error('项目素材缺失，无法完整导出');
    const bytes=new Uint8Array(await response.arrayBuffer());total+=bytes.length;if(total>LIMIT)throw Error('当前便携项目素材超过 256MB，请分画板导出，或使用图库完整备份');
    const mime=response.headers.get('Content-Type')?.split(';')[0]||'application/octet-stream';
    const key='assets/'+cached.size;entries[key]=bytes;const ref='portable:'+key+':'+mime;cached.set(source,ref);return wrap(ref);
  });
  entries['project.json']=strToU8(JSON.stringify({format:'field-portable-project',version:1,boards:document}));
  progress('正在打包项目…');
  return new Blob([zipSync(entries,{level:0}) as Uint8Array<ArrayBuffer>],{type:'application/zip'});
}
export async function importPortableProject(file:File,progress:(message:string)=>void):Promise<Board[]>{
  if(file.size>LIMIT)throw Error('便携项目压缩包不能超过 256MB');
  let total=0;
  const archive=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{
    if(!/^(?:project\.json|assets\/\d+)$/.test(entry.name))return false;
    total+=entry.originalSize;if(total>LIMIT)throw Error('项目解压后超过 256MB');return true;
  }});
  if(!archive['project.json']||archive['project.json'].length>20*1024*1024)throw Error('项目清单无效');
  const manifest=JSON.parse(strFromU8(archive['project.json']));
  if(manifest.format!=='field-portable-project'||manifest.version!==1||!Array.isArray(manifest.boards)||!manifest.boards.length||manifest.boards.length>100)throw Error('不支持的项目格式');
  // Validate the whole document and all asset references before uploading anything.
  for(const board of manifest.boards){
    if(!board||typeof board.name!=='string'||!Array.isArray(board.elements)||board.elements.length>50000)throw Error('画板数据无效');
    const ids=new Set<string>();
    for(const element of board.elements){
      if(!element||typeof element.type!=='string'||typeof element.id!=='string'||!element.id||!Number.isFinite(element.x)||!Number.isFinite(element.y)||ids.has(element.id))throw Error('项目元素无效或标识重复');
      ids.add(element.id);
    }
  }
  const references=new Map<string,{key:string;mime:string}>();
  const validateReferences=(value:unknown):void=>{
    if(value&&typeof value==='object'){for(const item of Object.values(value))validateReferences(item);return;}
    if(typeof value!=='string')return;
    const source=/^url\(["']?(.*?)["']?\)$/.exec(value)?.[1]||value;
    if(source.startsWith('portable:')&&!references.has(source)){
      const match=/^portable:(assets\/\d+):([\w.+-]+\/[\w.+-]+)$/.exec(source);
      if(!match||!archive[match[1]])throw Error('项目缺少素材');
      references.set(source,{key:match[1],mime:match[2]});
    }
  };
  validateReferences(manifest.boards);
  const urls=new Map<string,string>();
  const boards=await walk(manifest.boards,async value=>{
    const css=/^url\(["']?(.*?)["']?\)$/.exec(value),source=css?.[1]||value;
    if(!source.startsWith('portable:'))return value;
    const wrap=(ref:string)=>css?`url(${ref})`:ref;
    if(urls.has(source))return wrap(urls.get(source)!);
    const {key,mime}=references.get(source)!;
    progress(`正在恢复素材 · ${urls.size+1}`);
    const response=await fetch('/api/board/media',{method:'POST',headers:{'Content-Type':mime},body:new Blob([archive[key] as Uint8Array<ArrayBuffer>],{type:mime})});
    if(!response.ok)throw Error('素材导入失败，请重试');const {url}=await response.json();urls.set(source,url);return wrap(url);
  });
  return boards.map((board:Board)=>{
    const ids=new Map(board.elements.map(element=>[element.id,generateId()]));
    return {...board,id:generateId(),name:board.name+'（导入）',linkedFolderName:undefined,operationHistory:[],operationHistoryIndex:-1,elements:board.elements.map(element=>{
      return {...element,id:ids.get(element.id)!,parentId:element.parentId?ids.get(element.parentId):undefined,assetId:undefined};
    })};
  });
}
