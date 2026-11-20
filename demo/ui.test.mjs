// Browser-API test double: verifies the UI bridge; it is not a native WebMCP test.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.classList={toggle(){},add(){},remove(){}};}
 set textContent(v){this._text=String(v);this.children=[]} get textContent(){return this._text+this.children.map(x=>x.textContent??'').join('')}
 append(...x){this.children.push(...x)} replaceChildren(...x){this._text='';this.children=x} setAttribute(){} addEventListener(){} querySelector(){return null} focus(){} get offsetWidth(){return 600}
}
const html=await fs.readFile(new URL('./index.html',import.meta.url),'utf8');
const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const tools=new Map();
globalThis.document={getElementById:id=>{assert.ok(elements.has(id),`Missing element ${id}`);return elements.get(id)},querySelectorAll:()=>[],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:String(text)}),modelContext:{registerTool:async tool=>tools.set(tool.name,tool),getTools:async()=>[...tools.values()],executeTool:async(tool,input)=>tool.execute(input)}};
globalThis.window={addEventListener(){}};globalThis.location={protocol:'http:',host:'127.0.0.1:8766'};
class Socket {static OPEN=1;constructor(){globalThis.socket=this;this.readyState=1;this.sent=[]}send(data){this.sent.push(JSON.parse(data))}}
globalThis.WebSocket=Socket;
await import('./app.mjs');
const $=id=>elements.get(id);assert.equal(tools.size,7);assert.ok(tools.has('move_room'));assert.match($('status').textContent,/^7 tools registered/);assert.match($('area').textContent,/16/);
$('chat-input').value='Make living 5 by 4';$('chat-form').onsubmit({preventDefault(){}});
assert.equal(socket.sent[0].type,'chat');assert.equal($('chat-send').disabled,true);
await socket.onmessage({data:JSON.stringify({type:'tool_call',id:'1',name:'inspect_plan',arguments:{}})});
assert.equal(socket.sent.at(-1).result.revision,0);
await socket.onmessage({data:JSON.stringify({type:'tool_call',id:'2',name:'resize_room',arguments:{id:'living',width:5,height:4,expectedRevision:0}})});
assert.equal(socket.sent.at(-1).result.ok,true);assert.match($('area').textContent,/20/);assert.equal($('revision').textContent,'r1');
await socket.onmessage({data:JSON.stringify({type:'tool_call',id:'3',name:'resize_room',arguments:{id:'living',width:7,height:4,expectedRevision:1}})});
assert.equal(socket.sent.at(-1).result.error,'OVERLAP');assert.equal($('revision').textContent,'r1');
await socket.onmessage({data:JSON.stringify({type:'tool_call',id:'4',name:'create_room',arguments:{id:'study',name:'Study',x:10,y:0,width:2,height:2,expectedRevision:1}})});
assert.equal(socket.sent.at(-1).result.ok,true);assert.equal($('revision').textContent,'r2');
await socket.onmessage({data:JSON.stringify({type:'tool_call',id:'5',name:'move_room',arguments:{id:'study',x:10,y:8,expectedRevision:2}})});
assert.equal(socket.sent.at(-1).result.ok,true);assert.equal($('revision').textContent,'r3');
await socket.onmessage({data:JSON.stringify({type:'tool_call',id:'6',name:'move_room',arguments:{id:'study',x:0,y:0,expectedRevision:3}})});
assert.equal(socket.sent.at(-1).result.error,'OVERLAP');assert.equal($('revision').textContent,'r3');
await socket.onmessage({data:JSON.stringify({type:'done'})});assert.equal($('chat-send').disabled,false);
console.log('PASS: chat sends messages; simulated browser tool calls inspect, resize, create, move and reject overlap through the UI bridge');
