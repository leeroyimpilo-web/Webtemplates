const {test}=require('node:test');const assert=require('node:assert/strict');
const {splitPreview,acceptPreviewChunk}=require('../src/lib/transfer/thumbnail.mjs');
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('small thumbnail split into bounded parts and reassembled in any order',()=>{
 const encoded=Buffer.alloc(190*1024, 18).toString('base64');
 const chunks=splitPreview(encoded,id);
 assert.ok(chunks.length>=3&&chunks.length<=5);
 assert.ok(chunks.every(x=>x.data.length<=65536));
 const state={total:null,parts:new Map()};let result;
 for(const chunk of [...chunks].reverse()){const x=acceptPreviewChunk(state,chunk,id);if(x)result=x;}
 assert.equal(result,`data:image/jpeg;base64,${encoded}`);
});
test('preview refuses wrong transfer id or malformed entries',()=>{
 const state={total:null,parts:new Map()};
 assert.throws(()=>acceptPreviewChunk(state,{...splitPreview('AAAA',id)[0],index:8},id));
 assert.throws(()=>acceptPreviewChunk(state,splitPreview('AAAA',id)[0],'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
});
test('oversize thumbnail is refused',()=>assert.throws(()=>splitPreview(Buffer.alloc(201*1024).toString('base64'),id)));
