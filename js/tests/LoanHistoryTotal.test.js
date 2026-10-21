import { state, stateManager } from '../modules/core/AppState.js';
import { buildTimeline } from '../modules/features/loans/LoanTimeline.js';
import {
    renderLoanHistoryPanel, resetLoanHistoryPanels, selectLoanHistoryBucket, setLoanHistoryRange, setLoanHistoryView
} from '../modules/features/loans/LoanHistoryPanel.js';

const employees = () => [{ id: 'e1', name: 'Ana', loans: [{
    id: 'a', principal: 1000.25, interestRate: 10, startDate: '2024-01-05', status: 'active', createdAt: 100,
    refinancings: [{ id: 'r', date: '2025-01-05', interestAmount: 20.15, basis: 'balance', createdAt: 200 }],
    payments: [{ id: 'p', date: '2026-10-10', amount: 200.5, recordedAt: 300 }]
}, {
    id: 'b', principal: 500.75, interestRate: 0, startDate: '2026-10-15', status: 'active', createdAt: 400,
    refinancings: [], payments: []
}] }];
const render = (scope = 'general', people = employees()) => renderLoanHistoryPanel({
    scope, employees: people, variant: 'portfolio', defaults: { open: true, range: '3M', view: 'period' }
});
let previousSettings;
beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-21T12:00:00Z'));
    previousSettings = state.settings;
    stateManager.setState({ settings: { ...previousSettings, payPeriod: { periodStart: '2026-10-02', periodLength: 21, payDay: '2026-10-24' } } }, { silent: true });
    resetLoanHistoryPanels();
    render();
});
afterEach(() => {
    stateManager.setState({ settings: previousSettings }, { silent: true });
    jest.useRealTimers();
});
test('el selector por periodo permite ver el acumulado y usa todo el historial aunque antes filtrara 3M', () => {
    document.body.innerHTML = render();
    expect(document.querySelector('option[value="history-total"]')?.textContent).toContain('Acumulado total');
    selectLoanHistoryBucket('general', 'history-total');
    document.body.innerHTML = render();
    expect(document.querySelector('select').value).toBe('history-total');
    expect(document.querySelector('select option').textContent).toContain('2024');
    expect(document.querySelector('[data-arg2="Todo"]').getAttribute('aria-pressed')).toBe('true');
    const bridge = document.querySelector('.lf-bridge');
    expect(bridge.textContent).toContain('Acumulado total');
    expect(bridge.textContent).toContain('05/01/2024');
    expect(bridge.textContent).toContain('15/10/2026');
    expect(document.querySelector('.lf-panel').textContent).toContain('$1,501.00');
    expect(document.querySelector('.lf-panel').textContent).toContain('$20.15');
    expect(bridge.textContent).toContain('$1,420.68');
    expect(bridge.textContent).not.toContain('en curso');
    expect(document.querySelector('.loan-history__nav').textContent).not.toMatch(/Anterior|Siguiente/);
});
test('el acumulado coincide con el saldo reproducido, no con la suma de los saldos de cada periodo', () => {
    const people = employees(); const original = JSON.stringify(people);
    selectLoanHistoryBucket('general', 'history-total');
    const html = render('general', people);
    const total = buildTimeline(people.flatMap(emp => emp.loans.map(loan => ({ employeeId: emp.id, loan }))), { financialOnly: true }).totals.balance;
    expect(total).toBe(1420.68);
    expect(html).toContain('$1,420.68');
    expect(JSON.stringify(people)).toBe(original);
});
test('cambiar el rango o la vista vuelve a la navegación normal sin alterar otros paneles', () => {
    selectLoanHistoryBucket('general', 'history-total'); render();
    setLoanHistoryRange('general', '3M');
    document.body.innerHTML = render();
    expect(document.querySelector('select').value).not.toBe('history-total');
    expect(document.querySelector('.loan-history__nav').textContent).toContain('Anterior');
    selectLoanHistoryBucket('general', 'history-total');
    setLoanHistoryView('general', 'month');
    expect(render()).not.toContain('value="history-total"');
    document.body.innerHTML = render('employee-e1');
    expect(document.querySelector('select').value).not.toBe('history-total');
});
test('el acumulado conserva el historial aunque sus últimos movimientos sean posteriores a hoy', () => {
    const people = employees(); people[0].loans[1].payments.push({ id: 'future', date: '2026-11-01', amount: 50, recordedAt: 500 });
    selectLoanHistoryBucket('general', 'history-total');
    const html = render('general', people);
    expect(html).toContain('01/11/2026');
    expect(html).toContain('$1,370.68');
});

test('el acumulado excluye préstamos anulados y abonos/refinanciamientos revertidos', () => {
    const people = employees();
    people[0].loans.push({ ...people[0].loans[1], id: 'void', status: 'written-off', principal: 90000 });
    people[0].loans[0].payments.push({ id: 'void-payment', date: '2026-10-20', amount: 900, voided: true });
    people[0].loans[0].refinancings.push({ id: 'void-refinance', date: '2026-10-20', interestAmount: 900, voided: true });
    selectLoanHistoryBucket('general', 'history-total');
    document.body.innerHTML = render('general', people);
    expect(document.querySelector('.lf-bridge__s').textContent).toContain('$1,420.68');
});
test('la ficha del empleado calcula sólo sus préstamos y mantiene el acumulado general independiente', () => {
    const people = [...employees(), { id: 'e2', name: 'Beto', loans: [{ ...employees()[0].loans[1], id: 'other', principal: 800 }] }];
    selectLoanHistoryBucket('general', 'history-total');
    document.body.innerHTML = render('general', people);
    expect(document.querySelector('.lf-bridge__s').textContent).toContain('$2,220.68');
    render('e1', [people[0]]); selectLoanHistoryBucket('e1', 'history-total');
    document.body.innerHTML = render('e1', [people[0]]);
    expect(document.querySelector('.lf-bridge__s').textContent).toContain('$1,420.68');
});
