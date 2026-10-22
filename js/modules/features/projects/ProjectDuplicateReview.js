import { findSimilarProjects, matchProjectStaff } from './ProjectSimilarity.js';

/**
 * 📋 ProjectDuplicateReview — lo que muestra «Obras repetidas» por cada par.
 *
 * Resume cada obra y calcula qué tiene cada una que la otra no (personas, días
 * de asistencia y préstamos). Parte de la misma comparación que la sugerencia
 * (ProjectSimilarity), así que lo que se ve es lo que se sugirió. Puro: no lee
 * ni escribe nada.
 */

const trimId = value => String(value ?? '').trim();

function loanIdsOf(employeeIds, employeesById) {
    const ids = new Set();
    for (const employeeId of employeeIds) {
        const loans = employeesById.get(employeeId)?.loans;
        if (!Array.isArray(loans)) continue;
        for (const loan of loans) if (trimId(loan?.id)) ids.add(trimId(loan.id));
    }
    return ids;
}

const countMissing = (from, other) => [...from].filter(item => !other.has(item)).length;

function daysDiff(match) {
    const out = { both: 0, onlyA: 0, onlyB: 0 };
    for (const { a, b } of match.pairs) {
        const daysB = new Set(b.days);
        const daysA = new Set(a.days);
        out.both += a.days.filter(day => daysB.has(day)).length;
        out.onlyA += a.days.filter(day => !daysB.has(day)).length;
        out.onlyB += b.days.filter(day => !daysA.has(day)).length;
    }
    out.onlyA += match.onlyA.reduce((sum, person) => sum + person.days.length, 0);
    out.onlyB += match.onlyB.reduce((sum, person) => sum + person.days.length, 0);
    return out;
}

function summaryOf(project, people, personDays, loans, range) {
    return {
        id: trimId(project.id), name: String(project.name ?? ''), createdAt: project.createdAt ?? null,
        people, days: personDays, loans: loans.size, from: range?.from ?? null, to: range?.to ?? null
    };
}

function describePair(pair, employees, options) {
    const match = matchProjectStaff(pair.a, pair.b, employees, options);
    const employeesById = new Map(employees.map(employee => [trimId(employee?.id), employee]));
    const peopleA = [...match.pairs.map(item => item.a), ...match.onlyA];
    const peopleB = [...match.pairs.map(item => item.b), ...match.onlyB];
    const loansA = loanIdsOf(peopleA.flatMap(person => person.employeeIds), employeesById);
    const loansB = loanIdsOf(peopleB.flatMap(person => person.employeeIds), employeesById);
    const days = daysDiff(match);
    const diff = {
        both: match.pairs.length,
        onlyA: match.onlyA.map(({ name, number }) => ({ name, number })),
        onlyB: match.onlyB.map(({ name, number }) => ({ name, number })),
        daysBoth: days.both, daysOnlyA: days.onlyA, daysOnlyB: days.onlyB,
        loansBoth: loansA.size - countMissing(loansA, loansB),
        loansOnlyA: countMissing(loansA, loansB), loansOnlyB: countMissing(loansB, loansA)
    };
    return {
        id: `${trimId(pair.a.id)}|${trimId(pair.b.id)}`,
        level: pair.level, score: pair.score, matched: pair.matched, nameScore: pair.nameScore,
        attendance: pair.attendance,
        a: summaryOf(pair.a, match.peopleA, peopleA.reduce((sum, person) => sum + person.days.length, 0), loansA, pair.attendance.rangeA),
        b: summaryOf(pair.b, match.peopleB, peopleB.reduce((sum, person) => sum + person.days.length, 0), loansB, pair.attendance.rangeB),
        diff,
        adds: {
            a: diff.onlyA.length > 0 || diff.daysOnlyA > 0 || diff.loansOnlyA > 0,
            b: diff.onlyB.length > 0 || diff.daysOnlyB > 0 || diff.loansOnlyB > 0
        }
    };
}

/** Pares sospechosos con su resumen, de más a menos parecidos. */
export function buildProjectPairReviews({ projects = [], employees = [], attendance = [], defaultProjectId = '' } = {}) {
    const list = Array.isArray(employees) ? employees : [];
    const options = { defaultProjectId, attendance };
    return findSimilarProjects(projects, list, options).map(pair => describePair(pair, list, options));
}

export default { buildProjectPairReviews };
