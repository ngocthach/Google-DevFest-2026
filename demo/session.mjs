import {createRoomLab} from './core.mjs?v=furniture6';
export const chapters=[
 {eyebrow:'01 / DELEGATE',title:'Ask for more space',goal:'The agent changes the actual plan.',lesson:'A tool call updates the app you can see.',prompt:'Inspect the current plan. Resize living to 5 × 4 metres using the current revision. Keep every other room unchanged. Report the result, then inspect again to verify the saved plan.',action:'Agent resize',before:'4 × 4 m · 16 m²',after:'5 × 4 m · 20 m²'},
 {eyebrow:'02 / COLLABORATE',title:'Change your mind',goal:'You edit. The agent notices.',lesson:'Reading the current app state beats remembering an old chat.',prompt:'Inspect the plan again. Report the current living room dimensions, area and revision. Do not change anything.',action:'Agent readback',before:'5 × 4 m · 20 m²',after:'5 × 5 m · 25 m²'},
 {eyebrow:'03 / PROTECT',title:'Try to break the plan',goal:'The app rejects a conflicting edit.',lesson:'The app enforces the rules, even when the agent asks.',prompt:'Inspect the current plan. Try resizing living to 7 × 4 metres using the current revision. If rejected, report the error. Do not make a substitute edit.',action:'Rejected request',before:'5 × 5 m · 25 m²',after:'Still 25 m² · no new revision'},
 {eyebrow:'04 / RECOVER',title:'Take back control',goal:'Undo the last saved change.',lesson:'A rejected request leaves no saved edit to undo.',prompt:'Undo the last valid edit once. Then inspect the plan and report the living room dimensions, area and revision.',action:'Undo',before:'5 × 5 m · 25 m²',after:'5 × 4 m · 20 m²'}
];
export function createSession(onChange=()=>{}){
 const lab=createRoomLab();let focus=0,proofs=[false,false,false,false],trace=[],last=null,observation=null,everNative=false;
 const get=()=>({plan:lab.snapshot(),focus,proofs:[...proofs],trace:structuredClone(trace),last:structuredClone(last),observation:structuredClone(observation),everNative});
 const emit=()=>onChange(get());
 function perform(name,input={},source='unknown'){
  const before=lab.snapshot();let result;
  if(name==='inspect_plan')result=lab.snapshot();
  else if(name==='resize_room')result=lab.resize(input,source);
  else if(name==='create_room')result=lab.create(input,source);
  else if(name==='place_furniture')result=lab.placeFurniture(input,source);
  else if(name==='move_furniture')result=lab.moveFurniture(input,source);
  else if(name==='undo_last_edit')result=lab.undo(source);
  else throw new Error('Unknown tool');
  const after=lab.snapshot(),room=after.rooms.find(r=>r.id==='living');
  if(source==='agent')everNative=true;
  if(name==='resize_room'&&result.ok&&room.width===5&&room.height===4&&source!=='human'){proofs[0]=true;}
  if(name==='inspect_plan'&&source!=='human'){
   observation={area:room.area,width:room.width,height:room.height,revision:after.revision,source};
   if(proofs[0]&&room.width===5&&room.height===5&&after.events.at(-1)?.startsWith('human:'))proofs[1]=true;
  }
  if(proofs[1]&&name==='resize_room'&&result.error==='OVERLAP'&&input.id==='living'&&input.width===7&&input.height===4&&before.rooms[0].area===25&&before.revision===after.revision)proofs[2]=true;
  if(proofs[2]&&name==='undo_last_edit'&&result.ok&&before.rooms[0].area===25&&room.area===20)proofs[3]=true;
  last={name,input:structuredClone(input),source,result:structuredClone(result),beforeRevision:before.revision,afterRevision:after.revision,beforeArea:before.rooms[0].area,afterArea:room.area};
  trace.push({...last,index:trace.length+1});emit();return result;
 }
 function reset(){lab.reset();focus=0;proofs=[false,false,false,false];trace=[];last=null;observation=null;everNative=false;emit();}
 return {get,perform,reset,setFocus(index){focus=Math.max(0,Math.min(3,index));emit();},tools:lab.tools.map(t=>({...t,execute:input=>perform(t.name,input,'agent')}))};
}
