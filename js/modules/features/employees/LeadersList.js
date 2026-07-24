/**
 * 🔑 LeadersList — Card template + handlers for leaders.
 *
 * Sprint 7b: handlers moved here from EmployeesUI.js.
 */

import icons from '../../ui/IconSystem.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { Modal } from '../../components/Modal.js';
import { LeaderModal } from '../../ui/modals/LeaderModal.js';
import { renderPositionIconSvg, renderPositionUiSvg, resolveLeaderIcon } from './PositionVisuals.js';

let leaderGridFrame = null;
let leaderGridResizeBound = false;

export function layoutLeaderCardGrid() {
    if (typeof document === 'undefined') return;
    const grid = document.querySelector('.leader-card-grid');
    if (!grid) return;

    const styles = getComputedStyle(grid);
    const rowHeight = Number.parseFloat(styles.gridAutoRows) || 8;
    const rowGap = Number.parseFloat(styles.rowGap) || 12;
    grid.querySelectorAll('.leader-card').forEach(card => {
        card.style.gridRowEnd = 'auto';
        const height = card.getBoundingClientRect().height;
        const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
        card.style.gridRowEnd = `span ${span}`;
    });
}

export function scheduleLeaderCardGridLayout() {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    if (!leaderGridResizeBound) {
        window.addEventListener('resize', scheduleLeaderCardGridLayout, { passive: true });
        leaderGridResizeBound = true;
    }
    if (leaderGridFrame) cancelAnimationFrame(leaderGridFrame);
    leaderGridFrame = requestAnimationFrame(() => {
        leaderGridFrame = null;
        layoutLeaderCardGrid();
    });
}

export function LeaderCard(ldr) {
    const positionsLedList = state.positions.filter(p => p.leaderId === ldr.id && p.active);
    const positionsLed = positionsLedList.length;
    const leaderPositionIds = new Set(positionsLedList.map(position => position.id));
    const supervisedEmployees = state.employees
        .filter(employee => employee.active && (employee.positions || []).some(id => leaderPositionIds.has(id)));
    const leaderId = escapeAttr(ldr.id);
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
            <section class="leader-card__position-group">
                <h4>${escapeHTML(pos.name)}</h4>
                ${emps.map(emp => `
                    <button class="position-person-row" type="button"
                            data-action="open-employee-floating" data-id="${escapeAttr(emp.key || emp.id)}">
                        <span>${escapeHTML(emp.number || '—')}</span>
                        <strong>${escapeHTML(emp.name)}</strong>
                    </button>
                `).join('')}
            </section>
        `;
    }).join('');

    return `
        <article class="leader-card${ldr.active ? '' : ' is-inactive'}">
            <div class="leader-card__top">
                <div class="leader-card__head">
                    <div class="leader-card__identity">
                        <button class="leader-card__icon" type="button"
                                data-action="open-leader-icon" data-id="${leaderId}"
                                aria-label="Cambiar icono de ${escapeHTML(ldr.name)}"
                                title="Cambiar icono">
                            ${renderPositionIconSvg(resolveLeaderIcon(ldr), { size: 23 })}
                        </button>
                        <div>
                            <div class="leader-card__title-line">
                                <h3>${escapeHTML(ldr.name)}</h3>
                                ${ldr.number !== undefined && ldr.number !== null
        ? `<span class="leader-card__number">L-${escapeHTML(String(ldr.number).padStart(3, '0'))}</span>`
        : ''}
                                ${!ldr.active ? '<span class="personnel-status-badge">Inactivo</span>' : ''}
                            </div>
                            <p>${positionsLed} ${positionsLed === 1 ? 'puesto supervisado' : 'puestos supervisados'}</p>
                        </div>
                    </div>
                    <div class="position-card__quick-actions">
                        <button type="button" data-action="open-leader-form" data-id="${leaderId}"
                                aria-label="Editar líder" title="Editar">
                            ${renderPositionUiSvg('edit', { size: 15 })}
                        </button>
                        <button type="button" data-action="toggle-leader-status" data-id="${leaderId}"
                                aria-label="${ldr.active ? 'Desactivar líder' : 'Activar líder'}"
                                title="${ldr.active ? 'Desactivar' : 'Activar'}">
                            ${renderPositionUiSvg(ldr.active ? 'pause' : 'play', { size: 15 })}
                        </button>
                    </div>
                </div>
            </div>

            <div class="leader-card__facts">
                ${supervisedEmployees.length ? `
                    <button type="button" class="leader-card__employee-count"
                            data-action="toggle-leader-employees" data-id="${leaderId}"
                            aria-expanded="false" aria-controls="leader-employees-${leaderId}">
                        ${renderPositionUiSvg('users', { size: 14 })}
                        ${supervisedEmployees.length} ${supervisedEmployees.length === 1 ? 'empleado' : 'empleados'}
                    </button>
                ` : `
                    <span>${renderPositionUiSvg('users', { size: 14 })} 0 empleados</span>
                `}
                <span>${renderPositionIconSvg('briefcase', { size: 14 })} ${positionsLed} puestos</span>
            </div>

            ${positionsSections ? `
                <div id="leader-employees-${leaderId}" class="leader-card__people" hidden>
                    ${positionsSections}
                </div>
            ` : ''}
        </article>
    `;
}


// ─── Handlers ────────────────────────────────────────────────────────────────

export function openLeaderForm(leaderId = null) {
    LeaderModal.open(leaderId);
}

export function setLeaderSortBy(sortBy) {
    const nextSort = ['employees', 'name'].includes(sortBy) ? sortBy : 'employees';
    stateManager.batchSetState(() => {
        state.leaderSortBy = nextSort;
    });
}

export function toggleLeaderEmployees(leaderId) {
    const elem = document.getElementById(`leader-employees-${leaderId}`);
    if (elem) {
        elem.hidden = !elem.hidden;
        const trigger = Array.from(document.querySelectorAll('.leader-card__employee-count'))
            .find(button => button.dataset.id === leaderId);
        trigger?.setAttribute('aria-expanded', String(!elem.hidden));
        scheduleLeaderCardGridLayout();
    }
}

export function toggleLeaderStatus(leaderId) {
    const ldr = state.leaders.find(l => l.id === leaderId);
    if (!ldr) return;

    const action = ldr.active ? 'desactivar' : 'activar';
    const actionPast = ldr.active ? 'desactivado' : 'activado';

    Modal.confirm({
        title: ldr.active ? `${icons.get('x-circle')} Desactivar Lider` : `${icons.get('info')} Activar Lider`,
        message: `¿Estás seguro de ${action} al líder ${escapeHTML(ldr.name)}?`,
        confirmText: action === 'desactivar' ? 'Sí, desactivar' : 'Sí, activar',
        cancelText: 'Cancelar',
        type: ldr.active ? 'warning' : 'info',
        onConfirm: () => {
            ldr.active = !ldr.active;
            ldr.updatedAt = Date.now();
            ldr._isDirty = true;
            const changeDate = getDateKey(new Date());
            ldr.lastStatusChange = changeDate;
            ldr.updatedAt = Date.now();

            if (!ldr.statusHistory) ldr.statusHistory = [];
            ldr.statusHistory.push({
                date: changeDate,
                active: ldr.active,
                timestamp: new Date().getTime()
            });

            saveApplicationData();
            if (window.showAlert) {
                window.showAlert(`${icons.get('zap')} Líder ${escapeHTML(ldr.name)} ${actionPast} correctamente`, 'success');
            }
            render();
        }
    });
}
