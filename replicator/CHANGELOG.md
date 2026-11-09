# Cambios

## 0.2.0

- La clave de IA se carga desde el panel de Replicator (Mi perfil → Servicio de IA), oculta y guardada solo en el Home Assistant del cliente. Ya no está en la configuración del complemento.
- La pantalla muestra el código de la instalación, para pedirle la clave a Orion.
- Si la IA no está activa, la pantalla principal lo avisa con un acceso directo para cargar la clave.

## 0.1.0

- Primera versión, basada en el módulo Casa de madoval: stock con foto, baja con foto, carga de compras, lista de compras, impuestos y servicios con calendario y feriados, gastos del hogar.
- Corre dentro de Home Assistant (Ingress) con el usuario de Home Assistant, sin login propio.
- Base SQLite en `/data`, incluida en los backups de Home Assistant.
- Avisos de vencimientos a los celulares por Home Assistant.
- Sin módulo Salud ni Google Calendar.
