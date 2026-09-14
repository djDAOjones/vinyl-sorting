import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildQueueBackup,buildQueueBackupReport,queueMetadata,backupParts,crc32} from '../../src/queue-backup.ts';
const entry=(id,photos=[])=>({clientId:id,createdAt:123,msToCapture:456,fields:{catnoRaw:'Tést Ω',list:'classical'},photos,state:'failed',attempts:7,nextAttemptAt:789,lastError:'HTTP 503'});
function unpack(bytes){const files=new Map();const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
 while(v.getUint32(at,true)===0x04034b50){const n=v.getUint16(at+26,true),size=v.getUint32(at+18,true);assert.equal(v.getUint16(at+8,true),0);const name=new TextDecoder().decode(bytes.subarray(at+30,at+30+n));const body=bytes.subarray(at+30+n,at+30+n+size);assert.equal(crc32(body),v.getUint32(at+14,true));files.set(name,body);at+=30+n+size;}
 assert.equal(v.getUint32(at,true),0x02014b50);assert.equal(v.getUint32(bytes.length-22,true),0x06054b50);assert.equal(v.getUint16(bytes.length-12,true),files.size);return files;
}
test('portable ZIP preserves every metadata field and original photo byte, with SHA-256 and CRC',async()=>{
 const blob=new Blob([new Uint8Array([0,1,2,255,128])],{type:'image/heic'});const row=entry('same-client',[{key:'../original-key.jpg',kind:'other',blob}]);const before=structuredClone(row);
 const zip=await buildQueueBackup([row],{part:1,totalParts:2,origin:'https://fixture.invalid'});const files=unpack(new Uint8Array(await zip.arrayBuffer()));
 const m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));assert.equal(m.part,1);assert.equal(m.totalParts,2);assert.equal(m.entryCount,1);assert.equal(m.photoCount,1);
 const photo=m.entries[0].photos[0];assert.equal(photo.key,'../original-key.jpg');assert.equal(photo.type,'image/heic');assert.equal(photo.size,5);assert.equal(photo.path,'photos/1/1.heic');
 assert.deepEqual(files.get(photo.path),new Uint8Array(await blob.arrayBuffer()));
 const expected=Buffer.from(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())).toString('hex');assert.equal(photo.sha256,expected);
 const restored={...m.entries[0],photos:[{key:photo.key,kind:photo.kind,blob:new Blob([files.get(photo.path)],{type:photo.type})}]};assert.deepEqual(restored,before);assert.deepEqual(row,before);
});
test('parts are bounded by bytes and record count without splitting or losing records',()=>{
 const rows=Array.from({length:45},(_,i)=>entry(String(i),[{key:'k',kind:'other',blob:new Blob(['123456'])}]));
 const parts=backupParts(rows,13);assert.deepEqual(parts.flat(),rows);assert.ok(parts.every(p=>p.length<=2));assert.equal(backupParts(rows,10000).length,3);assert.deepEqual(backupParts([]),[]);
});
test('one oversized record is retained whole and empty-photo records remain exportable',async()=>{
 assert.equal(backupParts([entry('big',[{key:'k',kind:'other',blob:new Blob(['12345'])}])],1)[0].length,1);
 const files=unpack(new Uint8Array(await (await buildQueueBackup([entry('no-photo')],{part:1,totalParts:1,origin:'fixture'})).arrayBuffer()));
 assert.equal(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))).entries[0].clientId,'no-photo');
});
test('CRC is compatible with the standard known vector',()=>assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926));

test('one unreadable photo produces an explicitly incomplete ZIP and does not hide later photos',async()=>{
 const rows=[entry('bad',[{key:'bad.jpg',kind:'other',blob:new Blob(['bad'])},{key:'good.jpg',kind:'other',blob:new Blob(['good'])}]),entry('later',[{key:'last.jpg',kind:'other',blob:new Blob(['last'])}])];
 const original=structuredClone(rows);const issues=[];
 const result=await buildQueueBackupReport(rows,{part:2,totalParts:3,origin:'fixture',allowPartial:true,onIssue:i=>issues.push(i),readPhoto:async(e,i)=>{if(e.clientId==='bad'&&i===0)throw new DOMException('The object can not be found here','NotFoundError');return e.photos[i].blob.arrayBuffer();}});
 assert.equal(result.includedPhotoCount,2);assert.equal(result.sourcePhotoCount,3);assert.equal(result.issues.length,1);assert.match(issues[0].error,/NotFoundError/);assert.equal(issues[0].photoIndex,1);
 const files=unpack(new Uint8Array(await result.blob.arrayBuffer()));const m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
 assert.equal(m.complete,false);assert.equal(m.missingPhotoCount,1);assert.equal(m.entries.length,2);assert.equal(m.entries[0].photos[0].path,null);assert.equal(m.entries[0].photos[0].status,'unreadable');assert.ok(files.has('MISSING-PHOTOS.json'));
 assert.equal(new TextDecoder().decode(files.get(m.entries[1].photos[0].path)),'last');assert.deepEqual(rows,original);
});
test('archive embeds detached verified bytes, not the original storage-backed blob',async()=>{
 const row=entry('detached',[{key:'image.jpg',kind:'other',blob:new Blob(['old'])}]);
 const zip=await buildQueueBackup([row],{part:1,totalParts:1,origin:'fixture',readPhoto:async()=>new TextEncoder().encode('new').buffer});
 const files=unpack(new Uint8Array(await zip.arrayBuffer()));assert.equal(new TextDecoder().decode(files.get('photos/1/1.bin')),'new');
});
test('metadata-only export never reads photo bytes and includes every record and reference',()=>{
 let reads=0;const blob=new Blob(['unreadable']);blob.arrayBuffer=()=>{reads++;throw new DOMException('missing','NotFoundError')};
 const m=JSON.parse(queueMetadata([entry('saved',[{key:'original',kind:'other',blob}])],'fixture'));
 assert.equal(reads,0);assert.equal(m.containsPhotoBytes,false);assert.equal(m.entryCount,1);assert.equal(m.photoCount,1);assert.equal(m.entries[0].photos[0].key,'original');assert.equal(m.entries[0].photos[0].status,'not-read');
});
test('strict export identifies the record and photo and refuses to silently omit failed reads',async()=>{
 await assert.rejects(buildQueueBackup([entry('exact-id',[{key:'exact-key',kind:'other',blob:new Blob(['x'])}])],{part:1,totalParts:1,origin:'fixture',allowPartial:true,readPhoto:async()=>{throw new DOMException('missing','NotFoundError')}}),/exact-id, photo 1.*exact-key.*NotFoundError/);
});
test('truncated and empty reads are explicit failures, never included as intact images',async()=>{
 for(const data of ['', 'short']){
  const report=await buildQueueBackupReport([entry('short',[{key:'key',kind:'other',blob:new Blob(['expected'])}])],{part:1,totalParts:1,origin:'fixture',allowPartial:true,readPhoto:async()=>new TextEncoder().encode(data).buffer});
  assert.equal(report.includedPhotoCount,0);assert.match(report.issues[0].error,/size check failed/);
 }
});
