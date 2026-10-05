/**
 * 🔁 LoanDuplicateReview.js
 *
 * Panel "Posibles registros repetidos" del libro de préstamos: muestra los
 * abonos, refinanciamientos y préstamos que parecen anotados dos veces
 * (LoanRecordDuplicates) y deja que una persona decida:
 *   - Anular las copias marcadas (soft-void: quedan en la auditoría, se
 *     pueden restaurar y la anulación se sincroniza con los demás equipos).
 *   - "No es copia": no se vuelve a proponer.
 *   - Préstamos repetidos: eliminar uno o conservar ambos.
 *
 * Antes de anular, cada préstamo muestra cómo quedan su saldo y lo pagado de
 * más, y avisa si al quitar las copias aparecería una deuda.
 */

import { state } from '../../core/AppState.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { captureEntityProjectScope } from '../projects/EntityProjectScope.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import icons from '../../ui/IconSystem.js';
import { voidPayment, voidRefinancing, round2 } from './LoansService.js';
import { resolveDuplicateByDeleting } from './LoanDuplicateResolver.js';
import {
    DUPLICATE_KINDS,
    findLoanRecordDuplicates,
    previewLoanAfterVoiding,
    dismissDuplicateGroup
} from './LoanRecordDuplicates.js';

// Estado de UI local (no se sincroniza): panel abierto por ámbito y copias
// marcadas por préstamo. Lo no tocado por la persona usa la sugerencia.
const openScopes = new Set();
const selections = new Map();

export function resetLoanDuplicateReview() {
    openScopes.clear();
    selections.clear();
}

function scopedEmployees() {
    const projectScope = peekEntityScope();
    return (state.employees || []).filter(employee => entityInScope(employee, projectScope));
}

function findEmployee(employeeId) {
    return scopedEmployees().find(employee => String(employee.id) === String(employeeId)) || null;
}

function findLoan(emp, loanId) {
    return (emp?.loans || []).find(loan => String(loan.id) === String(loanId)) || null;
}

function selectedFor(item) {
    if (!selections.has(item.loanId)) selections.set(item.loanId, new Set(item.suggested));
    const valid = new Set(item.groups.flatMap(group => group.copies.map(copy => copy.id)));
    const selected = selections.get(item.loanId);
    for (const id of [...selected]) if (!valid.has(id)) selected.delete(id);
    return selected;
}

