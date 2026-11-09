'use strict';
// Casa → Dar de baja: foto del producto antes de tirarlo y se descuenta del stock.
// Pantalla aparte de la carga: acá nunca se crean artículos, solo se descuenta.
const Baja = (() => {
  const el = UI.el;
  const CLAVE_AUTO = 'madoval_baja_auto';
  const leerAuto = () => { try { return localStorage.getItem(CLAVE_AUTO) === '1'; } catch { return false; } };
  const guardarAuto = (v) => { try { localStorage.setItem(CLAVE_AUTO, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };
  const fmt = (n) => String(Number.isInteger(n) ? n : Math.round(n * 100) / 100).replace('.', ',');
  const detalle = (a) => [a.marca, a.presentacion].filter(Boolean).join(' · ');

  function abrir(montar, volver) {
    let auto = leerAuto();

    const cabecera = (atras) => el('header', { class: 'top' },
      el('button', { class: 'link', onclick: atras, 'aria-label': 'Volver' }, '← Volver'),
      el('h1', {}, 'Dar de baja'));

    function inicio(mensaje = '') {
      const archivo = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto',
        onchange: (e) => { const f = e.target.files[0]; if (f) procesar(f); } });
      const check = el('input', { type: 'checkbox', id: 'b-auto', checked: auto,
        onchange: (e) => { auto = e.target.checked; guardarAuto(auto); } });
      montar(cabecera(volver), el('main', { class: 'contenido' },
        el('p', { class: 'nota' }, 'Sacale una foto al producto antes de tirarlo y se descuenta del stock.'),
        mensaje ? el('p', { class: 'nota', role: 'alert' }, mensaje) : null,
        el('div', { class: 'barra' },
          el('button', { class: 'btn', onclick: () => { if (Ia.estado.casa) archivo.click(); else inicio('La IA todavía no está activa.'); } }, '📷 Foto del producto'),
          archivo),
        el('label', { class: 'fila-check', for: 'b-auto' }, check,
          el('span', {}, 'Dar de baja sin preguntar cuando lo reconozca con seguridad (con opción de deshacer)'))));
    }

    async function procesar(archivo) {
      montar(cabecera(inicio), el('main', { class: 'contenido' }, el('p', { class: 'nota', role: 'status' }, 'Analizando la foto…')));
      let img;
      try { img = await Ia.prepararImagen(archivo); } catch { return inicio('No se pudo leer la imagen.'); }
      const r = await Api.post('/casa/baja/identificar', { mime: img.mime, imagen_base64: img.base64 });
      if (!r.ok) return inicio(r.offline ? 'Sin conexión.' : (r.error || 'No se pudo identificar el producto.'));
      if (auto && r.exacto && r.exacto.stock_actual > 0) return darDeBaja(r.exacto, 1, r.propuesta);
      confirmar(r.propuesta, r.exacto, r.candidatos);
    }

    function confirmar(propuesta, elegido, candidatos) {
      const visto = [propuesta.nombre, propuesta.marca, propuesta.presentacion].filter(Boolean).join(' · ') || 'producto sin identificar';
      const partes = [el('p', { class: 'nota' }, 'La IA vio: ', el('strong', {}, visto))];

      if (elegido) {
        const cant = el('input', { id: 'b-cant', type: 'number', min: '1', max: String(Math.max(1, elegido.stock_actual)), step: '1', value: '1', inputmode: 'numeric' });
        partes.push(el('div', { class: 'card form' },
          el('p', { class: 'grande' }, elegido.nombre),
          el('p', { class: 'sub' }, [detalle(elegido), `Stock actual: ${fmt(elegido.stock_actual)}`].filter(Boolean).join(' · ')),
          elegido.stock_actual > 0
            ? el('div', { class: 'campo' }, el('label', { for: 'b-cant' }, 'Cantidad a dar de baja'), cant)
            : el('p', { class: 'error' }, 'No hay stock de este artículo.'),
          el('div', { class: 'barra' },
            elegido.stock_actual > 0 ? el('button', { class: 'btn', onclick: () => darDeBaja(elegido, Math.max(1, Number(cant.value) || 1), propuesta) }, 'Confirmar baja') : null,
            el('button', { class: 'btn btn-sec', onclick: () => inicio() }, 'Cancelar'))));
      } else {
        partes.push(el('p', { class: 'nota' }, 'No lo encontré en tu stock con seguridad.'));
      }

      const otros = (candidatos || []).filter((c) => !elegido || c.id !== elegido.id);
      if (otros.length) {
        partes.push(el('p', { class: 'nota' }, elegido ? '¿Es otro de estos?' : 'Elegí cuál es:'));
        partes.push(el('ul', { class: 'lista' }, ...otros.map((c) => el('li', {},
          el('button', { class: 'card item item-btn', onclick: () => confirmar(propuesta, c, candidatos) },
            el('div', { class: 'grow' }, el('strong', {}, c.nombre), el('span', { class: 'sub' }, [detalle(c), `Stock: ${fmt(c.stock_actual)}`].filter(Boolean).join(' · '))))))));
      }
      if (!elegido) partes.push(el('div', { class: 'barra' }, el('button', { class: 'btn btn-sec', onclick: () => inicio() }, 'Cancelar')));
      montar(cabecera(inicio), el('main', { class: 'contenido' }, ...partes));
    }

    async function darDeBaja(articulo, cantidad, propuesta) {
      // "lectura" = cómo la IA leyó el producto; si difiere del artículo elegido, el servidor lo aprende como alias.
      const lectura = propuesta ? { nombre: propuesta.nombre, marca: propuesta.marca, presentacion: propuesta.presentacion } : undefined;
      const r = await Api.post('/casa/baja', { id: articulo.id, cantidad, lectura });
      if (!r.ok) return inicio(r.offline ? 'Sin conexión: no se dio de baja.' : (r.error || 'No se pudo dar de baja'));
      exito(r);
    }

    function exito(r) {
      const estado = el('p', { class: 'ok', role: 'status' }, `✅ Baja registrada: «${r.nombre}». Stock ahora: ${fmt(r.stock_actual)}.`);
      const deshacer = el('button', { class: 'btn btn-sec', onclick: async () => {
        deshacer.disabled = true;
        const u = await Api.post('/casa/ajustar', { id: r.id, delta: r.descontado });
        if (u.ok) { estado.textContent = `Se deshizo la baja de «${r.nombre}». Stock: ${fmt(u.stock_actual)}.`; deshacer.hidden = true; }
        else { estado.textContent = u.error || 'No se pudo deshacer'; deshacer.disabled = false; }
      } }, 'Deshacer');
      montar(cabecera(volver), el('main', { class: 'contenido' }, el('div', { class: 'card form' }, estado,
        el('div', { class: 'barra' },
          el('button', { class: 'btn', onclick: () => inicio() }, '📷 Otra baja'),
          deshacer,
          el('button', { class: 'btn btn-sec', onclick: volver }, 'Terminar')))));
    }

    inicio();
  }

  return { abrir };
})();
