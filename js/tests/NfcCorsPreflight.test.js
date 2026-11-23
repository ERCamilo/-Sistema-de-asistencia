const {MAIN,PREVIEW,UNTRUSTED,cases,endpointFromSource,check,checkAll}=require('../../scripts/check-nfc-cors.cjs');
const response=(acao,{status=204,methods='POST, OPTIONS',headers='content-type'}={})=>({status,headers:{get:k=>({
 'access-control-allow-origin':acao,'access-control-allow-methods':methods,'access-control-allow-headers':headers,'vary':'Origin'
})[k.toLowerCase()]||''}});
const endpoint=endpointFromSource();
test('CORS checker rejects unexpected webhook hosts',()=>{
 expect(new URL(endpoint).hostname).toBe('n8n.erlin.do');
 expect(()=>endpointFromSource("export const NFC_ENDPOINT = 'https://other.test/webhook/x';")).toThrow('Unexpected');
});
test('three preflights: main and preview allowed; synthetic origin denied',async()=>{
 const requests=[];
 const result=await checkAll({endpoint,checks:cases,fetchImpl:async(u,opt)=>{
  requests.push(opt);return response(opt.headers.Origin===UNTRUSTED?MAIN:opt.headers.Origin);
 }});
 expect(result.ok).toBe(true);
 expect(requests).toHaveLength(3);
 expect(requests.every(x=>x.method==='OPTIONS'&&x.body==null&&x.credentials==='omit')).toBe(true);
});
test('static preview ACAO is invalid for main origin',async()=>{
 const result=await check({endpoint,origin:MAIN,allowed:true,fetchImpl:async()=>response(PREVIEW)});
 expect(result.ok).toBe(false);
 expect(result.problems).toContain('wrong Access-Control-Allow-Origin');
});
test('wildcard on an unknown origin is not acceptable',async()=>{
 const result=await check({endpoint,origin:UNTRUSTED,allowed:false,fetchImpl:async()=>response('*')});
 expect(result.ok).toBe(false);
});
test('method and content-type missing cause failures',async()=>{
 const result=await check({endpoint,origin:MAIN,allowed:true,fetchImpl:async()=>response(MAIN,{methods:'OPTIONS',headers:'authorization'})});
 expect(result.ok).toBe(false);
 expect(result.problems).toContain('POST not allowed');
 expect(result.problems).toContain('content-type not allowed');
});
test('redirect to Access login and network failure are not treated as success',async()=>{
 const redirect=await check({endpoint,origin:MAIN,allowed:true,fetchImpl:async()=>response(MAIN,{status:302})});
 const broken=await check({endpoint,origin:MAIN,allowed:true,fetchImpl:async()=>{throw Error('offline')}});
 expect(redirect.ok).toBe(false);expect(broken.ok).toBe(false);
});
