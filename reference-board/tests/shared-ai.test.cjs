const test=require('node:test');
const assert=require('node:assert/strict');
const {runSharedAI}=require('../shared-ai');
const image='data:image/png;base64,aGVsbG8=';
const settings={provider:'custom',custom:{address:'https://example.com/v1/chat/completions'},models:{custom:'vision-model'},generationModels:{custom:'gpt-image-1'}};
const success=data=>({ok:true,json:async()=>data});

test('生成共用接口密钥且使用独立生成模型，完整chat地址正确转换为images地址',async()=>{
  let called=false;
  const result=await runSharedAI(settings,'test-secret',{prompt:'花朵',parameters:{op:'text-to-image'}},async(url,options)=>{
    called=true;assert.equal(url,'https://example.com/v1/images/generations');
    assert.equal(options.headers.Authorization,'Bearer test-secret');
    const body=JSON.parse(options.body);assert.equal(body.model,'gpt-image-1');assert.equal(body.response_format,undefined);
    return success({data:[{b64_json:'aGVsbG8='}]});
  });
  assert.ok(called);assert.equal(result.artifacts[0].dataUrl,image);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});
test('缺少生成模型不回退到图片理解模型，不发送网络请求',async()=>{
  await assert.rejects(runSharedAI({...settings,generationModels:{}},'test-secret',{prompt:'花朵'},()=>assert.fail('不应发送请求')),/图片生成模型/);
  await assert.rejects(runSharedAI(settings,'',{prompt:'花朵'}),/API Key/);
});
test('识图请求沿用理解模型与原服务地址',async()=>{
  const result=await runSharedAI(settings,'test-secret',{prompt:'描述图片',referenceImages:[image],parameters:{op:'prompt-enhancement'}},async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.model,'vision-model');assert.equal(url,settings.custom.address);
    assert.equal(body.messages[0].content[1].image_url.url,image);
    return success({choices:[{message:{content:'一朵花'}}]});
  });
  assert.equal(result.artifacts[0].content,'一朵花');
});
test('图片编辑与蒙版使用multipart，保留引用图',async()=>{
  await runSharedAI(settings,'test-secret',{prompt:'修改',referenceImages:[image],parameters:{op:'inpainting',mask:image}},async(url,options)=>{
    assert.equal(url,'https://example.com/v1/images/edits');assert.equal(options.headers['Content-Type'],undefined);
    assert.ok(options.body instanceof FormData);assert.equal(options.body.get('model'),'gpt-image-1');
    assert.equal(await options.body.get('image').text(),'hello');assert.equal(await options.body.get('mask').text(),'hello');
    return success({data:[{b64_json:'aGVsbG8='}]});
  });
});
test('Gemini及自定义Chat图片协议返回可用画板产物',async()=>{
  const gemini={provider:'gemini',models:{gemini:'vision'},generationModels:{gemini:'gemini-image'}};
  const result=await runSharedAI(gemini,'test-secret',{prompt:'花',referenceImages:[image]},async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/png');
    assert.deepEqual(body.generationConfig.responseModalities,['TEXT','IMAGE']);
    return success({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'aGVsbG8='}}]}}]});
  });
  assert.equal(result.artifacts[0].dataUrl,image);
  const chat=await runSharedAI({...settings,imageProtocol:'chat'},'test-secret',{prompt:'花'},async(url)=>{
    assert.equal(url,settings.custom.address);return success({choices:[{message:{images:[{image_url:{url:image}}]}}]});
  });
  assert.equal(chat.artifacts[0].dataUrl,image);
});
test('无图片产物、远程引用、不支持的操作及外部错误均明确失败',async()=>{
  await assert.rejects(runSharedAI(settings,'test-secret',{prompt:'花'},async()=>success({choices:[{message:{content:'不能生图'}}]})),/未返回图片/);
  await assert.rejects(runSharedAI(settings,'test-secret',{prompt:'花',referenceImages:['http://127.0.0.1/private']}),/参考图格式/);
  await assert.rejects(runSharedAI(settings,'test-secret',{prompt:'花',parameters:{op:'video'}}),/视频生成/);
  await assert.rejects(runSharedAI(settings,'test-secret',{prompt:'花'},async()=>({ok:false,status:401,json:async()=>({error:{message:'secret'}})})),/401/);
});
