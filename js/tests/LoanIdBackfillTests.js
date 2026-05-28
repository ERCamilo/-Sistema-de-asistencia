/**
 * 🧪 LoanIdBackfillTests (Task #5)
 *
 * Verifies that backfillNestedIds(employees) walks every employee and
 * assigns a UUID to any loan / advance / bonus / deduction / payment /
 * installment that is missing an 'id' field.
 *
 * Contract:
 *   - Leaves existing ids untouched.
 *   - Assigns a non-empty string id to items that had none.
 *   - Returns the total count of ids that were assigned.
 *   - Mutates the input array in-place (performance: avoids deep clone
 *     on potentially large datasets at load time).
 *   - Handles null / undefined inputs without throwing.
 */

import { backfillNestedIds } from '../modules/services/LoanIdBackfill.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeEmp(overrides = {}) {
    return {
        id: 'e1',
        loans: [],
        advances: [],
        bonuses: [],
        deductions: [],
        ...overrides
    };
}

function hasId(item) {
    return typeof item.id === 'string' && item.id.length > 0;
}

// ─────────────────────────────────────────────────────────────

testRunner.addSuite("LoanIdBackfill — null / empty inputs (Task #5)", {

    "null → returns 0 without throwing"() {
        testRunner.assertEquals(backfillNestedIds(null), 0);
    },

    "undefined → returns 0 without throwing"() {
        testRunner.assertEquals(backfillNestedIds(undefined), 0);
    },

    "empty array → returns 0"() {
        testRunner.assertEquals(backfillNestedIds([]), 0);
    },

    "employee with no loans/advances/bonuses/deductions → returns 0"() {
        const employees = [makeEmp()];
        testRunner.assertEquals(backfillNestedIds(employees), 0);
    }

});

testRunner.addSuite("LoanIdBackfill — top-level array fields (Task #5)", {

    "loan without id gets a UUID assigned"() {
        const loan = { amount: 500, status: 'active' };
        const employees = [makeEmp({ loans: [loan] })];
        backfillNestedIds(employees);
        testRunner.assert(hasId(loan), 'loan must have an id after backfill');
    },

    "loan with existing id is NOT changed"() {
        const loan = { id: 'existing-loan-id', amount: 500 };
        const employees = [makeEmp({ loans: [loan] })];
        backfillNestedIds(employees);
        testRunner.assertEquals(loan.id, 'existing-loan-id');
    },

    "advance without id gets a UUID"() {
        const adv = { amount: 100 };
        const employees = [makeEmp({ advances: [adv] })];
        backfillNestedIds(employees);
        testRunner.assert(hasId(adv), 'advance must have an id after backfill');
    },

    "bonus without id gets a UUID"() {
        const bon = { amount: 200 };
        const employees = [makeEmp({ bonuses: [bon] })];
        backfillNestedIds(employees);
        testRunner.assert(hasId(bon));
    },

    "deduction without id gets a UUID"() {
        const ded = { amount: 50 };
        const employees = [makeEmp({ deductions: [ded] })];
        backfillNestedIds(employees);
        testRunner.assert(hasId(ded));
    },

    "mixed: some with id, some without — only the missing ones get assigned"() {
        const hasOne  = { id: 'L1', amount: 300 };
        const noId    = { amount: 200 };
        const employees = [makeEmp({ loans: [hasOne, noId] })];
        const count = backfillNestedIds(employees);
        testRunner.assertEquals(hasOne.id, 'L1');   // untouched
        testRunner.assert(hasId(noId));              // got a UUID
        testRunner.assertEquals(count, 1);
    }

});

testRunner.addSuite("LoanIdBackfill — nested: payments + installments (Task #5)", {

    "payment inside loan without id gets a UUID"() {
        const payment = { amount: 100 };
        const loan    = { id: 'L1', payments: [payment], installments: [] };
        const employees = [makeEmp({ loans: [loan] })];
        backfillNestedIds(employees);
        testRunner.assert(hasId(payment), 'payment must have an id after backfill');
    },

    "installment inside loan without id gets a UUID"() {
        const installment = { amount: 50 };
        const loan        = { id: 'L1', payments: [], installments: [installment] };
        const employees   = [makeEmp({ loans: [loan] })];
        backfillNestedIds(employees);
        testRunner.assert(hasId(installment));
    },

    "payment with existing id is NOT changed"() {
        const payment = { id: 'P1', amount: 100 };
        const loan    = { id: 'L1', payments: [payment] };
        const employees = [makeEmp({ loans: [loan] })];
        backfillNestedIds(employees);
        testRunner.assertEquals(payment.id, 'P1');
    },

    "loan itself missing id + its payments missing id: both get ids"() {
        const payment = { amount: 100 };
        const loan    = { amount: 500, payments: [payment] };
        const employees = [makeEmp({ loans: [loan] })];
        const count = backfillNestedIds(employees);
        testRunner.assert(hasId(loan));
        testRunner.assert(hasId(payment));
        testRunner.assertEquals(count, 2);
    }

});

testRunner.addSuite("LoanIdBackfill — return value: total count (Task #5)", {

    "returns 0 when no ids are missing"() {
        const employees = [makeEmp({
            loans:      [{ id: 'L1' }],
            advances:   [{ id: 'A1' }],
            bonuses:    [{ id: 'B1' }],
            deductions: [{ id: 'D1' }]
        })];
        testRunner.assertEquals(backfillNestedIds(employees), 0);
    },

    "counts across multiple employees"() {
        const emp1 = makeEmp({ loans: [{ amount: 100 }, { amount: 200 }] });   // 2 missing
        const emp2 = makeEmp({ advances: [{ amount: 50 }] });                  // 1 missing
        const count = backfillNestedIds([emp1, emp2]);
        testRunner.assertEquals(count, 3);
    },

    "each newly assigned id is a unique non-empty string"() {
        const loan1 = { amount: 100 };
        const loan2 = { amount: 200 };
        const employees = [makeEmp({ loans: [loan1, loan2] })];
        backfillNestedIds(employees);
        testRunner.assert(loan1.id !== loan2.id, 'Each assigned id must be unique');
    }

});

testRunner.addSuite("LoanIdBackfill — robustness (Task #5)", {

    "employee with loans: undefined/null field doesn't throw"() {
        const employees = [{ id: 'e1', loans: null, advances: undefined }];
        let threw = false;
        try { backfillNestedIds(employees); } catch (_) { threw = true; }
        testRunner.assertEquals(threw, false);
    },

    "non-object item in array is skipped safely"() {
        const employees = [makeEmp({ loans: [null, undefined, 'bad'] })];
        let threw = false;
        try { backfillNestedIds(employees); } catch (_) { threw = true; }
        testRunner.assertEquals(threw, false);
    }

});

console.log('🧪 LoanIdBackfill tests cargados.');
