import { renderLoanPayAdvanced, attachLoanPayAdvanced, readLoanPayAdvanced } from '../modules/features/employees/PositionLoanPayEditor.js';
import { Position } from '../modules/features/employees/Position.js';

const settings = { overtimeFactor: 1.5, holidayFactor: 2, restDayFactor: 1.5 };
function mount(position) {
    document.body.innerHTML = `<form>${renderLoanPayAdvanced(position, { settings })}</form>`;
    const root = document.querySelector('form');
    attachLoanPayAdvanced(root);
    return root;
}
const choose = (root, concept, source, factor) => {
    const select = root.querySelector(`[data-loan-pay-source="${concept}"]`);
    select.value = source; select.dispatchEvent(new Event('change', { bubbles: true }));
    if (factor !== undefined) root.querySelector(`[data-loan-pay-factor="${concept}"]`).value = factor;
};
afterEach(() => { document.body.innerHTML = ''; });

test('a job without settings shows the section closed, with the defaults selected', () => {
    const root = mount({ id: 'p', name: 'Ayudante' });
    const toggle = root.querySelector('[data-loan-pay-toggle]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('#loanPayAdvanced').hidden).toBe(true);
    expect(['restDay', 'holiday', 'overtime'].map(concept => root.querySelector(`[data-loan-pay-source="${concept}"]`).value)).toEqual(['team', 'general', 'general']);
    expect(readLoanPayAdvanced(root)).toEqual({ value: null, error: null });
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('#loanPayAdvanced').hidden).toBe(false);
    expect(root.textContent).toContain('Solo para empleados que tienen este puesto como préstamo');
});

test('saved settings open the section and are read back unchanged', () => {
    const loanPay = { restDay: { source: 'payer' }, holiday: { source: 'custom', factor: 3 } };
    const root = mount({ id: 'p', name: 'Ayudante', loanPay });
    expect(root.querySelector('#loanPayAdvanced').hidden).toBe(false);
    expect(root.querySelector('[data-loan-pay-factor="holiday"]').value).toBe('3');
    expect(readLoanPayAdvanced(root)).toEqual({ value: loanPay, error: null });
});

test('the factor field only appears for "Factor propio"', () => {
    const root = mount({ id: 'p', name: 'Ayudante' });
    const field = root.querySelector('[data-loan-pay-factor="restDay"]').closest('[data-loan-pay-custom]');
    expect(field.hidden).toBe(true);
    choose(root, 'restDay', 'custom');
    expect(field.hidden).toBe(false);
    choose(root, 'restDay', 'payer');
    expect(field.hidden).toBe(true);
});

test('choices are read as the stored setting, and the defaults store nothing', () => {
    const root = mount({ id: 'p', name: 'Ayudante' });
    choose(root, 'restDay', 'custom', '2.5'); choose(root, 'overtime', 'custom', '2');
    expect(readLoanPayAdvanced(root)).toEqual({ value: { restDay: { source: 'custom', factor: 2.5 }, overtime: { source: 'custom', factor: 2 } }, error: null });
    choose(root, 'restDay', 'team'); choose(root, 'overtime', 'general');
    expect(readLoanPayAdvanced(root).value).toBeNull();
});

test.each([['', 'día libre'], ['0.5', 'día libre'], ['9', 'día libre'], ['abc', 'día libre']])('an own factor of "%s" is refused with a message that names the field', (factor, label) => {
    const root = mount({ id: 'p', name: 'Ayudante' });
    choose(root, 'restDay', 'custom', factor);
    const { value, error } = readLoanPayAdvanced(root);
    expect(value).toBeNull();
    expect(error).toContain(label);
    expect(error).toContain('entre 1 y 5');
});

test('clearing a saved setting is stored as an explicit empty value, so it also clears in the cloud', () => {
    expect(new Position({ id: 'p', name: 'A', loanPay: null }).toJSON().loanPay).toBeNull();
    expect('loanPay' in new Position({ id: 'p', name: 'A' }).toJSON()).toBe(false);
});

test('every control has a label', () => {
    const root = mount({ id: 'p', name: 'Ayudante' });
    for (const control of root.querySelectorAll('select, input')) expect(control.labels.length || control.getAttribute('aria-label')).toBeTruthy();
});
