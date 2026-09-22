import fs from 'fs';
import path from 'path';
import { registerProjectReconciliationGlobals } from '../modules/features/projects/ProjectReconciliationUI.js';

/**
 * ProjectReconciliationAppWiringR07 — behavioral + source contract for the app
 * wiring: banner render in the shell, global registration, Settings action
 * dispatch, and SettingsDataTab rendering the health action.
 */
const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const SETTINGS_UI_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/SettingsUI.js'), 'utf8');
const SETTINGS_DATA_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/settings/SettingsDataTab.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.resolve(__dirname, '../../css/project-management.css'), 'utf8');

describe('ProjectReconciliationAppWiringR07', () => {
    test('app.js imports and registers the reconciliation UI', () => {
        expect(APP_SRC).toContain("from './modules/features/projects/ProjectReconciliationUI.js'");
        expect(APP_SRC).toContain('registerProjectReconciliationGlobals()');
    });

    test('app.js renders the persistent banner in the shell (above main content)', () => {
        expect(APP_SRC).toContain('renderProjectReconciliationBanner()');
        const mainIdx = APP_SRC.indexOf('<main class="main-content"');
        const bannerIdx = APP_SRC.indexOf('${renderProjectReconciliationBanner()}');
        const containerIdx = APP_SRC.indexOf('<div class="container">${content}</div>');
        expect(mainIdx).toBeGreaterThan(-1);
        // Banner is inside <main> before the tab content container.
        expect(bannerIdx).toBeGreaterThan(mainIdx);
        expect(bannerIdx).toBeLessThan(containerIdx);
    });

    test('registerProjectReconciliationGlobals exposes window globals and import bridge entry', () => {
        registerProjectReconciliationGlobals();
        expect(typeof window.openProjectReconciliation).toBe('function');
        expect(typeof window.closeProjectReconciliation).toBe('function');
        expect(typeof window.refreshProjectReconciliation).toBe('function');
        expect(typeof window.openImportReconciliation).toBe('function');
        expect(typeof window.closeImportReconciliation).toBe('function');
    });

    test('SettingsUI dispatches open-project-reconciliation to the window global', () => {
        expect(SETTINGS_UI_SRC).toContain("'open-project-reconciliation'");
        expect(SETTINGS_UI_SRC).toContain('window.openProjectReconciliation');
    });

    test('SettingsDataTab renders the health action inside Salud de los Datos', () => {
        expect(SETTINGS_DATA_SRC).toContain('renderProjectReconciliationSettingsAction()');
        expect(SETTINGS_DATA_SRC).toContain('Salud de los Datos');
    });

    test('reconciliation CSS enforces 44px targets, mobile single-column and reduced motion', () => {
        expect(CSS_SRC).toContain('min-height: 44px');
        expect(CSS_SRC).toContain('.r07-recon-summary { grid-template-columns: 1fr; }');
        expect(CSS_SRC).toContain('@media (prefers-reduced-motion: reduce)');
        expect(CSS_SRC).toContain('.modal-container.modal-enter');
        expect(CSS_SRC).toContain('.r07-recon-settings-count');
    });
});
