/**
 * 🏷️ PositionsList — Card template + handlers for positions.
 *
 * Sprint 7b: handlers moved here from EmployeesUI.js. They no longer need
 * the `context` indirection — they import what they need directly.
 */

import icons from '../../ui/IconSystem.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData, enqueueCloudPositionDelete } from '../../services/PersistenceService.js';
import { Modal } from '../../components/Modal.js';
import { PositionModal } from '../../ui/modals/PositionModal.js';
import { hourlyToDaily } from '../payroll/SalaryConversion.js';

export function PositionCard(pos) {
    const ldr = pos.leaderId ? state.leaders.find(l => l.id === pos.leaderId) : null;
    const empCount = state.employees.filter(e => (e.positions || []).includes(pos.id) && e.active).length;
    const totalAssigned = state.employees.filter(e => (e.positions || []).includes(pos.id)).length;
    const canDelete = totalAssigned === 0 && !pos.active;
    const employeesInPosition = state.employees.filter(e => (e.positions || []).includes(pos.id) && e.active);

    // 💱 Equivalente por día junto a la tarifa por hora (la app guarda por hora).
    // Solo se muestra si la tarifa es un número válido > 0, para no mostrar $0/día.
    const hoursPerDay = state.settings?.regularHoursPerDay || 8;
    const rateNum = Number(pos.hourlyRate);
    const dailyHint = (Number.isFinite(rateNum) && rateNum > 0)
        ? ` <span style="color:#64748b;">= $${Math.round(hourlyToDaily(rateNum, hoursPerDay)).toLocaleString()}/día</span>`
        : '';

    return `
        <div class="employee-row" style="border-left: 4px solid ${pos.color}; ${!pos.active ? 'opacity: 0.6; border-color: #475569;' : ''}">
            <div class="employee-info" style="flex: 1;">
                <div class="employee-header">
                    <div class="employee-name" style="color: ${pos.color};">${escapeHTML(pos.name)}</div>
                    ${!pos.active ? '<span style="background: #475569; color: #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;">INACTIVA</span>' : ''}
                </div>
                <div class="employee-meta">
                    <div class="employee-meta-item">${icons.get('payroll')} Tarifa: $${pos.hourlyRate}/hr${dailyHint}</div>
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


// ─── Handlers ────────────────────────────────────────────────────────────────

export function togglePositionEmployees(positionId) {
    const elem = document.getElementById(`pos-employees-${positionId}`);
    if (elem) {
        elem.style.display = elem.style.display === 'none' ? 'block' : 'none';
    }
}

export function setPositionStatusFilter(filter) {
    stateManager.batchSetState(() => {
        state.positionStatusFilter = filter;
        if (!state.positionFilters) {
            state.positionFilters = { search: '', leaderId: 'all', status: 'active' };
        }
        state.positionFilters.status = filter;
    });
}

export function setPositionSearchFilter(value) {
    if (!state.positionFilters) {
        state.positionFilters = { search: '', leaderId: 'all', status: 'active' };
    }
    state.positionFilters.search = value;
    render();
}

export function setPositionLeaderFilter(leaderId) {
    stateManager.batchSetState(() => {
        if (!state.positionFilters) {
            state.positionFilters = { search: '', leaderId: 'all', status: 'active' };
        }
        state.positionFilters.leaderId = leaderId;
    });
}

export function setPositionSortBy(sortBy) {
    stateManager.batchSetState(() => {
        state.positionSortBy = sortBy;
    });
}

export function openPositionForm(positionId = null) {
    PositionModal.open(positionId);
}

export function togglePositionStatus(positionId) {
    const pos = state.positions.find(p => p.id === positionId);
    if (!pos) return;

    const action = pos.active ? 'desactivar' : 'activar';
    Modal.confirm({
        title: pos.active ? `${icons.get('x-circle')} Desactivar Posición` : `${icons.get('info')} Activar Posición`,
        message: `¿Estás seguro de ${action} la posición "${pos.name}"?`,
        confirmText: pos.active ? 'Sí, desactivar' : 'Sí, activar',
        cancelText: 'Cancelar',
        type: pos.active ? 'warning' : 'info',
        onConfirm: () => {
            pos.active = !pos.active;
            pos.updatedAt = Date.now();
            pos._isDirty = true;
            saveApplicationData();
            render();
        }
    });
}

/**
 * 🛡️ Clear all references to a position from the global state.
 * Prevents orphaned references in historical attendance and on employees.
 * Always call this BEFORE definitively deleting a position.
 *
 * @param {string} positionId — ID of the position to clean
 * @returns {number} count of references cleaned (used by tests/logging)
 */
export function cleanupPositionReferences(positionId) {
    let cleaned = 0;

    // 1. Clean on employees (positions array + positionSalaries map)
    state.employees.forEach(emp => {
        let empTouched = false;
        if (emp.positions && emp.positions.includes(positionId)) {
            emp.positions = emp.positions.filter(pid => pid !== positionId);
            cleaned++;
            empTouched = true;
        }
        if (emp.positionSalaries && emp.positionSalaries[positionId] !== undefined) {
            delete emp.positionSalaries[positionId];
            cleaned++;
            empTouched = true;
        }
        // Estampar SOLO los empleados realmente tocados: updatedAt para que el
        // cambio suba, y positionsUpdatedAt para que el borrado del puesto gane
        // el LWW fino de puestos (EmployeeMerge) y no resucite. Estampar de más
        // re-subiría a todos los empleados = bug de cuota.
        if (empTouched) {
            const now = Date.now();
            emp.updatedAt = now;
            emp.positionsUpdatedAt = now;
        }
    });

    // 2. Clean on historical attendance
    Object.values(state.attendance || {}).forEach(att => {
        if (att.selectedPosition === positionId) {
            att.selectedPosition = null;
            cleaned++;
        }
        if (att.positionHours && att.positionHours.length > 0) {
            const filtered = att.positionHours.filter(ph => ph.positionId !== positionId);
            if (filtered.length !== att.positionHours.length) {
                att.positionHours = filtered;
                cleaned++;
            }
        }
    });

    return cleaned;
}

export function deletePosition(positionId) {
    const pos = state.positions.find(p => p.id === positionId);
    if (!pos) return;

    if (pos.active) {
        Modal.confirm({
            title: `${icons.get('alert')} No se puede eliminar`,
            message: `La posición "${pos.name}" está activa. Desactívala primero para poder eliminarla.`,
            confirmText: 'Aceptar',
            cancelText: 'Cerrar',
            type: 'warning',
            onConfirm: () => {}
        });
        return;
    }

    const hasAssigned = state.employees.some(e => (e.positions || []).includes(pos.id));
    if (hasAssigned) {
        Modal.confirm({
            title: `${icons.get('alert')} No se puede eliminar`,
            message: `La posición "${pos.name}" tiene empleados asignados.`,
            confirmText: 'Aceptar',
            cancelText: 'Cerrar',
            type: 'warning',
            onConfirm: () => {}
        });
        return;
    }

    Modal.confirm({
        title: `${icons.get('delete')} Eliminar Posición`,
        message: `¿Seguro que deseas eliminar la posición "${pos.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        type: 'danger',
        onConfirm: () => {
            // 🛡️ Clear references in historical attendance BEFORE deleting
            // (prevents orphans flagged by validateDataIntegrity)
            const cleaned = cleanupPositionReferences(pos.id);
            if (cleaned > 0 && window.debug) {
                window.debug.log(`🛡️ Limpiadas ${cleaned} referencia(s) histórica(s) de "${pos.name}" antes de eliminar`);
            }

            state.positions = state.positions.filter(p => p.id !== pos.id);
            // 🗑️ Schema v3: borrar también el doc remoto en positions/{id}
            // (saveMany solo hace upsert; sin esto el live-sync lo resucita).
            enqueueCloudPositionDelete(pos.id);
            saveApplicationData();
            render();
        }
    });
}

// Deprecated — kept as a stub for backwards-compat with app.js's
// `window.savePosition = EmployeesUI.savePosition` assignment.
export function savePosition() {
    console.warn('savePosition is deprecated. Submit positions through PositionModal.');
}