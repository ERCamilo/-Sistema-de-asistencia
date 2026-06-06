/**
 * 🧪 ManualGroupValidatorTests (Tarea #21)
 *
 * Función pura validateManualGroup(members) que decide si las
 * decisiones del usuario sobre un grupo manual son consistentes y
 * cuáles son las acciones a ejecutar.
 *
 * Cada miembro lleva un campo extra `role`:
 *   - 'master'   → el "ganador" del grupo. Exactamente uno.
 *   - 'absorb'   → fusionar en el master.
 *   - 'separate' → no es la misma persona; reasignar a otra ficha.
 *   - null       → indeciso.
 *
 * Salida:
 *   {
 *     ok: boolean,
 *     errors: string[],   // mensajes legibles
 *     masterId: string | null,
 *     absorbIds: string[],
 *     separateIds: string[]
 *   }
 */

import { validateManualGroup } from '../modules/services/ManualGroupValidator.js';

function m(id, role = null) {
    return { id, name: id, number: '001', role };
}

testRunner.addSuite("validateManualGroup — invariantes básicos", {

    "input vacío → ok=false con error claro"() {
        const r = validateManualGroup([]);
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(r.errors.length > 0);
    },

    "null/undefined no rompe"() {
        let threw = false;
        try { validateManualGroup(null); validateManualGroup(undefined); }
        catch (e) { threw = true; }
        testRunner.assertEquals(threw, false);
    },

    "miembro único con rol 'master' → ok pero sin fusiones ni reasignaciones"() {
        const r = validateManualGroup([m('a', 'master')]);
        testRunner.assertEquals(r.ok, true);
        testRunner.assertEquals(r.masterId, 'a');
        testRunner.assertEquals(r.absorbIds.length, 0);
        testRunner.assertEquals(r.separateIds.length, 0);
    }

});

testRunner.addSuite("validateManualGroup — regla del master", {

    "exactamente UN master → ok"() {
        const r = validateManualGroup([m('a', 'master'), m('b', 'absorb')]);
        testRunner.assertEquals(r.ok, true);
        testRunner.assertEquals(r.masterId, 'a');
        testRunner.assertEquals(r.absorbIds.join(','), 'b');
    },

    "dos masters → error"() {
        const r = validateManualGroup([m('a', 'master'), m('b', 'master')]);
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(r.errors.some(e => /maestro|master/i.test(e)),
            `Mensaje claro de "más de un maestro". Errors: ${r.errors.join(';')}`);
    },

    "sin master pero hay 'absorb' → error (no se sabe en quién fusionar)"() {
        const r = validateManualGroup([m('a', 'absorb'), m('b', 'absorb')]);
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(r.errors.length > 0);
    },

    "sin master pero TODOS son 'separate' → ok (caso válido)"() {
        // Es legal: si el usuario decidió que ninguno pertenece a esta
        // ficha, todos se reasignan y el grupo desaparece.
        const r = validateManualGroup([m('a', 'separate'), m('b', 'separate')]);
        testRunner.assertEquals(r.ok, true);
        testRunner.assertEquals(r.masterId, null);
        testRunner.assertEquals(r.separateIds.join(','), 'a,b');
    },

    "master sin nadie más → ok (equivalente a 'no es duplicado')"() {
        const r = validateManualGroup([m('a', 'master'), m('b', 'separate')]);
        testRunner.assertEquals(r.ok, true);
        testRunner.assertEquals(r.absorbIds.length, 0);
        testRunner.assertEquals(r.separateIds.join(','), 'b');
    }

});

testRunner.addSuite("validateManualGroup — miembros indecisos", {

    "miembro con role=null → error 'falta decidir'"() {
        const r = validateManualGroup([m('a', 'master'), m('b', null)]);
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(r.errors.some(e => /decidir|indecis|falta/i.test(e)),
            'Debe mencionar miembro indeciso');
    },

    "lista de errores incluye los ids de los miembros indecisos"() {
        const r = validateManualGroup([m('a', 'master'), m('b', null), m('c', null)]);
        testRunner.assertEquals(r.ok, false);
        // Los errors deben mencionar b y c (al menos uno de los dos)
        const joined = r.errors.join(' ');
        testRunner.assert(/b|c/.test(joined));
    }

});

testRunner.addSuite("validateManualGroup — caso real del usuario (ficha 501)", {

    "Hector + Héctor (master) + Hector (absorb) + Jean (separate) → ok"() {
        // Hector excavadora + Héctor excavadora son la misma persona.
        // Jean haiti es otra persona y se reasignará.
        const members = [
            { id: 'h1', name: 'Hector excavadora',  number: '501', role: 'absorb' },
            { id: 'h2', name: 'Héctor excavadora', number: '501', role: 'master' },
            { id: 'j',  name: 'Jean haiti',        number: '501', role: 'separate' }
        ];
        const r = validateManualGroup(members);
        testRunner.assertEquals(r.ok, true);
        testRunner.assertEquals(r.masterId, 'h2');
        testRunner.assertEquals(r.absorbIds.join(','), 'h1');
        testRunner.assertEquals(r.separateIds.join(','), 'j');
    }

});

console.log('🧪 ManualGroupValidator tests cargados.');
