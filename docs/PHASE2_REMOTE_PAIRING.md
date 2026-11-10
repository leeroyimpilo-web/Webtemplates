# PEND Phase 2 — Pair once, confirm twice, guarded auto-receive

## What is implemented

- 6-digit pairing codes generated with cryptographically secure random bytes, SHA-256 digest stored in `pairing_codes`, never plaintext in Postgres; one-time usage, ten-minute expiry.
- Rate limits: six join attempts per anonymous authenticated identity per ten minutes, three concurrent active codes per identity. **This is not IP-based anti-abuse and is insufficient for an internet-scale production launch.**
- QR (qrcode) and WhatsApp handoff for pairing over different networks, without needing either device on the same Wi-Fi.
- Two-sided confirmation: server marks `pairings.status = paired` only if `a_confirmed AND b_confirmed`, both from device owners.
- Remote device name, platform, SHA-256 fingerprint, and last seen. City is not collected without permission, displayed as unavailable.
- Trusted-device key pinning in local Dexie; original local ECDH key required for re-pin. Revoke pairing sets status revoked and removes local trusted-key entry.
- Recipient selection from paired contacts on Send. Server creates a recipient-addressed transfer room only if status is paired and not revoked.
- Active-in-app receiver watches authorized transfer metadata, joins a private Realtime WebRTC room, compares the transfer header with server-authorized metadata and writes chunks to browser Origin Private File System (OPFS).
- Auto-save policy: verified paired identity and pinned key; device available; file <=5 GiB; extensions .exe .apk .bat .msi .sh .scr rejected for automatic receiving; respect WiFi-only setting. Network type unknown -> require manual confirmation. Never auto-open.
- Inbox has explicit Download and Delete actions for OPFS files. No file contents are stored in Supabase.
- Protocol and policy tests run in CI.

## Important limitations / blockers

- **Unfinished Phase 1 real-device acceptance tests are carried forward**, as explicitly authorized by the user. Do not claim real transfers or auto-receive are validated before physical testing.
- This PWA can listen to trusted transfers only **while the app is open**. Browser service workers cannot keep persistent WebRTC data channels or access the file system automatically after termination. Always-on auto-receive requires the later Capacitor/native Android service.
- OPFS is browser-managed storage, subject to quota/eviction and per-browser implementation. A user must explicitly download a received file to place it in Downloads.
- Browsers may not expose whether Wi-Fi or cellular data is used. Under WiFi-only settings an unknown network triggers manual approval rather than guessing it is Wi-Fi.
- Heartbeat, offline pending queues, disconnected-session resume, and trusted-file delivery to closed apps are Phase 3/Capacitor work.
- Without a TURN provider, different-network WebRTC media/data may fail despite remote pairing succeeding. Add TURN_URL, TURN_USER, TURN_PASS using a time-limited credential issuing service before public launch.
- Code guessing limit is per-anonymous-user; production needs IP/device/application rate limits and signup abuse defense. Six digits are inherently low-entropy.
- ECDH P-256 public keys are exchanged as device metadata and verified by fingerprint; WebRTC provides DTLS transport encryption. End-to-end encrypted metadata and stronger QR/SAS authentication are future security hardening.
- Supabase RLS and RPC security need integration tests under TWO separate anonymous user JWTs before production. All open security advisors must be reviewed.
- The next phase must not begin until the user approves it; they have asked to build forward and repair afterwards, so incomplete acceptance tests are logged rather than silently marked complete.

## Manual smoke test plan

1. Enable anonymous sign-ins; deploy preview to HTTPS, set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the **PEND/Sharedit** project, with TURN credentials if available.
2. On browser A, register device and generate a code on Contacts. Check it displays 6 digits and expires in 10 min.
3. On different network browser B, register second device and enter code. Both see peer fingerprints and must select Yes; one Yes must leave the pair pending.
4. After both confirm, paired devices appear in Contacts. Try safe file transfer with both PEND tabs open. If Wi-Fi cannot be verified, manually approve and confirm OPFS download.
5. Test executable extension requires manual confirmation; test >5 GiB requires manual; revoke and confirm new trusted transfer is refused.
6. Verify Supabase Storage remains empty and no file bytes appear in Realtime, SQL tables, network requests other than WebRTC DataChannel.
7. Check phone lock/app closure prevents background receive, as documented; Phase 5 Capacitor will address this.
