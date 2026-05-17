/**
 * 👤 EmployeeFloatingCard.js - Componente de Interfaz de Usuario
 * Renderiza la tarjeta flotante con estadísticas y calendario.
 */

import { state } from '../../core/AppState.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { CalendarView } from './CalendarView.js';

// ============================================
// 🎯 EVENT DELEGATION (data-fc-action)
// ============================================
const _FC_ACTION_MAP = {
    'open-employee-profile': (id) => window.openEmployeeProfile?.(id),
    'close-floating-card': () => window.closeFloatingCard?.(),
    'toggle-position': (_, el) => window.togglePosition?.(el.dataset.posId, el.dataset.empId),
    'stop-propagation': (_, _el, e) => { e?.stopPropagation(); }
};

function _handleFcClick(e) {
    const target = e.target.closest('[data-fc-action]');
    if (!target) return;
    const action = target.dataset.fcAction;
    const handler = _FC_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

let _fcDelegationAttached = false;
if (!_fcDelegationAttached) {
    document.addEventListener('click', _handleFcClick);
    _fcDelegationAttached = true;
}

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
                <button type="button" data-fc-action="open-employee-profile" data-id="${emp.id}"
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
            <div class="overlay" data-fc-action="close-floating-card"></div>
            <div class="floating-card" data-fc-action="stop-propagation">
                <div class="floating-card-header">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div class="floating-card-title">👤 ${emp.name}</div>
                        ${(() => {
                            if (!emp.positions || emp.positions.length <= 1) return '';
                            
                            const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
                            const att = state.attendance[key];
                            if (!att || !att.present) return '';

                            return `
                                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                                    ${emp.positions.map(pid => {
                                        const pos = state.positions.find(p => p.id === pid);
                                        if (!pos) return '';
                                        const isActive = att.selectedPosition === pid || (!att.selectedPosition && emp.positions[0] === pid);
                                        return `
                                            <span role="button" tabindex="0" data-fc-action="toggle-position" data-pos-id="${pid}" data-emp-id="${emp.id}"
                                                  style="font-size: 0.7rem; padding: 2px 8px; border-radius: 12px; cursor: pointer; border: 1px solid ${isActive ? '#ec4899' : '#334155'}; 
                                                         background: ${isActive ? 'rgba(236, 72, 153, 0.2)' : 'transparent'}; 
                                                         color: ${isActive ? '#f472b6' : '#94a3b8'}; transition: all 0.2s;">
                                                ${pos.name}
                                            </span>
                                        `;
                                    }).join('')}
                                </div>
                            `;
                        })()}
                    </div>
                    <button class="floating-card-close" type="button" data-fc-action="close-floating-card" aria-label="Cerrar">✕</button>
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
