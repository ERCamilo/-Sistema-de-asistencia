import { state } from '../modules/core/AppState.js';
import { createLoan, recordPayment, refinanceLoan, consolidateLoans } from '../modules/features/loans/LoansService.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';
import { selectLoansEmployee } from '../modules/features/loans/LoansController.js';
import {
    laOpen, laField, laFieldQuiet, laSave, laSetTab, laAsk, laAdjust, laFix, laFixWhy, laVoid, laClose,
    laToggleLoan, laUseClassicView, useAccountView, laRestoreConsolidation, laUndoAllConsolidations, laApplyBackfill, laReviewPayment, lpAlertPanel, lpRiskLevel, lpTip, lpCard, lpToggleAlerts
} from '../modules/features/loans/LoanAccountController.js';
import { getAccountSummary, getAccountMovements, getActiveLoanAgreement } from '../modules/features/loans/LoanAccount.js';
import { movementKey } from '../modules/features/loans/LoanAccountView.js';
import { buildPayPeriods, nextPayPeriod } from '../modules/features/loans/LoanPayPeriods.js';
import { toggleLoanHistory, resetLoanHistoryPanels } from '../modules/features/loans/LoanHistoryPanel.js';
import { lxToggle, lxSet, lxPart } from '../modules/features/loans/LoanExportPanel.js';

let clock = 1_000;
function loan(emp, principal, startDate, extra = {}) {
    const created = createLoan(emp, { principal, interestRate: 20, startDate });
    created.createdAt = (clock += 1_000);
    Object.assign(created, extra);
    return created;
}

function seed() {
    const emp = { id: 'e012', number: '012', name: 'Empleado Prueba', active: true, loans: [], updatedAt: 0 };
    const l4 = loan(emp, 10000, '2026-08-25', { dueDate: '2026-09-12' });
    const l5 = loan(emp, 500, '2026-08-27', { dueDate: '2026-09-12' });
    refinanceLoan(emp, l4.id, { interestRate: 20, basis: 'balance', date: '2026-09-12', nextDueDate: '2026-10-03' });
    recordPayment(emp, l4.id, { amount: 6600, date: '2026-09-12', source: 'payroll', payrollClosureId: 'CL-0912', payrollPeriodStart: '2026-08-21', payrollPeriodEnd: '2026-09-10', recordedAt: (clock += 1_000) });
    Object.assign(l4.refinancings[0], { interestAmount: 1080, baseAmount: 5400 });
    refinanceLoan(emp, l5.id, { interestRate: 20, basis: 'balance', date: '2026-09-12', nextDueDate: '2026-10-03' });
    loan(emp, 3000, '2026-09-14', { dueDate: '2026-10-03' });
    loan(emp, 1000, '2026-09-19', { dueDate: '2026-10-03' });
    loan(emp, 500, '2026-09-22', { dueDate: '2026-10-03' });
    state.employees = [emp];
    state.settings = { ...(state.settings || {}), payPeriod: { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' } };
    selectLoansEmployee('e012');
    // El estado guarda su propia copia: se trabaja sobre la del estado.
    const live = state.employees[0];
    return { emp: live, l4: live.loans.find(l => l.id === l4.id) };
}

const html = () => { document.body.innerHTML = LoansLedger(); return document.body; };
const text = () => html().textContent.replace(/\s+/g, ' ');

beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-10-03T12:00:00'), doNotFake: ['requestAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask'] });
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
    localStorage.removeItem('loans-account-view');
    // Como si el usuario hubiera dejado abiertos los avisos, el historial y «Por cobrar»
    // (por defecto todo empieza plegado; eso se prueba aparte).
    localStorage.setItem('loans-main-ui', JSON.stringify({ alertsOpen: true, historyOpen: true, historyView: 'period', asideCard: 'cobrar' }));
    resetLoanHistoryPanels();
    state.loansLedger = undefined;
    window.showAlert = jest.fn();
});

