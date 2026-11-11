# Cambios

## 0.1.0

- Primera versión. Abre el sistema de gestión Orion del cliente desde el menú lateral de Home Assistant, sin pedir usuario ni clave.
- El sistema sigue en la web, independiente: el add-on pide un token de un solo uso a `/sso/nexus.php` con la API key de la instalación, y el sistema la valida contra Orion AR.
- Dos formas de abrirlo: dentro de Home Assistant (marco) o en una ventana nueva.
- Solo atiende pedidos que llegan por Ingress de Home Assistant. No guarda datos del sistema.
