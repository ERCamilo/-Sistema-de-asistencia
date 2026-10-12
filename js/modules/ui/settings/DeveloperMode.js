/**
 * DeveloperMode.js — Modo desarrollador: muestra la pestaña Tests.
 *
 * Se activa (o se apaga) tocando 7 veces seguidas la versión al pie de
 * Configuración, como en Android. Se guarda solo en este teléfono
 * (localStorage): no viaja con la configuración sincronizada.
 *
 * Probado en js/tests/DeveloperMode.test.js.
 */

export const DEV_MODE_KEY = 'sa.devMode.v1';
export const DEV_MODE_TAPS = 7;
// Pausa máxima entre toques; más larga reinicia la cuenta.
export const DEV_MODE_TAP_GAP_MS = 1500;
// Desde cuántos toques restantes se avisa ("Faltan 3 toques…").
export const DEV_MODE_HINT_FROM = 4;

const safeStorage = () => {
    try { return globalThis.localStorage || null; } catch (_) { return null; }
};

export function isDeveloperMode(storage = safeStorage()) {
    try { return storage?.getItem(DEV_MODE_KEY) === '1'; } catch (_) { return false; }
}

export function setDeveloperMode(on, storage = safeStorage()) {
    try {
        if (on) storage?.setItem(DEV_MODE_KEY, '1');
        else storage?.removeItem(DEV_MODE_KEY);
    } catch (_) { /* modo privado: queda como estaba */ }
    return isDeveloperMode(storage);
}

/**
 * tap() devuelve:
 *   { state: 'counting', remaining, enabling } mientras se cuenta;
 *   { state: 'on' | 'off' } al llegar a 7 (ya guardado).
 */
export function createVersionTapper({ storage = safeStorage(), now = () => Date.now(), taps = DEV_MODE_TAPS, gapMs = DEV_MODE_TAP_GAP_MS } = {}) {
    let count = 0;
    let last = -Infinity;
    return {
        tap() {
            const t = now();
            count = t - last > gapMs ? 1 : count + 1;
            last = t;
            const enabling = !isDeveloperMode(storage);
            if (count < taps) return { state: 'counting', remaining: taps - count, enabling };
            count = 0;
            last = -Infinity;
            return { state: setDeveloperMode(enabling, storage) ? 'on' : 'off' };
        }
    };
}

export function versionTapMessage(result) {
    if (result.state === 'on') return { text: 'Modo desarrollador activado: la pestaña Tests ya está visible.', type: 'success' };
    if (result.state === 'off') return { text: 'Modo desarrollador desactivado: la pestaña Tests quedó oculta.', type: 'info' };
    if (result.remaining > DEV_MODE_HINT_FROM) return null;
    const n = result.remaining;
    return { text: `${n === 1 ? 'Falta 1 toque' : `Faltan ${n} toques`} para ${result.enabling ? 'activar' : 'desactivar'} el modo desarrollador.`, type: 'info' };
}
