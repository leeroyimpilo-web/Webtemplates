# PEND — Phase 1, Sprint 2: reliable direct transfer

## Implemented in source

- 64 KiB maximum chunks from `File.stream()`; never buffer the whole file.
- One mebibyte receive ACK window; sender cannot outpace asynchronous disk writes.
- Progress reflects bytes acknowledged *after* receiver disk writes, not merely enqueued into WebRTC.
- Sender and receiver pause/resume controls work **while the same DataChannel remains active**.
- Transfer cancellation, size and protocol validation, partial-file abort on disconnect.
- Disk write acknowledgement offsets recorded locally in Dexie at 1 MiB increments.
- Browser-local Inbox shows completed transfer history metadata (not file contents).
- SQL migration fixes a serious rate-limit bug: failed code guesses now persist in the attempt log instead of being rolled back.
- Unit tests for metadata validation, bounded chunk streaming, pause/resume, forged ACKs, cancellation, a synthetic 1 GiB stream and lost-first-hello retries.

- Receiver repeats the initial Realtime hello until the sender answers so first-message loss does not strand a transfer.

## Not implemented yet

- Cross-session resume, durable local source retention, offline pending queue: **Phase 3**.
- Pair once / trusted auto-accept: **Phase 2**.
- Multiple files, folders, groups, auto-accept on Android, native background persistence: later phases.
- Turn credentials: no TURN service is configured yet, so some cross-network pairs will fail.
- Receiver save picker: browser File System Access API; currently intended for modern desktop Chromium. Safari/iOS and many mobile browsers do not support it. Avoid claiming all-browser compatibility.
- No application-level file checksum yet. The DataChannel is protected by WebRTC DTLS, but that does not make endpoints trusted.
- Authentication/rate limiting: 6 guesses per anonymous identity per 10 minutes does not stop attackers who create multiple identities. IP-level protection and bot mitigation are required before public internet launch.
- Realtime permissions are checked on channel join. A joined room may remain usable past invitation expiry until reauthorization/connection expiry; account for this in production.

## Manual acceptance tests still required

- [ ] Anonymous sign-in enabled and two physical browsers complete device onboarding
- [ ] Same-network 10 MB file sender -> receiver -> final file matches source
- [ ] 1 GB **real-browser** file streaming transfers without sustained memory growth (synthetic unit test added)
- [ ] Pause in mid-transfer, resume on the same connection
- [ ] Cancel/disconnect before end does not mark a file complete
- [ ] Repeated wrong codes are throttled after six committed attempts
- [ ] RLS prevents unrelated anonymous user from reading or publishing signaling
- [ ] One-time code expires, cannot be reused
- [ ] WAN network test with actual TURN credentials

**Do not begin Phase 2 or Phase 3 until the user approves.**

## Important transport note

The spec requests PeerJS on top of Supabase signaling, but PeerJS assumes its own PeerServer message protocol; `RTCPeerConnection` with explicit Supabase Realtime SDP/ICE signaling is used here instead. This deliberate deviation is documented rather than silently ignored.
