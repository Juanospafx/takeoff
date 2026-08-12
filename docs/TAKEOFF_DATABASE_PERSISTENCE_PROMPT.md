# Prompt: persistencia compartida de Takeoff

Implementa persistencia multiusuario para el módulo Takeoff usando MySQL como única fuente de verdad. No uses cookies, `localStorage` ni `sessionStorage` para capas, elementos de conteo, líneas, áreas, escalas o cantidades.

Contexto:

- Un plano abierto por `pages/editor.php` utiliza `files.id` como `drawing_id`.
- La geometría existente se guarda mediante `api/takeoff.php` en `takeoff_layers`, `takeoff_count_markers`, `takeoff_linear_segments` y `takeoff_measurement_summaries`.
- Cada escala debe pertenecer a un archivo y una página específicos.
- Dos usuarios o una ventana incógnita deben cargar exactamente el mismo estado persistido.

Requisitos de base de datos:

1. Crear `takeoff_sheet_scales` con `id`, `project_id`, `drawing_id`, `page_number`, `scale_name`, `pixels_per_unit`, `unit`, `calibration_json`, auditoría de usuario y timestamps.
2. Agregar una restricción única para `(drawing_id, page_number)`.
3. Usar claves foráneas hacia `files(id)` y `projects(id)` con borrado en cascada.
4. Conservar identificadores estables `client_uid`/`integration_key` para que una recarga no duplique elementos.
5. Ejecutar escrituras de capas y geometría dentro de una transacción.

Requisitos del API:

- `GET action=state&drawing_id=...` devuelve capas, marcadores, segmentos, resumen y escalas.
- `GET action=scale&drawing_id=...&page_number=...` devuelve la calibración de esa hoja.
- `POST action=save_scale` hace upsert por archivo y página.
- `POST action=delete_scale` elimina únicamente la escala solicitada.
- Validar que el archivo pertenece al proyecto y rechazar IDs inválidos.
- Usar consultas preparadas y respuestas JSON consistentes.
- No ocultar errores de persistencia: mostrar un estado visible de error/reintento.

Requisitos del cliente:

- Al abrir el plano, cargar geometría y escala exclusivamente desde el API.
- Autosave con debounce después de crear, mover, redimensionar, editar o borrar un elemento.
- Guardar escalas preset y manuales inmediatamente en MySQL.
- Al cambiar de página, cargar la escala correspondiente y evitar que una respuesta atrasada sobrescriba la página activa.
- Eliminar cualquier fallback que compare timestamps con copias del navegador.
- Mantener solamente preferencias visuales no autoritativas en memoria; nunca geometría o cantidades.

Migración:

- No borrar automáticamente datos locales antiguos.
- Si se requiere rescatar datos, ofrecer una importación explícita y única hacia el servidor, con confirmación y deduplicación por `client_uid`.
- Una vez migrados, la base de datos debe ser la única autoridad.

Criterios de aceptación:

- Crear círculos y líneas en un navegador, esperar el autosave y abrir el mismo plano en incógnito: aparecen los mismos elementos.
- Definir una escala en la página 2 y abrir el plano con otro usuario: la misma escala se carga en la página 2, sin afectar la página 1.
- Borrar varios elementos, recargar y confirmar que continúan borrados.
- Cambiar tamaño, color, bloqueo o posición y confirmar que sobreviven a una recarga.
- Ninguna ruta de Takeoff lee o escribe geometría, capas o escalas en almacenamiento del navegador.
- Las pruebas automatizadas cubren API, esquema, ausencia de fallback local y aislamiento por archivo/página.

Entrega la migración SQL, cambios del API, cambios del cliente, pruebas automatizadas y pasos exactos de despliegue/rollback.
