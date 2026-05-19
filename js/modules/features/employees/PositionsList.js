/**
 * 🏷️ PositionsList — Card template for one position.
 *
 * Sprint 7 partial extraction. Template only; the position handlers (open form,
 * toggle status, delete, cleanup references) stay in EmployeesUI.js until a
 * follow-up sprint moves them.
 */

import icons from '../../ui/IconSystem.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { state } from '../../core/AppState.js';

export function PositionCard(pos) {
    const ldr = pos.leaderId ? state.leaders.find(l => l.id === pos.leaderId) : null;
    const empCount = state.employees.filter(e => (e.positions || []).includes(pos.id) && e.active).length;
    const totalAssigned = state.employees.filter(e => (e.positions || []).includes(pos.id)).length;
    const canDelete = totalAssigned === 0 && !pos.active;
    const employeesInPosition = state.employees.filter(e => (e.positions || []).includes(pos.id) && e.active);

    return `
        <div class="employee-row" style="border-left: 4px solid ${pos.color}; ${!pos.active ? 'opacity: 0.6; border-color: #475569;' : ''}">
            <div class="employee-info" style="flex: 1;">
                <div class="employee-header">
                    <div class="employee-name" style="color: ${pos.color};">${escapeHTML(pos.name)}</div>
                    ${!pos.active ? '<span style="background: #475569; color: #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;">INACTIVA</span>' : ''}
                </div>
                <div class="employee-meta">
                    <div class="employee-meta-item">${icons.get('payroll')} Tarifa: $${pos.hourlyRate}/hr</div>
                    <div class="employee-meta-divider"></div>
                     <div class="employee-meta-item">${icons.get('personnel')} ${empCount} empleados</div>
                    ${ldr ? `<div class="employee-meta-divider"></div><div class="employee-meta-item">${icons.get('key')} ${escapeHTML(ldr.name)}</div>` : ''}
                </div>
                <div class="employee-meta" style="margin-top: 4px; font-size: 0.7rem;">
                    <div class="employee-meta-item" style="color: #64748b;">
                        ${icons.get('calendar')} Dias: ${pos.workingDays && pos.workingDays.length > 0 ? pos.workingDays.map(d => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d]).join(', ') : 'Todos'}
                    </div>
                </div>
                ${employeesInPosition.length > 0 ? `
                    <div style="margin-top: 8px;">
                        <button class="view-btn" type="button" data-action="toggle-position-employees" data-id="${pos.id}" style="padding: 6px 12px; font-size: 0.75rem; width: 100%;">
                            ${icons.get('eye')} Ver Empleados (${employeesInPosition.length})
                        </button>
                        <div id="pos-employees-${pos.id}" style="display: none; margin-top: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 8px;">
                            ${employeesInPosition.slice().sort((a, b) => {
        const aNum = parseInt(a.number, 10);
        const bNum = parseInt(b.number, 10);
        if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
        return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
    }).map((emp, idx) => {
        const customRate = emp.positionSalaries && emp.positionSalaries[pos.id] !== undefined
            ? Number(emp.positionSalaries[pos.id])
            : null;
        const baseRate = Number(pos.hourlyRate);
        const showCustomRate = customRate !== null && !Number.isNaN(customRate) && (Number.isNaN(baseRate) || customRate !== baseRate);

        const deductions = Array.isArray(emp.deductions) ? emp.deductions : [];
        let deductionText = '';
        if (deductions.length > 0) {
            let fixedTotal = 0;
            let percentTotal = 0;
            let hasFixed = false;
            let hasPercent = false;
            deductions.forEach(d => {
                if (d.type === 'fixed') {
                    fixedTotal += Number(d.value) || 0;
                    hasFixed = true;
                } else {
                    percentTotal += Number(d.value) || 0;
                    hasPercent = true;
                }
            });
            if (hasFixed && hasPercent) {
                deductionText = `-$${fixedTotal.toLocaleString()} + ${percentTotal}%`;
            } else if (hasFixed) {
                deductionText = `-$${fixedTotal.toLocaleString()}`;
            } else if (hasPercent) {
                deductionText = `-${percentTotal}%`;
            }
        }

        return `
                <div style="padding: 4px 0; color: #f1f5f9; ${idx < employeesInPosition.length - 1 ? 'border-bottom: 1px solid #334155;' : ''}">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <div style="min-width:40px; color:#94a3b8; font-weight:700;">${emp.number || ''}</div>
                        <div role="button" tabindex="0" style="flex:1; cursor: pointer; text-decoration: underline rgba(6, 182, 212, 0.2);" data-action="open-employee-floating" data-id="${emp.key || emp.id}">${escapeHTML(emp.name)}</div>
                        <div style="display:flex; align-items:center; gap:8px; justify-content:flex-end; min-width:140px;">
                            ${showCustomRate ? `<span style="color:#38bdf8; font-weight:700;">$${customRate}/hr</span>` : ''}
                            ${deductionText ? `<span style="color:#f87171; font-weight:700;">${deductionText}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
    }).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button class="view-btn" type="button" data-action="open-position-form" data-id="${pos.id}" style="padding: 8px;" aria-label="Editar posición">${icons.get('edit')}</button>
                <button class="view-btn ${pos.active ? '' : 'active'}" type="button" data-action="toggle-position-status" data-id="${pos.id}" style="padding: 8px;" aria-label="${pos.active ? 'Desactivar posición' : 'Activar posición'}">
                    ${pos.active ? `${icons.get('pause')}` : `${icons.get('play')}`}
                </button>

                ${pos.active ? "" :
            `<button class="view-btn" type="button" ${canDelete ? `data-action="delete-position" data-id="${pos.id}"` : 'disabled'} style="padding: 8px; ${canDelete ? '' : 'opacity: 0.4; cursor: not-allowed;'}" aria-label="${canDelete ? 'Eliminar posición' : 'No se puede eliminar: hay empleados asignados o la posición está activa'}">
                    ${icons.get('delete')}
                    </button>`}


            </div>
        </div>
    `;
}
