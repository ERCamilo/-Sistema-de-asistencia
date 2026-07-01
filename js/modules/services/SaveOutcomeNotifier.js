/**
 * 💬 SaveOutcomeNotifier.js
 *
 * Hace HONESTO el toast de "guardado" SIN sacrificar feedback inmediato.
 *
 * Diseño en DOS FASES (un solo toast que se actualiza):
 *   1. Al confirmar el guardado LOCAL (instantáneo) → toast verde inmediato:
 *      "✅ {acción} · en este equipo (subiendo a la nube…)"
 *   2. Cuando la nube responde (el mirror tarda ~2s por su debounce):
 *      - OK     → el MISMO toast se actualiza: "✅ {acción} · guardado en la nube"
 *      - falla  → se vuelve AMARILLO: "⚠️ {acción} · solo en este equipo"
 *      - nunca responde (timeout) → amarillo también.
 *
 * Si no hay cuenta conectada, el verde "en este equipo" es final (no se
 * promete nube). Si ni lo local se guardó → ROJO inmediato.
 *
 * En ráfagas (marcar varios empleados seguidos) cada acción emite su toast
 * provisional al instante — el feedback nunca se pierde ni se retrasa — y la
 * confirmación de nube llega una sola vez al final.
 *
 * `decideSaveOutcome` es pura. `createSaveOutcomeNotifier` es la máquina de
 * estados (inyectable para test): emite {level, message, kind} donde kind es
 * 'provisional' | 'confirm' | 'final'. El singleton de abajo la cablea a la
 * UI real actualizando el MISMO toast (Notification.update).
 */

import { Notification as NotificationSystem } from '../components/Notification.js';

/**
 * Núcleo puro: dado el resultado FINAL, decide color y mensaje.
 * @param {{localOk:boolean, cloudConnected:boolean, cloudOk:boolean|null, label?:string|null}} p
 * @returns {{level:'success'|'warning'|'error', message:string}}
 */
export function decideSaveOutcome({ localOk, cloudConnected, cloudOk, label }) {
    // `label` opcional = nombre de la acción ("Adelanto guardado",
    // "Configuración guardada"). Si viene, se conserva en el mensaje para no
    // perder contexto; si no, mensaje genérico.
    const L = (typeof label === 'string' && label.trim()) ? label.trim() : null;

    // Nota: el componente Notification ya pinta un ícono según el tipo
    // (check/alert/x), así que NO repetimos el emoji en el texto.
    if (localOk !== true) {
        return {
            level: 'error',
            message: L
                ? `No se pudo guardar: ${L}`
                : 'No se pudo guardar. Revisa el almacenamiento de tu dispositivo.'
        };
    }
    if (cloudConnected !== true) {
        // Sin cuenta conectada: el guardado local es el modo esperado. No
        // prometemos la nube para no mentir.
        return {
            level: 'success',
            message: L ? `${L} · en este equipo` : 'Guardado en este equipo'
        };
    }
    if (cloudOk === true) {
        return {
            level: 'success',
            message: L ? `${L} · guardado en la nube` : 'Guardado en este equipo y en la nube'
        };
    }
    return {
        level: 'warning',
        message: L
            ? `${L} · solo en este equipo (aún no en la nube)`
            : 'Guardado solo en este equipo (aún no en la nube)'
    };
}

/** Mensaje de la fase 1 (local OK, nube en camino). */
function provisionalMessage(label) {
    const L = (typeof label === 'string' && label.trim()) ? label.trim() : null;
    return L
        ? `${L} · en este equipo (subiendo a la nube…)`
        : 'Guardado en este equipo (subiendo a la nube…)';
}

/**
 * Máquina de estados de dos fases.
 *
 * @param {{
 *   notify: (o:{level:string,message:string,kind:'provisional'|'confirm'|'final'}) => void,
 *   setTimer: (fn:Function, ms:number) => any,
 *   clearTimer: (handle:any) => void,
 *   cloudTimeoutMs?: number
 * }} deps
 *   cloudTimeoutMs por defecto 12s: el mirror tiene debounce de 2s que se
 *   REINICIA con cada guardado, así que en ráfagas la confirmación llega ~2-3s
 *   después de la última acción. 12s da margen sin dejar el provisional
 *   colgado para siempre cuando la nube no responde (p. ej. offline con el
 *   SDK bufferizando).
 */
