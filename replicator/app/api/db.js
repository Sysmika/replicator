'use strict';
// Base de datos SQLite (node:sqlite, incluido en Node 22) con la misma forma que el pool de mysql2 que usa madoval:
//   const [filas] = await pool.query(sql, params)        -> SELECT
//   const [r] = await pool.query(sql, params)            -> r.insertId, r.affectedRows
//   const conn = await pool.getConnection(); conn.beginTransaction() / commit() / rollback() / release()
// Así casa.js y avisos.js quedan casi iguales a madoval. Las pocas funciones propias de MySQL que usan
// se traducen a SQLite en traducir().
const { DatabaseSync } = require('node:sqlite');

// ---- MySQL -> SQLite ----
function traducir(sql) {
  let s = sql;
  s = s.replace(/\s+ENGINE\s*=\s*InnoDB/gi, '');
  s = s.replace(/\b(?:BIG)?INT(?:\s+UNSIGNED)?\s+AUTO_INCREMENT\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  // DATE_FORMAT(x, '%Y-%m-%d') -> strftime('%Y-%m-%d', x)
  s = s.replace(/DATE_FORMAT\(\s*([\w.]+(?:\(\))?)\s*,\s*'([^']*)'\s*\)/gi, "strftime('$2', $1)");
  // DATEDIFF(a, b) -> días enteros entre fechas
  s = s.replace(/DATEDIFF\(\s*([\w.]+(?:\(\))?)\s*,\s*([\w.]+(?:\(\))?)\s*\)/gi, 'CAST(julianday($1) - julianday($2) AS INTEGER)');
  s = s.replace(/\bCURDATE\(\)/gi, "date('now','localtime')");
  s = s.replace(/\bNOW\(\)/gi, "datetime('now','localtime')");
  s = s.replace(/\bINSERT\s+IGNORE\b/gi, 'INSERT OR IGNORE');
  s = s.replace(/\s+FOR\s+UPDATE\b/gi, '');
  s = s.replace(/<=>/g, ' IS ');
  return s;
}

// CREATE TABLE con INDEX (col) adentro (MySQL) -> la tabla sin esos índices + un CREATE INDEX por cada uno.
function separarIndices(sql) {
  const m = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(sql);
  if (!m) return [sql];
  const tabla = m[1];
  const indices = [];
  const limpio = sql.replace(/,?\s*INDEX\s*\(\s*(\w+)\s*\)/gi, (_, col) => { indices.push(col); return ''; });
  return [limpio, ...indices.map((c) => `CREATE INDEX IF NOT EXISTS ix_${tabla}_${c} ON ${tabla}(${c})`)];
}

const valor = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v);
const devuelveFilas = (sql) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

function abrir(archivo) {
  const db = new DatabaseSync(archivo);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const cache = new Map();

  function ejecutar(sql, params = []) {
    const partes = /^\s*CREATE\s+TABLE/i.test(sql) ? separarIndices(traducir(sql)) : [traducir(sql)];
    let salida;
    for (const p of partes) {
      let st = cache.get(p);
      if (!st) { st = db.prepare(p); if (cache.size < 500) cache.set(p, st); }
      const args = partes.length > 1 ? [] : params.map(valor);
      if (devuelveFilas(p)) salida = [st.all(...args)];
      else { const r = st.run(...args); salida = [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }]; }
    }
    return salida;
  }

  // Una sola conexión: las transacciones se hacen de a una (cola). Mientras hay una abierta, las consultas
  // sueltas esperan, así no quedan mezcladas dentro de una transacción ajena.
  let cola = Promise.resolve();
  let enTransaccion = false;

  const pool = {
    async query(sql, params) {
      while (enTransaccion) await cola;
      return ejecutar(sql, params);
    },
    async getConnection() {
      let liberar;
      const anterior = cola;
      cola = new Promise((ok) => { liberar = ok; });
      await anterior;
      enTransaccion = true;
      let suelta = false;
      return {
        query: async (sql, params) => ejecutar(sql, params),
        beginTransaction: async () => { db.exec('BEGIN IMMEDIATE'); },
        commit: async () => { db.exec('COMMIT'); },
        rollback: async () => { if (db.isTransaction) db.exec('ROLLBACK'); },
        release: () => {
          if (suelta) return;
          suelta = true;
          if (db.isTransaction) db.exec('ROLLBACK');
          enTransaccion = false;
          liberar();
        },
      };
    },
    cerrar: () => db.close(),
  };
  return pool;
}

module.exports = { abrir, _traducir: traducir, _separarIndices: separarIndices };
