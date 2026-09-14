import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/bindings.mjs';
import { createApp } from '../../worker/index.ts';
import { createSyncController } from '../../src/sync-engine.ts';
import { completePhotoReceipt } from '../../src/verified-photos.ts';
import { queueMetadata } from '../../src/queue-backup.ts';
const app=createApp();
const headers={'content-type':'application/json','x-edit-token':'fixture-secret','x-capturer':'Joe'};
const post=(env,path,body,h=headers)=>app.request(path,{method:'POST',headers:h,body:JSON.stringify(body)},env);
async function setup(){const env=makeEnv();env.EDIT_TOKEN='fixture-secret';const r=await post(env,'/api/captures',{clientId:'original',catnoRaw:'HUMAN'});const {itemId}=await r.json();return {env,id:itemId};}
const detail=(env,id)=>app.request(`/api/items/${id}`,{headers:{'x-capturer':'Joe'}},env).then(r=>r.json());
const add=(env,id,key)=>post(env,`/api/items/${id}/photos`,{clientId:'additional',photos:[{kind:'other',r2Key:key}]});
test('photo follow-up requires edit credentials and named person; absent items cannot acquire metadata',async()=>{
 const {env,id}=await setup();const body={action:'request',requestId:'req',reason:'Side B label'};
 assert.equal((await post(env,`/api/items/${id}/photo-requests`,body,{'content-type':'application/json'})).status,401);
 assert.equal((await post(env,`/api/items/${id}/photo-requests`,body,{'content-type':'application/json','x-edit-token':'fixture-secret'})).status,401);
 assert.equal((await post(env,'/api/items/999/photo-requests',body)).status,404);
 assert.equal((await add(env,999,'labels/test.jpg')).status,404);
 assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM raw_value').get().n,0);
});
test('requests are shared, idempotent, excluded from readings and remain open until a person checks new online photos',async()=>{
 const {env,id}=await setup();const before=await detail(env,id);
 const path=`/api/items/${id}/photo-requests`,body={action:'request',requestId:'req',reason:'Side B label'};
 assert.equal((await post(env,path,body)).status,200);assert.equal((await post(env,path,body)).status,200);
 let d=await detail(env,id);assert.equal(d.photoRequests.length,1);assert.equal(d.readings.length,0);
 let list=await (await app.request('/api/items',{},env)).json();assert.equal(list.items[0].photo_needed,'Side B label');assert.equal(list.items[0].reading_count,0);
 assert.equal((await post(env,path,{action:'resolve',requestId:'req'})).status,400);
 await env.PHOTOS.put('labels/new.jpg',new Uint8Array([1,2,3]));assert.equal((await add(env,id,'labels/new.jpg')).status,200);
 d=await detail(env,id);assert.equal(d.photoRequests[0].resolvedAt,undefined);
 assert.equal((await post(env,path,{action:'resolve',requestId:'req'})).status,200);
 d=await detail(env,id);assert.equal(d.photoRequests[0].resolvedBy,'Joe');assert.deepEqual(d.captures,before.captures);assert.deepEqual(d.provenance,before.provenance);assert.deepEqual(d.item,before.item);
 list=await (await app.request('/api/items',{},env)).json();assert.equal(list.items[0].photo_needed,null);
});
test('attachment replay cannot create another record, duplicate a photo, or move another record photo',async()=>{
 const {env,id}=await setup();await env.PHOTOS.put('labels/new.jpg',new Uint8Array([1]));
 assert.equal((await add(env,id,'labels/new.jpg')).status,200);assert.equal((await add(env,id,'labels/new.jpg')).status,200);
 const other=await (await post(env,'/api/captures',{clientId:'second',catnoRaw:'SECOND'})).json();
 assert.equal((await add(env,other.itemId,'labels/new.jpg')).status,409);
 assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM item').get().n,2);assert.equal((await detail(env,id)).photos.length,1);assert.equal((await detail(env,other.itemId)).photos.length,0);
});
test('missing online bytes or malformed batch never produce attachment rows',async()=>{
 const {env,id}=await setup();assert.equal((await add(env,id,'labels/missing.jpg')).status,409);
 assert.equal((await post(env,`/api/items/${id}/photos`,{clientId:'add',photos:[]})).status,409);
 assert.equal((await add(env,id,'labels/../private')).status,409);assert.equal((await detail(env,id)).photos.length,0);
});
test('addition queue sends only to existing item endpoint and checks that exact target receipt',async()=>{
 let row={clientId:'add-fixture',targetItemId:72,createdAt:1,msToCapture:0,fields:{capturedBy:'Joe'},photos:[{key:'extra.jpg',kind:'other',blob:new Blob(['PHOTO'])}],state:'pending',attempts:0,nextAttemptAt:0};
 const calls=[];const ctl=createSyncController({allEntries:async()=>[row],putEntry:async e=>{row=e},pruneSynced:async()=>{},headers:()=>({'x-edit-token':'fixture'}),fetch:async(url,init)=>{calls.push({url,init});return Response.json(url.startsWith('/api/photos/')?{r2Key:'labels/extra.jpg'}:{itemId:72})},verifyReceipt:async(e,id)=>completePhotoReceipt(e,id,{item:{id:72,import_ref:'capture:original'},captures:[{id:1}],photos:[{r2_key:'labels/extra.jpg'}]})});
 await ctl.run();assert.equal(row.state,'synced');assert.equal(calls[1].url,'/api/items/72/photos');assert.equal(calls[1].init.headers['x-edit-token'],'fixture');assert.equal(calls.some(c=>c.url==='/api/captures'),false);
 assert.equal(completePhotoReceipt(row,73,{item:{id:73},captures:[{}],photos:[{r2_key:'labels/extra.jpg'}]}),false);
 const backup=JSON.parse(queueMetadata([row],'https://fixture.invalid'));assert.equal(backup.entries[0].targetItemId,72);
});
test('attachment guard and request replay preserve existing evidence',async()=>{
 const {env,id}=await setup();
 assert.equal((await post(env,`/api/items/${id}/photos`,{clientId:'add',photos:[]},{'content-type':'application/json'})).status,401);
 const path=`/api/items/${id}/photo-requests`;
 await post(env,path,{action:'request',requestId:'stable',reason:'Label'});
 assert.equal((await post(env,path,{action:'request',requestId:'stable',reason:'Different'})).status,400);
 assert.equal((await detail(env,id)).photoRequests[0].reason,'Label');
 await env.PHOTOS.put('labels/empty.jpg',new Uint8Array());assert.equal((await add(env,id,'labels/empty.jpg')).status,409);
});
test('saved addition verifies its target and accepts existing items without a capture row',async()=>{
 const {putVerifiedCapture}=await import('../../src/verified-photos.ts');
 const entry={clientId:'additional',targetItemId:72,createdAt:1,msToCapture:0,fields:{},photos:[{key:'p.jpg',kind:'other',blob:new Blob(['PHOTO'])}],state:'pending',attempts:0,nextAttemptAt:0};
 let row;await assert.rejects(putVerifiedCapture(entry,{put:async e=>{row=e},get:async()=>({...row,targetItemId:73})}),/read back/);
 assert.equal(completePhotoReceipt(entry,72,{item:{id:72},captures:[],photos:[{r2_key:'labels/p.jpg'}]}),true);
 const backup=JSON.parse(queueMetadata([entry],'https://fixture.invalid'));assert.equal(backup.version,2);
});
