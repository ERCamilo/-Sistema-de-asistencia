/**
 * 🎨 MOTOR DE RENDERIZADO (Fase 3 - Modularización)
 * Este módulo contiene la lógica para actualizar el DOM de forma eficiente.
 */
import { state, renderOptimizer } from './AppState.js';
import { DOMDiff } from '../utils/DOMDiff.js';
import { perfMonitor } from './Performance.js';
import { eventBus } from './Events.js';

let rootComponent = null;

/**
 * ⚡ CONFIGURACIÓN: Establecer el componente raíz para evitar circularidad
 */
export function setRootComponent(component) {
    rootComponent = component;
}

/**
 * ⚡ UTILERÍA: Actualizar el offset del header para variables CSS
 *
 * Lee `header.offsetHeight` which forces a synchronous layout (style + layout
 * recalculation). When called from inside the render path, this caused
 * ~1.9s of forced reflow during initial load (Sprint 5 profiling).
 *
 * Now the function is still exported for manual calls, but `render()` no
 * longer invokes it. Instead, `setupHeaderHeightObserver()` (below) wires
 * up a one-time read + a debounced window-resize listener.
 */
export function updateHeaderOffset() {
    const header = document.querySelector('.header');
    if (header) {
        document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
    }
}

/**
 * 🪧 SETUP: Run once at boot. Reads the header height once, then re-reads
 * only when the window is resized (debounced 150ms). Prevents the per-render
 * forced reflow that ate ~1.9s of initial load time.
 *
 * Safe to call multiple times — guarded by `_headerObserverInstalled`.
 */
let _headerObserverInstalled = false;
export function setupHeaderHeightObserver() {
    if (_headerObserverInstalled || typeof window === 'undefined') return;
    _headerObserverInstalled = true;

    // Initial read after the first paint, so the .header element exists
    requestAnimationFrame(() => updateHeaderOffset());

    // Re-read on resize, debounced so a drag of the window edge does not
    // fire dozens of forced reflows.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => updateHeaderOffset(), 150);
    });

    // Also handle the case where the header itself changes size dynamically
    // (e.g. sync indicator appearing/disappearing). ResizeObserver is supported
    // by every browser the PWA targets.
    if (typeof ResizeObserver !== 'undefined') {
        const tryObserve = () => {
            const header = document.querySelector('.header');
            if (!header) {
                requestAnimationFrame(tryObserve);
                return;
            }
            const ro = new ResizeObserver(() => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => updateHeaderOffset(), 150);
            });
            ro.observe(header);
        };
        tryObserve();
    }
}

/**
 * True si el HTML generado tiene como elemento raíz un nodo cuyo id es zoneId; es
 * decir, el generador devuelve el PROPIO elemento de la zona (no sus hijos). En ese
 * caso hay que parchear el nodo en el lugar (patchSelf) en vez de sus hijos (apply).
 */
function rootIdEquals(html, zoneId) {
    if (typeof html !== 'string') return !!html && html.id === zoneId;
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild?.id === zoneId;
}

/**
 * Clase para gestionar el renderizado de zonas específicas (Render Selectivo)
 */
class RenderManager {
    constructor() {
        this.zones = new Map();
        this.renderCount = 0;
    }

    registerZone(zoneId, generator) {
        this.zones.set(zoneId, generator);
    }

    renderZone(zoneId, data) {
        const element = document.getElementById(zoneId);
        if (!element) return false;

        const generator = this.zones.get(zoneId);
        if (!generator) return false;

        try {
            perfMonitor.start(`renderZone:${zoneId}`);
            const html = typeof generator === 'function' ? generator(data) : generator;

            // ⚡ Fase 4 Paso 5: si el HTML generado tiene como raíz el PROPIO elemento de la
            // zona (su id coincide), parchear el nodo EN EL LUGAR con patchSelf. Usar apply
            // (semántica de contenedor: parchea los HIJOS) sobre un generador que devuelve
            // <div id="zoneId">… ANIDA un duplicado adentro. Si la raíz NO coincide, el
            // generador devuelve hijos → apply() es lo correcto.
            if (rootIdEquals(html, zoneId)) {
                DOMDiff.patchSelf(element, html);
            } else {
                DOMDiff.apply(element, html);
            }

            this.renderCount++;
            perfMonitor.end(`renderZone:${zoneId}`);
            return true;
        } catch (error) {
            console.error(`❌ Error rendering zone ${zoneId}:`, error);
            return false;
        }
    }

