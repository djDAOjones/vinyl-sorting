import {test} from 'node:test';import assert from 'node:assert/strict';
import {copyVerifiedPhotos,putVerifiedCapture,completePhotoReceipt} from '../../src/verified-photos.ts';
import {createSyncController} from '../../src/sync-engine.ts';
import {SYNC_LEASE_MS,UNDO_MS} from '../../src/queue-logic.ts';
const entry=(id='one')=>({clientId:id,createdAt:1,msToCapture:2,fields:{catnoRaw:'HUMAN TEXT',capturedBy:'Joe'},photos:[{key:id+'.jpg',kind:'other',blob:new Blob(['PHOTO'],{type:'image/jpeg'})}],state:'pending',attempts:0,nextAttemptAt:0});
test('save holds upload, checks both committed writes and preserves original fields and photo bytes',async()=>{
 const source=entry();let stored;const writes=[];let reads=0;
 await putVerifiedCapture(source,{now:()=>1000,put:async e=>{writes.push(e);stored=structuredClone(e)},get:async()=>{reads++;return structuredClone(stored)}});
 assert.equal(writes.length,2);assert.equal(reads,2);assert.equal(writes[0].nextAttemptAt,1000+SYNC_LEASE_MS);assert.equal(writes[1].nextAttemptAt,1000+UNDO_MS);
 assert.deepEqual(stored.fields,source.fields);assert.equal(await stored.photos[0].blob.text(),'PHOTO');assert.match(stored.photos[0].sha256,/^[a-f0-9]{64}$/);assert.equal(source.photos[0].sha256,undefined);assert.notEqual(writes[0].photos[0].blob,source.photos[0].blob);
});
test('a bad first read-back does not release the capture for upload',async()=>{
 let stored,writes=0;
 await assert.rejects(putVerifiedCapture(entry(),{now:()=>1000,put:async e=>{writes++;stored=structuredClone(e)},get:async()=>({...stored,photos:[{...stored.photos[0],blob:new Blob(['OTHER'],{type:'image/jpeg'})}]})}),/checksum/);
 assert.equal(writes,1);assert.equal(stored.nextAttemptAt,1000+SYNC_LEASE_MS);
});
test('second committed write is also checked before save succeeds',async()=>{
 let stored,writes=0;
 await assert.rejects(putVerifiedCapture(entry(),{put:async e=>{writes++;stored=structuredClone(e)},get:async()=>writes===1?stored:{...stored,photos:[]}}),/completely/);assert.equal(writes,2);
});
test('missing stored entry is an explicit failed save',async()=>{
 await assert.rejects(putVerifiedCapture(entry(),{put:async()=>{},get:async()=>undefined}),/could not be read back/);
});
test('later corruption and empty photo bytes fail preflight',async()=>{
 const good=await copyVerifiedPhotos(entry());good.photos[0].blob=new Blob(['OTHER'],{type:'image/jpeg'});await assert.rejects(copyVerifiedPhotos(good),/checksum/);
 const empty=entry();empty.photos[0].blob=new Blob([]);await assert.rejects(copyVerifiedPhotos(empty),/empty or incomplete/);
});
test('full receipt requires the original client ID, a capture row and every expected photo key',()=>{
 const row=entry();const good={item:{id:42,import_ref:'capture:one'},captures:[{id:1}],photos:[{r2_key:'labels/one.jpg'}]};assert.equal(completePhotoReceipt(row,42,good),true);
 for(const bad of [{itemId:42},{...good,captures:[]},{...good,photos:[{r2_key:'labels/wrong.jpg'}]},{...good,item:{id:42,import_ref:'capture:someone-else'}},{...good,photos:[]}])assert.equal(completePhotoReceipt(row,42,bad),false);
});
test('an unreadable queued record is never rewritten and does not block a healthy record',async()=>{
 const rows=new Map(['bad','good'].map(id=>[id,entry(id)]));const writes=[],events=[];
 const c=createSyncController({allEntries:async()=>[...rows.values()],putEntry:async e=>{writes.push(e.clientId);rows.set(e.clientId,e)},pruneSynced:async()=>{},now:()=>1000,
 onEvent:e=>events.push(e),readPhoto:async(e,i)=>{if(e.clientId==='bad')throw new DOMException('missing','NotFoundError');return e.photos[i].blob.arrayBuffer()},
 fetch:async url=>new Response(JSON.stringify(url.startsWith('/api/photos/')?{r2Key:'labels/good.jpg'}:{itemId:42}))});
 assert.deepEqual(await c.run(),{sent:1,failed:1});assert.ok(!writes.includes('bad'));assert.equal(rows.get('bad').state,'pending');assert.equal(rows.get('good').state,'synced');assert.match(c.error(),/unreadable photos/);assert.ok(events.some(e=>/Record bad.*NotFoundError/.test(e)));
});
test('a partial server receipt keeps the local photo and never marks synced',async()=>{
 let row=entry();const c=createSyncController({allEntries:async()=>[row],putEntry:async e=>{row=e},pruneSynced:async()=>{},now:()=>1000,
 fetch:async url=>new Response(JSON.stringify(url.startsWith('/api/photos/')?{r2Key:'labels/one.jpg'}:{itemId:42})),verifyReceipt:async()=>false});
 assert.deepEqual(await c.run(),{sent:0,failed:1});assert.equal(row.state,'failed');assert.match(row.lastError,/every expected photograph/);assert.equal(await row.photos[0].blob.text(),'PHOTO');
});
test('record details are also checked during committed read-back',async()=>{
 let stored;
 await assert.rejects(putVerifiedCapture(entry(),{put:async e=>{stored=structuredClone(e)},get:async()=>({...stored,fields:{...stored.fields,catnoRaw:'different'}})}),/record details did not match/);
});
