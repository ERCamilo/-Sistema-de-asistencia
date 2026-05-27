/**
 * 🧪 ProfileLoansReadonlyTests (Unificación de préstamos)
 *
 * Garantiza que la sección de préstamos dentro del perfil del empleado
 * sea de SOLO LECTURA y dirija al usuario a Cuentas por Cobrar para
 * registrar o editar.
 *
 * Reglas que esta suite blinda:
 *   1. NO debe haber botones de addAdvance / removeAdvance / saveAdvance.
 *   2. SÍ debe haber un CTA prominente con data-app-fn="openLoansLedgerFor".
 *   3. Cuando el empleado tiene préstamos en emp.loans[], se muestran:
 *      concepto + monto + estado (no la versión legacy advances[]).
 *   4. Cuando el empleado NO tiene préstamos, hay un empty-state que
 *      invita a registrar el primero desde Cuentas por Cobrar.
 *   5. El CTA aparece tanto en empty-state como con préstamos.
 *
 * Los handlers globales (window.addAdvance etc.) permanecen definidos
 * por compatibilidad con código viejo, pero la UI ya no los invoca.
 */

import { generateLoansReadonlySection } from '../modules/features/profile/LoansReadonlySection.js';

testRunner.addSuite("Profile — Sección de préstamos read-only (Unificación)", {

    "no incluye botones de edición de advances (addAdvance/removeAdvance)"() {
        const emp = {
            id: 'eP1', name: 'Ada',
            loans: [{ id: 'L1', principal: 5000, concept: 'Reparación', status: 'active' }]
        };
        const html = generateLoansReadonlySection(emp);
        testRunner.assert(typeof html === 'string', 'Debe retornar HTML');
        testRunner.assert(!html.includes('data-app-fn="addAdvance"'),
            'NO debe haber botón data-app-fn="addAdvance" (movido al ledger)');
        testRunner.assert(!html.includes('data-app-fn="removeAdvance"'),
            'NO debe haber botón data-app-fn="removeAdvance"');
        testRunner.assert(!html.includes('data-app-fn="saveAdvance"'),
            'NO debe haber botón data-app-fn="saveAdvance"');
        testRunner.assert(!html.includes('data-app-fn="editAdvance"'),
            'NO debe haber botón data-app-fn="editAdvance"');
    },

    "incluye CTA hacia Cuentas por Cobrar (openLoansLedgerFor)"() {
        const html = generateLoansReadonlySection({ id: 'eP2', name: 'Ana', loans: [] });
        testRunner.assert(html.includes('data-app-fn="openLoansLedgerFor"'),
            'Debe haber un CTA con data-app-fn="openLoansLedgerFor"');
        testRunner.assert(html.includes('eP2'),
            'El CTA debe llevar el id del empleado actual como argumento');
    },

    "muestra préstamos reales desde emp.loans[] (no desde advances legacy)"() {
        const emp = {
            id: 'eP3', name: 'Bob',
            loans: [
                { id: 'L_A', principal: 1000, concept: 'Préstamo A', status: 'active' },
                { id: 'L_B', principal: 2500, concept: 'Compra moto', status: 'active' }
            ]
        };
        const html = generateLoansReadonlySection(emp);
        testRunner.assert(html.includes('Préstamo A'),
            'Debe mostrar el concepto del primer préstamo');
        testRunner.assert(html.includes('Compra moto'),
            'Debe mostrar el concepto del segundo préstamo');
    },

    "empty-state cuando el empleado no tiene préstamos"() {
        const html = generateLoansReadonlySection({ id: 'eP4', name: 'Carlos', loans: [] });
        testRunner.assert(/sin préstamos|no.*préstamo|sin registros/i.test(html),
            `Debe haber empty-state legible. HTML: ${html.slice(0, 200)}`);
        testRunner.assert(html.includes('data-app-fn="openLoansLedgerFor"'),
            'En empty-state también debe estar el CTA');
    },

    "tolera empleado con loans undefined (recién creado)"() {
        let threw = false;
        let html = '';
        try {
            html = generateLoansReadonlySection({ id: 'eP5', name: 'Nuevo' }); // sin loans
        } catch (e) { threw = true; }
        testRunner.assertEquals(threw, false,
            'No debe romper si emp.loans está undefined');
        testRunner.assert(html.length > 0, 'Debe renderizar algo');
        testRunner.assert(html.includes('data-app-fn="openLoansLedgerFor"'),
            'Debe seguir mostrando el CTA');
    },

    "tolera emp null/undefined sin reventar"() {
        let threw = false;
        try {
            generateLoansReadonlySection(null);
            generateLoansReadonlySection(undefined);
        } catch (e) { threw = true; }
        testRunner.assertEquals(threw, false,
            'Defensivo: no debe romper si emp es null/undefined');
    }

});

console.log('🧪 Profile loans read-only tests cargados.');
