'use strict';
// Casa → Gastos del hogar. Resumen por mes: gastos sueltos (a mano o escaneando el ticket) + pagos de impuestos y servicios.
const Gastos = (() => {
  const el = UI.el;
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const peso = (n) => '$ ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const nombreMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const corto = (m) => MESES[Number(m.slice(5, 7)) - 1].slice(0, 3);
  const fechaCorta = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const hoyISO = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const moverMes = (m, d) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

  function abrir(montar, volver) {
    const st = { mes: '', datos: null, msg: '' };

    async function cargar(mensaje = '', mes = st.mes) {
      const r = await Api.get('/casa/gastos' + (mes ? '?mes=' + encodeURIComponent(mes) : ''));
      if (r.ok) { st.datos = r; st.mes = r.mes; st.msg = mensaje; }
      else st.msg = r.offline ? 'Sin conexión: no se pueden ver los gastos.' : (r.error || 'No se pudo cargar');
      lista();
    }

    const cabecera = (titulo, atras) => el('header', { class: 'top' },
      el('button', { class: 'link', onclick: atras, 'aria-label': 'Volver' }, '← Volver'),
      el('h1', {}, titulo));

    async function escanear(f) {
      montar(cabecera('Gastos del hogar', lista), el('main', { class: 'contenido' }, el('p', { class: 'nota', role: 'status' }, 'Leyendo el ticket…')));
      let r;
      try {
        const img = await Ia.prepararImagen(f);
        r = await Api.post('/casa/gastos/identificar', { mime: img.mime, imagen_base64: img.base64 });
      } catch (e) { r = { ok: false, error: 'No se pudo preparar la imagen' }; }
      if (!r.ok) { st.msg = r.offline ? 'Sin conexión.' : (r.error || 'No se pudo leer el ticket'); lista(); return; }
      const p = r.propuesta;
      const faltan = [!p.fecha && 'la fecha', p.monto == null && 'el monto'].filter(Boolean);
      formulario({ ...p, fecha: p.fecha || hoyISO() }, 'Revisá lo que leí del ticket antes de guardar.' + (faltan.length ? ` No pude leer ${faltan.join(' ni ')}: completalo.` : ''));
    }

    function lista() {
      const d = st.datos;
      const archivo = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto',
        onchange: (e) => { const f = e.target.files[0]; if (f) escanear(f); } });
      const mesActual = d ? d.historial[d.historial.length - 1] : null;
      const previo = d && d.historial.length > 1 ? d.historial[d.historial.length - 2] : null;
      const hoyMes = hoyISO().slice(0, 7);

      const selector = el('div', { class: 'selector-mes' },
        el('button', { class: 'btn-ico', 'aria-label': 'Mes anterior', onclick: () => cargar('', moverMes(st.mes, -1)) }, '‹'),
        el('strong', {}, st.mes ? nombreMes(st.mes) : ''),
        el('button', { class: 'btn-ico', 'aria-label': 'Mes siguiente', disabled: st.mes >= hoyMes ? '' : null, onclick: () => cargar('', moverMes(st.mes, 1)) }, '›'));

      let cuerpo = null;
      if (d) {
        const max = Math.max(1, ...d.por_categoria.map((c) => c.total));
        const maxHist = Math.max(1, ...d.historial.map((h) => h.total));
        const comparacion = previo && previo.mes === moverMes(st.mes, -1) && previo.total > 0
          ? (() => { const dif = d.total - previo.total, pct = Math.round(Math.abs(dif) / previo.total * 100);
            return `${dif >= 0 ? 'Subió' : 'Bajó'} ${pct}% respecto de ${nombreMes(previo.mes).split(' ')[0].toLowerCase()} (${peso(previo.total)}).`; })() : '';

        cuerpo = [
          el('section', { class: 'card total-mes' },
            el('span', { class: 'sub' }, 'Total del mes'),
            el('strong', { class: 'total-num' }, peso(d.total)),
            comparacion ? el('span', { class: 'sub' }, comparacion) : null),
          d.por_categoria.length ? el('section', { class: 'grupo' },
            el('h2', { class: 'subtitulo' }, 'Por categoría'),
            el('ul', { class: 'lista' }, ...d.por_categoria.map((c) => el('li', { class: 'card cat-barra' },
              el('div', { class: 'item' }, el('span', {}, c.categoria), el('strong', {}, peso(c.total))),
              el('div', { class: 'barra-fondo', 'aria-hidden': 'true' }, el('div', { class: 'barra-valor', style: `width:${Math.max(3, Math.round(c.total / max * 100))}%` })))))) : null,
          d.historial.length > 1 ? el('section', { class: 'grupo' },
            el('h2', { class: 'subtitulo' }, 'Últimos meses'),
            el('div', { class: 'card historial' }, ...d.historial.map((h) => el('div', { class: 'col-mes' + (h.mes === st.mes ? ' activa' : '') },
              el('div', { class: 'col-barra', title: peso(h.total), style: `height:${Math.max(4, Math.round(h.total / maxHist * 80))}px` }),
              el('span', { class: 'sub' }, corto(h.mes)))))) : null,
          el('section', { class: 'grupo' },
            el('h2', { class: 'subtitulo' }, `Movimientos (${d.items.length})`),
            d.items.length ? el('ul', { class: 'lista' }, ...d.items.map((i) => {
              const info = [el('strong', {}, i.concepto), el('span', { class: 'sub' }, `${fechaCorta(i.fecha)} · ${i.categoria}` + (i.origen === 'pago' ? ' · pago registrado' : ''))];
              return el('li', { class: 'card item' },
                i.origen === 'gasto'
                  ? el('button', { class: 'grow info', onclick: () => formulario(i), 'aria-label': 'Editar ' + i.concepto }, ...info)
                  : el('div', { class: 'grow' }, ...info),
                el('strong', {}, peso(i.monto)));
            })) : el('div', { class: 'vacio' }, el('div', { class: 'vacio-ico', 'aria-hidden': 'true' }, '💰'),
              el('p', {}, 'No hay gastos este mes. Escaneá un ticket o agregalo a mano.'))),
        ];
      }

      montar(
        cabecera('Gastos del hogar', volver),
        el('main', { class: 'contenido' },
          el('div', { class: 'barra' },
            el('button', { class: 'btn', onclick: () => { if (Ia.estado.casa) archivo.click(); else { st.msg = 'La IA todavía no está activa. Cargalo a mano.'; lista(); } } }, '📷 Escanear ticket'),
            el('button', { class: 'btn btn-sec', onclick: () => formulario(null) }, '+ Agregar a mano'),
            archivo),
          st.msg ? el('p', { class: 'nota', role: 'alert' }, st.msg) : null,
          selector, ...(cuerpo || [])));
    }

    // g: datos iniciales (con id = edición). aviso: texto opcional arriba.
    function formulario(g, aviso = '') {
      const campo = (id, etiqueta, input) => el('div', { class: 'campo' }, el('label', { for: id }, etiqueta), input);
      const concepto = el('input', { id: 'g-concepto', type: 'text', value: g?.concepto || '', maxlength: '100', autocomplete: 'off', required: '' });
      const monto = el('input', { id: 'g-monto', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: g?.monto ?? '', required: '' });
      const fecha = el('input', { id: 'g-fecha', type: 'date', value: g?.fecha || hoyISO(), required: '' });
      const cats = st.datos?.categorias || ['Otros'];
      const cat = el('select', { id: 'g-cat' }, ...cats.map((c) => el('option', { value: c, selected: (g?.categoria || 'Otros') === c ? '' : null }, c)));
      const err = el('p', { class: 'error', role: 'alert' });
      const zonaBorrar = el('div', {});

      const borrar = () => zonaBorrar.replaceChildren(el('div', { class: 'card' },
        el('p', {}, `¿Borrar "${g.concepto}"?`),
        el('div', { class: 'barra' },
          el('button', { class: 'btn btn-peligro', type: 'button', onclick: async () => {
            const r = await Api.post('/casa/gastos/eliminar', { id: g.id });
            if (r.ok) cargar('Borrado.'); else err.textContent = r.error || 'No se pudo borrar';
          } }, 'Sí, borrar'),
          el('button', { class: 'btn btn-sec', type: 'button', onclick: () => zonaBorrar.replaceChildren() }, 'No'))));

      const form = el('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        const r = await Api.post('/casa/gastos/guardar', { id: g?.id, concepto: concepto.value, monto: monto.value, fecha: fecha.value, categoria: cat.value });
        if (r.ok) cargar(g?.id ? 'Cambios guardados.' : 'Gasto agregado.', fecha.value.slice(0, 7));
        else err.textContent = r.error || 'No se pudo guardar';
      } },
        campo('g-concepto', 'Concepto (ej. Supermercado, Farmacia)', concepto),
        campo('g-monto', 'Monto', monto),
        campo('g-fecha', 'Fecha', fecha),
        campo('g-cat', 'Categoría', cat),
        err,
        el('div', { class: 'barra' },
          el('button', { class: 'btn', type: 'submit' }, 'Guardar'),
          el('button', { class: 'btn btn-sec', type: 'button', onclick: lista }, 'Cancelar'),
          g?.id ? el('button', { class: 'btn btn-peligro-sec', type: 'button', onclick: borrar }, 'Borrar') : null),
        zonaBorrar);

      montar(cabecera(g?.id ? 'Editar gasto' : 'Nuevo gasto', lista),
        el('main', { class: 'contenido' }, aviso ? el('p', { class: 'nota', role: 'status' }, aviso) : null, form));
      concepto.focus();
    }

    montar(el('main', { class: 'contenido' }, el('p', { class: 'nota' }, 'Cargando…')));
    cargar();
  }

  return { abrir };
})();
