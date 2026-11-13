// Keep only the payroll footer above a keyboard that resizes the visual
// viewport without resizing the layout viewport (notably mobile Safari).
let installed = false;

export function installPayrollMobileNavigation() {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    let frame = null;
    const update = () => {
        frame = null;
        const viewport = window.visualViewport;
        const inset = viewport && Math.abs(viewport.scale - 1) < .01
            ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        document.documentElement.style.setProperty('--payroll-viewport-inset', `${Math.round(inset)}px`);
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(update); };
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
    update();
}
