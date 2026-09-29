/**
 * 🗓️ MiniImportDateGuard — antes de aplicar asistencia importada desde Mini,
 * se valida qué tan lejos de hoy están las fechas.
 *
 * Niveles (pedido 2026-09-29, tras 18 registros de Mini con el año 2025):
 *   - hasta 7 días atrás ........ sin aviso
 *   - 8 a 30 días ............... solo se informa
 *   - 31 a 90 días .............. confirmación
 *   - más de 90 días, otro año o
 *     fecha futura .............. confirmación fuerte (escribir el año)
 * Además se avisa si un día es anterior a la fecha de ingreso del empleado.
 */
import { Modal } from '../../components/Modal.js';
import { escapeHTML } from '../../utils/Sanitize.js';

export const DATE_AGE_LEVEL = Object.freeze({ OK: 'ok', INFO: 'info', CONFIRM: 'confirm', STRONG: 'strong' });
const RANK = { ok: 0, info: 1, confirm: 2, strong: 3 };
const DAY_MS = 86400000;

const localDayKey = date => {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const dayNumber = key => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);

export function levelForDate(dateKey, today = new Date()) {
    const todayKey = localDayKey(today);
    const ageDays = dayNumber(todayKey) - dayNumber(dateKey);
    let level = DATE_AGE_LEVEL.OK;
    if (!Number.isFinite(ageDays)) level = DATE_AGE_LEVEL.STRONG;
    else if (ageDays < 0) level = DATE_AGE_LEVEL.STRONG;
    else if (ageDays > 90) level = DATE_AGE_LEVEL.STRONG;
    else if (ageDays > 30) level = String(dateKey).slice(0, 4) !== todayKey.slice(0, 4) ? DATE_AGE_LEVEL.STRONG : DATE_AGE_LEVEL.CONFIRM;
    else if (ageDays > 7) level = DATE_AGE_LEVEL.INFO;
    return { date: dateKey, ageDays, level };
}

/**
 * @param {Array<{date:string, employeeIds?:string[]}>} days
 * @param {{today?:Date, employees?:Array}} [options]
 */
export function assessMiniImportDates(days = [], { today = new Date(), employees = [] } = {}) {
    const byId = new Map((employees || []).map(employee => [String(employee?.id), employee]));
    const assessed = days.filter(day => day?.date).map(day => levelForDate(day.date, today));
    const level = assessed.reduce((max, day) => (RANK[day.level] > RANK[max] ? day.level : max), DATE_AGE_LEVEL.OK);
    const hireIssues = [];
    for (const day of days) {
        for (const id of day?.employeeIds || []) {
            const employee = byId.get(String(id));
            const hire = String(employee?.hireDate || '').slice(0, 10);
            if (hire && day.date < hire) hireIssues.push({ date: day.date, employeeId: employee.id, number: employee.number ?? '', name: employee.name ?? '', hireDate: hire });
        }
    }
    const years = [...new Set(assessed.filter(day => day.level === DATE_AGE_LEVEL.STRONG).map(day => day.date.slice(0, 4)))];
    return { level, days: assessed, hireIssues, confirmToken: years[0] || '' };
}

const formatDay = key => {
    const [y, m, d] = String(key).split('-');
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${Number(d)} ${months[Number(m) - 1] || m} ${y}`;
};
const describeAge = day => day.ageDays < 0 ? `${-day.ageDays} día(s) en el futuro` : `hace ${day.ageDays} día(s)`;

function hireIssuesHtml(issues) {
    if (!issues.length) return '';
    const items = issues.slice(0, 6).map(issue => `<li>#${escapeHTML(String(issue.number))} ${escapeHTML(issue.name)}: ${formatDay(issue.date)} (ingreso ${formatDay(issue.hireDate)})</li>`).join('');
    return `<p style="margin:10px 0 4px;color:#fbbf24;">Días anteriores a la fecha de ingreso del empleado:</p><ul style="margin:0;padding-left:18px;color:#cbd5e1;">${items}${issues.length > 6 ? `<li>y ${issues.length - 6} más</li>` : ''}</ul>
        <p style="margin:6px 0 0;color:#94a3b8;font-size:0.85rem;">Se aplicarán igual. Si la fecha de ingreso está mal, corrígela en la ficha del empleado.</p>`;
}

