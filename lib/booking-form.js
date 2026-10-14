/* ============================================================
   Formulario de reserva de clases — réplica del Google Form de la
   escuela "SURF LESSON BOOKING" (mismas secciones, preguntas,
   opciones, obligatorias y textos de ayuda). El original está en
   inglés; ES y DE son traducciones.

   Se rellena en el paso "Resumen" del calendario de reservas, junto
   al contrato (lib/contrato.js), y viaja con la firma a
   firmar-contrato.php.

   NO están (no aparecían en las capturas del formulario): una pregunta
   entre "Surfboard size" y "Observations", y la sección 9 de 9.
   ============================================================ */

const T = {
  en: {
    formTitle: 'SURF LESSON BOOKING FORM',
    welcome: 'Welcome to the <strong>WAYASURF community</strong>! We’re excited to have you join us.<br><br>Please take a few minutes to <strong>fill out this form as clearly as you can</strong>, so we can get to know you better and make sure your surf experience is amazing. 🙂<br><br>Can’t wait to see you riding the waves! 🌊✌️',
    secPersonal: '🗒️ PERSONAL INFORMATION', secGuardian: 'UNDER 18 PARENT/GUARDIAN', secSurf: '🏄 SURF EXPERIENCE',
    secEquip: '🧍 EQUIPMENT & LOGISTICS', secObs: '📝 OBSERVATIONS', secBring: '🏄 WHAT TO BRING TO YOUR SURF LESSON',
    name: 'NAME', surname: 'SURNAME', age: 'AGE', idPassport: 'ID/PASSPORT', nationality: 'NATIONALITY',
    address: 'ADDRESS IN GRAN CANARIA', email: 'EMAIL', phone: 'PHONE NUMBER', phoneHelp: 'ADD YOUR PREFIX: +49, +39, +33...',
    under18: 'ARE YOU UNDER 18?', yes: 'Yes', no: 'No',
    guardianName: 'Parent / Guardian Full Name', guardianPhone: 'Parent / Guardian Phone Number',
    level: 'SURF LEVEL', levelHelp: 'IF YOU DON’T KNOW YOUR SURF LEVEL CHECK THIS', levelLink: 'FIND YOUR LEVEL →', levelOpt: 'Level',
    prevExp: 'PREVIOUS SURF EXPERIENCE', prevExpHelp: 'Where and how many times?',
    lessonDate: 'LESSON DATE', lessonDateHelp: 'If it’s more than 1 day just write it in the next question.',
    lessonsDates: 'LESSONS DATES', lessonsDatesHelp: 'Write down all the days when you will book lessons. Format example: 5 April, 6 April, 7 April',
    lessonTime: 'LESSON TIME', lessonTimeHelp: 'If it’s a future booking and you still don’t know the lesson time just go to the next question.',
    lessonType: 'TYPE OF LESSON', private: 'PRIVATE', semiprivate: 'SEMIPRIVATE', group: 'GROUP',
    height: 'HEIGHT', weight: 'WEIGHT', needGear: 'DO YOU NEED WETSUIT AND SURFBOARD',
    gearBoth: 'YES BOTH', gearWetsuit: 'ONLY WETSUIT', gearBoard: 'ONLY SURFBOARD',
    boardSize: 'SURFBOARD SIZE', boardSizeHelp: 'If you surfed before and you remember which size of surfboard you had, let us know, if not we will recommend you something :)',
    obsHelp: 'Please write here any additional information we should know, such as medical conditions, allergies, or special requests.',
    found: 'How did you find WAYA SURF?', other: 'Other:',
    instagram: 'We like to tag our students when we post a photo or video of them in Instagram, feel free to write your account and we will tag you :)',
    bringIntro: 'Please make sure to bring the following items:',
    bring: ['Swimsuit or boardshorts', 'Towel', 'Sunscreen', 'Flip Flops', 'Water', 'Any personal items you may need', 'Your best smile & motivation✌️!'],
    bringNote: '💡 <em>All equipment like surfboards, wetsuits, and leashes will be provided by WAYA SURF SCHOOL.</em>',
    signAccept: '✅ ACCEPTANCE AND DIGITAL SIGNATURE', signBy: 'SIGNED BY (Type: Full Name - ID - Date):',
    required: 'This is a required question', requiredField: 'Required question missing: ',
  },
  es: {
    formTitle: 'FORMULARIO DE RESERVA DE CLASES DE SURF',
    welcome: '¡Bienvenido a la <strong>comunidad WAYASURF</strong>! Nos encanta que te unas.<br><br>Tómate unos minutos para <strong>rellenar este formulario lo más claro posible</strong>, así te conocemos mejor y nos aseguramos de que tu experiencia de surf sea increíble. 🙂<br><br>¡Tenemos ganas de verte cogiendo olas! 🌊✌️',
    secPersonal: '🗒️ DATOS PERSONALES', secGuardian: 'MENORES DE 18: PADRE/MADRE/TUTOR', secSurf: '🏄 EXPERIENCIA DE SURF',
    secEquip: '🧍 MATERIAL Y LOGÍSTICA', secObs: '📝 OBSERVACIONES', secBring: '🏄 QUÉ TRAER A TU CLASE DE SURF',
    name: 'NOMBRE', surname: 'APELLIDOS', age: 'EDAD', idPassport: 'DNI/PASAPORTE', nationality: 'NACIONALIDAD',
    address: 'DIRECCIÓN EN GRAN CANARIA', email: 'EMAIL', phone: 'TELÉFONO', phoneHelp: 'AÑADE EL PREFIJO: +34, +49, +39...',
    under18: '¿ERES MENOR DE 18?', yes: 'Sí', no: 'No',
    guardianName: 'Nombre completo del padre / madre / tutor', guardianPhone: 'Teléfono del padre / madre / tutor',
    level: 'NIVEL DE SURF', levelHelp: 'SI NO SABES TU NIVEL, MÍRALO AQUÍ', levelLink: 'DESCUBRE TU NIVEL →', levelOpt: 'Nivel',
    prevExp: 'EXPERIENCIA PREVIA DE SURF', prevExpHelp: '¿Dónde y cuántas veces?',
    lessonDate: 'FECHA DE LA CLASE', lessonDateHelp: 'Si es más de 1 día, escríbelo en la siguiente pregunta.',
    lessonsDates: 'FECHAS DE LAS CLASES', lessonsDatesHelp: 'Escribe todos los días en los que reservarás clase. Ejemplo: 5 abril, 6 abril, 7 abril',
    lessonTime: 'HORA DE LA CLASE', lessonTimeHelp: 'Si es una reserva para más adelante y aún no sabes la hora, pasa a la siguiente pregunta.',
    lessonType: 'TIPO DE CLASE', private: 'PRIVADA', semiprivate: 'SEMIPRIVADA', group: 'GRUPAL',
    height: 'ALTURA', weight: 'PESO', needGear: '¿NECESITAS NEOPRENO Y TABLA?',
    gearBoth: 'SÍ, LOS DOS', gearWetsuit: 'SOLO NEOPRENO', gearBoard: 'SOLO TABLA',
    boardSize: 'MEDIDA DE TABLA', boardSizeHelp: 'Si has surfeado antes y recuerdas la medida de tu tabla, dínoslo; si no, te recomendamos una :)',
    obsHelp: 'Escribe aquí cualquier información adicional que debamos saber, como condiciones médicas, alergias o peticiones especiales.',
    found: '¿Cómo conociste WAYA SURF?', other: 'Otro:',
    instagram: 'Nos gusta etiquetar a nuestros alumnos cuando publicamos una foto o vídeo suyo en Instagram: escribe tu cuenta y te etiquetamos :)',
    bringIntro: 'Asegúrate de traer lo siguiente:',
    bring: ['Bañador', 'Toalla', 'Crema solar', 'Chanclas', 'Agua', 'Cualquier objeto personal que necesites', '¡Tu mejor sonrisa y ganas ✌️!'],
    bringNote: '💡 <em>Todo el material (tablas, neoprenos e inventos) lo pone WAYA SURF SCHOOL.</em>',
    signAccept: '✅ ACEPTACIÓN Y FIRMA DIGITAL', signBy: 'FIRMADO POR (Escribe: Nombre completo - DNI - Fecha):',
    required: 'Esta pregunta es obligatoria', requiredField: 'Falta una pregunta obligatoria: ',
  },
  de: {
    formTitle: 'BUCHUNGSFORMULAR SURFKURS',
    welcome: 'Willkommen in der <strong>WAYASURF-Community</strong>! Schön, dass du dabei bist.<br><br>Nimm dir ein paar Minuten, um <strong>dieses Formular so genau wie möglich auszufüllen</strong>, damit wir dich besser kennenlernen und dein Surferlebnis großartig wird. 🙂<br><br>Wir freuen uns darauf, dich auf den Wellen zu sehen! 🌊✌️',
    secPersonal: '🗒️ PERSÖNLICHE DATEN', secGuardian: 'UNTER 18: ELTERNTEIL/ERZIEHUNGSBERECHTIGTE', secSurf: '🏄 SURF-ERFAHRUNG',
    secEquip: '🧍 AUSRÜSTUNG & LOGISTIK', secObs: '📝 ANMERKUNGEN', secBring: '🏄 WAS DU ZUM SURFKURS MITBRINGEN SOLLTEST',
    name: 'VORNAME', surname: 'NACHNAME', age: 'ALTER', idPassport: 'AUSWEIS/PASS', nationality: 'NATIONALITÄT',
    address: 'ADRESSE AUF GRAN CANARIA', email: 'E-MAIL', phone: 'TELEFONNUMMER', phoneHelp: 'MIT VORWAHL: +49, +39, +33...',
    under18: 'BIST DU UNTER 18?', yes: 'Ja', no: 'Nein',
    guardianName: 'Vollständiger Name Elternteil / Erziehungsberechtigte', guardianPhone: 'Telefon Elternteil / Erziehungsberechtigte',
    level: 'SURF-LEVEL', levelHelp: 'WENN DU DEIN LEVEL NICHT KENNST, SCHAU HIER', levelLink: 'FINDE DEIN LEVEL →', levelOpt: 'Level',
    prevExp: 'BISHERIGE SURF-ERFAHRUNG', prevExpHelp: 'Wo und wie oft?',
    lessonDate: 'KURSDATUM', lessonDateHelp: 'Bei mehr als 1 Tag schreib es in die nächste Frage.',
    lessonsDates: 'KURSTAGE', lessonsDatesHelp: 'Schreib alle Tage auf, an denen du Stunden buchst. Beispiel: 5. April, 6. April, 7. April',
    lessonTime: 'KURSZEIT', lessonTimeHelp: 'Wenn du für später buchst und die Uhrzeit noch nicht kennst, geh zur nächsten Frage.',
    lessonType: 'KURSART', private: 'PRIVAT', semiprivate: 'SEMI-PRIVAT', group: 'GRUPPE',
    height: 'GRÖSSE', weight: 'GEWICHT', needGear: 'BRAUCHST DU NEOPRENANZUG UND SURFBRETT',
    gearBoth: 'JA, BEIDES', gearWetsuit: 'NUR NEOPRENANZUG', gearBoard: 'NUR SURFBRETT',
    boardSize: 'BRETTGRÖSSE', boardSizeHelp: 'Wenn du schon gesurft bist und dich an deine Brettgröße erinnerst, sag es uns – sonst empfehlen wir dir eins :)',
    obsHelp: 'Schreib hier alles, was wir wissen sollten, z. B. Erkrankungen, Allergien oder besondere Wünsche.',
    found: 'Wie hast du WAYA SURF gefunden?', other: 'Sonstiges:',
    instagram: 'Wir markieren unsere Schüler gern, wenn wir ein Foto oder Video von ihnen auf Instagram posten – schreib uns deinen Account und wir markieren dich :)',
    bringIntro: 'Bitte bring Folgendes mit:',
    bring: ['Badeanzug oder Boardshorts', 'Handtuch', 'Sonnencreme', 'Flip-Flops', 'Wasser', 'Persönliche Dinge, die du brauchst', 'Dein bestes Lächeln & Motivation✌️!'],
    bringNote: '💡 <em>Die gesamte Ausrüstung (Surfbretter, Neoprenanzüge und Leashes) stellt die WAYA SURF SCHOOL.</em>',
    signAccept: '✅ ANNAHME UND DIGITALE UNTERSCHRIFT', signBy: 'UNTERZEICHNET VON (Vollständiger Name - Ausweis - Datum):',
    required: 'Pflichtfrage', requiredField: 'Pflichtfrage fehlt: ',
  },
};

