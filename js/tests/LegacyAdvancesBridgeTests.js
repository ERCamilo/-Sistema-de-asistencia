/**
 * 🧪 LegacyAdvancesBridgeTests — Pure helper coverage for the legacy
 * `emp.advances[]` flow used by the in-profile Nómina tab.
 *
 * The legacy UI in ProfileTabs.js still reads `state.employeeProfile.advances`
 * directly. To move those handlers out of app.js safely, the bridge exposes
 * pure helper functions (no window/state references) that the side-effect
 * window handlers delegate to. These tests pin the helper behavior so we can
 * refactor the call sites with confidence.
 */

import {
    addAdvanceTo,
    removeAdvanceAt,
    updateAdvanceField,
    setEditing,
    clearEditing,
    isEditing
} from '../modules/features/loans/LegacyAdvancesBridge.js';

function buildScratch() {
    return {
        advances: [],
        editingAdvances: {}
    };
}

testRunner.addSuite("LegacyAdvancesBridge — addAdvanceTo", {

    "appends an entry with default zero amounts and today's date"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');
        testRunner.assertEquals(scratch.advances.length, 1, "One entry appended");
        testRunner.assertEquals(scratch.advances[0].amount, 0, "Amount starts at 0");
        testRunner.assertEquals(scratch.advances[0].interest, 0, "Interest starts at 0");
        testRunner.assertEquals(scratch.advances[0].date, '2026-05-20', "Date set");
        testRunner.assert(scratch.advances[0].id.startsWith('ADV-'), "ID generated with ADV- prefix");
    },

    "auto-opens edit mode on the new index"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');
        testRunner.assert(isEditing(scratch, 0), "First entry should be in edit mode");
    },

    "lazily initializes scratch.advances if missing"() {
        const scratch = { editingAdvances: {} };
        addAdvanceTo(scratch, '2026-05-20');
        testRunner.assert(Array.isArray(scratch.advances), "advances array created");
        testRunner.assertEquals(scratch.advances.length, 1, "Entry added");
    }
});

testRunner.addSuite("LegacyAdvancesBridge — removeAdvanceAt", {

    "removes the entry at the given index"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');
        addAdvanceTo(scratch, '2026-05-21');
        const firstId = scratch.advances[0].id;
        removeAdvanceAt(scratch, 0);
        testRunner.assertEquals(scratch.advances.length, 1, "One left");
        testRunner.assert(scratch.advances[0].id !== firstId, "First entry removed");
    },

    "is a no-op when index is out of range"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');
        removeAdvanceAt(scratch, 99); // out of range
        testRunner.assertEquals(scratch.advances.length, 1, "Untouched");
    }
});

testRunner.addSuite("LegacyAdvancesBridge — updateAdvanceField", {

    "coerces numeric fields"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');
        updateAdvanceField(scratch, 0, 'amount', '1500.50');
        testRunner.assertEquals(scratch.advances[0].amount, 1500.50, "amount parsed as float");

        updateAdvanceField(scratch, 0, 'interest', '5');
        testRunner.assertEquals(scratch.advances[0].interest, 5, "interest parsed as number");
    },

    "rejects negative amounts (clamps to 0)"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');
        updateAdvanceField(scratch, 0, 'amount', '-100');
        testRunner.assertEquals(scratch.advances[0].amount, 0, "negative amount clamped to 0");
    },

    "passes through string fields (date, note)"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');
        updateAdvanceField(scratch, 0, 'date', '2026-06-01');
        updateAdvanceField(scratch, 0, 'note', 'Médico');
        testRunner.assertEquals(scratch.advances[0].date, '2026-06-01', "date stored");
        testRunner.assertEquals(scratch.advances[0].note, 'Médico', "note stored");
    },

    "ignores writes to entries that do not exist"() {
        const scratch = buildScratch();
        // No advance yet; should not throw
        updateAdvanceField(scratch, 0, 'amount', '100');
        testRunner.assertEquals(scratch.advances.length, 0, "Still empty");
    }
});

testRunner.addSuite("LegacyAdvancesBridge — edit-mode helpers", {

    "setEditing / clearEditing toggle the flag for the given index"() {
        const scratch = buildScratch();
        addAdvanceTo(scratch, '2026-05-20');     // auto-opens index 0
        addAdvanceTo(scratch, '2026-05-21');     // auto-opens index 1

        clearEditing(scratch, 0);
        testRunner.assertEquals(isEditing(scratch, 0), false, "Index 0 closed");
        testRunner.assertEquals(isEditing(scratch, 1), true, "Index 1 still open");

        setEditing(scratch, 0);
        testRunner.assertEquals(isEditing(scratch, 0), true, "Index 0 reopened");
    },

    "isEditing returns false on missing flag"() {
        const scratch = { advances: [], editingAdvances: undefined };
        testRunner.assertEquals(isEditing(scratch, 0), false, "Safe on missing structure");
    }
});

console.log('🧪 LegacyAdvancesBridge tests cargados.');