describe('LoanPayPeriods', () => {
    test('proyecta las nóminas con el mismo día de pago que la configuración', () => {
        // El 03/10 ya corre el periodo 02/10–22/10, pero ese día se paga el anterior.
        const periods = buildPayPeriods({ periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' }, '2026-10-03', { before: 1, after: 1 });
        expect(periods.map(p => p.label)).toEqual(['11/09 – 01/10 · pago 03/10', '02/10 – 22/10 · pago 24/10', '23/10 – 12/11 · pago 14/11']);
        expect(nextPayPeriod(periods, '2026-10-03').payDate).toBe('2026-10-03');
        expect(buildPayPeriods(null, '2026-10-03')).toEqual([]);
    });
});

describe('Ficha cuenta de préstamos', () => {
    test('muestra la tarjeta principal, botones, pestañas y préstamos numerados', () => {
        seed();
        expect(useAccountView()).toBe(true);
        const t = text();
        expect(t).toContain('Debe en total · 5 préstamos abiertos');
        expect(t).toContain('$12,600.00');
        expect(t).toContain('Próxima nómina · pago 03/10');
        for (const label of ['Abonar', 'Refinanciar', '+ Préstamo', 'Acuerdo', 'Movimientos de la cuenta']) expect(t).toContain(label);
        expect(document.querySelectorAll('.la-row .la-idx')[0].textContent).toBe('#1');
        expect(t).toContain('🔒 con cierre');
        expect(t).toContain('Se cobra hoy');
    });

    test('abonar a la cuenta reparte, guarda y aparece en movimientos', () => {
        const { emp } = seed();
        laOpen('pay');
        laField('amount', '3000');
        expect(text()).toContain('Reparto · interés de todos, luego capital del más viejo');
        laSave();
        expect(getAccountSummary(emp).balance).toBe(9600);
        expect(state.loansLedger.account.modal).toBeNull();
        laSetTab('mov');
        expect(text()).toContain('Abono a la cuenta');
        const pays = emp.loans.flatMap(l => l.payments).filter(p => p.origin === 'account');
        expect(pays).toHaveLength(5);
        expect(pays[0]).toMatchObject({ channel: 'payroll', payrollPeriodEnd: '2026-10-01' });
    });

    test('un abono de una nómina cerrada ofrece ajuste o corregir el cierre', () => {
        const { emp } = seed();
        laSetTab('mov');
        const mv = getAccountMovements(emp).find(m => m.kind === 'payment');
        const key = movementKey(mv);
        laAsk(key, 'acc');
        const t = text();
        expect(t).toContain('Ajuste en la nómina abierta');
        expect(t).toContain('Corregir el cierre (fue un error)');
        laFix(key); // sin motivo
        expect(window.showAlert).toHaveBeenCalled();
        laAdjust(key, '2026-10-03');
        expect(getAccountSummary(emp).balance).toBe(19200);
        expect(text()).toContain('Ajuste: se anula un abono de una nómina cerrada');
    });

    test('corregir el cierre guarda el motivo y el antes y después', () => {
        const { emp } = seed();
        const key = movementKey(getAccountMovements(emp).find(m => m.kind === 'payment'));
        laAsk(key, 'acc');
        laFixWhy('se registró dos veces');
        laFix(key);
        const pay = emp.loans[0].payments[0];
        expect(pay.closureFix).toMatchObject({ reason: 'se registró dos veces', before: { accountBalance: 12600 }, after: { accountBalance: 19200 } });
    });

    test('refinanciar exige motivo y mueve la nómina de cobro', () => {
        const { emp } = seed();
        laOpen('refi');
        laSave();
        expect(window.showAlert).toHaveBeenCalled();
        laField('reason', 'payroll-short');
        laSave();
        expect(getAccountSummary(emp).balance).toBe(15120);
        expect(emp.loans[2].refinancings[0]).toMatchObject({ reason: 'payroll-short', nextDueDate: '2026-10-24', origin: 'account' });
    });

    test('editar un préstamo con cierre pide motivo; nuevo préstamo guarda su nómina', () => {
        const { emp, l4 } = seed();
        laOpen('edit', l4.id);
        laField('amount', '9000');
        laSave();
        expect(window.showAlert).toHaveBeenCalled();
        laFieldQuiet('reason', 'eran 9,000');
        laSave();
        expect(l4.principal).toBe(9000);
        expect(l4.edits[0]).toMatchObject({ closureEdit: true });

        laOpen('loan');
        laField('amount', '2000');
        laSave();
        const created = emp.loans.at(-1);
        expect(created).toMatchObject({ principal: 2000, dueDate: '2026-10-03' });
    });

    test('acuerdo de pago y anular préstamo con motivo', () => {
        const { emp } = seed();
        laOpen('agree');
        laField('amount', '3000');
        laSave();
        expect(getActiveLoanAgreement(emp).amount).toBe(3000);
        expect(text()).toContain('Con acuerdo: $3,000 por nómina');

        const last = emp.loans.at(-1);
        laOpen('close', last.id);
        laField('reason', 'forgiven');
        laSave();
        expect(last.closure.reason).toBe('forgiven');
        laToggleLoan(last.id);
        laVoid(`close|${last.id}`);
        expect(last.status).toBe('active');
        laClose();
    });

    test('se puede volver a la vista anterior y regresar', () => {
        seed();
        laUseClassicView(1);
        expect(text()).toContain('Estás en la ficha anterior');
        laUseClassicView(0);
        expect(text()).toContain('Debe en total');
    });

    test('el historial y el aviso de repetidos van dentro de la tarjeta principal', () => {
        resetLoanHistoryPanels();
        const { emp, l4 } = seed();
        // un abono repetido para que aparezca el aviso
        const dup = { ...l4.payments[0], id: 'dup-1', recordedAt: l4.payments[0].recordedAt + 1000, payrollClosureId: undefined };
        l4.payments.push(dup);
        const body = html();
        const hub = body.querySelector('.la-hub');
        expect(hub.textContent).toContain('Ver historial');
        expect(body.textContent).not.toContain('Saldo del empleado');
        expect(hub.querySelector('.loan-dup--embedded')).not.toBeNull();
        toggleLoanHistory(String(emp.id));
        const open = html().querySelector('.la-hub');
        expect(open.querySelector('.loan-history.is-embedded')).not.toBeNull();
        expect(open.textContent).toContain('Evolución del saldo');
        expect(open.textContent).toContain('Ocultar historial');
    });

    test('el historial muestra un ajuste de nómina cerrada sin fallar', () => {
        resetLoanHistoryPanels();
        const { emp } = seed();
        const key = movementKey(getAccountMovements(emp).find(m => m.kind === 'payment'));
        laAdjust(key, '2026-10-03');
        toggleLoanHistory(String(emp.id));
        expect(text()).toContain('Ajuste de una nómina cerrada');
    });

    test('una consolidación se revisa, se deshace y se puede volver a consolidar', () => {
        const { emp } = seed();
        const [, , l6, l7] = emp.loans;
        const { consolidatedLoan } = consolidateLoans(emp, { loanIds: [l6.id, l7.id], installmentCount: 1, interestRate: 0, startDate: '2026-09-25' });
        const cons = emp.loans.find(l => l.id === consolidatedLoan.id);
        const before = getAccountSummary(emp).balance;
        expect(text()).toContain('Consolidación por deshacer');
        laOpen('unconsolidate', cons.id);
        expect(text()).toContain('Lo que debe en total no cambia');
        laSave();
        expect(getAccountSummary(emp).balance).toBe(before);
        expect(cons.consolidationUndone).toBeTruthy();
        expect(emp.loans.find(l => l.id === l6.id).status).toBe('active');
        expect(text()).not.toContain('Consolidación por deshacer');
        laRestoreConsolidation(cons.id);
        expect(cons.status).toBe('active');
        expect(text()).toContain('Consolidación por deshacer');
    });

    test('«Deshacer todas» en la pantalla principal separa todas las consolidaciones', () => {
        const { emp } = seed();
        const [, , l6, l7, l8] = emp.loans;
        consolidateLoans(emp, { loanIds: [l6.id, l7.id, l8.id], installmentCount: 1, interestRate: 0, startDate: '2026-09-25' });
        const before = getAccountSummary(emp).balance;
        state.loansLedger.selectedEmployeeId = null;
        expect(text()).toContain('1 consolidación por deshacer');
        window.showConfirm = o => o.onConfirm();
        laUndoAllConsolidations();
        delete window.showConfirm;
        expect(getAccountSummary(emp).balance).toBe(before);
        expect(text()).not.toContain('consolidación por deshacer');
    });

    test('«Completar datos» y la revisión de abonos en la pantalla principal', () => {
        const { emp } = seed();
        emp.loans.forEach(l => { delete l.dueDate; delete l.number; });
        const l6 = emp.loans[2];
        recordPayment(emp, l6.id, { amount: 100, date: '2026-09-20', recordedAt: (clock += 1_000) }); // fuera de los días de pago
        state.loansLedger.selectedEmployeeId = null;
        expect(text()).toContain('Datos de préstamos por completar');
        window.showConfirm = o => o.onConfirm();
        laApplyBackfill();
        delete window.showConfirm;
        expect(emp.loans.map(l => l.number)).toEqual([1, 2, 3, 4, 5]);
        expect(emp.loans[2].dueDate).toBe('2026-10-03');
        const t = text();
        expect(t).not.toContain('Datos de préstamos por completar');
        expect(t).toContain('1 abono por revisar');
        const pay = emp.loans[2].payments.at(-1);
        laReviewPayment(`${emp.id}|${l6.id}|${pay.id}`, 'direct');
        expect(emp.loans[2].payments.at(-1)).toMatchObject({ origin: 'direct', needsReview: false });
        expect(text()).not.toContain('abono por revisar');
    });

    test('pantalla principal: línea del mes, avisos con riesgo y resumen de cartera', () => {
        seed();
        state.loansLedger.selectedEmployeeId = null;
        const t = text();
        expect(t).toContain('Octubre: lo que deben');
        expect(t).toContain('Avisos que necesitan una decisión');
        expect(t).toContain('Resumen de cartera');
        expect(t).toContain('Por cobrar$12,600.00');
        expect(t).toContain('1 empleado en riesgo');
        lpAlertPanel('risk');
        const r = text();
        expect(r).toContain('Cómo se clasifica');
        expect(r).toContain('Qué hacer');
        lpRiskLevel(3);
        expect(text()).toContain('Todos 1');
        lpAlertPanel('risk');
    });

    test('pantalla principal con el diseño de la maqueta: lista, (i) del mes, tarjetas del teléfono e historial', () => {
        seed();
        state.loansLedger.selectedEmployeeId = null;
        const body = html();
        const row = body.querySelector('.lp-emp');
        expect(row.querySelector('.lp-who2 small').textContent).toBe('Creado 25/08/202612/09/2026 · 5 préstamos');
        expect(row.querySelector('.lp-rdot')).not.toBeNull();
        expect(row.querySelector('.lp-bal b').textContent).toBe('$12,600.00');
        expect(body.querySelector('.lp-vt[aria-selected="true"]').textContent).toBe('Con saldo1');
        expect(body.querySelector('.lp-sort [aria-pressed="true"]').textContent).toContain('Monto');
        expect(body.querySelector('.lp-add').textContent).toBe('+ Agregar nuevo');
        // Historial: cabecera de la maqueta y sin botones de rango en «Por periodo».
        expect(body.querySelector('.lp-hist-s').textContent).toContain('Historial del saldo');
        expect(body.querySelector('.is-portfolio-hist .loan-history__ranges')).toBeNull();
        expect(body.querySelector('.lf-foot')).not.toBeNull();
        expect(body.querySelector('.lp-pop')).toBeNull();
        lpTip('month');
        const tip = html().querySelector('.lp-pop').textContent.replace(/\s+/g, ' ');
        expect(tip).toContain('Cómo cambió en octubre');
        expect(tip).toContain('En septiembre no cambió');
        expect(tip).toContain('Usar la vista anterior');
        lpTip('month');
        expect(html().querySelector('.lp-pop')).toBeNull();
        lpCard('cobrar');
        const detail = html().querySelector('.lp-mobile .lp-mdetail');
        expect(detail.textContent).toContain('Capital por devolver');
        expect(html().querySelector('.lp-mcard[aria-expanded="true"]').textContent).toContain('Por cobrar');
    });

    test('los botones de la pantalla principal funcionan aunque todavía no exista el estado de Préstamos', () => {
        seed();
        state.loansLedger = undefined;
        lpCard('ganado');
        expect(state.loansLedger.portfolio.card).toBe('ganado');
        expect(html().querySelector('.lp-mdetail').textContent).toContain('Ganado del interés inicial');
        // Panel derecho: una cifra abierta a la vez; «Por cobrar» por defecto.
        expect(html().querySelector('.lp-aside .lp-card.is-open').dataset.card).toBe('cobrar');
        lpCard('cobrado', 'aside');
        const open = html().querySelectorAll('.lp-aside .lp-card.is-open');
        expect([...open].map(c => c.dataset.card)).toEqual(['cobrado']);
        expect(open[0].textContent).toContain('Cómo entró');
        lpCard('cobrado', 'aside');
        expect(html().querySelector('.lp-aside .lp-card.is-open')).toBeNull();
    });

    test('exportar: el panel cambia de formato y rango y muestra la vista previa', () => {
        seed();
        state.loansLedger.selectedEmployeeId = null;
        expect(html().querySelector('.lp-xp')).toBeNull();
        lxToggle();
        let panel = html().querySelector('.lp-xp');
        expect(panel.textContent).toContain('Descargar Excel');
        expect(panel.textContent).toContain('Vista previa · octubre 2026');
        lxSet('range', 'month');
        lxSet('month', '2026-09');
        panel = html().querySelector('.lp-xp');
        const t = panel.textContent.replace(/\s+/g, ' ');
        expect(t).toContain('Vista previa · septiembre 2026');
        expect(t).toContain('+ Préstamos nuevos (3) con su interés$5,400.00');
        expect(t).toContain('Saldo al terminar$12,600.00');
        lxSet('fmt', 'pdf');
        expect(html().querySelector('.lp-xp').textContent).toContain('Descargar PDF');
        lxSet('range', 'period');
        expect(html().querySelector('.lp-xp').textContent).toContain('Vista previa · periodo 02/10/2026 – 22/10/2026');
        // Sin partes marcadas no se puede descargar.
        ['resumen', 'empleados', 'prestamos', 'movimientos', 'historial'].forEach(lxPart);
        expect(html().querySelector('.lp-xp [data-app-fn="lxDownload"]').disabled).toBe(true);
        lxToggle();
        expect(html().querySelector('.lp-xp')).toBeNull();
    });

    test('pantalla principal: todo lo desplegable empieza plegado y se recuerda lo que el usuario abre', () => {
        localStorage.removeItem('loans-main-ui');
        resetLoanHistoryPanels();
        seed();
        state.loansLedger.selectedEmployeeId = null;
        let body = html();
        expect(body.querySelector('.lp-alerts .lp-alert')).toBeNull();
        expect(body.querySelector('.lp-alerts__toggle').textContent).toBe('Ver');
        expect(body.querySelector('.lp-hist-s').getAttribute('aria-expanded')).toBe('false');
        expect(body.querySelector('.lp-aside .lp-card.is-open')).toBeNull();
        lpToggleAlerts();
        toggleLoanHistory('general');
        lpCard('ganado', 'aside');
        expect(JSON.parse(localStorage.getItem('loans-main-ui'))).toMatchObject({ alertsOpen: true, historyOpen: true, asideCard: 'ganado' });
        // Otra visita (estado nuevo): se abre como lo dejó.
        state.loansLedger = undefined;
        resetLoanHistoryPanels();
        seed();
        state.loansLedger.selectedEmployeeId = null;
        body = html();
        expect(body.querySelector('.lp-alerts .lp-alert')).not.toBeNull();
        expect(body.querySelector('.lp-hist-s').getAttribute('aria-expanded')).toBe('true');
        expect(body.querySelector('.lp-aside .lp-card.is-open').dataset.card).toBe('ganado');
    });

    test('el movimiento del préstamo muestra capital (azul) e interés (amarillo)', () => {
        const { emp } = seed();
        laSetTab('mov');
        const body = html();
        const row = [...body.querySelectorAll('.la-mv')].find(r => r.textContent.includes('Préstamo #3'));
        expect(row.querySelector('.la-mv__a .la-t-cap').textContent).toBe('$3,000 capital');
        expect(row.querySelector('.la-mv__a .la-t-int').textContent).toBe('$600 interés');
        expect(emp.loans.length).toBe(5);
    });
});
