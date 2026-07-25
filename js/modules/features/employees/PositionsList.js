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
import { saveApplicationData, enqueueCloudPositionDelete, ensureAllAttendanceHistory } from '../../services/PersistenceService.js';
import { Modal } from '../../components/Modal.js';
import { PositionModal } from '../../ui/modals/PositionModal.js';
import { hourlyToDaily } from '../payroll/SalaryConversion.js';
import { collectPositionDays } from '../../services/AttendancePositionAudit.js';
import {
    renderPositionIconSvg,
    renderPositionUiSvg,
    resolvePositionIcon,
    safePositionColor
} from './PositionVisuals.js';

let positionGridFrame = null;
let positionGridResizeBound = false;

export function layoutPositionCardGrid() {
    if (typeof document === 'undefined') return;
    const grid = document.querySelector('.position-card-grid');
    if (!grid) return;

    const styles = getComputedStyle(grid);
    const rowHeight = Number.parseFloat(styles.gridAutoRows) || 8;
    const rowGap = Number.parseFloat(styles.rowGap) || 12;
    grid.querySelectorAll('.position-card').forEach(card => {
        card.style.gridRowEnd = 'auto';
        const height = card.getBoundingClientRect().height;
        const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
        card.style.gridRowEnd = `span ${span}`;
    });
}

export function schedulePositionCardGridLayout() {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    if (!positionGridResizeBound) {
        window.addEventListener('resize', schedulePositionCardGridLayout, { passive: true });
        positionGridResizeBound = true;
    }
    if (positionGridFrame) cancelAnimationFrame(positionGridFrame);
    positionGridFrame = requestAnimationFrame(() => {
        positionGridFrame = null;
        layoutPositionCardGrid();
    });
}

