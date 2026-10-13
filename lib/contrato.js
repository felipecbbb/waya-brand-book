/* ============================================================
   Contrato de clases (Términos y Condiciones — Surf Lessons).

   Texto ORIGINAL de Víctor: el inglés de su formulario de Google
   "SURF LESSON BOOKING". El español y el alemán son traducciones
   (pendientes de revisión por la escuela).

   CONTRACT_VERSION identifica el texto firmado: si se cambia una sola
   coma, se sube la versión, para que cada firma guardada apunte al
   texto exacto que la persona aceptó.
   ============================================================ */

export const CONTRACT_VERSION = '2026-10-14';

const ESCUELA = {
  nombre: 'WAYA SURF SCHOOL',
  representante: 'Víctor Bueno Ureña',
  nif: '54149688Y',
  telefono: '+34 639 390 308',
  email: 'info@wayasurf.com',
};

const TEXT = {
  en: {
    title: 'Terms & Conditions – Surf Lessons',
    intro: 'By booking and participating in surf lessons at WAYA SURF SCHOOL in Canary Islands, Spain, you agree to the following terms and conditions:',
    items: [
      'All students must be older than 5 years. Minors must provide a signed authorization from a parent or legal guardian.',
      'Each lesson lasts 2 hours and includes all surf equipment (surfboard, wetsuit, and leash).',
      'Surfing is a sport with inherent risks and depends heavily on nature. Risks include falls, collisions, strong currents, waves, marine life, weather conditions, and equipment use. The school reserves the right to conduct or interrupt lessons based on student safety.',
      'If there are no waves, or if weather conditions are unsafe, the school reserves the right to conduct or interrupt lessons. The school will try to reschedule lessons, but is not obliged to do so.',
      'If the school cancels a lesson due to operational reasons, you will be offered a new date or a full refund.',
      'The school is not responsible for lost or stolen personal items or equipment. Students are responsible for any damage caused to the equipment or third parties.',
      'I declare that I am in good physical and mental condition to participate in surf lessons. I confirm that I do not suffer from any medical condition that could make my participation unsafe, including but not limited to asthma, epilepsy, heart problems, diabetes, allergies, or pregnancy, unless I have informed the surf school in advance.',
      'I confirm that I am able to swim independently in open water.',
      'I understand that surfing is a physically demanding sport with inherent risks, including falls, collisions, strong currents, waves, marine life, weather conditions, and equipment use. I acknowledge that injuries such as cuts, strains, fractures, contusions, paralysis, or even death may occur.',
      'To the maximum extent permitted by Spanish law, I release the surf school, its owners, instructors, employees, and collaborators from any liability for injuries, accidents, loss, or damage that may occur during the activity, except in cases of gross negligence or willful misconduct.',
      "The student assumes full responsibility and accepts the risks of this activity. The student declares that they have been duly informed of the school's rules and agree with the contract between the school and themselves. They have understood and accepted the contract and declare that their participation in this activity is voluntary, assuming all possible risks under their own responsibility.",
      'Students, parents, or guardians authorize the surf school to use photographs and videos taken during the lessons for promotional purposes (website, social media, marketing), unless I expressly state otherwise in writing.',
      'The School has Civil Liability Insurance and Accident Insurance in force with Berkley España. The undersigned, or the person they represent, waives any claim by any means that exceeds the coverage limits stated in the policy. Any legal claim must be pursued under Spanish law.',
      "Payments can be made in full (100% of the lesson or course) or as a deposit of 20% to secure the booking, depending on the client's preference. The remaining balance must be paid before the start of the lesson or course.",
      'All bookings are confirmed once payment or deposit has been received.',
      'Refunds are only possible in cases of force majeure due to illness or injury, and must be notified at least 24 hours before the scheduled start time of the lesson, with a valid medical certificate provided.<br>• Applies to single lessons.<br>• Applies to 3- or 5-lesson packs only if they have not been started.<br>• If a 3- or 5-lesson pack has already started, 50% of the remaining unused lessons will be refunded.',
      'Cancellations made less than 24 hours before the lesson will not be refunded, regardless of the payment method.',
      'No-shows will not be refunded, and the lesson will be considered used.',
      'Students must respect other participants, follow instructor instructions, and comply with surf rules. Failure to do so may result in expulsion without refund.',
      'If students arrive late and miss part of the lesson, the session will still end at the scheduled time. No refunds or extensions will be given.',
      'Refunds will be made using the same payment method originally used.',
      'Lesson packs (3 or 5 classes only) must be used within the agreed period of 30 days from the first class. They are non-refundable once fully used.',
      'No refunds will be given for cancellations due to force majeure (natural disasters, government restrictions, etc.), but rescheduling will be offered when possible.',
      'If I am a minor, I confirm that my parent or legal guardian has read and accepted these terms on my behalf.',
      'In accordance with Regulation (EU) 2016/679 (GDPR) and Spanish data protection law (LOPDGDD), personal data will be used solely for booking management and communication. Students and guardians have the right to access, rectify, and delete their data.',
      'I have read, understood, and agree to all the Terms & Conditions. I accept full responsibility for my participation in WAYA SURF SCHOOL activities.',
    ],
    representative: 'Authorized representative – WAYA SURF SCHOOL',
    accept: 'I hereby acknowledge that I have read, understood, and accept all the Terms & Conditions, also on behalf of the minors and companions included in this booking.',
    signedBy: 'Signed by',
    fullName: 'Full name', idDoc: 'ID / Passport number', date: 'Date',
    note: '',
  },
  es: {
    title: 'Términos y Condiciones – Clases de surf',
    intro: 'Al reservar y participar en clases de surf en WAYA SURF SCHOOL (Islas Canarias, España), aceptas los siguientes términos y condiciones:',
    items: [
      'Todos los alumnos deben ser mayores de 5 años. Los menores deben aportar una autorización firmada por su padre, madre o tutor legal.',
      'Cada clase dura 2 horas e incluye todo el material de surf (tabla, neopreno e invento).',
      'El surf es un deporte con riesgos inherentes y depende en gran medida de la naturaleza. Entre los riesgos se incluyen caídas, choques, corrientes fuertes, olas, fauna marina, condiciones meteorológicas y el uso del material. La escuela se reserva el derecho de impartir o interrumpir las clases en función de la seguridad de los alumnos.',
      'Si no hay olas o las condiciones meteorológicas no son seguras, la escuela se reserva el derecho de impartir o interrumpir las clases. La escuela intentará reprogramarlas, pero no está obligada a ello.',
      'Si la escuela cancela una clase por motivos organizativos, se te ofrecerá una nueva fecha o el reembolso íntegro.',
      'La escuela no se hace responsable de la pérdida o robo de objetos o material personal. Los alumnos son responsables de los daños que causen al material o a terceros.',
      'Declaro que me encuentro en buenas condiciones físicas y mentales para participar en clases de surf. Confirmo que no padezco ninguna condición médica que pueda hacer insegura mi participación, incluyendo, entre otras, asma, epilepsia, problemas cardíacos, diabetes, alergias o embarazo, salvo que lo haya comunicado previamente a la escuela.',
      'Confirmo que sé nadar de forma autónoma en aguas abiertas.',
      'Entiendo que el surf es un deporte físicamente exigente con riesgos inherentes, como caídas, choques, corrientes fuertes, olas, fauna marina, condiciones meteorológicas y el uso del material. Reconozco que pueden producirse lesiones como cortes, esguinces, fracturas, contusiones, parálisis o incluso la muerte.',
      'En la máxima medida permitida por la legislación española, eximo a la escuela de surf, a sus propietarios, instructores, empleados y colaboradores de toda responsabilidad por lesiones, accidentes, pérdidas o daños que puedan producirse durante la actividad, salvo en casos de negligencia grave o dolo.',
      'El alumno asume plena responsabilidad y acepta los riesgos de esta actividad. Declara haber sido debidamente informado de las normas de la escuela y estar conforme con el contrato entre la escuela y él mismo. Ha entendido y aceptado el contrato y declara que su participación en esta actividad es voluntaria, asumiendo bajo su propia responsabilidad todos los riesgos posibles.',
      'Los alumnos, padres o tutores autorizan a la escuela a utilizar fotografías y vídeos tomados durante las clases con fines promocionales (web, redes sociales, marketing), salvo que indique expresamente lo contrario por escrito.',
      'La escuela tiene en vigor un seguro de Responsabilidad Civil y un seguro de Accidentes con Berkley España. El firmante, o la persona a la que representa, renuncia a cualquier reclamación, por cualquier vía, que exceda los límites de cobertura establecidos en la póliza. Cualquier reclamación legal se regirá por la legislación española.',
      'El pago puede realizarse íntegro (100 % de la clase o curso) o mediante una señal del 20 % para asegurar la reserva, según prefiera el cliente. El importe restante debe abonarse antes del inicio de la clase o curso.',
      'Todas las reservas quedan confirmadas una vez recibido el pago o la señal.',
      'Solo se admiten reembolsos por causa de fuerza mayor debida a enfermedad o lesión, que deberá comunicarse al menos 24 horas antes de la hora de inicio de la clase, aportando un certificado médico válido.<br>• Aplica a clases sueltas.<br>• Aplica a packs de 3 o 5 clases solo si no se han empezado.<br>• Si un pack de 3 o 5 clases ya se ha empezado, se reembolsará el 50 % de las clases no utilizadas.',
      'Las cancelaciones realizadas con menos de 24 horas de antelación no se reembolsarán, independientemente del método de pago.',
      'Las ausencias sin aviso no se reembolsarán y la clase se considerará disfrutada.',
      'Los alumnos deben respetar a los demás participantes, seguir las indicaciones del instructor y cumplir las normas del surf. No hacerlo puede suponer la expulsión sin reembolso.',
      'Si un alumno llega tarde y se pierde parte de la clase, la sesión terminará igualmente a la hora prevista. No se darán reembolsos ni prórrogas.',
      'Los reembolsos se realizarán por el mismo método de pago utilizado originalmente.',
      'Los packs de clases (solo los de 3 o 5 clases) deben utilizarse en el plazo acordado de 30 días desde la primera clase. No son reembolsables una vez utilizados por completo.',
      'No se realizarán reembolsos por cancelaciones debidas a fuerza mayor (desastres naturales, restricciones gubernamentales, etc.), pero se ofrecerá reprogramar cuando sea posible.',
      'Si soy menor de edad, confirmo que mi padre, madre o tutor legal ha leído y aceptado estos términos en mi nombre.',
      'De acuerdo con el Reglamento (UE) 2016/679 (RGPD) y la LOPDGDD, los datos personales se utilizarán únicamente para la gestión de reservas y la comunicación. Los alumnos y tutores tienen derecho a acceder a sus datos, rectificarlos y suprimirlos.',
      'He leído, entendido y acepto todos los Términos y Condiciones. Asumo plena responsabilidad por mi participación en las actividades de WAYA SURF SCHOOL.',
    ],
    representative: 'Representante autorizado – WAYA SURF SCHOOL',
    accept: 'Declaro que he leído, entendido y acepto todos los Términos y Condiciones, también en nombre de los menores y acompañantes incluidos en esta reserva.',
    signedBy: 'Firmado por',
    fullName: 'Nombre y apellidos', idDoc: 'DNI / Pasaporte', date: 'Fecha',
    note: 'Traducción del original en inglés.',
  },
  de: {
    title: 'Allgemeine Geschäftsbedingungen – Surfkurse',
    intro: 'Mit der Buchung und Teilnahme an Surfkursen der WAYA SURF SCHOOL (Kanarische Inseln, Spanien) akzeptierst du die folgenden Bedingungen:',
    items: [
      'Alle Teilnehmer müssen älter als 5 Jahre sein. Minderjährige benötigen eine unterschriebene Einverständniserklärung eines Elternteils oder Erziehungsberechtigten.',
      'Jede Stunde dauert 2 Stunden und beinhaltet die komplette Surfausrüstung (Surfbrett, Neoprenanzug und Leash).',
      'Surfen ist ein Sport mit naturgegebenen Risiken und hängt stark von der Natur ab. Zu den Risiken gehören Stürze, Zusammenstöße, starke Strömungen, Wellen, Meerestiere, Wetterbedingungen und die Nutzung der Ausrüstung. Die Schule behält sich das Recht vor, Kurse aus Sicherheitsgründen durchzuführen oder abzubrechen.',
      'Wenn es keine Wellen gibt oder die Wetterbedingungen unsicher sind, behält sich die Schule das Recht vor, Kurse durchzuführen oder abzubrechen. Die Schule versucht, Kurse zu verschieben, ist dazu aber nicht verpflichtet.',
      'Sagt die Schule einen Kurs aus organisatorischen Gründen ab, wird dir ein neuer Termin oder die vollständige Erstattung angeboten.',
      'Die Schule haftet nicht für verlorene oder gestohlene persönliche Gegenstände oder Ausrüstung. Die Teilnehmer haften für Schäden, die sie an der Ausrüstung oder an Dritten verursachen.',
      'Ich erkläre, dass ich mich in guter körperlicher und geistiger Verfassung befinde, um an Surfkursen teilzunehmen. Ich bestätige, dass ich an keiner Erkrankung leide, die meine Teilnahme gefährden könnte – unter anderem Asthma, Epilepsie, Herzprobleme, Diabetes, Allergien oder Schwangerschaft –, es sei denn, ich habe die Schule vorab informiert.',
      'Ich bestätige, dass ich selbstständig im offenen Meer schwimmen kann.',
      'Mir ist bewusst, dass Surfen ein körperlich anspruchsvoller Sport mit naturgegebenen Risiken ist, darunter Stürze, Zusammenstöße, starke Strömungen, Wellen, Meerestiere, Wetterbedingungen und die Nutzung der Ausrüstung. Ich erkenne an, dass Verletzungen wie Schnittwunden, Zerrungen, Knochenbrüche, Prellungen, Lähmungen oder sogar der Tod eintreten können.',
      'Soweit nach spanischem Recht zulässig, stelle ich die Surfschule, ihre Inhaber, Lehrer, Mitarbeiter und Partner von jeglicher Haftung für Verletzungen, Unfälle, Verluste oder Schäden während der Aktivität frei, außer bei grober Fahrlässigkeit oder Vorsatz.',
      'Der Teilnehmer übernimmt die volle Verantwortung und akzeptiert die Risiken dieser Aktivität. Er erklärt, ordnungsgemäß über die Regeln der Schule informiert worden zu sein und mit dem Vertrag zwischen der Schule und ihm einverstanden zu sein. Er hat den Vertrag verstanden und akzeptiert und erklärt, dass seine Teilnahme freiwillig erfolgt und er alle möglichen Risiken in eigener Verantwortung trägt.',
      'Teilnehmer, Eltern oder Erziehungsberechtigte erlauben der Surfschule, während der Kurse aufgenommene Fotos und Videos zu Werbezwecken (Website, soziale Medien, Marketing) zu verwenden, sofern ich nicht ausdrücklich schriftlich widerspreche.',
      'Die Schule verfügt über eine gültige Haftpflicht- und Unfallversicherung bei Berkley España. Der Unterzeichnende bzw. die von ihm vertretene Person verzichtet auf jegliche Ansprüche, die über die in der Police festgelegten Deckungsgrenzen hinausgehen. Rechtliche Ansprüche unterliegen spanischem Recht.',
      'Die Zahlung kann vollständig (100 % des Kurses) oder als Anzahlung von 20 % zur Sicherung der Buchung erfolgen, je nach Wunsch des Kunden. Der Restbetrag ist vor Beginn des Kurses zu zahlen.',
      'Alle Buchungen sind nach Eingang der Zahlung oder Anzahlung bestätigt.',
      'Erstattungen sind nur bei höherer Gewalt aufgrund von Krankheit oder Verletzung möglich und müssen mindestens 24 Stunden vor Kursbeginn mit einem gültigen ärztlichen Attest mitgeteilt werden.<br>• Gilt für Einzelstunden.<br>• Gilt für 3er- oder 5er-Pakete nur, wenn sie noch nicht begonnen wurden.<br>• Wurde ein 3er- oder 5er-Paket bereits begonnen, werden 50 % der nicht genutzten Stunden erstattet.',
      'Stornierungen weniger als 24 Stunden vor dem Kurs werden unabhängig von der Zahlungsart nicht erstattet.',
      'Bei Nichterscheinen erfolgt keine Erstattung, und die Stunde gilt als genutzt.',
      'Die Teilnehmer müssen andere respektieren, den Anweisungen der Lehrer folgen und die Surfregeln einhalten. Andernfalls kann ein Ausschluss ohne Erstattung erfolgen.',
      'Kommen Teilnehmer zu spät und verpassen einen Teil des Kurses, endet die Stunde trotzdem zur geplanten Zeit. Es gibt keine Erstattung oder Verlängerung.',
      'Erstattungen erfolgen über dieselbe Zahlungsart wie die ursprüngliche Zahlung.',
      'Kurspakete (nur 3 oder 5 Stunden) müssen innerhalb von 30 Tagen ab der ersten Stunde genutzt werden. Nach vollständiger Nutzung sind sie nicht erstattungsfähig.',
      'Bei Absagen aufgrund höherer Gewalt (Naturkatastrophen, behördliche Einschränkungen usw.) erfolgt keine Erstattung, nach Möglichkeit wird aber ein Ersatztermin angeboten.',
      'Falls ich minderjährig bin, bestätige ich, dass ein Elternteil oder Erziehungsberechtigter diese Bedingungen in meinem Namen gelesen und akzeptiert hat.',
      'Gemäß der Verordnung (EU) 2016/679 (DSGVO) und dem spanischen Datenschutzgesetz (LOPDGDD) werden personenbezogene Daten ausschließlich zur Buchungsverwaltung und Kommunikation verwendet. Teilnehmer und Erziehungsberechtigte haben das Recht auf Auskunft, Berichtigung und Löschung ihrer Daten.',
      'Ich habe alle Bedingungen gelesen, verstanden und akzeptiere sie. Ich übernehme die volle Verantwortung für meine Teilnahme an den Aktivitäten der WAYA SURF SCHOOL.',
    ],
    representative: 'Bevollmächtigter Vertreter – WAYA SURF SCHOOL',
    accept: 'Ich bestätige, dass ich alle Bedingungen gelesen und verstanden habe und sie akzeptiere – auch im Namen der Minderjährigen und Begleitpersonen dieser Buchung.',
    signedBy: 'Unterzeichnet von',
    fullName: 'Vor- und Nachname', idDoc: 'Ausweis- / Passnummer', date: 'Datum',
    note: 'Übersetzung des englischen Originals.',
  },
};

export function contractText(lang) {
  return TEXT[lang] || TEXT.en;
}

/** HTML del contrato (sin la firma) en el idioma pedido. */
export function contractHtml(lang) {
  const c = contractText(lang);
  return `
    <h3 class="ct-title">${c.title}</h3>
    <p>${c.intro}</p>
    <ol class="ct-list">${c.items.map(i => `<li>${i}</li>`).join('')}</ol>
    <p class="ct-rep"><strong>${c.representative}</strong><br>
      NIF: ${ESCUELA.nif} · ${ESCUELA.telefono} · ${ESCUELA.email}<br>
      ${ESCUELA.representante}</p>
    ${c.note ? `<p class="ct-note">${c.note}</p>` : ''}`;
}
