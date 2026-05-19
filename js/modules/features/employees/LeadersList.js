/**
 * 🔑 LeadersList — Card template for one leader.
 *
 * Sprint 7 partial extraction. Template only; handlers stay in EmployeesUI.js
 * until a follow-up sprint moves them.
 */

import icons from '../../ui/IconSystem.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { state } from '../../core/AppState.js';

export function LeaderCard(ldr) {
    const positionsLedList = state.positions.filter(p => p.leaderId === ldr.id && p.active);
    const positionsLed = positionsLedList.length;
    const positionsSections = positionsLedList.map(pos => {
        const emps = state.employees
            .filter(e => e.active && (e.positions || []).includes(pos.id))
            .sort((a, b) => {
                const aNum = parseInt(a.number, 10);
                const bNum = parseInt(b.number, 10);
                if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
                return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
            });
        if (emps.length === 0) return '';
        return `
            <div style="margin-top: 8px;">
                <div style="font-size: 0.75rem; font-weight: 700; color: #e2e8f0; margin-bottom: 4px;">${escapeHTML(pos.name)}</div>
                ${emps.map(emp => `
                    <div style="display:flex; gap:8px; color:#f1f5f9; font-size:0.8rem; padding:2px 0;">
                        <span>${emp.number || ''}-</span>
                        <span role="button" tabindex="0" style="cursor: pointer; text-decoration: underline rgba(6, 182, 212, 0.2);" data-action="open-employee-floating" data-id="${emp.key || emp.id}">${escapeHTML(emp.name)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }).join('');

    const statusBadge = ldr.active
        ? '<span style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);"><span style="width: 6px; height: 6px; background: #fff; border-radius: 50%; animation: pulse 2s infinite;"></span>ACTIVO</span>'
        : '<span style="background: #475569; color: #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><span style="width: 6px; height: 6px; background: #64748b; border-radius: 50%;"></span>INACTIVO</span>';

    return `
        <div class="employee-row" style="${!ldr.active ? 'opacity: 0.6; border-color: #475569;' : ''}">
            <div class="employee-info" style="flex: 1;">
                <div class="employee-header">
                    <div class="employee-number" style="background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000;">${ldr.number}</div>
                    <div class="employee-name">${escapeHTML(ldr.name)}</div>
                    <span style="font-size: 1.25rem; margin-left: 8px;">${icons.get('key')}</span>
                    ${statusBadge}
                </div>
                <div class="employee-meta" style="margin-top: 8px;">
                      <div class="employee-meta-item">${icons.get('personnel')} Supervisa: ${positionsLed} posiciones</div>
                </div>
                ${positionsSections ? `
                    <div style="margin-top: 8px;">
                        <button class="view-btn" type="button" data-action="toggle-leader-employees" data-id="${ldr.id}" style="padding: 6px 12px; font-size: 0.75rem; width: 100%;">
                            ${icons.get('eye')} Ver Empleados
                        </button>
                        <div id="leader-employees-${ldr.id}" style="display: none; margin-top: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 8px;">
                            ${positionsSections}
                        </div>
                    </div>
                ` : ''}
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                 <button class="view-btn" type="button" data-action="open-leader-form" data-id="${ldr.id}" style="padding: 8px 16px; font-size: 0.875rem;" aria-label="Editar líder">${icons.get('edit')}</button>
                 <button class="view-btn ${ldr.active ? '' : 'active'}" type="button" data-action="toggle-leader-status" data-id="${ldr.id}" style="padding: 8px 16px; font-size: 0.875rem;" aria-label="${ldr.active ? 'Desactivar líder' : 'Activar líder'}">
                    ${ldr.active ? `${icons.get('pause')}` : `${icons.get('play')}`}
                </button>
            </div>
        </div>
    `;
}
