# Orion Gestión

Abre el sistema de gestión Orion del cliente (ventas, compras, caja, facturación) desde el menú lateral de Home Assistant, sin pedir usuario ni clave.

El sistema **no se instala en Home Assistant**: sigue en la web, en su propio dominio, y funciona igual sin Nexus. Este complemento solo hace de puerta de entrada.

## Cómo funciona

1. La persona abre **Gestión** en el menú lateral de Home Assistant (también en la app del celular).
2. El complemento le pide al sistema de gestión un acceso de un solo uso, con la API key de esta instalación Nexus.
3. El sistema verifica la API key con Orion AR: que sea válida, que la instalación esté activa y que tenga Orion Gestión habilitado.
4. Si todo está bien, el sistema se abre con la sesión ya iniciada. El acceso vence a los 60 segundos y no se puede volver a usar.

La API key nunca llega al navegador: queda en la configuración del complemento.

## Configuración

| Opción | Para qué sirve |
| --- | --- |
| Dirección del sistema de gestión | La dirección web del sistema del cliente, por ejemplo `https://demo.orionar.cloud`. Tiene que empezar con `https://`. |
| API key de esta instalación | La API key de Nexus que entrega Orion. Se carga una sola vez y queda oculta. |
| Cómo se abre | `marco`: dentro de Home Assistant. `ventana`: en una ventana nueva del navegador. |

Después de cambiar la configuración, reiniciá el complemento.

## Si en el celular pide clave

Algunos celulares, sobre todo iPhone, no guardan la sesión de un sitio mostrado dentro de otro. Si el sistema pide clave dentro de Home Assistant:

- tocá **Abrir en ventana nueva**, arriba a la derecha, o
- cambiá **Cómo se abre** a `ventana`.

## Altas y bajas

| Caso | Qué pasa |
| --- | --- |
| El cliente da de baja Nexus pero sigue con el sistema | Orion desactiva la instalación. Este complemento deja de entrar y el cliente sigue usando el sistema por la web con su usuario y clave. |
| El cliente da de baja el sistema | El sistema se corta en la web y este complemento muestra que no tiene acceso. Nexus sigue funcionando. |
| Se cambia la API key | Cargá la nueva en la configuración y reiniciá el complemento. La anterior deja de funcionar. |

## Datos y privacidad

- El complemento no guarda datos del sistema de gestión: todo queda en el sistema web del cliente.
- Solo atiende pedidos que llegan por Home Assistant (Ingress). Abierto por fuera, rechaza el acceso.
- El sistema anota cada entrada con el nombre de la persona de Home Assistant que la abrió.

## Requisitos del sistema de gestión

El sistema web tiene que tener la entrada para Nexus (`/sso/nexus.php` y `/sso/entrar.php`), permitir mostrarse dentro de Home Assistant (`frame-ancestors`) y usar la cookie de sesión con `SameSite=None; Secure`. El nombre de la persona viaja en la cabecera `X-Nexus-User` codificado como URL (`rawurldecode` en PHP).
