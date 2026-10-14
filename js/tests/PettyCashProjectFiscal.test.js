/**
 * Datos fiscales de cada proyecto de caja chica: RNC de la empresa y desde
 * qué monto se anuncian las facturas de consumo.
 */
import { projectFiscal, projectFiscalFormHTML, readProjectFiscalForm } from '../modules/features/pettycash/PettyCashProjectFiscal.js';

const mount = (project) => { document.body.innerHTML = `<form>${projectFiscalFormHTML(project)}</form>`; return document.querySelector('form'); };

describe('projectFiscal', () => {
    test('lee los datos del proyecto; sin proyecto o sin datos: sin RNC y nota en todas', () => {
        expect(projectFiscal(null)).toEqual({ companyRnc: '', consumerNoteMin: 0 });
        expect(projectFiscal({ companyRnc: '101010632', consumerNoteMin: 2000 })).toEqual({ companyRnc: '101010632', consumerNoteMin: 2000 });
        expect(projectFiscal({ consumerNoteMin: -5 })).toEqual({ companyRnc: '', consumerNoteMin: 0 });
    });
});

describe('formulario de datos fiscales', () => {
    test('vacío: RNC en blanco y "en todas" marcado', () => {
        const form = mount({});
        expect(form.querySelector('[data-fiscal-rnc]').value).toBe('');
        expect(form.querySelector('input[name="consumerNote"]:checked').value).toBe('all');
        expect(form.querySelector('[data-fiscal-min]').value).toBe('');
    });

    test('con datos guardados: los muestra', () => {
        const form = mount({ companyRnc: '101010632', consumerNoteMin: 2500 });
        expect(form.querySelector('[data-fiscal-rnc]').value).toBe('101010632');
        expect(form.querySelector('input[name="consumerNote"]:checked').value).toBe('above');
        expect(form.querySelector('[data-fiscal-min]').value).toBe('2500');
    });

    test('guardar: RNC válido (con guiones) y monto mínimo', () => {
        const form = mount({});
        form.querySelector('[data-fiscal-rnc]').value = '1-01-01063-2';
        form.querySelector('input[value="above"]').checked = true;
        form.querySelector('[data-fiscal-min]').value = '2,000';
        expect(readProjectFiscalForm(form)).toEqual({ ok: true, patch: { companyRnc: '101010632', consumerNoteMin: 2000 } });
    });

    test('RNC vacío se permite (quita la revisión); "en todas" guarda 0', () => {
        const form = mount({ companyRnc: '101010632', consumerNoteMin: 500 });
        form.querySelector('[data-fiscal-rnc]').value = '';
        form.querySelector('input[value="all"]').checked = true;
        expect(readProjectFiscalForm(form)).toEqual({ ok: true, patch: { companyRnc: '', consumerNoteMin: 0 } });
    });

    test('errores: RNC con dígito verificador malo o monto inválido', () => {
        const form = mount({});
        form.querySelector('[data-fiscal-rnc]').value = '101010633';
        expect(readProjectFiscalForm(form)).toEqual({ ok: false, field: 'rnc', error: expect.stringMatching(/RNC/) });
        form.querySelector('[data-fiscal-rnc]').value = '';
        form.querySelector('input[value="above"]').checked = true;
        form.querySelector('[data-fiscal-min]').value = '0';
        expect(readProjectFiscalForm(form)).toEqual({ ok: false, field: 'min', error: expect.stringMatching(/monto/) });
    });
});
