# PEND Phase 4 · Sprint 8 — Thumbnails, cross-device clipboard and nearby route hints

## Implemented in this development sprint

1. **Sender-side preview:** For supported JPEG/PNG/WebP/GIF and common video formats, the browser attempts to decode a small preview frame and JPEG-compress it to at most 200 KiB. It sends bounded preview parts over the **WebRTC DataChannel before the file header**; not through Supabase. Failures (unsupported video decode or browser media API) skip the optional preview rather than abort the transfer. Preview is only a thumbnail; never auto-opens content.
2. **Receiver-side preview:** Both one-time transfer and trusted-receiver screens reassemble at most five size-checked preview chunks. A trusted incoming file's preview is available during manual approval. Preview is only in memory and does not change file auto-accept rules.
3. **Encrypted clipboard:** A paired contact can send up to 10 KiB of text using an encrypted Supabase Realtime broadcast. The sender derives a shared AES-256-GCM key using their existing non-extractable ECDH P-256 private key and the verified/pinned remote device public key; a new random 96-bit IV and authenticated sender/receiver/message IDs are used per message. No plaintext is stored on the server. The recipient explicitly chooses **Copy to clipboard** after decrypting. Both browsers must be open. The Realtime topic itself is not private yet; only authenticated ciphertext is protected. Production requires further network authorization and replay/abuse hardening.
4. **Nearby route hints:** PEND inspects the selected WebRTC ICE candidate pair without exposing IP addresses. It can distinguish TURN relay vs direct host candidates, displaying a cautiously worded hint. Browser JavaScript cannot perform cross-platform mDNS LAN discovery or guarantee 'No mobile data used'. The full local discovery and no-cellular-data claim require supported native APIs (planned Android work in Phase 5) and real-device verification. This limitation must remain visible.

## Verification

- Unit tests: peer ECDH decryption, wrong-key rejection, encrypted payload bounds and expiry, split/reassemble 200 KiB thumbnails, wrong-transfer rejection and folder/request tests. Local suite: 35 passing tests.
- GitHub Actions: npm ci, typecheck, full automated tests and Next.js build on `pend-phase4`.

## Not verified or incomplete

- [ ] Real two-network encrypted clipboard delivery and trusted pairing revocation while a channel remains open
- [ ] Real JPEG and video thumbnails on Android/Safari, browser media API behavior
- [ ] Actual selected candidate pair on the same Wi-Fi (browser route hint is not a guarantee of LAN-only traffic)
- [ ] Production Realtime authorization, IP-based abuse prevention and browser storage handling
- [ ] Full Phase 4 acceptance tests: group of three devices, folder structure and hash comparison, file request end-to-end

**Do not begin Phase 5 Android work before the Phase 4 implementation and checks have been reviewed.** The user requested working forward before repairing all older physical-device issues, so unfinished tests are explicitly carried forward instead of reported as passing.
