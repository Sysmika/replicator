'use strict';
// Casa → Lista de compras. Arriba lo que falta por stock mínimo (se calcula solo); abajo lo anotado a mano.
const Lista = (() => {
  const el = UI.el;
  const fmt = (n) => String(Number.isInteger(n) ? n : Math.round(n * 100) / 100).replace('.', ',');

  function abrir(montar, volver) {
    const st = { sugeridos: [], manuales: [], msg: '' };

    async function cargar() {
      const r = await Api.get('/casa/lista');
      if (r.ok) { st.sugeridos = r.sugeridos; st.manuales = r.manuales; }
      else st.msg = r.offline ? 'Sin conexión: no se puede ver la lista.' : (r.error || 'No se pudo cargar la lista');
      pintar();
    }

    async function accion(ruta, datos) {
      const r = await Api.post(ruta, datos);
      if (!r.ok) st.msg = r.error || 'No se pudo completar la acción';
      else st.msg = '';
      await cargar();
    }

    // "Ya lo compré": suma al stock lo que faltaba y lo saca de la lista.
    const compre = (a) => accion('/casa/ajustar', { id: a.id, delta: a.falta });

    function pintar() {
      const entrada = el('input', { type: 'text', placeholder: 'Anotar algo para comprar…', maxlength: '120', autocomplete: 'off', 'aria-label': 'Anotar algo para comprar' });
      const agregar = el('form', { class: 'barra', onsubmit: async (e) => {
        e.preventDefault();
        const t = entrada.value.trim();
        if (!t) return;
        entrada.value = '';
        await accion('/casa/lista/agregar', { texto: t });
      } }, entrada, el('button', { class: 'btn', type: 'submit' }, 'Agregar'));

      const filaSug = (a) => el('li', { class: 'card item' },
        el('div', { class: 'grow' },
          el('strong', {}, a.nombre),
          el('span', { class: 'sub' }, [a.marca, a.presentacion].filter(Boolean).join(' · ') || 'Sin detalles'),
          el('span', { class: 'sub' }, `Hay ${fmt(a.stock_actual)} · mínimo ${fmt(a.stock_minimo)} · comprar ${fmt(a.falta)}`)),
        el('button', { class: 'btn btn-sec', onclick: () => compre(a), 'aria-label': 'Ya compré ' + a.nombre }, 'Lo compré'));

      const filaMan = (x) => el('li', { class: 'card item' + (x.comprado ? ' hecho' : '') },
        el('label', { class: 'grow fila-check' },
          el('input', { type: 'checkbox', checked: x.comprado ? '' : null, onchange: (e) => accion('/casa/lista/tildar', { id: x.id, comprado: e.target.checked }) }),
          el('span', {}, x.texto)),
        el('button', { class: 'btn-ico', 'aria-label': 'Borrar ' + x.texto, onclick: () => accion('/casa/lista/borrar', { id: x.id }) }, '×'));

      const hayComprados = st.manuales.some((x) => x.comprado);
      const vacio = !st.sugeridos.length && !st.manuales.length;

      montar(
        el('header', { class: 'top' },
          el('button', { class: 'link', onclick: volver, 'aria-label': 'Volver' }, '← Volver'),
          el('h1', {}, 'Lista de compras')),
        el('main', { class: 'contenido' },
          agregar,
          st.msg ? el('p', { class: 'nota', role: 'alert' }, st.msg) : null,
          st.sugeridos.length ? el('section', { class: 'grupo' },
            el('h2', { class: 'subtitulo' }, `Falta por stock (${st.sugeridos.length})`),
            el('ul', { class: 'lista' }, ...st.sugeridos.map(filaSug))) : null,
          st.manuales.length ? el('section', { class: 'grupo' },
            el('h2', { class: 'subtitulo' }, `Anotado (${st.manuales.length})`),
            el('ul', { class: 'lista' }, ...st.manuales.map(filaMan)),
            hayComprados ? el('button', { class: 'btn btn-sec', onclick: () => accion('/casa/lista/borrar', { comprados: true }) }, 'Quitar los tildados') : null) : null,
          vacio ? el('div', { class: 'vacio' },
            el('div', { class: 'vacio-ico', 'aria-hidden': 'true' }, '🛒'),
            el('p', {}, 'No falta nada. Anotá lo que necesites o definí un stock mínimo en cada producto y se arma solo.')) : null));
    }

    montar(el('main', { class: 'contenido' }, el('p', { class: 'nota' }, 'Cargando…')));
    cargar();
  }

  return { abrir };
})();
