/**
 * Canonical employee-number identity shared by SA conflict surfaces.
 * Display formatting is preserved; only comparisons use Number(...) semantics,
 * matching Mini's EmployeeNumberRules. Legacy non-numeric identifiers fall
 * back to exact trimmed text so existing alphanumeric fichas keep working.
 */
export function normalizeEmployeeNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

export function employeeNumberIdentityKey(value) {
    const normalized = normalizeEmployeeNumber(value);
    if (normalized !== null) return `n:${Object.is(normalized, -0) ? 0 : normalized}`;
    const text = String(value ?? '').trim();
    return text ? `s:${text}` : null;
}

export function sameEmployeeNumber(left, right) {
    const leftKey = employeeNumberIdentityKey(left);
    return leftKey !== null && leftKey === employeeNumberIdentityKey(right);
}

export default { normalizeEmployeeNumber, employeeNumberIdentityKey, sameEmployeeNumber };
