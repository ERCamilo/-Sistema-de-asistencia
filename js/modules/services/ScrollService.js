/**
 * 🛰️ SCROLL SERVICE (Mini-mapa)
 * Maneja el renderizado de indicadores (ausencias/extras) en la barra de scroll.
 */
import { state } from '../core/AppState.js';
import { getDateKey, isDayHoliday } from '../utils/DateUtils.js';

export const ScrollService = {
    /**
     * Inicia los observadores de scroll para la visibilidad dinámica.
     */
    init() {
        const container = document.querySelector('.sticky-table-container');
        // Si el contenedor no tiene scroll (VISTA DIARIA), escuchamos window
        const isPageScroll = container ? (window.getComputedStyle(container).overflow === 'visible') : true;
        const scrollTarget = isPageScroll ? window : container;

        if (!scrollTarget) return;

        // Evitar duplicar listeners
        if (scrollTarget._hasScrollListener) return;

        let scrollTimeout;
        const onScroll = () => {
            const mode = state.settings?.scrollbarMode || 'on-scroll';
            if (mode !== 'on-scroll') return;
            
            const indicatorContainer = document.querySelector('.scrollbar-indicator-container');
            if (indicatorContainer) {
                indicatorContainer.classList.add('scrolling');
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    indicatorContainer.classList.remove('scrolling');
                }, 1500);
            }
        };

        scrollTarget.addEventListener('scroll', onScroll, { passive: true });
        scrollTarget._hasScrollListener = true;
        
        // Disparar una vez para detectar estado inicial
        onScroll();
    },

    /**
     * Renderiza los puntos de color en el mini-mapa basado en la asistencia.
     * @param {Array} employees - Lista de empleados filtrados.
     * @param {Boolean} fixedMode - Si el mini-mapa debe ser fixed (para scroll de página).
     */
    renderIndicators(employees, fixedMode = false) {
        const mode = state.settings?.scrollbarMode || 'on-scroll';
        if (mode === 'hidden') return '';

        const dateKey = getDateKey(state.selectedDate);
        const displayModeClass = fixedMode ? 'mode-fixed' : `mode-${mode}`;

        // Generar contenedor
        return `<div class="scrollbar-indicator-container ${displayModeClass}" id="scroll-mini-map">
            ${this.getIndicatorDots(employees, dateKey)}
        </div>`;
    },

    /**
     * Genera los puntos HTML para el mini-mapa.
     */
    getIndicatorDots(employees, dateKey) {
        if (!employees || employees.length === 0) return '';
        
        let dotsHTML = '';
        const total = employees.length;
        const regular = state.settings?.regularHoursPerDay || 8;
        const tolerance = 0.1;
        const isH = isDayHoliday(state.selectedDate, state.settings?.holidays);
        
        employees.forEach((emp, index) => {
            const key = `${emp.id}-${dateKey}`;
            const att = state.attendance[key];
            const positionPercent = total > 1 ? (index / (total - 1)) * 96 + 2 : 50; 
            
            if (att && att.present) {
                const hours = att.hoursWorked || 0;
                const isExtra = hours > regular + tolerance;
                const isUndertime = hours < regular - tolerance;
                const isMulti = att.positionHours && att.positionHours.length > 1;
                const hasNote = att.note || att.notes;

                // 1. Indicador de Estado Base (Derecha)
                if (isH) {
                    dotsHTML += `<div class="scroll-indicator holiday" style="top: ${positionPercent}%;" title="Festivo: ${emp.name}"></div>`;
                } else if (isExtra) {
                    dotsHTML += `<div class="scroll-indicator extra" style="top: ${positionPercent}%;" title="Extras: ${emp.name}"></div>`;
                } else if (isUndertime) {
                    dotsHTML += `<div class="scroll-indicator absent" style="top: ${positionPercent}%;" title="Menos: ${emp.name}"></div>`;
                } else {
                    dotsHTML += `<div class="scroll-indicator regular" style="top: ${positionPercent}%;" title="Regular: ${emp.name}"></div>`;
                }

                // 2. Indicadores Especiales (Desplazados a la izquierda)
                if (isMulti) {
                    dotsHTML += `<div class="scroll-indicator multiposition" style="top: ${positionPercent}%; right: 10px;" title="Multi-posición: ${emp.name}"></div>`;
                }

                if (hasNote) {
                    dotsHTML += `<div class="scroll-indicator note" style="top: ${positionPercent}%; right: 18px;" title="Nota: ${emp.name}"></div>`;
                }
            } else if (emp.active !== false) {
                // PENDIENTE en gris
                dotsHTML += `<div class="scroll-indicator pending" style="top: ${positionPercent}%;" title="Pendiente: ${emp.name}"></div>`;
            }
        });

        return dotsHTML;
    }
};
