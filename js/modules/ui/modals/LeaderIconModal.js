import { getState, context } from '../../features/employees/EmployeesUI.js';
import {
    POSITION_ICON_OPTIONS,
    resolveLeaderIcon
} from '../../features/employees/PositionVisuals.js';
import { PersonnelIconPickerModal } from './PersonnelIconPickerModal.js';

export class LeaderIconModal {
    static open(leaderId) {
        const state = getState();
        const leader = state.leaders.find(item => item.id === leaderId);
        if (!leader) return;

        return PersonnelIconPickerModal.open({
            title: 'Icono del líder',
            subtitle: leader.name,
            selectedIcon: resolveLeaderIcon(leader),
            onSelect: icon => LeaderIconModal.save(leader, icon)
        });
    }

    static save(leader, icon) {
        if (!POSITION_ICON_OPTIONS.some(option => option.value === icon)) return;
        leader.icon = icon;
        leader.updatedAt = Date.now();
        leader._isDirty = true;
        context.saveToLocalStorage({ announce: `Icono de "${leader.name}" actualizado` });
        context.render();
    }
}
