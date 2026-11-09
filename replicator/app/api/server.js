'use strict';
// Replicator: add-on de Home Assistant para el stock y las compras de la casa.
// Basado en madoval (Casa). Diferencias con madoval:
//  - corre detrás de Ingress de Home Assistant (dentro del panel de HA, sin login propio);
//  - la persona es el usuario de Home Assistant (cabeceras X-Remote-User-* que agrega el Supervisor);
//  - base SQLite en /data (entra en los backups de HA), sin MariaDB;
//  - configuración desde /data/options.json (pantalla de configuración del complemento);
//  - sin Salud ni Google Calendar.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const E = process.env;
const DATA = E.DATA_DIR || '/data';

// ---- configuración del complemento -> variables de entorno que ya usan casa.js, ia.js y avisos.js ----
function cargarOpciones() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(path.join(DATA, 'options.json'), 'utf8')); } catch { /* fuera de HA: solo variables de entorno */ }
  const poner = (k, v) => { if (v !== undefined && v !== null && !(k in E)) E[k] = String(v); };
  poner('ORION_GATEWAY_URL', o.orion_gateway_url);
  poner('AVISOS_ENABLED', o.avisos_activos);
  poner('AVISOS_HORA', o.avisos_hora);
  poner('AVISOS_COMPRAS', o.avisos_compras);
  if (Array.isArray(o.avisos_celulares)) poner('HA_NOTIFY_SERVICES', o.avisos_celulares.join(','));
}

// Identificador propio de esta instalación (se crea una vez y queda en /data). Sirve para que Orion
// distinga el uso de la IA de cada casa o comercio.
function instalacionId() {
  const archivo = path.join(DATA, 'instalacion.json');
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')).id; } catch { /* primera vez */ }
  const id = crypto.randomUUID();
  try { fs.writeFileSync(archivo, JSON.stringify({ id, creado: new Date().toISOString() })); } catch (e) { console.error('No se pudo guardar instalacion.json:', e.message); }
  return id;
}

// ---- clave de IA: la carga el cliente desde el panel de Replicator (Mi perfil → Servicio de IA) ----
// Orion la genera para cada instalación. Se guarda solo en /data/ia.json (dentro del Home Assistant del cliente)
// y nunca se devuelve al navegador: la app solo ve los últimos 4 caracteres.
const ARCHIVO_IA = path.join(DATA, 'ia.json');
function aplicarClaveIA(clave) {
  if (clave) { E.ORION_GATEWAY_KEY = clave; E.IA_CASA_ENABLED = 'true'; }
  else { delete E.ORION_GATEWAY_KEY; E.IA_CASA_ENABLED = 'false'; }
}
function cargarClaveIA() {
  try { aplicarClaveIA(JSON.parse(fs.readFileSync(ARCHIVO_IA, 'utf8')).clave || ''); }
  catch { if (!E.ORION_GATEWAY_KEY) aplicarClaveIA(''); else E.IA_CASA_ENABLED = 'true'; } // sin archivo: variable de entorno (pruebas)
}
function estadoClaveIA() {
  const k = E.ORION_GATEWAY_KEY || '';
  return { configurada: !!k, termina: k ? k.slice(-4) : null, instalacion: E.INSTALACION_ID };
}

async function guardarClaveIA(req, res, usuario) {
  const d = await leerJSON(req, 2000);
  if (d.borrar === true) {
    try { fs.unlinkSync(ARCHIVO_IA); } catch { /* ya no estaba */ }
    aplicarClaveIA('');
    console.log(`Clave de IA quitada por ${usuario.nombre}`);
    return enviar(res, 200, { ok: true, ...estadoClaveIA() });
  }
  const clave = typeof d.clave === 'string' ? d.clave.trim() : '';
  if (!/^[\x21-\x7e]{16,200}$/.test(clave)) return enviar(res, 400, { ok: false, error: 'La clave no tiene el formato esperado. Copiala completa, sin espacios.' });
  const tmp = ARCHIVO_IA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ clave, guardada: new Date().toISOString(), usuario: usuario.nombre }), { mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO_IA);
  aplicarClaveIA(clave);
  console.log(`Clave de IA cargada por ${usuario.nombre} (termina en ${clave.slice(-4)})`);
  enviar(res, 200, { ok: true, ...estadoClaveIA() });
}

