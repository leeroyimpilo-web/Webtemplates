# Phase 3 · Presence, Pending, reconnect-resume (development)

## Implemented in this sprint

1. A foreground 20-second heartbeat with a **server-derived 40-second freshness check**. Devices have `available`, `busy`, and `invisible` modes, with optional Wi-Fi-only and explicit data override.
2. A **server-side protected** `queue_trusted_transfer` RPC. Only authenticated owners of mutually confirmed trusted devices may queue metadata. Files are retained **only in the sender's IndexedDB**, not Supabase Storage.
3. A pending dashboard showing local source availability, recipient status and received-byte metadata. The foreground worker polls and activates one eligible pending transfer at a time. The database enforces a maximum of two active transfers per device.
4. Connection interruption parks metadata back to Pending; reconnect constructs a new authorized WebRTC room and resumes from the receiver's **committed OPFS length** (rounded down to a 64 KiB boundary).
5. The receiver writes to OPFS, commits its file every 1 MiB before acknowledging the sender, and reports byte progress via owner-checked RPC. It never auto-opens files.
6. Cancel, server-side expiry (seven-day metadata TTL), and recovery of abandoned sessions after three minutes of inactivity.

## Important limitations and unverified acceptance criteria

- **Browsers cannot keep WebRTC sockets or 20-second heartbeat running after the tab/PWA is closed.** A pending transfer can resume after the *sender reopens* PEND while the receiver is available and PEND is running; it cannot begin with both apps closed. True background delivery requires the Phase 5 native Capacitor background service and OS-specific testing.
- Browser IndexedDB quota and eviction policies mean that storing a large pending Blob is best-effort. If data is cleared or evicted, the original file must be reselected. PEND does not upload file bytes to Supabase.
- Network Information API is absent in many browsers, so Wi-Fi-vs-cellular may read `unknown`. Wi-Fi-only **fails closed** until network detection succeeds or the receiver explicitly enables **Download on Data** in Settings.
- UI and protocol logic were tested locally, but **real two-device transfer, 1 GB / 5 GB performance, crash-recovery after power loss, mobile Safari/Chrome, TURN connectivity, and full browser installation still need testing**.
- File metadata includes a placeholder `file_hash`; whole-file integrity verification / hostile peer hardening require further work.
- The receiver saves to the **origin-private browser Inbox**. Browser pages cannot silently write the user's external Downloads folder.
- With the PWA closed and no sender process, the server retains **metadata only**. Stored transfers expire after seven days unless cancelled or completed.

## Security boundaries

- Every RPC verifies `auth.uid()` and device ownership, status, and (where relevant) mutual pairing.
- Expired/revoked pairing cannot activate a new transfer.
- Receiver may auto-receive only if paired and pinned, file extension is allowed, size ≤5 GiB and its network/availability rules allow it. Otherwise a manual approval prompt is mandatory.
- Server never receives file chunks. Only transfer IDs, file names/types/sizes, status and acknowledged bytes are stored.

## Next verification

- [ ] Run `npm ci && npm run typecheck && npm run test:all && npm run build` (GitHub CI).
- [ ] Use two separately signed-in browser profiles and pair via codes.
- [ ] Queue a file while receiver is offline, reopen, then confirm transfer starts.
- [ ] Disconnect at 50%, reopen both browsers, and compare file SHA-256 after resuming.
- [ ] Verify Busy, Invisible, Wi-Fi-only, and data override.
- [ ] Test revocation during and before a queued transfer.
- [ ] Test browser storage eviction and insufficient storage errors.
