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
            
            // ⚡ P4-OPT: Usar DOMDiff para actualizaciones de zona (Evita parpadeo y es más rápido)
            DOMDiff.apply(element, html);
            
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
export function saveScrollPosition() {
    // Window scroll (siempre)
    state.scrollPosition = { x: window.scrollX, y: window.scrollY };

    // Contenedores opt-in con data-preserve-scroll
    const containers = document.querySelectorAll('[data-preserve-scroll]');
    state._scrollContainers = {};
    containers.forEach(el => {
        const id = el.dataset.preserveScroll;
        if (id) {
            state._scrollContainers[id] = { x: el.scrollLeft, y: el.scrollTop };
        }
    });

    // Compatibilidad: legacy .week-table-container también se preserva
    const weekTable = document.querySelector('.week-table-container');
    if (weekTable && !weekTable.dataset.preserveScroll) {
        state._scrollContainers['__weekTable'] = { x: weekTable.scrollLeft, y: weekTable.scrollTop };
    }
}

export function restoreScrollPosition() {
    requestAnimationFrame(() => {
        // Contenedores con data-preserve-scroll
        const saved = state._scrollContainers || {};
        Object.entries(saved).forEach(([id, pos]) => {
            let el;
            if (id === '__weekTable') {
                el = document.querySelector('.week-table-container');
            } else {
                el = document.querySelector(`[data-preserve-scroll="${id}"]`);
            }
            if (el && (pos.x > 0 || pos.y > 0)) {
                el.scrollLeft = pos.x;
                el.scrollTop = pos.y;
            }
        });

        // Window scroll
        if (state.scrollPosition && state.scrollPosition.y > 0) {
            window.scrollTo(state.scrollPosition.x, state.scrollPosition.y);
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