export function createSaveOutcomeNotifier({ notify, setTimer, clearTimer, cloudTimeoutMs = 12000 }) {
    let pending = false;       // ¿hay un guardado anunciado esperando la nube?
    let timerHandle = null;
    let pendingLabel = null;   // etiqueta de la acción en espera (la última de la ráfaga)
    let retryHandler = null;   // U12: inyectado por el dueño del outbox (PersistenceService)

    function _clearTimer() {
        if (timerHandle != null) { clearTimer(timerHandle); timerHandle = null; }
    }

    function _resolveCloud(cloudOk) {
        _clearTimer();
        pending = false;
        const label = pendingLabel;
        pendingLabel = null;
        const outcome = decideSaveOutcome({ localOk: true, cloudConnected: true, cloudOk, label });
        // U12: el botón "Reintentar" sólo tiene sentido en un fallo de nube
        // (level 'warning' — local ya está a salvo) y sólo si alguien inyectó
        // un handler (PettyCash, p. ej., tiene su propia recuperación y no
        // setea uno — sin retry, sin botón).
        const retry = (!cloudOk && typeof retryHandler === 'function') ? retryHandler : null;
        notify({ ...outcome, kind: cloudOk ? 'confirm' : 'final', retry });
    }

    return {
        /**
         * Fase 0 — reconocimiento INSTANTÁNEO. Llamar en el momento de la
         * acción del usuario (antes del debounce y de la escritura local, que
         * puede tardar ~1s con estados grandes). Muestra "guardando…" — honesto
         * porque describe un proceso en curso, no un resultado.
         * @param {{label?:string}} p
         */
        recordSaveStarted({ label = null } = {}) {
            pendingLabel = (typeof label === 'string') ? label : null;
            // Timer de seguridad desde el inicio: si NADA responde (ni el
            // local), el spinner no se queda colgado para siempre.
            _clearTimer();
            timerHandle = setTimer(() => { _resolveCloud(false); }, cloudTimeoutMs);
            const L = pendingLabel;
            notify({
                level: 'info',
                kind: 'start',
                message: L ? `Guardando — ${L}…` : 'Guardando…'
            });
        },

        /**
         * Reporta el resultado del guardado local (fase 1 — siempre inmediata).
         * @param {{localOk:boolean, cloudExpected:boolean, label?:string}} p
         *   cloudExpected = ¿se intentó (o intentará) escribir a la nube?
         *   (false si no hay sesión, está pausado, es localOnly, o hay
         *   conflicto saliente pendiente de revisión del usuario).
         */
        recordLocalResult({ localOk, cloudExpected, label = null }) {
            const l = (typeof label === 'string') ? label : null;

            if (localOk !== true) {
                _clearTimer();
                pending = false;
                pendingLabel = null;
                notify({ ...decideSaveOutcome({ localOk: false, cloudConnected: !!cloudExpected, cloudOk: null, label: l }), kind: 'final' });
                return;
            }
            if (!cloudExpected) {
                _clearTimer();
                pending = false;
                pendingLabel = null;
                notify({ ...decideSaveOutcome({ localOk: true, cloudConnected: false, cloudOk: null, label: l }), kind: 'final' });
                return;
            }
            // Local OK + nube en camino: feedback INMEDIATO (provisional) y a
            // esperar la confirmación. En ráfagas, cada acción re-emite su
            // provisional y re-arma el timeout; la nube confirma una vez al final.
            pendingLabel = l;
            pending = true;
            _clearTimer();
            timerHandle = setTimer(() => { _resolveCloud(false); }, cloudTimeoutMs);
            notify({ level: 'success', message: provisionalMessage(l), kind: 'provisional' });
        },

        /**
         * Reporta el resultado de la escritura a la nube (fase 2). Se ignora si
         * no hay un guardado propio esperando (evita toasts por ecos de sync
         * entrante o flushes de fondo).
         * @param {boolean} ok
         */
        recordCloudResult(ok) {
            if (!pending) return;
            _resolveCloud(ok === true);
        },

        /**
         * U12: registra (o limpia con null) la función a invocar cuando el
         * usuario toque "Reintentar" en un toast de fallo de nube. Sólo el
         * dueño del outbox (PersistenceService, vía drainMainSyncOutbox)
         * debe setearlo — otros callers de este mismo singleton (PettyCash)
         * simplemente no llaman este método, y sus fallos no llevan botón.
         * @param {(() => void)|null} fn
         */
        setCloudRetryHandler(fn) {
            retryHandler = (typeof fn === 'function') ? fn : null;
        },

        /**
         * U12: re-arma `pending` para un reintento MANUAL. Sin esto,
         * recordCloudResult (llamado por el drenado del retry) se ignoraría —
         * el flag ya se había resuelto a false con el fallo original, y el
         * guard de arriba está pensado para descartar ecos de sync de fondo,
         * no un resultado que el usuario pidió explícitamente. No cambia el
         * toast visible: el de fallo (con su botón) sigue mostrándose hasta
         * que este segundo ciclo resuelva.
         */
        recordRetryStarted() {
            pending = true;
            _clearTimer();
            timerHandle = setTimer(() => { _resolveCloud(false); }, cloudTimeoutMs);
        }
    };
}