    renderZones(zones) {
        const results = {};
        for (const [zoneId, data] of Object.entries(zones)) {
            results[zoneId] = this.renderZone(zoneId, data);
        }
        return results;
    }
}

export const renderManager = new RenderManager();
export const renderZone = (zoneId, data) => renderManager.renderZone(zoneId, data);

/**
 * ⚡ FUNCIÓN DE RENDERIZADO PRINCIPAL
 * Utiliza DOMDiff para actualizar solo lo necesario del árbol DOM.
 */
export function render() {
    renderOptimizer.scheduleRender(() => {
        perfMonitor.start('render');

        // Preservar foco
        const activeEl = document.activeElement;
        const isSearchActive = activeEl && activeEl.classList?.contains('employee-search-input');
        const searchCursorPos = isSearchActive ? activeEl.selectionStart : null;
        const searchValue = isSearchActive ? activeEl.value : null;

        saveScrollPosition();

        // Actualizar clases del body según el estado
        document.body.classList.toggle('sidebar-collapsed', !!state.settings.sidebarCollapsed);
        document.body.classList.toggle('has-sidebar', !state.settings.legacyNavigation);
        document.body.classList.toggle('bottom-nav-hidden', !!state.bottomNavHidden);
        if (state.settings.legacyNavigation) {
            document.body.classList.remove('sidebar-collapsed');
        }

        // 🛡️ HEALTH CHECK: Evaluar estado del sistema antes de inyectar HTML de la UI
        if (window._systemAlerts) {
            window._systemAlerts.checkHealth();
        }

        // Aplicar cambios al DOM
        const root = document.getElementById('root');
        if (root) {
            const newHTML = rootComponent ? rootComponent() : '<div class="empty-state">⚠️ Error: Componente raíz no cargado</div>';
            DOMDiff.apply(root, newHTML);
        }

        if (typeof window.clarifyDefaultHoursControl === 'function') {
            window.clarifyDefaultHoursControl();
        }
        // ⚡ updateHeaderOffset() removed from the render path — it was forcing
        // a synchronous layout (~1.9s during initial load per Sprint 5 profile).
        // The header offset is now seeded once on boot and re-read on window
        // resize via setupHeaderHeightObserver().

        // Restaurar foco del buscador
        if (isSearchActive) {
            requestAnimationFrame(() => {
                const input = document.querySelector('.employee-search-input');
                if (input) {
                    input.focus();
                    if (searchValue !== null && input.value !== searchValue) {
                        input.value = searchValue;
                    }
                    const pos = searchCursorPos !== null ? searchCursorPos : input.value.length;
                    if (input.setSelectionRange) input.setSelectionRange(pos, pos);
                }
            });
        }

        restoreScrollPosition();

        // 🛰️ Inicializar mini-mapa (ScrollService)
        requestAnimationFrame(() => {
            if (window.ScrollService) {
                window.ScrollService.init();
            }
        });

        // ⚡ P1-OPT: El guardado fue eliminado del ciclo de render.
        // saveApplicationData() se llama directamente en los handlers de mutación de datos
        // (handleWeekCheck, toggleHoliday, changeBaseHours, etc.) para evitar escrituras
        // innecesarias en IndexedDB con cada repintado de UI.

        eventBus.emit('render:complete', {
            timestamp: Date.now(),
            activeTab: state.activeTab
        });

        perfMonitor.end('render');
    });
}