export function PositionCard(pos) {
    const empCount = state.employees.filter(e => (e.positions || []).includes(pos.id) && e.active).length;
    const totalAssigned = state.employees.filter(e => (e.positions || []).includes(pos.id)).length;
    const canDelete = totalAssigned === 0 && !pos.active;
    const employeesInPosition = state.employees.filter(e => (e.positions || []).includes(pos.id) && e.active);
    const hoursPerDay = state.settings?.regularHoursPerDay || 8;
    const rateNum = Number(pos.hourlyRate);
    const hourlyRate = Number.isFinite(rateNum) ? rateNum : 0;
    const dailyRate = hourlyRate > 0 ? Math.round(hourlyToDaily(hourlyRate, hoursPerDay)) : 0;
    const color = safePositionColor(pos.color);
    const iconName = resolvePositionIcon(pos);
    const workingDays = Array.isArray(pos.workingDays) && pos.workingDays.length > 0
        ? pos.workingDays
        : [0, 1, 2, 3, 4, 5, 6];
    const employeeRows = employeesInPosition.slice().sort((a, b) => {
        const aNum = parseInt(a.number, 10);
        const bNum = parseInt(b.number, 10);
        if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
        return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
    }).map(emp => `
        <button class="position-person-row" type="button"
                data-action="open-employee-floating" data-id="${emp.key || emp.id}">
            <span>${escapeHTML(emp.number || '—')}</span>
            <strong>${escapeHTML(emp.name)}</strong>
        </button>
    `).join('');

    return `
        <article class="position-card${pos.active ? '' : ' is-inactive'}"
                 style="--position-color: ${color};">
            <div class="position-card__top">
                <div class="position-card__head">
                    <div class="position-card__identity">
                        <button class="position-card__icon" type="button"
                                data-action="open-position-icon" data-id="${pos.id}"
                                aria-label="Cambiar icono de ${escapeHTML(pos.name)}"
                                title="Cambiar icono">
                            ${renderPositionIconSvg(iconName, { size: 23 })}
                        </button>
                        <div>
                            <div class="position-card__title-line">
                                <h3>${escapeHTML(pos.name)}</h3>
                                ${!pos.active ? '<span class="personnel-status-badge">Inactiva</span>' : ''}
                            </div>
                            <p class="position-card__rate">
                                $${hourlyRate}/hr
                                ${dailyRate ? `<span>= $${dailyRate.toLocaleString()}/día</span>` : ''}
                            </p>
                        </div>
                    </div>
                    <div class="position-card__quick-actions">
                        <button type="button" data-action="open-position-form" data-id="${pos.id}"
                                aria-label="Editar posición" title="Editar">
                            ${renderPositionUiSvg('edit', { size: 15 })}
                        </button>
                        <button type="button" data-action="toggle-position-status" data-id="${pos.id}"
                                aria-label="${pos.active ? 'Desactivar posición' : 'Activar posición'}"
                                title="${pos.active ? 'Desactivar' : 'Activar'}">
                            ${renderPositionUiSvg(pos.active ? 'pause' : 'play', { size: 15 })}
                        </button>
                        ${!pos.active ? `
                            <button type="button" class="is-danger"
                                    ${canDelete ? `data-action="delete-position" data-id="${pos.id}"` : 'disabled'}
                                    aria-label="${canDelete ? 'Eliminar posición' : 'No se puede eliminar porque tiene empleados asignados'}"
                                    title="Eliminar">
                                ${renderPositionUiSvg('trash', { size: 15 })}
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>

            <div class="position-card__facts">
                ${employeesInPosition.length ? `
                    <button type="button" class="position-card__employee-count"
                            data-action="toggle-position-employees" data-id="${pos.id}"
                            aria-expanded="false"
                            aria-controls="pos-employees-${pos.id}">
                        ${renderPositionUiSvg('users', { size: 14 })}
                        ${empCount} ${empCount === 1 ? 'empleado' : 'empleados'}
                    </button>
                ` : `
                    <span>
                        ${renderPositionUiSvg('users', { size: 14 })}
                        0 empleados
                    </span>
                `}
                <span class="position-card__days-text" aria-label="Días laborales">
                    ${renderPositionUiSvg('calendar', { size: 14 })}
                    ${[1, 2, 3, 4, 5, 6, 0]
        .filter(day => workingDays.includes(day))
        .map(day => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][day])
        .join('·') || 'Sin días'}
                </span>
            </div>

            ${employeesInPosition.length ? `
                <div id="pos-employees-${pos.id}" class="position-card__people" hidden>
                    ${employeeRows}
                </div>
            ` : ''}
        </article>
    `;
}


// ─── Handlers ────────────────────────────────────────────────────────────────

export function togglePositionEmployees(positionId) {
    const elem = document.getElementById(`pos-employees-${positionId}`);
    if (elem) {
        elem.hidden = !elem.hidden;
        const trigger = Array.from(document.querySelectorAll('.position-card__employee-count'))
            .find(button => button.dataset.id === positionId);
        trigger?.setAttribute('aria-expanded', String(!elem.hidden));
        schedulePositionCardGridLayout();
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
    const input = typeof document !== 'undefined'
        ? document.querySelector('.position-toolbar__search input')
        : null;
    const keepFocus = input && document.activeElement === input;
    const cursorPosition = keepFocus ? input.selectionStart : null;
    state.positionFilters.search = value;
    render();
    if (keepFocus && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const nextInput = document.querySelector('.position-toolbar__search input');
            if (!nextInput) return;
            nextInput.focus();
            const position = cursorPosition ?? nextInput.value.length;
            nextInput.setSelectionRange(position, position);
        }));
    }
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
    const nextSort = ['employees', 'name', 'salary'].includes(sortBy) ? sortBy : 'employees';
    stateManager.batchSetState(() => {
        state.positionSortBy = nextSort;
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
        message: `¿Estás seguro de ${action} la posición "${escapeHTML(pos.name)}"?`,
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

export async function deletePosition(positionId) {
    const pos = state.positions.find(p => p.id === positionId);
    if (!pos) return;

    if (pos.active) {
        Modal.confirm({
            title: `${icons.get('alert')} No se puede eliminar`,
            message: `La posición "${escapeHTML(pos.name)}" está activa. Desactívala primero para poder eliminarla.`,
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
            message: `La posición "${escapeHTML(pos.name)}" tiene empleados asignados.`,
            confirmText: 'Aceptar',
            cancelText: 'Cerrar',
            type: 'warning',
            onConfirm: () => {}
        });
        return;
    }

    try {
        await ensureAllAttendanceHistory();
    } catch (_) {
        window.showAlert?.('No se puede verificar el historial completo. Conéctate a Internet antes de eliminar la posición.', 'warning');
        return;
    }

    // 🛡️ Guardia 3: días TRABAJADOS con esta posición. Eliminarla del catálogo
    // borraría sus referencias del historial (cleanupPositionReferences) y la
    // nómina/reportes viejos dejarían de resolver su nombre y tarifa. Una
    // posición con historia se conserva DESACTIVADA como archivo — no se puede
    // asignar ni usar, pero el pasado queda íntegro.
    const history = collectPositionDays(state.attendance, { positionId: pos.id });
    if (history.count > 0) {
        Modal.confirm({
            title: `${icons.get('alert')} No se puede eliminar`,
            message: `La posición "${escapeHTML(pos.name)}" tiene <strong>${history.count}</strong> día${history.count === 1 ? '' : 's'} de asistencia registrado${history.count === 1 ? '' : 's'} entre <strong>${history.firstDate}</strong> y <strong>${history.lastDate}</strong>.<br><br>` +
                `Eliminarla borraría esa información del historial y los reportes viejos de nómina dejarían de cuadrar. Mantenela desactivada: no se puede asignar ni usar, pero el historial queda íntegro.`,
            confirmText: 'Entendido',
            cancelText: 'Cerrar',
            type: 'warning',
            onConfirm: () => {}
        });
        return;
    }

    Modal.confirm({
        title: `${icons.get('delete')} Eliminar Posición`,
        message: `¿Seguro que deseas eliminar la posición "${escapeHTML(pos.name)}"? Esta acción no se puede deshacer.`,
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
