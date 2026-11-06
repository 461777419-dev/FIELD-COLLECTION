const {customEndpoint} = require('./ai-providers');

function imageData(value) {
  const match = typeof value === 'string' && value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw Error('参考图格式无效，请使用 PNG、JPEG、WebP 或 GIF');
  return {mimeType:match[1],data:match[2]};
}

// Uses the library's credentials on the server. Never return a key to the canvas.
async function runSharedAI(settings, key, input, fetcher = fetch) {
  if (!key) throw Error('请在左上角 AI 设置中配置图库共用的 API Key');
  const provider = settings.provider;
  const refs = input.referenceImages || [];
  if (!Array.isArray(refs) || refs.length > 8) throw Error('一次最多使用 8 张参考图');
  refs.forEach(imageData);
  const params = input.parameters || {};
  const op = params.op || (refs.length ? 'image-to-image' : 'text-to-image');
  if (!['text-to-image','image-to-image','inpainting','prompt-enhancement','text-generation'].includes(op)) throw Error('当前共用接口尚不支持此操作；视频生成需专用视频接口');
  const textOnly = ['prompt-enhancement','text-generation'].includes(op);
  const model = textOnly ? settings.models[provider] : settings.generationModels?.[provider];
  if (!model) throw Error(textOnly ? '请先设置图片理解模型' : '请在 AI 设置中选择图片生成模型；图片理解模型不会自动用于生成');
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim().slice(0,20000) : '';
  if (!prompt) throw Error('请输入提示词');
  const count = Math.min(4,Math.max(1,Math.round(Number(params.numberOfImages)||1)));
  if (!textOnly && count > 1 && (provider === 'gemini' || (provider === 'custom' && settings.imageProtocol === 'chat'))) {
    const responses=await Promise.all(Array.from({length:count},()=>runSharedAI(settings,key,{...input,parameters:{...params,numberOfImages:1}},fetcher)));
    return {ok:true,artifacts:responses.flatMap(result=>result.artifacts)};
  }
  const headers = {'Content-Type':'application/json'};
  let url, body;
  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = key;
    body = {contents:[{parts:[{text:prompt},...refs.map(ref=>({inlineData:imageData(ref)}))]}]};
    if (params.mask) body.contents[0].parts.push({text:'Use this mask for the edit:'},{inlineData:imageData(params.mask)});
    if (!textOnly) body.generationConfig = {responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:params.aspectRatio || '1:1'}};
  } else if (textOnly || (provider === 'custom' && settings.imageProtocol === 'chat')) {
    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01';
      body = {model,max_tokens:2000,messages:[{role:'user',content:[{type:'text',text:prompt},...refs.map(ref=>({type:'image',source:{type:'base64',media_type:imageData(ref).mimeType,data:imageData(ref).data}}))]}]};
    } else {
      url = provider === 'custom' ? customEndpoint(settings.custom.address) : provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      headers.Authorization = `Bearer ${key}`;
      const content = [{type:'text',text:prompt},...refs.map(ref=>({type:'image_url',image_url:{url:ref}}))];
      if (params.mask) {imageData(params.mask);content.push({type:'image_url',image_url:{url:params.mask}});}
      body = {model,messages:[{role:'user',content}]};
    }
  } else {
    if (!['openai','custom'].includes(provider)) throw Error('此服务不提供图片生成，请选择 OpenAI、Gemini 或支持生图的自定义平台');
    const base = provider === 'custom' ? customEndpoint(settings.custom.address).replace(/\/chat\/completions$/,'') : 'https://api.openai.com/v1';
    headers.Authorization = `Bearer ${key}`;
    const [ratioX,ratioY]=String(params.aspectRatio || '1:1').split(':').map(Number);
    const ratio=ratioX/ratioY;
    const size = /dall-e-2/.test(model) ? '1024x1024' : ratio>1.2 ? (/dall-e-3/.test(model)?'1792x1024':'1536x1024') : ratio<.8 ? (/dall-e-3/.test(model)?'1024x1792':'1024x1536') : '1024x1024';
    if (refs.length) {
      url = base + '/images/edits';
      delete headers['Content-Type'];
      body = new FormData(); body.append('model',model);body.append('prompt',prompt);body.append('n',String(count));body.append('size',size);
      refs.forEach((ref,index)=>{const data=imageData(ref);body.append(refs.length===1?'image':'image[]',new Blob([Buffer.from(data.data,'base64')],{type:data.mimeType}),`reference-${index}.${data.mimeType.split('/')[1]}`);});
      if (params.mask) {const mask=imageData(params.mask);body.append('mask',new Blob([Buffer.from(mask.data,'base64')],{type:mask.mimeType}),'mask.png');}
    } else {
      url = base + '/images/generations';
      body = {model,prompt,n:count,size,...(!/^gpt-image/.test(model) ? {response_format:'b64_json'} : {})};
    }
  }
  const response = await fetcher(url,{method:'POST',headers,body:body instanceof FormData ? body : JSON.stringify(body),signal:AbortSignal.timeout(180000),redirect:'error'});
  const result = await response.json();
  if (!response.ok) throw Error(`AI 请求失败（${response.status}），请检查模型用途、接口地址及额度`);
  const artifacts=[];
  const addImage = (data,mimeType='image/png')=>{if(typeof data==='string' && data)artifacts.push({kind:'image',dataUrl:`data:${mimeType};base64,${data}`,mimeType});};
  const addText = text=>{if(typeof text==='string' && text.trim())artifacts.push({kind:'text',content:text,mimeType:'text/plain'});};
  if (provider === 'gemini') {
    for (const part of result.candidates?.[0]?.content?.parts || []) {const data=part.inlineData || part.inline_data;if(data)addImage(data.data,data.mimeType || data.mime_type);addText(part.text);}
  } else if (provider === 'anthropic') result.content?.forEach(part=>addText(part.text));
  else {
    result.data?.forEach(item=>addImage(item.b64_json));
    const message = result.choices?.[0]?.message;
    if (typeof message?.content === 'string') {
      addText(message.content);
      for(const match of message.content.matchAll(/data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)/g)) addImage(match[2],match[1]);
    }
    for(const part of [...(Array.isArray(message?.content)?message.content:[]),...(message?.images||[])]) {
      const data = part.image_url?.url || part.url;
      if (typeof data==='string' && data.startsWith('data:image/')) {const image=imageData(data);addImage(image.data,image.mimeType);}
      addText(part.text);
    }
  }
  if (!artifacts.length || (!textOnly && !artifacts.some(item=>item.kind==='image'))) throw Error('接口未返回图片数据；请确认生成模型及图片接口协议，需支持 Base64 图片返回');
  return {ok:true,artifacts};
}
module.exports = {runSharedAI};
