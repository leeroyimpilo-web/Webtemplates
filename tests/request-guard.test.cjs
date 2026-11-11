const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/phase4_requests.sql'),'utf8');
test('file request RPC protects sender device ownership',()=>assert.match(sql,/create_file_request[\s\S]*?private\.owns_device\(p_requester_device_id\)/i));
test('reply RPC requires target device ownership and paired status',()=>{
 assert.match(sql,/fulfill_file_request[\s\S]*?private\.owns_device\(p_target_device_id\)/i);
 assert.match(sql,/fulfill_file_request[\s\S]*?a_confirmed\s+and\s+p\.b_confirmed/i);
});
test('browser direct grant is not issued on transfer_requests',()=>assert.doesNotMatch(sql,/grant\s+(insert|update|delete).*\btransfer_requests\b/i));
