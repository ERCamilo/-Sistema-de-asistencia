import { findVoicePositions, resolveVoiceEmployeeContext } from '../modules/features/voice/VoicePositionContext.js';
import { rankVoiceEmployees } from '../modules/features/voice/VoiceMatching.js';

const positions=[{id:'brick',name:'Albañil'},{id:'electric',name:'Electricista'},{id:'helper',name:'Ayudante electricista'},{id:'plumb',name:'Plomero'}];
const employees=[{id:'a',name:'Juan Méndez',number:'00125',positions:['brick']},{id:'b',name:'Juan Pérez',number:'00126',positions:['brick','electric']},{id:'c',name:'Carlos Alonso',number:'00127',positions:['plumb']}];
const resolve=(name,text,extra={})=>resolveVoiceEmployeeContext({mention:{spokenName:name},transcript:text,employees,positions,...extra});

test('a position orders homonyms, including a secondary position, without changing name scores or selecting by role',()=>{
    const result=resolve('Juan','Préstamo a Juan, el electricista, quinientos pesos');
    expect(result.matches.map(m=>m.employee.id)).toEqual(['b','a']);expect(result.automatic).toBeNull();
    expect(result.matches[0].positionNames).toEqual(['Electricista']);
    expect(result.ranked).toEqual(rankVoiceEmployees({spokenName:'Juan'},employees));
    expect(result.matches.map(m=>m.score)).toEqual([1,1]);
});
test('an exact unique identity retains precedence; a conflicting role requires manual resolution',()=>{
    const result=resolve('Carlos Alonso','Préstamo a Carlos Alonso, el electricista');
    expect(result.matches[0].employee.id).toBe('c');expect(result.matches[0].score).toBe(1);expect(result.automatic).toBeNull();
    expect(result.warnings.join(' ')).toContain('su posición no');
    expect(resolve('Carlos Alonso','Préstamo a Carlos Alonso, el plomero').automatic.employee.id).toBe('c');
});
test('number/name/role conflicts keep the number first and show name candidates, never silently reassign',()=>{
    const result=resolve('Juan','Juan, el electricista, número 00125',{mention:{spokenName:'Juan',spokenNumber:'00125'}});
    expect(result.matches.map(m=>m.employee.id)).toEqual(['a','b']);expect(result.matches[0].score).toBe(2);expect(result.automatic).toBeNull();
    const mismatch=resolve('Carlos','Carlos número 00125',{mention:{spokenName:'Carlos',spokenNumber:'00125'}});
    expect(mismatch.matches.map(m=>m.employee.id)).toEqual(['a','c']);expect(mismatch.warnings.join(' ')).toContain('nombre y el número');
    const unknown=resolve('Juan','Juan número 999',{mention:{spokenName:'Juan',spokenNumber:'999'}});
    expect(unknown.automatic).toBeNull();expect(unknown.matches).toHaveLength(2);expect(unknown.warnings.join(' ')).toContain('número reconocido');
});
test('missing role data and old positionId do not cause arbitrary assignments',()=>{
    const result=resolve('Juan','Juan el electricista',{employees:[{...employees[0],positions:[]},{...employees[1],positions:[],positionId:'electric'}]});
    expect(result.matches[0].employee.id).toBe('b');expect(result.automatic).toBeNull();
});
test('bare roles, including a person whose name equals the role, never auto-select',()=>{
    const result=resolve('electricista','Préstamo al electricista de quinientos pesos',{employees:[...employees,{id:'d',name:'Electricista',number:'4',positions:['electric']}]});
    expect(result.nameQuery).toBe('');expect(result.automatic).toBeNull();expect(result.matches.map(m=>m.employee.id)).toEqual(expect.arrayContaining(['b','d']));
    expect(result.warnings.join(' ')).toContain('Solo hay una pista');
});
test('a role included in the extracted name is removed only for matching, retaining the original mention',()=>{
    const mention={spokenName:'Juan el electricista'};const result=resolve('','Préstamo a Juan el electricista',{mention});
    expect(result.nameQuery).toBe('juan');expect(mention.spokenName).toBe('Juan el electricista');expect(result.matches[0].employee.id).toBe('b');
});
test('canonical full names and confirmed nicknames containing role words are preserved',()=>{
    const people=[{id:'d',name:'Juan Maestro',number:'4',positions:['brick']}];
    const catalog=[...positions,{id:'master',name:'Maestro'}];
    const named=resolve('Juan Maestro','Préstamo a Juan Maestro',{employees:people,positions:catalog});
    expect(named.nameQuery).toBe('Juan Maestro');expect(named.hints).toEqual([]);expect(named.automatic.employee.id).toBe('d');
    const alias=resolve('el maestro Juan','Préstamo a el maestro Juan',{employees:people,positions:catalog,aliases:[{employeeId:'d',aliases:['el maestro juan']}]});
    expect(alias.hints).toEqual([]);expect(alias.automatic.employee.id).toBe('d');
    for(const name of ['Maestro Juan','JuanMaestro']) {
        const reordered=resolve(name,'Préstamo a Juan Maestro',{employees:people,positions:catalog});
        expect(reordered.hints).toEqual([]);expect(reordered.automatic.employee.id).toBe('d');
    }
});
test('specific compound phrases win over included generic labels',()=>{
    const result=resolve('Juan','Juan el ayudante electricista',{employees:[...employees,{id:'d',name:'Juan Carlos',number:'4',positions:['helper']}]});
    expect(result.hints).toHaveLength(1);expect(result.hints[0].positions.map(p=>p.id)).toEqual(['helper']);expect(result.matches[0].employee.id).toBe('d');
    const partial=resolve('Juan','Juan electricista',{positions:[{id:'electric',name:'Oficial electricista'}]});
    expect(partial.matches[0].employee.id).toBe('b');
});
test('several positions remain a manual decision, while a negated role is never a positive clue',()=>{
    const multiple=resolve('Juan','Juan es electricista y albañil');expect(multiple.hints).toHaveLength(2);expect(multiple.automatic).toBeNull();expect(multiple.warnings.join(' ')).toContain('varias posiciones');
    const negative=resolve('Juan','Juan no es electricista');expect(negative.hints[0].negated).toBe(true);expect(negative.matches.every(m=>!m.positionNames.length)).toBe(true);expect(negative.automatic).toBeNull();
});
test('unknown/typo positions are editable clues and force review rather than being invented',()=>{
    const unknown=resolve('Carlos','Carlos el perforista quinientos pesos');expect(unknown.hints[0].phrase).toBe('perforista');expect(unknown.automatic).toBeNull();expect(unknown.warnings.join(' ')).toContain('No encontramos esa posición');
    const typo=resolve('Juan','Juan el eletricista quinientos pesos');expect(typo.matches[0].employee.id).toBe('b');expect(typo.hints[0].uncertain).toBe(true);expect(typo.automatic).toBeNull();
    expect(resolve('Carlos','Carlos, puesto de perforista').automatic).toBeNull();
});
test('time/payment articles and word fragments are not positions',()=>{
    for(const text of ['Carlos para la siguiente semana','Carlos el lunes','Carlos la factura de hoy','Carlos albañilería quinientos']) expect(resolve('Carlos',text).hints).toEqual([]);
});
test('ignoring role evidence keeps name/number identity constraints and the complete candidate list',()=>{
    const result=resolve('Juan','Juan el electricista',{ignorePosition:true});expect(result.matches.map(m=>m.employee.id)).toEqual(['a','b']);expect(result.automatic).toBeNull();expect(result.matches.every(m=>!m.positionNames.length)).toBe(true);
    const exact=resolve('Carlos','Carlos el electricista',{ignorePosition:true});expect(exact.automatic.employee.id).toBe('c');
    const number=resolve('Carlos','Carlos el electricista 00125',{ignorePosition:true,mention:{spokenName:'Carlos',spokenNumber:'00125'}});expect(number.automatic).toBeNull();
});
test('a consistent explicit number keeps automatic identity resolution even when the role was included in the extracted name',()=>{
    const result=resolve('Juan el electricista','Juan el electricista 00126',{mention:{spokenName:'Juan el electricista',spokenNumber:'00126'}});
    expect(result.automatic.employee.id).toBe('b');expect(result.automatic.score).toBe(2);expect(result.warnings).toEqual([]);
});
