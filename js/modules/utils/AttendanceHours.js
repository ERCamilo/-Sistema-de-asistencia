export const DEFAULT_REGULAR_HOURS_PER_DAY = 8;

export function normalizeRegularHoursPerDay(value) {
    const hours = Number(value);
    return Number.isFinite(hours) && hours > 0
        ? hours
        : DEFAULT_REGULAR_HOURS_PER_DAY;
}

export function resolveDailyTargetHours(dateKey, dayHoursConfig, regularHoursPerDay) {
    const override = Number(dayHoursConfig?.[dateKey]);
    return Number.isFinite(override) && override >= 0
        ? override
        : normalizeRegularHoursPerDay(regularHoursPerDay);
}
