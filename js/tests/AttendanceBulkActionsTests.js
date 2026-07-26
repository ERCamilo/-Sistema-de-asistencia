import {
    buildBulkUndoPlan,
    buildClearVisibleAttendancePlan,
    buildMarkVisiblePresentPlan
} from '../modules/features/attendance/AttendanceBulkActions.js';

testRunner.addSuite('AttendanceBulkActions — operaciones sobre empleados visibles', {
    'marcar presentes solo crea registros para los visibles ausentes'() {
        const employees = [
            { id: 'e1', positions: ['p1', 'p2'] },
            { id: 'e2', positions: ['p3'] }
        ];
        const attendance = {
            'e2-2026-07-26': {
                employeeId: 'e2',
                date: '2026-07-26',
                present: true,
                hoursWorked: 8
            }
        };

        const plan = buildMarkVisiblePresentPlan({
            employees,
            attendance,
            dateKey: '2026-07-26',
            dayHours: 7.5,
            isHoliday: true,
            now: 100
        });

        testRunner.assertEquals(plan.length, 1, 'debe omitir al empleado que ya está presente');
        testRunner.assertEquals(plan[0].employeeId, 'e1', 'debe incluir al empleado visible ausente');
        testRunner.assertEquals(plan[0].next.hoursWorked, 7.5, 'debe usar las horas configuradas del día');
        testRunner.assertEquals(plan[0].next.selectedPosition, 'p1', 'debe usar la posición principal');
        testRunner.assertEquals(plan[0].next.isHoliday, true, 'debe respetar el estado de feriado');
        testRunner.assertEquals(plan[0].next.updatedAt, 100, 'debe estampar la escritura local');
    },

    'limpiar asistencia solo tombstonea registros presentes y conserva snapshot profundo'() {
        const employees = [{ id: 'e1' }, { id: 'e2' }];
        const attendance = {
            'e1-2026-07-26': {
                employeeId: 'e1',
                date: '2026-07-26',
                present: true,
                hoursWorked: 8,
                positionHours: [{ positionId: 'p1', hours: 8 }]
            },
            'e2-2026-07-26': {
                employeeId: 'e2',
                date: '2026-07-26',
                present: false,
                hoursWorked: 0
            }
        };

        const plan = buildClearVisibleAttendancePlan({
            employees,
            attendance,
            dateKey: '2026-07-26',
            now: 200
        });

        testRunner.assertEquals(plan.length, 1, 'debe limpiar únicamente la asistencia presente');
        testRunner.assertEquals(plan[0].next.present, false, 'debe quedar ausente');
        testRunner.assertEquals(plan[0].next.deletedAt, 200, 'debe crear tombstone sincronizable');

        attendance['e1-2026-07-26'].positionHours[0].hours = 4;
        testRunner.assertEquals(plan[0].previous.positionHours[0].hours, 8, 'el snapshot no debe compartir referencias anidadas');
    },

    'deshacer restaura registros previos y tombstonea altas nuevas'() {
        const markChanges = [{
            key: 'e1-2026-07-26',
            employeeId: 'e1',
            previous: null
        }];
        const markedAttendance = {
            'e1-2026-07-26': {
                employeeId: 'e1',
                date: '2026-07-26',
                present: true,
                hoursWorked: 8
            }
        };
        const markUndo = buildBulkUndoPlan(markChanges, markedAttendance, 300);
        testRunner.assertEquals(markUndo[0].next.present, false, 'un alta nueva se deshace mediante tombstone');
        testRunner.assertEquals(markUndo[0].next.deletedAt, 300, 'el tombstone de undo debe viajar a la nube');

        const clearChanges = [{
            key: 'e2-2026-07-26',
            employeeId: 'e2',
            previous: {
                employeeId: 'e2',
                date: '2026-07-26',
                present: true,
                hoursWorked: 6,
                deletedAt: null
            }
        }];
        const clearUndo = buildBulkUndoPlan(clearChanges, {}, 400);
        testRunner.assertEquals(clearUndo[0].next.present, true, 'debe restaurar la asistencia eliminada');
        testRunner.assertEquals(clearUndo[0].next.hoursWorked, 6, 'debe restaurar sus horas');
        testRunner.assertEquals(clearUndo[0].next.updatedAt, 400, 'la restauración debe ser una escritura local fresca');
    }
});
