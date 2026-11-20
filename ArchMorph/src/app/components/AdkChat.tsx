"use client";
import {useEffect,useRef,useState} from 'react';
import './adk-chat.css';
// @ts-ignore Shared browser audio module.
import {RoomVoice} from './voice.mjs';
// @ts-ignore Shared by text and voice.
import {executeArchMorphRequest} from './adk-webmcp.mjs';
export default function AdkChat({loadSample}:{loadSample:()=>Promise<void>}){
 const [open,setOpen]=useState(true),[status,setStatus]=useState('Connecting'),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[lines,setLines]=useState<{role:string;text:string}[]>([]);
 const socket=useRef<WebSocket|null>(null), bottom=useRef<HTMLDivElement|null>(null), voice=useRef<any>(null);
 const [voiceOn,setVoiceOn]=useState(false),[voiceStatus,setVoiceStatus]=useState('Microphone is off.');
 const toggleVoice=async()=>{if(voice.current?.starting){setVoiceStatus('Allow microphone access in Chrome. Look for a prompt near the address bar.');return}if(voice.current?.running){voice.current.stop();setVoiceOn(false);return}try{voice.current=new RoomVoice('ws://127.0.0.1:8767/voice',(role:string,text:string)=>{if(role==='tool'||role==='error')add(role,text);if(role==='user'||role==='agent')setLines(xs=>{const last=xs[xs.length-1];return last?.role===`voice-${role}`?[...xs.slice(0,-1),{...last,text:last.text.endsWith(text)?last.text:last.text+text}]:[...xs,{role:`voice-${role}`,text}]});if(role==='status'){setVoiceStatus(text==='Waiting for microphone permission'?'Allow microphone access in Chrome. Look for a prompt near the address bar.':text==='Voice stopped'?'Microphone is off.':text);if(text==='Voice stopped')setVoiceOn(false)}});await voice.current.start();setVoiceOn(!!voice.current.running)}catch(e){const detail=e instanceof Error?e.message:'connection failed';setVoiceStatus(detail);add('error',`Voice: ${detail}`);setVoiceOn(false)}};
 const add=(role:string,text:string)=>setLines(xs=>[...xs,{role,text}]);
 useEffect(()=>{const ws=new WebSocket('ws://127.0.0.1:8767/ws');socket.current=ws;ws.onopen=()=>setStatus('ADK connected');ws.onclose=()=>{setStatus('ADK disconnected');setBusy(false)};
 ws.onmessage=async event=>{const data=JSON.parse(event.data);if(data.type==='tool_call'){
   let result:unknown;
   try{result=await executeArchMorphRequest(data.name,data.arguments,(line:string)=>add('tool',line));
   }catch(err){result={status:'error',error:err instanceof Error?err.message:'WebMCP execution failed'};add('error',JSON.stringify(result));}
   if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'tool_result',id:data.id,result}));
  }else if(data.type==='answer')add('agent',data.text);else if(data.type==='error')add('error',data.message);else if(data.type==='done')setBusy(false)};
 return()=>{voice.current?.stop();socket.current=null;ws.close()};},[]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'})},[lines]);
 const send=()=>{const value=draft.trim(),ws=socket.current;if(!value||busy)return;if(!ws||ws.readyState!==WebSocket.OPEN){add('error','Start the local ADK bridge first.');return}add('user',value);ws.send(JSON.stringify({type:'chat',text:value}));setDraft('');setBusy(true)};
 return <aside className={'adk-chat '+(open?'':'adk-chat--closed')}><button className="adk-title" onClick={()=>setOpen(!open)} aria-expanded={open}>✦ ArchMorph assistant <small>{status}</small><span>{open?'−':'+'}</span></button>{open&&<><div className="adk-actions"><button onClick={()=>void toggleVoice()}>{voiceOn?"⏹ Stop voice":"🎙 Voice"}</button><button onClick={()=>void loadSample()}>Load Studio demo</button><button onClick={()=>setDraft('Kiểm tra dự án. Chọn tầng có tên chính xác First Floor, nằm phía trên Ground Floor. Tạo trên tầng First Floor phòng Office tên Creative Studio tại x 6, y 50, rộng 10 và dài 12 feet. Kiểm tra các tường của phòng. Thêm cửa đi rộng 3 feet tại offset 2 trên tường chung với Bedroom West, và cửa sổ casement mở được rộng 4 feet tại offset 2 trên tường ngoài phía tây. Kiểm tra toàn bộ bố cục, lối đi, rồi hiển thị 3D. Báo cáo kết quả và mọi lỗi.')}>Use demo prompt</button></div><div className="adk-foot" role="status">{voiceStatus}</div><div className="adk-lines" aria-live="polite">{lines.length===0&&<p>Ask about the shared design. The agent uses this page’s WebMCP tools.</p>}{lines.map((line,i)=><p key={i} className={`adk-${line.role}`}>{line.text}</p>)}<div ref={bottom}/></div><form onSubmit={e=>{e.preventDefault();send()}}><textarea value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Ask about this home…" aria-label="Message ArchMorph assistant"/><button disabled={busy}>{busy?'Working…':'Send'}</button></form><div className="adk-foot">Concept design only · Check findings with a professional</div></>}</aside>
}
