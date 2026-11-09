'use strict';
// Módulo CASA (paso 2): stock de mercadería con identificación de productos por foto.
// Casa es una sola por hogar: todos los usuarios de Home Assistant comparten el mismo stock.
// Versión Replicator (add-on de Home Assistant): base SQLite, sin Google Calendar.

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS cat_categorias (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     nombre VARCHAR(60) NOT NULL UNIQUE
   ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS cat_marcas (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     nombre VARCHAR(60) NOT NULL UNIQUE
   ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS articulos (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     nombre VARCHAR(120) NOT NULL,
     marca_id INT UNSIGNED NULL,
     categoria_id INT UNSIGNED NULL,
     presentacion VARCHAR(40) NULL,
     codigo_barras VARCHAR(30) NULL,
     stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0,
     stock_minimo DECIMAL(10,2) NOT NULL DEFAULT 1,
     activo TINYINT(1) NOT NULL DEFAULT 1,
     creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX (codigo_barras), INDEX (nombre),
     FOREIGN KEY (marca_id) REFERENCES cat_marcas(id) ON DELETE SET NULL,
     FOREIGN KEY (categoria_id) REFERENCES cat_categorias(id) ON DELETE SET NULL
   ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS movimientos_stock (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     articulo_id INT UNSIGNED NOT NULL,
     usuario_id INT UNSIGNED NULL,
     delta DECIMAL(10,2) NOT NULL,
     motivo VARCHAR(20) NOT NULL,
     creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX (articulo_id),
     FOREIGN KEY (articulo_id) REFERENCES articulos(id) ON DELETE CASCADE,
     FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
   ) ENGINE=InnoDB`,
  // Alias: cómo "lee" la IA un producto (nombre|marca|presentación) -> a qué artículo corresponde.
  // Se aprende solo cuando el usuario corrige o elige un artículo; evita duplicados.
  `CREATE TABLE IF NOT EXISTS articulo_alias (
     clave_lectura VARCHAR(255) NOT NULL PRIMARY KEY,
     articulo_id INT UNSIGNED NOT NULL,
     creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX (articulo_id),
     FOREIGN KEY (articulo_id) REFERENCES articulos(id) ON DELETE CASCADE
   ) ENGINE=InnoDB`,
  // Lista de compras: lo que falta por stock mínimo se calcula solo; esta tabla guarda lo anotado a mano.
  `CREATE TABLE IF NOT EXISTS lista_compras (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     texto VARCHAR(120) NOT NULL,
     comprado TINYINT(1) NOT NULL DEFAULT 0,
     usuario_id INT UNSIGNED NULL,
     creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
   ) ENGINE=InnoDB`,
  // Impuestos y servicios: cada obligación guarda su próximo vencimiento; al pagar se registra el pago y avanza sola.
  `CREATE TABLE IF NOT EXISTS obligaciones (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     nombre VARCHAR(80) NOT NULL,
     tipo VARCHAR(20) NOT NULL DEFAULT 'servicio',
     frecuencia_meses TINYINT UNSIGNED NOT NULL DEFAULT 1,
     dia TINYINT UNSIGNED NOT NULL,
     proximo_venc DATE NOT NULL,
     monto_estimado DECIMAL(12,2) NULL,
     nota VARCHAR(200) NULL,
     activo TINYINT(1) NOT NULL DEFAULT 1,
     gcal_event_id VARCHAR(100) NULL,
     creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS pagos_obligaciones (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     obligacion_id INT UNSIGNED NOT NULL,
     venc DATE NOT NULL,
     pagado DATE NOT NULL,
     monto DECIMAL(12,2) NOT NULL,
     usuario_id INT UNSIGNED NULL,
     creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX (obligacion_id), INDEX (pagado),
     FOREIGN KEY (obligacion_id) REFERENCES obligaciones(id) ON DELETE CASCADE,
     FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
   ) ENGINE=InnoDB`,
  // Gastos sueltos del hogar (los pagos de impuestos y servicios se suman solos desde pagos_obligaciones).
  `CREATE TABLE IF NOT EXISTS gastos (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     fecha DATE NOT NULL,
     concepto VARCHAR(100) NOT NULL,
     categoria VARCHAR(40) NOT NULL,
     monto DECIMAL(12,2) NOT NULL,
     usuario_id INT UNSIGNED NULL,
     activo TINYINT(1) NOT NULL DEFAULT 1,
     creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX (fecha),
     FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
   ) ENGINE=InnoDB`,
];

const CATS_GASTO = ['Supermercado', 'Alimentos', 'Limpieza y hogar', 'Farmacia', 'Transporte', 'Reparaciones', 'Ocio', 'Otros'];
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const FECHA =/^(\d{4})-(\d{2})-(\d{2})$/;
const diasDelMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
function fechaValida(s) {
  const m = FECHA.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= diasDelMes(y, mo);
}
// Suma meses a una fecha 'YYYY-MM-DD' y deja el día pedido (o el último del mes si no existe, ej. 31 en febrero).
function sumarMeses(fecha, meses, dia) {
  const [y, m] = fecha.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + meses;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  const nd = Math.min(dia, diasDelMes(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function pistaProducto(marcas, categorias) {
  return 'Es la foto de un producto de supermercado o del hogar. Devolvé en data exactamente estos campos: ' +
    'nombre (tipo de producto más variante, corto, máximo 5 palabras, SIN la marca y sin frases de marketing; ' +
    'ejemplos: "Leche descremada", "Yogur frutilla", "Aceitunas verdes"), ' +
    'marca (la marca comercial tal como figura en el envase; si no hay una marca clara usá null, ' +
    'nunca repitas el nombre del producto como marca), ' +
    'categoria (una categoría general en español, por ejemplo Lácteos, Almacén, Bebidas, Limpieza, ' +
    'Higiene personal, Carnes, Verdulería, Mascotas), ' +
    'presentacion (siempre número y unidad abreviada: g, kg, ml, L o un; ejemplos: 500 g, 1,5 L; null si no se lee), ' +
    'codigo_barras (solo los dígitos, y solo si se leen completos: 8 o 13 dígitos; si no, null). ' +
    (categorias.length ? `Categorías ya usadas (reutilizá la que corresponda): ${categorias.slice(0, 60).join(', ')}. ` : '') +
    (marcas.length ? `Marcas ya cargadas (si es una de estas, escribila igual): ${marcas.slice(0, 80).join(', ')}.` : '');
}

function pistaVarios(marcas, categorias) {
  return 'Es la foto de VARIOS productos de supermercado o del hogar sobre una mesada. ' +
    'Devolvé en data un objeto con la clave productos: un array con UN elemento por cada producto distinto que identifiques. ' +
    'Si hay varias unidades iguales, un solo elemento con su cantidad. Cada elemento lleva: ' +
    'nombre (tipo de producto más variante, corto, máximo 5 palabras, SIN la marca; ejemplos: "Leche descremada", "Yogur frutilla"), ' +
    'marca (tal como figura en el envase; null si no hay una clara, nunca repitas el nombre del producto), ' +
    'categoria (categoría general en español, por ejemplo Lácteos, Almacén, Bebidas, Limpieza, Higiene personal, Carnes, Verdulería, Mascotas), ' +
    'presentacion (número y unidad abreviada: g, kg, ml, L o un; null si no se lee), ' +
    'cantidad (número entero: cuántas unidades iguales ves). ' +
    'Si un producto no se lee con claridad, omitilo en lugar de inventarlo. No incluyas código de barras. Respondé compacto. ' +
    (categorias.length ? `Categorías ya usadas (reutilizá la que corresponda): ${categorias.slice(0, 60).join(', ')}. ` : '') +
    (marcas.length ? `Marcas ya cargadas (si es una de estas, escribila igual): ${marcas.slice(0, 80).join(', ')}.` : '');
}

const limpio = (s, max) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const orNull = (s) => (s ? s : null);

const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
// Clave para reconocer el mismo nombre: sin tildes, sin mayúsculas, sin "La/El/Los/Las" al principio.
const clave = (s) => sinTildes(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(la|el|los|las) /, '');

// "900g" -> "900 g", "1 Litro" -> "1 L", "950 mL" -> "950 ml". Si no se entiende, lo deja como vino.
function normalizarPresentacion(s) {
  const t = String(s || '').toLowerCase().replace(',', '.').trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(kilos?|kgs?|gramos?|grs?|g|litros?|lts?|lt|l|mililitros?|mls?|cc|cm3|unidades?|un|u)\.?$/);
  if (!m) return String(s || '').trim();
  const u = m[2];
  const unidad = u.startsWith('k') ? 'kg' : /^(g|gr)/.test(u) ? 'g' : /^(l$|lt|litro)/.test(u) ? 'L' : /^(ml|mili|cc|cm3)/.test(u) ? 'ml' : 'un';
  return `${m[1].replace('.', ',')} ${unidad}`;
}

// Dígito verificador EAN/UPC (8, 12, 13 o 14 dígitos).
function eanValido(c) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(c)) return false;
  const d = c.split('').map(Number);
  const chk = d.pop();
  const suma = d.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === chk;
}

// Clave de "cómo se lee" un producto: nombre|marca|presentación, sin tildes ni mayúsculas. '' si no hay nombre.
function claveLectura(x) {
  const n = clave(x.nombre || '');
  return n ? [n, clave(x.marca || ''), clave(x.presentacion || '')].join('|') : '';
}

const gcal = require('./feriados'); // sin Google Calendar: solo feriados (API pública ArgentinaDatos)

module.exports = function crearCasa({ pool, ia, leerJSON, enviar }) {
  async function iniciar() {
    for (const sql of TABLAS) await pool.query(sql);
  }

  async function listar() {
    const [articulos] = await pool.query(
      `SELECT a.id, a.nombre, m.nombre AS marca, c.nombre AS categoria, a.presentacion,
              a.codigo_barras, a.stock_actual, a.stock_minimo
       FROM articulos a
       LEFT JOIN cat_marcas m ON m.id = a.marca_id
       LEFT JOIN cat_categorias c ON c.id = a.categoria_id
       WHERE a.activo = 1 ORDER BY c.nombre, a.nombre`);
    const [marcas] = await pool.query('SELECT nombre FROM cat_marcas ORDER BY nombre');
    const [categorias] = await pool.query('SELECT nombre FROM cat_categorias ORDER BY nombre');
    return {
      articulos: articulos.map((a) => ({ ...a, stock_actual: Number(a.stock_actual), stock_minimo: Number(a.stock_minimo) })),
      marcas: marcas.map((x) => x.nombre),
      categorias: categorias.map((x) => x.nombre),
    };
  }

  // ---- lectura de fotos con la IA ----
  async function catalogosNombres() {
    const [mc, cc] = await Promise.all([pool.query('SELECT nombre FROM cat_marcas ORDER BY nombre'), pool.query('SELECT nombre FROM cat_categorias ORDER BY nombre')]);
    return [mc[0].map((x) => x.nombre), cc[0].map((x) => x.nombre)];
  }

  // Un producto leído por la IA -> campos limpios, con marca/categoría iguales a las ya cargadas.
  function normalizarProducto(f, marcas, categorias) {
    const canon = (lista, v) => (v && lista.find((x) => clave(x) === clave(v))) || v;
    let codigo = limpio(String(f.codigo_barras ?? ''), 30).replace(/\D/g, '');
    if (!eanValido(codigo)) codigo = ''; // la IA suele leer códigos incompletos: mejor vacío que equivocado
    return {
      nombre: limpio(f.nombre, 120),
      marca: canon(marcas, limpio(f.marca, 60)),
      categoria: canon(categorias, limpio(f.categoria, 60)),
      presentacion: normalizarPresentacion(limpio(String(f.presentacion ?? ''), 40)),
      codigo_barras: codigo,
    };
  }

  // Alias aprendidos: si esta lectura ya se corrigió antes, se usan los datos del artículo real.
  async function cargarAlias() {
    const [f] = await pool.query(
      `SELECT al.clave_lectura, a.id, a.nombre, m.nombre AS marca, c.nombre AS categoria, a.presentacion, a.codigo_barras
       FROM articulo_alias al
       JOIN articulos a ON a.id = al.articulo_id AND a.activo = 1
       LEFT JOIN cat_marcas m ON m.id = a.marca_id
       LEFT JOIN cat_categorias c ON c.id = a.categoria_id`);
    return new Map(f.map((x) => [x.clave_lectura, x]));
  }
  function aplicarAlias(p, mapa) {
    const a = mapa.get(claveLectura(p));
    if (!a) return p;
    return { ...p, nombre: a.nombre, marca: a.marca || '', categoria: a.categoria || p.categoria,
      presentacion: a.presentacion || '', codigo_barras: a.codigo_barras || p.codigo_barras, por_alias: true };
  }

  // Aprende: si el usuario terminó en un artículo con otro nombre que el leído, lo recuerda.
  async function guardarAlias(conn, articuloId, l) {
    if (!l || typeof l !== 'object') return;
    const k = claveLectura({ nombre: limpio(l.nombre, 120), marca: limpio(l.marca, 60), presentacion: normalizarPresentacion(limpio(String(l.presentacion ?? ''), 40)) });
    if (!k) return;
    const [todos] = await conn.query(
      `SELECT a.id, a.nombre, m.nombre AS marca, a.presentacion FROM articulos a
       LEFT JOIN cat_marcas m ON m.id = a.marca_id WHERE a.activo = 1`);
    const propio = todos.find((a) => a.id === articuloId);
    if (!propio || claveLectura(propio) === k) return;                  // ya se llama igual: no hace falta alias
    if (todos.some((a) => a.id !== articuloId && claveLectura(a) === k)) return; // es el nombre real de OTRO artículo
    await conn.query('INSERT INTO articulo_alias (clave_lectura, articulo_id) VALUES (?, ?) ON CONFLICT(clave_lectura) DO UPDATE SET articulo_id = excluded.articulo_id', [k, articuloId]);
  }

  async function llamarIA(d, pistaFn) {
    if (!/^image\/(jpeg|png|webp)$/.test(d.mime || '') || typeof d.imagen_base64 !== 'string') return { error: 'Imagen inválida' };
    const [marcas, categorias] = await catalogosNombres();
    const r = await ia.extraer({ modulo: 'casa', tipo: 'libre', mime: d.mime, imagenBase64: d.imagen_base64, pista: pistaFn(marcas, categorias) });
    if (r.success === false) return { error: r.data?.error || r.error || 'No se pudo identificar el producto' };
    return { r, marcas, categorias };
  }

  // Foto de UN producto -> { p } (propuesta normalizada) o { error }.
  async function leerProducto(d) {
    const x = await llamarIA(d, pistaProducto);
    if (x.error) return x;
    let p = { ...normalizarProducto(x.r.data?.fields || {}, x.marcas, x.categorias), confianza: x.r.data?.confidence || null, notas: limpio(x.r.data?.notes || '', 300) };
    p = aplicarAlias(p, await cargarAlias());
    return { p };
  }

  // Foto de VARIOS productos -> { items: [{ ...producto, cantidad }] } o { error }.
  async function leerVarios(d) {
    const x = await llamarIA(d, pistaVarios);
    if (x.error) return x;
    const campos = x.r.data?.fields;
    const lista = Array.isArray(campos) ? campos : (campos?.productos || campos?.products || []);
    if (!Array.isArray(lista) || !lista.length) return { error: 'No pude distinguir productos en esa foto. Probá acercándote o con menos productos.' };
    const alias = await cargarAlias();
    const juntos = new Map();
    for (const f of lista.slice(0, 40)) {
      if (!f || typeof f !== 'object') continue;
      const p = aplicarAlias(normalizarProducto(f, x.marcas, x.categorias), alias);
      if (!p.nombre) continue;
      const cant = Math.min(999, Math.max(1, Math.round(Number(f.cantidad)) || 1));
      const k = claveLectura(p);
      if (juntos.has(k)) juntos.get(k).cantidad += cant; else juntos.set(k, { ...p, cantidad: cant });
    }
    if (!juntos.size) return { error: 'No pude distinguir productos en esa foto.' };
    return { items: [...juntos.values()] };
  }

  async function identificarVarios(req, res) {
    const r = await leerVarios(await leerJSON(req, 15 * 1024 * 1024));
    if (r.error) return enviar(res, 200, { ok: false, error: r.error });
    enviar(res, 200, { ok: true, items: r.items });
  }

  // Foto -> propuesta de ALTA (nada se guarda hasta que el usuario confirma).
  async function identificar(req, res) {
    const r = await leerProducto(await leerJSON(req, 15 * 1024 * 1024));
    if (r.error) return enviar(res, 200, { ok: false, error: r.error });
    enviar(res, 200, { ok: true, propuesta: r.p });
  }

  async function activos() {
    const [a] = await pool.query(
      `SELECT a.id, a.nombre, m.nombre AS marca, a.presentacion, a.codigo_barras, a.stock_actual
       FROM articulos a LEFT JOIN cat_marcas m ON m.id = a.marca_id WHERE a.activo = 1`);
    return a.map((x) => ({ ...x, stock_actual: Number(x.stock_actual) }));
  }

  // ¿Qué artículo del stock es lo que muestra la foto? "exacto" solo si hay certeza.
  function buscarCoincidencia(p, arts) {
    const cn = clave(p.nombre || ''), cm = clave(p.marca || ''), cp = clave(p.presentacion || '');
    let exacto = p.codigo_barras ? arts.find((a) => a.codigo_barras === p.codigo_barras) || null : null;
    if (!exacto && cn) {
      const iguales = arts.filter((a) => clave(a.nombre) === cn && clave(a.marca || '') === cm);
      exacto = iguales.find((a) => clave(a.presentacion || '') === cp)
        || (iguales.length === 1 && (!cp || !iguales[0].presentacion) ? iguales[0] : null);
    }
    const palabras = new Set(cn.split(' ').filter((w) => w.length > 2));
    const puntaje = (a) => {
      let s = cm && clave(a.marca || '') === cm ? 2 : 0;
      for (const w of clave(a.nombre).split(' ')) if (palabras.has(w)) s += 1;
      return s;
    };
    const candidatos = arts.filter((a) => !exacto || a.id !== exacto.id)
      .map((a) => ({ a, s: puntaje(a) })).filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s).slice(0, 5).map((x) => x.a);
    return { exacto, candidatos };
  }

  // Foto -> qué artículo es (pantalla de BAJA). No descuenta nada: eso lo hace /casa/baja.
  async function bajaIdentificar(req, res) {
    const r = await leerProducto(await leerJSON(req, 15 * 1024 * 1024));
    if (r.error) return enviar(res, 200, { ok: false, error: r.error });
    const { exacto, candidatos } = buscarCoincidencia(r.p, await activos());
    enviar(res, 200, { ok: true, propuesta: r.p, exacto, candidatos });
  }

  const fallar = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

  async function baja(req, res, usuario) {
    const d = await leerJSON(req, 6000);
    const id = Number(d.id), cantidad = d.cantidad == null ? 1 : Number(d.cantidad);
    if (!Number.isInteger(id) || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query('SELECT nombre, stock_actual FROM articulos WHERE id = ? AND activo = 1 FOR UPDATE', [id]);
      if (!r[0]) throw fallar(404, 'Artículo inexistente');
      const antes = Number(r[0].stock_actual);
      if (antes <= 0) throw fallar(409, `No hay stock de «${r[0].nombre}» para dar de baja`);
      const nuevo = Math.max(0, antes - cantidad), real = antes - nuevo;
      await conn.query('UPDATE articulos SET stock_actual = ? WHERE id = ?', [nuevo, id]);
      await conn.query('INSERT INTO movimientos_stock (articulo_id, usuario_id, delta, motivo) VALUES (?, ?, ?, ?)', [id, usuario.id, -real, 'baja']);
      await guardarAlias(conn, id, d.lectura); // si la IA lo leyó distinto y el usuario eligió este artículo, lo aprende
      await conn.commit();
      enviar(res, 200, { ok: true, id, nombre: r[0].nombre, stock_actual: nuevo, descontado: real });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async function editar(req, res, usuario) {
    const d = await leerJSON(req, 10000);
    const id = Number(d.id), nombre = limpio(d.nombre, 120);
    const minimo = Number(d.stock_minimo ?? 0), stock = Number(d.stock_actual);
    if (!Number.isInteger(id) || !nombre) return enviar(res, 400, { ok: false, error: 'Falta el nombre' });
    for (const n of [minimo, stock]) if (!Number.isFinite(n) || n < 0 || n > 10000) return enviar(res, 400, { ok: false, error: 'Cantidad inválida' });
    const presentacion = orNull(normalizarPresentacion(limpio(d.presentacion, 40)));
    const codigo = orNull(limpio(String(d.codigo_barras ?? ''), 30).replace(/\D/g, ''));
    if (codigo && !eanValido(codigo)) return enviar(res, 400, { ok: false, error: 'El código de barras no es válido (revisalo o dejalo vacío)' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query('SELECT stock_actual FROM articulos WHERE id = ? AND activo = 1 FOR UPDATE', [id]);
      if (!r[0]) throw fallar(404, 'Artículo inexistente');
      if (codigo) {
        const [o] = await conn.query('SELECT id FROM articulos WHERE codigo_barras = ? AND activo = 1 AND id <> ? LIMIT 1', [codigo, id]);
        if (o[0]) throw fallar(409, 'Ese código de barras ya pertenece a otro artículo');
      }
      const marcaId = await idDe(conn, 'cat_marcas', limpio(d.marca, 60));
      const categoriaId = await idDe(conn, 'cat_categorias', limpio(d.categoria, 60));
      await conn.query(
        'UPDATE articulos SET nombre = ?, marca_id = ?, categoria_id = ?, presentacion = ?, codigo_barras = ?, stock_minimo = ?, stock_actual = ? WHERE id = ?',
        [nombre, marcaId, categoriaId, presentacion, codigo, minimo, stock, id]);
      const delta = stock - Number(r[0].stock_actual);
      if (delta !== 0) await conn.query('INSERT INTO movimientos_stock (articulo_id, usuario_id, delta, motivo) VALUES (?, ?, ?, ?)', [id, usuario.id, delta, 'correccion']);
      await conn.commit();
      enviar(res, 200, { ok: true });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  // Borrado lógico: el artículo deja de verse pero se conserva el historial de movimientos.
  async function eliminar(req, res) {
    const id = Number((await leerJSON(req, 1000)).id);
    if (!Number.isInteger(id)) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    const [r] = await pool.query('UPDATE articulos SET activo = 0 WHERE id = ? AND activo = 1', [id]);
    if (!r.affectedRows) return enviar(res, 404, { ok: false, error: 'Artículo inexistente' });
    enviar(res, 200, { ok: true });
  }

  // Busca por nombre "parecido" (sin tildes/mayúsculas/artículo) y recién si no hay, crea.
  async function idDe(conn, tabla, nombre) {
    if (!nombre) return null;
    const [todas] = await conn.query(`SELECT id, nombre FROM ${tabla}`);
    const igual = todas.find((x) => clave(x.nombre) === clave(nombre));
    if (igual) return igual.id;
    const [r] = await conn.query(`INSERT INTO ${tabla} (nombre) VALUES (?)`, [nombre]);
    return r.insertId;
  }

  // Alta (o suma si ya existe) con la confirmación del usuario.
  async function altaEn(conn, usuario, d) {
    const nombre = limpio(d.nombre, 120);
    const cantidad = Number(d.cantidad);
    if (!nombre) throw fallar(400, 'Falta el nombre');
    if (!Number.isFinite(cantidad) || cantidad < 0 || cantidad > 10000) throw fallar(400, 'Cantidad inválida');
    const marca = limpio(d.marca, 60), categoria = limpio(d.categoria, 60);
    const presentacion = orNull(normalizarPresentacion(limpio(d.presentacion, 40)));
    const codigo = orNull(limpio(String(d.codigo_barras ?? ''), 30).replace(/\D/g, ''));
    if (codigo && !eanValido(codigo)) throw fallar(400, 'El código de barras no es válido (revisalo o dejalo vacío)');
    {
      const marcaId = await idDe(conn, 'cat_marcas', marca);
      const categoriaId = await idDe(conn, 'cat_categorias', categoria);

      let id = null;
      if (codigo) {
        const [r] = await conn.query('SELECT id FROM articulos WHERE codigo_barras = ? AND activo = 1 LIMIT 1', [codigo]);
        id = r[0]?.id ?? null;
      }
      if (!id) {
        const [r] = await conn.query(
          'SELECT id FROM articulos WHERE nombre = ? AND marca_id <=> ? AND presentacion <=> ? AND activo = 1 LIMIT 1',
          [nombre, marcaId, presentacion]);
        id = r[0]?.id ?? null;
      }
      let creado = false;
      if (!id) {
        const [r] = await conn.query(
          'INSERT INTO articulos (nombre, marca_id, categoria_id, presentacion, codigo_barras) VALUES (?, ?, ?, ?, ?)',
          [nombre, marcaId, categoriaId, presentacion, codigo]);
        id = r.insertId; creado = true;
      }
      if (cantidad > 0) {
        await conn.query('UPDATE articulos SET stock_actual = stock_actual + ? WHERE id = ?', [cantidad, id]);
        await conn.query('INSERT INTO movimientos_stock (articulo_id, usuario_id, delta, motivo) VALUES (?, ?, ?, ?)', [id, usuario.id, cantidad, 'alta']);
      }
      await guardarAlias(conn, id, d.lectura);
      return { id, creado };
    }
  }

  // Alta (o suma si ya existe) con la confirmación del usuario.
  async function guardar(req, res, usuario) {
    const d = await leerJSON(req, 20000);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await altaEn(conn, usuario, d);
      await conn.commit();
      enviar(res, 200, { ok: true, ...r });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  // Varias altas de una sola vez (foto de la compra): todo o nada.
  async function guardarVarios(req, res, usuario) {
    const d = await leerJSON(req, 400000);
    if (!Array.isArray(d.items) || !d.items.length || d.items.length > 60) return enviar(res, 400, { ok: false, error: 'Lista inválida' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let creados = 0, sumados = 0;
      for (const it of d.items) {
        try {
          const r = await altaEn(conn, usuario, it || {});
          if (r.creado) creados++; else sumados++;
        } catch (e) {
          if (e.codigo) e.message = `«${limpio(String(it?.nombre ?? ''), 60) || 'sin nombre'}»: ${e.message}`;
          throw e;
        }
      }
      await conn.commit();
      enviar(res, 200, { ok: true, creados, sumados });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async function ajustar(req, res, usuario) {
    const d = await leerJSON(req, 2000);
    const id = Number(d.id), delta = Number(d.delta);
    if (!Number.isInteger(id) || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000) {
      return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query('SELECT stock_actual FROM articulos WHERE id = ? AND activo = 1 FOR UPDATE', [id]);
      if (!r[0]) { await conn.rollback(); return enviar(res, 404, { ok: false, error: 'Artículo inexistente' }); }
      const nuevo = Math.max(0, Number(r[0].stock_actual) + delta);
      const real = nuevo - Number(r[0].stock_actual);
      await conn.query('UPDATE articulos SET stock_actual = ? WHERE id = ?', [nuevo, id]);
      if (real !== 0) await conn.query('INSERT INTO movimientos_stock (articulo_id, usuario_id, delta, motivo) VALUES (?, ?, ?, ?)', [id, usuario.id, real, real > 0 ? 'ajuste+' : 'consumo']);
      await conn.commit();
      enviar(res, 200, { ok: true, stock_actual: nuevo });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  // ---- lista de compras ----
  async function verLista() {
    const [sug] = await pool.query(
      `SELECT a.id, a.nombre, m.nombre AS marca, c.nombre AS categoria, a.presentacion, a.stock_actual, a.stock_minimo
       FROM articulos a
       LEFT JOIN cat_marcas m ON m.id = a.marca_id
       LEFT JOIN cat_categorias c ON c.id = a.categoria_id
       WHERE a.activo = 1 AND a.stock_minimo > 0 AND a.stock_actual <= a.stock_minimo
       ORDER BY c.nombre, a.nombre`);
    const [man] = await pool.query('SELECT id, texto, comprado FROM lista_compras ORDER BY comprado, id DESC LIMIT 300');
    return {
      sugeridos: sug.map((a) => {
        const actual = Number(a.stock_actual), minimo = Number(a.stock_minimo);
        return { ...a, stock_actual: actual, stock_minimo: minimo, falta: Math.max(minimo - actual, 1) };
      }),
      manuales: man.map((x) => ({ id: x.id, texto: x.texto, comprado: !!x.comprado })),
    };
  }

  async function listaAgregar(req, res, usuario) {
    const d = await leerJSON(req, 2000);
    const texto = limpio(d.texto, 120);
    if (!texto) return enviar(res, 400, { ok: false, error: 'Escribí qué hay que comprar' });
    const [dup] = await pool.query('SELECT id FROM lista_compras WHERE comprado = 0 AND LOWER(texto) = LOWER(?) LIMIT 1', [texto]);
    if (dup[0]) return enviar(res, 200, { ok: true, repetido: true });
    await pool.query('INSERT INTO lista_compras (texto, usuario_id) VALUES (?, ?)', [texto, usuario.id]);
    enviar(res, 200, { ok: true });
  }

  async function listaTildar(req, res) {
    const d = await leerJSON(req, 2000);
    const id = Number(d.id);
    if (!Number.isInteger(id)) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    await pool.query('UPDATE lista_compras SET comprado = ? WHERE id = ?', [d.comprado ? 1 : 0, id]);
    enviar(res, 200, { ok: true });
  }

  async function listaBorrar(req, res) {
    const d = await leerJSON(req, 2000);
    if (d.comprados === true) { await pool.query('DELETE FROM lista_compras WHERE comprado = 1'); return enviar(res, 200, { ok: true }); }
    const id = Number(d.id);
    if (!Number.isInteger(id)) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    await pool.query('DELETE FROM lista_compras WHERE id = ?', [id]);
    enviar(res, 200, { ok: true });
  }

  // ---- impuestos y servicios ----
  const TIPOS = ['impuesto', 'servicio', 'otro'];
  const FRECUENCIAS = [1, 2, 3, 6, 12];

  async function verObligaciones() {
    const [filas] = await pool.query(
      `SELECT id, nombre, tipo, frecuencia_meses, dia, DATE_FORMAT(proximo_venc, '%Y-%m-%d') AS proximo_venc,
              DATEDIFF(proximo_venc, CURDATE()) AS dias, monto_estimado, nota
       FROM obligaciones WHERE activo = 1 ORDER BY proximo_venc, nombre`);
    const [pagos] = await pool.query(
      `SELECT p.id, o.nombre, DATE_FORMAT(p.pagado, '%Y-%m-%d') AS pagado, p.monto
       FROM pagos_obligaciones p JOIN obligaciones o ON o.id = p.obligacion_id
       ORDER BY p.pagado DESC, p.id DESC LIMIT 15`);
    return {
      obligaciones: filas.map((o) => ({ ...o, dias: Number(o.dias), monto_estimado: o.monto_estimado === null ? null : Number(o.monto_estimado) })),
      pagos: pagos.map((p) => ({ ...p, monto: Number(p.monto) })),
    };
  }

  // Foto de una factura/boleta -> propuesta para el formulario. No se guarda nada hasta que el usuario confirma.
  function pistaFactura() {
    const t = new Date();
    const hoy = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    return 'Es la foto de una factura, boleta o impuesto del hogar en Argentina. Hoy es ' + hoy + '. Devolvé en data estos campos: ' +
      'nombre (el servicio o impuesto, corto, ejemplos: "Luz", "Gas", "Agua", "Internet", "Municipal", "Patente", "Expensas"; si hace falta sumá la empresa, ej. "Luz Edenor"), ' +
      'tipo (exactamente una de: impuesto, servicio, otro), ' +
      'vencimiento (fecha del PRIMER vencimiento a pagar, formato AAAA-MM-DD; null si no se lee), ' +
      'monto (total a pagar como número con punto decimal, sin símbolo ni separador de miles; null si no se lee), ' +
      'frecuencia_meses (cada cuántos meses llega: 1 si es mensual, 2 si es bimestral, 3, 6 o 12; si no se puede saber usá 1). ' +
      'NO devuelvas nombre del titular, domicilio, número de cliente, de cuenta ni de medidor. Respondé compacto.';
  }

  async function identificarObligacion(req, res) {
    const d = await leerJSON(req, 15 * 1024 * 1024);
    const x = await llamarIA(d, pistaFactura);
    if (x.error) return enviar(res, 200, { ok: false, error: x.error });
    const f = x.r.data?.fields || {};
    const nombre = limpio(f.nombre, 80);
    if (!nombre) return enviar(res, 200, { ok: false, error: 'No pude leer qué factura es. Probá con una foto más cerca y derecha.' });
    const venc = String(f.vencimiento || '').trim();
    const monto = Number(String(f.monto ?? '').replace(',', '.'));
    const frec = Number(f.frecuencia_meses);
    const propuesta = {
      nombre,
      tipo: TIPOS.includes(f.tipo) ? f.tipo : 'servicio',
      frecuencia_meses: FRECUENCIAS.includes(frec) ? frec : 1,
      proximo_venc: fechaValida(venc) ? venc : '',
      monto_estimado: f.monto != null && Number.isFinite(monto) && monto >= 0 && monto < 1e9 ? monto : null,
    };
    // Si ya existe un vencimiento con ese nombre, se propone actualizarlo en lugar de duplicarlo.
    const [todas] = await pool.query('SELECT id, nombre FROM obligaciones WHERE activo = 1');
    const igual = todas.find((o) => clave(o.nombre) === clave(nombre));
    enviar(res, 200, { ok: true, propuesta, existente_id: igual ? igual.id : null });
  }

  async function guardarObligacion(req, res) {
    const d = await leerJSON(req, 4000);
    const nombre = limpio(d.nombre, 80);
    const tipo = TIPOS.includes(d.tipo) ? d.tipo : 'servicio';
    const frecuencia = Number(d.frecuencia_meses);
    const venc = String(d.proximo_venc || '');
    const nota = orNull(limpio(d.nota, 200));
    const monto = d.monto_estimado === '' || d.monto_estimado == null ? null : Number(d.monto_estimado);
    if (!nombre) return enviar(res, 400, { ok: false, error: 'Falta el nombre' });
    if (!FRECUENCIAS.includes(frecuencia)) return enviar(res, 400, { ok: false, error: 'Frecuencia inválida' });
    if (!fechaValida(venc)) return enviar(res, 400, { ok: false, error: 'La fecha de vencimiento no es válida' });
    if (monto !== null && (!Number.isFinite(monto) || monto < 0 || monto > 1e9)) return enviar(res, 400, { ok: false, error: 'Monto inválido' });
    const dia = Number(venc.slice(8, 10));
    if (d.id != null) {
      const id = Number(d.id);
      if (!Number.isInteger(id)) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
      const [r] = await pool.query(
        'UPDATE obligaciones SET nombre = ?, tipo = ?, frecuencia_meses = ?, dia = ?, proximo_venc = ?, monto_estimado = ?, nota = ? WHERE id = ? AND activo = 1',
        [nombre, tipo, frecuencia, dia, venc, monto, nota, id]);
      if (!r.affectedRows) {
        const [e] = await pool.query('SELECT 1 FROM obligaciones WHERE id = ? AND activo = 1', [id]);
        if (!e[0]) return enviar(res, 404, { ok: false, error: 'No existe' });
      }
      await gcalSync(id);
    } else {
      const [ins] = await pool.query(
        'INSERT INTO obligaciones (nombre, tipo, frecuencia_meses, dia, proximo_venc, monto_estimado, nota) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [nombre, tipo, frecuencia, dia, venc, monto, nota]);
      await gcalSync(ins.insertId);
    }
    enviar(res, 200, { ok: true });
  }

  // Refleja una obligación en Google Calendar (un evento con el próximo vencimiento). Nunca rompe la operación:
  // si Google falla, se registra en el log y devuelve el mensaje; "Sincronizar" en la pantalla lo reintenta.
  async function gcalSync(id) {
    if (!gcal.activo()) return null;
    try {
      const [r] = await pool.query(
        "SELECT nombre, nota, activo, DATE_FORMAT(proximo_venc, '%Y-%m-%d') AS venc, gcal_event_id FROM obligaciones WHERE id = ?", [id]);
      const o = r[0];
      if (!o) return null;
      if (!o.activo) {
        if (o.gcal_event_id) { await gcal.borrar(o.gcal_event_id); await pool.query('UPDATE obligaciones SET gcal_event_id = NULL WHERE id = ?', [id]); }
        return null;
      }
      const evId = await gcal.guardar(o.gcal_event_id, o);
      if (evId !== o.gcal_event_id) await pool.query('UPDATE obligaciones SET gcal_event_id = ? WHERE id = ?', [evId, id]);
      return null;
    } catch (e) {
      console.error('Google Calendar:', e.message);
      return e.message;
    }
  }

  async function gcalSincronizarTodo(res) {
    if (!gcal.activo()) return enviar(res, 200, { ok: false, error: 'Google Calendar no está activado en el servidor' });
    const [filas] = await pool.query('SELECT id FROM obligaciones WHERE activo = 1');
    let bien = 0, error = null;
    for (const f of filas) { const e = await gcalSync(f.id); if (e) error = error || e; else bien++; }
    enviar(res, 200, { ok: !error, sincronizados: bien, error });
  }

  async function pagarObligacion(req, res, usuario) {
    const d = await leerJSON(req, 2000);
    const id = Number(d.id), monto = Number(d.monto);
    if (!Number.isInteger(id) || !Number.isFinite(monto) || monto < 0 || monto > 1e9) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        `SELECT frecuencia_meses, dia, DATE_FORMAT(proximo_venc, '%Y-%m-%d') AS venc, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy
         FROM obligaciones WHERE id = ? AND activo = 1 FOR UPDATE`, [id]);
      if (!r[0]) { await conn.rollback(); return enviar(res, 404, { ok: false, error: 'No existe' }); }
      const pagado = fechaValida(d.fecha) ? d.fecha : r[0].hoy;
      // El nuevo vencimiento es el siguiente al que se pagó (aunque se pague tarde o adelantado).
      const siguiente = sumarMeses(r[0].venc, r[0].frecuencia_meses, r[0].dia);
      await conn.query('INSERT INTO pagos_obligaciones (obligacion_id, venc, pagado, monto, usuario_id) VALUES (?, ?, ?, ?, ?)', [id, r[0].venc, pagado, monto, usuario.id]);
      await conn.query('UPDATE obligaciones SET proximo_venc = ? WHERE id = ?', [siguiente, id]);
      await conn.commit();
      await gcalSync(id);
      enviar(res, 200, { ok: true, proximo_venc: siguiente });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async function eliminarObligacion(req, res) {
    const id = Number((await leerJSON(req, 1000)).id);
    if (!Number.isInteger(id)) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    const [r] = await pool.query('UPDATE obligaciones SET activo = 0 WHERE id = ? AND activo = 1', [id]);
    if (!r.affectedRows) return enviar(res, 404, { ok: false, error: 'No existe' });
    await gcalSync(id);
    enviar(res, 200, { ok: true });
  }

  // Resumen para Home Assistant: vencimientos y lista de compras, en una sola respuesta chica.
  async function resumenHA() {
    const { obligaciones } = await verObligaciones();
    const { sugeridos, manuales } = await verLista();
    const items = obligaciones.filter((o) => o.dias <= 7).map((o) => ({
      nombre: o.nombre, fecha: o.proximo_venc, dias: o.dias, monto_estimado: o.monto_estimado,
      estado: o.dias < 0 ? 'vencido' : o.dias === 0 ? 'hoy' : 'proximo',
    }));
    return {
      vencidos: items.filter((i) => i.dias < 0).length,
      hoy: items.filter((i) => i.dias === 0).length,
      proximos_3: items.filter((i) => i.dias >= 0 && i.dias <= 3).length, // incluye los de hoy
      proximos_7: items.filter((i) => i.dias >= 0).length,
      items,
      compras_faltan: sugeridos.length,
      compras_anotadas: manuales.filter((x) => !x.comprado).length,
    };
  }

  // ---- gastos del hogar ----
  const ETIQUETA_TIPO = { impuesto: 'Impuestos', servicio: 'Servicios', otro: 'Otros servicios' };

  async function verGastos(mes) {
    if (!MES.test(mes)) {
      const [h] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m') AS m");
      mes = h[0].m;
    }
    const [sueltos] = await pool.query(
      `SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, concepto, categoria, monto FROM gastos
       WHERE activo = 1 AND DATE_FORMAT(fecha, '%Y-%m') = ? ORDER BY fecha DESC, id DESC`, [mes]);
    const [pagos] = await pool.query(
      `SELECT p.id, DATE_FORMAT(p.pagado, '%Y-%m-%d') AS fecha, o.nombre AS concepto, o.tipo, p.monto
       FROM pagos_obligaciones p JOIN obligaciones o ON o.id = p.obligacion_id
       WHERE DATE_FORMAT(p.pagado, '%Y-%m') = ? ORDER BY p.pagado DESC, p.id DESC`, [mes]);
    const items = [
      ...sueltos.map((g) => ({ origen: 'gasto', id: g.id, fecha: g.fecha, concepto: g.concepto, categoria: g.categoria, monto: Number(g.monto) })),
      ...pagos.map((p) => ({ origen: 'pago', id: p.id, fecha: p.fecha, concepto: p.concepto, categoria: ETIQUETA_TIPO[p.tipo] || 'Otros servicios', monto: Number(p.monto) })),
    ].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    const porCat = new Map();
    for (const i of items) porCat.set(i.categoria, (porCat.get(i.categoria) || 0) + i.monto);
    const porCategoria = [...porCat.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total);
    // Totales de los últimos 6 meses (incluye el pedido) para comparar.
    const [hist] = await pool.query(
      `SELECT mes, SUM(total) AS total FROM (
         SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, SUM(monto) AS total FROM gastos WHERE activo = 1 GROUP BY mes
         UNION ALL
         SELECT DATE_FORMAT(pagado, '%Y-%m') AS mes, SUM(monto) AS total FROM pagos_obligaciones GROUP BY mes
       ) t WHERE mes <= ? GROUP BY mes ORDER BY mes DESC LIMIT 6`, [mes]);
    return {
      mes,
      total: items.reduce((s, i) => s + i.monto, 0),
      por_categoria: porCategoria,
      items,
      historial: hist.map((h) => ({ mes: h.mes, total: Number(h.total) })).reverse(),
      categorias: CATS_GASTO,
    };
  }

  function validarGasto(d) {
    const concepto = limpio(d.concepto, 100), monto = Number(d.monto), fecha = String(d.fecha || '');
    const categoria = CATS_GASTO.includes(d.categoria) ? d.categoria : 'Otros';
    if (!concepto) return { error: 'Falta el concepto' };
    if (!Number.isFinite(monto) || monto <= 0 || monto > 1e9) return { error: 'El monto no es válido' };
    if (!fechaValida(fecha)) return { error: 'La fecha no es válida' };
    return { concepto, monto, fecha, categoria };
  }

  async function guardarGasto(req, res, usuario) {
    const d = await leerJSON(req, 4000);
    const v = validarGasto(d);
    if (v.error) return enviar(res, 400, { ok: false, error: v.error });
    if (d.id != null) {
      const id = Number(d.id);
      if (!Number.isInteger(id)) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
      const [e] = await pool.query('SELECT 1 FROM gastos WHERE id = ? AND activo = 1', [id]);
      if (!e[0]) return enviar(res, 404, { ok: false, error: 'No existe' });
      await pool.query('UPDATE gastos SET fecha = ?, concepto = ?, categoria = ?, monto = ? WHERE id = ?', [v.fecha, v.concepto, v.categoria, v.monto, id]);
    } else {
      await pool.query('INSERT INTO gastos (fecha, concepto, categoria, monto, usuario_id) VALUES (?, ?, ?, ?, ?)', [v.fecha, v.concepto, v.categoria, v.monto, usuario.id]);
    }
    enviar(res, 200, { ok: true });
  }

  async function eliminarGasto(req, res) {
    const id = Number((await leerJSON(req, 1000)).id);
    if (!Number.isInteger(id)) return enviar(res, 400, { ok: false, error: 'Datos inválidos' });
    const [r] = await pool.query('UPDATE gastos SET activo = 0 WHERE id = ? AND activo = 1', [id]);
    if (!r.affectedRows) return enviar(res, 404, { ok: false, error: 'No existe' });
    enviar(res, 200, { ok: true });
  }

  function pistaTicket() {
    const t = new Date();
    const hoy = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    return 'Es la foto de un ticket o comprobante de compra en Argentina. Hoy es ' + hoy + '. Devolvé en data estos campos: ' +
      'concepto (el comercio o qué se compró, corto, máximo 5 palabras), ' +
      'fecha (formato AAAA-MM-DD; null si no se lee), ' +
      'monto (el TOTAL pagado como número con punto decimal, sin símbolo ni separador de miles; null si no se lee), ' +
      `categoria (exactamente una de: ${CATS_GASTO.join(', ')}). ` +
      'NO devuelvas datos personales, número de tarjeta ni CUIT. Respondé compacto.';
  }

  async function identificarGasto(req, res) {
    const x = await llamarIA(await leerJSON(req, 15 * 1024 * 1024), pistaTicket);
    if (x.error) return enviar(res, 200, { ok: false, error: x.error });
    const f = x.r.data?.fields || {};
    const monto = Number(String(f.monto ?? '').replace(',', '.'));
    const concepto = limpio(f.concepto, 100);
    if (!concepto && !(monto > 0)) return enviar(res, 200, { ok: false, error: 'No pude leer el ticket. Probá con una foto más cerca y derecha.' });
    enviar(res, 200, { ok: true, propuesta: {
      concepto,
      fecha: fechaValida(String(f.fecha || '')) ? f.fecha : '',
      monto: f.monto != null && Number.isFinite(monto) && monto > 0 && monto < 1e9 ? monto : null,
      categoria: CATS_GASTO.includes(f.categoria) ? f.categoria : 'Otros',
    } });
  }

  // Devuelve true si la ruta era de Casa.
  async function manejar(req, res, usuario, ruta) {
    if (req.method === 'GET' && ruta === '/api/casa/articulos') { enviar(res, 200, { ok: true, ...(await listar()) }); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/identificar') { await identificar(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/guardar') { await guardar(req, res, usuario); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/identificar-varios') { await identificarVarios(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/guardar-varios') { await guardarVarios(req, res, usuario); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/ajustar') { await ajustar(req, res, usuario); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/editar') { await editar(req, res, usuario); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/eliminar') { await eliminar(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/baja/identificar') { await bajaIdentificar(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/baja') { await baja(req, res, usuario); return true; }
    if (req.method === 'GET' && ruta === '/api/casa/lista') { enviar(res, 200, { ok: true, ...(await verLista()) }); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/lista/agregar') { await listaAgregar(req, res, usuario); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/lista/tildar') { await listaTildar(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/lista/borrar') { await listaBorrar(req, res); return true; }
    if (req.method === 'GET' && ruta === '/api/casa/obligaciones') { enviar(res, 200, { ok: true, ...(await verObligaciones()) }); return true; }
    if (req.method === 'GET' && ruta === '/api/casa/gastos') { enviar(res, 200, { ok: true, ...(await verGastos(new URL(req.url, 'http://x').searchParams.get('mes') || '')) }); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/gastos/guardar') { await guardarGasto(req, res, usuario); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/gastos/eliminar') { await eliminarGasto(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/gastos/identificar') { await identificarGasto(req, res); return true; }
    if (req.method === 'GET' && ruta === '/api/casa/feriados') {
      const anio = Number(new URL(req.url, 'http://x').searchParams.get('anio'));
      if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) { enviar(res, 400, { ok: false, error: 'Año inválido' }); return true; }
      enviar(res, 200, { ok: true, feriados: await gcal.feriados(anio) }); return true;
    }
    if (req.method === 'GET' && ruta === '/api/casa/gcal/estado') { enviar(res, 200, { ok: true, activo: gcal.activo() }); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/gcal/sincronizar') { await gcalSincronizarTodo(res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/obligaciones/identificar') { await identificarObligacion(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/obligaciones/guardar') { await guardarObligacion(req, res); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/obligaciones/pagar') { await pagarObligacion(req, res, usuario); return true; }
    if (req.method === 'POST' && ruta === '/api/casa/obligaciones/eliminar') { await eliminarObligacion(req, res); return true; }
    return false;
  }

  return { iniciar, manejar, resumenHA };
};
module.exports._util = { sumarMeses, fechaValida };
