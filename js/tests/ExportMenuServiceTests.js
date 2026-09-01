/**
 * 🧪 ExportMenuServiceTests — Tests for the export popover state operations.
 *
 * Pins the state-shape contract so Sprint 4's full extraction of the export
 * menu UI can call into these helpers without changing the behavior.
 */

import {
    openExportMenu,
    closeExportMenu,
    canShareFiles,
    buildMiniExportPayload,
    EMPTY_EXPORT_DATA
} from '../modules/features/export/ExportMenuService.js';

function buildState() {
    return {
        showExportMenu: false,
        showShareOptions: false,
        exportMenuData: { ...EMPTY_EXPORT_DATA }
    };
}

testRunner.addSuite("ExportMenuService — open/close", {

    "openExportMenu: sets showExportMenu=true and captures payload"() {
        const state = buildState();
        const blob = new Blob(['hello'], { type: 'text/plain' });
        openExportMenu(state, {
            x: 100,
            y: 200,
            filename: 'report.csv',
            blob,
            title: 'Monthly report',
            text: 'See attached'
        });

        testRunner.assertEquals(state.showExportMenu, true, "Menu should be open");
        testRunner.assertEquals(state.showShareOptions, false, "Share submenu should default to closed");
        testRunner.assertEquals(state.exportMenuData.filename, 'report.csv', "filename captured");
        testRunner.assertEquals(state.exportMenuData.title, 'Monthly report', "title captured");
        testRunner.assertEquals(state.exportMenuData.x, 100, "x captured");
        testRunner.assertEquals(state.exportMenuData.y, 200, "y captured");
        testRunner.assert(state.exportMenuData.blob === blob, "blob captured by reference");
    },

    "openExportMenu: applies defaults when options are missing"() {
        const state = buildState();
        openExportMenu(state, {});

        testRunner.assertEquals(state.exportMenuData.filename, 'archivo', "Default filename");
        testRunner.assertEquals(state.exportMenuData.title, 'Archivo', "Default title");
        testRunner.assertEquals(state.exportMenuData.text, '', "Default text is empty");
        testRunner.assertEquals(state.exportMenuData.x, 0, "Default x is 0");
        testRunner.assertEquals(state.exportMenuData.y, 0, "Default y is 0");
        testRunner.assertEquals(state.exportMenuData.blob, null, "Default blob is null");
    },

    "closeExportMenu: resets everything to a clean state"() {
        const state = buildState();
        openExportMenu(state, {
            x: 50,
            y: 50,
            filename: 'x.csv',
            blob: new Blob(['x']),
            title: 'x',
            text: 'y'
        });
        // simulate the share submenu having been opened
        state.showShareOptions = true;

        closeExportMenu(state);

        testRunner.assertEquals(state.showExportMenu, false, "Menu must be closed");
        testRunner.assertEquals(state.showShareOptions, false, "Share submenu must be closed");
        testRunner.assertEquals(state.exportMenuData.filename, '', "filename must be reset");
        testRunner.assertEquals(state.exportMenuData.blob, null, "blob must be cleared");
        testRunner.assertEquals(state.exportMenuData.x, 0, "x must be reset");
    },

    "closeExportMenu: is idempotent (calling twice doesn't break)"() {
        const state = buildState();
        closeExportMenu(state);
        closeExportMenu(state);

        testRunner.assertEquals(state.showExportMenu, false, "Still closed");
        testRunner.assertEquals(state.exportMenuData.blob, null, "Still empty");
    }
});

testRunner.addSuite("ExportMenuService — environment probe", {

    "canShareFiles: returns false when navigator.canShare is missing"() {
        const original = navigator.canShare;
        // jsdom does not implement canShare; ensure it stays unset
        delete navigator.canShare;
        try {
            testRunner.assertEquals(
                canShareFiles(),
                false,
                "Should be false when canShare is unavailable"
            );
        } finally {
            if (original) navigator.canShare = original;
        }
    },

    "canShareFiles: returns true when navigator.canShare reports support"() {
        const original = navigator.canShare;
        navigator.canShare = () => true;
        try {
            testRunner.assertEquals(canShareFiles(), true, "Should be true when supported");
        } finally {
            if (original) navigator.canShare = original;
            else delete navigator.canShare;
        }
    }
});

