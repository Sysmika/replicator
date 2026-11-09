'use strict';
// Capa de llamadas a la API (mismo dominio, cookie de sesión HttpOnly).
const Api = {
  async pedir(metodo, ruta, cuerpo) {
    let r;
    try {
      r = await fetch('api' + ruta, {
        method: metodo,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'madoval' },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
    } catch {
      return { ok: false, offline: true, error: 'Sin conexión' };
    }
    let datos = {};
    try { datos = await r.json(); } catch { /* respuesta vacía */ }
    return { ...datos, ok: r.ok && datos.ok !== false, status: r.status };
  },
  get(ruta) { return this.pedir('GET', ruta); },
  post(ruta, cuerpo) { return this.pedir('POST', ruta, cuerpo || {}); },
};
