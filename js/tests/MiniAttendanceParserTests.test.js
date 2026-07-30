import { parseMiniAttendanceReport } from '../modules/features/attendance/MiniAttendanceParser.js';

describe('MiniAttendanceParser', () => {
    const collapsedReport = [
        '*Asistencia de hoy martes, 28 de julio*',
        '*Última actualización: 2:30 a. m.*',
        '001. Franklin Henrriquez *12h*',
        '23. Joanel Desilus *11h*',
        '501. Héctor excavadora *4h*'
    ].join(' ');

    test('parses repeated records from collapsed WhatsApp text in source order', () => {
        const result = parseMiniAttendanceReport(collapsedReport);

        expect(result.rows.map(({ rawNumber, rawName, rawHours, totalHours }) => ({
            rawNumber,
            rawName,
            rawHours,
            totalHours
        }))).toEqual([
            {
                rawNumber: '001',
                rawName: 'Franklin Henrriquez',
                rawHours: '12',
                totalHours: 12
            },
            {
                rawNumber: '23',
                rawName: 'Joanel Desilus',
                rawHours: '11',
                totalHours: 11
            },
            {
                rawNumber: '501',
                rawName: 'Héctor excavadora',
                rawHours: '4',
                totalHours: 4
            }
        ]);
        expect(result.unparsedText).toBe('');
        expect(result.unparsedFragments).toEqual([]);
    });

    test('extracts date and update-time hints without inventing a year', () => {
        const result = parseMiniAttendanceReport(collapsedReport);

        expect(result.header.dateHint).toEqual({
            weekday: 'martes',
            day: 28,
            month: 7,
            year: null
        });
        expect(result.header.updateTimeHint).toEqual({
            hour: 2,
            minute: 30,
            meridiem: 'am'
        });
    });

    test('consumes the exact mixed bold and italic wrappers exported by Mini', () => {
        const source = [
            '*Asistencia de hoy martes, 28 de julio*',
            '_Última actualización: 2:30 a. m._',
            '001. Franklin *12h*'
        ].join(' ');
        const result = parseMiniAttendanceReport(source);

        expect(result.header.updateTimeHint).toEqual({
            hour: 2,
            minute: 30,
            meridiem: 'am'
        });
        expect(result.unparsedText).toBe('');
        expect(result.unparsedFragments).toEqual([]);
    });

    test.each([
        ['8,5', 8.5],
        ['12.25', 12.25],
        ['24', 24]
    ])('accepts valid decimal hours written as %s', (rawHours, expectedHours) => {
        const result = parseMiniAttendanceReport(`007. Marie Curie *${rawHours}h*`);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].rawHours).toBe(rawHours);
        expect(result.rows[0].totalHours).toBe(expectedHours);
        expect(result.rows[0].errors).toEqual([]);
    });

    test.each([
        ['0', 'hours_out_of_range'],
        ['-1', 'hours_out_of_range'],
        ['24,5', 'hours_out_of_range'],
        ['Infinity', 'hours_not_finite'],
        ['NaN', 'hours_not_finite']
    ])('keeps invalid hour value %s as a blocking parsed row', (rawHours, errorCode) => {
        const result = parseMiniAttendanceReport(`009. Invalid Hours *${rawHours}h*`);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].rawFragment).toBe(`009. Invalid Hours *${rawHours}h*`);
        expect(result.rows[0].errors).toContain(errorCode);
        expect(result.hasBlockingIssues).toBe(true);
    });

    test('preserves malformed rows and unknown text as visible unparsed fragments', () => {
        const source = [
            'preface that SA does not recognize',
            '001. Valid Person *8h*',
            '002. Missing Marker 7h',
            '003. Another Valid *4h*',
            'trailing note'
        ].join(' ');
        const result = parseMiniAttendanceReport(source);

        expect(result.rows.map(row => row.rawNumber)).toEqual(['001', '003']);
        expect(result.unparsedText).toContain('preface that SA does not recognize');
        expect(result.unparsedText).toContain('002. Missing Marker 7h');
        expect(result.unparsedText).toContain('trailing note');
        expect(result.unparsedFragments).toEqual(expect.arrayContaining([
            expect.objectContaining({ text: 'preface that SA does not recognize' }),
            expect.objectContaining({ text: '002. Missing Marker 7h' }),
            expect.objectContaining({ text: 'trailing note' })
        ]));
        expect(result.hasBlockingIssues).toBe(true);
    });

    test('reports exact source spans and raw fragments', () => {
        const source = 'nota\n014. Wilson Riche *8h*\n015. Manuel Cadet *8h*';
        const result = parseMiniAttendanceReport(source);

        for (const row of result.rows) {
            expect(source.slice(row.sourceSpan.start, row.sourceSpan.end)).toBe(row.rawFragment);
        }
        for (const fragment of result.unparsedFragments) {
            expect(source.slice(fragment.sourceSpan.start, fragment.sourceSpan.end)).toBe(fragment.text);
        }
        expect(result.rows[0].sourceSpan.start).toBe(source.indexOf('014.'));
        expect(result.rows[1].sourceSpan.start).toBe(source.indexOf('015.'));
    });

    test('returns a deeply frozen result so later phases cannot mutate parser evidence', () => {
        const result = parseMiniAttendanceReport('001. Valid Person *8h* unknown');

        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.header)).toBe(true);
        expect(Object.isFrozen(result.rows)).toBe(true);
        expect(Object.isFrozen(result.rows[0])).toBe(true);
        expect(Object.isFrozen(result.rows[0].sourceSpan)).toBe(true);
        expect(Object.isFrozen(result.rows[0].errors)).toBe(true);
        expect(Object.isFrozen(result.unparsedFragments)).toBe(true);
        expect(Object.isFrozen(result.unparsedFragments[0])).toBe(true);
    });
});
