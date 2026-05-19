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

console.log('🧪 ExportMenuService tests cargados.');
