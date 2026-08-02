import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(
    path.resolve(__dirname, '../../css/payroll-redesign.css'),
    'utf8'
);

describe('Installment payment options styles', () => {
    test('lays out the three payment choices as equal desktop columns', () => {
        expect(css).toMatch(
            /\.loan-payment-plan\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/
        );
        expect(css).toMatch(/\.loan-payment-plan__option\.is-active\s*\{[^}]*border-color:\s*#10b973;/);
    });

    test('keeps keyboard and disabled states distinguishable', () => {
        expect(css).toContain('.loan-payment-plan__option:focus-visible');
        expect(css).toContain('.loan-payment-plan__option:disabled');
    });

    test('stacks the choices within the mobile breakpoint', () => {
        const mobile = css.slice(css.lastIndexOf('@media (max-width: 560px)'));

        expect(mobile).toMatch(/\.loan-payment-plan\s*\{[^}]*grid-template-columns:\s*1fr;/);
        expect(mobile).toMatch(/\.loan-payment-plan__summary\s*\{[^}]*flex-direction:\s*column;/);
    });
});
