export interface PresentationPage {href:string;width:number;height:number}
export const MAX_PRESENTATION_BYTES=512*1024*1024;
export function uploadPresentation(file:File,onProgress:(message:string)=>void):Promise<{slides:PresentationPage[]}>{
  if(file.size>MAX_PRESENTATION_BYTES)return Promise.reject(Error('单份 PPT 最大支持 512MB，请拆分后导入'));
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest();
    request.open('POST','/api/board/import-ppt?ext='+file.name.split('.').pop()!.toLowerCase());
    request.setRequestHeader('Content-Type','application/octet-stream');request.responseType='json';request.timeout=240000;
    request.upload.onprogress=event=>onProgress(event.lengthComputable?`正在上传 ${file.name} · ${Math.round(event.loaded/event.total*100)}%`:`正在上传 ${file.name}…`);
    request.upload.onload=()=>onProgress(`正在转换 ${file.name} · 大文件可能需要几分钟，请勿关闭窗口…`);
    request.onload=()=>request.status>=200&&request.status<300&&Array.isArray(request.response?.slides)?resolve(request.response):reject(Error(request.response?.error||'PPT 导入失败，请重试'));
    request.onerror=()=>reject(Error('PPT 上传连接中断，请确认本地服务运行后重试'));
    request.ontimeout=()=>reject(Error('PPT 上传或转换超时，请拆分文件后重试'));
    request.onabort=()=>reject(Error('PPT 导入已取消'));
    onProgress(`正在上传 ${file.name} · 0%`);request.send(file);
  });
}
