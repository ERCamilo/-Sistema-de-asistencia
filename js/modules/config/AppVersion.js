// Release logic: pure data and injected IO, without browser globals.
const APP_VERSION = '1.7.90';
const CHANGELOG = [
    { version: '1.7.90', date: '2026-10-20', title: 'Novedades y actualizaciones a tu ritmo', items: ['Consulta las mejoras de cada versión desde Ajustes.', 'Elige cuándo actualizar sin interrumpir tu trabajo.', 'Busca actualizaciones y revisa sus novedades antes de instalarlas.'] },
    { version: '1.7.89', date: '2026-10-20', title: 'Exportaciones a SplitX más completas', items: ['Exporta empresa, período, días y tarifas por puesto.', 'Consulta abonos de préstamos y saldos proyectados por separado.'] }
];
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
function validVersion(value) {
    return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
        && value.split('.').every(part => Number.isSafeInteger(Number(part)));
}
function compareVersions(a, b) {
    if (!validVersion(a) || !validVersion(b))
        return 0;
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < 3; i++)
        if (left[i] !== right[i])
            return left[i] > right[i] ? 1 : -1;
    return 0;
}
function getUnseenReleases(lastSeen, changelog = CHANGELOG) {
    if (!validVersion(lastSeen))
        return [];
    return changelog.filter(release => compareVersions(release.version, lastSeen) > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}
function shouldPromptForUpdate(input) {
    return input.hasController && validVersion(input.currentVersion) && validVersion(input.availableVersion)
        && compareVersions(input.availableVersion, input.currentVersion) > 0
        && (!validVersion(input.lastPromptedVersion) || compareVersions(input.availableVersion, input.lastPromptedVersion) > 0);
}
function shouldCheckForUpdate(input) {
    return input.online !== false && Number.isFinite(input.now)
        && (!Number.isFinite(input.lastCheckedAt) || input.lastCheckedAt <= 0 || input.now < input.lastCheckedAt || input.now - input.lastCheckedAt >= CHECK_INTERVAL_MS);
}
function isReleaseManifest(value) {
    var _a;
    if (!value || typeof value !== 'object')
        return false;
    const data = value;
    return validVersion(data.version) && Array.isArray(data.changelog) && data.changelog.length > 0 && data.changelog.length <= 100
        && ((_a = data.changelog[0]) === null || _a === void 0 ? void 0 : _a.version) === data.version && data.changelog.every((entry, index) => validVersion(entry === null || entry === void 0 ? void 0 : entry.version) && (index === 0 || compareVersions(data.changelog[index - 1].version, entry.version) > 0)
        && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && typeof entry.title === 'string' && entry.title.length > 0 && entry.title.length <= 200
        && Array.isArray(entry.items) && entry.items.length > 0 && entry.items.length <= 30
        && entry.items.every(item => typeof item === 'string' && item.length > 0 && item.length <= 500));
}

export { APP_VERSION, CHANGELOG, CHECK_INTERVAL_MS, compareVersions, getUnseenReleases, shouldPromptForUpdate, shouldCheckForUpdate, isReleaseManifest };
