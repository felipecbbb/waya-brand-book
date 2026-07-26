/* ============================================================
   Reserve Class — abre el picker de calendario al reservar un pack
   (botones estáticos data-reserve-class). El flujo dinámico vive en
   activity-page.js; este módulo cubre páginas con botones fijos.
   ============================================================ */
import { openClassPicker } from '/lib/class-picker.js';

document.querySelectorAll('[data-reserve-class]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openClassPicker({
      classType: btn.dataset.classType || 'grupal',
      sessions: Number(btn.dataset.classSessions) || 1,
      packName: btn.dataset.className,
      // respeta 0 (sin pasarela = se paga en la escuela); default 15 si no se define
      deposit: btn.dataset.classDeposit != null ? Number(btn.dataset.classDeposit) : 15,
      fullPrice: Number(btn.dataset.classPrice),
    });
  });
});
