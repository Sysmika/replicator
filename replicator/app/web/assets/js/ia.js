'use strict';
// Capa común para usar la IA de Orion desde Casa y Salud.
// El navegador nunca habla con el gateway: pasa por la API propia, que decide si la IA está
// habilitada para cada módulo (Salud se activa por separado, son datos sensibles).
const Ia = {
  estado: { casa: false, salud: false },

  async cargarEstado() {
    const r = await Api.get('/ia/estado');
    if (r.ok && r.ia) this.estado = r.ia;
    return this.estado;
  },

  // Achica la foto antes de subirla (celular) y devuelve base64 sin prefijo.
  async prepararImagen(archivo, ladoMax = 1600) {
    const bmp = await createImageBitmap(archivo);
    const k = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { mime: 'image/jpeg', base64: dataUrl.split(',')[1] };
  },

  // modulo: 'casa' | 'salud'; tipo: 'ticket_balanza' | 'factura' | 'libre' ...
  async extraer(modulo, archivo, tipo = 'libre', pista = '') {
    if (!this.estado[modulo]) return { ok: false, error: 'La IA está desactivada para ' + modulo };
    const img = await this.prepararImagen(archivo);
    return Api.post('/ia/extraer', { modulo, tipo, pista, mime: img.mime, imagen_base64: img.base64 });
  },
};
