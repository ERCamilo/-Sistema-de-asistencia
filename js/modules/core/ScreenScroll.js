/**
 * ScreenScroll.js — Al cambiar de pantalla se empieza desde arriba.
 *
 * Cada render() guarda y restaura el scroll de la ventana (RenderManager)
 * para que un repintado no mueva la vista. Pero al pasar a OTRA pantalla esa
 * restauración la dejaba a la altura de la anterior (a mitad de página).
 * `screenKey` identifica la pantalla visible; si cambió entre dos render(),
 * no se restaura y se sube al inicio.
 *
 * Probado en js/tests/ScreenScroll.test.js.
 */

/** Pantalla visible: pestaña + la vista interna que la hace otra pantalla. */
export function screenKey(state = {}) {
    const tab = state.activeTab || '';
    switch (tab) {
        case 'attendance': return `${tab}:${state.viewMode || 'day'}`;
        case 'employees':
        case 'positions': return `${tab}:${state.employeeViewMode || 'employees'}`;
        case 'export': return `${tab}:${state.payrollViewMode || 'generator'}`;
        case 'settings': return `${tab}:${state.settingsActiveTab || 'general'}`;
        default: return tab;
    }
}

/** `changed(state)`: true si la pantalla es otra que en la llamada anterior (la primera, false). */
export function createScreenTracker() {
    let last = null;
    return {
        changed(state) {
            const key = screenKey(state);
            const changed = last !== null && key !== last;
            last = key;
            return changed;
        }
    };
}
