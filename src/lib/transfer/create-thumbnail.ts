import { splitPreview } from '@/lib/transfer/thumbnail.mjs';
import { sendControl } from '@/lib/transfer/stream';

/** Decodes a small preview frame using browser media APIs; never reads the whole source file into JS buffers. */
async function videoFrame(file: File): Promise<ImageBitmap> {
  const url=URL.createObjectURL(file);
  const video=document.createElement('video');
  video.preload='metadata';video.muted=true;video.playsInline=true;
  try {
    const ready=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Video preview timeout')),3000);
      video.onloadeddata=()=>{clearTimeout(timer);resolve();};
      video.onerror=()=>{clearTimeout(timer);reject(new Error('Video preview not supported'));};
    });
    video.src=url;video.load();await ready;
    return await createImageBitmap(video,{resizeWidth:360,resizeHeight:240,resizeQuality:'high'});
  } finally {video.pause();video.src='';URL.revokeObjectURL(url);}
}

async function createPreviewJpeg(file: File): Promise<string|null> {
  const isImage=/^image\/(jpeg|png|webp|gif)$/i.test(file.type);
  const isVideo=/^video\/(mp4|webm|quicktime)$/i.test(file.type);
  if(!isImage&&!isVideo)return null;
  if(!file.size)return null;
  let bitmap:ImageBitmap;
  try {
    bitmap=isImage?await createImageBitmap(file,{resizeWidth:360,resizeHeight:360,resizeQuality:'high'}):await videoFrame(file);
  }catch{return null;}
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,360/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');
  if(!ctx){bitmap.close();return null;}
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const quality=[0.72,0.48,0.25];
  let result:Blob|null=null;
  for(const q of quality){
    result=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));
    if(result && result.size<=200*1024)break;
  }
  if(!result||result.size>200*1024)return null;
  // Only the bounded 200 KiB JPEG preview is encoded in JavaScript memory.
  const bytes=new Uint8Array(await result.arrayBuffer());
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.slice(i,i+8192));
  return btoa(text);
}

export async function sendThumbnail(channel:RTCDataChannel,file:File,transferId:string) {
  try {
    const jpeg=await createPreviewJpeg(file);
    if(!jpeg || channel.readyState!=='open')return;
    for(const part of splitPreview(jpeg,transferId)) {
      if(channel.readyState!=='open')return;
      sendControl(channel,part);
    }
  }catch{ /* A failed optional thumbnail must not block the real transfer. */ }
}
