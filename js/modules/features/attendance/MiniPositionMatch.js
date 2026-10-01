/**
 * Mini >= 2.15 reports the day's position for employees with more than one
 * position: by SA id (P2P rows) and/or by name (WhatsApp " _Position_").
 * Returns the matching position id, only among the employee's own positions;
 * null when nothing matches (SA then asks, as before).
 */
function normalizePositionName(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function resolveMiniPositionId({ positionIds = [], positions = [], id = null, name = null } = {}) {
    const own = Array.isArray(positionIds) ? positionIds : [];
    if (id && own.includes(id)) return id;
    const wanted = normalizePositionName(name);
    if (!wanted) return null;
    const matches = (Array.isArray(positions) ? positions : [])
        .filter(position => position && own.includes(position.id) && normalizePositionName(position.name) === wanted);
    return matches.length === 1 ? matches[0].id : null;
}

export default resolveMiniPositionId;
