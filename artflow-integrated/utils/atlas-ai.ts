import type {AIProviderRequest,AIProviderResponse} from '../plugin-runtime/ai-providers';

async function asDataURL(source:string):Promise<string> {
  if(source.startsWith('data:'))return source;
  const response=await fetch(source);
  if(!response.ok)throw Error('参考图读取失败，请检查原素材是否仍在图库');
  const blob=await response.blob();
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('参考图转换失败'));reader.readAsDataURL(blob);});
}

export async function invokeAtlasAI(request:AIProviderRequest):Promise<AIProviderResponse> {
  try {
    const referenceImages=await Promise.all((request.referenceImages || []).map(asDataURL));
    const parameters={...request.parameters};
    if(typeof parameters.mask==='string')parameters.mask=await asDataURL(parameters.mask);
    request.onProgress?.('正在通过图库共用 AI 接口处理…');
    const response=await fetch('/api/ai/board',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:request.prompt,referenceImages,parameters}),signal:request.signal});
    const result=await response.json();
    return response.ok ? result : {ok:false,artifacts:[],error:result.error || '共用 AI 请求失败'};
  }catch(error){return {ok:false,artifacts:[],error:error instanceof Error ? error.message : String(error)};}
}

export function openAtlasAISettings(){window.parent.postMessage({type:'atlas:ai-settings'},location.origin);}
