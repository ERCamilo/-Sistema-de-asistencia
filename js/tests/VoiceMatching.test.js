import { jaroWinklerSimilarity, levenshteinSimilarity, resolveVoiceEmployees } from '../modules/features/voice/VoiceMatching.js';
const people=names=>names.map((name,i)=>({id:String(i),number:String(i+1),name}));
test('spelling measures handle insertion, transposition, Unicode and known Jaro-Winkler examples',()=>{
 expect(levenshteinSimilarity('cliff','cleeft')).toBe(.5);
 expect(jaroWinklerSimilarity('martha','marhta')).toBeCloseTo(.961111,5);
 expect(jaroWinklerSimilarity('dwayne','duane')).toBeCloseTo(.84,5);
 expect(levenshteinSimilarity('王小明','王小名')).toBeCloseTo(2/3);
});
test('fallback tiers widen only when the higher tier is empty; unrelated names stay excluded',()=>{
 expect(resolveVoiceEmployees({spokenName:'cleeft'},people(['Cliff']))[0]).toMatchObject({threshold:.5,reason:'Nombre parecido'});
 expect(resolveVoiceEmployees({spokenName:'yanpie'},people(['Jean Pierre']))[0]).toMatchObject({threshold:.5});
 expect(resolveVoiceEmployees({spokenName:'cafe'},people(['Cliff']))[0]).toMatchObject({threshold:.4});
 const matches=resolveVoiceEmployees({spokenName:'cleeft'},people(['Cleft','Cliff']));
 expect(matches.map(x=>x.employee.name)).toEqual(['Cleft']);expect(matches[0].threshold).toBe(.6);
 expect(resolveVoiceEmployees({spokenName:'xyz'},people(['Cliff','Juan Carlos Rodríguez']))).toEqual([]);
});
test('multiple name parts rank surname evidence and never create an automatic exact partial match',()=>{
 const matches=resolveVoiceEmployees({spokenName:'Juan Carlos Rodrigez'},people(['Juan Carlos Ramírez','Juan Carlos Rodríguez','Carlos Ruiz']));
 expect(matches[0].employee.name).toBe('Juan Carlos Rodríguez');expect(matches[0].score).toBeLessThan(1);
 expect(resolveVoiceEmployees({spokenName:'Rodríguez Carlos Juan'},people(['Juan Carlos Rodríguez']))[0].score).toBe(1);
});
test('shared confirmed variant cannot hide a real employee name; numbers preserve exact precedence',()=>{
 const employees=people(['Cliff','Cleeft']);const aliases=[{employeeId:'1',aliases:['cliff']}];
 expect(resolveVoiceEmployees({spokenName:'cliff'},employees,aliases).filter(x=>x.score===1)).toHaveLength(2);
 expect(resolveVoiceEmployees({spokenNumber:'2',spokenName:'Cliff'},employees,aliases).map(x=>x.employee.id)).toEqual(['1']);
 expect(resolveVoiceEmployees({spokenNumber:'999',spokenName:'Cliff'},employees,aliases)).toEqual([]);
});
test('full names match without spaces, including accents and misplaced spaces',()=>{
 const employees=people(['Juan Carlos Rodríguez','Carla Medina']);
 for(const name of ['juancarlosrodriguez','JuanCarlosRodríguez','JuanCar losRodríguez']) {
  expect(resolveVoiceEmployees({spokenName:name},employees)[0]).toMatchObject({employee:{id:'0'},score:1,reason:'Nombre coincidente'});
 }
 const typo=resolveVoiceEmployees({spokenName:'juancarlosrodriges'},employees)[0];
 expect(typo.employee.id).toBe('0');expect(typo.score).toBeLessThan(1);expect(typo.threshold).toBe(.6);
});
test('compact aliases match in either direction and compact name collisions retain every exact candidate',()=>{
 const employees=people(['Ana Bel','Anabel','Carlos Méndez']);
 expect(resolveVoiceEmployees({spokenName:'anabel'},employees).filter(x=>x.score===1).map(x=>x.employee.id)).toEqual(['0','1']);
 const aliases=[{employeeId:'2',aliases:['Carlito de la obra']}];
 expect(resolveVoiceEmployees({spokenName:'carlitodelaobra'},employees,aliases)[0]).toMatchObject({employee:{id:'2'},score:1,reason:'Alias confirmado'});
 expect(resolveVoiceEmployees({spokenName:'Car lito'},employees,[{employeeId:'2',aliases:['carlito']}])[0]).toMatchObject({employee:{id:'2'},score:1});
 expect(resolveVoiceEmployees({spokenName:'juancarlosrodriguez',spokenNumber:'2'},employees).map(x=>x.employee.id)).toEqual(['1']);
});