/**
 * ⚡ UTILIDADES DE SCROLL
 *
 * Soporta dos mecanismos:
 *  1. Scroll de window (siempre se preserva)
 *  2. Scroll de cualquier contenedor con [data-preserve-scroll="<id>"]
 *     Esto permite preservar scroll en listas anidadas (empleados, asistencia, etc.)
 *     sin hardcodear selectores específicos.
 */
let _savedScrollPosition = { x: 0, y: 0 };
let _savedScrollContainers = {};

let _scrollListenersInstalled = false;
let _currentSnapshot = null;
let _snapshotCounter = 0;

function _onUserScroll(e) {
    if (!_currentSnapshot) return;

    let container = null;
    if (e.target && typeof e.target.closest === 'function') {
        container = e.target.closest('[data-preserve-scroll]') || e.target.closest('.week-table-container');
    }
    const containerId = container ? (container.dataset?.preserveScroll || '__weekTable') : null;

    let targetEntry;
    if (containerId) {
        targetEntry = _currentSnapshot.interactions.containers.get(containerId);
        if (!targetEntry) {
            targetEntry = { x: false, y: false };
            _currentSnapshot.interactions.containers.set(containerId, targetEntry);
        }
    } else {
        targetEntry = _currentSnapshot.interactions.window;
    }

    if (e.type === 'user-scroll-interaction') {
        const a = e.detail?.axis;
        if (a === 'x') {
            targetEntry.x = true;
            if (targetEntry.fromSyntheticWheel) targetEntry.y = false;
        } else if (a === 'y') {
            targetEntry.y = true;
            if (targetEntry.fromSyntheticWheel) targetEntry.x = false;
        } else {
            targetEntry.x = true;
            targetEntry.y = true;
        }
        delete targetEntry.fromSyntheticWheel;
    } else if (e.type === 'wheel') {
        const hasDeltaX = typeof e.deltaX === 'number' && e.deltaX !== 0;
        const hasDeltaY = typeof e.deltaY === 'number' && e.deltaY !== 0;
        if (hasDeltaX && !hasDeltaY) {
            targetEntry.x = true;
        } else if (hasDeltaY && !hasDeltaX) {
            targetEntry.y = true;
        } else if (hasDeltaX && hasDeltaY) {
            targetEntry.x = true;
            targetEntry.y = true;
        } else {
            // Synthetic wheel without deltas
            const a = e.detail?.axis || e.axis;
            if (a === 'x') {
                targetEntry.x = true;
            } else if (a === 'y') {
                targetEntry.y = true;
            } else {
                targetEntry.x = true;
                targetEntry.y = true;
                targetEntry.fromSyntheticWheel = true;
            }
        }
    } else if (e.type === 'touchmove') {
        targetEntry.x = true;
        targetEntry.y = true;
    }
}

function _ensureScrollListeners() {
    if (_scrollListenersInstalled || typeof window === 'undefined') return;
    _scrollListenersInstalled = true;
    window.addEventListener('wheel', _onUserScroll, { capture: true, passive: true });
    window.addEventListener('touchmove', _onUserScroll, { capture: true, passive: true });
    window.addEventListener('user-scroll-interaction', _onUserScroll, { capture: true });
}

if (typeof window !== 'undefined') {
    _ensureScrollListeners();
}

function _hasUserInteracted(snapshot, targetId, axis, el) {
    if (targetId === 'window') {
        const winInteracted = snapshot?.interactions?.window;
        if (winInteracted && (winInteracted.x || winInteracted.y)) {
            return !!winInteracted[axis];
        }
        if (typeof window !== 'undefined' && window.__userScrollInteracted) {
            return true;
        }
        return false;
    }

    const containerInteracted = snapshot?.interactions?.containers?.get(targetId);
    if (containerInteracted && (containerInteracted.x || containerInteracted.y)) {
        return !!containerInteracted[axis];
    }
    if (el && (el.dataset?.userInteracted === 'true' || el.__userScrollInteracted)) {
        return true;
    }
    return false;
}