cargarOpciones();
E.INSTALACION_ID = E.INSTALACION_ID || instalacionId();
cargarClaveIA();

const { abrir } = require('./db');
const ia = require('./ia');
const pool = abrir(E.DB_PATH || path.join(DATA, 'replicator.db'));

// ---- utilidades ----
function enviar(res, codigo, obj, extra = {}) {
  const cuerpo = JSON.stringify(obj);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(cuerpo);
}

function leerJSON(req, limite) {
  return new Promise((ok, fallo) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) { fallo(Object.assign(new Error('Demasiado grande'), { codigo: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      try { ok(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); }
      catch { fallo(Object.assign(new Error('JSON invalido'), { codigo: 400 })); }
    });
    req.on('error', fallo);
  });
}

// ---- usuarios: los de Home Assistant ----
// Con Ingress, el Supervisor (172.30.32.2) autentica a la persona y agrega X-Remote-User-Id / -Name / -Display-Name.
// Solo se aceptan esas cabeceras si la conexión viene del Supervisor. Para probar fuera de HA: DEV_USER=nombre.
const SUPERVISOR_IP = '172.30.32.2';
const ipDe = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

async function prepararUsuarios() {
  await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ha_id VARCHAR(64) NOT NULL UNIQUE,
    nombre VARCHAR(80) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function usuarioActual(req) {
  let haId, nombre;
  if (ipDe(req) === SUPERVISOR_IP && req.headers['x-remote-user-id']) {
    haId = String(req.headers['x-remote-user-id']).slice(0, 64);
    nombre = String(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || 'Usuario').slice(0, 80);
  } else if (E.DEV_USER) {
    haId = 'dev'; nombre = E.DEV_USER;
  } else {
    return null;
  }
  const [f] = await pool.query('SELECT id, nombre FROM usuarios WHERE ha_id = ?', [haId]);
  if (f[0]) {
    if (f[0].nombre !== nombre) await pool.query('UPDATE usuarios SET nombre = ? WHERE id = ?', [nombre, f[0].id]);
    return { id: f[0].id, nombre };
  }
  const [r] = await pool.query('INSERT INTO usuarios (ha_id, nombre) VALUES (?, ?)', [haId, nombre]);
  return { id: r.insertId, nombre };
}

// ---- archivos estáticos de la app ----
const WEB_DIR = path.resolve(E.WEB_DIR || path.join(__dirname, '..', 'web'));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
// Se muestra dentro del panel de Home Assistant (iframe del mismo origen): por eso SAMEORIGIN y frame-ancestors 'self'.
const CABECERAS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};

// Huella de la app (nombre, fecha y tamaño de cada archivo, menos sw.js) inyectada en sw.js:
// cuando se actualiza el complemento, el navegador toma la versión nueva solo.
let cacheVersion = '';
async function versionWeb() {
  if (cacheVersion) return cacheVersion; // dentro del contenedor los archivos no cambian hasta la próxima versión
  const hash = crypto.createHash('sha1');
  async function recorrer(dir) {
    const entradas = await fs.promises.readdir(dir, { withFileTypes: true });
    entradas.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entradas) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await recorrer(p);
      else if (MIME[path.extname(e.name).toLowerCase()] && e.name !== 'sw.js') {
        const s = await fs.promises.stat(p);
        hash.update(`${e.name}:${s.mtimeMs}:${s.size};`);
      }
    }
  }
  await recorrer(WEB_DIR);
  cacheVersion = hash.digest('hex').slice(0, 10);
  return cacheVersion;
}

