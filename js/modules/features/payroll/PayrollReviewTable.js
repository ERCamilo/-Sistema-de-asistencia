/**
 * Tabla de la vista previa de nómina por obra.
 *
 * - Bonificaciones (verde), deducciones (rojo) y préstamos (amarillo) tienen
 *   una casilla en su encabezado: desmarcada, la categoría no se suma al neto
 *   y el monto se muestra tachado.
 * - Cada monto con detalle se despliega: debajo del empleado aparece cada
 *   bonificación, deducción o préstamo que lo compone.
 *
 * Función pura: recibe las filas ya calculadas (con y sin las casillas
 * aplicadas) y devuelve HTML.
 */
import icons from '../../ui/IconSystem.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';

export const REVIEW_CATEGORIES = Object.freeze([
    { kind: 'bonuses', field: '_bonuses', details: '_bonusDetails', label: 'BONIF.', title: 'Bonificaciones', sign: '+', css: 'is-bonus' },
    { kind: 'deductions', field: '_deductions', details: '_deductionDetails', label: 'DED.', title: 'Deducciones', sign: '−', css: 'is-deduction' },
    { kind: 'loans', field: '_loans', details: '_loanDetails', label: 'PRÉSTAMOS', title: 'Préstamos', sign: '−', css: 'is-loan' }
]);

const SCOPE_LABELS = { global: 'Todos', employee: 'Individual', position: 'Por posición', leader: 'Por líder' };

const amountOf = value => Number(value) || 0;
const visible = value => Math.abs(amountOf(value)) >= 0.005;
export const reviewRowKey = row => String(row?._employeeId ?? row?.id ?? '');
const net = row => Math.round((amountOf(row?.monto) + Number.EPSILON) * 100) / 100;

function detailLine(category, item) {
    if (category.kind === 'loans') {
        const charges = Number(item.selectedChargeCount) || 0;
        const meta = [
            charges > 1 ? `${charges} cuotas` : charges === 1 ? '1 cuota' : '',
            visible(item.balance) ? `saldo ${formatCurrency(item.balance)}` : ''
        ].filter(Boolean).join(' · ');
        return { name: item.concept || 'Préstamo', meta, amount: item.selectedAmount };
    }
    const basis = item.type === 'percentage'
        ? `${item.value}% de ${formatCurrency(item.appliedTo)}`
        : 'Monto fijo';
    const installment = item.installmentCount > 1 && item.sequence
        ? `cuota ${item.sequence} de ${item.installmentCount}`
        : '';
    const meta = [installment || SCOPE_LABELS[item.scope] || '', basis].filter(Boolean).join(' · ');
    return { name: item.name || category.title, meta, amount: item.amount };
}

function categoryCell({ category, row, source, included, expanded }) {
    const current = included ? row : source;
    const value = amountOf(current?.[category.field]);
    if (!visible(value)) return `<td class="payroll-review-table__amount is-empty">—</td>`;
    const details = current?.[category.details] || [];
    const text = `${category.sign}${formatCurrency(value)}`;
    const shown = included ? text : `<s>${text}</s>`;
    const classes = `payroll-review-table__amount ${category.css}${included ? '' : ' is-excluded'}`;
    if (details.length === 0) {
        return `<td class="${classes}"${included ? '' : ' title="No se incluye en el cálculo"'}>${shown}</td>`;
    }
    const key = `${reviewRowKey(row)}|${category.kind}`;
    return `
        <td class="${classes}">
            <button type="button"
                    class="payroll-review-cell-toggle ${category.css}"
                    data-payroll-action="toggle-payroll-review-detail"
                    data-value="${escapeHTML(key)}"
                    aria-expanded="${expanded}"
                    aria-label="${expanded ? 'Ocultar' : 'Ver'} ${details.length} ${category.title.toLowerCase()} de ${escapeHTML(row._employeeName || 'este empleado')}">
                <span>${shown}</span>
                <small>${icons.get(expanded ? 'chevron-up' : 'chevron-down', { size: 12 })}${details.length}</small>
            </button>
        </td>`;
}

