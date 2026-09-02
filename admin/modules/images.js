/* ============================================================
   Utilidades de imagen para el panel.

   Vivían dentro de sections/productos.js, así que camps y actividades
   subían los ficheros TAL CUAL: una foto de móvil son 3–8 MB y la subida
   parecía colgada. Aquí están compartidas por las tres secciones.
   ============================================================ */

/**
 * Redimensiona y recomprime una imagen en el navegador antes de subirla.
 * Una foto de 6 MB a 4032px queda en ~300 KB a 1600px, que es de sobra
 * para la web. Si algo falla, devuelve el fichero original: subir la foto
 * grande es peor que no subir nada.
 */
export async function resizeImage(file, maxDim = 1600, quality = 0.85) {
  if (!file.type?.startsWith('image/') || file.type === 'image/gif') return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  let { width, height } = bitmap;
  const max = Math.max(width, height);
  if (max > maxDim) {
    const scale = maxDim / max;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/**
 * Sube varios ficheros a la vez con un tope de concurrencia.
 *
 * En serie, 10 fotos son 10 esperas encadenadas. En paralelo total se
 * saturan la subida y el navegador. De 3 en 3 va rápido sin atragantarse.
 *
 * Devuelve los resultados EN EL MISMO ORDEN que los ficheros de entrada,
 * con null donde la subida falló, para poder avisar de cuántas fallaron
 * sin perder las que sí subieron.
 */
export async function uploadAll(files, uploadFn, { concurrency = 3, onProgress } = {}) {
  const lista = [...files];
  const salida = new Array(lista.length).fill(null);
  let siguiente = 0;
  let hechas = 0;

  async function turno() {
    while (siguiente < lista.length) {
      const i = siguiente++;
      try {
        salida[i] = await uploadFn(lista[i], i);
      } catch (err) {
        console.warn('uploadAll:', err?.message || err);
        salida[i] = null;
      }
      hechas++;
      onProgress?.(hechas, lista.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, lista.length) }, turno)
  );
  return salida;
}
