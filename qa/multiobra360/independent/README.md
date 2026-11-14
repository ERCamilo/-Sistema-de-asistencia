# Pruebas independientes de cierre — Multiobra #296–#302

Fecha: 2026-11-07. Base inicial: main v1.7.128, commit 92272bec.

Estas pruebas nuevas están separadas de las 103 comprobaciones Multiobra 360.
No cambian las aserciones existentes ni autorizan cierres automáticos.

## Ejecutar

Requiere dependencias Jest del proyecto; para Firestore se necesitan Java 21,
el emulador v1.22.0 y un node_modules con el SDK Firebase web.

    export MULTIOBRA_JAVA=/ruta/java21/bin/java
    export FIRESTORE_EMULATOR_JAR=/ruta/cloud-firestore-emulator-v1.22.0.jar
    export SA_EMULATOR_NODE_MODULES=/ruta/que-contiene/firebase
    node qa/multiobra360/independent/run.cjs --all

Opciones: --local (12 pruebas), --emulator (3), --all (15). El runner usa un
puerto dinámico en 127.0.0.1 y apaga el emulador al terminar. Su código de
salida es distinto de cero si cualquier prueba falla. No utiliza cuentas
ni datos productivos.

## Matriz de regresiones nuevas

| Issue | Casos | Qué comprueba |
| --- | ---: | --- |
| #296 / R1 | 2 | A -> B -> A con solicitud antigua pendiente; feature flag OFF durante lectura |
| #297 / R2 | 2 | Configuración local multicolumna más nueva; independencia identidad y nómina |
| #298 / R3 | 2 | Restauración marcada durante petición; marca malformada (fail-closed) |
| #299 / R4 | 2 | Refresh tardío; evento de configuración de otra obra |
| #300 / R5 | 2 | Dos toques +0.5 horas simultáneos; dos días con feriados intactos |
| #301 / R6 | 2 | Tres cambios fuera de orden; resolución tardía de obra por defecto |
| #302 / R7 | 3 | Transacciones concurrentes reales, tercer lector, lápida frente a copia con reloj adelantado |

## Diferencia importante para #302

Un test anterior retardaba el writeDoc inyectado, pero el servicio utiliza
runTransaction en Firestore real; por tanto ese retardo no garantizaba que
existiera una carrera dentro de la transacción. Esta prueba utiliza el
gancho afterTransactionGet del adaptador del SDK: pausa A después de su
lectura transaccional, guarda una versión posterior desde B, libera A y
verifica la nube y la descarga desde C. Además comprueba que la pausa
ocurrió realmente, para que no haya un falso PASS si el gancho no se usa.

## Resultado inicial

Sobre el SHA 92272bec: 12/12 locales PASS y 3/3 SDK/emulador PASS.
Sin fallos ni escrituras de datos reales.

## Límites

No certifica OAuth Google, reglas Firestore desplegadas, PWA integral,
dos teléfonos físicos, interrupciones de red reales ni backups de usuarios.
Tampoco sustituye los requisitos manuales de #296–#302: una prueba en verde
no basta para declarar que las issues están resueltas en producción.
La batería original sigue siendo obligatoria donde aplica y las nuevas
pruebas deben ejecutarse otra vez sobre el commit final.
