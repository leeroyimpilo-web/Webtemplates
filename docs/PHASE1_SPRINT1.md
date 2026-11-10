# PEND — Phase 1, Sprint 1 (experimental)

## Development status

Phase 1 Sprint 1 implemented as a first P2P transfer path. This is a work-in-progress prototype, **not a tested production transfer system**. Sender creates a one-time code, recipient enters it, and authenticated peers signal SDP/ICE over **Supabase Realtime private channels**. The file travels over **WebRTC DataChannel only**, never through Supabase Storage or a Next.js upload route.

This implementation uses **native `RTCPeerConnection`** rather than PeerJS's external PeerServer. PeerJS does not natively use Supabase Realtime for signaling, so this avoids introducing an unauthorised third-party signaling server. A PeerJS-compatible adapter can be investigated, but is NOT claimed implemented yet. This is an explicit deviation from the originally requested wrapper and requires architectural review before release.

## Architecture

- `supabase/phase1_rooms.sql`: protected room creation / joining RPCs and `realtime.messages` RLS for participant-only SDP/ICE.
- `src/lib/transfer/rooms.ts`: CSPRNG 6-digit one-time transfer code and SHA-256 client digest.
- `src/lib/transfer/rtc.ts`: direct WebRTC peer, ICE, SDP and DataChannel with Supabase signaling.
- `src/lib/transfer/stream.ts`: `file.stream()` reader, fixed-size <=64 KiB chunks, DataChannel bufferedAmount backpressure.
- `src/app/send/page.tsx`: sender UI, file selection, one-time code, progress and cancel.
- `src/app/receive/page.tsx`: receiver enters code, manual review, File System Access API save dialog, disk streaming.

**Safety boundaries:** a room code is not a trusted pairing. No auto-accept. Signed-in participants only; no file bytes sent via Supabase. RLS scopes signaling to the two room participants. A rate limit of six failed/successful join attempts per ten minutes per anonymous auth identity reduces accidental guessing; account creation can bypass it, so additional IP-level abuse controls / CAPTCHA are required before public launch.

**Important limitations to resolve before Sprint 1 acceptance:**

- No TURN server configured: connectivity between some networks will fail behind NAT/firewalls. Server-side TURN credential issuance is required. The sample uses public STUN only.
- The browser File System Access API isn't available everywhere (notably Safari/iOS). Those browsers get a clear unsupported-browser message instead of buffering a multi-GB file in RAM.
- This first iteration sends a **single file per session**. Folder/multi-file, resume, pause, checksum verification and pairing are not implemented.
- The sender page must remain open for duration; pending-after-close is Phase 3 and requires durable local source and background capabilities.
- FileSystemWritableFileStream may not guarantee file persists on disk after disconnection unless close succeeds; interrupted files must not be treated as complete.
- Anonymous sign-ins must be enabled in Supabase Authentication -> Providers. Phase 0 live onboarding and PWA installation still require device verification.
- Signaling rooms expire after 10 minutes. Both peers must join during that window; established WebRTC transfers may continue afterward.

## Deployment prerequisites

1. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the secure Vercel environment or local `.env.local` (publishable key only).
2. Enable Anonymous Sign-Ins in Supabase for the **PEND** project, not TenderBase.
3. Apply the **one-time SQL migration** `supabase/phase1_rooms.sql` to the PEND project.
4. Ensure Supabase Realtime private channel authorization is on. Optionally disable all public Realtime access in Realtime Settings.
5. Build using `npm ci && npm run typecheck && npm run build`.

## Manual acceptance tests (NOT yet passed)

- [ ] Device onboarding in two separate anonymous browser sessions
- [ ] Sender gets one-time six-digit code, receiver joins exactly once
- [ ] Unknown user cannot subscribe to another room's private channel
- [ ] Code expires after 10 minutes; 7th join request in 10 minutes fails
- [ ] Chrome-to-Chrome transfer of 10 MB
- [ ] Chrome-to-Chrome transfer of 1 GB with accurate progress
- [ ] Receiver saves to disk; server holds metadata/signaling only
- [ ] Invalid or already-used code rejected
- [ ] Abort cancels sender and prevents completed status
- [ ] Disconnect/failure leaves a clear error rather than a fake success

Do not move to Sprint 2, Phase 2 or Phase 3 without the acceptance tests and user approval.
