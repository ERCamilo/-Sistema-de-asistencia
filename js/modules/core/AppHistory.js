/**
 * 🔙 AppHistory.js — Atrás/Adelante como app nativa (PWA standalone y navegador)
 *
 * Integra la History API con la navegación real de la app sin tocar cada modal:
 *
 *  - Vistas: la vista es `{ tab, sub }` (pestaña + subvista de Personal, Nómina o
 *    Ajustes). Tras cada render se compara con la entrada actual; si cambió por
 *    una acción del usuario se hace pushState (una sola entrada por cambio, nunca
 *    por render). Atrás/Adelante aplican la vista de la entrada con la misma
 *    función que usa la navegación (applyView → changeTab).
 *  - Capas: un diálogo, hoja o panel abierto (`[aria-modal="true"]`,
 *    `[role="dialog"]`, `.modal-overlay`) recibe su propia entrada. Atrás cierra
 *    primero la capa superior con su propio control de cierre (o Escape, que es
 *    la salida segura que ya ofrece cada diálogo). Si la capa se cierra desde la
 *    interfaz, su entrada se retira con history.back() sin reaplicar nada.
 *  - Vista inicial (solo PWA standalone): una entrada guardia evita salir con un
 *    Atrás accidental. El primer Atrás muestra «Pulsa Atrás otra vez para salir»;
 *    el segundo sale. La guardia se rearma solo tras una nueva interacción, así
 *    que nunca se atrapa al usuario.
 *
 * No cambia la URL (deep links y parámetros intactos) ni guarda nada en disco:
 * el estado vive en history.state, que el navegador conserva con recargas y
 * BFCache.
 *
 * Seguridad frente a la intervención de Chrome (entradas añadidas sin gesto se
 * saltan con Atrás): solo se hace pushState con activación de usuario vigente;
 * sin ella se reemplaza la entrada actual y la capa queda sin entrada propia.
 */

export const APP_HISTORY_VERSION = 1;
const STATE_KEY = 'saNav';

// Diálogos y paneles superpuestos. `.floating-card` es la ficha rápida del
// empleado; `[data-history-layer]` permite que otro panel participe.
export const LAYER_SELECTOR = '.modal-overlay, [aria-modal="true"], [role="dialog"], [role="alertdialog"], .floating-card, [data-history-layer="on"]';

// Controles de cierre seguros (sin efectos más allá de cerrar). Nunca «Cerrar
// sesión» ni «Cerrar periodo».
const CLOSE_SELECTOR = [
    '[data-history-close]',
    '[data-app-fn="close-modal"]',
    '[data-app-fn="close-employee-profile"]',
    '[data-app-fn="closeImportFullModal"]',
    '[data-app-fn="closeLoansSettingsModal"]',
    '[data-app-fn="closeLoansEmployeePicker"]',
    '[data-app-fn="pcCloseReceiptSourcePicker"]',
    '[data-app-fn="closeWeatherPanel"]',
    '[data-app-fn="closeNotesCenter"]',
    '[data-app-fn="closeNoteModal"]',
    '[data-app-fn="closeExportMenu"]',
    '[data-employee-photo-action="cancel"]',
    'button[aria-label="Cerrar"]',
    'button[aria-label^="Cerrar "]:not([aria-label^="Cerrar sesión"])',
    '.modal-close'
].join(', ');

const TRAVERSAL_TIMEOUT_MS = 800;
const APPLY_TIMEOUT_MS = 3000;
export const EXIT_HINT_MS = 2500;

function sameView(a, b) {
    return !!a && !!b && a.tab === b.tab && (a.sub || null) === (b.sub || null);
}

function cleanView(view) {
    return { tab: view?.tab ? String(view.tab) : null, sub: view?.sub ? String(view.sub) : null };
}

