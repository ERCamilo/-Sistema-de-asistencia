# Corrección de versiones y novedades

Problema confirmado: cambios de runtime fusionados después del sistema de novedades conservaron la versión/catálogo anterior. Los tests de coherencia no comparaban la entrega con main. El diálogo rechaza correctamente versiones iguales y por eso no anuncia esas entregas.

Solución: nueva versión con notas que incluyen las mejoras omitidas; guard puro para exigir versión creciente y novedades propias, preservando historial; CLI que verifica fuente, generados y catálogo en snapshots Git. Pre-commit sobre índice preparado, pre-push sobre commits enviados y CI sobre head/base reales. La CI debe ejecutar también el navegador de actualizaciones de SA (ya se ejecutaba en Mini). Excluir documentos/tests y sellos automáticos del build de la obligación de subir versión. Sin recargas automáticas ni cambios al almacenamiento de negocio.

Verificación: negativos sin bump/sin notas/artefactos obsoletos, positivos de docs/build y entrega válida, índice parcial, pre-push, ramas concurrentes, snapshot enviado independiente del árbol de trabajo. Navegador por app con actualización detectada automáticamente, versión visible, novedades después de recarga y guardado previo.
