/**
 * 🌱 DemoSeed.js
 * Generador de datos de prueba para inicializar el sistema con un escenario realista.
 * Incluye un mes de historia, horas decimales, horas extras, feriados y contrataciones tardías.
 */

import { getDateKey } from '../utils/DateUtils.js';

export function getDemoSeed(options = {}) {
    const today = new Date();
    const attendance = {};
    
    // ... (rest of the setup)
    const settings = {
        companyName: 'Constructora Horizon S.R.L.',
        regularHoursPerDay: 8,
        attendancePositionWatermarks: true,
        holidayFactor: 2,
        holidays: [] 
    };

    const positions = [
        { id: 'pos-ayudante', name: 'Ayudante', hourlyRate: 120, color: '#94a3b8', active: true },
        { id: 'pos-albanil', name: 'Albañil', hourlyRate: 180, color: '#10b981', active: true },
        { id: 'pos-carpintero', name: 'Carpintero', hourlyRate: 210, color: '#f59e0b', active: true },
        { id: 'pos-gerente', name: 'Gerente de Obra', hourlyRate: 500, color: '#8b5cf6', active: true }
    ];

    const leaders = [
        { id: 'lead-001', name: 'Ing. Roberto García', number: 'L001', active: true }
    ];

    positions.forEach(p => {
        if (p.id !== 'pos-gerente') p.leaderId = 'lead-001';
    });

    const day1 = new Date(today); day1.setDate(today.getDate() - 30);
    const day10 = new Date(today); day10.setDate(today.getDate() - 20);
    const day20 = new Date(today); day20.setDate(today.getDate() - 10);

    const employees = [
        { id: 'emp-001', number: '001', name: 'Juan Pérez', positions: ['pos-albanil'], active: true, hireDate: getDateKey(day1) },
        { id: 'emp-002', number: '002', name: 'Carlos López', positions: ['pos-albanil'], active: true, hireDate: getDateKey(day1) },
        { id: 'emp-003', number: '003', name: 'Miguel Rodríguez', positions: ['pos-carpintero'], active: true, hireDate: getDateKey(day10) },
        { id: 'emp-004', number: '004', name: 'Pedro Martínez', positions: ['pos-ayudante'], active: true, hireDate: getDateKey(day20) },
        { id: 'emp-005', number: '005', name: 'Luis García', positions: ['pos-ayudante'], active: true, hireDate: getDateKey(day1) }
    ];

    // 🚩 INYECCIÓN DE CONFLICTOS SI SE SOLICITA
    if (options.includeConflicts) {
        // Conflicto 1: Empleado con mismo número pero distinto ID y nombre (Debe unificarse por número)
        employees.push({
            id: 'emp-conflict-001',
            number: '001', // Colisión con Juan Pérez
            name: 'Juan Pérez (DUPLICADO)',
            positions: ['pos-ayudante'],
            active: true,
            updatedAt: Date.now() + 1000 // Más reciente
        });

        // Conflicto 2: Puesto con mismo nombre (Se unificará por slug en sanitizePositions)
        positions.push({
            id: 'pos-duplicate-albanil',
            name: 'Albañil',
            hourlyRate: 185,
            color: '#10b981',
            active: true
        });

        // Conflicto 3: Asistencia duplicada ya insertada (overwritten by IndexedDB put)
    }

    const holidayIndices = new Set([5, 25]);
    for (let i = 0; i < 30; i++) {
        const currentDate = new Date(day1);
        currentDate.setDate(day1.getDate() + i);
        const dateKey = getDateKey(currentDate);
        const isHoliday = holidayIndices.has(i);
        const isWeekend = currentDate.getDay() === 0;

        employees.forEach(emp => {
            if (dateKey < emp.hireDate) return;
            if (isWeekend && Math.random() > 0.1) return;
            if (Math.random() < 0.05 && !isHoliday) return;

            const attKey = `${emp.id}-${dateKey}`;
            let hours = 8;
            attendance[attKey] = {
                employeeId: emp.id,
                date: dateKey,
                present: true,
                hoursWorked: hours,
                overtimeHours: 0,
                isHoliday: isHoliday,
                positionHours: [{ positionId: emp.positions[0], hours: hours }]
            };
        });
    }

    return {
        version: '1.2.0-conflict-test',
        timestamp: new Date().toISOString(),
        data: {
            settings,
            positions,
            leaders,
            employees,
            attendance
        }
    };
}
