/** Collection photo actions. Drafts stay visible until their stored bytes verify. */
import { esc } from './chrome.ts';
import { storedCapturer } from './who.ts';
import { allEntries, getEntry, putEntry } from './photo-addition-store.ts';
import { putVerifiedCapture } from './verified-photos.ts';
import { drainAdditions, additionError } from './photo-additions.ts';
import { PHOTO_LONG_EDGE, scaleTo, type QueuedCapture } from './queue-logic.ts';
export interface PhotoRequest { id: string; reason: string; requestedBy: string; requestedAt: string; afterPhotoId: number; resolvedAt?: string; resolvedBy?: string }
export function followupHtml(requests: PhotoRequest[], photoCount: number, latestPhotoId: number): string {
  const open = requests.filter(r => !r.resolvedAt);
  return `<div class="photo-followup">
    ${open.length ? `<div class="photo-needs"><strong>Needs photos</strong><ul>${open.map(r => `<li>${esc(r.reason)} <small>Requested by ${esc(r.requestedBy)}</small>${latestPhotoId > r.afterPhotoId ? `<button class="btn btn-ghost" data-photo-resolve="${esc(r.id)}">I've checked the new photo</button>` : ''}</li>`).join('')}</ul><p>Adding a photo keeps the request open until you check it.</p></div>` : !photoCount ? '<p class="photo-needs">No photos yet. Add clear photographs of the sleeve and disc labels.</p>' : ''}
    <div class="photo-actions"><button class="btn btn-primary" data-add-photos>Add photos</button><button class="btn btn-ghost" data-request-photo>Request another photo</button></div>
    <div data-addition-status role="status" aria-live="polite"></div>
    <div data-photo-form></div>
    ${requests.some(r => r.resolvedAt) ? `<details><summary>Completed photo requests</summary><ul>${requests.filter(r => r.resolvedAt).map(r => `<li>${esc(r.reason)} — checked by ${esc(r.resolvedBy)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}
const token = () => { try { return localStorage.getItem('dg.edit') ?? ''; } catch { return ''; } };
let statusSequence = 0;
export async function refreshAdditionStatus() {
  const sequence = ++statusSequence;
  let entries: QueuedCapture[];
  try { entries = await allEntries(); }
  catch {
    const message = 'Phone storage could not be read. Keep current photos and website data; additional photos cannot be confirmed safely.';
    for (const el of document.querySelectorAll<HTMLElement>('[data-addition-status], [data-collection-upload-status]')) { el.hidden=false; el.textContent=message; }
    return;
  }
  if (sequence !== statusSequence) return;
  const status = document.querySelector<HTMLElement>('[data-addition-status]');
  const id = Number(status?.dataset.item);
  const own = entries.filter(e => e.targetItemId === id);
  const pending = own.filter(e => e.state !== 'synced');
  if (status && !(document.activeElement instanceof HTMLInputElement && status.contains(document.activeElement))) {
    const failed = pending.find(e => e.lastError);
    status.innerHTML = pending.length ? `<p class="photo-needs">${pending.reduce((n,e)=>n+e.photos.length,0)} photos ${pending.some(e=>e.state==='syncing') ? 'uploading' : 'saved on this device; not yet added online'}.${!token() ? ' Unlock editing to upload.' : ''} ${esc(failed?.lastError ?? additionError() ?? '')}</p>${!token() || failed?.lastError?.includes('401') ? '<label class="field"><span>Editing passphrase</span><input type="password" data-photo-unlock autocomplete="current-password"></label>' : ''}<button class="btn btn-ghost" data-retry-photos>Retry upload</button> <a href="/recovery.html">Save queued work</a>` : own.some(e => e.photos.some(p => !Array.from(document.querySelectorAll('.record-photos img')).some(img => img.getAttribute('src')?.endsWith('/' + p.key)))) ? '<p>Photos added online. <button class="btn btn-ghost" data-view-added>View added photos</button></p>' : '';
  }
  const total = entries.filter(e=>e.state!=='synced');
  const banner = document.querySelector<HTMLElement>('[data-collection-upload-status]');
  if (banner) { banner.hidden = !total.length; banner.innerHTML = `${total.reduce((n,e)=>n+e.photos.length,0)} additional photos awaiting online confirmation. <a href="/recovery.html">Upload details / save queued work</a>`; }
}
async function resize(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const target = scaleTo(img.naturalWidth, img.naturalHeight, PHOTO_LONG_EDGE);
    if (!target) return file;
    const canvas = document.createElement('canvas'); canvas.width=target.width; canvas.height=target.height;
    const ctx=canvas.getContext('2d'); if (!ctx) throw new Error('Could not prepare this photo');
    ctx.drawImage(img,0,0,target.width,target.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not prepare this photo')),'image/jpeg',0.85));
  } finally { URL.revokeObjectURL(url); }
}
export function wirePhotoActions(panel: HTMLElement, id: number, title: string, reload: () => Promise<void>) {
  const status = panel.querySelector<HTMLElement>('[data-addition-status]')!; status.dataset.item=String(id);
  void refreshAdditionStatus();
  const area = panel.querySelector<HTMLElement>('[data-photo-form]')!;
  const authHtml = () => `${token() ? '<details><summary>Editing unlocked</summary>' : ''}<label class="field"><span>Editing passphrase${token() ? ' (already saved on this device)' : ''}</span><input type="password" name="passphrase" autocomplete="current-password" placeholder="${token() ? 'Leave blank to use saved passphrase' : 'Unlock editing'}"></label>${token() ? '</details>' : ''}`;
  const authenticate = (form: HTMLFormElement) => {
    if (!storedCapturer()) throw new Error('Set your name on this device first.');
    const entered = (form.elements.namedItem('passphrase') as HTMLInputElement | null)?.value;
    if (entered) localStorage.setItem('dg.edit',entered);
    if (!token()) throw new Error('Enter the editing passphrase.');
  };
  const post = async (body: unknown) => {
    const res=await fetch(`/api/items/${id}/photo-requests`,{method:'POST',headers:{'content-type':'application/json','x-edit-token':token(),'x-capturer':storedCapturer()??''},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
    const reply=await res.json() as {error?:string};
    if (!res.ok) { if(res.status===401)localStorage.removeItem('dg.edit'); throw new Error(reply.error??'Request could not be saved'); }
  };
  panel.addEventListener('click',async e=>{
    const button=(e.target as Element).closest<HTMLButtonElement>('button'); if(!button)return;
    if(button.matches('[data-view-added]')){ await reload(); return; }
    if(button.matches('[data-retry-photos]')){const entered=panel.querySelector<HTMLInputElement>('[data-photo-unlock]')?.value;if(entered)localStorage.setItem('dg.edit',entered);if(!token()){area.innerHTML='<p class="photo-needs">Open Add photos or Request another photo to enter the editing passphrase, then retry.</p>';return;}await drainAdditions(true); await refreshAdditionStatus();return;}
    if(button.matches('[data-request-photo], [data-photo-resolve]')){
      const resolveId=button.dataset.photoResolve;
      const requestId=resolveId??crypto.randomUUID();
      area.innerHTML=`<form class="photo-request-form">${resolveId?'<p>Check that the new online photo clearly shows what was requested.</p>':'<label class="field"><span>What needs photographing?</span><input name="reason" required maxlength="300" placeholder="e.g. Side B label — catalogue number is blurred"></label>'}${authHtml()}<p role="status"></p><button class="btn btn-primary">${resolveId?'Mark checked':'Save request'}</button> <button type="button" class="btn btn-ghost" data-cancel-request>Cancel</button></form>`;
      const form=area.querySelector('form')!;
      form.querySelector('[data-cancel-request]')!.addEventListener('click',()=>{area.innerHTML='';});
      form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector<HTMLButtonElement>('button')!;submit.disabled=true;try{authenticate(form);await post({action:resolveId?'resolve':'request',requestId,reason:(form.elements.namedItem('reason') as HTMLInputElement|null)?.value});await reload();}catch(err){form.querySelector('[role=status]')!.textContent=String(err);const unlock=form.querySelector('details');if(unlock)unlock.open=true;}finally{submit.disabled=false;}};
      form.querySelector<HTMLInputElement>('input')?.focus();return;
    }
    if(!button.matches('[data-add-photos]'))return;
    const dialog=document.createElement('dialog');dialog.className='photo-add-dialog';
    dialog.innerHTML=`<form><h2>Add photos</h2><p><strong>${esc(title)}</strong><br>Item ${id} · These photos will be added to this record.</p>
      <div class="photo-actions"><button class="btn" type="button" data-open-camera>Take photo</button><input type="file" accept="image/*" capture="environment" data-camera hidden><button class="btn btn-ghost" type="button" data-open-library>Choose photos</button><input type="file" accept="image/*" multiple data-library hidden></div>
      <div class="photo-draft-previews"></div>${authHtml()}<p role="status" aria-live="polite">Choose clear photographs of the requested details.</p><button class="btn btn-primary" type="submit">Save photos to this record</button> <button class="btn btn-ghost" type="button" data-close-photos>Close</button></form>`;
    document.body.appendChild(dialog);dialog.showModal();
    dialog.querySelector('[data-open-camera]')!.addEventListener('click',()=>dialog.querySelector<HTMLInputElement>('[data-camera]')!.click());
    dialog.querySelector('[data-open-library]')!.addEventListener('click',()=>dialog.querySelector<HTMLInputElement>('[data-library]')!.click());
    const form=dialog.querySelector('form')!, msg=form.querySelector<HTMLElement>('[role=status]')!;
    const draft:{blob:Blob;url:string}[]=[];let busy=false, saved=false;
    const clientId='add-'+crypto.randomUUID();
    const beforeUnload=(e:BeforeUnloadEvent)=>{if(draft.length&&!saved){e.preventDefault();e.returnValue='';}};addEventListener('beforeunload',beforeUnload);
    const close=()=>{if(busy||draft.length&&!saved){msg.textContent='Save these photos before closing. Remove unwanted photos individually.';return;}dialog.close();};
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.addEventListener('close',()=>{draft.forEach(p=>URL.revokeObjectURL(p.url));removeEventListener('beforeunload',beforeUnload);dialog.remove();});
    form.querySelector('[data-close-photos]')!.addEventListener('click',close);
    const paint=()=>{form.querySelector('.photo-draft-previews')!.innerHTML=draft.map((p,i)=>`<figure><img src="${p.url}" alt="New photo ${i+1}"><button type="button" class="btn btn-ghost" data-remove-photo="${i}">Remove ${i+1}</button></figure>`).join('');};
    form.addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLElement>('[data-remove-photo]');if(b&&!busy){const i=Number(b.dataset.removePhoto);URL.revokeObjectURL(draft[i]!.url);draft.splice(i,1);paint();}});
    for(const input of form.querySelectorAll<HTMLInputElement>('input[type=file]'))input.onchange=async()=>{
      if(busy)return;busy=true;
      try {for(const f of Array.from(input.files??[])){if(draft.length>=20)throw new Error('Save these 20 photos before adding more.');const blob=await resize(f);if(blob.size>12*1024*1024)throw new Error('Photo is too large; choose a smaller copy.');draft.push({blob,url:URL.createObjectURL(blob)});}msg.textContent=`${draft.length} photos ready to save.`;}catch(err){msg.textContent=`Could not prepare photo: ${String(err)}. Keep the original in Photos.`;}finally{busy=false;input.value='';paint();}
    };
    form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;
      try {if(!draft.length)throw new Error('Choose a photo first.');authenticate(form);msg.textContent='Saving and checking photo bytes…';
        const entry:QueuedCapture={clientId,targetItemId:id,createdAt:Date.now(),msToCapture:0,fields:{capturedBy:storedCapturer()!,titleRaw:title},photos:draft.map((p,i)=>({blob:p.blob,kind:'other',key:`${clientId}-${i+1}.jpg`})),state:'pending',attempts:0,nextAttemptAt:0};
        await putVerifiedCapture(entry,{put:putEntry,get:getEntry});saved=true;busy=false;dialog.close();void refreshAdditionStatus().catch(() => {});void drainAdditions(true).then(refreshAdditionStatus).catch(() => {});
      }catch(err){msg.textContent=`Photos NOT safely saved. Keep this screen open and retry. ${String(err)}`;}finally{busy=false;}
    };
  });
}
