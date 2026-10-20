# Novedades y actualización voluntaria

Fuente única de versión e historial en AppVersion: versión semántica, entradas de usuario y políticas puras de comparación/avisos/intervalo. Config consume esa versión; la publicación automática solo estampa el build y no inventa otra versión sin notas. Se genera app-release.json desde el módulo puro para consultar datos de la versión publicada sin ejecutar código entrante.

Primera instalación: establecer referencia sin aviso. Al abrir una versión posterior: mostrar todas las novedades no vistas cuando no haya un diálogo o edición pendiente. No retroceder la referencia si se abre una pestaña antigua. Cierre/atrás marca las novedades vistas; posponer actualización conserva las novedades pendientes y evita repetir ese aviso. Consulta manual siempre permite recuperar una versión pospuesta.

Comprobar publicación cada 30 minutos y al recuperar foco/red si corresponde; un solo check simultáneo, timeout, bypass explícito de caché y validación de datos. Controllerchange no recarga: primera toma de control no avisa. Actualizar ahora guarda datos locales antes de recargar, bloquea si hay cambios de formulario y falla sin recargar si no se puede guardar. Más tarde/cerrar/atrás mantiene la pantalla.

Reutilizar los modales y navegación existentes; controles táctiles, estilos de la app, sin dependencias runtime. Novedades y Buscar actualizaciones desde Ajustes y versión visible en barra lateral/Más/Ajustes. Conservar reparación manual de caché como fallback. Pruebas puras, controlador, guardado fallido, primera instalación, posponer, JSON fresco, atrás, offline y Chromium con dos versiones/varios temas; suite/build/precache y PR.
