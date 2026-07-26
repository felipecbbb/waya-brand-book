import { resolve } from 'path';
import { readdirSync, statSync } from 'fs';

// Descubre entradas multipágina:
//  - páginas planas en la raíz (index.html, clases-grupales.html, ...) → se mantienen sus URLs actuales
//  - nuevas secciones en carpeta (mi-cuenta/index.html, admin/index.html, carrito/, finalizar-compra/, ...)
const IGNORE = new Set(['dist', 'node_modules', 'public', 'docs', 'supabase', 'research', 'src']);

function discoverPages(root) {
  const pages = {};
  for (const entry of readdirSync(root)) {
    if (IGNORE.has(entry) || entry.startsWith('.')) continue;
    const full = resolve(root, entry);
    const st = statSync(full);
    if (st.isFile() && entry.endsWith('.html')) {
      // clave = nombre de archivo COMPLETO (index.html, admin.html, ...) para
      // no colisionar con carpetas del mismo nombre (p.ej. admin.html vs admin/).
      pages[entry] = full;
    } else if (st.isDirectory()) {
      const html = resolve(full, 'index.html');
      try {
        statSync(html);
        pages[entry] = html;
      } catch {
        /* la carpeta no tiene index.html: se ignora */
      }
    }
  }
  return pages;
}

export default {
  root: '.',
  publicDir: 'public',
  server: { port: 5173, open: false },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: discoverPages(resolve(import.meta.dirname)),
    },
  },
};
