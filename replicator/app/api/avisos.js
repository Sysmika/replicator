'use strict';
// Avisos diarios por Home Assistant: cada mañana manda un resumen de vencimientos a las apps de celular de Home Assistant.
// Dentro del add-on usa el Supervisor (SUPERVISOR_TOKEN), sin configurar tokens. Fuera de HA: HA_URL + HA_NOTIFY_TOKEN.
const E = process.env;

const TZ = E.AVISOS_TZ || E.TZ || 'America/Argentina/Buenos_Aires'; // dentro de HA, TZ la pasa el Supervisor
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/.test(E.AVISOS_HORA || '') ? E.AVISOS_HORA : '09:00';

function destino() {
  if (E.HA_URL && E.HA_NOTIFY_TOKEN) return { base: E.HA_URL.replace(/\/+$/, ''), token: E.HA_NOTIFY_TOKEN };
  if (E.SUPERVISOR_TOKEN) return { base: 'http://supervisor/core', token: E.SUPERVISOR_TOKEN }; // dentro de un add-on de HA
  return null;
}
const servicios = () => (E.HA_NOTIFY_SERVICES || '').split(',').map((s) => s.trim()).filter((s) => /^notify\.[a-z0-9_]+$/.test(s));
const activo = () => E.AVISOS_ENABLED === 'true' && !!destino() && servicios().length > 0;

// { dia: 'AAAA-MM-DD', hm: 'HH:MM' } en la zona horaria configurada.
function ahora(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

const cuando = (d) => (d < 0 ? `vencido hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'vence HOY' : d === 1 ? 'vence mañana' : `vence en ${d} días`);

// Texto del aviso a partir del resumen (casa.resumenHA). null si no hay nada que avisar.
function armarMensaje(r, conCompras = false) {
  const urgentes = (r.items || []).filter((i) => i.dias <= 3).sort((a, b) => a.dias - b.dias);
  const lineas = urgentes.map((i) => `• ${i.nombre}: ${cuando(i.dias)}`);
  const compras = conCompras && r.compras_faltan > 0 ? `Compras: faltan ${r.compras_faltan} ${r.compras_faltan === 1 ? 'producto' : 'productos'}.` : '';
  if (!lineas.length) return null;
  const hayVencidos = urgentes.some((i) => i.dias < 0);
  return { title: hayVencidos ? 'Vencimientos de la casa (hay vencidos)' : 'Vencimientos de la casa', message: [...lineas, compras].filter(Boolean).join('\n') };
}

async function enviarA(servicio, aviso) {
  const d = destino();
  const [dominio, nombre] = servicio.split('.');
  const url = E.AVISOS_URL || '/'; // en el add-on: el panel de Replicator dentro de HA
  const r = await fetch(`${d.base}/api/services/${dominio}/${nombre}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: aviso.title, message: aviso.message, data: { tag: 'replicator-vencimientos', group: 'replicator', url, clickAction: url } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Home Assistant respondió ${r.status} para ${servicio}`);
}

// Manda a todos los celulares configurados. Devuelve { enviados, errores[] }.
async function enviar(aviso) {
  let enviados = 0;
  const errores = [];
  for (const s of servicios()) {
    try { await enviarA(s, aviso); enviados++; } catch (e) { errores.push(e.message); }
  }
  return { enviados, errores };
}

module.exports = function crearAvisos({ pool, casa }) {
  let ultimoDia = null;     // día ya resuelto (enviado o sin nada que avisar)
  let reintentoDesde = 0;   // si falló, no insiste antes de este momento
  let temporizador = null;

  async function iniciar() {
    await pool.query(`CREATE TABLE IF NOT EXISTS avisos_enviados (
      dia DATE NOT NULL PRIMARY KEY, creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
    if (!activo()) { console.log('Avisos por Home Assistant: apagados (AVISOS_ENABLED, HA_URL, HA_NOTIFY_TOKEN, HA_NOTIFY_SERVICES)'); return; }
    console.log(`Avisos por Home Assistant: activos, ${HORA} (${TZ}), a ${servicios().join(', ')}`);
    temporizador = setInterval(() => tic().catch((e) => console.error('Avisos:', e.message)), 60 * 1000);
    temporizador.unref();
    tic().catch((e) => console.error('Avisos:', e.message));
  }

  async function tic() {
    const { dia, hm } = ahora();
    if (hm < HORA || ultimoDia === dia || Date.now() < reintentoDesde) return;
    const [ya] = await pool.query('SELECT 1 FROM avisos_enviados WHERE dia = ?', [dia]);
    if (ya[0]) { ultimoDia = dia; return; }
    const aviso = armarMensaje(await casa.resumenHA(), E.AVISOS_COMPRAS === 'true');
    if (aviso) {
      const r = await enviar(aviso);
      if (!r.enviados) { reintentoDesde = Date.now() + 30 * 60 * 1000; throw new Error('No se pudo enviar el aviso: ' + r.errores.join('; ')); }
      if (r.errores.length) console.error('Avisos (parcial):', r.errores.join('; '));
    }
    await pool.query('INSERT IGNORE INTO avisos_enviados (dia) VALUES (?)', [dia]);
    ultimoDia = dia;
  }

  // Envío manual desde la app (botón "Probar aviso"): manda el estado de hoy aunque no haya nada urgente.
  async function probar() {
    if (!activo()) return { ok: false, error: 'Los avisos no están activados en el servidor' };
    const resumen = await casa.resumenHA();
    const aviso = armarMensaje(resumen, E.AVISOS_COMPRAS === 'true') || { title: 'Vencimientos de la casa', message: 'Prueba: no hay vencimientos en los próximos 3 días.' };
    const r = await enviar(aviso);
    return r.enviados ? { ok: true, enviados: r.enviados, errores: r.errores } : { ok: false, error: r.errores.join('; ') || 'No se pudo enviar' };
  }

  return { iniciar, probar, activo, hora: () => HORA };
};
module.exports._util = { armarMensaje, ahora };
