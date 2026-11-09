'use strict';
// Feriados de Argentina para el calendario de vencimientos. En Replicator no hay Google Calendar:
// los feriados salen de la API pública ArgentinaDatos y se guardan en memoria un día.
// Expone la misma forma que gcal.js de madoval (activo() siempre false) para no tocar casa.js.
const cache = new Map();

async function feriados(anio) {
  const c = cache.get(anio);
  if (c && Date.now() < c.hasta) return c.lista;
  let lista = [];
  try {
    const r = await fetch(`https://api.argentinadatos.com/v1/feriados/${anio}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => []);
    if (r.ok && Array.isArray(j)) lista = j.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)).map((f) => ({ fecha: f.fecha, nombre: String(f.nombre || 'Feriado') }));
  } catch (e) { console.error('Feriados:', e.message); }
  cache.set(anio, { lista, hasta: Date.now() + (lista.length ? 24 * 3600e3 : 10 * 60e3) });
  return lista;
}

module.exports = {
  activo: () => false,
  feriados,
  guardar: async () => { throw new Error('Google Calendar no está disponible en Replicator'); },
  borrar: async () => {},
};
