import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { PositionIconModal } from '../modules/ui/modals/PositionIconModal.js';

describe('PositionIconModal — cambio rápido desde la tarjeta', () => {
    let context;

    beforeEach(() => {
        context = {
            state,
            saveToLocalStorage: jest.fn(),
            render: jest.fn(),
            services: {}
        };
        EmployeesUI.init(context);
    });

    test('guarda un icono válido y actualiza la interfaz', () => {
        const position = { id: 'p1', name: 'Albañil', icon: 'bricks', updatedAt: 1 };

        PositionIconModal.save(position, 'hammer');

        expect(position.icon).toBe('hammer');
        expect(position._isDirty).toBe(true);
        expect(position.updatedAt).toBeGreaterThan(1);
        expect(context.saveToLocalStorage).toHaveBeenCalledWith({
            announce: 'Icono de "Albañil" actualizado'
        });
        expect(context.render).toHaveBeenCalled();
    });

    test('ignora identificadores que no pertenecen al catálogo', () => {
        const position = { id: 'p1', name: 'Albañil', icon: 'bricks', updatedAt: 1 };

        PositionIconModal.save(position, '<script>');

        expect(position.icon).toBe('bricks');
        expect(context.saveToLocalStorage).not.toHaveBeenCalled();
    });
});