export function saveScrollPosition() {
    _ensureScrollListeners();

    // Reset explicit interaction flags from prior cycles
    if (typeof window !== 'undefined' && window.__userScrollInteracted) {
        delete window.__userScrollInteracted;
    }
    if (typeof document !== 'undefined') {
        document.querySelectorAll('[data-user-interacted], [data-preserve-scroll], .week-table-container').forEach(el => {
            delete el.dataset.userInteracted;
            delete el.__userScrollInteracted;
        });
    }

    const windowPos = {
        x: typeof window !== 'undefined' ? (window.scrollX ?? window.pageXOffset ?? 0) : 0,
        y: typeof window !== 'undefined' ? (window.scrollY ?? window.pageYOffset ?? 0) : 0
    };
    _savedScrollPosition = windowPos;

    const containers = {};
    if (typeof document !== 'undefined') {
        const els = document.querySelectorAll('[data-preserve-scroll]');
        els.forEach(el => {
            const id = el.dataset.preserveScroll;
            if (id) {
                containers[id] = { x: el.scrollLeft ?? 0, y: el.scrollTop ?? 0 };
            }
        });

        const weekTable = document.querySelector('.week-table-container');
        if (weekTable && !weekTable.dataset.preserveScroll) {
            containers['__weekTable'] = { x: weekTable.scrollLeft ?? 0, y: weekTable.scrollTop ?? 0 };
        }
    }
    _savedScrollContainers = containers;

    _currentSnapshot = {
        id: ++_snapshotCounter,
        window: windowPos,
        containers,
        interactions: {
            window: { x: false, y: false },
            containers: new Map()
        }
    };
}

export function restoreScrollPosition() {
    _ensureScrollListeners();
    const snapshot = _currentSnapshot;
    if (!snapshot) return;

    requestAnimationFrame(() => {
        if (snapshot !== _currentSnapshot) return;

        const targetScroll = snapshot.window;
        const targetContainers = snapshot.containers;

        // Contenedores con data-preserve-scroll
        if (typeof document !== 'undefined') {
            Object.entries(targetContainers).forEach(([id, pos]) => {
                let el;
                if (id === '__weekTable') {
                    el = document.querySelector('.week-table-container');
                } else {
                    el = document.querySelector(`[data-preserve-scroll="${id}"]`);
                }
                if (!el) return;

                const currentX = el.scrollLeft ?? 0;
                const currentY = el.scrollTop ?? 0;

                const userX = _hasUserInteracted(snapshot, id, 'x', el);
                const userY = _hasUserInteracted(snapshot, id, 'y', el);

                if (pos.x > 0 && currentX < pos.x && !userX) {
                    el.scrollLeft = pos.x;
                }
                if (pos.y > 0 && currentY < pos.y && !userY) {
                    el.scrollTop = pos.y;
                }
            });
        }

        // Window scroll - desacoplar ejes y restaurar clamps sin pisar interacción real
        if (typeof window !== 'undefined' && targetScroll) {
            const currentX = window.scrollX ?? window.pageXOffset ?? 0;
            const currentY = window.scrollY ?? window.pageYOffset ?? 0;

            const userX = _hasUserInteracted(snapshot, 'window', 'x');
            const userY = _hasUserInteracted(snapshot, 'window', 'y');

            const shouldRestoreX = targetScroll.x > 0 && currentX < targetScroll.x && !userX;
            const shouldRestoreY = targetScroll.y > 0 && currentY < targetScroll.y && !userY;

            if (shouldRestoreX || shouldRestoreY) {
                const newX = shouldRestoreX ? targetScroll.x : currentX;
                const newY = shouldRestoreY ? targetScroll.y : currentY;
                window.scrollTo(newX, newY);
            }
        }
    });
}

// Inyectar en window para compatibilidad temporal legacy
window.render = render;
window.renderManager = renderManager;
window.saveScrollPosition = saveScrollPosition;
window.restoreScrollPosition = restoreScrollPosition;
window.eventBus = eventBus;
window.perfMonitor = perfMonitor;