export function createAppHistory({
    win = globalThis.window,
    doc = globalThis.document,
    getView,
    applyView,
    isStandalone = () => false,
    onExitHint = () => {},
    now = () => Date.now()
} = {}) {
    const history = win.history;
    let current = null;               // estado saNav de la entrada actual
    let started = false;
    let pendingTraversals = 0;        // popstates provocados por nosotros
    let traversalTimer = null;
    let applyingPop = false;
    let handlingLayerPop = false;
    // Vista pedida por Atrás/Adelante que la app aplica de forma asíncrona
    // (changeTab usa setTimeout): hasta verla, sync no registra nada.
    let awaitedView = null;
    let awaitedUntil = 0;
    let guardNeeded = false;
    let exitHintUntil = 0;
    let observer = null;
    let syncQueued = false;
    // Si una capa obligatoria ignora el cierre, no recrear su entrada al
    // retroceder: otro Atrás debe avanzar a la vista anterior.
    const unclosableLayers = new Set();
    const listeners = [];

    const listen = (target, type, fn, options) => {
        target.addEventListener(type, fn, options);
        listeners.push(() => target.removeEventListener(type, fn, options));
    };

    function hasActivation() {
        const activation = win.navigator?.userActivation;
        return activation ? activation.isActive === true : true;
    }

    function entry(kind, view, idx, depth) {
        return { v: APP_HISTORY_VERSION, kind, idx, depth, view: cleanView(view) };
    }

    function write(method, state) {
        const merged = { ...(history.state && typeof history.state === 'object' ? history.state : {}), [STATE_KEY]: state };
        if (method === 'push') {
            // Nunca conservar datos de otra entrada en la nueva.
            history.pushState({ [STATE_KEY]: state }, '');
        } else {
            history.replaceState(merged, '');
        }
        current = state;
    }

    // ── capas ──────────────────────────────────────────────────────────────
    function isVisible(el) {
        if (!el?.isConnected || el.closest?.('[hidden]') || el.getAttribute('aria-hidden') === 'true') return false;
        if (el.dataset?.historyLayer === 'off') return false;
        // Contenido de un <details> cerrado (p. ej. filtros de Personal): no se pinta.
        if (el.closest?.('details:not([open])') && !el.matches?.('details, summary')) return false;
        const style = win.getComputedStyle ? win.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        // Con layout real, un elemento sin cajas no está en pantalla.
        const hasLayout = doc.documentElement?.getClientRects?.().length > 0;
        if (hasLayout && el.getClientRects().length === 0) return false;
        return true;
    }

    function zIndexOf(el) {
        let node = el;
        while (node && node !== doc.body) {
            const z = Number.parseInt(win.getComputedStyle?.(node)?.zIndex, 10);
            if (Number.isFinite(z)) return z;
            node = node.parentElement;
        }
        return 0;
    }

    // Un diálogo a uno o dos niveles de un overlay es su contenido (overlay >
    // role="dialog"); más adentro es una capa propia (p. ej. la hoja de foto
    // dentro del perfil).
    function isContentOf(outer, inner) {
        return inner.parentElement === outer || inner.parentElement?.parentElement === outer;
    }

    /** Capas abiertas, de abajo arriba. */
    function openLayers() {
        const all = [...doc.querySelectorAll(LAYER_SELECTOR)].filter(isVisible);
        const layers = all.filter(el => !all.some(other => other !== el && other.contains(el) && isContentOf(other, el)));
        const info = layers.map((el, order) => {
            const ancestors = layers.filter(other => other !== el && other.contains(el));
            const root = ancestors.reduce((outer, other) => (other.contains(outer) ? other : outer), el);
            return { el, order, depth: ancestors.length, rootZ: zIndexOf(root), rootOrder: layers.indexOf(root) };
        });
        // Entre capas independientes manda el z-index; dentro de la misma, la
        // anidada siempre está encima de la que la contiene.
        return info
            .sort((a, b) => (a.rootZ - b.rootZ) || (a.rootOrder - b.rootOrder) || (a.depth - b.depth) || (a.order - b.order))
            .map(item => item.el);
    }

    function closeLayer(layer) {
        if (typeof layer.saHistoryBack === 'function') {
            try { if (layer.saHistoryBack() === true) return 'stepped'; } catch (_) { /* cerrar abajo */ }
        }
        const closer = [...layer.querySelectorAll(CLOSE_SELECTOR)]
            .find(el => isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
        if (closer) {
            closer.click();
            return 'closed';
        }
        const target = layer.contains(doc.activeElement) ? doc.activeElement : layer;
        target.dispatchEvent(new win.KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
        }));
        return 'closed';
    }

    function nextFrame() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    // ── traversals propios ────────────────────────────────────────────────
    function traverse(delta) {
        if (!delta) return;
        pendingTraversals++;
        clearTimeout(traversalTimer);
        traversalTimer = setTimeout(() => { pendingTraversals = 0; }, TRAVERSAL_TIMEOUT_MS);
        history.go(delta);
    }

    // ── sincronización tras render / cambios del DOM ─────────────────────
    function sync() {
        syncQueued = false;
        if (!started || pendingTraversals > 0 || applyingPop || handlingLayerPop) return;
        if (awaitedView) {
            if (!sameView(cleanView(getView()), awaitedView) && now() < awaitedUntil) return;
            awaitedView = null;
        }
        const state = history.state?.[STATE_KEY];
        if (state && state.v === APP_HISTORY_VERSION) current = state;
        if (!current) return;

        for (const layer of unclosableLayers) {
            if (!isVisible(layer)) unclosableLayers.delete(layer);
        }
        const layers = openLayers().filter(layer => !unclosableLayers.has(layer));
        const depth = current.depth || 0;
        if (layers.length < depth) {
            // Se cerró una capa desde la interfaz: retirar sus entradas.
            traverse(layers.length - depth);
            return;
        }
        if (layers.length > depth && hasActivation()) {
            for (let d = depth + 1; d <= layers.length; d++) {
                write('push', entry('layer', current.view, current.idx + 1, d));
            }
            return;
        }

        const view = cleanView(getView());
        if (!view.tab || sameView(view, current.view)) return;
        if (depth === 0 && hasActivation()) {
            write('push', entry('view', view, current.idx + 1, 0));
        } else {
            // Cambio sin gesto (arranque, sincronización) o bajo una capa.
            write('replace', { ...current, view });
        }
    }

    function scheduleSync() {
        if (syncQueued) return;
        syncQueued = true;
        (win.queueMicrotask || (fn => Promise.resolve().then(fn)))(sync);
    }

    // ── Atrás / Adelante ─────────────────────────────────────────────────
    async function onPopState(event) {
        const target = event.state?.[STATE_KEY];
        if (pendingTraversals > 0) {
            pendingTraversals--;
            if (target) current = target;
            // Un cambio de vista hecho junto con el cierre (p. ej. un botón del
            // diálogo que navega) se registra ahora.
            if (pendingTraversals === 0) scheduleSync();
            return;
        }
        if (!target || target.v !== APP_HISTORY_VERSION) {
            // Entrada ajena (p. ej. un ancla #): adoptarla como vista actual.
            write('replace', entry('view', getView(), (current?.idx ?? -1) + 1, 0));
            return;
        }
        const from = current;
        const back = !from || target.idx < from.idx;

        if (back) {
            const layers = openLayers();
            if (layers.length) {
                const top = layers[layers.length - 1];
                handlingLayerPop = true;
                const result = closeLayer(top);
                const poppedLayerEntry = (from?.depth || 0) > (target.depth || 0);
                if (result === 'stepped') {
                    handlingLayerPop = false;
                    // Paso interno del diálogo: recuperar la entrada de la capa.
                    current = target;
                    traverse(1);
                    return;
                }
                await nextFrame();
                handlingLayerPop = false;
                if (!isVisible(top)) {
                    current = target;
                    // Capa sin entrada propia: la vista no cambia; se recupera la
                    // entrada que se acaba de dejar.
                    if (!poppedLayerEntry) traverse(1);
                    return;
                }
                // El diálogo no se deja cerrar (decisión obligatoria): no
                // recrear su entrada mientras siga abierto. Otro Atrás puede
                // recorrer las vistas y el usuario no queda atrapado.
                for (const layer of layers) {
                    if (layer === top || layer.contains(top) || top.contains(layer)) {
                        unclosableLayers.add(layer);
                    }
                }
            }
        } else if (target.kind === 'layer') {
            // Un diálogo cerrado no se reabre con Adelante.
            current = target;
            traverse(-1);
            return;
        }

        current = target;
        if (!sameView(target.view, cleanView(getView()))) {
            awaitedView = cleanView(target.view);
            awaitedUntil = now() + APPLY_TIMEOUT_MS;
            applyingPop = true;
            let accepted = true;
            try {
                accepted = (await applyView(target.view)) !== false;
            } finally {
                applyingPop = false;
            }
            if (!accepted) {
                // La vista actual no se puede dejar todavía (p. ej. cambios sin
                // guardar): volver a la entrada de la que se partió.
                awaitedView = null;
                current = from;
                traverse(back ? 1 : -1);
                return;
            }
        }
        if (back && target.idx === 0 && isStandalone()) {
            guardNeeded = true;
            exitHintUntil = now() + EXIT_HINT_MS;
            onExitHint();
        }
    }

    function armGuard() {
        if (!started || !isStandalone() || !guardNeeded || pendingTraversals > 0) return;
        if (!current || current.idx !== 0 || (current.depth || 0) !== 0 || !hasActivation()) return;
        guardNeeded = false;
        write('push', entry('guard', current.view, 1, 0));
    }

    function onUserActivation() {
        armGuard();
        scheduleSync();
    }

    function onPageShow(event) {
        if (!event.persisted) return;
        const state = history.state?.[STATE_KEY];
        if (state && state.v === APP_HISTORY_VERSION) current = state;
        pendingTraversals = 0;
    }

    function start() {
        if (started || !history || typeof history.replaceState !== 'function') return api;
        started = true;
        const existing = history.state?.[STATE_KEY];
        const view = cleanView(getView());
        if (existing && existing.v === APP_HISTORY_VERSION) {
            // Recarga o vuelta desde otra página: la entrada conserva su posición;
            // un diálogo no se reabre tras recargar.
            write('replace', { ...existing, kind: existing.kind === 'layer' ? 'view' : existing.kind, depth: 0,
                view: existing.view?.tab ? existing.view : view });
            if (existing.view?.tab && !sameView(existing.view, view)) {
                awaitedView = cleanView(existing.view);
                awaitedUntil = now() + APPLY_TIMEOUT_MS;
                applyingPop = true;
                Promise.resolve(applyView(existing.view)).finally(() => { applyingPop = false; });
            }
        } else {
            write('replace', entry('view', view, 0, 0));
        }
        guardNeeded = current.idx === 0;
        listen(win, 'popstate', onPopState);
        listen(win, 'pageshow', onPageShow);
        for (const type of ['click', 'keydown', 'touchend', 'pointerup']) listen(doc, type, onUserActivation, true);
        if (typeof win.MutationObserver === 'function' && doc.body) {
            observer = new win.MutationObserver(scheduleSync);
            observer.observe(doc.body, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'aria-modal', 'class', 'open']
            });
        }
        return api;
    }

    function stop() {
        observer?.disconnect();
        observer = null;
        listeners.splice(0).forEach(off => off());
        clearTimeout(traversalTimer);
        started = false;
    }

    const api = {
        start,
        stop,
        sync,
        scheduleSync,
        openLayers,
        get current() { return current ? { ...current, view: { ...current.view } } : null; },
        get exitHintActive() { return now() < exitHintUntil; }
    };
    return api;
}

export default { createAppHistory, LAYER_SELECTOR, APP_HISTORY_VERSION };
