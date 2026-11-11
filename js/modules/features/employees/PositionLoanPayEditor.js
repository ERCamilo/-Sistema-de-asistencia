/**
 * Sección «Avanzado · Préstamos de personal» del editor del puesto.
 *
 * Define cómo se paga el día libre, el feriado y las horas extra a quien tiene
 * este puesto como préstamo de personal. Los demás empleados no cambian.
 * Render y lectura puros; PositionModal decide cuándo guardar.
 */
import { LOAN_PAY_SOURCES, normalizeLoanPay } from '../payroll/PayrollFactors.js';
import { escapeAttr, escapeHTML } from '../../utils/Sanitize.js';

const number = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const CONCEPTS = Object.freeze([
    { id: 'restDay', label: 'Día libre', name: 'día libre', defaultSource: LOAN_PAY_SOURCES.TEAM,
        options: settings => [[LOAN_PAY_SOURCES.TEAM, 'El del líder del equipo'], [LOAN_PAY_SOURCES.PAYER, 'El del líder que paga'], [LOAN_PAY_SOURCES.CUSTOM, 'Factor propio']] },
    { id: 'holiday', label: 'Feriado', name: 'feriado', defaultSource: LOAN_PAY_SOURCES.GENERAL,
        options: settings => [[LOAN_PAY_SOURCES.GENERAL, `General${number(settings?.holidayFactor) ? ` (${number(settings.holidayFactor)}x)` : ''}`], [LOAN_PAY_SOURCES.CUSTOM, 'Factor propio']] },
    { id: 'overtime', label: 'Horas extra', name: 'horas extra', defaultSource: LOAN_PAY_SOURCES.GENERAL,
        options: settings => [[LOAN_PAY_SOURCES.GENERAL, `General${number(settings?.overtimeFactor) ? ` (${number(settings.overtimeFactor)}x)` : ''}`], [LOAN_PAY_SOURCES.CUSTOM, 'Factor propio']] }
]);
const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-loan-pay-chevron style="transition:transform .15s;"><path d="m6 9 6 6 6-6"/></svg>';

export function renderLoanPayAdvanced(position, { settings = {} } = {}) {
    const saved = normalizeLoanPay(position?.loanPay);
    const open = Boolean(saved);
    const rows = CONCEPTS.map(concept => {
        const current = saved?.[concept.id];
        const source = current?.source || concept.defaultSource;
        const custom = source === LOAN_PAY_SOURCES.CUSTOM;
        return `<div style="display:grid;gap:6px;">
            <label class="form-label" for="loanPaySource-${concept.id}" style="margin:0;">${concept.label}</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                <select id="loanPaySource-${concept.id}" class="form-select" data-loan-pay-source="${concept.id}" style="flex:1 1 200px;min-height:44px;">
                    ${concept.options(settings).map(([value, text]) => `<option value="${value}" ${value === source ? 'selected' : ''}>${escapeHTML(text)}</option>`).join('')}
                </select>
                <span data-loan-pay-custom ${custom ? '' : 'hidden'} style="display:${custom ? 'flex' : 'none'};align-items:center;gap:6px;flex:0 0 auto;">
                    <input type="number" inputmode="decimal" class="form-input" data-loan-pay-factor="${concept.id}" aria-label="Factor propio de ${concept.name}"
                        value="${custom ? escapeAttr(current.factor) : ''}" min="1" max="5" step="0.25" placeholder="2" style="width:96px;min-height:44px;">
                    <span style="color:var(--text-dim,#a4b1c7);font-size:.875rem;">x</span>
                </span>
            </div>
        </div>`;
    }).join('');
    return `<div class="form-group" data-loan-pay>
        <button type="button" class="btn btn-secondary" data-loan-pay-toggle aria-expanded="${open}" aria-controls="loanPayAdvanced"
            style="width:100%;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span>Avanzado · Préstamos de personal${open ? ' <small style="color:var(--accent,#06b6d4);font-weight:600;">· Configurado</small>' : ''}</span>${CHEVRON}
        </button>
        <div id="loanPayAdvanced" ${open ? '' : 'hidden'} style="margin-top:10px;padding:14px;border:1px solid var(--border,#2a3a56);border-radius:12px;background:var(--panel-2,#1b273d);display:${open ? 'grid' : 'none'};gap:14px;">
            <p style="margin:0;color:var(--text-dim,#a4b1c7);font-size:.82rem;line-height:1.5;">Solo para empleados que tienen este puesto como préstamo de personal. Los demás siguen la regla normal.</p>
            ${rows}
        </div>
    </div>`;
}

export function attachLoanPayAdvanced(root) {
    const host = root.querySelector('[data-loan-pay]');
    if (!host) return;
    const toggle = host.querySelector('[data-loan-pay-toggle]');
    const panel = host.querySelector('#loanPayAdvanced');
    const show = open => {
        toggle.setAttribute('aria-expanded', String(open));
        panel.hidden = !open; panel.style.display = open ? 'grid' : 'none';
        host.querySelector('[data-loan-pay-chevron]').style.transform = open ? 'rotate(180deg)' : '';
    };
    show(toggle.getAttribute('aria-expanded') === 'true');
    toggle.addEventListener('click', () => show(panel.hidden));
    host.addEventListener('change', event => {
        const concept = event.target.dataset?.loanPaySource;
        if (!concept) return;
        const field = host.querySelector(`[data-loan-pay-factor="${concept}"]`).closest('[data-loan-pay-custom]');
        const custom = event.target.value === LOAN_PAY_SOURCES.CUSTOM;
        field.hidden = !custom; field.style.display = custom ? 'flex' : 'none';
    });
}

/** @returns {{ value: object|null, error: string|null }} the setting to store, or why it cannot be saved. */
export function readLoanPayAdvanced(root) {
    const draft = {};
    for (const concept of CONCEPTS) {
        const source = root.querySelector(`[data-loan-pay-source="${concept.id}"]`)?.value;
        if (!source || source === concept.defaultSource) continue;
        if (source !== LOAN_PAY_SOURCES.CUSTOM) { draft[concept.id] = { source }; continue; }
        const raw = root.querySelector(`[data-loan-pay-factor="${concept.id}"]`)?.value?.trim() ?? '';
        const factor = raw === '' ? NaN : Number(raw);
        if (!Number.isFinite(factor) || factor < 1 || factor > 5) {
            return { value: null, error: `El factor propio de ${concept.name} para préstamos debe estar entre 1 y 5` };
        }
        draft[concept.id] = { source, factor };
    }
    return { value: normalizeLoanPay(draft), error: null };
}
