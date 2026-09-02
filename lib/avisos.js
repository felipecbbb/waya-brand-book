/* ============================================================
   Avisos por correo desde el frontend público.

   Reemplaza a supabase.functions.invoke('send-email'), que apuntaba a una
   Edge Function que nunca se desplegó: devolvía 404 y, como las llamadas iban
   en try/catch, fallaba en silencio.

   El servidor limita a quién se puede escribir: un cliente solo puede
   dispararse avisos a sí mismo o a la escuela.
   ============================================================ */
import { supabase } from '/lib/supabase.js';

export async function enviarAviso(cuerpo) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;                    // sin sesión no hay a quién avisar
  const res = await fetch('/enviar-aviso.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    throw new Error(out.error || `Error ${res.status} al enviar el aviso`);
  }
}
