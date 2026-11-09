'use strict';
// Casa → Impuestos y servicios. Cada uno guarda su próximo vencimiento; al pagar se registra y pasa al siguiente período.
const Impuestos = (() => {
  const el = UI.el;
  const TIPOS = { impuesto: 'Impuesto', servicio: 'Servicio', otro: 'Otro' };
  const FREC = { 1: 'Todos los meses', 2: 'Cada 2 meses', 3: 'Cada 3 meses', 6: 'Cada 6 meses', 12: 'Una vez al año' };
  const peso = (n) => '$ ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const fechaCorta = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + (iso.slice(0, 4) === String(new Date().getFullYear()) ? '' : '/' + iso.slice(0, 4));
  const cuando = (d) => (d < 0 ? `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'Vence hoy' : d === 1 ? 'Vence mañana' : `Vence en ${d} días`);
  const hoyISO = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

  // Resumen para el inicio: cuántos están vencidos o vencen en los próximos 3 días.
  async function pendientes() {
    const r = await Api.get('/casa/obligaciones');
    if (!r.ok) return null;
    const vencidos = r.obligaciones.filter((o) => o.dias < 0).length;
    const prontos = r.obligaciones.filter((o) => o.dias >= 0 && o.dias <= 3).length;
    return { vencidos, prontos };
  }

  // inicio = 'calendario' abre directo la vista de calendario (desde el menú de Casa); "Volver" sale al inicio.
  function abrir(montar, volver, inicio = null) {
    const st = { obligaciones: [], pagos: [], msg: '', gcal: false, fer: {}, calMes: null, inicio, desdeMenu: inicio === 'calendario' };

    async function cargar(mensaje = '') {
      const [r, g] = await Promise.all([Api.get('/casa/obligaciones'), Api.get('/casa/gcal/estado')]);
      st.gcal = !!(g.ok && g.activo);
      if (r.ok) { st.obligaciones = r.obligaciones; st.pagos = r.pagos; st.msg = mensaje; }
      else st.msg = r.offline ? 'Sin conexión: no se pueden ver los vencimientos.' : (r.error || 'No se pudo cargar');
      if (st.inicio === 'calendario') { st.inicio = null; return calendario(); }
      lista();
    }

    // El botón vive en la vista de calendario; el resultado se muestra ahí mismo.
    async function sincronizar() {
      calendario(st.calMes, st.calDia, 'Sincronizando con Google Calendar…');
      const r = await Api.post('/casa/gcal/sincronizar', {});
      calendario(st.calMes, st.calDia, r.ok ? `Google Calendar al día (${r.sincronizados} ${r.sincronizados === 1 ? 'evento' : 'eventos'}).`
        : 'No se pudo sincronizar: ' + (r.error || 'error desconocido'));
    }

    const cabecera = (titulo, atras) => el('header', { class: 'top' },
      el('button', { class: 'link', onclick: atras, 'aria-label': 'Volver' }, '← Volver'),
      el('h1', {}, titulo));

    // ---------- lista ----------
    async function escanear(f) {
      montar(cabecera('Impuestos y servicios', lista), el('main', { class: 'contenido' }, el('p', { class: 'nota', role: 'status' }, 'Leyendo la factura…')));
      let r;
      try {
        const img = await Ia.prepararImagen(f);
        r = await Api.post('/casa/obligaciones/identificar', { mime: img.mime, imagen_base64: img.base64 });
      } catch (e) { r = { ok: false, error: 'No se pudo preparar la imagen' }; }
      if (!r.ok) { st.msg = r.offline ? 'Sin conexión.' : (r.error || 'No se pudo leer la factura'); lista(); return; }
      const ex = r.existente_id ? st.obligaciones.find((o) => o.id === r.existente_id) : null;
      const p = r.propuesta;
      if (ex) {
        // Ya existe: se actualiza el vencimiento y el monto con lo que dice la factura nueva.
        formulario({ ...ex, proximo_venc: p.proximo_venc || ex.proximo_venc, monto_estimado: p.monto_estimado ?? ex.monto_estimado },
          `Ya tenías "${ex.nombre}": completé el vencimiento y el monto con esta factura. Revisalos y guardá.`);
      } else {
        formulario(p, 'Revisá lo que leí de la factura antes de guardar.' + (p.proximo_venc ? '' : ' No pude leer el vencimiento: completalo.'));
      }
    }

    function lista() {
      const archivo = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto',
        onchange: (e) => { const f = e.target.files[0]; if (f) escanear(f); } });
      const tarjeta = (o) => {
        const clase = o.dias < 0 ? ' vencido' : o.dias <= 3 ? ' pronto-venc' : '';
        const monto = el('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: o.monto_estimado ?? '', placeholder: 'Monto pagado', 'aria-label': 'Monto pagado de ' + o.nombre });
        const err = el('p', { class: 'error', role: 'alert' });
        const panel = el('div', { class: 'pagar', hidden: '' },
          el('div', { class: 'barra' }, monto,
            el('button', { class: 'btn', type: 'button', onclick: async () => {
              if (monto.value === '' || Number(monto.value) < 0) { err.textContent = 'Poné cuánto pagaste'; return; }
              const r = await Api.post('/casa/obligaciones/pagar', { id: o.id, monto: Number(monto.value), fecha: hoyISO() });
              if (r.ok) cargar(`Registrado: ${o.nombre}. Próximo vencimiento ${fechaCorta(r.proximo_venc)}.`);
              else err.textContent = r.error || 'No se pudo registrar';
            } }, 'Confirmar pago')),
          err);
        return el('li', { class: 'card venc' + clase },
          el('div', { class: 'item' },
            el('button', { class: 'grow info', onclick: () => formulario(o), 'aria-label': 'Editar ' + o.nombre },
              el('strong', {}, o.nombre),
              el('span', { class: 'sub' }, `${TIPOS[o.tipo] || 'Otro'} · ${FREC[o.frecuencia_meses] || ''}`),
              el('span', { class: 'sub cuando' }, `${cuando(o.dias)} (${fechaCorta(o.proximo_venc)})` + (o.monto_estimado != null ? ` · ${peso(o.monto_estimado)}` : ''))),
            el('button', { class: 'btn btn-sec', onclick: () => { panel.hidden = !panel.hidden; if (!panel.hidden) monto.focus(); } }, 'Pagué')),
          panel);
      };

      const grupo = (titulo, arr) => arr.length ? el('section', { class: 'grupo' },
        el('h2', { class: 'subtitulo' }, `${titulo} (${arr.length})`), el('ul', { class: 'lista' }, ...arr.map(tarjeta))) : null;
      const venc = st.obligaciones.filter((o) => o.dias < 0);
      const prox = st.obligaciones.filter((o) => o.dias >= 0 && o.dias <= 7);
      const luego = st.obligaciones.filter((o) => o.dias > 7);

      const historial = st.pagos.length ? el('section', { class: 'grupo' },
        el('h2', { class: 'subtitulo' }, 'Últimos pagos'),
        el('ul', { class: 'lista' }, ...st.pagos.map((p) => el('li', { class: 'card item' },
          el('div', { class: 'grow' }, el('strong', {}, p.nombre), el('span', { class: 'sub' }, 'Pagado el ' + fechaCorta(p.pagado))),
          el('strong', {}, peso(p.monto)))))) : null;

      montar(
        cabecera('Impuestos y servicios', volver),
        el('main', { class: 'contenido' },
          el('div', { class: 'barra' },
            el('button', { class: 'btn', onclick: () => { if (Ia.estado.casa) archivo.click(); else { st.msg = 'La IA todavía no está activa. Cargalo a mano.'; lista(); } } }, '📷 Escanear factura'),
            el('button', { class: 'btn btn-sec', onclick: () => formulario(null) }, '+ Agregar a mano'),
            el('button', { class: 'btn btn-sec', onclick: () => calendario() }, '🗓️ Ver calendario'),
            archivo),
          st.msg ? el('p', { class: 'nota', role: 'alert' }, st.msg) : null,
          grupo('Vencidos', venc), grupo('Esta semana', prox), grupo('Más adelante', luego),
          st.obligaciones.length ? null : el('div', { class: 'vacio' },
            el('div', { class: 'vacio-ico', 'aria-hidden': 'true' }, '🧾'),
            el('p', {}, 'Todavía no cargaste nada. Agregá luz, gas, agua, internet, municipal, patente…')),
          historial));
    }

    // ---------- calendario mensual ----------
    // Proyecta cada vencimiento hacia adelante según su frecuencia (el servidor solo guarda el próximo).
    const diasDelMes = (y, m) => new Date(y, m, 0).getDate();
    const sumarMeses = (iso, n, dia) => {
      const t = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + n;
      const ny = Math.floor(t / 12), nm = (t % 12) + 1;
      return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(dia, diasDelMes(ny, nm))).padStart(2, '0')}`;
    };
    const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    function eventosDelMes(mes) {
      const hoy = hoyISO();
      const ev = [];
      for (const o of st.obligaciones) {
        let iso = o.proximo_venc;
        for (let i = 0; i < 80 && iso.slice(0, 7) <= mes; i++) {
          if (iso.slice(0, 7) === mes) ev.push({ fecha: iso, nombre: o.nombre, estado: iso < hoy ? 'vencido' : 'pendiente', monto: o.monto_estimado, o });
          iso = sumarMeses(iso, o.frecuencia_meses, o.dia);
        }
      }
      for (const p of st.pagos) if (p.pagado.slice(0, 7) === mes) ev.push({ fecha: p.pagado, nombre: p.nombre, estado: 'pagado', monto: p.monto });
      for (const f of st.fer[mes.slice(0, 4)] || []) if (f.fecha.slice(0, 7) === mes) ev.push({ fecha: f.fecha, nombre: f.nombre, estado: 'feriado', monto: null });
      return ev.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    }

    function calendario(mes = hoyISO().slice(0, 7), dia = null, msg = '') {
      const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
      st.calMes = mes; st.calDia = dia;
      // Los feriados se piden una vez por año y se redibuja el calendario cuando llegan.
      if (!st.fer[String(y)]) {
        st.fer[String(y)] = [];
        Api.get('/casa/feriados?anio=' + y).then((r) => { if (r.ok) { st.fer[String(y)] = r.feriados; if (st.calMes === mes) calendario(mes, dia); } }).catch(() => {});
      }
      const ev = eventosDelMes(mes);
      const moverMes = (d) => { const t = y * 12 + (m - 1) + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
      const hoy = hoyISO();
      const primero = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lunes = 0
      const celdas = [];
      for (let i = 0; i < primero; i++) celdas.push(el('div', { class: 'cal-celda vacia' }));
      for (let d = 1; d <= diasDelMes(y, m); d++) {
        const iso = `${mes}-${String(d).padStart(2, '0')}`;
        const delDia = ev.filter((e) => e.fecha === iso);
        celdas.push(el('button', { class: 'cal-celda' + (iso === hoy ? ' hoy' : '') + (dia === iso ? ' sel' : ''), 'aria-label': `${d} de ${MESES[m - 1]}` + (delDia.length ? `, ${delDia.length} vencimientos` : ''),
          onclick: () => calendario(mes, dia === iso ? null : iso) },
          el('span', {}, String(d)),
          el('span', { class: 'cal-puntos' }, ...delDia.slice(0, 3).map((e) => el('i', { class: 'punto ' + e.estado })))));
      }
      const visibles = dia ? ev.filter((e) => e.fecha === dia) : ev;
      const filas = visibles.map((e) => el('li', { class: 'card item cal-ev ' + e.estado },
        el('div', { class: 'grow' },
          el('strong', {}, e.nombre),
          el('span', { class: 'sub' }, `${e.fecha.slice(8, 10)}/${e.fecha.slice(5, 7)} · ${{ pagado: 'Pagado', vencido: 'Vencido', feriado: 'Feriado' }[e.estado] || 'Pendiente'}`)),
        e.monto != null ? el('strong', {}, peso(e.monto)) : null));

      montar(
        cabecera('Calendario', st.desdeMenu ? volver : lista),
        el('main', { class: 'contenido' },
          el('div', { class: 'selector-mes' },
            el('button', { class: 'btn-ico', 'aria-label': 'Mes anterior', onclick: () => calendario(moverMes(-1)) }, '‹'),
            el('strong', {}, `${MESES[m - 1]} ${y}`),
            el('button', { class: 'btn-ico', 'aria-label': 'Mes siguiente', onclick: () => calendario(moverMes(1)) }, '›')),
          el('div', { class: 'cal-grilla', role: 'group', 'aria-label': 'Calendario de vencimientos' },
            ...['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => el('span', { class: 'cal-dia-sem', 'aria-hidden': 'true' }, d)), ...celdas),
          el('p', { class: 'sub cal-leyenda' },
            el('i', { class: 'punto pendiente' }), ' pendiente   ', el('i', { class: 'punto vencido' }), ' vencido   ', el('i', { class: 'punto pagado' }), ' pagado   ', el('i', { class: 'punto feriado' }), ' feriado'),
          el('h2', { class: 'subtitulo' }, dia ? `Día ${dia.slice(8, 10)}/${dia.slice(5, 7)}` : 'Este mes'),
          filas.length ? el('ul', { class: 'lista' }, ...filas)
            : el('p', { class: 'nota' }, dia ? 'No hay vencimientos ese día.' : 'No hay vencimientos este mes.'),
          st.gcal ? el('div', { class: 'barra separado' }, el('button', { class: 'btn btn-sec', onclick: sincronizar }, '📅 Sincronizar con Google Calendar')) : null,
          msg ? el('p', { class: 'nota', role: 'status' }, msg) : null));
    }

    // ---------- alta / edición ----------
    // o: datos iniciales (con id = edición; sin id = alta, p. ej. leída de una factura). aviso: texto opcional arriba.
    function formulario(o, aviso = '') {
      const campo = (id, etiqueta, input) => el('div', { class: 'campo' }, el('label', { for: id }, etiqueta), input);
      const nombre = el('input', { id: 'o-nombre', type: 'text', value: o?.nombre || '', maxlength: '80', autocomplete: 'off', required: '' });
      const tipo = el('select', { id: 'o-tipo' }, ...Object.entries(TIPOS).map(([v, t]) => el('option', { value: v, selected: (o?.tipo || 'servicio') === v ? '' : null }, t)));
      const frec = el('select', { id: 'o-frec' }, ...Object.entries(FREC).map(([v, t]) => el('option', { value: v, selected: Number(v) === (o?.frecuencia_meses || 1) ? '' : null }, t)));
      const venc = el('input', { id: 'o-venc', type: 'date', value: o?.proximo_venc || '', required: '' });
      const monto = el('input', { id: 'o-monto', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: o?.monto_estimado ?? '' });
      const nota = el('input', { id: 'o-nota', type: 'text', value: o?.nota || '', maxlength: '200', autocomplete: 'off' });
      const err = el('p', { class: 'error', role: 'alert' });
      const zonaBorrar = el('div', {});

      const borrar = () => {
        zonaBorrar.replaceChildren(el('div', { class: 'card' },
          el('p', {}, `¿Borrar "${o.nombre}"? Los pagos ya registrados se conservan en el historial de la base.`),
          el('div', { class: 'barra' },
            el('button', { class: 'btn btn-peligro', type: 'button', onclick: async () => {
              const r = await Api.post('/casa/obligaciones/eliminar', { id: o.id });
              if (r.ok) cargar('Borrado.'); else err.textContent = r.error || 'No se pudo borrar';
            } }, 'Sí, borrar'),
            el('button', { class: 'btn btn-sec', type: 'button', onclick: () => zonaBorrar.replaceChildren() }, 'No'))));
      };

      const form = el('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        const r = await Api.post('/casa/obligaciones/guardar', {
          id: o?.id, nombre: nombre.value, tipo: tipo.value, frecuencia_meses: Number(frec.value),
          proximo_venc: venc.value, monto_estimado: monto.value, nota: nota.value });
        if (r.ok) cargar(o?.id ? 'Cambios guardados.' : 'Vencimiento agregado.');
        else err.textContent = r.error || 'No se pudo guardar';
      } },
        campo('o-nombre', 'Nombre (ej. Luz, Gas, Municipal, Internet)', nombre),
        campo('o-tipo', 'Tipo', tipo),
        campo('o-frec', 'Se repite', frec),
        campo('o-venc', 'Próximo vencimiento', venc),
        campo('o-monto', 'Monto aproximado (opcional)', monto),
        campo('o-nota', 'Nota (opcional)', nota),
        err,
        el('div', { class: 'barra' },
          el('button', { class: 'btn', type: 'submit' }, 'Guardar'),
          el('button', { class: 'btn btn-sec', type: 'button', onclick: lista }, 'Cancelar'),
          o?.id ? el('button', { class: 'btn btn-peligro-sec', type: 'button', onclick: borrar }, 'Borrar') : null),
        zonaBorrar);

      montar(cabecera(o?.id ? 'Editar vencimiento' : 'Nuevo vencimiento', lista),
        el('main', { class: 'contenido' }, aviso ? el('p', { class: 'nota', role: 'status' }, aviso) : null, form));
      nombre.focus();
    }

    montar(el('main', { class: 'contenido' }, el('p', { class: 'nota' }, 'Cargando…')));
    cargar();
  }

  return { abrir, pendientes };
})();
