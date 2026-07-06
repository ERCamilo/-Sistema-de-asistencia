/**
 * 🧪 SanitizeLoopBreakerTests (fix del bucle de sanitización, capa 2)
 *
 * Cortacircuito del guard post-sync de app.js ("validar tras aplicar datos
 * remotos y re-subir el estado limpio"). El diseño original asume que la
 * re-subida converge en pocas vueltas — pero el test de campo 2026-07-06
 * demostró que un bug (corrección sin estampar updatedAt) lo convierte en
 * un bucle infinito SILENCIOSO que quema la cuota de Firestore.
 *
 * La capa 1 (IntegrityFixStamps) arregla ESE bug. Esta capa 2 protege
 * contra el PRÓXIMO: si el guard corrige-y-resubi demasiadas rondas
 * seguidas sin converger, corta la re-subida y lo deja REGISTRADO (ruido
 * observable > bucle silencioso). Una ronda limpia (0 fixes) resetea.
 */

import { recordSanitizeRound, resetSanitizeLoopBreaker, SANITIZE_LOOP_LIMIT } from '../modules/services/SanitizeLoopBreaker.js';
import { getAllErrors, clearErrorLog } from '../modules/services/ErrorLog.js';

testRunner.addSuite("SanitizeLoopBreaker — corta la re-subida ante rondas repetidas", {

    "las primeras rondas con fixes permiten re-subir"() {
        resetSanitizeLoopBreaker();
        testRunner.assertEquals(recordSanitizeRound(2), true, 'ronda 1: re-subir');
        testRunner.assertEquals(recordSanitizeRound(2), true, 'ronda 2: re-subir');
    },

    "al alcanzar el límite de rondas consecutivas, corta la re-subida"() {
        resetSanitizeLoopBreaker();
        for (let i = 0; i < SANITIZE_LOOP_LIMIT; i++) recordSanitizeRound(2);
        testRunner.assertEquals(recordSanitizeRound(2), false,
            `tras ${SANITIZE_LOOP_LIMIT} rondas seguidas con fixes, la re-subida debe cortarse — el diseño de "converge en pocas vueltas" ya falló`);
    },

    "una ronda LIMPIA (0 fixes) resetea el contador"() {
        resetSanitizeLoopBreaker();
        for (let i = 0; i < SANITIZE_LOOP_LIMIT - 1; i++) recordSanitizeRound(2);
        recordSanitizeRound(0); // convergió
        testRunner.assertEquals(recordSanitizeRound(1), true,
            'tras converger, un fix nuevo legítimo arranca el conteo de cero');
    },

    "una ronda con 0 fixes siempre devuelve false (no hay nada que re-subir)"() {
        resetSanitizeLoopBreaker();
        testRunner.assertEquals(recordSanitizeRound(0), false);
    },

    "al disparar el corte, registra el incidente en el ErrorLog (una sola vez por episodio)"() {
        resetSanitizeLoopBreaker();
        clearErrorLog();
        for (let i = 0; i <= SANITIZE_LOOP_LIMIT + 3; i++) recordSanitizeRound(2);
        const entries = getAllErrors().filter(e => /bucle de sanitizaci/i.test(e.message));
        testRunner.assertEquals(entries.length, 1,
            'debe quedar UNA entrada en el log por episodio (evidencia exportable), no una por ronda');
        clearErrorLog();
    },

    "tras converger y volver a atascarse, el nuevo episodio se registra de nuevo"() {
        resetSanitizeLoopBreaker();
        clearErrorLog();
        for (let i = 0; i <= SANITIZE_LOOP_LIMIT; i++) recordSanitizeRound(2); // episodio 1
        recordSanitizeRound(0); // converge
        for (let i = 0; i <= SANITIZE_LOOP_LIMIT; i++) recordSanitizeRound(2); // episodio 2
        const entries = getAllErrors().filter(e => /bucle de sanitizaci/i.test(e.message));
        testRunner.assertEquals(entries.length, 2);
        clearErrorLog();
    },

    "valores no-finitos se tratan como 0 (defensivo)"() {
        resetSanitizeLoopBreaker();
        testRunner.assertEquals(recordSanitizeRound(Number.NaN), false);
        testRunner.assertEquals(recordSanitizeRound(undefined), false);
    }

});

console.log('🧪 SanitizeLoopBreaker tests cargados.');
