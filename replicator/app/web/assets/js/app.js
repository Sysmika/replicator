'use strict';
// Shell de Replicator (add-on de Home Assistant): navegación de Casa y estado de conexión. Sin login propio.
(function () {
  const $app = document.getElementById('app');
  const state = { usuario: null, seccion: 'casa' };

  const SECCIONES = {
    casa: {
      titulo: 'Casa',
      icono: '🏠',
      items: [
        ['Stock de mercadería', 'Productos, marcas y categorías', 'Con foto', 'stock', '📦'],
        ['Dar de baja', 'Foto antes de tirar un producto', 'Con foto', 'baja', '♻️'],
        ['Lista de compras', 'Lo que falta comprar', 'Automática', 'lista', '🛒'],
        ['Impuestos y servicios', 'Vencimientos y recordatorios', 'Con avisos', 'impuestos', '🧾'],
        ['Calendario', 'Vencimientos y feriados del mes', 'Nuevo', 'calendario', '🗓️'],
        ['Gastos del hogar','Resumen mensual', 'Con foto', 'gastos', '💰'],
      ],
      lema: 'Tu hogar, siempre al día',
    },
  };

  const saludo = () => {
    const h = new Date().getHours();
    return h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  };
  const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const logo = (clase) => el('img', { src: 'assets/icons/icon.svg', alt: '', class: clase, width: '72', height: '72' });

  const el = UI.el;

  // Pantallas completas que reemplazan el shell (stock, etc.): reciben nodos y los montan.
  const montar = (...nodos) => { $app.replaceChildren(...nodos.filter(Boolean)); window.scrollTo(0, 0); };
  const ACCIONES = {
    stock: () => Casa.stock(montar, vistaPrincipal),
    baja: () => Baja.abrir(montar, vistaPrincipal),
    lista: () => Lista.abrir(montar, vistaPrincipal),
    impuestos: () => Impuestos.abrir(montar, vistaPrincipal),
    calendario: () => Impuestos.abrir(montar, vistaPrincipal, 'calendario'),
    gastos: () => Gastos.abrir(montar, vistaPrincipal),
  };

  // Dentro de Home Assistant no hay login propio: la persona es el usuario de HA.
  function vistaSinAcceso(mensaje) {
    $app.className = '';
    $app.replaceChildren(el('main', { class: 'centro' },
      el('div', { class: 'bienvenida aparecer' },
        logo('logo-grande'),
        el('h1', {}, 'Replicator'),
        el('p', { class: 'lema' }, mensaje || 'Abrí Replicator desde el menú de Home Assistant.'))));
  }

  function vistaPrincipal() {
    const sec = SECCIONES[state.seccion];
    $app.className = 'sec-' + state.seccion; // cada sección tiene su color
    const aviso = el('div', { class: 'aviso', id: 'aviso', hidden: '' }, 'Sin conexión: se muestra la última versión guardada.');

    const lista = el('ul', { class: 'lista' }, ...sec.items.map(([t, d, p, accion, icono]) => {
      const cuerpo = [
        el('span', { class: 'ico-tile', 'aria-hidden': 'true' }, icono || '•'),
        el('div', { class: 'grow' }, el('strong', {}, t), el('span', { class: 'sub' }, d)),
        el('span', { class: 'etiqueta' + (accion ? ' etiqueta-acento' : '') }, p),
        accion ? el('span', { class: 'flecha', 'aria-hidden': 'true' }, '›') : null,
      ];
      return accion
        ? el('li', {}, el('button', { class: 'card item item-btn', onclick: ACCIONES[accion] }, ...cuerpo))
        : el('li', { class: 'card item pronto' }, ...cuerpo);
    }));

    const nota = Ia.estado.casa ? null : el('p', { class: 'nota' }, 'La IA no está activa en esta instalación: podés cargar todo a mano.');

    $app.replaceChildren(
      el('header', { class: 'top inicio' },
        el('button', { class: 'quien-btn', onclick: () => Perfil.abrir(montar, vistaPrincipal, state.usuario), 'aria-label': 'Mi perfil' },
          logo('logo-mini'),
          el('span', {}, el('span', { class: 'hola' }, saludo() + ','), el('strong', { class: 'nombre' }, capitalizar(state.usuario.nombre))))),
      aviso,
      el('main', { class: 'contenido aparecer' },
        el('section', { class: 'hero' },
          el('span', { class: 'hero-ico', 'aria-hidden': 'true' }, sec.icono),
          el('div', {}, el('h1', {}, sec.titulo), el('p', { class: 'sub' }, sec.lema))),
        ...(nota ? [nota] : []), lista));
    actualizarConexion();

    // Recordatorio: vencimientos atrasados o dentro de los próximos 3 días (se ve al abrir Casa).
    if (state.seccion === 'casa') {
      Impuestos.pendientes().then((p) => {
        if (!p || (!p.vencidos && !p.prontos) || !document.body.contains(lista)) return;
        const partes = [];
        if (p.vencidos) partes.push(`${p.vencidos} ${p.vencidos === 1 ? 'vencido' : 'vencidos'}`);
        if (p.prontos) partes.push(`${p.prontos} ${p.prontos === 1 ? 'vence' : 'vencen'} en los próximos 3 días`);
        lista.before(el('button', { class: 'recordatorio' + (p.vencidos ? ' urgente' : ''), role: 'status', onclick: ACCIONES.impuestos },
          '🔔 Impuestos y servicios: ' + partes.join(' · ')));
      }).catch(() => {});
    }
  }

  function actualizarConexion() {
    const a = document.getElementById('aviso');
    if (a) a.hidden = navigator.onLine;
  }
  window.addEventListener('online', actualizarConexion);
  window.addEventListener('offline', actualizarConexion);

  async function iniciar() {
    await Ia.cargarEstado();
    vistaPrincipal();
  }

  async function arrancar() {
    const h = location.hash.replace('#', '');
    if (SECCIONES[h]) state.seccion = h;
    const r = await Api.get('/me');
    if (r.ok) { state.usuario = r.usuario; await iniciar(); }
    else if (r.offline) vistaSinAcceso('Sin conexión con Home Assistant.');
    else vistaSinAcceso(r.error);
  }

  // ---- Actualización automática de la app ----
  // El servidor cambia la versión de sw.js cuando cambia cualquier archivo. Acá la buscamos seguido
  // y recargamos solos; si hay un formulario en uso, mostramos un aviso en vez de interrumpir.
  function avisoActualizar() {
    if (document.getElementById('aviso-version')) return;
    document.body.append(el('div', { class: 'banner-version', id: 'aviso-version', role: 'status' },
      el('span', {}, 'Hay una versión nueva de la app.'),
      el('button', { class: 'btn', onclick: () => location.reload() }, 'Actualizar')));
  }

  function vigilarVersion() {
    if (!('serviceWorker' in navigator)) return;
    const teniaControlador = !!navigator.serviceWorker.controller; // false = primera instalación: no recargar
    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!teniaControlador || recargando) return;
      const a = document.activeElement;
      const escribiendo = a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName);
      if (escribiendo) { avisoActualizar(); return; }
      recargando = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const buscar = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) buscar(); });
      window.addEventListener('online', buscar);
      setInterval(buscar, 15 * 60 * 1000);
      buscar();
    }).catch(() => {});
  }

  vigilarVersion();
  arrancar();
})();
