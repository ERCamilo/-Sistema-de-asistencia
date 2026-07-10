/**
 * 🔌 SanitizeLoopBreaker.js (fix del bucle de sanitización, capa 2)
 *
 * Cortacircuito del guard post-sync ("validar tras aplicar datos remotos y
 * re-subir el estado limpio", app.js). Ese guard asume convergencia en
 * pocas vueltas — el test de campo 2026-07-06 demostró que un bug
 * (corrección de integridad sin estampar updatedAt) lo convertía en un
 * bucle infinito SILENCIOSO entre dispositivos, quemando la cuota diaria
 * de Firestore.
 *
 * La capa 1 (estampar updatedAt en las correcciones, PersistenceService)
 * arregla ese bug concreto. Esta capa protege contra el PRÓXIMO de la
 * misma familia: si el guard corrige-y-resubi SANITIZE_LOOP_LIMIT rondas
 * seguidas sin converger, corta la re-subida y registra el incidente en
 * el ErrorLog (una vez por episodio — ruido observable y exportable, en
 * vez de un bucle mudo). Una ronda limpia (0 correcciones) resetea el
 * episodio: los datos convergieron y un fix futuro legítimo arranca de
 * cero.
 *
 * Estado en memoria a propósito: un F5 resetea el contador, y si el bucle
 * persiste, se vuelve a disparar a las N rondas — el corte no necesita
 * sobrevivir recargas para cumplir su función.
 */

import { logError } from './ErrorLog.js';

export const SANITIZE_LOOP_LIMIT = 5;

let _consecutiveFixRounds = 0;
let _trippedThisEpisode = false;

/**
 * Registrar una ronda del guard post-sync.
 * @param {*} fixes - correcciones que hizo validateDataIntegrity esta ronda
 * @returns {boolean} true si corresponde re-subir el estado corregido;
 *   false si no hay nada que subir (0 fixes) o si el episodio se cortó.
 */
export function recordSanitizeRound(fixes) {
    const n = Number.isFinite(fixes) ? fixes : 0;

    if (n <= 0) {
        _consecutiveFixRounds = 0;
        _trippedThisEpisode = false;
        return false; // nada corregido → nada que re-subir
    }

    _consecutiveFixRounds++;
    if (_consecutiveFixRounds <= SANITIZE_LOOP_LIMIT) return true;

    if (!_trippedThisEpisode) {
        _trippedThisEpisode = true;
        const msg = `Posible bucle de sanitización: ${_consecutiveFixRounds} rondas consecutivas de corregir-y-resubir sin converger (${n} correcciones en la última). Se corta la re-subida automática para proteger la cuota.`;
        console.warn(`🔌 SanitizeLoopBreaker: ${msg}`);
        logError(new Error(msg), 'guard post-sync de integridad');
    }
    return false;
}

/** Utilidad de test: reinicia el estado del episodio. */
export function resetSanitizeLoopBreaker() {
    _consecutiveFixRounds = 0;
    _trippedThisEpisode = false;
}

export default { recordSanitizeRound, resetSanitizeLoopBreaker, SANITIZE_LOOP_LIMIT };
