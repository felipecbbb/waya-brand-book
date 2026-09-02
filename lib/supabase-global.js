// Publica el cliente único de Supabase como global `window.supabase`.
//
// Lo necesitan los scripts clásicos que viven en public/js/ (blog-engine.js):
// al estar en publicDir, Vite los copia tal cual sin pasarlos por el bundler,
// así que no pueden hacer `import` y dependen del global.
//
// Sustituye al antiguo public/js/config.js, que traía la URL y la key
// escritas a mano y era una segunda fuente de verdad: al cambiar de proyecto
// Supabase había que acordarse de tocar dos sitios, y el fallo era silencioso.
// Ahora la configuración sale solo de VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
//
// Los módulos se ejecutan antes de DOMContentLoaded, y blog-engine.js arranca
// dentro de ese evento, así que el global ya está listo cuando lo busca.
import { supabase } from '/lib/supabase.js';

window.supabase = supabase;
