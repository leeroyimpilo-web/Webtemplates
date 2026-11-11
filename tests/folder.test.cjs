const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createFolderPackage, readFolderManifest, validateFolderPath, extractFolderPackage} = require('../src/lib/folder-package.mjs');
const {assessAutoReceive} = require('../src/lib/transfer/auto-policy.mjs');
// Node 22 supplies File via node:buffer; install as global for cross-runtime tests.
global.File ||= require('node:buffer').File;
test('folder packages preserve nested path and exact byte order',async()=>{
 const pack=createFolderPackage([{relativePath:'Photos/2026/photo.jpg',file:new Blob(['ab'])},{relativePath:'Notes/a.txt',file:new Blob(['hello'])}], 'Family');
 const manifest=await readFolderManifest(pack);
 assert.equal(manifest.entries.length,2);
 assert.equal(manifest.entries[1].offset,2);
 const bytes=new Uint8Array(await pack.slice(manifest.dataOffset).arrayBuffer());
 assert.equal(new TextDecoder().decode(bytes),'abhello');
});
test('path traversal and duplicate paths rejected',()=>{
 for(const bad of ['/etc/passwd','a/../b','a//b','a/./b','a\\b','../x'])assert.throws(()=>validateFolderPath(bad));
 assert.throws(()=>createFolderPackage([{relativePath:'a',file:new Blob(['x'])},{relativePath:'a',file:new Blob(['y'])}]));
});
test('invalid package length is rejected',async()=>{
 const blob=new Blob(['PENDFDR1',new Uint8Array([0,0,0,7]),'garbage']);
 await assert.rejects(()=>readFolderManifest(blob));
});
test('folder package always requires explicit approval',()=>{
 const got=assessAutoReceive({paired:true,pinned:true,fileName:'Family.pendpack',fileSize:999,wifiOnly:false});
 assert.equal(got.auto,false);
});
test('extract uses bounded chunks and reconstructs tree',async()=>{
 const pack=createFolderPackage([{relativePath:'Pictures/a.txt',file:new Blob(['hello'])},{relativePath:'Pictures/b.txt',file:new Blob(['world'])}]);
 const files=new Map();
 const dir={
  async getDirectoryHandle(){return this;},
  async getFileHandle(n){return {async createWritable(){const chunks=[];return {async write(v){chunks.push(new Uint8Array(v));},async close(){files.set(n,new TextDecoder().decode(Buffer.concat(chunks.map(x=>Buffer.from(x)))));},async abort(){}}}}}
 };
 assert.equal(await extractFolderPackage(pack,dir),2);
 assert.equal(files.get('a.txt'),'hello');assert.equal(files.get('b.txt'),'world');
});
