# Novedades y actualización de la aplicación

## Para el usuario

1. Abre Ajustes. La versión instalada aparece junto a **Novedades** y **Buscar actualizaciones**.
2. **Novedades** permite consultar el historial en cualquier momento, incluso sin conexión.
3. Una versión publicada más reciente muestra sus mejoras y ofrece **Actualizar ahora** o **Más tarde**. Al posponerla puedes seguir trabajando; no se vuelve a ofrecer automáticamente esa misma versión. El botón de búsqueda permite recuperarla.
4. Al pulsar **Actualizar ahora**, la aplicación comprueba el guardado local y la activación del service worker antes de recargar. Si falla, permanece abierta y permite reintentar. Cierra/guarda las ediciones abiertas antes de actualizar.
5. Tras recargar se muestran las novedades que aún no habías visto. Cerrar ese diálogo las marca como vistas. Atrás cierra el diálogo mediante el gestor de navegación existente.

La primera instalación no muestra un aviso de actualización ni novedades pendientes. La búsqueda automática consulta como máximo cada 30 minutos mientras la página está visible, además de comprobar cuando un nuevo worker toma el control o vuelve la conexión. La búsqueda manual omite el intervalo. Sin conexión o con un catálogo inválido nunca se afirma que la app esté actualizada.

## Fuente de verdad y publicación

**js/modules/config/AppVersion.js** contiene `APP_VERSION`, `CHANGELOG` (más reciente primero) y funciones puras de comparación/decisión. No contiene DOM ni reloj. Usa versiones numéricas `X.Y.Z`, fechas `YYYY-MM-DD` y frases breves para usuarios. No incluyas datos personales en el catálogo.

Para cada entrega con cambios visibles:

1. Añade una entrada arriba del `CHANGELOG` y cambia `APP_VERSION` al mismo número. Conserva las entradas anteriores; si varios cambios pertenecen a una misma entrega, agrupa sus mejoras en una entrada.
2. Ejecuta `npm run build`. Genera app-release.json y el sitio empaquetado en dist/.
3. Ejecuta npm run sw:precache para incluir el grafo de nuevos módulos/estilos.
4. Ejecuta `npm test -- --maxWorkers=2` y `CHROMIUM_PATH=/usr/bin/chromium npm run test:app-updates`. Revisa y prepara los archivos fuente y generados. El hook sella automáticamente `CACHE_VERSION` y BuildInfo.js; no edites sus números a mano.
5. Revisa el PR y publica mediante el flujo habitual del repositorio. Cloudflare Pages debe publicar dist/ usando npm run build.

Config.APP_CONFIG.VERSION importa la versión canónica. La automatización de main solo sella el build/cache; ya no incrementa la versión visible sin añadir novedades.

## Transporte y almacenamiento

`app-release.json` es un archivo **generado**, con `version` y `changelog`. No se edita aparte. `node scripts/release-manifest.cjs --check` verifica que coincida exactamente con el módulo. El service worker precachea la copia base para uso offline; las consultas de actualización usan `?__incoming=<marca temporal>` y `cache: no-store`, y el worker las deja pasar a la red. El contenido se valida y se representa con `textContent`; no se descarga ni ejecuta un script entrante.

Las claves locales `sa:lastSeenVersion`, `deferredVersion` y `lastUpdateCheck` (con el mismo prefijo) pertenecen a cada dispositivo. No alteran empleados, nóminas, asistencia, respaldos ni datos compartidos. Una pestaña antigua no puede rebajar la versión marcada como vista por otra. Sin localStorage se conserva el funcionamiento de la aplicación, aunque los avisos podrían repetirse al volver a abrirla.

El service worker mantiene `skipWaiting()`/`clients.claim()`. `controllerchange` recuerda si ya había controlador para distinguir instalación y actualización. El cambio de controlador **no recarga** la página; solo la acción explícita del usuario lo hace. Los diálogos automáticos esperan a que no haya otro diálogo ni una edición activa. Una consulta en curso se comparte entre disparadores para evitar peticiones duplicadas.

## Verificación

Las pruebas cubren comparación numérica (1.10.0 > 1.9.0), primer arranque, novedades acumuladas, posponer/reabrir, catálogo inválido, intervalo y concurrencia, fallos de guardado y cancelación mientras se guarda. La prueba de navegador publica dos versiones locales con el worker real, comprueba recarga voluntaria, Atrás y límites de pantalla. La prueba también comprueba WCAG A/AA del diálogo en cuatro anchos.
