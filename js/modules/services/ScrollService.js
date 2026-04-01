/**
 * 🛰️ SCROLL SERVICE (Mini-mapa)
 * Maneja el renderizado de indicadores (ausencias/extras) en la barra de scroll.
 */
import { state } from '../core/AppState.js';
import { getDateKey } from '../utils/DateUtils.js';

export const ScrollService = {
    /**
     * Inicia los observadores de scroll para la visibilidad dinámica.
     */
    init() {
        const container = document.querySelector('.sticky-table-container');
        if (!container) return;

        // Evitar duplicar listeners si el contenedor ya los tiene
        if (container._hasScrollListener) return;

        let scrollTimeout;
        const onScroll = () => {
            const mode = state.settings.scrollbarMode || 'on-scroll';
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

        container.addEventListener('scroll', onScroll, { passive: true });
        container._hasScrollListener = true;
        
        // Disparar una vez para detectar estado inicial
        onScroll();
    },

    /**
     * Renderiza los puntos de color en el mini-mapa basado en la asistencia.
     * @param {Array} employees - Lista de empleados filtrados.
     */
    renderIndicators(employees) {
        const mode = state.settings?.scrollbarMode || 'on-scroll';
        if (mode === 'hidden') return '';

        const dateKey = getDateKey(state.selectedDate);
        console.log(`🛰️ ScrollService: Renderizando ${employees?.length || 0} indicadores (Modo: ${mode})`);
        
        // Generar contenedor
        return `<div class="scrollbar-indicator-container mode-${mode}" id="scroll-mini-map">
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
        
        employees.forEach((emp, index) => {
            const key = `${emp.id}-${dateKey}`;
            const att = state.attendance[key];
            const positionPercent = (index / total) * 100;
            
            if (att && att.present) {
                // Priority for indicators
                if (att.multiPosition) {
                    dotsHTML += `<div class="scroll-indicator multiposition" style="top: ${positionPercent}%;" title="Multi-posición: ${emp.name}"></div>`;
                }
                
                if (att.hoursWorked === 0) {
                    dotsHTML += `<div class="scroll-indicator absent" style="top: ${positionPercent}%;" title="Ausente: ${emp.name}"></div>`;
                } else if (att.overtimeHours > 0 || att.hoursWorked > (state.settings.regularHoursPerDay || 8)) {
                    dotsHTML += `<div class="scroll-indicator extra" style="top: ${positionPercent}%;" title="Extras: ${emp.name}"></div>`;
                } else if (att.isHoliday) {
                    dotsHTML += `<div class="scroll-indicator holiday" style="top: ${positionPercent}%;" title="Festivo: ${emp.name}"></div>`;
                }

                if (att.note || att.notes) {
                    dotsHTML += `<div class="scroll-indicator note" style="top: ${positionPercent}%; right: 8px;" title="Nota: ${emp.name}"></div>`;
                }
            } else if (emp.active !== false) {
                // Si está activo pero no tiene asistencia, se considera "PENDIENTE" en gris
                dotsHTML += `<div class="scroll-indicator pending" style="top: ${positionPercent}%;" title="Pendiente: ${emp.name}"></div>`;
            }
        });

        return dotsHTML;
    }
};
