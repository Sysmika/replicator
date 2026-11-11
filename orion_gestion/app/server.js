'use strict';
// Orion Gestión: add-on de Home Assistant que abre el sistema de gestión Orion del cliente
// dentro del panel de Home Assistant, sin pedir usuario ni clave.
//
// El sistema de gestión NO corre acá: sigue en la web, independiente. Este add-on solo:
//  1. recibe a la persona que abrió el panel (Ingress, cabeceras X-Remote-User-* del Supervisor);
//  2. le pide al sistema un token de un solo uso (POST <sistema>/sso/nexus.php con la API key de la instalación);
//  3. muestra el sistema con ese token, en un marco o en una ventana nueva.
// El sistema valida la API key contra Orion AR. Si la instalación se da de baja, la key deja de validar
// y el cliente sigue entrando por la web con su usuario y clave de siempre.
//
// Sin dependencias: Node 22 (fetch y AbortSignal.timeout vienen incluidos).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const E = process.env;
const DATA = E.DATA_DIR || '/data';
const PORT = Number(E.PORT || 8099);
const HOST = E.HOST || '0.0.0.0';
const SUPERVISOR_IP = '172.30.32.2';
const DEV_USER = E.DEV_USER || ''; // solo pruebas fuera de Home Assistant
const TIMEOUT_MS = 8000;

// ---- configuración del complemento (/data/options.json) ----
function cargarOpciones() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(path.join(DATA, 'options.json'), 'utf8')); } catch { /* fuera de HA: variables de entorno */ }
  const sistema = String(E.SISTEMA_URL || o.sistema_url || '').trim().replace(/\/+$/, '');
  const apiKey = String(E.API_KEY || o.api_key || '').trim();
  const apertura = String(E.APERTURA || o.apertura || 'marco') === 'ventana' ? 'ventana' : 'marco';
  return { sistema, apiKey, apertura };
}
const OPC = cargarOpciones();

function problemaConfig() {
  if (!OPC.sistema) return 'Falta la dirección del sistema de gestión.';
  let u;
  try { u = new URL(OPC.sistema); } catch { return 'La dirección del sistema de gestión no es válida.'; }
  if (u.protocol !== 'https:' && !DEV_USER) return 'La dirección del sistema de gestión tiene que empezar con https://.';
  if (!OPC.apiKey) return 'Falta la API key de esta instalación.';
  if (!/^[\x21-\x7e]{16,256}$/.test(OPC.apiKey)) return 'La API key no tiene el formato esperado. Copiala completa, sin espacios.';
  return null;
}
const ORIGEN_SISTEMA = (() => { try { return new URL(OPC.sistema).origin; } catch { return ''; } })();

// ---- quién abrió el panel ----
const ipDe = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
function usuarioDe(req) {
  if (ipDe(req) === SUPERVISOR_IP && req.headers['x-remote-user-id']) {
    return String(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || 'Usuario').slice(0, 80);
  }
  if (DEV_USER) return DEV_USER;
  return null; // no vino por Ingress: no se emite ningún acceso
}

// ---- pedirle al sistema de gestión un token de un solo uso ----
const MENSAJES = {
  key_invalida: 'La API key de esta instalación no es válida o fue reemplazada. Pedile a Orion la key nueva.',
  instalacion_inactiva: 'Esta instalación Nexus no está activa. Comunicate con Orion.',
  servicio_inactivo: 'Esta instalación no tiene habilitado Orion Gestión. Comunicate con Orion.',
  dominio_no_coincide: 'Esta instalación está habilitada para otro sistema de gestión. Revisá la dirección en la configuración del complemento.',
  usuario_no_encontrado: 'El usuario del sistema asignado a esta instalación no existe o está inactivo.',
  orion_ar_no_disponible: 'Orion no responde en este momento. Probá de nuevo en unos minutos.',
  demasiados_intentos: 'Demasiados intentos seguidos. Esperá un minuto y volvé a abrir.',
  service_key_invalida: 'El sistema de gestión no está bien conectado con Orion. Comunicate con Orion.',
};