function detailRow({ row, source, categories, inclusion, expandedKinds, colspan }) {
    const sections = categories
        .filter(category => expandedKinds.has(category.kind))
        .map(category => {
            const included = inclusion[category.kind];
            const current = included ? row : source;
            const items = current?.[category.details] || [];
            if (items.length === 0) return '';
            return `
                <section class="payroll-review-detail__group ${category.css}">
                    <h4>${category.title} <span>${items.length}</span>${included ? '' : '<em>No se incluye en el cálculo</em>'}</h4>
                    <ul>
                        ${items.map(item => {
                            const line = detailLine(category, item);
                            return `
                                <li>
                                    <span class="payroll-review-detail__name">
                                        <strong>${escapeHTML(line.name)}</strong>
                                        ${line.meta ? `<small>${escapeHTML(line.meta)}</small>` : ''}
                                    </span>
                                    <b>${included ? '' : '<s>'}${category.sign}${formatCurrency(line.amount)}${included ? '' : '</s>'}</b>
                                </li>`;
                        }).join('')}
                    </ul>
                </section>`;
        })
        .join('');
    if (!sections.trim()) return '';
    return `
        <tr class="payroll-review-detail-row">
            <td colspan="${colspan}"><div class="payroll-review-detail">${sections}</div></td>
        </tr>`;
}

function breakdownCell(row) {
    const breakdown = row._positionBreakdown || [];
    if (breakdown.length === 0) return '<td><span class="payroll-review-table__muted">Sin desglose</span></td>';
    return `
        <td>
            <details class="payroll-breakdown-details">
                <summary>Ver cálculo (${breakdown.length})</summary>
                <div class="payroll-breakdown-details__body">
                    ${breakdown.map(item => `
                        <div class="payroll-breakdown-details__item">
                            <strong>${escapeHTML(item.positionName || 'Puesto')}</strong>
                            <div><span>Tarifa: ${formatCurrency(item.hourlyRate)}/h</span><span>Reg: ${item.regularHours}h (${formatCurrency(item.regularAmount)})</span></div>
                            ${amountOf(item.overtimeHours) > 0 ? `<div class="is-overtime"><span>Extra (x${item.overtimeRate / (item.hourlyRate || 1)}): ${item.overtimeHours}h</span><span>${formatCurrency(item.overtimeAmount)}</span></div>` : ''}
                            ${(amountOf(item.holidayHours) + amountOf(item.restDayHours)) > 0 ? `<div class="is-holiday"><span>Feriado/Descanso: ${amountOf(item.holidayHours) + amountOf(item.restDayHours)}h</span><span>${formatCurrency(amountOf(item.holidayAmount) + amountOf(item.restDayAmount))}</span></div>` : ''}
                            <div class="is-subtotal">Subtotal: ${formatCurrency(item.subtotal)}</div>
                        </div>`).join('')}
                </div>
            </details>
        </td>`;
}

/**
 * @param {object} args
 * @param {Array} args.rows        filas que se pagan (casillas y líder aplicados)
 * @param {Array} args.sourceRows  mismas filas sin casillas (montos configurados)
 * @param {object} args.inclusion  { bonuses, deductions, loans }
 * @param {Set<string>} args.expanded claves "empleado|categoría" desplegadas
 */
