import { describePayRateChange, payRateChanged, notifyPayRateChange } from '../modules/features/payroll/PayRateChangeNotice.js';
import { Modal } from '../modules/components/Modal.js';

const state = { settings: { payPeriod: { periodStart: '2026-11-01', periodLength: 15 } } };

test('the notice names the first day of the open pay period and what stays untouched', () => {
    const notice = describePayRateChange(state, { subject: 'Puesto «Ayudante»' });
    expect(notice.effectiveFrom).toBe('2026-11-01');
    expect(notice.message).toContain('01/11/2026');
    expect(notice.message).toContain('Puesto «Ayudante»: el nuevo pago rige desde el');
    expect(notice.message).toContain('días ya registrados');
    expect(notice.message).toContain('nóminas cerradas no cambian');
});

test('without a configured pay period it falls back to the first day of the current month', () => {
    const notice = describePayRateChange({ settings: {} }, { subject: 'x', today: new Date('2026-11-20T10:00:00') });
    expect(notice.effectiveFrom).toBe('2026-11-01');
});

test('remote names cannot inject markup into the popup', () => {
    expect(describePayRateChange(state, { subject: '<img src=x onerror=alert(1)>' }).message).not.toContain('<img');
});

test.each([[100, 100, false], [100, 120, true], [null, 2, true], [2, null, true], [null, undefined, false], ['', 0, false], [0.1 + 0.2, 0.3, false]])(
    'only a real difference counts as a change (%s → %s)', (before, after, expected) => {
        expect(payRateChanged(before, after)).toBe(expected);
    });

test('the popup is shown once, with a single acknowledge button', async () => {
    const alert = jest.spyOn(Modal, 'alert').mockResolvedValue();
    await notifyPayRateChange(state, { subject: 'Días libres del líder «Luis»' });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toMatchObject({ title: 'El cambio aplica a todo el período abierto', buttonText: 'Entendido' });
    alert.mockRestore();
});
