'use strict';
// Mi perfil: quién está usando la app (el usuario de Home Assistant), clave de IA, avisos y versión.
const Perfil = (() => {
  const el = UI.el;

  function abrir(montar, volver, usuario) {
    // Servicio de IA: la clave la genera Orion para esta instalación y el cliente la pega acá.
    // El servidor nunca la devuelve: solo muestra si hay una cargada y sus últimos 4 caracteres.
    const iaSec = el('section', { class: 'card form' });
    function pintarIA(e, mensaje = '', esError = false) {
      const input = el('input', { id: 'ia-clave', type: 'password', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
        placeholder: e.configurada ? 'Pegá una clave nueva para reemplazarla' : 'Pegá acá la clave que te dio Orion' });
      const msg = el('p', { class: esError ? 'error' : 'ok', role: 'status' }, mensaje);
      const guardar = el('button', { class: 'btn', type: 'submit' }, e.configurada ? 'Reemplazar clave' : 'Guardar clave');
      const quitar = e.configurada ? el('button', { class: 'btn btn-sec', type: 'button', onclick: async () => {
        if (!confirm('¿Quitar la clave de IA? Las fotos dejarán de reconocerse hasta que cargues otra.')) return;
        const r = await Api.post('/config/ia', { borrar: true });
        await Ia.cargarEstado();
        pintarIA(r.ok ? r : e, r.ok ? 'Clave quitada.' : (r.error || 'No se pudo quitar'), !r.ok);
      } }, 'Quitar') : null;
      const form = el('form', { onsubmit: async (ev) => {
        ev.preventDefault();
        if (!input.value.trim()) { input.focus(); return; }
        guardar.disabled = true;
        const r = await Api.post('/config/ia', { clave: input.value });
        guardar.disabled = false;
        input.value = '';
        await Ia.cargarEstado();
        pintarIA(r.ok ? r : e, r.ok ? 'Listo: la IA quedó activa.' : (r.offline ? 'Sin conexión: no se guardó.' : (r.error || 'No se pudo guardar')), !r.ok);
      } },
        el('div', { class: 'campo' }, el('label', { for: 'ia-clave' }, 'Clave de IA'), input),
        msg, el('div', { class: 'barra' }, guardar, quitar));
      iaSec.replaceChildren(
        el('h2', { class: 'subtitulo' }, 'Servicio de IA'),
        el('p', { class: 'nota' }, e.configurada
          ? `Activo. Clave cargada: ••••${e.termina}.`
          : 'Para reconocer productos, tickets y facturas con foto, pedile a Orion la clave de esta instalación y pegala acá.'),
        el('p', { class: 'nota' }, 'Código de esta instalación (pasáselo a Orion al pedir la clave): ', el('strong', { class: 'codigo' }, e.instalacion || '…')),
        form);
    }
    Api.get('/config/ia').then((e) => pintarIA(e.ok ? e : {})).catch(() => pintarIA({}));

    // Avisos de vencimientos por Home Assistant: estado y envío de prueba (solo se muestra si están activados en el servidor).
    const avisos = el('section', { class: 'card', hidden: '' });
    Api.get('/avisos/estado').then((a) => {
      if (!a.ok || !a.activo) return;
      const msg = el('p', { class: 'nota', role: 'status' });
      const probar = el('button', { class: 'btn btn-sec', type: 'button', onclick: async () => {
        probar.disabled = true; msg.textContent = 'Enviando aviso de prueba…';
        const r = await Api.post('/avisos/probar', {});
        probar.disabled = false;
        msg.textContent = r.ok ? `Aviso enviado a ${r.enviados} ${r.enviados === 1 ? 'celular' : 'celulares'}.` : 'No se pudo enviar: ' + (r.error || 'error desconocido');
      } }, '🔔 Probar aviso al celular');
      avisos.replaceChildren(
        el('h2', { class: 'subtitulo' }, 'Avisos de vencimientos'),
        el('p', { class: 'nota' }, `Cada día a las ${a.hora} llega un resumen por Home Assistant si hay algo vencido o por vencer.`),
        probar, msg);
      avisos.hidden = false;
    }).catch(() => {});

    // Versión de la app instalada (sirve para comprobar si tomó una actualización).
    const version = el('p', { class: 'nota' }, 'Versión de la app: …');
    if (window.caches) {
      caches.keys().then((ks) => {
        const k = ks.find((x) => x.startsWith('replicator-shell-'));
        version.textContent = 'Versión de la app: ' + (k ? k.replace('replicator-shell-', '') : 'sin guardar');
      }).catch(() => { version.textContent = ''; });
    } else version.textContent = '';

    montar(
      el('header', { class: 'top' },
        el('button', { class: 'link', onclick: volver, 'aria-label': 'Volver' }, '← Volver'),
        el('h1', {}, 'Mi perfil')),
      el('main', { class: 'contenido' },
        el('p', { class: 'nota' }, 'Usuario de Home Assistant: ', el('strong', {}, usuario.nombre)),
        el('p', { class: 'nota' }, 'El stock es uno solo para toda la casa. Tu nombre queda anotado en los movimientos que hagas.'),
        iaSec, avisos, version));
  }

  return { abrir };
})();
