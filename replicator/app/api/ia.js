'use strict';
// Capa común para llamar a la IA de Orion (gateway). Solo módulo Casa: Replicator no maneja datos de salud.
// La clave de cada instalación la carga el instalador en las opciones del add-on (orion_gateway_key).

const flag = (v) => String(v || '').toLowerCase() === 'true';

function estado() {
  const lista = !!(process.env.ORION_GATEWAY_URL && process.env.ORION_GATEWAY_KEY);
  return { casa: lista && flag(process.env.IA_CASA_ENABLED), salud: false };
}

async function llamar(endpoint, datos) {
  const r = await fetch(process.env.ORION_GATEWAY_URL.replace(/\/+$/, '') + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orion-Key': process.env.ORION_GATEWAY_KEY },
    body: JSON.stringify(datos),
    signal: AbortSignal.timeout(60000),
  });
  if (r.status === 401 || r.status === 403) return { success: false, error: 'La clave de IA de esta instalación no es válida. Revisala en la configuración del complemento.' };
  if (r.status === 429) return { success: false, error: 'Limite de requests superado. Reintentar en 60 segundos.', retry_after: 60 };
  const txt = await r.text();
  try { return JSON.parse(txt); }
  catch { return { success: false, error: `Respuesta invalida del gateway (HTTP ${r.status})` }; }
}

// Extrae datos estructurados de una imagen.
async function extraer({ modulo, tipo, mime, imagenBase64, pista }) {
  if (modulo !== 'casa' || !estado().casa) return { success: false, error: 'La IA está desactivada.' };
  const payload = {
    module: process.env.ORION_GATEWAY_MODULE || 'replicator',
    extract_type: tipo || 'libre',
    mime_type: mime,
    image_base64: imagenBase64,
  };
  if (pista) payload.hint = pista;
  if (process.env.INSTALACION_ID) payload.installation = process.env.INSTALACION_ID;
  return llamar('/v1/extract', payload);
}

module.exports = { estado, extraer };