async function pedirAcceso(usuario) {
  let r;
  try {
    r = await fetch(OPC.sistema + '/sso/nexus.php', {
      method: 'POST',
      headers: {
        'X-API-Key': OPC.apiKey,
        // Las cabeceras HTTP son ASCII: el nombre va codificado (ej. "Mar%C3%ADa"). El sistema lo decodifica con rawurldecode.
        'X-Nexus-User': encodeURIComponent(usuario),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error('Sin respuesta del sistema de gestión:', e.name === 'TimeoutError' ? 'tiempo agotado' : e.message);
    return { ok: false, mensaje: 'No se pudo conectar con el sistema de gestión. Revisá la conexión a internet o probá en unos minutos.' };
  }
  let j = null;
  try { j = await r.json(); } catch { /* respuesta no JSON */ }
  if (r.ok && j && j.ok === true && typeof j.url === 'string') {
    let destino;
    try { destino = new URL(j.url); } catch { destino = null; }
    // Solo se abre una dirección del mismo sistema configurado: nunca otro sitio.
    if (!destino || destino.origin !== ORIGEN_SISTEMA) {
      console.error('El sistema devolvió una dirección de otro sitio; se rechaza.');
      return { ok: false, mensaje: 'El sistema de gestión respondió algo inesperado. Comunicate con Orion.' };
    }
    return { ok: true, url: destino.href };
  }
  const codigo = j && typeof j.error === 'string' ? j.error : '';
  console.error(`El sistema de gestión rechazó el acceso: HTTP ${r.status} ${codigo}`);
  return { ok: false, mensaje: MENSAJES[codigo] || `El sistema de gestión no permitió el acceso (código ${r.status}).` };
}

// ---- páginas ----
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ESTILO = `
:root{--bg:#0f1720;--fg:#e8eef5;--muted:#9aa8b8;--acc:#2f9bff;--card:#17212d}
@media (prefers-color-scheme: light){:root{--bg:#f4f6f9;--fg:#15202b;--muted:#5b6b7c;--card:#fff}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.centro{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:var(--card);border-radius:14px;padding:24px;max-width:440px;width:100%;box-shadow:0 4px 18px rgba(0,0,0,.18)}
h1{font-size:18px;margin:0 0 10px}p{margin:0 0 16px;color:var(--muted)}
.btn{display:inline-block;background:var(--acc);color:#fff;text-decoration:none;border:0;border-radius:10px;padding:10px 16px;font-weight:600;cursor:pointer}
.btn.sec{background:transparent;color:var(--acc);padding:10px 4px}
.marco{position:fixed;inset:0;display:flex;flex-direction:column}
.marco iframe{flex:1;border:0;width:100%;background:#fff}
.barra{display:flex;justify-content:flex-end;gap:12px;padding:4px 10px;font-size:13px;background:var(--card)}
.barra a{color:var(--acc);text-decoration:none}`;

function pagina(res, codigo, cuerpo, frameOrigen) {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    frameOrigen ? `frame-src ${frameOrigen}` : '',
    "base-uri 'none'",
    "form-action 'none'",
  ].filter(Boolean).join('; ');
  res.writeHead(codigo, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': csp,
  });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orion Gestión</title><style>${ESTILO}</style></head><body>${cuerpo}</body></html>`);
}

function aviso(res, codigo, titulo, texto, conReintento = true) {
  // Rutas relativas: con Ingress el add-on vive en /api/hassio_ingress/<token>/, no en la raíz.
  const boton = conReintento ? '<a class="btn" href="./">Volver a intentar</a>' : '';
  pagina(res, codigo, `<div class="centro"><div class="card"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p>${boton}</div></div>`);
}

async function inicio(req, res, usuario) {
  const problema = problemaConfig();
  if (problema) return aviso(res, 200, 'Falta configurar Orion Gestión', problema + ' Se carga en Configuración → Complementos → Orion Gestión → Configuración.', false);

  if (OPC.apertura === 'ventana') {
    return pagina(res, 200, `<div class="centro"><div class="card"><h1>Orion Gestión</h1><p>El sistema se abre en una ventana nueva, ya con tu sesión iniciada.</p><a class="btn" href="abrir" target="_blank" rel="noopener">Abrir el sistema</a></div></div>`);
  }

  const acceso = await pedirAcceso(usuario);
  if (!acceso.ok) return aviso(res, 502, 'No se pudo abrir el sistema de gestión', acceso.mensaje);
  pagina(res, 200,
    `<div class="marco"><div class="barra"><a href="abrir" target="_blank" rel="noopener">¿No carga o pide clave? Abrir en ventana nueva</a></div>` +
    `<iframe src="${esc(acceso.url)}" title="Orion Gestión" allow="clipboard-write; camera" referrerpolicy="no-referrer"></iframe></div>`,
    ORIGEN_SISTEMA);
}

async function abrirEnVentana(req, res, usuario) {
  const problema = problemaConfig();
  if (problema) return aviso(res, 200, 'Falta configurar Orion Gestión', problema, false);
  const acceso = await pedirAcceso(usuario);
  if (!acceso.ok) return aviso(res, 502, 'No se pudo abrir el sistema de gestión', acceso.mensaje);
  res.writeHead(302, { Location: acceso.url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end();
}

// ---- servidor ----
const servidor = http.createServer(async (req, res) => {
  try {
    const ruta = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
    if (ruta === '/salud') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (req.method === 'HEAD') { res.writeHead(200, { 'Cache-Control': 'no-store' }); return res.end(); } // nunca emite accesos
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); return res.end(); }

    const usuario = usuarioDe(req);
    if (!usuario) return aviso(res, 403, 'Acceso no permitido', 'Orion Gestión se abre solo desde el menú de Home Assistant.', false);

    if (ruta === '/') return await inicio(req, res, usuario);
    if (ruta === '/abrir') return await abrirEnVentana(req, res, usuario);
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('No encontrado');
  } catch (e) {
    console.error('Error inesperado:', e);
    if (!res.headersSent) aviso(res, 500, 'Error inesperado', 'Probá de nuevo. Si sigue, avisale a Orion.');
    else res.end();
  }
});

servidor.listen(PORT, HOST, () => {
  const p = problemaConfig();
  console.log(`Orion Gestión escuchando en ${HOST}:${PORT}. Sistema: ${OPC.sistema || '(sin configurar)'}. Apertura: ${OPC.apertura}.`);
  if (p) console.warn('Configuración incompleta: ' + p);
  if (DEV_USER) console.warn(`Modo prueba: cualquier pedido entra como "${DEV_USER}".`);
});
