'use strict';
// Mi perfil: quién está usando la app (el usuario de Home Assistant), avisos y versión.
const Perfil = (() => {
  const el = UI.el;

  function abrir(montar, volver, usuario) {
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
        avisos, version));
  }

  return { abrir };
})();
