
import { getDateKey } from '../utils/DateUtils.js';

export const demoData = {
    settings: {
        companyName: 'Constructora Demo',
        regularHoursPerDay: 8,
        holidayFactor: 2,
        holidays: []
    },
    positions: [
        {
            id: 'ayudante',
            name: 'Ayudante',
            hourlyRate: 104,  // ${icons.get('info')} NUEVO: Tarifa por hora (25,000/30/8 ≈ 104)
            salaryConfig: {   // Mantener para compatibilidad
                amount: 25000,
                period: 'month',
                workDays: [1, 2, 3, 4, 5, 6]
            },
            color: '#94a3b8',
            leaderId: null,
            active: true
        },
        {
            id: 'albanil',
            name: 'Albañil',
            hourlyRate: 146,  // ${icons.get('info')} NUEVO: Tarifa por hora (35,000/30/8 ≈ 146)
            salaryConfig: {   // Mantener para compatibilidad
                amount: 35000,
                period: 'month',
                workDays: [1, 2, 3, 4, 5, 6]
            },
            color: '#10b981',
            leaderId: null,
            active: true
        },
        {
            id: 'carpintero',
            name: 'Carpintero',
            hourlyRate: 175,  // ${icons.get('info')} NUEVO: Tarifa por hora (42,000/30/8 ≈ 175)
            salaryConfig: {   // Mantener para compatibilidad
                amount: 42000,
                period: 'month',
                workDays: [1, 2, 3, 4, 5, 6]
            },
            color: '#f59e0b',
            leaderId: null,
            active: true
        }
    ],
    employees: [
        { id: 'EMP001', number: '001', name: 'Juan Pérez', position: 'albanil', active: true, positions: ['albanil'] },
        { id: 'EMP002', number: '002', name: 'Carlos López', position: 'albanil', active: true, positions: ['albanil'] },
        { id: 'EMP003', number: '003', name: 'Miguel Rodríguez', position: 'carpintero', active: true, positions: ['carpintero'] },
        { id: 'EMP004', number: '004', name: 'Pedro Martínez', position: 'ayudante', active: true, positions: ['ayudante'] },
        { id: 'EMP005', number: '005', name: 'Luis García', position: 'ayudante', active: true, positions: ['ayudante'] }
    ],
    attendance: {}
};

// Generar asistencia de prueba para últimos 7 días
export function generateDemoAttendance() {
    const attendance = {};
    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateKey = getDateKey(date);

        demoData.employees.forEach((emp, idx) => {
            // 80% de probabilidad de asistir
            if (Math.random() > 0.2) {
                const key = `${emp.id}-${dateKey}`;
                const hours = 8 + (Math.random() > 0.7 ? 2 : 0); // 30% trabaja 10h
                attendance[key] = {
                    employeeId: emp.id,
                    date: dateKey,
                    present: true,
                    hoursWorked: hours,
                    overtimeHours: hours > 8 ? hours - 8 : 0,
                    isHoliday: false,
                    useTempPosition: false,
                    notes: '',
                    multiPosition: false,
                    positionHours: [{ positionId: emp.position, hours: hours }]
                };
            }
        });
    }

    return attendance;
}
