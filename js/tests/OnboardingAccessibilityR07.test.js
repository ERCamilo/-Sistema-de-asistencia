import fs from 'fs';
import path from 'path';
import { launchOnboardingV2, closeOnboardingPreview, trapTabKey } from '../modules/ui/onboarding/OnboardingPreview.js';

const VIEW = fs.readFileSync(path.resolve('js/modules/ui/onboarding/OnboardingView.js'), 'utf8');
const PREVIEW = fs.readFileSync(path.resolve('js/modules/ui/onboarding/OnboardingPreview.js'), 'utf8');
const CSS = fs.readFileSync(path.resolve('css/onboarding-v2.css'), 'utf8');

function overlay() {
    return document.getElementById('onboarding-preview-overlay');
}

function reset() {
    closeOnboardingPreview();
    try {
        localStorage.removeItem('onboarding-pos');
        localStorage.removeItem('onboardingCompleted');
    } catch (_) {}
}
describe('OnboardingAccessibilityR07', () => {
    beforeEach(() => reset());
    afterEach(() => reset());

    test('primary navigation and close controls keep >=44px hit targets', () => {
        expect(VIEW).toMatch(/data-act="goLast"[^>]*height:44px;min-height:44px/);
        expect(VIEW).toMatch(/data-act="back"[^>]*height:44px;min-height:44px/);
        expect(VIEW).toMatch(/data-act="next"[^>]*height:44px;min-height:44px/);
        expect(PREVIEW).toMatch(/data-act="closePreview"[^>]*width:44px;height:44px;min-width:44px;min-height:44px/);
    });

    test('secondary onboarding actions also keep >=44px hit targets', () => {
        expect(VIEW).toMatch(/data-act="hours"[^>]*height:44px;min-height:44px/);
        expect(VIEW).toMatch(/data-act="swatch"[^>]*width:44px;height:44px;min-width:44px;min-height:44px/);
        expect(VIEW).toMatch(/data-act="rmEmp"[^>]*width:44px;height:44px;min-width:44px;min-height:44px/);
        expect(VIEW).toMatch(/data-act="markAll"[^>]*height:44px;min-height:44px/);
        expect(VIEW).toMatch(/data-act="weekCell"[^>]*height:44px;min-height:44px/);
    });
    test('step dots expose 44px targets while keeping compact visual indicator', () => {
        expect(VIEW).toMatch(/data-act="dot"[^>]*width:44px;height:44px;min-width:44px;min-height:44px/);
        expect(VIEW).toMatch(/aria-hidden="true"[^>]*width:\$\{s\.step === n \+ 1 \? 22 : 8\}px;height:8px/);
    });

    test('mobile footer reflows controls and very small screens do not shrink day targets below 44px', () => {
        expect(CSS).toMatch(/\[data-od-id="od-footer"\]:not\(\.odv-ready-footer\)[\s\S]*grid-template-columns:/);
        expect(CSS).toMatch(/\.odv-days-grid button\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    });

    test('focus trap recovers focus that escaped the onboarding overlay', () => {
        launchOnboardingV2({ mode: 'live' });
        const root = overlay();
        const first = root.querySelector('button');
        document.body.tabIndex = -1;
        document.body.focus();
        const event = { shiftKey: false, preventDefault: jest.fn() };
        trapTabKey(event, root);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(first);
    });
});
