/**
 * Pregunta desde cuándo vale un cambio de líder: todo el período de pago
 * abierto (por defecto) o una fecha elegida entre el inicio del período y hoy.
 * Tarjetas de selección táctil (design.md 5.5); un solo diálogo por cambio.
 */
import { Modal } from '../../components/Modal.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { resolvePayrollPeriod } from '../payroll/PayrollPeriod.js';

const displayDate = dateKey => String(dateKey).split('-').reverse().join('/');
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Open pay period and today, as date keys. The custom date can never leave that range. */
export function leaderChangeDateRange(state, today = new Date()) {
    const periodStart = resolvePayrollPeriod(getActivePayrollSettings(state).payPeriod, today).periodStart;
    const todayKey = getDateKey(today);
    return { periodStart, today: todayKey < periodStart ? periodStart : todayKey };
}

export function normalizeLeaderChangeDate(value, { periodStart, today }) {
    if (!DATE_KEY.test(String(value || ''))) return null;
    return value < periodStart || value > today ? null : value;
}

const CARD = 'display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;padding:16px 18px;border-radius:14px;'
    + 'border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;transition:background .15s,border-color .15s;';
const ICON = 'flex:0 0 40px;width:40px;height:40px;border-radius:11px;display:grid;place-items:center;'
    + 'background:var(--panel-2);border:1px solid var(--border);color:var(--text-dim);transition:background .15s,color .15s;';
const SVG = path => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICON_PERIOD = SVG('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>');
const ICON_DATE = SVG('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>');

function content({ subject, days, periodStart, today }) {
    const card = (value, icon, title, detail, extra = '') => `
        <label data-leader-change-card="${value}" style="${CARD}">
            <input type="radio" name="leaderChangeScope" value="${value}" ${value === 'period' ? 'checked' : ''}
                style="position:absolute;opacity:0;width:1px;height:1px;">
            <span data-leader-change-icon style="${ICON}">${icon}</span>
            <span style="display:grid;gap:4px;min-width:0;flex:1;">
                <strong style="font-size:.95rem;">${title}</strong>
                <span style="color:var(--text-dim);font-size:.85rem;line-height:1.45;">${detail}</span>
                ${extra}
            </span>
        </label>`;
    return `
        <p style="color:var(--text-dim);line-height:1.6;margin:0 0 14px;">${escapeHTML(subject)} tiene
            <strong style="color:var(--text);">${days} ${days === 1 ? 'día registrado' : 'días registrados'}</strong>
            en el período abierto. ¿Desde cuándo vale el nuevo líder?</p>
        <div role="radiogroup" aria-label="Desde cuándo vale el cambio de líder" style="display:grid;gap:10px;">
            ${card('period', ICON_PERIOD, 'Todo el período abierto',
                `Desde el ${displayDate(periodStart)}. Los días ya registrados pasan al nuevo líder.`)}
            ${card('date', ICON_DATE, 'Desde una fecha',
                'Los días anteriores quedan con el líder anterior.',
                `<input type="date" id="leaderChangeFrom" class="form-input" aria-label="Fecha desde la que vale el cambio"
                    min="${escapeAttr(periodStart)}" max="${escapeAttr(today)}" value="${escapeAttr(today)}" style="margin-top:8px;min-height:44px;">`)}
        </div>
        <p id="leaderChangeError" role="alert" style="color:#fca5a5;font-size:.85rem;min-height:1.2em;margin:10px 0 0;"></p>
        <p style="color:var(--text-faint);font-size:.8rem;line-height:1.5;margin:4px 0 0;">Las horas, tarifas y nóminas cerradas no cambian.</p>`;
}

function paintSelection(root) {
    for (const card of root.querySelectorAll('[data-leader-change-card]')) {
        const active = card.querySelector('input[type="radio"]').checked;
        card.style.background = active ? 'var(--panel-2)' : 'transparent';
        card.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
        const icon = card.querySelector('[data-leader-change-icon]');
        icon.style.background = active ? 'var(--accent)' : 'var(--panel-2)';
        icon.style.color = active ? 'var(--on-accent)' : 'var(--text-dim)';
    }
}

/**
 * @returns {Promise<string|null>} the date key the change starts on, or null if cancelled.
 */
export function askLeaderChangeStart(state, { subject, days, today = new Date() } = {}) {
    const range = leaderChangeDateRange(state, today);
    return new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        const modal = new Modal({
            title: 'Cambio de líder',
            content: content({ subject, days, ...range }),
            size: 'small',
            onClose: () => finish(null),
            buttons: [
                { text: 'Cancelar', class: 'btn-secondary', onClick() { this.close(); finish(null); } },
                { text: 'Aplicar cambio', class: 'btn-primary', onClick() {
                    const root = modal.element;
                    const custom = root.querySelector('input[name="leaderChangeScope"][value="date"]').checked;
                    const fromDate = custom ? normalizeLeaderChangeDate(root.querySelector('#leaderChangeFrom').value, range) : range.periodStart;
                    if (!fromDate) {
                        root.querySelector('#leaderChangeError').textContent =
                            `Elige una fecha entre el ${displayDate(range.periodStart)} y el ${displayDate(range.today)}.`;
                        root.querySelector('#leaderChangeFrom').focus();
                        return;
                    }
                    settled = true; this.close(); resolve(fromDate);
                } }
            ]
        });
        modal.open?.();
        const root = modal.element;
        root.addEventListener('change', event => {
            if (event.target.name === 'leaderChangeScope') paintSelection(root);
            if (event.target.id === 'leaderChangeFrom') root.querySelector('#leaderChangeError').textContent = '';
        });
        // Touching the date picks that option, so the date is never ignored.
        root.querySelector('#leaderChangeFrom').addEventListener('focus', () => {
            root.querySelector('input[name="leaderChangeScope"][value="date"]').checked = true; paintSelection(root);
        });
        paintSelection(root);
    });
}
