import { getState, context } from '../../features/employees/EmployeesUI.js';
import {
    POSITION_ICON_OPTIONS,
    resolvePositionIcon
} from '../../features/employees/PositionVisuals.js';
import { PersonnelIconPickerModal } from './PersonnelIconPickerModal.js';

export class PositionIconModal {
    static open(positionId) {
        const state = getState();
        const position = state.positions.find(item => item.id === positionId);
        if (!position) return;

        return PersonnelIconPickerModal.open({
            title: 'Icono del puesto',
            subtitle: position.name,
            selectedIcon: resolvePositionIcon(position),
            onSelect: icon => PositionIconModal.save(position, icon)
        });
    }

    static save(position, icon) {
        if (!POSITION_ICON_OPTIONS.some(option => option.value === icon)) return;
        position.icon = icon;
        position.updatedAt = Date.now();
        position._isDirty = true;
        context.saveToLocalStorage({ announce: `Icono de "${position.name}" actualizado` });
        context.render();
    }
}
