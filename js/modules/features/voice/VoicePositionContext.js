import { normalizeVoiceName, rankVoiceEmployees, voiceMatchCandidates, pickAutomaticVoiceMatch, levenshteinSimilarity } from './VoiceMatching.js';

const words = value => normalizeVoiceName(value).split(' ').filter(Boolean);
const compact = value => normalizeVoiceName(value).replace(/ /g, '');
const generic = new Set('oficial ayudante operador auxiliar tecnico general maestro asistente'.split(' '));
const stops = new Set('prestamo prestamos pesos dolares monto interes tasa cuota cuotas pago pagar cobro factura gasto compra concepto nota nombre numero empleado persona obra hoy ayer manana lunes martes miercoles jueves viernes sabado domingo semana mes ano proximo proxima siguiente anterior nuevo nueva por para con y o que son esta tiene dale dame darle busca buscar registra registrar necesito quiero otro otra primero segundo uno dos tres cuatro cinco seis siete ocho nueve diez veinte cien ciento doscientos trescientos cuatrocientos quinientos seiscientos setecientos ochocientos novecientos mil'.split(' '));

function occurrences(text, phrase) {
    if (!phrase) return [];
    const source = ` ${text} `, needle = ` ${phrase} `, found = [];
    let start = source.indexOf(needle);
    while (start >= 0) { found.push({ start, end: start + phrase.length }); start = source.indexOf(needle, start + 1); }
    return found;
}

// Exact catalog phrases first; a specific word can also describe a compound
// position ("albañil" in "Oficial Albañil"). Typos are suggestions only, and
// only after an explicit position/article cue. No external taxonomy or model.
export function findVoicePositions(transcript, positions = [], protectedName = '', spokenName = '') {
    const text = normalizeVoiceName(transcript).slice(0,16000);
    const protectedSpans = (Array.isArray(protectedName)?protectedName:[protectedName]).flatMap(name=>occurrences(text,normalizeVoiceName(name)));
    const catalog = positions.map(position => ({ position, phrase: normalizeVoiceName(position.name).slice(0,160) })).filter(row => row.phrase.length >= 3 && /\p{L}/u.test(row.phrase));
    const hits = [];
    const add = (phrase, span, candidates, uncertain = false) => {
        if (protectedSpans.some(part => span.start >= part.start && span.end <= part.end)) return;
        const before = text.slice(Math.max(0,span.start-50),span.start).trim().split(' ').slice(-3);
        hits.push({ phrase, ...span, positions: candidates, uncertain, negated: before.some(word => ['no','ni','sin','excepto','menos'].includes(word)) });
    };
    for (const row of catalog) {
        for (const span of occurrences(text,row.phrase)) add(row.phrase,span,[row.position]);
        for (const word of new Set(words(row.phrase))) if (word.length >= 6 && !generic.has(word) && word !== row.phrase) {
            for (const span of occurrences(text,word)) add(word,span,[row.position]);
        }
    }
    // A local match contained in a longer, more specific phrase cannot broaden
    // "Ayudante electricista" into every employee with "Electricista".
    const longest = hits.filter(hit => !hits.some(other => other.start <= hit.start && other.end >= hit.end && other.end-other.start > hit.end-hit.start));
    for (const match of text.matchAll(/\b(?:(?:puesto|posicion|cargo|oficio)\s+(?:(?:de|del|es|como|el|la)\s+)*|(?:el|la)\s+)(?=([\p{L}\p{N} ]+))/gu)) {
        if (/^(el|la) /u.test(match[0])) {
            const before = text.slice(0,match.index).trim();
            const leadingName = normalizeVoiceName(spokenName).split(/\b(?:el|la|puesto|posicion|cargo|oficio)\b/u)[0].trim().split(' ').filter(Boolean);
            if (!leadingName.some((_,index) => { const name=leadingName.slice(0,index+1).join(' ');return before===name || before.endsWith(` ${name}`); })) continue;
        }
        const parts = [];
        for (const word of match[1].split(' ').slice(0,6)) { if (stops.has(word) || /\d/u.test(word)) break; parts.push(word); }
        while (['de','del','el','la'].includes(parts.at(-1))) parts.pop();
        const phrase = parts.join(' '); if (phrase.length < 3) continue;
        const start = match.index + match[0].length, span = { start, end: start+phrase.length };
        if (longest.some(hit => hit.start >= span.start && hit.start < span.end)) continue;
        const approximate = catalog.filter(row => !row.phrase.includes(' ') && phrase.split(' ').length === 1 && phrase.length >= 6 && levenshteinSimilarity(phrase,row.phrase) >= .88);
        add(phrase,span,approximate.map(row=>row.position),true);
    }
    // Merge repeated phrases/duplicate labels without counting them as two jobs.
    const merged = new Map();
    for (const hit of [...longest,...hits.filter(hit => hit.uncertain)]) {
        const key = `${hit.phrase}:${hit.negated}`, prior = merged.get(key);
        if (!prior) merged.set(key,{...hit,positions:[...hit.positions]});
        else for (const position of hit.positions) if (!prior.positions.some(item=>String(item.id)===String(position.id))) prior.positions.push(position);
    }
    return [...merged.values()];
}