function strongConfirm({ assessment, notify }) {
    return new Promise(resolve => {
        const flagged = assessment.days.filter(day => day.level === DATE_AGE_LEVEL.STRONG);
        const list = flagged.slice(0, 8).map(day => `<li><strong>${formatDay(day.date)}</strong> · ${describeAge(day)}</li>`).join('');
        const token = assessment.confirmToken;
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        const modal = new Modal({
            title: '⚠️ Fechas muy lejanas',
            size: 'small',
            content: `<div class="mini-date-guard">
                <p style="margin:0 0 8px;color:#e2e8f0;">Vas a aplicar asistencia de fechas muy lejanas a hoy. Suele ser un error de fecha en Mini (por ejemplo, el año).</p>
                <ul style="margin:0;padding-left:18px;color:#fca5a5;">${list}${flagged.length > 8 ? `<li>y ${flagged.length - 8} más</li>` : ''}</ul>
                ${hireIssuesHtml(assessment.hireIssues)}
                <label style="display:block;margin-top:12px;color:#cbd5e1;font-size:0.9rem;">Para continuar escribe el año <strong>${escapeHTML(token)}</strong>:
                    <input type="text" inputmode="numeric" data-mini-date-token class="form-input" autocomplete="off" style="margin-top:6px;width:100%;">
                </label>
            </div>`,
            onClose: () => finish(false),
            buttons: [
                { text: 'Cancelar', class: 'btn-secondary', onClick: function () { finish(false); this.close(); } },
                {
                    text: 'Aplicar de todos modos', class: 'btn-danger', onClick: function () {
                        const typed = this.element?.querySelector('[data-mini-date-token]')?.value?.trim();
                        if (typed !== token) { notify?.(`Escribe ${token} para confirmar.`, 'warning'); return; }
                        finish(true);
                        this.close();
                    }
                }
            ]
        });
        modal.open();
    });
}

/**
 * Pide la confirmación que corresponda al nivel. Devuelve `true` al instante
 * si no hace falta preguntar (así aplicar sigue siendo inmediato y no admite
 * doble clic), o una promesa con la respuesta del usuario. `ui` permite
 * sustituir los diálogos (pruebas).
 */
export function confirmMiniImportDates(days, { today = new Date(), employees = [], ui = {} } = {}) {
    const assessment = assessMiniImportDates(days, { today, employees });
    const notify = ui.notify || ((message, type) => window.showNotification?.(message, type));
    if (assessment.level === DATE_AGE_LEVEL.STRONG) {
        return (ui.strongConfirm || strongConfirm)({ assessment, notify });
    }
    if (assessment.level === DATE_AGE_LEVEL.CONFIRM) {
        const flagged = assessment.days.filter(day => day.level === DATE_AGE_LEVEL.CONFIRM);
        const message = `Vas a aplicar asistencia de hace más de un mes: ${flagged.slice(0, 6).map(day => `<strong>${formatDay(day.date)}</strong>`).join(', ')}${flagged.length > 6 ? ` y ${flagged.length - 6} más` : ''}. Verifica que la fecha en Mini sea correcta.${hireIssuesHtml(assessment.hireIssues)}`;
        return (ui.confirm || (options => Modal.confirm(options)))({
            title: '⚠️ Fecha de hace más de un mes', message, confirmText: 'Sí, aplicar', cancelText: 'Revisar fecha', type: 'warning'
        });
    }
    if (assessment.level === DATE_AGE_LEVEL.INFO) {
        const oldest = assessment.days.reduce((max, day) => day.ageDays > max.ageDays ? day : max, assessment.days[0]);
        notify(`ℹ️ Aplicando asistencia de ${describeAge(oldest)} (${formatDay(oldest.date)}).`, 'info');
    }
    if (assessment.hireIssues.length) {
        const first = assessment.hireIssues[0];
        notify(`ℹ️ #${first.number} ${first.name}: ${formatDay(first.date)} es anterior a su fecha de ingreso (${formatDay(first.hireDate)})${assessment.hireIssues.length > 1 ? ` y ${assessment.hireIssues.length - 1} caso(s) más` : ''}.`, 'warning');
    }
    return true;
}