const FOUND = ['Instagram', 'TikTok', 'Facebook', 'Google Maps', 'Loottis', 'Airbnb', 'Getyourguide', 'Civitatis'];
const LEVELS = [0, 1, 2, 3, 4, 5];

export function formText(lang) { return T[lang] || T.en; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Campos en el orden del formulario: [clave, etiqueta, tipo, obligatoria, ayuda, opciones] */
function fields(t) {
  return {
    personal: [
      ['name', t.name, 'text', true], ['surname', t.surname, 'text', true], ['age', t.age, 'number', true],
      ['id_passport', t.idPassport, 'text', true], ['nationality', t.nationality, 'text', true],
      ['address', t.address, 'text', true], ['email', t.email, 'email', true],
      ['phone', t.phone, 'tel', true, t.phoneHelp],
      ['under18', t.under18, 'radio', true, '', [['yes', t.yes], ['no', t.no]]],
    ],
    guardian: [['guardian_name', t.guardianName, 'text', false], ['guardian_phone', t.guardianPhone, 'tel', false]],
    surf: [
      ['level', t.level, 'level', true],
      ['previous_experience', t.prevExp, 'text', true, t.prevExpHelp],
      ['lesson_date', t.lessonDate, 'date', true, t.lessonDateHelp],
      ['lessons_dates', t.lessonsDates, 'text', false, t.lessonsDatesHelp],
      ['lesson_time', t.lessonTime, 'time', false, t.lessonTimeHelp],
      ['lesson_type', t.lessonType, 'radio', true, '', [['private', t.private], ['semiprivate', t.semiprivate], ['group', t.group]]],
    ],
    equip: [
      ['height', t.height, 'text', true], ['weight', t.weight, 'text', true],
      ['need_gear', t.needGear, 'radio', true, '', [['both', t.gearBoth], ['wetsuit', t.gearWetsuit], ['surfboard', t.gearBoard]]],
      ['surfboard_size', t.boardSize, 'text', false, t.boardSizeHelp],
    ],
  };
}

function fieldHtml([key, label, type, req, help, opts], v) {
  const star = req ? '<span class="bf-req">*</span>' : '';
  const helpHtml = help ? `<p class="bf-help">${esc(help)}</p>` : '';
  let input;
  if (type === 'radio') {
    input = `<div class="bf-opts">${opts.map(([val, txt]) => `
      <label class="bf-opt"><input type="radio" name="bf-${key}" value="${val}" ${v === val ? 'checked' : ''}> ${esc(txt)}</label>`).join('')}</div>`;
  } else if (type === 'level') {
    input = '';
  } else {
    input = `<input class="bf-input" type="${type}" name="bf-${key}" value="${esc(v ?? '')}" ${type === 'number' ? 'min="1" max="99"' : ''}>`;
  }
  return `<div class="bf-q" data-q="${key}"><label class="bf-label">${esc(label)} ${star}</label>${helpHtml}${input}</div>`;
}

/**
 * HTML del formulario completo.
 * @param {string} lang
 * @param {object} v  valores ya conocidos (respuestas previas o rellenadas por la reserva)
 * @param {string} contractBlock  HTML del contrato (sección 6), lo pone class-picker
 */
export function bookingFormHtml(lang, v = {}, contractBlock = '') {
  const t = formText(lang);
  const f = fields(t);
  const levelQ = `<div class="bf-q" data-q="level">
      <label class="bf-label">${t.level} <span class="bf-req">*</span></label>
      <p class="bf-help">${t.levelHelp} · <a href="/niveles.html" target="_blank" rel="noopener">${t.levelLink}</a></p>
      <div class="bf-opts">${LEVELS.map(n => `
        <label class="bf-opt"><input type="radio" name="bf-level" value="${n}" ${String(v.level) === String(n) ? 'checked' : ''}> ${t.levelOpt} ${n}</label>`).join('')}</div>
    </div>`;
  const found = Array.isArray(v.found) ? v.found : [];
  return `
    <div class="bf">
      <section class="bf-sec bf-intro"><h4>${t.formTitle}</h4><p>${t.welcome}</p></section>

      <section class="bf-sec"><h4>${t.secPersonal}</h4>${f.personal.map(q => fieldHtml(q, v[q[0]])).join('')}</section>

      <section class="bf-sec" id="bf-guardian" ${v.under18 === 'yes' ? '' : 'hidden'}>
        <h4>${t.secGuardian}</h4>${f.guardian.map(q => fieldHtml(q, v[q[0]])).join('')}
      </section>

      <section class="bf-sec"><h4>${t.secSurf}</h4>${f.surf.map(q => q[2] === 'level' ? levelQ : fieldHtml(q, v[q[0]])).join('')}</section>

      <section class="bf-sec"><h4>${t.secEquip}</h4>
        ${f.equip.map(q => fieldHtml(q, v[q[0]])).join('')}
        <div class="bf-q" data-q="observations"><label class="bf-label">${t.secObs}</label><p class="bf-help">${esc(t.obsHelp)}</p>
          <textarea class="bf-input" name="bf-observations" rows="3">${esc(v.observations ?? '')}</textarea></div>
        <div class="bf-q" data-q="found"><label class="bf-label">${t.found}</label>
          <div class="bf-opts">${FOUND.map(o => `
            <label class="bf-opt"><input type="checkbox" name="bf-found" value="${o}" ${found.includes(o) ? 'checked' : ''}> ${o}</label>`).join('')}
            <label class="bf-opt bf-other"><input type="checkbox" name="bf-found" value="__other" ${found.includes('__other') ? 'checked' : ''}> ${t.other}
              <input class="bf-input" type="text" name="bf-found_other" value="${esc(v.found_other ?? '')}"></label>
          </div></div>
        <div class="bf-q" data-q="instagram"><label class="bf-label" style="text-transform:none">${esc(t.instagram)}</label>
          <input class="bf-input" type="text" name="bf-instagram" value="${esc(v.instagram ?? '')}"></div>
      </section>

      ${contractBlock}

      <section class="bf-sec"><h4>${t.secBring}</h4><p>${t.bringIntro}</p>
        <ul class="bf-bring">${t.bring.map(b => `<li>${b}</li>`).join('')}</ul><p>${t.bringNote}</p></section>
    </div>`;
}

/** Engancha el comportamiento (sección de tutor según "¿menor de 18?"). */
export function wireBookingForm(root) {
  root.querySelectorAll('input[name="bf-under18"]').forEach(r => r.addEventListener('change', () => {
    const g = root.querySelector('#bf-guardian');
    if (g) g.hidden = root.querySelector('input[name="bf-under18"]:checked')?.value !== 'yes';
  }));
}

/** Lee las respuestas del formulario. */
export function readBookingForm(root) {
  const val = (k) => {
    const el = root.querySelector(`[name="bf-${k}"]`);
    if (!el) return '';
    if (el.type === 'radio') return root.querySelector(`[name="bf-${k}"]:checked`)?.value || '';
    return el.value.trim();
  };
  const keys = ['name', 'surname', 'age', 'id_passport', 'nationality', 'address', 'email', 'phone', 'under18',
    'guardian_name', 'guardian_phone', 'level', 'previous_experience', 'lesson_date', 'lessons_dates', 'lesson_time',
    'lesson_type', 'height', 'weight', 'need_gear', 'surfboard_size', 'observations', 'found_other', 'instagram'];
  const v = {};
  keys.forEach(k => { v[k] = val(k); });
  v.found = [...root.querySelectorAll('input[name="bf-found"]:checked')].map(c => c.value);
  return v;
}

/** Primera pregunta obligatoria sin responder → { key, label } o null. */
export function missingRequired(lang, v) {
  const f = fields(formText(lang));
  for (const q of [...f.personal, ...f.surf, ...f.equip]) {
    if (q[3] && !String(v[q[0]] ?? '').trim()) return { key: q[0], label: q[1] };
  }
  return null;
}

/** Respuestas como lista legible [[pregunta, respuesta]] (para el email y el registro). */
export function answersList(lang, v) {
  const t = formText(lang);
  const f = fields(t);
  const opt = (q, val) => (q[5] || []).find(o => o[0] === val)?.[1] || val;
  const rows = [];
  const add = (qs) => qs.forEach(q => {
    let value = v[q[0]];
    if (q[2] === 'radio') value = opt(q, value);
    if (q[2] === 'level' && value !== '') value = `${t.levelOpt} ${value}`;
    rows.push([q[1], value || '—']);
  });
  add(fields(t).personal);
  if (v.under18 === 'yes') add(f.guardian);
  add(f.surf); add(f.equip);
  rows.push([t.secObs.replace(/^\S+\s/, ''), v.observations || '—']);
  const found = (v.found || []).map(x => x === '__other' ? `${t.other} ${v.found_other || ''}`.trim() : x);
  rows.push([t.found, found.join(', ') || '—']);
  rows.push(['Instagram', v.instagram || '—']);
  return rows;
}
