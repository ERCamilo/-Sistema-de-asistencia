import { askLeaderChangeStart, leaderChangeDateRange, normalizeLeaderChangeDate } from '../modules/features/employees/LeaderChangeDateDialog.js';

const state = { settings: { payPeriod: { periodStart: '2026-11-01', periodLength: 15 } } };
const TODAY = new Date('2026-11-08T10:00:00');
const overlay = () => [...document.querySelectorAll('[data-modal-overlay]')].at(-1);
const button = label => [...overlay().querySelectorAll('button')].find(item => item.textContent.trim() === label);
const open = (extra = {}) => askLeaderChangeStart(state, { subject: 'El puesto «Ayudante»', days: 4, today: TODAY, ...extra });
afterEach(() => { document.body.innerHTML = ''; });

test('the custom date is limited to the open period up to today', () => {
    const range = leaderChangeDateRange(state, TODAY);
    expect(range).toEqual({ periodStart: '2026-11-01', today: '2026-11-08' });
    expect(normalizeLeaderChangeDate('2026-11-05', range)).toBe('2026-11-05');
    for (const value of ['2026-10-31', '2026-11-09', '', '05/11/2026', null]) expect(normalizeLeaderChangeDate(value, range)).toBeNull();
});

test('by default the change applies to the whole open period', async () => {
    const answer = open();
    expect(overlay().textContent).toContain('4 días registrados');
    expect(overlay().querySelector('input[value="period"]').checked).toBe(true);
    button('Aplicar cambio').click();
    await expect(answer).resolves.toBe('2026-11-01');
});

test('choosing a date returns that date; typing in the date field selects that option', async () => {
    const answer = open();
    const field = overlay().querySelector('#leaderChangeFrom');
    expect([field.min, field.max, field.value]).toEqual(['2026-11-01', '2026-11-08', '2026-11-08']);
    field.dispatchEvent(new Event('focus'));
    expect(overlay().querySelector('input[value="date"]').checked).toBe(true);
    field.value = '2026-11-05';
    button('Aplicar cambio').click();
    await expect(answer).resolves.toBe('2026-11-05');
});

test('a date outside the open period is refused and explained, without closing', () => {
    open();
    overlay().querySelector('input[value="date"]').checked = true;
    overlay().querySelector('#leaderChangeFrom').value = '2026-10-20';
    button('Aplicar cambio').click();
    expect(overlay().querySelector('#leaderChangeError').textContent).toContain('entre el 01/11/2026 y el 08/11/2026');
});

test('cancelling or closing answers nothing, so the caller saves nothing', async () => {
    const cancelled = open(); button('Cancelar').click();
    await expect(cancelled).resolves.toBeNull();
    const closed = open(); overlay().querySelector('[data-modal-close]').click();
    await expect(closed).resolves.toBeNull();
});

test('names typed by users are shown as text', () => {
    open({ subject: '<img src=x onerror=alert(1)>' });
    expect(overlay().querySelector('.modal-body img')).toBeNull();
});
