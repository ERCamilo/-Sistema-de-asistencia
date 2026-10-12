# Ajustes: legibilidad, uso táctil y organización

Base inicial: `1dfa461b` de main, v1.7.66, con PR #250 integrado. Integrado posteriormente con `c4b87ae8` de main, v1.7.68; se conservan los nuevos diagnósticos de cámara y voz. Segunda entrega del plan de Ajustes: legibilidad/uso táctil y organización. Referencia visual: `design.md` (comunicación breve, tokens, selecciones sólidas y controles táctiles).

## Cambios

- Las cuatro pestañas muestran su nombre también en móvil. «Tests» se presenta como «Pruebas», conservando la clave interna `tests` y las acciones existentes. Los botones anuncian el estado seleccionado mediante `aria-pressed`.
- Pruebas separa «Funciones en prueba» de «Ayuda y diagnóstico». La guía real permanece visible. Las pruebas automáticas/simulación y las herramientas de desarrollo se despliegan desde dos secciones nativas. Sus controles permanecen en el DOM y conservan sus handlers e identificadores.
- Las secciones abiertas siguen abiertas después de una actualización reactiva. Los tiempos y la casilla de la simulación, que no son ajustes persistentes, conservan sus valores durante la actualización. Al salir de la pestaña se mantienen sus defaults de entrada.
- La explicación de proyectos usa lenguaje de trabajo; los textos de Datos hablan de respaldos y sincronización. Se mantienen las advertencias sobre restauración, eliminación de datos, conservación de audios y acciones reales de la guía.
- Los tokens se aplican localmente a Ajustes. Se aclaran textos atenuados, botones y selección de almacenamiento; las etiquetas de versiones usan relleno sólido con texto de alto contraste. El estilo de otras pantallas queda fuera de esta entrega.
- Los botones y desplegables de herramientas tienen áreas táctiles de al menos 44×44 px en los escenarios verificados. Las opciones de selección tienen al menos 44 px de altura. Las flechas del calendario usan SVG y áreas de 44×44 px.
- Con texto al 200 %, encabezados, etiquetas de campos, acciones y navegación permiten reflujo. El calendario conserva sus siete columnas y puede desplazarse horizontalmente dentro de su cuadrícula; no ensancha la página. Los estados de festivo/pago conservan su significado y mejoran el contraste de sus números.
- Los controles con `hidden` respetan ese estado dentro de Ajustes, aunque su clase defina `display:flex`; esto incluye el reintento de consulta de audios.

## Validación

- Node 20, dos workers dentro del límite de cuatro CPU del entorno: **5.821 pruebas / 608 suites aprobadas**.
- Cinco casos nuevos comprueban organización sin duplicación, estado de secciones ante parcheo real del DOM, ejecución de acciones existentes, claves/nombres de pestañas y conservación de valores temporales de diagnóstico.
- Chromium: General, Calendario, Datos y Pruebas a 1440/820/390/320 px. Se verifican campos etiquetados, controles dentro del panel, barra de borrador, navegación inferior y ausencia de botón genérico de guardado.
- Chromium adicional a 320 px con texto 100/200 % y todas las herramientas abiertas y clima, cámara, voz y nueva navegación activados: la página no desborda, las acciones mantienen sus dimensiones y los nombres de pestañas siguen visibles. Datos incluye versiones manuales/protegidas; Calendario incluye festivo y fecha de pago.
- `axe-core` 4.14.0 queda fijado como dependencia de desarrollo. La comprobación de contraste se ejecuta en el smoke test obligatorio de Settings; ninguno de los ocho escenarios de contraste arroja una infracción automática. El paquete solo se usa en el fixture y no forma parte del bundle publicado.
- La variante con funciones activadas detectó contraste insuficiente en «Ver/Ocultar» del clima (4,03:1); el botón ahora usa tokens de superficie y texto y supera la comprobación.
- Los lockfiles de npm y pnpm incluyen la herramienta de contraste, para evitar discrepancias de instalación entre CI y el proveedor.
- El fixture sigue ejecutando el handler real de guardado: error inline, render conservando el borrador, corrección y guardado. Build de producción, precache, guard de estado y diff aprobados.

## Límites

La comprobación automática conserva y muestra los casos `incomplete`: controles select nativos, algunos iconos/decoraciones y fechas fuera del área visible de la cuadrícula desplazable. No se presentan como aprobados ni como certificación integral de accesibilidad. La tipografía global, otros modales y las nuevas funciones de teclado quedan fuera de esta entrega.

Los fixtures usan cuentas/datos sintéticos, IndexedDB real y Firebase sustituido en su frontera de acceso; no verifican sincronización con cuentas reales ni el render de todos los navegadores móviles. Las capturas del fixture incluyen una navegación inferior de prueba, no la navegación completa de producción.