async function estatico(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = null; }
  const noEncontrado = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...CABECERAS }); res.end('No encontrado'); };
  if (!rel || rel.includes('\0') || !['GET', 'HEAD'].includes(req.method)) return noEncontrado();
  if (rel.endsWith('/')) rel += 'index.html';
  const partes = rel.split('/').filter(Boolean);
  if (partes.some((p) => p.startsWith('.'))) return noEncontrado();
  const archivo = path.resolve(WEB_DIR, ...partes);
  if (!archivo.startsWith(WEB_DIR + path.sep)) return noEncontrado();
  const tipo = MIME[path.extname(archivo).toLowerCase()];
  if (!tipo) return noEncontrado();
  try {
    let datos = await fs.promises.readFile(archivo);
    if (partes.length === 1 && partes[0] === 'sw.js') {
      datos = Buffer.from(datos.toString('utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${await versionWeb()}';`), 'utf8');
    }
    const sinCache = /\.(html|js|css|webmanifest|json)$/.test(archivo);
    res.writeHead(200, {
      'Content-Type': tipo, 'Content-Length': datos.length,
      'Cache-Control': sinCache ? 'no-store' : 'no-cache',
      ...CABECERAS,
    });
    res.end(req.method === 'HEAD' ? undefined : datos);
  } catch { noEncontrado(); }
}

// ---- avisos: el clic en la notificación abre el panel del complemento ----
async function urlDelPanel() {
  if (E.AVISOS_URL || !E.SUPERVISOR_TOKEN) return;
  try {
    const r = await fetch('http://supervisor/addons/self/info', { headers: { Authorization: 'Bearer ' + E.SUPERVISOR_TOKEN }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j && j.data && j.data.slug) E.AVISOS_URL = '/hassio/ingress/' + j.data.slug;
  } catch (e) { console.error('No se pudo leer la información del complemento:', e.message); }
}

const casa = require('./casa')({ pool, ia, leerJSON, enviar });
const avisos = require('./avisos')({ pool, casa });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const ruta = url.pathname.replace(/\/+$/, '');

    if (!url.pathname.startsWith('/api/')) return await estatico(req, res, url.pathname);

    // Defensa CSRF extra: toda escritura debe traer este header (el navegador no lo manda en formularios ajenos).
    if (req.method === 'POST' && req.headers['x-requested-with'] !== 'madoval') {
      return enviar(res, 403, { ok: false, error: 'Solicitud no permitida' });
    }

    const usuario = await usuarioActual(req);
    if (!usuario) return enviar(res, 401, { ok: false, error: 'Abrí Replicator desde el menú de Home Assistant.' });

    if (req.method === 'GET' && ruta === '/api/me') return enviar(res, 200, { ok: true, usuario, ha: true });
    if (req.method === 'GET' && ruta === '/api/ia/estado') return enviar(res, 200, { ok: true, ia: ia.estado() });
    if (req.method === 'GET' && ruta === '/api/config/ia') return enviar(res, 200, { ok: true, ...estadoClaveIA() });
    if (req.method === 'POST' && ruta === '/api/config/ia') return await guardarClaveIA(req, res, usuario);

    if (req.method === 'GET' && ruta === '/api/avisos/estado') return enviar(res, 200, { ok: true, activo: avisos.activo(), hora: avisos.hora() });
    if (req.method === 'POST' && ruta === '/api/avisos/probar') return enviar(res, 200, await avisos.probar());

    if (ruta.startsWith('/api/casa/') && await casa.manejar(req, res, usuario, ruta)) return;

    enviar(res, 404, { ok: false, error: 'No encontrado' });
  } catch (e) {
    if (e.codigo) return enviar(res, e.codigo, { ok: false, error: e.message });
    console.error(e);
    enviar(res, 500, { ok: false, error: 'Error interno' });
  }
});

const PUERTO = +E.PORT || 8099;
const HOST = E.HOST || '0.0.0.0';

prepararUsuarios()
  .then(() => casa.iniciar())
  .then(() => urlDelPanel())
  .then(() => avisos.iniciar())
  .then(() => {
    server.listen(PUERTO, HOST, () => {
      console.log(`Replicator escuchando en ${HOST}:${PUERTO} · IA ${ia.estado().casa ? 'activa' : 'desactivada'} · instalación ${E.INSTALACION_ID}`);
    });
  })
  .catch((e) => { console.error('No se pudo iniciar Replicator:', e.message); process.exit(1); });

for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { server.close(); try { pool.cerrar(); } catch {} process.exit(0); });
