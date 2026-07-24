import { Modal } from '../../components/Modal.js';
import { escapeAttr, escapeHTML } from '../../utils/Sanitize.js';
import { hourlyToDaily } from '../../features/payroll/SalaryConversion.js';
import {
    renderPositionIconSvg,
    renderPositionUiSvg,
    resolvePositionIcon,
    safePositionColor
} from '../../features/employees/PositionVisuals.js';
import { resolvePositionBaseHourlyRate } from '../../features/employees/EmployeePositionMetrics.js';

const WEEKS_PER_MONTH = 52 / 12;

function formatMoney(amount) {
    return `$${Math.round(Number(amount) || 0).toLocaleString()}`;
}

function renderPositionOption(position, regularHours) {
    const hourlyRate = resolvePositionBaseHourlyRate(position, regularHours);
    const workDays = Array.isArray(position.workingDays) && position.workingDays.length
        ? position.workingDays.length
        : 6;
    const dailyRate = hourlyToDaily(hourlyRate, regularHours);
    const monthlyRate = dailyRate * workDays * WEEKS_PER_MONTH;
    const color = safePositionColor(position.color);

    return `
        <article class="employee-position-picker__item"
                 data-position-picker-item
                 data-position-id="${escapeAttr(position.id)}"
                 data-position-search="${escapeAttr(String(position.name || '').toLowerCase())}"
                 style="--position-accent: ${color};">
            <span class="employee-position-picker__icon">
                ${renderPositionIconSvg(resolvePositionIcon(position), { size: 23 })}
            </span>
            <div class="employee-position-picker__identity">
                <strong>${escapeHTML(position.name)}</strong>
                <span>${workDays} días por semana</span>
            </div>
            <div class="employee-position-picker__rates">
                <span><small>Hora</small>${formatMoney(hourlyRate)}</span>
                <span><small>Día</small>${formatMoney(dailyRate)}</span>
                <span><small>Mes</small>${formatMoney(monthlyRate)}</span>
            </div>
            <button type="button" data-add-position-id="${escapeAttr(position.id)}">
                ${renderPositionUiSvg('add', { size: 15 })} Agregar
            </button>
        </article>
    `;
}

export class EmployeePositionPickerModal {
    static open({ positions = [], assignedIds = [], regularHours = 8, onAdd } = {}) {
        const assigned = new Set(assignedIds.map(String));
        const available = positions
            .filter(position => position.active !== false && !assigned.has(String(position.id)))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));

        const content = `
            <div class="employee-position-picker">
                <label class="employee-position-picker__search">
                    ${renderPositionUiSvg('search', { size: 17 })}
                    <input type="search" data-position-picker-search
                           placeholder="Buscar puesto...">
                </label>
                <div class="employee-position-picker__list">
                    ${available.length
                        ? available.map(position => renderPositionOption(position, regularHours)).join('')
                        : `
                            <div class="employee-position-picker__empty">
                                <strong>No hay puestos disponibles</strong>
                                <span>Todos los puestos activos ya están asignados.</span>
                            </div>
                        `}
                </div>
            </div>
        `;

        const modal = new Modal({
            title: 'Agregar puesto',
            subtitle: 'Selecciona uno o varios puestos para este empleado',
            content,
            size: 'medium',
            buttons: [
                { text: 'Listo', class: 'btn-primary', onClick() { this.close(); } }
            ]
        });
        modal.open();

        const root = modal.element;
        const search = root.querySelector('[data-position-picker-search]');
        search?.addEventListener('input', () => {
            const query = search.value.trim().toLowerCase();
            root.querySelectorAll('[data-position-picker-item]').forEach(item => {
                item.hidden = !!query && !item.dataset.positionSearch.includes(query);
            });
        });

        root.querySelectorAll('[data-add-position-id]').forEach(button => {
            button.addEventListener('click', () => {
                const position = available.find(item => String(item.id) === button.dataset.addPositionId);
                if (!position || button.disabled) return;
                onAdd?.(position);
                button.disabled = true;
                button.classList.add('is-added');
                button.textContent = 'Agregado';
            });
        });

        return modal;
    }
}
