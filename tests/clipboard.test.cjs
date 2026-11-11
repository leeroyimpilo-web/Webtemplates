const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
global.crypto=webcrypto;
const {encryptClipboard,decryptClipboard,clipboardTopic}=require('../src/lib/clipboard-crypto.mjs');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
async function keypair(){return crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey','deriveBits'])}
async function pub(k){return JSON.stringify(await crypto.subtle.exportKey('jwk',k.publicKey));}
test('clipboard topic symmetric and bound to devices',()=>{
 assert.equal(clipboardTopic(a,b),clipboardTopic(b,a));assert.throws(()=>clipboardTopic(a,a));
});
test('only paired ECDH key may decrypt remote message',async()=>{
 const x=await keypair(),y=await keypair(),stranger=await keypair();
 const box=await encryptClipboard(x.privateKey,await pub(y),'hello ✓',a,b);
 assert.ok(!JSON.stringify(box).includes('hello'));
 assert.equal(await decryptClipboard(y.privateKey,await pub(x),box,a,b),'hello ✓');
 await assert.rejects(async()=>decryptClipboard(stranger.privateKey,await pub(x),box,a,b));
 await assert.rejects(async()=>decryptClipboard(y.privateKey,await pub(x),box,a,c));
});
test('limit enforced on UTF-8 bytes',async()=>{
 const x=await keypair(),y=await keypair();
 await assert.rejects(async()=>encryptClipboard(x.privateKey,await pub(y),'🎁'.repeat(3000),a,b));
 const box=await encryptClipboard(x.privateKey,await pub(y),'x',a,b);
 await assert.rejects(async()=>decryptClipboard(y.privateKey,await pub(x),{...box,createdAt:Date.now()-11*60000},a,b));
});
