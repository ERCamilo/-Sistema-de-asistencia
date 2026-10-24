# Validación del paquete independiente

Base: b6f40b021ad1b70d0d7aa8b300505cbdd4232277 (v1.7.108).

- Suite habitual: 665/665 suites y 6601/6601 tests PASS. Ningún archivo de qa/multiobra360 es descubierto por npm test.
- Política/workflows: 37/37 tests PASS con dobles GitHub; no se cerró/reabrió ningún issue durante las pruebas.
- Selección R1 probada: 25 pruebas locales y 8 recorridos de navegador; las regresiones conocidas siguen rojas.
- Selección R7 probada: 20 controles locales PASS, 4 tests SDK (2 PASS / 2 FAIL) y 6 recorridos (2 PASS / 4 FAIL). Total: 24 PASS / 6 FAIL, 0 problemas de infraestructura.
- La evidencia de R7 no permite el cierre por los fallos reales del producto, sin errores de conteo ni escenarios ausentes.
- Workflows sin disparador push/PR para regresiones; el job de producto solo tiene contents:read.

La automatización real de GitHub se activa después de fusionar el PR. El ciclo de cierre/API en Actions aún no se ha ejecutado, ya que la definición no está en la rama por defecto.

- Clasificación de releases: se reprodujo el rechazo incorrecto de archivos QA preparados; tras excluir qa/ del código de aplicación, 12/12 pruebas de ReleaseGuard pasan. No se omiten checks ni se modifica la versión del producto.
