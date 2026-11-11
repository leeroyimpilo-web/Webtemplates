/** PEND private clipboard: ECDH P-256 -> AES-256-GCM. Realtime sees ciphertext only. */
export const CLIPBOARD_LIMIT_BYTES = 10 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', {fatal: true});
const toB64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
const fromB64 = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
const idRule = /^[0-9a-f-]{36}$/i;

export function clipboardTopic(idA, idB) {
  if (!idRule.test(idA) || !idRule.test(idB) || idA === idB) throw new Error('Invalid paired device IDs.');
  return `pend:clipboard:${[idA,idB].sort().join(':')}`;
}

async function sharedKey(privateKey, peerPublicJwk) {
  if (!privateKey || typeof peerPublicJwk !== 'string') throw new Error('Missing verified device key.');
  const jwk = JSON.parse(peerPublicJwk);
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('Invalid peer ECDH public key.');
  const remote = await crypto.subtle.importKey('jwk', jwk,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return crypto.subtle.deriveKey({name:'ECDH',public:remote},privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

export async function encryptClipboard(privateKey, peerPublicJwk, text, senderId, receiverId) {
  clipboardTopic(senderId,receiverId);
  if (typeof text !== 'string') throw new Error('Clipboard must be text.');
  const plaintext=enc.encode(text);
  if(plaintext.byteLength<1 || plaintext.byteLength>CLIPBOARD_LIMIT_BYTES) throw new Error('Clipboard message must be 1–10 KiB.');
  const id=crypto.randomUUID(), nonce=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,
    additionalData:enc.encode(`PEND/CLIPBOARD/1/${senderId}/${receiverId}/${id}`)},
    await sharedKey(privateKey,peerPublicJwk),plaintext);
  return { v:1,id,sender:senderId,receiver:receiverId,createdAt:Date.now(),iv:toB64(nonce),body:toB64(new Uint8Array(data)) };
}

export async function decryptClipboard(privateKey, peerPublicJwk, envelope, senderId, receiverId, now=Date.now()) {
  clipboardTopic(senderId,receiverId);
  const p=envelope;
  if(!p || p.v!==1 || p.sender!==senderId || p.receiver!==receiverId || !idRule.test(p.id) ||
     !Number.isFinite(p.createdAt) || Math.abs(now-p.createdAt)>10*60000 ||
     typeof p.iv!=='string' || p.iv.length>24 || typeof p.body!=='string' || p.body.length>15000) {
    throw new Error('Invalid or expired encrypted clipboard message.');
  }
  const nonce=fromB64(p.iv), cipher=fromB64(p.body);
  if(nonce.length!==12 || cipher.length>CLIPBOARD_LIMIT_BYTES+16 || cipher.length<17) throw new Error('Invalid encrypted data.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,
    additionalData:enc.encode(`PEND/CLIPBOARD/1/${senderId}/${receiverId}/${p.id}`)},
    await sharedKey(privateKey,peerPublicJwk),cipher);
  if(plain.byteLength>CLIPBOARD_LIMIT_BYTES) throw new Error('Clipboard exceeds size limit.');
  return dec.decode(plain);
}
