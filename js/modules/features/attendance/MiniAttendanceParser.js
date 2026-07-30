const SPANISH_MONTHS = Object.freeze({
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
});

const DATE_HEADER_PATTERN =
    /([*_]?)\s*Asistencia\s+de\s+hoy\s+([a-záéíóúüñ]+),?\s+(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\s*\1/iu;
const UPDATE_TIME_PATTERN =
    /([*_]?)\s*(?:Última|Ultima)\s+actualización:\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?\s*\1/iu;
const RECORD_START_PATTERN = /(?:^|\s)(\d+)\.\s+/gu;
const RECORD_PATTERN = /^(\d+)\.\s+([\s\S]*?)\s+\*([^*]*?)h\*/iu;

function normalizeCapturedText(value) {
    return String(value ?? '').trim();
}

function normalizeLookupText(value) {
    return normalizeCapturedText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('es');
}

function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) {
        return value;
    }

    seen.add(value);
    for (const child of Object.values(value)) {
        deepFreeze(child, seen);
    }
    return Object.freeze(value);
}

function createSourceSpan(start, end) {
    return { start, end };
}

function extractHeader(source, consumedRanges) {
    const dateMatch = DATE_HEADER_PATTERN.exec(source);
    let dateHint = null;

    if (dateMatch) {
        const monthName = normalizeLookupText(dateMatch[4]);
        dateHint = {
            weekday: normalizeCapturedText(dateMatch[2]).toLocaleLowerCase('es'),
            day: Number(dateMatch[3]),
            month: SPANISH_MONTHS[monthName],
            year: dateMatch[5] ? Number(dateMatch[5]) : null
        };
        consumedRanges.push(createSourceSpan(dateMatch.index, dateMatch.index + dateMatch[0].length));
    }

    const updateTimeMatch = UPDATE_TIME_PATTERN.exec(source);
    let updateTimeHint = null;

    if (updateTimeMatch) {
        updateTimeHint = {
            hour: Number(updateTimeMatch[2]),
            minute: Number(updateTimeMatch[3]),
            meridiem: `${updateTimeMatch[4].toLocaleLowerCase('es')}m`
        };
        consumedRanges.push(createSourceSpan(
            updateTimeMatch.index,
            updateTimeMatch.index + updateTimeMatch[0].length
        ));
    }

    return { dateHint, updateTimeHint };
}

function findRecordStarts(source) {
    const starts = [];
    const pattern = new RegExp(RECORD_START_PATTERN.source, RECORD_START_PATTERN.flags);
    let match;

    while ((match = pattern.exec(source)) !== null) {
        const numberOffset = match[0].lastIndexOf(match[1]);
        starts.push(match.index + numberOffset);
    }

    return starts;
}

function parseHours(rawHours) {
    const normalizedHours = rawHours.replace(',', '.');
    const totalHours = Number(normalizedHours);

    if (!Number.isFinite(totalHours)) {
        return {
            totalHours: null,
            errors: ['hours_not_finite']
        };
    }
    if (totalHours <= 0 || totalHours > 24) {
        return {
            totalHours,
            errors: ['hours_out_of_range']
        };
    }
    return { totalHours, errors: [] };
}

function parseRows(source, consumedRanges) {
    const starts = findRecordStarts(source);
    const rows = [];

    for (let index = 0; index < starts.length; index += 1) {
        const start = starts[index];
        const candidateEnd = starts[index + 1] ?? source.length;
        const candidate = source.slice(start, candidateEnd);
        const match = RECORD_PATTERN.exec(candidate);

        if (!match) {
            continue;
        }

        const rawNumber = normalizeCapturedText(match[1]);
        const rawName = normalizeCapturedText(match[2]);
        const rawHours = normalizeCapturedText(match[3]);
        if (!rawName || !rawHours) {
            continue;
        }

        const end = start + match[0].length;
        const { totalHours, errors } = parseHours(rawHours);
        const rawFragment = source.slice(start, end);
        const sourceSpan = createSourceSpan(start, end);

        rows.push({
            rawNumber,
            rawName,
            rawHours,
            totalHours,
            sourceSpan,
            rawFragment,
            errors
        });
        consumedRanges.push(sourceSpan);
    }

    return rows;
}

function mergeRanges(ranges) {
    const sorted = [...ranges].sort((left, right) => left.start - right.start);
    const merged = [];

    for (const range of sorted) {
        const previous = merged[merged.length - 1];
        if (!previous || range.start > previous.end) {
            merged.push({ ...range });
        } else {
            previous.end = Math.max(previous.end, range.end);
        }
    }
    return merged;
}

function trimFragmentRange(source, start, end) {
    const text = source.slice(start, end);
    const firstNonWhitespace = text.search(/\S/u);
    if (firstNonWhitespace === -1) {
        return null;
    }

    const trailingWhitespaceLength = text.match(/\s*$/u)[0].length;
    const trimmedStart = start + firstNonWhitespace;
    const trimmedEnd = end - trailingWhitespaceLength;
    return {
        text: source.slice(trimmedStart, trimmedEnd),
        sourceSpan: createSourceSpan(trimmedStart, trimmedEnd)
    };
}

function collectUnparsedFragments(source, consumedRanges) {
    const fragments = [];
    const ranges = mergeRanges(consumedRanges);
    let cursor = 0;

    for (const range of ranges) {
        const fragment = trimFragmentRange(source, cursor, range.start);
        if (fragment) {
            fragments.push(fragment);
        }
        cursor = Math.max(cursor, range.end);
    }

    const trailingFragment = trimFragmentRange(source, cursor, source.length);
    if (trailingFragment) {
        fragments.push(trailingFragment);
    }
    return fragments;
}

/**
 * Parses one Mini WhatsApp attendance report without mutating application state.
 * Unknown or malformed source text is retained as blocking parser evidence.
 */
export function parseMiniAttendanceReport(input) {
    const source = typeof input === 'string' ? input : String(input ?? '');
    const consumedRanges = [];
    const header = extractHeader(source, consumedRanges);
    const rows = parseRows(source, consumedRanges);
    const unparsedFragments = collectUnparsedFragments(source, consumedRanges);
    const unparsedText = unparsedFragments.map(fragment => fragment.text).join('\n');
    const hasBlockingIssues =
        unparsedFragments.length > 0 || rows.some(row => row.errors.length > 0);

    return deepFreeze({
        source,
        header,
        rows,
        unparsedFragments,
        unparsedText,
        hasBlockingIssues
    });
}

export default parseMiniAttendanceReport;
