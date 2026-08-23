import fs from 'fs';
import path from 'path';
import { state } from '../modules/core/AppState.js';
import {
    AttendanceDetailAvatar,
    EmployeeRow,
    EmployeeRowCompact
} from '../modules/ui/AttendanceUI.js';

function source(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('shared employee avatar surfaces', () => {
    test('keeps attendance rows avatar-free and uses the shared avatar in the desktop detail card', () => {
        const attendance = source('../modules/ui/AttendanceUI.js');
        const app = source('../../js/app.js');
        const personnel = source('../modules/features/employees/EmployeesList.js');
        const editor = source('../modules/ui/modals/EmployeeModal.js');
        const mobile = source('../modules/ui/components/EmployeeFloatingCard.js');

        expect(attendance).toMatch(/AttendanceDetailAvatar[\s\S]*EmployeeAvatar\(employee/);
        expect(app).toMatch(/AttendanceDetailAvatar\(emp\)/);
        expect(app).toMatch(/usesAttendanceDetailPanel\(window\.innerWidth\)[\s\S]*AttendanceDetailPanel\(\)/);
        expect(app).toMatch(/employeePhotoService\.reconcileEmployeePhotoSignals\(state\.employees\)/);
        expect(personnel).toMatch(/EmployeeAvatar\(emp/);
        expect(editor).toMatch(/EmployeeAvatar\(emp/);
        expect(editor).toMatch(/hydrateEmployeeAvatars\(body/);
        expect(editor).toMatch(/data-employee-photo-editor-actions/);
        expect(editor).toMatch(/data-employee-photo-action="change"/);
        expect(editor).toMatch(/Ajustar/);
        expect(editor).toMatch(/Eliminar/);
        expect(mobile).toMatch(/EmployeePhotoAcquisitionUI\(emp[\s\S]*EmployeeAvatar\(emp/);
    });

    test('renders zero avatars in attendance cards and exactly one camera avatar in the right detail card', () => {
        const employee = {
            id: 'emp-detail',
            number: '001',
            name: 'Franklin Henrriquez',
            active: true,
            positions: []
        };
        const previous = {
            selectedDate: state.selectedDate,
            attendance: state.attendance,
            positions: state.positions,
            employees: state.employees
        };
        state.selectedDate = new Date('2026-08-22T12:00:00');
        state.attendance = {};
        state.positions = [];
        state.employees = [employee];
        try {
            document.body.innerHTML = `
                <section data-attendance-cards>${EmployeeRow(employee)}${EmployeeRowCompact(employee)}</section>
                <aside class="detail-card">${AttendanceDetailAvatar(employee)}</aside>`;
            expect(document.querySelectorAll('[data-attendance-cards] [data-employee-avatar]')).toHaveLength(0);
            expect(document.querySelectorAll('.detail-card [data-employee-avatar]')).toHaveLength(1);
            const fallback = document.querySelector('.detail-card [data-avatar-fallback]');
            expect(fallback.querySelector('svg')).not.toBeNull();
            expect(fallback.textContent.trim()).toBe('');
        } finally {
            Object.assign(state, previous);
            document.body.innerHTML = '';
        }
    });
});
