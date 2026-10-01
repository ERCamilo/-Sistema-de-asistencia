import { parseMiniAttendanceReport } from '../modules/features/attendance/MiniAttendanceParser.js';

// Mini >= 2.15: employees with more than one position carry " _Position_" after the hours.
describe('MiniAttendanceParser · day position suffix', () => {
    const report = [
        '*Asistencia de hoy miércoles, 30 de septiembre*',
        '_Última actualización: 12:05 a. m._',
        '',
        '001. Franklin Henrriquez  *8h* _Plomero_',
        '002. Pauliny Buchamps  *8h*',
        '018. Jean Michel carate  *10h* _Albañil de primera_',
        '500. Hector excavadora  *8h*'
    ].join('\n');

    test('reads the position and leaves nothing unparsed', () => {
        const result = parseMiniAttendanceReport(report);
        expect(result.unparsedText).toBe('');
        expect(result.hasBlockingIssues).toBe(false);
        expect(result.rows.map(row => [row.rawNumber, row.rawName, row.totalHours, row.rawPosition ?? null])).toEqual([
            ['001', 'Franklin Henrriquez', 8, 'Plomero'],
            ['002', 'Pauliny Buchamps', 8, null],
            ['018', 'Jean Michel carate', 10, 'Albañil de primera'],
            ['500', 'Hector excavadora', 8, null]
        ]);
    });

    test('rows without a position keep exactly the previous shape', () => {
        const row = parseMiniAttendanceReport(report).rows[1];
        expect(Object.prototype.hasOwnProperty.call(row, 'rawPosition')).toBe(false);
    });

    test('works when WhatsApp collapses the lines into one', () => {
        const result = parseMiniAttendanceReport(report.split('\n').join(' '));
        expect(result.unparsedText).toBe('');
        expect(result.rows.map(row => row.rawPosition ?? null)).toEqual(['Plomero', null, 'Albañil de primera', null]);
    });

    test('older Mini reports (no suffix) parse as before', () => {
        const old = report.replace(/ _[^_]+_/g, '');
        const result = parseMiniAttendanceReport(old);
        expect(result.unparsedText).toBe('');
        expect(result.rows.every(row => !('rawPosition' in row))).toBe(true);
    });

    test('a broken suffix is still reported as unparsed (never silently dropped)', () => {
        const result = parseMiniAttendanceReport('*Asistencia de hoy miércoles, 30 de septiembre*\n001. Ana  *8h* _Plomero');
        expect(result.unparsedText).toContain('_Plomero');
        expect(result.hasBlockingIssues).toBe(true);
    });
});
