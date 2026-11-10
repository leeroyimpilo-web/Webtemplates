const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let policy;
test.before(async () => { policy = await import(pathToFileURL(path.join(__dirname, '../src/lib/transfer/auto-policy.mjs')).href); });
const base = {paired: true, pinned: true, available: true, fileName: 'photo.jpg', fileSize: 2097152, wifiOnly: true, networkType: 'wifi', online:true,hasPrivateInbox:true};
test('trusted, safe Wi-Fi transfer can auto-save', () => assert.equal(policy.assessAutoReceive(base).auto, true));
test('unknown or revoked pair cannot auto-save', () => {
  assert.equal(policy.assessAutoReceive({...base,paired:false}).auto,false);
  assert.equal(policy.assessAutoReceive({...base,revoked:true}).auto,false);
  assert.equal(policy.assessAutoReceive({...base,pinned:false}).auto,false);
});
test('all six dangerous extensions demand confirmation', () => {
  for(const ext of policy.BLOCKED_EXTENSIONS) assert.equal(policy.assessAutoReceive({...base,fileName:`hello.${ext.toUpperCase()}`}).auto,false);
});
test('5GiB default limit enforced', () => {
  assert.equal(policy.assessAutoReceive({...base,fileSize:5 * 1024**3}).auto,true);
  assert.equal(policy.assessAutoReceive({...base,fileSize:5 * 1024**3+1}).auto,false);
});
test('WiFi-only blocks mobile data and unknown network type', () => {
  assert.equal(policy.assessAutoReceive({...base,networkType:'cellular'}).auto,false);
  assert.equal(policy.assessAutoReceive({...base,networkType:'unknown'}).auto,false);
  assert.equal(policy.assessAutoReceive({...base,networkType:'unknown',wifiOnly:false}).auto,true);
});
test('availability and browser storage are required', () => {
  assert.equal(policy.assessAutoReceive({...base,available:false}).auto,false);
  assert.equal(policy.assessAutoReceive({...base,online:false}).auto,false);
  assert.equal(policy.assessAutoReceive({...base,hasPrivateInbox:false}).auto,false);
});