function day(value) {
    const text = String(value || '').slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

function stamp(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const date = new Date(ms);
    const pad = value => String(value).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const KIND_LABEL = {
    [DUPLICATE_KINDS.PAYMENT]: { name: 'Abono', css: 'is-payment', sign: '' },
    [DUPLICATE_KINDS.REFINANCING]: { name: 'Interés por refinanciamiento', css: 'is-refinancing', sign: '+' }
};

function recordLine({ record, kind, role, loanId, checked }) {
    const label = KIND_LABEL[kind];
    const recorded = stamp(record.recordedAt);
    const meta = [
        role === 'original' ? 'se conserva' : 'copia',
        record.note ? `"${record.note}"` : '',
        recorded ? `anotado ${recorded}` : '',
        record.payroll ? 'nómina' : ''
    ].filter(Boolean).join(' · ');
    const control = role === 'original'
        ? `<span class="loan-dup__keep" aria-hidden="true">${icons.get('check', { size: 14 })}</span>`
        : `<input type="checkbox" data-app-fn="toggleLoanDuplicateRecord" data-arg="${escapeAttr(loanId)}" data-arg2="${escapeAttr(record.id)}"
                  ${checked ? 'checked' : ''} aria-label="Anular la copia del ${escapeAttr(day(record.date))} por ${escapeAttr(formatCurrency(record.amount))}">`;
    return `
        <li class="loan-dup__record ${label.css}${role === 'original' ? ' is-original' : ''}${checked ? ' is-marked' : ''}">
            <label>
                ${control}
                <span class="loan-dup__record-main">
                    <strong>${escapeHTML(label.name)} · ${escapeHTML(day(record.date))}</strong>
                    <small>${escapeHTML(meta)}</small>
                </span>
                <b>${checked ? '<s>' : ''}${label.sign}${formatCurrency(record.amount)}${checked ? '</s>' : ''}</b>
            </label>
        </li>`;
}

function loanCard(item, loan) {
    const selected = selectedFor(item);
    const after = previewLoanAfterVoiding(loan, selected);
    const newDebt = round2(after.balance - item.balance);
    const groups = item.groups.map(group => `
        <div class="loan-dup__group">
            <ul>
                ${recordLine({ record: group.original, kind: group.kind, role: 'original', loanId: item.loanId })}
                ${group.copies.map(copy => recordLine({ record: copy, kind: group.kind, role: 'copy', loanId: item.loanId, checked: selected.has(copy.id) })).join('')}
            </ul>
            <button type="button" class="loan-dup__dismiss" data-app-fn="dismissLoanDuplicateGroup" data-arg="${escapeAttr(item.employeeId)}" data-arg2="${escapeAttr(group.key)}">
                No es copia
            </button>
        </div>`).join('');
    return `
        <article class="loan-dup__card">
            <header>
                <div>
                    <strong>#${escapeHTML(String(item.employeeNumber))} ${escapeHTML(item.employeeName)}</strong>
                    <small>${escapeHTML(item.loanLabel)} · ${escapeHTML(day(item.startDate))} · ${formatCurrency(item.principal)}</small>
                </div>
            </header>
            ${groups}
            <footer class="loan-dup__effect">
                <span>Saldo <b>${formatCurrency(item.balance)}</b> → <b>${formatCurrency(after.balance)}</b></span>
                <span>Pagado de más <b>${formatCurrency(item.overpaid)}</b> → <b>${formatCurrency(after.overpaid)}</b></span>
            </footer>
            ${newDebt > 0.01 ? `
                <p class="loan-dup__warning" role="note">
                    ${icons.get('alert', { size: 14 })}
                    Al anular lo marcado quedaría una deuda de ${formatCurrency(newDebt)}. Revisa si algún interés de este préstamo
                    también se cargó por error antes de anular.
                </p>` : ''}
        </article>`;
}

function loanPairCard(pair) {
    const loans = pair.loans.map(loan => `
        <li>
            <span>
                <strong>${escapeHTML(loan.label)} · ${escapeHTML(day(loan.startDate))} · ${formatCurrency(loan.principal)}</strong>
                <small>${loan.status === 'paid' ? 'Saldado' : 'Activo'} · ${loan.paymentCount} abono${loan.paymentCount === 1 ? '' : 's'} (${formatCurrency(loan.paid)})${loan.createdAt ? ` · creado ${stamp(loan.createdAt)}` : ''}</small>
            </span>
            <button type="button" class="loan-dup__delete" data-app-fn="deleteDuplicateLoanFromReview" data-arg="${escapeAttr(pair.employeeId)}" data-arg2="${escapeAttr(loan.id)}">
                Eliminar este
            </button>
        </li>`).join('');
    return `
        <article class="loan-dup__card">
            <header>
                <div>
                    <strong>#${escapeHTML(String(pair.employeeNumber))} ${escapeHTML(pair.employeeName)}</strong>
                    <small>Dos préstamos de ${formatCurrency(pair.amount)} con fechas cercanas</small>
                </div>
            </header>
            <ul class="loan-dup__pair">${loans}</ul>
            <button type="button" class="loan-dup__dismiss is-wide" data-app-fn="dismissLoanDuplicateGroup" data-arg="${escapeAttr(pair.employeeId)}" data-arg2="${escapeAttr(pair.key)}">
                Son préstamos distintos — conservar ambos
            </button>
        </article>`;
}

function countText(counts) {
    return [
        counts.payments ? `${counts.payments} abono${counts.payments === 1 ? '' : 's'}` : '',
        counts.refinancings ? `${counts.refinancings} refinanciamiento${counts.refinancings === 1 ? '' : 's'}` : '',
        counts.loans ? `${counts.loans} préstamo${counts.loans === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');
}

/**
 * @param {object} args
 * @param {string} args.scope   'general' o el id del empleado
 * @param {Array}  args.employees empleados ya filtrados por obra
 */
export function renderLoanDuplicateReview({ scope = 'general', employees = [], embedded = false } = {}) {
    const result = findLoanRecordDuplicates(employees);
    if (result.counts.total === 0) return '';
    const isOpen = openScopes.has(String(scope));
    const loansById = new Map(employees.flatMap(emp => (emp.loans || []).map(loan => [String(loan.id), loan])));
    const selectedCount = result.loans.reduce((total, item) => total + selectedFor(item).size, 0);
    return `
        <section class="loan-dup${embedded ? ' loan-dup--embedded' : ''}" aria-label="Posibles registros repetidos">
            <button type="button" class="loan-dup__summary" data-app-fn="toggleLoanDuplicateReview" data-arg="${escapeAttr(String(scope))}" aria-expanded="${isOpen}">
                <span class="loan-dup__icon" aria-hidden="true">${icons.get('alert', { size: 18 })}</span>
                <span class="loan-dup__title">
                    <strong>Posibles registros repetidos</strong>
                    <small>${escapeHTML(countText(result.counts))}</small>
                </span>
                <span class="loan-dup__toggle">${isOpen ? 'Ocultar' : 'Revisar'} ${icons.get(isOpen ? 'chevron-up' : 'chevron-down', { size: 14 })}</span>
            </button>
            ${isOpen ? `
                <div class="loan-dup__body">
                    ${result.loans.length ? `
                        <h4>Abonos e intereses anotados más de una vez</h4>
                        <p class="loan-dup__hint">Las copias marcadas se anulan; el registro original se conserva. Anular no borra: queda en el historial y se puede restaurar.</p>
                        ${result.loans.map(item => loanCard(item, loansById.get(item.loanId))).join('')}
                        <div class="loan-dup__actions">
                            <button type="button" class="loan-dup__apply" data-app-fn="voidSelectedLoanDuplicates" ${selectedCount ? '' : 'disabled'}>
                                Anular ${selectedCount} copia${selectedCount === 1 ? '' : 's'} marcada${selectedCount === 1 ? '' : 's'}
                            </button>
                        </div>` : ''}
                    ${result.loanPairs.length ? `
                        <h4>Préstamos que parecen el mismo</h4>
                        <p class="loan-dup__hint">Mismo empleado y monto, con inicio a 3 días o menos. Si uno ya tiene abonos, conserva ese.</p>
                        ${result.loanPairs.map(loanPairCard).join('')}` : ''}
                </div>` : ''}
        </section>`;
}

// ─── Acciones ────────────────────────────────────────────────────────────────

function rerender() {
    try { (typeof window !== 'undefined' && window.render)?.(); } catch (_) {}
}

function alertMsg(message) {
    if (typeof window === 'undefined') return;
    (window.showAlert || window.showNotification)?.(message, 'error');
}

export function toggleLoanDuplicateReview(scope) {
    const key = String(scope || 'general');
    if (openScopes.has(key)) openScopes.delete(key);
    else openScopes.add(key);
    rerender();
}

export function toggleLoanDuplicateRecord(loanId, recordId) {
    const result = findLoanRecordDuplicates(scopedEmployees());
    const item = result.loans.find(entry => entry.loanId === String(loanId));
    if (!item) return;
    const selected = selectedFor(item);
    if (selected.has(String(recordId))) selected.delete(String(recordId));
    else selected.add(String(recordId));
    rerender();
}

export function dismissLoanDuplicateGroup(employeeId, key) {
    const emp = findEmployee(employeeId);
    if (!emp) return;
    const result = findLoanRecordDuplicates([emp]);
    const pair = result.loanPairs.find(entry => entry.key === key);
    const item = result.loans.find(entry => entry.groups.some(group => group.key === key));
    const loanIds = pair ? pair.loans.map(loan => loan.id) : item ? [item.loanId] : [];
    if (loanIds.length === 0) return;
    try {
        dismissDuplicateGroup(emp, loanIds, key);
        if (item) {
            const group = item.groups.find(entry => entry.key === key);
            const selected = selections.get(item.loanId);
            group?.copies.forEach(copy => selected?.delete(copy.id));
        }
        saveApplicationData({ immediate: true, announce: pair ? 'Se conservan ambos préstamos' : 'Marcado como registro real' });
        rerender();
    } catch (error) {
        alertMsg(`❌ ${error.message}`);
    }
}

/** Lo marcado, agrupado por empleado/préstamo y validado contra los datos actuales. */
function collectSelection() {
    const result = findLoanRecordDuplicates(scopedEmployees());
    return result.loans
        .map(item => {
            const selected = selectedFor(item);
            const records = item.groups.flatMap(group => group.copies
                .filter(copy => selected.has(copy.id))
                .map(copy => ({ kind: group.kind, id: copy.id, amount: copy.amount })));
            return { ...item, records };
        })
        .filter(item => item.records.length > 0);
}

export function voidSelectedLoanDuplicates() {
    const work = collectSelection();
    const total = work.reduce((sum, item) => sum + item.records.length, 0);
    if (total === 0) return;
    const apply = () => {
        const projectScope = captureEntityProjectScope();
        let done = 0;
        try {
            for (const item of work) {
                const emp = findEmployee(item.employeeId);
                if (!emp || !findLoan(emp, item.loanId)) continue;
                for (const record of item.records) {
                    if (record.kind === DUPLICATE_KINDS.PAYMENT) {
                        voidPayment(emp, item.loanId, record.id, null, { projectScope });
                    } else {
                        voidRefinancing(emp, item.loanId, record.id, null, { projectScope });
                    }
                    done += 1;
                }
                selections.delete(item.loanId);
            }
        } catch (error) {
            alertMsg(`❌ ${error.message}`);
        }
        if (done > 0) {
            saveApplicationData({ immediate: true, announce: `${done} registro${done === 1 ? '' : 's'} repetido${done === 1 ? '' : 's'} anulado${done === 1 ? '' : 's'}` });
        }
        rerender();
    };
    if (typeof window === 'undefined' || typeof window.showConfirm !== 'function') {
        alertMsg('No se pudo abrir el diálogo de confirmación. Intenta de nuevo.');
        return;
    }
    const loans = work.length;
    window.showConfirm({
        title: 'Anular registros repetidos',
        message: `Se anularán ${total} copia${total === 1 ? '' : 's'} en ${loans} préstamo${loans === 1 ? '' : 's'}. ` +
            'El registro original de cada grupo se conserva y las copias quedan en el historial como anuladas. ¿Continuar?',
        confirmText: 'Sí, anular copias',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: apply
    });
}

export function deleteDuplicateLoanFromReview(employeeId, loanId) {
    const emp = findEmployee(employeeId);
    const loan = findLoan(emp, loanId);
    if (!emp || !loan) return;
    if (typeof window === 'undefined' || typeof window.showConfirm !== 'function') {
        alertMsg('No se pudo abrir el diálogo de confirmación. Intenta de nuevo.');
        return;
    }
    const payments = (loan.payments || []).filter(item => !item.voided).length;
    window.showConfirm({
        title: 'Eliminar préstamo repetido',
        message: `Se eliminará el préstamo de ${escapeHTML(formatCurrency(loan.principal))} del ${escapeHTML(day(loan.startDate))}` +
            (payments ? `, junto con sus ${payments} abono${payments === 1 ? '' : 's'}` : '') +
            '. El otro préstamo queda intacto. Esta acción se propaga a los demás dispositivos y no se puede deshacer. ¿Continuar?',
        confirmText: 'Sí, eliminar este',
        cancelText: 'Cancelar',
        type: 'danger',
        onConfirm: () => {
            try {
                const current = findEmployee(employeeId);
                if (!current) return;
                resolveDuplicateByDeleting(current, loanId);
                saveApplicationData({ immediate: true, announce: 'Préstamo repetido eliminado' });
                rerender();
            } catch (error) {
                alertMsg(`❌ ${error.message}`);
            }
        }
    });
}

export function registerLoanDuplicateReviewGlobals() {
    if (typeof window === 'undefined') return;
    window.toggleLoanDuplicateReview = toggleLoanDuplicateReview;
    window.toggleLoanDuplicateRecord = toggleLoanDuplicateRecord;
    window.dismissLoanDuplicateGroup = dismissLoanDuplicateGroup;
    window.voidSelectedLoanDuplicates = voidSelectedLoanDuplicates;
    window.deleteDuplicateLoanFromReview = deleteDuplicateLoanFromReview;
}
