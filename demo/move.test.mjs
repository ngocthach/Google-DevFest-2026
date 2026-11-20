import assert from 'node:assert/strict';
import {createRoomLab} from './core.mjs';
const lab=createRoomLab();
const tool=lab.tools.find(t=>t.name==='move_room');
assert.ok(tool,'move_room must be registered');
assert.deepEqual(tool.inputSchema.required,['id','x','y','expectedRevision']);
const kitchen=()=>lab.snapshot().rooms.find(r=>r.id==='kitchen');
const furnitureBefore=structuredClone(kitchen().furniture);
// Rejections leave geometry, history and revision unchanged.
const before=lab.snapshot();
assert.equal(lab.move({id:'kitchen',x:8,y:6,expectedRevision:1}).error,'STALE_REVISION');
assert.equal(lab.move({id:'missing',x:8,y:6,expectedRevision:0}).error,'UNKNOWN_ROOM');
assert.equal(lab.move({id:'kitchen',x:NaN,y:6,expectedRevision:0}).error,'INVALID_POSITION');
assert.equal(lab.move({id:'kitchen',x:9,y:6,expectedRevision:0}).error,'OUTSIDE_PLOT');
assert.equal(lab.move({id:'kitchen',x:8,y:7,expectedRevision:0}).error,'OUTSIDE_PLOT');
assert.equal(lab.move({id:'kitchen',x:-1,y:6,expectedRevision:0}).error,'OUTSIDE_PLOT');
assert.equal(lab.move({id:'kitchen',x:2,y:2,expectedRevision:0}).error,'OVERLAP');
assert.equal(lab.move({id:'kitchen',x:0,y:6,expectedRevision:0}).error,'NO_CHANGE');
assert.deepEqual(lab.snapshot(),before);
// A valid move via the agent tool keeps size, area and room-relative furniture.
const moved=tool.execute({id:'kitchen',x:8,y:6,expectedRevision:0});
assert.equal(moved.ok,true);assert.deepEqual(moved.from,{x:0,y:6});
assert.deepEqual([kitchen().x,kitchen().y,kitchen().width,kitchen().height,kitchen().area],[8,6,4,4,16]);
assert.deepEqual(kitchen().furniture.map(({widthM,heightM,...f})=>f),furnitureBefore.map(({widthM,heightM,...f})=>f));
assert.equal(lab.snapshot().revision,1);assert.match(lab.snapshot().events.at(-1),/^agent: kitchen moved to \(8, 6\)/);
// Touching edges is allowed; the freed space can be reused.
assert.equal(lab.move({id:'bedroom',x:4,y:0,expectedRevision:1}).ok,true);
assert.equal(lab.create({id:'study',name:'Study',x:0,y:6,width:4,height:4,expectedRevision:2}).ok,true);
// Undo restores the previous positions one edit at a time.
lab.undo();lab.undo();assert.equal(lab.snapshot().rooms.find(r=>r.id==='bedroom').x,6);
lab.undo();assert.deepEqual([kitchen().x,kitchen().y],[0,6]);
console.log('PASS: move_room keeps size and furniture, rejects stale/unknown/invalid/outside/overlap/no-op moves atomically, undo restores');
