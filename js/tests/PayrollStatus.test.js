import { renderPayrollStatus } from '../modules/features/payroll/PayrollStatus.js';

test.each([
    ['No tiene saldo suficiente', 'error', 'alert'],
    ['Pausado', 'attention', 'pause'],
    ['No está en la nómina', 'warning', 'alert']
])('status %s has text and an SVG independently of the icon theme', (text, level, icon) => {
    const host = document.createElement('div');
    host.innerHTML = renderPayrollStatus(text, level, icon);
    expect(host.querySelector(`.payroll-status--${level} svg[aria-hidden="true"]`)).not.toBeNull();
    expect(host.textContent).toBe(text);
});

test('status descriptions escape untrusted text', () => {
    const host = document.createElement('div');
    host.innerHTML = renderPayrollStatus('<img src=x onerror=alert(1)>');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('<img src=x onerror=alert(1)>');
});
