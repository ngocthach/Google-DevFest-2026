// Approximate standard footprints in metres, drawn at the same scale as the room.
export const FURNITURE_SIZES = Object.freeze({sofa:[2,0.9],chair:[0.6,0.6],table:[1.2,0.7],desk:[1.2,0.6],bed:[1.6,2],bookshelf:[0.9,0.35],plant:[0.5,0.5],lamp:[0.3,0.3]});
const EPS=1e-7;
function footprint(room,item){const [width,height]=FURNITURE_SIZES[item.kind];const cx=item.x*room.width,cy=item.y*room.height;return {left:cx-width/2,right:cx+width/2,top:cy-height/2,bottom:cy+height/2,width,height};}
function fits(room,item,ignoreId){const a=footprint(room,item);if(a.left < -EPS || a.top < -EPS || a.right > room.width+EPS || a.bottom > room.height+EPS)return 'FURNITURE_OUTSIDE_ROOM';for(const other of room.furniture??[]){if(other.id===ignoreId)continue;const b=footprint(room,other);if(a.left<b.right-EPS && a.right>b.left+EPS && a.top<b.bottom-EPS && a.bottom>b.top+EPS)return 'FURNITURE_OVERLAP';}return null;}
export function createRoomLab(onChange = () => {}) {
 const initial = () => ({revision:0,rooms:[{id:'living',name:'Living room',x:0,y:0,width:4,height:4,furniture:[{id:'initial-sofa',kind:'sofa',position:'custom',x:0.5,y:0.16},{id:'initial-coffee-table',kind:'table',position:'custom',x:0.5,y:0.5}]},{id:'bedroom',name:'Bedroom',x:6,y:0,width:4,height:4,furniture:[{id:'initial-bed',kind:'bed',position:'custom',x:0.5,y:0.3}]},{id:'kitchen',name:'Kitchen',x:0,y:6,width:4,height:4,furniture:[{id:'initial-kitchen-table',kind:'table',position:'custom',x:0.5,y:0.4}]}]});
 let state=initial(),history=[],events=[];
 const snapshot=()=>structuredClone({...state,plot:{width:12,height:10,unit:'metres'},rooms:state.rooms.map(r=>({...r,area:r.width*r.height,furniture:(r.furniture??[]).map(f=>({...f,widthM:FURNITURE_SIZES[f.kind][0],heightM:FURNITURE_SIZES[f.kind][1]}))})),events});
 function resize(input,actor='human') {
  const {id,width,height,expectedRevision}=input??{};
  if(!Number.isInteger(expectedRevision)||expectedRevision!==state.revision)return {ok:false,error:'STALE_REVISION',message:'Inspect the current plan and retry.',revision:state.revision};
  const room=state.rooms.find(r=>r.id===id);
  if(!room)return {ok:false,error:'UNKNOWN_ROOM',message:'Use a room ID returned by inspect_plan.'};
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>12||height>10)return {ok:false,error:'INVALID_SIZE',message:'Width must be 1–12 m and height 1–10 m.'};
  const next={...room,width,height};
  if(next.x+width>12||next.y+height>10)return {ok:false,error:'OUTSIDE_PLOT',message:'Keep the room within the 12 × 10 m plot.'};
  if(state.rooms.some(r=>r.id!==id&&next.x<r.x+r.width&&next.x+width>r.x&&next.y<r.y+r.height&&next.y+height>r.y))return {ok:false,error:'OVERLAP',message:'This edit overlaps another room. Inspect the plan and choose smaller dimensions.'};
  for(const item of next.furniture??[]){const issue=fits(next,item,item.id);if(issue)return {ok:false,error:issue,message:'The resized room would put furniture outside the room or cause overlap. Move furniture first.'};}
  history.push(structuredClone(state.rooms));state.rooms=state.rooms.map(r=>r.id===id?next:r);state.revision++;events.push(`${actor}: ${id} resized to ${width} × ${height} m`);onChange(snapshot());return {ok:true,room:{...next,area:width*height},revision:state.revision};
 }
 function create(input,actor='human') {
  const {id,name,x,y,width,height,expectedRevision}=input??{};
  if(!Number.isInteger(expectedRevision)||expectedRevision!==state.revision)return {ok:false,error:'STALE_REVISION',message:'Inspect the current plan and retry.',revision:state.revision};
  if(typeof id!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(id)||typeof name!=='string'||!name.trim()||name.length>60)return {ok:false,error:'INVALID_ROOM',message:'Use a lowercase ID and a nonempty room name (maximum 60 characters).'};
  if(state.rooms.some(r=>r.id===id))return {ok:false,error:'DUPLICATE_ROOM',message:'Choose a unique room ID.'};
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>12||height>10)return {ok:false,error:'INVALID_SIZE',message:'Width must be 1–12 m and height 1–10 m.'};
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x+width>12||y+height>10)return {ok:false,error:'OUTSIDE_PLOT',message:'Place the entire room inside the 12 × 10 m plot.'};
  if(state.rooms.some(r=>x<r.x+r.width&&x+width>r.x&&y<r.y+r.height&&y+height>r.y))return {ok:false,error:'OVERLAP',message:'This room overlaps another room. Inspect the plan and choose an empty position.'};
  const room={id,name:name.trim(),x,y,width,height};history.push(structuredClone(state.rooms));state.rooms.push(room);state.revision++;events.push(`${actor}: ${id} created at (${x}, ${y})`);onChange(snapshot());return {ok:true,room:{...room,area:width*height},revision:state.revision};
 }
 function placeFurniture(input,actor='human') {
  const {roomId,kind,position='auto',expectedRevision}=input??{};
  if(!Number.isInteger(expectedRevision)||expectedRevision!==state.revision)return {ok:false,error:'STALE_REVISION',message:'Inspect the current plan and retry.',revision:state.revision};
  const room=state.rooms.find(r=>r.id===roomId);
  if(!room)return {ok:false,error:'UNKNOWN_ROOM',message:'Use a room ID returned by inspect_plan.'};
  const kinds=['sofa','chair','table','desk','bed','bookshelf','plant','lamp'];
  if(!kinds.includes(kind))return {ok:false,error:'UNSUPPORTED_FURNITURE',message:'Supported furniture: '+kinds.join(', ')};
  if(!['auto','left','center','right'].includes(position))return {ok:false,error:'INVALID_POSITION',message:'Position must be auto, left, center or right.'};
  const items=room.furniture??[];
  if(items.length>=8)return {ok:false,error:'ROOM_FURNITURE_LIMIT',message:'Each room can hold up to eight furniture markers.'};
  const [fw,fh]=FURNITURE_SIZES[kind],candidates=[];
  // Search in metres so a valid rectangle, not just its centre, fits within the room.
  for(let cy=fh/2;cy<=room.height-fh/2+EPS;cy+=0.1)for(let cx=fw/2;cx<=room.width-fw/2+EPS;cx+=0.1){
   const x=cx/room.width,y=cy/room.height;
   if(position==='left'&&x>0.4||position==='right'&&x<0.6||position==='center'&&Math.abs(x-0.5)>0.12)continue;
   const candidate={id:`furniture-${state.revision+1}`,kind,position,x,y};if(!fits(room,candidate))candidates.push(candidate);
  }
  if(!candidates.length)return {ok:false,error:'NO_FURNITURE_SPACE',message:'No non-overlapping location fits this item in the requested area of the room.'};
  // Prefer some space between objects and choose a stable location.
  const separation=p=>items.length?Math.min(...items.map(f=>Math.hypot((p.x-f.x)*room.width,(p.y-f.y)*room.height))):0;
  candidates.sort((a,b)=>separation(b)-separation(a));
  const item=candidates[0];
  history.push(structuredClone(state.rooms));
  state.rooms=state.rooms.map(r=>r.id===roomId?{...r,furniture:[...items,item]}:r);
  state.revision++;events.push(`${actor}: placed ${kind} in ${room.name}`);onChange(snapshot());
  return {ok:true,roomId,furniture:item,revision:state.revision,message:'Furniture footprint is shown to scale using approximate preset dimensions in metres.'};
 }
 function moveFurniture(input,actor='human') {
  const {roomId,furnitureId,x,y,expectedRevision}=input??{};
  if(!Number.isInteger(expectedRevision)||expectedRevision!==state.revision)return {ok:false,error:'STALE_REVISION',message:'Inspect the current plan and retry.',revision:state.revision};
  const room=state.rooms.find(r=>r.id===roomId);
  if(!room)return {ok:false,error:'UNKNOWN_ROOM',message:'Use a room ID returned by inspect_plan.'};
  const item=room.furniture?.find(f=>f.id===furnitureId);
  if(!item)return {ok:false,error:'UNKNOWN_FURNITURE',message:'Use a furniture ID returned by inspect_plan.'};
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return {ok:false,error:'INVALID_POSITION',message:'Use room-relative centre coordinates between 0 and 1.'};
  const next={...item,x,y,position:'custom'};
  const issue=fits(room,next,item.id);if(issue)return {ok:false,error:issue,message:issue==='FURNITURE_OVERLAP'?'Furniture overlaps another item. Choose a clear position.':'Furniture must fit completely inside the room.'};
  history.push(structuredClone(state.rooms));state.rooms=state.rooms.map(r=>r.id===roomId?{...r,furniture:r.furniture.map(f=>f.id===furnitureId?next:f)}:r);
  state.revision++;events.push(`${actor}: moved ${item.kind} in ${room.name}`);onChange(snapshot());
  return {ok:true,roomId,furniture:next,revision:state.revision,message:'Position is relative to the room. Footprints are checked for overlap and boundaries.'};
 }
 function undo(actor='human') {if(!history.length)return {ok:false,error:'NO_HISTORY'};state.rooms=history.pop();state.revision++;events.push(`${actor}: undid last edit`);onChange(snapshot());return {ok:true,revision:state.revision};}
 function reset(){state=initial();history=[];events=[];onChange(snapshot());}
 const tools=[{name:'inspect_plan',description:'Read all room IDs, positions, dimensions in metres and current revision. Inspect before editing.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>snapshot()},
 {name:'resize_room',description:'Resize one room on the shared plan, in metres. Requires the current revision. Rejects overlap and out-of-bounds edits. Updates the visible plan immediately.',inputSchema:{type:'object',properties:{id:{type:'string'},width:{type:'number',minimum:1,maximum:12},height:{type:'number',minimum:1,maximum:10},expectedRevision:{type:'integer',minimum:0}},required:['id','width','height','expectedRevision'],additionalProperties:false},execute:input=>resize(input,'agent')},
 {name:'create_room',description:'Create a new rectangular room on the shared plan in metres. Coordinates x,y are measured from the top-left of the 12 by 10 plot. Requires the latest revision. Rejects overlap and out-of-bounds rooms.',inputSchema:{type:'object',properties:{id:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,39}$'},name:{type:'string'},x:{type:'number',minimum:0},y:{type:'number',minimum:0},width:{type:'number',minimum:1},height:{type:'number',minimum:1},expectedRevision:{type:'integer',minimum:0}},required:['id','name','x','y','width','height','expectedRevision'],additionalProperties:false},execute:input=>create(input,'agent')},
 {name:'place_furniture',description:'Place a furniture footprint to scale inside an existing room. Inspect the plan first and use the current revision. Supports sofa, chair, table, desk, bed, bookshelf, plant and lamp. Furniture has preset dimensions in metres; the app rejects overlaps and positions outside the room.',inputSchema:{type:'object',properties:{roomId:{type:'string'},kind:{type:'string',enum:['sofa','chair','table','desk','bed','bookshelf','plant','lamp']},position:{type:'string',enum:['auto','left','center','right']},expectedRevision:{type:'integer',minimum:0}},required:['roomId','kind','expectedRevision'],additionalProperties:false},execute:input=>placeFurniture(input,'agent')},
 {name:'move_furniture',description:'Move an existing furniture item within its current room using room-relative x and y coordinates (0 to 1, from top left). Inspect first to obtain the room ID, furniture ID and current revision. The app rejects overlaps and positions outside the room.',inputSchema:{type:'object',properties:{roomId:{type:'string'},furnitureId:{type:'string'},x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},expectedRevision:{type:'integer',minimum:0}},required:['roomId','furnitureId','x','y','expectedRevision'],additionalProperties:false},execute:input=>moveFurniture(input,'agent')},
 {name:'undo_last_edit',description:'Undo the most recent room or furniture edit, including a human edit. Only call when the user requests undo.',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:()=>undo('agent')}];
 return {snapshot,resize,create,placeFurniture,moveFurniture,undo,reset,tools};
}
