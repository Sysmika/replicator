# Replicator

Stock, compras, vencimientos y gastos de la casa, dentro de Home Assistant.

- **Stock de mercadería:** sacás una foto del producto y la IA lo reconoce (nombre, marca, categoría, presentación). Se suma al stock con tu confirmación.
- **Dar de baja:** foto del producto antes de tirarlo y se descuenta.
- **Cargar compras:** una foto de varios productos sobre la mesada y se cargan todos juntos.
- **Lista de compras:** se arma sola con lo que quedó por debajo del mínimo, más lo que anotes a mano.
- **Impuestos y servicios:** vencimientos, pagos y calendario del mes con feriados. La factura también se puede cargar con foto.
- **Gastos del hogar:** resumen mensual por categoría; los tickets se cargan con foto.

El stock es **uno solo por casa**: todas las personas de la familia ven y modifican los mismos productos. Cada movimiento queda anotado con el usuario de Home Assistant que lo hizo.

## Cómo se abre

Después de instalarlo y arrancarlo aparece **Replicator** en el menú lateral de Home Assistant (también en la app del celular). No pide usuario ni clave: usa la persona que ya inició sesión en Home Assistant.

## Activar la IA

La IA (reconocimiento por foto) se activa desde el propio Replicator, no desde esta pantalla:

1. Abrí Replicator → tocá tu nombre arriba (Mi perfil) → **Servicio de IA**.
2. Copiá el **código de esta instalación** y pasáselo a Orion para pedir la clave.
3. Orion genera la clave para esa instalación. Pegala en el mismo lugar y tocá **Guardar clave**.

La clave queda guardada solo en este Home Assistant y la app nunca la vuelve a mostrar (solo sus últimos 4 caracteres). Se puede reemplazar o quitar desde la misma pantalla. Sin clave, todo se puede cargar a mano.

## Configuración del complemento

| Opción | Para qué sirve |
| --- | --- |
| Dirección del servicio de IA | Dejar la que viene, salvo indicación de Orion. |
| Avisos de vencimientos al celular | Cada día, a la hora elegida, manda un resumen de lo vencido o por vencer. |
| Hora del aviso | Formato HH:MM. |
| Celulares que reciben el aviso | Servicios `notify.mobile_app_...` de cada celular (Herramientas para desarrolladores → Acciones). |
| Sumar la lista de compras al aviso | Agrega cuántos productos faltan. |

## Datos y privacidad

- Todo se guarda en el propio Home Assistant (`/data/replicator.db`) y entra en los backups de Home Assistant.
- Las fotos se achican en el celular y se envían al servicio de IA de Orion solo para reconocerlas; no se guardan en Home Assistant.
- No maneja datos de salud ni se conecta a cuentas de Google.

## Cámara

La foto se saca con la cámara del celular desde la app de Home Assistant (Android o iOS) o desde el navegador. En la PC se abre el selector de archivos.
