import { sameEmployeeNumber } from '../employees/EmployeeNumberIdentity.js';

export const normalizeVoiceName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export const VOICE_MATCH_LEVELS = Object.freeze([0.6, 0.5, 0.4]);

export function levenshteinSimilarity(a, b) {
    a = Array.from(a); b = Array.from(b);
    if (!a.length || !b.length) return a.length === b.length ? 1 : 0;
    let row = Array.from({length:b.length+1}, (_,i)=>i);
    for (let i=1;i<=a.length;i++) {
        const next=[i];
        for (let j=1;j<=b.length;j++) next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));
        row=next;
    }
    return 1-row[b.length]/Math.max(a.length,b.length);
}

export function jaroWinklerSimilarity(a, b) {
    a=Array.from(a); b=Array.from(b);
    if (!a.length || !b.length) return a.length===b.length?1:0;
    const range=Math.max(0,Math.floor(Math.max(a.length,b.length)/2)-1);
    const left=Array(a.length).fill(false),right=Array(b.length).fill(false);
    let matches=0;
    for(let i=0;i<a.length;i++) for(let j=Math.max(0,i-range);j<Math.min(b.length,i+range+1);j++) {
        if (!right[j] && a[i]===b[j]) {left[i]=true;right[j]=true;matches++;break;}
    }
    if(!matches) return 0;
    const l=a.filter((_,i)=>left[i]),r=b.filter((_,i)=>right[i]);
    const transpositions=l.reduce((n,c,i)=>n+(c!==r[i]?1:0),0)/2;
    const jaro=(matches/a.length+matches/b.length+(matches-transpositions)/matches)/3;
    let prefix=0;while(prefix<Math.min(4,a.length,b.length) && a[prefix]===b[prefix]) prefix++;
    return jaro>0.7?jaro+prefix*0.1*(1-jaro):jaro;
}

// Both measures are spelling scores, not probabilities or IPA transcription.
// Levenshtein dominates to avoid over-rewarding a shared short prefix.
export function voiceSpellingSimilarity(a,b) {
    return .75*levenshteinSimilarity(a,b)+.25*jaroWinklerSimilarity(a,b);
}

export function resolveVoiceEmployees(mention={},employees=[],aliases=[]) {
    const name=normalizeVoiceName(mention.spokenName).slice(0,160);
    const number=String(mention.spokenNumber || '').trim();
    if(!name && !number) return [];
    const aliasMap=new Map(aliases.map(row=>[row.employeeId,row.aliases || []]));
    const indexed=employees.map(employee=>({employee,full:normalizeVoiceName(employee.name).slice(0,160),known:(aliasMap.get(employee.id)||[]).map(normalizeVoiceName).filter(Boolean)}));
    const frequency=new Map();
    for(const item of indexed) for(const word of new Set(item.full.split(' '))) frequency.set(word,(frequency.get(word)||0)+1);
    const weight=word=>1+Math.log((employees.length+1)/((frequency.get(word)||0)+1));
    const memo=new Map();
    const similarity=(a,b)=>{const key=a+'\0'+b;if(!memo.has(key)) memo.set(key,voiceSpellingSimilarity(a,b));return memo.get(key);};
    const ordered=value=>value.split(' ').sort().join(' ');
    const ranked=indexed.map(({employee,full,known})=>{
        if(number) return {employee,score:sameEmployeeNumber(employee.number,number)?2:0,reason:'Número coincidente'};
        const tokens=full.split(' '),variants=[full,...tokens,...known];
        if(known.includes(name)) return {employee,score:1,reason:'Alias confirmado'};
        if(tokens.includes(name) || (full && ordered(full)===ordered(name))) return {employee,score:1,reason:'Nombre coincidente'};
        const eligible=variants.filter(v=>Array.from(v).length>=3 && Array.from(name).length>=3);
        let score=Math.max(0,...eligible.map(v=>similarity(name,v)));
        const query=name.split(' ');
        if(query.length>1) {
            // One-to-one token alignment: repeated words cannot reuse the same surname.
            const edges=[];
            query.forEach((q,i)=>tokens.forEach((t,j)=>edges.push({i,j,score:Array.from(q).length>=3 && Array.from(t).length>=3?similarity(q,t):q===t?1:0})));
            edges.sort((a,b)=>b.score*weight(query[b.i])-a.score*weight(query[a.i]));
            const usedQuery=new Set(),usedTarget=new Set();let sum=0;
            for(const edge of edges) if(!usedQuery.has(edge.i) && !usedTarget.has(edge.j)) {usedQuery.add(edge.i);usedTarget.add(edge.j);sum+=edge.score*weight(query[edge.i]);}
            score=Math.max(score,sum/query.reduce((n,q)=>n+weight(q),0));
        }
        return {employee,score:Math.min(.99,score),reason:'Nombre parecido'};
    });
    const threshold=VOICE_MATCH_LEVELS.find(level=>ranked.some(x=>x.score+1e-9>=level));
    if(threshold===undefined) return [];
    return ranked.filter(x=>x.score+1e-9>=threshold).map(x=>({...x,threshold})).sort((a,b)=>b.score-a.score || String(a.employee.name).localeCompare(String(b.employee.name)));
}
