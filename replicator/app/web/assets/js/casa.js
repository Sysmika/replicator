'use strict';
// Casa → Stock de mercadería. Foto → la IA propone → el usuario confirma → recién ahí se guarda.
// Lista agrupada por categoría, con filtro y buscador; tocar un artículo permite editarlo o borrarlo.
const Casa = (() => {
  const el = UI.el;
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const esta = (lista, v) => !!v && lista.some((x) => norm(x) === norm(v));
  const fmt = (n) => String(Number.isInteger(n) ? n : Math.round(n * 100) / 100).replace('.', ',');
  const SIN_CAT = 'Sin categoría';

  function stock(montar, volver) {
    const st = { articulos: [], marcas: [], categorias: [], buscar: '', cat: null, msg: '' };
    let zona = null; // contenedor de chips + lista (se repinta sin perder el foco del buscador)

    async function cargar(mensaje = '') {
      const r = await Api.get('/casa/articulos');
      if (r.ok) { st.articulos = r.articulos; st.marcas = r.marcas; st.categorias = r.categorias; st.msg = mensaje; }
      else st.msg = r.offline ? 'Sin conexión: no se puede ver el stock.' : (r.error || 'No se pudo cargar el stock');
      lista();
    }

    const cabecera = (titulo, atras) => el('header', { class: 'top' },
      el('button', { class: 'link', onclick: atras, 'aria-label': 'Volver' }, '← Volver'),
      el('h1', {}, titulo));

    const aviso = (t) => { st.msg = t; lista(); };

    // ---------- lista principal ----------
    function lista() {
      const archivo = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto',
        onchange: (e) => { const f = e.target.files[0]; if (f) foto(f); } });
      const buscador = el('input', { type: 'search', placeholder: 'Buscar por nombre, marca o categoría…', value: st.buscar,
        'aria-label': 'Buscar en el stock', oninput: (e) => { st.buscar = e.target.value; pintar(); } });
      zona = el('div', {});

      montar(
        cabecera('Stock', volver),
        el('main', { class: 'contenido' },
          el('div', { class: 'barra' },
            el('button', { class: 'btn', onclick: () => { if (Ia.estado.casa) archivo.click(); else aviso('La IA todavía no está activa. Cargalo a mano.'); } }, '📷 Agregar con foto'),
            el('button', { class: 'btn btn-sec', onclick: () => { if (Ia.estado.casa) compras(); else aviso('La IA todavía no está activa.'); } }, '🧺 Cargar compras'),
            el('button', { class: 'btn btn-sec', onclick: () => formulario({}, false) }, 'Agregar a mano'),
            archivo),
          st.msg ? el('p', { class: 'nota', role: 'alert' }, st.msg) : null,
          buscador, zona));
      pintar();
    }

    function pintar() {
      const q = norm(st.buscar);
      const coincideBusqueda = (a) => !q || norm(`${a.nombre} ${a.marca || ''} ${a.categoria || ''}`).includes(q);
      const visibles = st.articulos.filter(coincideBusqueda);

      // Categorías con cantidad (según la búsqueda actual)
      const cuenta = new Map();
      for (const a of visibles) cuenta.set(a.categoria || SIN_CAT, (cuenta.get(a.categoria || SIN_CAT) || 0) + 1);
      const nombres = [...cuenta.keys()].sort((x, y) => (x === SIN_CAT) - (y === SIN_CAT) || x.localeCompare(y, 'es'));
      if (st.cat && !cuenta.has(st.cat)) st.cat = null;

      const chip = (texto, valor, n) => el('button', {
        class: 'chip' + (st.cat === valor ? ' activa' : ''), 'aria-pressed': st.cat === valor ? 'true' : 'false',
        onclick: () => { st.cat = valor; pintar(); } }, `${texto} (${n})`);
      const chips = nombres.length > 1
        ? el('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por categoría' }, chip('Todas', null, visibles.length), ...nombres.map((n) => chip(n, n, cuenta.get(n))))
        : null;

      const fila = (a) => el('li', { class: 'card item' },
        el('button', { class: 'grow info', onclick: () => editar(a), 'aria-label': 'Editar ' + a.nombre },
          el('strong', {}, a.nombre),
          el('span', { class: 'sub' }, [a.marca, a.presentacion].filter(Boolean).join(' · ') || 'Sin detalles')),
        el('div', { class: 'cant' },
          el('button', { class: 'btn-ico', 'aria-label': 'Restar uno a ' + a.nombre, onclick: () => ajustar(a, -1) }, '−'),
          el('span', { class: 'num' + (a.stock_minimo > 0 && a.stock_actual <= a.stock_minimo ? ' bajo' : '') }, fmt(a.stock_actual)),
          el('button', { class: 'btn-ico', 'aria-label': 'Sumar uno a ' + a.nombre, onclick: () => ajustar(a, 1) }, '+')));

      const grupos = (st.cat ? [st.cat] : nombres).map((n) => {
        const arts = visibles.filter((a) => (a.categoria || SIN_CAT) === n);
        return el('section', { class: 'grupo' },
          st.cat ? null : el('h2', { class: 'subtitulo' }, `${n} (${arts.length})`),
          el('ul', { class: 'lista' }, ...arts.map(fila)));
      });

      zona.replaceChildren(...[chips,
        grupos.length ? el('div', {}, ...grupos)
          : el('div', { class: 'vacio' },
            el('div', { class: 'vacio-ico', 'aria-hidden': 'true' }, st.articulos.length ? '🔍' : '📦'),
            el('p', {}, st.articulos.length ? 'Nada coincide con la búsqueda.' : 'Todavía no hay artículos. Sacale una foto a un producto para empezar.'))]
        .filter(Boolean));
    }

    async function ajustar(a, delta) {
      const r = await Api.post('/casa/ajustar', { id: a.id, delta });
      if (r.ok) { a.stock_actual = r.stock_actual; pintar(); }
      else { st.msg = r.error || 'No se pudo actualizar'; lista(); }
    }

    // ---------- formulario común (alta y edición) ----------
    function crearCampos(p, extra = {}) {
      const campo = (id, etiqueta, valor, props = {}) => {
        const input = el('input', { id, type: 'text', value: valor ?? '', autocomplete: 'off', ...props });
        return { input, nodo: el('div', { class: 'campo' }, el('label', { for: id }, etiqueta), input) };
      };
      return {
        nombre: campo('f-nombre', 'Nombre del producto', p.nombre, { required: true, maxlength: 120 }),
        marca: campo('f-marca', 'Marca', p.marca, { list: 'dl-marcas', maxlength: 60 }),
        categoria: campo('f-cat', 'Categoría', p.categoria, { list: 'dl-cats', maxlength: 60 }),
        present: campo('f-pres', 'Presentación (ej. 500 g)', p.presentacion, { maxlength: 40 }),
        codigo: campo('f-cod', 'Código de barras (opcional)', p.codigo_barras, { inputmode: 'numeric', maxlength: 30 }),
        ...extra,
      };
    }
    const numero = (id, etiqueta, valor) => {
      const input = el('input', { id, type: 'number', min: '0', step: 'any', inputmode: 'decimal', required: true, value: String(valor) });
      return { input, nodo: el('div', { class: 'campo' }, el('label', { for: id }, etiqueta), input) };
    };
    const listasDatos = () => [
      el('datalist', { id: 'dl-marcas' }, ...st.marcas.map((m) => el('option', { value: m }))),
      el('datalist', { id: 'dl-cats' }, ...st.categorias.map((c) => el('option', { value: c }))),
    ];
    const avisoNuevas = (c, destino) => () => {
      const av = [];
      if (c.marca.input.value.trim() && !esta(st.marcas, c.marca.input.value)) av.push('marca nueva');
      if (c.categoria.input.value.trim() && !esta(st.categorias, c.categoria.input.value)) av.push('categoría nueva');
      destino.textContent = av.length ? 'Se va a crear: ' + av.join(' y ') + '.' : '';
    };

    async function foto(archivo) {
      montar(cabecera('Stock', lista), el('main', { class: 'contenido' }, el('p', { class: 'nota', role: 'status' }, 'Analizando la foto…')));
      let img;
      try { img = await Ia.prepararImagen(archivo); } catch { return aviso('No se pudo leer la imagen.'); }
      const r = await Api.post('/casa/identificar', { mime: img.mime, imagen_base64: img.base64 });
      if (!r.ok) { st.msg = r.offline ? 'Sin conexión.' : (r.error || 'No se pudo identificar el producto. Cargalo a mano.'); return formulario({}, false); }
      formulario(r.propuesta, true);
    }

    // ---------- carga de compras: varias fotos, lista editable, un solo guardado ----------
    function compras(items = [], mensaje = '') {
      const clavePr = (i) => [norm(i.nombre), norm(i.marca), norm(i.presentacion)].join('|');
      const existente = (i) => (norm(i.nombre) ? st.articulos.find((a) => norm(a.nombre) === norm(i.nombre)
        && norm(a.marca) === norm(i.marca) && norm(a.presentacion) === norm(i.presentacion)) : null) || null;

      const camara = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto',
        onchange: (e) => { const f = [...e.target.files]; if (f.length) leerFotos(f); } });
      const galeria = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'oculto',
        onchange: (e) => { const f = [...e.target.files]; if (f.length) leerFotos(f); } });

      async function leerFotos(archivos) {
        const errores = [];
        let n = 0;
        for (const f of archivos) {
          n++;
          montar(cabecera('Cargar compras', () => compras(items)),
            el('main', { class: 'contenido' }, el('p', { class: 'nota', role: 'status' }, `Analizando foto ${n} de ${archivos.length}…`)));
          try {
            const img = await Ia.prepararImagen(f);
            const r = await Api.post('/casa/identificar-varios', { mime: img.mime, imagen_base64: img.base64 });
            if (!r.ok) { errores.push(`Foto ${n}: ${r.offline ? 'sin conexión' : (r.error || 'no se pudo leer')}`); continue; }
            for (const it of r.items) {
              const propio = { nombre: it.nombre, marca: it.marca || '', categoria: it.categoria || '', presentacion: it.presentacion || '',
                cantidad: it.cantidad || 1, incluir: true, lectura: { nombre: it.nombre, marca: it.marca || '', presentacion: it.presentacion || '' } };
              const igual = items.find((x) => clavePr(x) === clavePr(propio));
              if (igual) igual.cantidad += propio.cantidad; else items.push(propio);
            }
          } catch { errores.push(`Foto ${n}: no se pudo procesar`); }
        }
        compras(items, errores.join(' · '));
      }

      const seleccion = () => items.filter((i) => i.incluir);
      const resumen = el('p', { class: 'nota', role: 'status' });
      const confirmarBtn = el('button', { class: 'btn', type: 'button' }, 'Confirmar todo');
      const err = el('p', { class: 'error', role: 'alert' }, mensaje);
      const refrescarResumen = () => {
        const s = seleccion();
        resumen.textContent = items.length ? `${s.length} de ${items.length} productos seleccionados.` : '';
        confirmarBtn.textContent = `Confirmar todo (${s.length})`;
        confirmarBtn.disabled = !s.length;
      };

      const tarjeta = (it) => {
        const estado = el('p', { class: 'estado', role: 'status' });
        const refrescar = () => {
          const ex = existente(it), c = Number(it.cantidad) || 0;
          const nuevas = [];
          if (it.marca.trim() && !esta(st.marcas, it.marca)) nuevas.push('marca nueva');
          if (it.categoria.trim() && !esta(st.categorias, it.categoria)) nuevas.push('categoría nueva');
          estado.classList.toggle('es-suma', !!ex);
          estado.textContent = (ex ? `Ya lo tenés (stock ${fmt(ex.stock_actual)}): se suman ${fmt(c)} y quedan ${fmt(ex.stock_actual + c)}.` : 'Producto nuevo.')
            + (nuevas.length ? ' Se crea: ' + nuevas.join(' y ') + '.' : '');
        };
        const campo = (etiqueta, prop, props = {}) => {
          const input = el('input', { type: 'text', value: it[prop] ?? '', autocomplete: 'off', 'aria-label': etiqueta, placeholder: etiqueta, ...props });
          input.addEventListener('input', () => { it[prop] = input.value; refrescar(); });
          return el('div', { class: 'campo' }, el('label', {}, etiqueta), input);
        };
        const cant = el('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', value: String(it.cantidad), 'aria-label': 'Cantidad' });
        cant.addEventListener('input', () => { it.cantidad = Number(cant.value) || 0; refrescar(); });
        const check = el('input', { type: 'checkbox', checked: it.incluir, 'aria-label': 'Incluir ' + it.nombre,
          onchange: (e) => { it.incluir = e.target.checked; tj.classList.toggle('apagada', !it.incluir); refrescarResumen(); } });
        const tj = el('li', { class: 'card compra' + (it.incluir ? '' : ' apagada') },
          el('div', { class: 'compra-cab' }, el('label', { class: 'fila-check' }, check, el('span', {}, 'Incluir')),
            el('button', { class: 'link', type: 'button', onclick: () => { items.splice(items.indexOf(it), 1); compras(items); } }, 'Quitar')),
          campo('Nombre', 'nombre', { maxlength: 120 }),
          el('div', { class: 'dos' }, campo('Marca', 'marca', { list: 'dl-marcas', maxlength: 60 }), campo('Categoría', 'categoria', { list: 'dl-cats', maxlength: 60 })),
          el('div', { class: 'dos' }, campo('Presentación', 'presentacion', { maxlength: 40 }), el('div', { class: 'campo' }, el('label', {}, 'Cantidad'), cant)),
          estado);
        refrescar();
        return tj;
      };

      confirmarBtn.addEventListener('click', async () => {
        const s = seleccion();
        if (s.some((i) => !i.nombre.trim())) { err.textContent = 'Hay productos sin nombre: completalos o sacalos de la lista.'; return; }
        if (s.some((i) => !(Number(i.cantidad) > 0))) { err.textContent = 'Hay productos con cantidad cero.'; return; }
        confirmarBtn.disabled = true; err.textContent = '';
        const r = await Api.post('/casa/guardar-varios', { items: s.map((i) => ({
          nombre: i.nombre, marca: i.marca, categoria: i.categoria, presentacion: i.presentacion, cantidad: Number(i.cantidad), lectura: i.lectura })) });
        if (r.ok) { await cargar(`Se cargaron ${s.length} productos: ${r.creados} nuevos y ${r.sumados} sumados al stock.`); }
        else { err.textContent = r.offline ? 'Sin conexión: no se guardó nada.' : (r.error || 'No se pudo guardar'); refrescarResumen(); }
      });

      montar(cabecera('Cargar compras', lista), el('main', { class: 'contenido' },
        el('p', { class: 'nota' }, 'Poné los productos sobre la mesada, bien separados y con la etiqueta de frente, y sacá la foto. Podés sumar varias fotos. Revisá la lista antes de confirmar.'),
        el('div', { class: 'barra' },
          el('button', { class: 'btn', type: 'button', onclick: () => camara.click() }, '📷 Sacar foto'),
          el('button', { class: 'btn btn-sec', type: 'button', onclick: () => galeria.click() }, '🖼 Elegir fotos'),
          camara, galeria),
        err, resumen,
        items.length ? el('ul', { class: 'lista' }, ...items.map(tarjeta)) : null,
        items.length ? el('div', { class: 'barra separado' }, confirmarBtn, el('button', { class: 'btn btn-sec', type: 'button', onclick: lista }, 'Cancelar')) : null,
        ...listasDatos()));
      refrescarResumen();
    }

    // ---------- alta ----------
    function formulario(p, porIa) {
      const lectura = porIa ? { nombre: p.nombre, marca: p.marca, presentacion: p.presentacion } : null; // lo que leyó la IA, antes de tus correcciones
      const c = crearCampos(p, { cant: numero('f-cant', 'Cantidad que sumás', 1) });
      const err = el('p', { class: 'error', role: 'alert' });
      const nueva = el('p', { class: 'nota' });
      const estado = el('p', { class: 'estado', role: 'status' });

      // Mismo criterio que el servidor: primero código de barras, después nombre + marca + presentación.
      const existente = () => {
        const cod = c.codigo.input.value.replace(/\D/g, '');
        const porCodigo = cod && st.articulos.find((a) => a.codigo_barras === cod);
        if (porCodigo) return porCodigo;
        if (!norm(c.nombre.input.value)) return null;
        return st.articulos.find((a) => norm(a.nombre) === norm(c.nombre.input.value)
          && norm(a.marca) === norm(c.marca.input.value) && norm(a.presentacion) === norm(c.present.input.value)) || null;
      };
      const nuevasAviso = avisoNuevas(c, nueva);
      const actualizar = () => {
        nuevasAviso();
        const ex = existente();
        const n = Number(c.cant.input.value) || 0;
        estado.classList.toggle('es-suma', !!ex);
        if (ex) estado.textContent = `Ya lo tenés cargado (stock actual: ${fmt(ex.stock_actual)}). Se suman ${fmt(n)} y quedan ${fmt(ex.stock_actual + n)}.`;
        else estado.textContent = norm(c.nombre.input.value) ? 'Producto nuevo: se crea el artículo con ese stock.' : '';
      };
      for (const k of Object.values(c)) k.input.addEventListener('input', actualizar);
      actualizar();

      const btn = el('button', { class: 'btn', type: 'submit' }, 'Confirmar y guardar');
      const form = el('form', { class: 'card form', onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        const r = await Api.post('/casa/guardar', {
          nombre: c.nombre.input.value, marca: c.marca.input.value, categoria: c.categoria.input.value,
          presentacion: c.present.input.value, codigo_barras: c.codigo.input.value, cantidad: Number(c.cant.input.value), lectura,
        });
        btn.disabled = false;
        if (r.ok) { st.msg = ''; await cargar(); }
        else err.textContent = r.offline ? 'Sin conexión: no se guardó.' : (r.error || 'No se pudo guardar');
      } },
        porIa ? el('p', { class: 'nota' }, 'La IA propone esto. Revisalo y corregí lo que haga falta antes de guardar.') : null,
        p.notas ? el('p', { class: 'nota' }, p.notas) : null,
        c.nombre.nodo, c.marca.nodo, c.categoria.nodo, c.present.nodo, c.codigo.nodo, c.cant.nodo, estado, nueva, err,
        el('div', { class: 'barra' }, btn, el('button', { class: 'btn btn-sec', type: 'button', onclick: lista }, 'Cancelar')),
        ...listasDatos());

      montar(cabecera('Nuevo artículo', lista), el('main', { class: 'contenido' }, form));
      c.nombre.input.focus();
    }

    // ---------- edición y borrado ----------
    function editar(a) {
      const c = crearCampos({ nombre: a.nombre, marca: a.marca, categoria: a.categoria, presentacion: a.presentacion, codigo_barras: a.codigo_barras },
        { stock: numero('f-stock', 'Stock actual', a.stock_actual), minimo: numero('f-min', 'Avisar cuando quede este stock o menos (0 = no avisar)', a.stock_minimo) });
      const err = el('p', { class: 'error', role: 'alert' });
      const nueva = el('p', { class: 'nota' });
      const nuevasAviso = avisoNuevas(c, nueva);
      c.marca.input.addEventListener('input', nuevasAviso);
      c.categoria.input.addEventListener('input', nuevasAviso);
      nuevasAviso();

      const btn = el('button', { class: 'btn', type: 'submit' }, 'Guardar cambios');
      const confirmacion = el('div', { class: 'card form', hidden: true },
        el('p', { class: 'grande' }, `¿Eliminar «${a.nombre}»?`),
        el('p', { class: 'sub' }, 'Deja de verse en el stock. El historial de movimientos se conserva.'),
        el('div', { class: 'barra' },
          el('button', { class: 'btn btn-peligro', type: 'button', onclick: async () => {
            const r = await Api.post('/casa/eliminar', { id: a.id });
            if (r.ok) { st.msg = ''; await cargar(); } else err.textContent = r.error || 'No se pudo eliminar';
          } }, 'Sí, eliminar'),
          el('button', { class: 'btn btn-sec', type: 'button', onclick: () => { confirmacion.hidden = true; } }, 'No')));

      const form = el('form', { class: 'card form', onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        const r = await Api.post('/casa/editar', {
          id: a.id, nombre: c.nombre.input.value, marca: c.marca.input.value, categoria: c.categoria.input.value,
          presentacion: c.present.input.value, codigo_barras: c.codigo.input.value,
          stock_actual: Number(c.stock.input.value), stock_minimo: Number(c.minimo.input.value),
        });
        btn.disabled = false;
        if (r.ok) { st.msg = ''; await cargar(); }
        else err.textContent = r.offline ? 'Sin conexión: no se guardó.' : (r.error || 'No se pudo guardar');
      } },
        c.nombre.nodo, c.marca.nodo, c.categoria.nodo, c.present.nodo, c.codigo.nodo, c.stock.nodo, c.minimo.nodo, nueva, err,
        el('div', { class: 'barra' }, btn, el('button', { class: 'btn btn-sec', type: 'button', onclick: lista }, 'Cancelar')),
        ...listasDatos());

      montar(cabecera('Editar artículo', lista), el('main', { class: 'contenido' }, form,
        el('div', { class: 'barra separado' }, el('button', { class: 'btn btn-peligro-sec', type: 'button', onclick: () => { confirmacion.hidden = false; } }, 'Eliminar artículo')),
        confirmacion));
    }

    lista();
    cargar();
  }

  return { stock };
})();