export function renderPayrollReviewTable({ rows = [], sourceRows = [], inclusion = {}, expanded = new Set(), emptyMessage = '' } = {}) {
    const sourceByKey = new Map(sourceRows.map(row => [reviewRowKey(row), row]));
    const include = {
        bonuses: inclusion.bonuses !== false,
        deductions: inclusion.deductions !== false,
        loans: inclusion.loans !== false
    };
    const categories = REVIEW_CATEGORIES.filter(category =>
        !include[category.kind] || sourceRows.some(row => visible(row[category.field]))
    );
    const colspan = 6 + categories.length;
    const counts = Object.fromEntries(categories.map(category => [
        category.kind,
        rows.filter(row => visible(sourceByKey.get(reviewRowKey(row))?.[category.field])).length
    ]));
    const sum = field => rows.reduce((total, row) => total + amountOf(row[field]), 0);
    const sourceSum = field => rows.reduce((total, row) => total + amountOf(sourceByKey.get(reviewRowKey(row))?.[field]), 0);

    const head = categories.map(category => `
        <th class="${category.css} payroll-review-table__toggle-heading">
            <label>
                <input type="checkbox"
                       data-payroll-action="toggle-payroll-preview-category"
                       data-value="${category.kind}"
                       ${include[category.kind] ? 'checked' : ''}
                       aria-label="Incluir ${category.title.toLowerCase()} en el cálculo">
                <span>${category.label}</span>
                <small>${counts[category.kind]}</small>
            </label>
        </th>`).join('');

    const body = rows.map((row, index) => {
        const key = reviewRowKey(row);
        const source = sourceByKey.get(key) || row;
        const expandedKinds = new Set(categories
            .map(category => category.kind)
            .filter(kind => expanded.has(`${key}|${kind}`)));
        const negative = net(row) < 0;
        return `
            <tr class="payroll-review-table__row ${index % 2 === 0 ? 'is-even' : ''} ${negative ? 'is-invalid' : ''} ${expandedKinds.size ? 'is-expanded' : ''}">
                <td class="payroll-review-table__number">${escapeHTML(String(row._number || row.id))}</td>
                <td class="payroll-review-table__employee">
                    ${escapeHTML(row._employeeName)}
                    ${negative ? '<span>Pago negativo: ajusta los descuentos</span>' : ''}
                </td>
                <td class="payroll-review-table__amount">
                    ${row._totalHours ?? 0}h
                    ${amountOf(row._overtimeHours) > 0 ? `<small class="payroll-review-table__hours-split">(${row._regularHours}h reg + ${row._overtimeHours}h extra)</small>` : ''}
                </td>
                <td class="payroll-review-table__amount">${formatCurrency(row._brutoOriginal)}</td>
                ${categories.map(category => categoryCell({
                    category, row, source, included: include[category.kind], expanded: expandedKinds.has(category.kind)
                })).join('')}
                <td class="payroll-review-table__amount is-net ${negative ? 'is-invalid' : ''}">${formatCurrency(row.monto)}</td>
                ${breakdownCell(row)}
            </tr>
            ${expandedKinds.size ? detailRow({ row, source, categories, inclusion: include, expandedKinds, colspan }) : ''}`;
    }).join('');

    const foot = categories.map(category => {
        const included = include[category.kind];
        const value = included ? sum(category.field) : sourceSum(category.field);
        const text = `${category.sign}${formatCurrency(value)}`;
        return `<td class="payroll-review-table__amount ${category.css}${included ? '' : ' is-excluded'}">${included ? text : `<s>${text}</s>`}</td>`;
    }).join('');

    return `
        <div class="responsive-table-wrapper" role="region" aria-label="Tabla de nómina de la obra" tabindex="0">
            <table class="payroll-review-table">
                <thead>
                    <tr>
                        <th class="payroll-review-table__number">#</th>
                        <th class="payroll-review-table__employee">EMPLEADO</th>
                        <th>HORAS</th>
                        <th>BRUTO</th>
                        ${head}
                        <th>NETO</th>
                        <th>DESGLOSE</th>
                    </tr>
                </thead>
                <tbody>
                    ${body}
                    ${rows.length === 0 ? `<tr><td colspan="${colspan}" class="payroll-review-table__empty">${escapeHTML(emptyMessage)}</td></tr>` : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="2">Totales (${rows.length} empleados)</td>
                        <td class="payroll-review-table__amount">${rows.reduce((total, row) => total + amountOf(row._totalHours), 0)}h</td>
                        <td class="payroll-review-table__amount">${formatCurrency(sum('_brutoOriginal'))}</td>
                        ${foot}
                        <td class="payroll-review-table__amount is-net">${formatCurrency(sum('monto'))}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}
