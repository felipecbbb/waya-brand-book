/* ============================================================
   Textos legales — Waya Surf School
   Adaptado del panel de Entreolas. Estructura idéntica; datos Waya.

   -- TODO Waya: revisar textos legales con Victor (redacción definitiva,
      razón social, domicilio fiscal, política de cancelación exacta y RGPD).
   ============================================================ */

export const TERMS_HTML = `
<h3>Términos y Condiciones de Waya Surf School</h3>
<p><strong>Última actualización:</strong> julio 2026 <em>(borrador — pendiente de revisión legal)</em></p>

<h4>1. Objeto</h4>
<p>Los presentes Términos y Condiciones regulan el uso de los servicios ofrecidos por Waya Surf School, escuela de surf ubicada en Telde, Gran Canaria (en adelante, "la Escuela"), incluyendo clases de surf (grupales, privadas, semiprivadas, familiares, para residentes y Waya Kids), alquiler de material y surfcamps.</p>

<h4>2. Reservas y Pagos</h4>
<p>Las reservas se realizan a través de la plataforma web o presencialmente. El pago se puede realizar mediante efectivo, tarjeta, transferencia bancaria o bonos prepago. Las reservas quedan confirmadas una vez realizado el pago correspondiente o validado el bono.</p>

<h4>3. Cancelaciones y Reembolsos</h4>
<p>Las cancelaciones deben realizarse con un mínimo de 2 horas de antelación respecto a la hora de inicio de la clase. Las cancelaciones realizadas dentro del plazo restablecerán el crédito al bono correspondiente. No se realizarán reembolsos por cancelaciones fuera de plazo o no asistencia.</p>

<h4>4. Bonos y Créditos</h4>
<p>Los bonos tienen una validez limitada según el tipo de actividad. Los créditos no utilizados antes de la fecha de expiración no serán reembolsados ni transferibles. Los bonos son personales e intransferibles, salvo para miembros familiares registrados en la cuenta del titular.</p>

<h4>5. Conducta y Seguridad</h4>
<p>Los participantes deben seguir en todo momento las instrucciones del monitor o instructor. La Escuela se reserva el derecho de excluir de la actividad a cualquier participante cuyo comportamiento ponga en riesgo su seguridad o la de otros.</p>

<h4>6. Condiciones Meteorológicas</h4>
<p>La Escuela podrá cancelar o modificar actividades por condiciones meteorológicas adversas o de mar. En estos casos, se ofrecerá una alternativa de fecha o la devolución del crédito al bono.</p>

<h4>7. Menores de Edad</h4>
<p>Los menores de edad deben contar con autorización del padre, madre o tutor legal para participar en las actividades. El responsable legal deberá registrar al menor como miembro familiar en la plataforma.</p>

<h4>8. Protección de Datos</h4>
<p>Los datos personales se tratan conforme al Reglamento General de Protección de Datos (RGPD). Los datos de salud recogidos (capacidad de natación, lesiones) se utilizan exclusivamente para garantizar la seguridad durante las actividades.</p>

<h4>9. Modificaciones</h4>
<p>La Escuela se reserva el derecho de modificar estos términos. Los cambios serán comunicados a través de la plataforma web.</p>
`;

export const WAIVER_HTML = `
<h3>Exención de Responsabilidad — Waya Surf School</h3>
<p><strong>Última actualización:</strong> julio 2026 <em>(borrador — pendiente de revisión legal)</em></p>

<h4>Declaración del participante</h4>
<p>Al aceptar esta exención, declaro que:</p>
<ul>
  <li>Participo en las actividades ofrecidas por Waya Surf School de forma voluntaria y bajo mi propia responsabilidad.</li>
  <li>Soy consciente de que las actividades acuáticas y deportivas conllevan riesgos inherentes, incluyendo pero no limitados a: lesiones físicas, ahogamiento, golpes, cortes, quemaduras solares y picaduras de medusa.</li>
  <li>He informado verazmente sobre mi estado de salud, capacidad de natación y cualquier lesión o condición médica relevante.</li>
  <li>Me comprometo a seguir las instrucciones de seguridad proporcionadas por los monitores e instructores en todo momento.</li>
  <li>Comprendo que la Escuela no se hace responsable de lesiones derivadas del incumplimiento de las normas de seguridad o de información médica no declarada.</li>
</ul>

<h4>Autorización para menores</h4>
<p>En caso de que el participante sea menor de edad, como padre, madre o tutor legal:</p>
<ul>
  <li>Autorizo expresamente su participación en las actividades.</li>
  <li>Asumo la responsabilidad sobre la veracidad de los datos de salud proporcionados.</li>
  <li>Eximo a Waya Surf School de responsabilidad por daños derivados de información no declarada.</li>
</ul>

<h4>Material y Equipamiento</h4>
<p>El participante se compromete a hacer un uso adecuado del material proporcionado (tablas, neoprenos, licras, etc.) y será responsable de los daños causados por un uso negligente o inadecuado del mismo.</p>

<h4>Imagen y Fotografía</h4>
<p>Autorizo a Waya Surf School a capturar y utilizar imágenes y vídeos tomados durante las actividades con fines promocionales en redes sociales y página web, salvo indicación expresa en contrario comunicada por escrito.</p>
`;

// Modal genérico reutilizable para mostrar textos legales.
export function openLegalModal(title, html) {
  document.getElementById('legal-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'legal-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2)">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid #e5e7eb">
        <h3 style="margin:0;font-size:1.1rem;font-family:var(--font-heading,'Outfit',sans-serif)">${title}</h3>
        <button id="legal-modal-close" aria-label="Cerrar" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#64748b;padding:4px 8px">&times;</button>
      </div>
      <div style="padding:24px;overflow-y:auto;font-size:.92rem;line-height:1.7;color:#334155;font-family:var(--font-body,'Inter',sans-serif)">
        ${html}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#legal-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
