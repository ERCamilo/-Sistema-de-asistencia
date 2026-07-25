import { state } from '../modules/core/AppState.js';
import { Leader } from '../modules/features/employees/Leader.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { LeaderIconModal } from '../modules/ui/modals/LeaderIconModal.js';

describe('LeaderIconModal — cambio rápido desde la tarjeta', () => {
    let context;

    beforeEach(() => {
        context = {
            state,
            saveToLocalStorage: jest.fn(),
            render: jest.fn(),
            services: {}
        };
        EmployeesUI.init(context);
        state.leaders = [
            { id: 'l1', name: 'Roberto', icon: 'supervisor', active: true, updatedAt: 1 }
        ];
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.body.style.overflow = '';
    });

    test('guarda un icono válido y actualiza la interfaz', () => {
        const leader = { id: 'l1', name: 'Roberto', icon: 'supervisor', updatedAt: 1 };

        LeaderIconModal.save(leader, 'tractor');

        expect(leader.icon).toBe('tractor');
        expect(leader._isDirty).toBe(true);
        expect(leader.updatedAt).toBeGreaterThan(1);
        expect(context.saveToLocalStorage).toHaveBeenCalledWith({
            announce: 'Icono de "Roberto" actualizado'
        });
        expect(context.render).toHaveBeenCalled();
    });

    test('ignora identificadores fuera del catálogo', () => {
        const leader = { id: 'l1', name: 'Roberto', icon: 'supervisor', updatedAt: 1 };

        LeaderIconModal.save(leader, '<script>');

        expect(leader.icon).toBe('supervisor');
        expect(context.saveToLocalStorage).not.toHaveBeenCalled();
    });

    test('Leader conserva el icono al serializar y reconstruir datos', () => {
        const leader = new Leader({ id: 'l1', name: 'Roberto', icon: 'wheelbarrow' });
        const restored = Leader.fromJSON(leader.toJSON());

        expect(leader.toJSON().icon).toBe('wheelbarrow');
        expect(restored.icon).toBe('wheelbarrow');
    });

    test('abre el mismo selector filtrable utilizado por los puestos', () => {
        jest.useFakeTimers();

        const modal = LeaderIconModal.open('l1');

        expect(modal).toBeDefined();
        expect(document.querySelector('.position-icon-popup')).not.toBeNull();
        expect(document.querySelector('[data-position-icon-search]')).not.toBeNull();
        expect(document.querySelector('input[value="tractor"]')).not.toBeNull();
        expect(document.querySelector('input[value="supervisor"]').checked).toBe(true);

        modal.close();
        jest.advanceTimersByTime(300);
        jest.useRealTimers();
    });
});
