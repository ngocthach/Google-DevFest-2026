// Bidirectional 16 kHz microphone input and 24 kHz Gemini Live audio output.
export class RoomVoice {
 constructor(url, notify){this.url=url;this.notify=notify;this.sources=new Set();this.running=false;this.starting=false;this.ready=false;this.lastLevelAt=0;}
 async start(){
  if(this.running||this.starting)return;
  this.starting=true;this.cancelled=false;
  this.notify('status','Waiting for microphone permission');
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone is unavailable. Open this page in Chrome on localhost.');
   const request=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   // If the prompt is ignored or cancelled, stop any stream granted later.
   request.then(stream=>{if(this.cancelled)stream.getTracks().forEach(track=>track.stop());}).catch(()=>{});
   let timer;try{this.stream=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Microphone permission is still pending. Check the microphone icon or site settings in Chrome, then try again.')),20000);})]);}finally{clearTimeout(timer)}
   if(this.cancelled){this.stream.getTracks().forEach(track=>track.stop());return;}
   this.notify('status','Connecting to voice server');
   this.context=new AudioContext();await this.context.resume();
   if(this.cancelled)return;
   this.ws=new WebSocket(this.url);this.ws.binaryType='arraybuffer';
   await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=()=>reject(new Error('Voice server unavailable'));this.ws.onclose=()=>reject(new Error('Voice connection closed before it was ready'));});
   if(this.cancelled){this.ws?.close();return;}
   this.running=true;this.ready=false;this.nextTime=0;
   this.readyTimer=setTimeout(()=>{if(this.running&&!this.ready){this.notify('error','Gemini Live is taking too long to connect. Check the internet connection and restart voice.');this.stop();}},20000);
   this.ws.onmessage=event=>this.handle(JSON.parse(event.data));
   this.ws.onclose=()=>{if(this.running){this.notify('error','Voice disconnected. Use text chat or reconnect.');this.stop();}};
   const src=this.context.createMediaStreamSource(this.stream), node=this.context.createScriptProcessor(4096,1,1);
   this.source=src;this.node=node;
   node.onaudioprocess=e=>{if(!this.running||this.ws.readyState!==WebSocket.OPEN)return;const input=e.inputBuffer.getChannelData(0);let peak=0;for(let j=0;j<input.length;j++)peak=Math.max(peak,Math.abs(input[j]));const now=Date.now();if(now-this.lastLevelAt>1000){this.lastLevelAt=now;this.notify('level',peak>0.015?'sound':'quiet');}const ratio=this.context.sampleRate/16000,count=Math.floor(input.length/ratio),out=new Int16Array(count);for(let i=0;i<count;i++){const v=Math.max(-1,Math.min(1,input[Math.floor(i*ratio)]));out[i]=v<0?v*32768:v*32767;}this.ws.send(out.buffer);};
   src.connect(node);node.connect(this.context.destination);this.notify('status','Microphone streaming · Connecting to Gemini Live');
  }catch(e){this.stop();if(e?.name==='NotAllowedError')throw new Error('Microphone permission denied. Allow microphone access in Chrome site settings and macOS Privacy & Security, then try again.');if(e?.name==='NotFoundError')throw new Error('No microphone found. Connect or select a microphone in macOS settings.');throw e;}finally{this.starting=false;}
 }
 async handle(d){
  if(!this.running)return;
  if(d.type==='ready'){this.ready=true;clearTimeout(this.readyTimer);this.notify('status','Voice ready · Speak Vietnamese');}
  else if(d.type==='tool_call'){
   let result;try{const api=document.modelContext;if(!api?.getTools||!api.executeTool)throw new Error('WebMCP unavailable');const tools=await api.getTools(),tool=tools.find(t=>t.name===d.name);if(!tool)throw new Error('Tool not found: '+d.name);this.notify('tool',d.name+' '+JSON.stringify(d.arguments));result=await api.executeTool(tool,d.arguments);}catch(e){result={error:'WEBMCP_UNAVAILABLE',message:e.message};this.notify('error',e.message)}
   if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({type:'tool_result',id:d.id,result}));
  } else if(d.type==='audio'){
   const raw=atob(d.data),data=new Int16Array(raw.length/2);for(let i=0;i<data.length;i++)data[i]=(raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8))<<16>>16;
   const buffer=this.context.createBuffer(1,data.length,24000),channel=buffer.getChannelData(0);for(let i=0;i<data.length;i++)channel[i]=data[i]/32768;
   const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);const at=Math.max(this.context.currentTime,this.nextTime||0);source.start(at);this.nextTime=at+buffer.duration;this.sources.add(source);source.onended=()=>this.sources.delete(source);
  } else if(d.type==='interrupted'){for(const s of this.sources)try{s.stop()}catch{}this.sources.clear();this.nextTime=0;}
  else if(d.type==='transcript')this.notify(d.role,d.text);
  else if(d.type==='error'){this.notify('error',d.message);this.stop();}
 }
 stop(){
  this.cancelled=true;this.running=false;this.ready=false;clearTimeout(this.readyTimer);
  const node=this.node,source=this.source,stream=this.stream,ws=this.ws,context=this.context;
  this.node=null;this.source=null;this.stream=null;this.ws=null;this.context=null;
  if(node){node.onaudioprocess=null;node.disconnect();}source?.disconnect();stream?.getTracks().forEach(t=>t.stop());
  for(const s of this.sources)try{s.stop()}catch{}this.sources.clear();
  if(ws&&ws.readyState<2)ws.close();
  if(context&&context.state!=='closed')context.close().catch(error=>{if(error?.name!=='InvalidStateError')console.error('Could not close audio context:',error);});
  this.notify('status','Voice stopped');
 }
}
