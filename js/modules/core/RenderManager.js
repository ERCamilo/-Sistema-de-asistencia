/**
 * 🎨 MOTOR DE RENDERIZADO (Fase 3 - Modularización)
 * Este módulo contiene la lógica para actualizar el DOM de forma eficiente.
 */
console.log('🔍 DEBUG: RenderManager.js cargado');

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
 */
export function updateHeaderOffset() {
    const header = document.querySelector('.header');
    if (header) {
        document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
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
            element.innerHTML = html;
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

        // Aplicar cambios al DOM
        const root = document.getElementById('root');
        if (root) {
            const newHTML = rootComponent ? rootComponent() : '<div class="empty-state">⚠️ Error: Componente raíz no cargado</div>';
            DOMDiff.apply(root, newHTML);
        }

        updateHeaderOffset();

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
 */
export function saveScrollPosition() {
    const container = document.querySelector('.week-table-container');
    if (container) {
        state.scrollPosition = { x: container.scrollLeft, y: container.scrollTop };
    } else {
        state.scrollPosition = { x: window.scrollX, y: window.scrollY };
    }
}

export function restoreScrollPosition() {
    requestAnimationFrame(() => {
        const container = document.querySelector('.week-table-container');
        if (container && (state.scrollPosition.x > 0 || state.scrollPosition.y > 0)) {
            container.scrollLeft = state.scrollPosition.x;
            container.scrollTop = state.scrollPosition.y;
        } else if (state.scrollPosition.y > 0) {
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
