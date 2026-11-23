import { installPayrollMobileNavigation } from '../modules/features/payroll/PayrollMobileNavigation.js';

test('anchors above the visual keyboard, handles viewport panning, batches events, ignores pinch zoom and installs once', () => {
    const oldViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const oldHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 800, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const frames = [];
    const frameSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    const resizeSpy = jest.spyOn(window, 'addEventListener');
    const inset = () => document.documentElement.style.getPropertyValue('--payroll-viewport-inset');
    try {
        installPayrollMobileNavigation(); installPayrollMobileNavigation();
        expect(resizeSpy.mock.calls.filter(([event]) => event === 'resize')).toHaveLength(1);
        expect(inset()).toBe('0px');
        viewport.height = 450; viewport.offsetTop = 20;
        viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
        expect(frames).toHaveLength(1); frames.shift()();
        expect(inset()).toBe('330px');
        viewport.scale = 2; viewport.dispatchEvent(new Event('resize')); frames.shift()();
        expect(inset()).toBe('0px');
        viewport.scale = 1; viewport.height = 900; viewport.dispatchEvent(new Event('resize')); frames.shift()();
        expect(inset()).toBe('0px');
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
        window.dispatchEvent(new Event('resize')); frames.shift()();
        expect(inset()).toBe('0px');
    } finally {
        for (const [event, callback] of resizeSpy.mock.calls) if (event === 'resize') window.removeEventListener(event, callback);
        frameSpy.mockRestore(); resizeSpy.mockRestore();
        if (oldViewport) Object.defineProperty(window, 'visualViewport', oldViewport); else delete window.visualViewport;
        if (oldHeight) Object.defineProperty(window, 'innerHeight', oldHeight);
        document.documentElement.style.removeProperty('--payroll-viewport-inset');
    }
});