// ─── Singleton cableado a la UI real ─────────────────────────────────────────
// Mantiene la referencia al toast provisional para ACTUALIZARLO en sitio
// (Notification.update) en vez de apilar toasts.

let _toast = null;

function _toastAlive() {
    try {
        return !!(_toast && _toast.element &&
            Array.isArray(NotificationSystem.activeNotifications) &&
            NotificationSystem.activeNotifications.includes(_toast));
    } catch (_) { return false; }
}

const _notify = (o) => {
    try {
        if (o.kind === 'start') {
            // Fase 0: spinner instantáneo. Sticky — las fases siguientes (o el
            // timeout de seguridad de la máquina) siempre lo resuelven.
            if (_toastAlive()) {
                _toast.update({ type: 'loading', message: o.message, duration: 0 });
            } else {
                _toast = NotificationSystem.loading(o.message);
            }
            return;
        }
        if (o.kind === 'provisional') {
            // Fase 1: crear (o reciclar) el toast verde inmediato. Duración
            // larga: la confirmación de nube lo actualizará en ~2-3s.
            if (_toastAlive()) {
                _toast.update({ type: 'success', message: o.message, duration: 10000 });
            } else {
                _toast = NotificationSystem.success(o.message, 10000);
            }
            return;
        }
        if (o.kind === 'confirm') {
            // Fase 2 OK: actualizar el MISMO toast. Si ya se cerró, silencio
            // (sin noticias = todo bien; no apilamos un segundo toast).
            if (_toastAlive()) {
                _toast.update({ type: 'success', message: o.message });
            }
            _toast = null;
            return;
        }
        // kind 'final': verde local-only, amarillo de nube fallida, o rojo.
        // 🐛 Si el spinner de la fase 0 sigue vivo, lo ACTUALIZAMOS en sitio para
        // CUALQUIER nivel. Antes solo se actualizaba el caso 'warning'; el verde
        // (local-only / sin sesión) y el rojo caían al else, que creaba un toast
        // NUEVO y dejaba el spinner "Guardando…" colgado y sticky para siempre.
        const finalDur = o.level === 'warning' ? 8000 : o.level === 'error' ? 15000 : 4000;
        // U12: si hay retry, el botón re-arma pending (recordRetryStarted) antes
        // de invocar el handler — así la resolución del reintento (éxito o
        // fallo) llega de vuelta a este MISMO ciclo de notify/_notify.
        const actions = o.retry ? [{
            label: 'Reintentar', icon: 'refresh-cw', closeOnClick: false,
            onClick: () => {
                saveOutcomeNotifier.recordRetryStarted();
                try { o.retry(); } catch (_) { /* defensivo — drainMainSyncOutbox no debería rechazar */ }
            }
        }] : [];
        if (_toastAlive()) {
            _toast.update({ type: o.level, message: o.message, duration: finalDur, actions });
        } else {
            const fn = NotificationSystem[o.level] || NotificationSystem.info;
            _toast = fn(o.message, { duration: finalDur, actions });
        }
        // Con retry, CONSERVAMOS la referencia — el próximo notify (tras el
        // retry) necesita _toastAlive() para actualizar este MISMO toast, no
        // crear uno nuevo. Sin retry, nadie más lo va a tocar: soltar.
        if (!o.retry) _toast = null;
    } catch (e) {
        console.warn('⚠️ SaveOutcomeNotifier UI:', e);
    }
};

export const saveOutcomeNotifier = createSaveOutcomeNotifier({
    notify: _notify,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h)
});

export default saveOutcomeNotifier;
