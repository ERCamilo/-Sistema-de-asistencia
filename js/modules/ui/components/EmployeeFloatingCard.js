/**
 * 👤 EmployeeFloatingCard.js - Componente de Interfaz de Usuario
 * Renderiza la tarjeta flotante con estadísticas y calendario.
 */

import { state } from '../../core/AppState.js';
import { CalendarView } from './CalendarView.js';

export class EmployeeFloatingCard {
    constructor(statsService) {
        this.statsService = statsService;
    }

    /**
     * Renderiza el HTML de la tarjeta flotante.
     * @returns {string} HTML Template.
     */
    render() {
        if (!state.showFloatingCard || !state.floatingCardEmployee) return '';

        const data = this.statsService.getFloatingCardSummary(state.floatingCardEmployee.id);
        if (!data) return '';

        const { employee: emp, stats } = data;
        const { h7, hw, hm, hp, gross } = stats;

        const calendarHTML = CalendarView({
            employee: emp,
            month: state.floatingCardMonth,
            navAction: 'changeFloatingMonth',
            showLegend: false
        });

        // 🟢 NUEVO: Caching de botones o estilos para mayor limpieza
        const btnPerfilHTML = `
            <div style="padding: 16px; border-top: 1px solid #334155;">
                <button onclick="openEmployeeProfile('${emp.id}')" 
                        style="width: 100%; padding: 12px; background: linear-gradient(135deg, #06b6d4, #10b981); border: none; border-radius: 8px; color: #000; font-weight: 700; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;">
                    👤 Ver Perfil Completo
                </button>
            </div>`;

        const notesHTML = emp.notes && emp.notes.trim() ? `
            <div style="padding: 12px 16px; border-top: 1px solid #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(15, 23, 42, 0.5);" 
                 title="${emp.notes.replace(/"/g, '&quot;')}">
                <div style="color: #94a3b8; font-size: 0.8rem; display: flex; align-items: center; gap: 8px;">
                    <span>📝</span>
                    <span style="overflow: hidden; text-overflow: ellipsis;">${emp.notes}</span>
                </div>
            </div>` : '';

        return `
            <div class="overlay" onclick="closeFloatingCard()"></div>
            <div class="floating-card" onclick="event.stopPropagation()">
                <div class="floating-card-header">
                    <div class="floating-card-title">👤 ${emp.name}</div>
                    <button class="floating-card-close" onclick="closeFloatingCard()">✕</button>
                </div>
                
                <div class="stats-compact-grid">
                    <div class="stat-mini">
                        <div class="stat-mini-label">7 Días</div>
                        <div class="stat-mini-value">${h7}h</div>
                    </div>
                    <div class="stat-mini">
                        <div class="stat-mini-label">Semana</div>
                        <div class="stat-mini-value">${hw}h</div>
                    </div>
                    <div class="stat-mini">
                        <div class="stat-mini-label">Mes</div>
                        <div class="stat-mini-value">${hm}h</div>
                    </div>
                    <div class="stat-mini">
                        <div class="stat-mini-label">Periodo</div>
                        <div class="stat-mini-value">${hp}h</div>
                    </div>
                </div>

                <div class="earnings-highlight">
                    <div class="earnings-label">💰 Ganancias Brutas del Periodo</div>
                    <div class="earnings-value">$${gross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                ${calendarHTML}
                ${notesHTML}
                ${btnPerfilHTML}
            </div>`;
    }

    /**
     * Handlers Estáticos (puentes al estado)
     */
    static open(empId) {
        const emp = state.employees.find(e => e.id === empId);
        if (!emp) return;
        state.showFloatingCard = true;
        state.floatingCardEmployee = emp;
        state.floatingCardMonth = new Date();
        if (window.render) window.render();
    }

    static close() {
        state.showFloatingCard = false;
        state.floatingCardEmployee = null;
        if (window.render) window.render();
    }

    static changeMonth(delta) {
        const m = new Date(state.floatingCardMonth);
        m.setMonth(m.getMonth() + delta);
        state.floatingCardMonth = m;
        if (window.render) window.render();
    }
}
