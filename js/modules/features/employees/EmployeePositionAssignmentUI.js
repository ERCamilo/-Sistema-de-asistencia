import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { Modal } from '../../components/Modal.js';
import { entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { getEmployeePositionAssignment } from './EmployeePositionAssignments.js';

function leaderOptions(leaders, selected) {
    return '<option value="">Sin líder</option>' + leaders.map(leader =>
        `<option value="${escapeAttr(leader.id)}" ${String(leader.id) === String(selected) ? 'selected' : ''}>${escapeHTML(leader.name)}${leader.active === false ? ' · archivado' : ''}</option>`).join('');
}

export function renderPositionAssignmentControls({ employee, position, leaders = [], primaryLeaderId }) {
    const value = getEmployeePositionAssignment(employee, position);
    const saved = employee?.positionAssignments?.[position.id];
    const established = value.isLoanPosition || value.payerChosen || saved?.history?.some(item => item.terms?.isLoanPosition);
    const payer = value.payerLeaderId || primaryLeaderId || '';
    const scope = peekEntityScope();
    const available = leaders.filter(leader => entityInScope(leader, scope)
        && (leader.active !== false || [value.workLeaderId, payer].includes(String(leader.id))));
    return `<div class="employee-position-leaders" data-assignment-stored="${employee?.positionAssignments?.[position.id] ? 'true' : 'false'}">
        <label>Líder del equipo<select class="form-input" data-position-work-leader>${leaderOptions(available, value.workLeaderId)}</select></label>
        <p class="employee-position-leaders__note" data-work-leader-note></p>
        <div class="employee-position-loan-switch">
            <label><span>Posición de préstamo</span><input type="checkbox" role="switch" data-position-loan-switch ${value.isLoanPosition ? 'checked' : ''}></label>
            <button type="button" class="employee-position-leaders__help" data-position-leader-help aria-label="Equipo y pagador: explicación" aria-haspopup="dialog">?</button>
        </div>
        <div class="employee-position-payer-reveal" data-position-payer-reveal data-open="${value.isLoanPosition}" aria-hidden="${!value.isLoanPosition}"><div>
            <label>Líder que paga<select class="form-input" data-position-payer data-payer-chosen="${value.payerChosen}" data-payer-established="${!!established}">${leaderOptions(available, payer)}</select></label>
            <p class="employee-position-leaders__note" data-position-payer-note></p>
        </div></div>
        <span class="employee-position-loan-badge" data-position-loan-badge aria-hidden="${!value.isLoanPosition}">Préstamo</span>
    </div>`;
}

export function attachPositionAssignmentControls(card, { list, state, employee, position }) {
    const controls = card.querySelector('.employee-position-leaders');
    const work = card.querySelector('[data-position-work-leader]');
    const loan = card.querySelector('[data-position-loan-switch]');
    const payer = card.querySelector('[data-position-payer]');
    const reveal = card.querySelector('[data-position-payer-reveal]');
    if (!controls) return;
    if (!employee?.positions?.some(value => String(value) === String(position.id))) controls.dataset.assignmentEdited = 'true';
    const mark = () => { controls.dataset.assignmentEdited = 'true'; };
    const update = () => {
        const active = loan.checked;
        if (!active && reveal.contains(document.activeElement)) loan.focus({ preventScroll: true });
        reveal.dataset.open = String(active); reveal.inert = !active; reveal.setAttribute('aria-hidden', String(!active));
        loan.setAttribute('aria-checked', String(active));
        card.classList.toggle('is-loan-position', active);
        card.querySelector('[data-position-loan-badge]').setAttribute('aria-hidden', String(!active));
        card.querySelector('[data-work-leader-note]').textContent = String(position.leaderId || '') === work.value
            ? 'Predeterminado del puesto.' : 'Solo para este empleado. El catálogo no cambia.';
        card.querySelector('[data-position-payer-note]').textContent = payer.value && payer.value === work.value
            ? 'Mismo líder: sin descuento entre nóminas.'
            : payer.dataset.payerChosen === 'true' ? 'Elección de este empleado.' : 'Sugerido desde la posición principal.';
    };
    work.addEventListener('change', () => {
        mark(); update();
        if (list.firstElementChild === card) {
            list.querySelectorAll('[data-position-payer]').forEach(other => {
                if (other.dataset.payerChosen !== 'true' && other.closest('.employee-position-leaders').dataset.assignmentStored !== 'true') {
                    other.value = work.value;
                    const host = other.closest('.employee-position-leaders');
                    host.dataset.assignmentEdited = 'true';
                    other.dispatchEvent(new Event('position-payer-suggested'));
                }
            });
        }
    });
    payer.addEventListener('position-payer-suggested', update);
    loan.addEventListener('change', () => {
        if (loan.checked && payer.dataset.payerEstablished !== 'true' && payer.dataset.payerChosen !== 'true') {
            payer.value = list.querySelector('[data-position-work-leader]')?.value || '';
            payer.dataset.payerEstablished = 'true';
        }
        mark(); update();
    });
    payer.addEventListener('change', () => { payer.dataset.payerChosen = 'true'; mark(); update(); });
    card.querySelector('[data-position-leader-help]').addEventListener('click', event => {
        const button = event.currentTarget;
        const name = value => state.leaders?.find(leader => String(leader.id) === value)?.name || 'Sin líder';
        const effectivePayer = loan.checked ? payer.value : work.value;
        const cross = loan.checked && work.value && effectivePayer && work.value !== effectivePayer;
        const node = (label, value) => `<span><small>${label}</small><strong>${escapeHTML(value)}</strong></span>`;
        const flow = (a, b, c) => `<div class="employee-position-role-flow">${a}<i aria-hidden="true">→</i>${b}<i aria-hidden="true">→</i>${c}</div>`;
        const scrollHost = card.closest('.modal-body') || list.parentElement;
        const scroll = scrollHost.scrollTop;
        const modal = new Modal({ title: 'Equipo y pagador', subtitle: 'El empleado cobra una sola vez.', size: 'small',
            content: `<div class="employee-position-role-help"><p><strong>Líder del equipo</strong><br>Se sugiere desde el puesto. Puedes cambiarlo solo para este empleado.</p><p><strong>Líder que paga</strong><br>Sin préstamo, paga el líder del equipo. Con préstamo, puedes elegir otro pagador.</p>${
                !work.value || loan.checked && !payer.value ? '<p>Selecciona los responsables para ver el recorrido.</p>' :
                    flow(node('PAGA', name(effectivePayer)), node('NÓMINA DE', name(effectivePayer)), node('RECIBE', employee?.name || 'Empleado'))
                    + (cross ? flow(node('EQUIPO', name(work.value)), node('SU NÓMINA', 'Descuento'), node('AJUSTE', 'Importe del trabajo')) : '<p>Sin descuento entre nóminas.</p>')
            }</div>`, buttons: [{ text: 'Entendido', class: 'btn-primary', onClick() { this.close(); } }],
            onClose() { scrollHost.scrollTop = scroll; button.focus({ preventScroll: true }); }
        });
        modal.open();
    });
    update();
}
