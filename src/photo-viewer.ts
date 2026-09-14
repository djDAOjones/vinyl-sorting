/** A modal viewport view of the same authenticated image as its thumbnail. */
export function installPhotoViewer(): void {
  let dialog: HTMLDialogElement | null = null;
  let trigger: HTMLElement | null = null;

  const open = (target: HTMLElement): void => {
    const thumbnail = target instanceof HTMLImageElement
      ? target : target.querySelector<HTMLImageElement>('img');
    const src = target instanceof HTMLAnchorElement ? target.href : thumbnail?.src;
    if (!src) return;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'photo-viewer';
      dialog.setAttribute('aria-label', 'Full-screen photograph');
      dialog.innerHTML = '<button type="button" class="btn btn-quiet photo-close" autofocus>Close photograph</button><img alt="">';
      document.body.appendChild(dialog);
      dialog.querySelector('button')!.addEventListener('click', () => dialog?.close());
      dialog.addEventListener('close', () => {
        document.documentElement.classList.remove('photo-viewer-open');
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
      // Do not let the queue's single-key actions or the collection's
      // Escape handler operate on a record behind the photograph.
      dialog.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); dialog?.close(); }
      });
    }
    trigger = target;
    const image = dialog.querySelector('img')!;
    image.alt = thumbnail?.alt || target.getAttribute('aria-label') || 'Record photograph';
    image.referrerPolicy = thumbnail?.referrerPolicy || 'no-referrer';
    image.src = src;
    document.documentElement.classList.add('photo-viewer-open');
    dialog.showModal();
  };

  document.addEventListener('click', (e) => {
    const target = (e.target as Element | null)?.closest<HTMLElement>('[data-photo-viewer]');
    if (!target || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    open(target);
  });
  document.addEventListener('keydown', (e) => {
    const target = (e.target as Element | null)?.closest<HTMLElement>('[data-photo-viewer]');
    if (!target || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    open(target);
  });
}