function cleanName(name, hints, protectedName) {
    if (protectedName || !hints.length) return name;
    let value = normalizeVoiceName(name);
    for (const hint of hints) for (const span of occurrences(value,hint.phrase).reverse()) value = `${value.slice(0,span.start)} ${value.slice(span.end)}`;
    value = value.replace(/\s+/g,' ').trim().replace(/^(?:(?:el|la|al) )+/,'').replace(/(?: (?:el|la|del|puesto|posicion|cargo|oficio|de))+$/,'').trim();
    return value;
}

function orderWithPosition(ranked, strength) {
    // Stable groups anchored at their highest name score avoid a non-transitive
    // pairwise "within 15 points" comparator. Scores themselves never change.
    const ordered = []; let index = 0;
    while (index < ranked.length) {
        const first = ranked[index++], group = [first];
        while (index < ranked.length && (first.score >= 1 ? ranked[index].score === first.score : ranked[index].score < 1 && first.score-ranked[index].score <= .15)) group.push(ranked[index++]);
        group.sort((a,b)=>strength(b.employee)-strength(a.employee) || b.score-a.score || String(a.employee.name).localeCompare(String(b.employee.name)));
        ordered.push(...group);
    }
    return ordered;
}

export function resolveVoiceEmployeeContext({ mention = {}, transcript = '', employees = [], aliases = [], positions = [], precision = 'high', ignorePosition = false } = {}) {
    const originalName = String(mention.spokenName || '').slice(0,160);
    const roleOnlyMention = positions.some(position=>normalizeVoiceName(position.name)===normalizeVoiceName(originalName).replace(/^(el|la|al) /u,''));
    const key = compact(originalName), orderedName = words(originalName).sort().join(' '), employeeIds = new Set(employees.map(employee=>employee.id));
    const knownForms = !roleOnlyMention && key ? [
        ...employees.filter(employee=>compact(employee.name)===key || words(employee.name).sort().join(' ')===orderedName).map(employee=>employee.name),
        ...aliases.filter(row=>employeeIds.has(row.employeeId)).flatMap(row=>(row.aliases || []).filter(alias=>compact(alias)===key))
    ] : [];
    const knownIdentity = knownForms.length > 0;
    const hints = findVoicePositions(transcript,positions,knownIdentity ? [originalName,...knownForms] : [],originalName);
    const nameQuery = cleanName(originalName,hints,knownIdentity);
    const query = { ...mention, spokenName:nameQuery };
    const ranked = rankVoiceEmployees(query,employees,aliases);
    const active = ignorePosition ? [] : hints;
    const validHints = active.filter(hint=>!hint.negated && hint.positions.length);
    const positionCache = new Map(), matchCache = new Map();
    const employeePositionIds = employee => {
        if (!positionCache.has(employee.id)) positionCache.set(employee.id,new Set((Array.isArray(employee.positions) && employee.positions.length ? employee.positions : [employee.positionId]).filter(id=>id!=null).map(String)));
        return positionCache.get(employee.id);
    };
    const matching = employee => {
        if (!matchCache.has(employee.id)) { const ids=employeePositionIds(employee);matchCache.set(employee.id,validHints.filter(hint=>hint.positions.some(position=>ids.has(String(position.id))))); }
        return matchCache.get(employee.id);
    };
    const strength = employee => matching(employee).length;
    const attach = match => ({...match,positionNames:[...new Set(matching(match.employee).flatMap(hint=>hint.positions.filter(position=>employeePositionIds(match.employee).has(String(position.id))).map(position=>position.name)))]});
    const warnings = [];
    let automatic = pickAutomaticVoiceMatch(ranked,precision);
    const byName = nameQuery ? mention.spokenNumber ? rankVoiceEmployees({spokenName:nameQuery},employees,aliases) : ranked : [];
    const numberConflict = !!mention.spokenNumber && !!nameQuery && !ranked.some(numbered=>byName.some(match=>match.employee.id===numbered.employee.id && match.score>=1));
    if (mention.spokenNumber && !ranked.length) warnings.push('No encontramos el número reconocido. Elige al empleado.');
    else if (numberConflict) warnings.push('El nombre y el número no coinciden. Elige al empleado.');
    if (active.some(hint=>hint.negated)) warnings.push('La posición aparece negada. Confirma a quién te refieres.');
    if (active.some(hint=>!hint.positions.length)) warnings.push('No encontramos esa posición en esta obra. Elige al empleado.');
    else if (active.some(hint=>hint.uncertain)) warnings.push('La posición es aproximada. Confirma al empleado.');
    if (validHints.length>1) warnings.push('Se mencionan varias posiciones. Elige al empleado.');
    const positionConflict = automatic && validHints.length && strength(automatic.employee) < validHints.length;
    if (positionConflict) warnings.push('La identidad coincide, pero su posición no. Elige al empleado.');
    if (!nameQuery && !mention.spokenNumber && active.length) warnings.push('Solo hay una pista de posición. Elige al empleado.');
    let matches = voiceMatchCandidates(ranked);
    if (numberConflict || mention.spokenNumber && positionConflict) matches = [...matches,...voiceMatchCandidates(byName).filter(match=>!matches.some(item=>item.employee.id===match.employee.id))];
    if (!nameQuery && !mention.spokenNumber && validHints.length) matches = employees.filter(employee=>strength(employee)>0).map(employee=>({employee,score:0,reason:'Posición mencionada'}));
    matches = orderWithPosition(matches,ignorePosition?()=>0:strength).map(attach);
    if (warnings.length) automatic = null;
    return { ranked, matches, automatic, hints, nameQuery, warnings, ignored:ignorePosition };
}