testRunner.addSuite("ExportMenuService — buildMiniExportPayload", {

    "buildMiniExportPayload: formats employees with number, name, position"() {
        const positions = [
            { id: 'pos-1', name: 'Oficial Albañil', hourlyRate: 312.5 },
            { id: 'pos-2', name: 'Ayudante', hourlyRate: 225 }
        ];
        const employees = [
            { id: 'e-1', number: '1', name: 'Ana García', positions: ['pos-1'], active: true },
            { id: 'e-2', number: '2', name: 'Carlos Pérez', positions: ['pos-2'], active: false }
        ];
        const settings = { regularHoursPerDay: 8 };

        const payload = buildMiniExportPayload(employees, positions, settings);

        testRunner.assertEquals(payload.length, 2, "2 employees exported");
        testRunner.assertEquals(payload[0].number, "1", "Ana number is string 1");
        testRunner.assertEquals(payload[0].name, "Ana García", "Ana name matched");
        testRunner.assertEquals(payload[0].position, "Oficial Albañil", "Ana position matched");
        testRunner.assertEquals(payload[0].sueldo, "2500", "Ana sueldo is 312.5 * 8 = 2500");
        testRunner.assertEquals(payload[0].paused, undefined, "Ana is active, paused is omitted");

        testRunner.assertEquals(payload[1].number, "2", "Carlos number is string 2");
        testRunner.assertEquals(payload[1].name, "Carlos Pérez", "Carlos name matched");
        testRunner.assertEquals(payload[1].position, "Ayudante", "Carlos position matched");
        testRunner.assertEquals(payload[1].sueldo, "1800", "Carlos sueldo is 225 * 8 = 1800");
        testRunner.assertEquals(payload[1].paused, true, "Carlos is inactive, paused is true");
    },

    "buildMiniExportPayload: respects includeSalary=false"() {
        const positions = [{ id: 'pos-1', name: 'Albañil', hourlyRate: 300 }];
        const employees = [{ id: 'e-1', number: '10', name: 'Juan', positions: ['pos-1'], active: true }];

        const payload = buildMiniExportPayload(employees, positions, {}, { includeSalary: false });

        testRunner.assertEquals(payload[0].sueldo, undefined, "sueldo omitted when includeSalary is false");
    },

    "buildMiniExportPayload: prioritizes employee positionSalaries override"() {
        const positions = [{ id: 'pos-1', name: 'Maestro', hourlyRate: 300 }];
        const employees = [{
            id: 'e-1',
            number: '5',
            name: 'Pedro',
            positions: ['pos-1'],
            positionSalaries: { 'pos-1': 500 },
            active: true
        }];

        const payload = buildMiniExportPayload(employees, positions, { regularHoursPerDay: 8 });

        testRunner.assertEquals(payload[0].sueldo, "4000", "500 * 8 = 4000 using custom override");
    },

    "buildMiniExportPayload: filters out deleted employees"() {
        const positions = [{ id: 'pos-1', name: 'Pintor', hourlyRate: 200 }];
        const employees = [
            { id: 'e-1', number: '1', name: 'Activo', positions: ['pos-1'], active: true },
            { id: 'e-2', number: '2', name: 'Borrado', positions: ['pos-1'], deletedAt: Date.now() }
        ];

        const payload = buildMiniExportPayload(employees, positions);

        testRunner.assertEquals(payload.length, 1, "Only 1 non-deleted employee exported");
        testRunner.assertEquals(payload[0].name, "Activo", "Active employee exported");
    }
});

console.log('🧪 ExportMenuService tests cargados.');

