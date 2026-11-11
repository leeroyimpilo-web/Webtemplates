# PEND Phase 4 · Sprint 7 — Group, Folder, Request a File

## Changes

- **Local groups:** Add/delete local groups of already trusted paired devices. One click queues a separate authenticated P2P transfer for each member; the existing pending worker sends to available contacts and leaves others queued. The group list is Dexie/IndexedDB only; it is not shared across your devices.
- **Folder send:** Choose a folder on browsers supporting `webkitdirectory`. An original-path manifest + the raw file parts are represented as a single `Blob`/`File` without loading the whole folder into JavaScript memory. The existing 64 KiB P2P transfer and resume protocol sends that package. The container format (`PENDFDR1`) is PEND-specific, not ZIP. Recipients must **manually approve** `.pendpack` files to prevent hidden executable bypass. In Chromium desktop browsers, Inbox → Extract prompts for a destination and writes individual files with preserved paths, streaming 64 KiB at a time. Other browsers can keep/download the package; extraction outside PEND requires an additional fallback.
- **File requests:** A participant-checked database RPC creates a request, the trusted receiver can decline it or select a file to reply. The reply is queued locally in Dexie with a corresponding transfer row and link to the request. The server does not retrieve or hold requested file bytes. Each account may make at most 30 requests per day (auth-identity limit, not IP-based abuse prevention).
- **Inbox improvements:** Local search by filename/sender, date/size filters, file download and delete, explicit on-demand image/video preview, platform sharing, folder contents inspector and explicit folder extraction.
- **Navigation:** Groups and Requests added to desktop menu and linked from Send/Contacts. Mobile retains five-tab navigation, with Groups/Requests reachable from relevant screens.

## Verification

- Local test suite: folder format, nested paths, unsafe traversal rejection, duplicate filenames, bounded extraction, executable-in-container requiring manual approval. Together with prior tests: 26 passing tests.
- GitHub Actions CI checks `npm ci`, `npm run typecheck`, `npm run test:all`, and `npm run build` on the `pend-phase4` branch.

## Outstanding acceptance and follow-on features

- [ ] Real three-device group fanout with devices on different networks; queued send to offline peer confirmed
- [ ] Real folder transfer + extraction + content hash comparison
- [ ] Real Request a File across two separate authenticated browser devices and RLS isolation test
- [ ] Android, Safari and Chrome storage/FS Access compatibility testing
- [ ] **Phase 4 Sprint 8:** Pre-transfer thumbnail (max 200 KiB), authenticated encrypted cross-device clipboard (max 10 KiB), and honest nearby LAN detection/constraints; never claim "No mobile data used" without verifiable route evidence
- [ ] **Phase 5 only after Phase 4:** Capacitor Android + foreground services, notifications and real background transfer tests

Existing Phase 1–3 physical-device acceptance tests remain unfinished, per user's explicit instruction to proceed and repair them after development. Do not claim production readiness or background receiving by closed browsers.
