const fs=require('node:fs/promises');
const disk=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {execFile}=require('node:child_process');
const MAX_PPT_BYTES=512*1024*1024;
let busy=false;
exports.MAX_PPT_BYTES=MAX_PPT_BYTES;
exports.convertPresentation=async function(input,extension,options={}){
  if(!['ppt','pptx'].includes(extension))throw Error('仅支持 PPT 和 PPTX');
  if(process.platform!=='win32')throw Error('PPT 导入需要 Windows 和已安装的 Microsoft PowerPoint');
  if(busy)throw Error('另一份 PPT 正在转换，请稍后重试');
  busy=true;let directory;
  try{
    directory=await fs.mkdtemp(path.join(os.tmpdir(),'field-ppt-'));
    const source=path.join(directory,'input.'+extension);
    let size=0,signature=Buffer.alloc(0);
    const maxBytes=options.maxBytes??MAX_PPT_BYTES;
    const guard=new Transform({transform(chunk,encoding,callback){
      size+=chunk.length;
      if(size>maxBytes){const error=Error('单份 PPT 最大支持 '+Math.round(maxBytes/1024/1024)+'MB，请拆分后导入');error.status=413;callback(error);return;}
      if(signature.length<8)signature=Buffer.concat([signature,chunk.subarray(0,8-signature.length)]);
      callback(null,chunk);
    }});
    await pipeline(Buffer.isBuffer(input)?Readable.from([input]):input,guard,disk.createWriteStream(source));
    const valid=extension==='pptx'?signature[0]===0x50&&signature[1]===0x4b:signature.equals(Buffer.from('d0cf11e0a1b11ae1','hex'));
    if(!valid)throw Error('文件内容与 PPT 格式不符');
    await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'ppt-export.ps1'),'-InputFile',source,'-OutputDirectory',directory],{windowsHide:true,timeout:180000,maxBuffer:1024*1024},error=>error?reject(Error('PPT 转换失败：请确认已安装 PowerPoint，文件未加密且能正常打开。'+(error.killed?'（转换超时）':''))):resolve()));
    const names=(await fs.readdir(directory)).filter(name=>/^slide-\d{4}\.png$/.test(name)).sort();
    if(!names.length)throw Error('PPT 中没有可导入的页面');
    if(options.mediaDirectory)await fs.mkdir(options.mediaDirectory,{recursive:true});
    let total=0;const slides=[],created=[];
    try{
      for(const name of names){
        const bytes=await fs.readFile(path.join(directory,name));total+=bytes.length;
        if(total>512*1024*1024)throw Error('转换后的页面超过 512MB，请拆分 PPT 后导入');
        let href;
        if(options.mediaDirectory){
          const filename=crypto.createHash('sha256').update(bytes).digest('hex')+'.png';
          const target=path.join(options.mediaDirectory,filename);
          try{await fs.writeFile(target,bytes,{flag:'wx'});created.push(target);}catch(error){if(error.code!=='EEXIST')throw error;}
          href='/board-media/'+filename;
        }else href='data:image/png;base64,'+bytes.toString('base64');
        slides.push({href,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
      }
    }catch(error){await Promise.all(created.map(file=>fs.rm(file,{force:true})));throw error;}
    return {slides};
  }finally{
    try{if(directory)await fs.rm(directory,{recursive:true,force:true});}finally{busy=false;}
  }
};
