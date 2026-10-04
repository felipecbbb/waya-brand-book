/* ============================================================
   Reserve Class — al pulsar "Reservar" en un pack (botones estáticos
   data-reserve-class) primero se pregunta CÓMO reservar:
   - Por WhatsApp → abre el chat con el pack ya escrito.
   - En la web    → abre el picker de calendario (class-picker.js).
   Mucha gente se agobia al ver el calendario de golpe; así elige.
   El flujo dinámico vive en activity-page.js.
   ============================================================ */
import { openClassPicker, t, typeLabel } from '/lib/class-picker.js';

const WA_NUMBER = '34636562448';

const ICON_WA = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.23-9.43 9.44-9.43a9.38 9.38 0 0 1 9.43 9.44c0 5.2-4.24 9.43-9.44 9.43zm8.03-17.46A11.3 11.3 0 0 0 12.04.7C5.8.7.72 5.78.71 12.03c0 2 .52 3.94 1.52 5.66L.62 23.3l5.75-1.5a11.3 11.3 0 0 0 5.66 1.44h.01c6.25 0 11.33-5.08 11.34-11.33 0-3.03-1.18-5.87-3.31-8.01z"/></svg>';
const ICON_CAL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

function openBookingChoice(opts) {
  const pack = `${typeLabel(opts.classType)} · ${t('packName', opts.sessions)}`;
  const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(t('waMsg', pack, opts.fullPrice))}`;

  const overlay = document.createElement('div');
  overlay.className = 'cp-overlay';
  overlay.innerHTML = `
    <div class="cp-modal cp-modal--choice" role="dialog" aria-modal="true" aria-labelledby="cp-choice-title">
      <button class="cp-close" aria-label="${t('close')}">&times;</button>
      <div class="cp-header">
        <h3 id="cp-choice-title">${t('howBook')}</h3>
        <p class="cp-sub">${pack}${opts.fullPrice ? ` · ${opts.fullPrice}€` : ''}</p>
      </div>
      <div class="cp-choice-opts">
        <a class="cp-choice cp-choice--wa" href="${waUrl}" target="_blank" rel="noopener noreferrer" data-choice="wa">
          <span class="cp-choice-icon">${ICON_WA}</span>
          <span class="cp-choice-text"><strong>${t('viaWa')}</strong><span>${t('viaWaSub')}</span></span>
        </a>
        <button type="button" class="cp-choice" data-choice="web">
          <span class="cp-choice-icon">${ICON_CAL}</span>
          <span class="cp-choice-text"><strong>${t('viaWeb')}</strong><span>${t('viaWebSub')}</span></span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  function close() {
    document.body.style.overflow = '';
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  overlay.querySelector('.cp-close').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.querySelector('[data-choice="wa"]').addEventListener('click', close);
  overlay.querySelector('[data-choice="web"]').addEventListener('click', () => {
    close();
    openClassPicker(opts);
  });
  overlay.querySelector('[data-choice="web"]').focus();
}

document.querySelectorAll('[data-reserve-class]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openBookingChoice({
      classType: btn.dataset.classType || 'grupal',
      sessions: Number(btn.dataset.classSessions) || 1,
      packName: btn.dataset.className,
      // respeta 0 (se cobra el pack completo); default 15 si no se define
      deposit: btn.dataset.classDeposit != null ? Number(btn.dataset.classDeposit) : 15,
      fullPrice: Number(btn.dataset.classPrice),
    });
  });
});
