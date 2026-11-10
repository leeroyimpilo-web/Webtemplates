# PEND execution plan

**Phase 0:** foundation only. Device onboarding, project schema, responsive shell, PWA. Pairing/transfer/presence UI is intentionally labeled as future.

**Phase 1:** WebRTC + PeerJS data channel; signaling via Supabase Realtime; 64-KiB chunking with backpressure and stream-to-disk. Test transfers on real browsers and networks; do not assume memory stability.

**Phase 2:** remote 6-digit pairing; atomic one-time code redemption; confirmation on both sides; crypto key validation; trusted auto-accept policy with blocklist/5 GB cap.

**Phase 3:** heartbeat and availability; pending queue and expiry; reconnect; disk-safe resumable transfers; cross-browser and mobile foreground/background testing.

**Stop at Phase 3** until all Phase 3 acceptance tests pass and user explicitly agrees to Phase 4.

### Critical product constraints

- No file bytes on Supabase servers. WebRTC relay/TURN transports encrypted bytes in flight, which is not equivalent to file storage.
- 6-digit code hash must never be readable through RLS. Redemption must be rate-limited; no codes issued in Phase 0.
- Same-network detection is distinct from a TURN-relayed connection; show "Local" only when demonstrably on LAN.
- Browser service workers cannot maintain a reliable 20-second heartbeat or receive files when the web app is fully closed. Capacitor Android/background service needs design and OS testing.
- Files can be queued in IndexedDB, but browsers can evict large blobs under storage pressure. Treat persistence and very large files as qualified, not guaranteed.
