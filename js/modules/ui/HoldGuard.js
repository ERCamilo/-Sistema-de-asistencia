/**
 * HoldGuard.js — Mantener pulsado un botón (micrófono) sin los gestos del
 * sistema.
 *
 * En Android, la pulsación larga del sistema corre en paralelo: como el botón
 * no se puede seleccionar, selecciona el texto vecino (las etiquetas de la
 * barra), muestra el menú de copiar y deja arrastrar lo seleccionado como un
 * "fantasma". Aquí se cancela eso solo mientras dura la pulsación.
 *
 * Probado en js/tests/HoldGuard.test.js.
 */

/** Clase en <html> mientras se mantiene pulsado (CSS: sin selección en toda la página). */
export const HOLD_CLASS = 'is-holding';

export function createHoldGuard({ doc = globalThis.document } = {}) {
    let active = false;
    const block = (event) => { if (active) event.preventDefault(); };
    const EVENTS = ['selectstart', 'dragstart', 'contextmenu'];
    return {
        start() {
            if (active || !doc) return;
            active = true;
            doc.documentElement?.classList.add(HOLD_CLASS);
            try { doc.getSelection?.()?.removeAllRanges(); } catch (_) { /* sin selección */ }
            EVENTS.forEach(type => doc.addEventListener(type, block, true));
        },
        end() {
            if (!active) return;
            active = false;
            doc.documentElement?.classList.remove(HOLD_CLASS);
            EVENTS.forEach(type => doc.removeEventListener(type, block, true));
        },
        isActive: () => active
    };
}

/**
 * Cancela el touchstart sobre `selector`: el sistema ya no inicia su
 * pulsación larga (selección, menú, arrastre, zoom). Los pointer events
 * siguen llegando, que es lo que usan los botones de micrófono.
 */
export function preventTouchDefaults(doc, selector) {
    const onTouch = (event) => { if (event.target?.closest?.(selector)) event.preventDefault(); };
    doc.addEventListener('touchstart', onTouch, { passive: false });
    return () => doc.removeEventListener('touchstart', onTouch, { passive: false });
}
