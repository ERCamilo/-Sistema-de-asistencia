/**
 * 💬 SaveOutcomeNotifier.js
 *
 * Hace HONESTO el toast de "guardado". Antes aparecía un "✅ guardado
 * exitosamente" al hacer el cambio, aunque nada se hubiera persistido todavía
 * (el guardado local es asíncrono y la nube va con 2s de debounce).
 *
 * Ahora el toast refleja el resultado REAL combinando dos señales:
 *   - resultado LOCAL  → conocido al instante (IndexedDB await/throw)
 *   - resultado NUBE   → llega ~2s después (mirror) vía recordCloudResult()
 *
 * Colores:
 *   VERDE    local OK + nube OK            → "Guardado en este equipo y en la nube"
 *   VERDE    local OK + sin nube esperada  → "Guardado en este equipo"
 *   AMARILLO local OK + nube falló/timeout → "Guardado solo en este equipo (aún no en la nube)"
 *   ROJO     local falló                   → "No se pudo guardar"
 *
 * `decideSaveOutcome` es pura. `createSaveOutcomeNotifier` es la máquina de
 * estados (inyectable para test). Abajo se exporta un singleton cableado a la
 * UI real.
 */

import { Notification as NotificationSystem } from '../components/Notification.js';

/**
 * Núcleo puro: dado el resultado, decide color y mensaje.
 * @param {{localOk:boolean, cloudConnected:boolean, cloudOk:boolean|null}} p
 * @returns {{level:'success'|'warning'|'error', message:string}}
 */
export function decideSaveOutcome({ localOk, cloudConnected, cloudOk, label }) {
    // `label` opcional = nombre de la acción ("Adelanto guardado",
    // "Configuración guardada"). Si viene, se conserva en el mensaje para no
    // perder contexto; si no, mensaje genérico.
    const L = (typeof label === 'string' && label.trim()) ? label.trim() : null;

    if (localOk !== true) {
        return {
            level: 'error',
            message: L
                ? `❌ No se pudo guardar: ${L}`
                : '❌ No se pudo guardar. Revisa el almacenamiento de tu dispositivo.'
        };
    }
    if (cloudConnected !== true) {
        // Sin cuenta conectada: el guardado local es el modo esperado. No
        // prometemos la nube para no mentir.
        return {
            level: 'success',
            message: L ? `✅ ${L} · en este equipo` : '✅ Guardado en este equipo'
        };
    }
    if (cloudOk === true) {
        return {
            level: 'success',
            message: L ? `✅ ${L} · guardado en la nube` : '✅ Guardado en este equipo y en la nube'
        };
    }
    return {
        level: 'warning',
        message: L
            ? `⚠️ ${L} · solo en este equipo (aún no en la nube)`
            : '⚠️ Guardado solo en este equipo (aún no en la nube)'
    };
}

/**
 * Máquina de estados. Espera el resultado de la nube tras un guardado local
 * exitoso, con un timeout de respaldo, y emite UN solo toast por guardado
 * (colapsa ráfagas de cambios).
 *
 * @param {{
 *   notify: (o:{level:string,message:string}) => void,
 *   setTimer: (fn:Function, ms:number) => any,
 *   clearTimer: (handle:any) => void,
 *   cloudTimeoutMs?: number
 * }} deps
 */
export function createSaveOutcomeNotifier({ notify, setTimer, clearTimer, cloudTimeoutMs = 6000 }) {
    let pending = false;       // ¿hay un guardado local OK esperando la nube?
    let timerHandle = null;
    let pendingLabel = null;   // etiqueta de la acción en espera (opcional)

    function _clearTimer() {
        if (timerHandle != null) { clearTimer(timerHandle); timerHandle = null; }
    }

    function _resolveCloud(cloudOk) {
        _clearTimer();
        pending = false;
        const label = pendingLabel;
        pendingLabel = null;
        notify(decideSaveOutcome({ localOk: true, cloudConnected: true, cloudOk, label }));
    }

    return {
        /**
         * Reporta el resultado del guardado local.
         * @param {{localOk:boolean, cloudExpected:boolean, label?:string}} p
         *   cloudExpected = ¿se intentó (o intentará) escribir a la nube?
         *   (false si no hay sesión, está pausado, es localOnly, o hay
         *   conflicto saliente pendiente de revisión del usuario).
         *   label = nombre de la acción para el mensaje (opcional).
         */
        recordLocalResult({ localOk, cloudExpected, label = null }) {
            _clearTimer();
            pending = false;
            pendingLabel = (typeof label === 'string') ? label : null;

            if (localOk !== true) {
                const l = pendingLabel; pendingLabel = null;
                notify(decideSaveOutcome({ localOk: false, cloudConnected: !!cloudExpected, cloudOk: null, label: l }));
                return;
            }
            if (!cloudExpected) {
                const l = pendingLabel; pendingLabel = null;
                notify(decideSaveOutcome({ localOk: true, cloudConnected: false, cloudOk: null, label: l }));
                return;
            }
            // Local OK y la nube viene en camino: esperar su resultado, con
            // timeout de respaldo (si nunca llega → amarillo).
            pending = true;
            timerHandle = setTimer(() => { _resolveCloud(false); }, cloudTimeoutMs);
        },

        /**
         * Reporta el resultado de la escritura a la nube (mirror). Se ignora si
         * no hay un guardado propio esperando (evita toasts por ecos de sync
         * entrante).
         * @param {boolean} ok
         */
        recordCloudResult(ok) {
            if (!pending) return;
            _resolveCloud(ok === true);
        }
    };
}

// ─── Singleton cableado a la UI real ─────────────────────────────────────────

const _notify = (o) => {
    const fn = NotificationSystem[o.level] || NotificationSystem.info;
    fn(o.message);
};

export const saveOutcomeNotifier = createSaveOutcomeNotifier({
    notify: _notify,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h)
});

export default saveOutcomeNotifier;
