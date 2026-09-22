import fs from 'fs';
import path from 'path';
import { state } from '../modules/core/AppState.js';
import { ImportFullModal } from '../modules/features/export/ImportFullModal.js';

const CSS_SRC = fs.readFileSync(path.resolve(__dirname, '../../css/project-management.css'), 'utf8');

/**
 * ImportFullModalAccessibilityR07 — behavioral contract for the FULL-import
 * paste modal after the Phase B a11y fix: dialog semantics, labelled textarea,
 * delegated input (no inline oninput) and >=44px footer targets.
 */
describe('ImportFullModalAccessibilityR07', () => {
    let originalShow;
    let originalText;

    beforeEach(() => {
        originalShow = state.showImportFullModal;
        originalText = state.importFullText;
        state.showImportFullModal = true;
        state.importFullText = '';
    });

    afterEach(() => {
        state.showImportFullModal = originalShow;
        state.importFullText = originalText;
        document.body.innerHTML = '';
    });

    test('renders dialog semantics (role, aria-modal, labelled title)', () => {
        document.body.innerHTML = ImportFullModal();
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const titleId = dialog.getAttribute('aria-labelledby');
        expect(titleId).toBeTruthy();
        expect(document.getElementById(titleId).textContent).toContain('Importar datos FULL');
    });

    test('textarea has a visible label and delegated input attribute (no inline oninput)', () => {
        document.body.innerHTML = ImportFullModal();
        const textarea = document.getElementById('import-full-textarea');
        expect(textarea).toBeTruthy();
        expect(textarea.hasAttribute('oninput')).toBe(false);
        expect(textarea.hasAttribute('data-import-full-input')).toBe(true);

        const label = document.querySelector('label[for="import-full-textarea"]');
        expect(label).toBeTruthy();
        expect(label.textContent.trim().length).toBeGreaterThan(0);
    });

    test('footer actions expose >=44px hit targets', () => {
        document.body.innerHTML = ImportFullModal();
        const buttons = document.querySelectorAll(
            '.import-full-footer [data-app-fn="confirmImportFull"], .import-full-footer [data-app-fn="closeImportFullModal"]'
        );
        expect(buttons.length).toBe(2);
        for (const btn of buttons) {
            expect(btn.classList.contains('import-full-footer-btn')).toBe(true);
            expect(btn.type).toBe('button');
        }
        expect(CSS_SRC).toMatch(/\.import-full-footer-btn\s*\{[^}]*min-height:\s*44px/s);
    });

    test('embedded reconciliation keeps the FULL shell geometry isolated from standalone modal CSS', () => {
        expect(CSS_SRC).toMatch(/\.modal-overlay:not\(\.import-full-overlay\):has\(\.r07-recon-shell\)/);
        expect(CSS_SRC).toMatch(/\.import-full-embedded-body \.r07-recon-footer\s*\{[^}]*margin-left:\s*-22px[^}]*margin-right:\s*-22px/s);
        expect(CSS_SRC).toMatch(/@media \(max-width: 640px\)[\s\S]*\.import-full-embedded-body > \.r07-recon-shell\s*\{[^}]*padding-left:\s*16px[^}]*padding-right:\s*16px/s);
    });

    test('does not render native blocking dialogs', () => {
        const html = ImportFullModal();
        expect(html).not.toMatch(/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/);
    });

    test('escapes HTML in the pasted text (XSS safety)', () => {
        state.importFullText = '</textarea><script>window.__xss = 1</script>';
        const html = ImportFullModal();
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('</textarea><script>');
        expect(html).toContain('&lt;/textarea&gt;');
        expect(html).toContain('&lt;script&gt;');
    });
});
