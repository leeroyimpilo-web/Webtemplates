# PEND — Peer-to-Peer File Transfer

**Send any file, any size, to anyone. Pending until they're online. Paired once, auto-receive forever.**

> **Product vision — not a production guarantee.** PEND is an experimental, offline-aware peer-to-peer file transfer web app. Phase 0–3 development code exists; automated builds and protocol tests have passed, but **end-to-end real-device and cross-network transfers have not yet been validated**. Browser limitations mean transfers cannot start automatically with both apps closed.

## What is PEND?

PEND aims to solve two file-sharing problems:

1. **Pending delivery:** A sender can queue a file when a trusted receiver is offline. The server stores **metadata only**, while the sender's browser holds the file until both browsers are open and a direct connection is possible.
2. **Pair once:** Two users connect with a six-digit code or QR link, **both explicitly confirm** each other's devices, and can then share approved files without repeating the acceptance prompt, subject to safety rules.

No file bytes are uploaded to Supabase Storage or the application server. WebRTC carries the file data between peers.

## Current development status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Next.js PWA, anonymous identity, device registration, database RLS | Implemented; complete browser onboarding and installation tests outstanding |
| 1 | WebRTC signaling and streamed file transfer, progress, pause/cancel | Implemented; real 10 MB / 1 GB / 5 GB device tests outstanding |
| 2 | Six-digit remote pairing, dual approval, trusted contacts, guarded auto-receive | Implemented; end-to-end security and physical-device tests outstanding |
| 3 | Presence, pending metadata queue, Wi-Fi-only controls, reconnect-resume | Implemented; end-to-end offline/resume tests outstanding |
| 4 | Group send, folders, file requests, clipboard, thumbnails, nearby route hints | Development implementation; live acceptance tests pending |
| 5 | Capacitor Android background service, push and production hardening | Not implemented |

**Current development branch:** `pend-phase4`. Earlier work is preserved on `pend-phase0`, `pend-phase1` and `pend-phase2`. The repository's `main` branch is a separate placeholder and does not contain the PEND application.

## Technology

- **Web:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, shadcn-style components, installable PWA
- **Peer-to-peer:** WebRTC data channels, 64 KiB chunk protocol and receiver-confirmed progress; private signaling via Supabase
- **Backend:** Supabase Auth (anonymous sign-ins), Postgres with RLS, Realtime and guarded RPCs
- **Local file state:** Dexie/IndexedDB for queued source files and metadata, Origin Private File System (OPFS) for incoming files and resume checkpoints
- **Security:** WebRTC transport encryption, non-extractable browser ECDH identity, displayed device fingerprints and two-sided pairing confirmation

**Note:** The current implementation uses the WebRTC APIs directly; adopting PeerJS as specified in the original product brief remains to be verified. Cross-network connections may require a TURN server.

## Development setup

Prerequisites: Node.js compatible with Next.js 16, npm, a dedicated Supabase project and two modern browsers for testing.

```bash
git clone --branch pend-phase3 https://github.com/leeroyimpilo-web/Webtemplates.git pend
cd pend
npm ci
cp .env.example .env.local
# Fill in your PEND Supabase project URL and publishable key
npm run typecheck
npm run test:all
npm run build
npm run dev
```

Open `http://localhost:3000` to begin onboarding. Browser API features require HTTPS in deployment; localhost is a permitted development exception.

In `.env.local` set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY

# Optional infrastructure for later verified cross-network service:
TURN_URL=
TURN_USER=
TURN_PASS=
```

Use a **publishable** key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`; never put a service-role key or TURN credentials in a `NEXT_PUBLIC_` variable. Do not commit `.env.local`.

### Database

The PEND Supabase project is separate from TenderBase. For a new database, review and apply the versioned migrations **in order**:

1. `supabase/schema.phase0.sql`
2. `supabase/phase1_rooms.sql`
3. `supabase/phase1_sprint2_rate_limit.sql`
4. `supabase/phase2_pairing_and_trust.sql`
5. `supabase/phase3_presence_and_pending.sql`

These migrations are **already installed** on the connected PEND project (Sharedit organization). Do not reapply them unnecessarily. Enable **Anonymous Sign-Ins** in Supabase Authentication settings before testing onboarding. The application has not been publicly deployed to Vercel.

## How the prototype works

1. **Register** a browser device and generate its ECDH identity.
2. **Pair** through a six-digit, one-time, ten-minute code or a QR link. Both people inspect the device fingerprint and choose to confirm.
3. **Send** a file to a paired contact. Its bytes remain in the sender's IndexedDB if delivery is pending.
4. **Receive** only while the receiving PWA is open. Trusted incoming files are saved to a private Inbox; the user explicitly chooses to download/open them.
5. **Resume** a disconnected transfer from a durable receiver-side OPFS checkpoint when both apps reconnect and the sender still holds the source file.

**Availability:** A 20-second heartbeat is evaluated for recency. Available, Busy, Invisible and Wi-Fi-only preferences control whether a pending transfer may activate. An unknown network type is treated cautiously.

## Safety boundaries

- **Never store file contents in Supabase**, including Storage, Postgres, Realtime messages or logs.
- **Never auto-open** received files.
- Automatic receiving requires an active, mutually approved, unrevoked pairing, verified local identity and permitted receiver settings.
- File extensions `.exe`, `.apk`, `.bat`, `.msi`, `.sh` and `.scr` require manual approval. Files **over 5 GiB** also require manual approval.
- Supabase RLS restricts records; pairing and transfer operations use owner-checking database RPCs.
- Six-digit pairing codes are hashed in the database and time-limited. Internet-scale abuse prevention needs further IP/device-based rate limiting and security testing.
- Supabase Storage is **not** used for files.

## Known limitations

- **No guaranteed background transfer** in the PWA. The sender and receiver must have PEND open for WebRTC transfer to start. A future Capacitor/native Android service is required for the full always-on product vision.
- Files queued in IndexedDB can be lost through browser eviction, insufficient storage or cleared browser data. Pending database metadata does not replace the source file.
- Network Information API support varies across browsers; Wi-Fi-only can prevent transfers until a reliable connection is detected or the user explicitly overrides it.
- Private Inbox storage is subject to browser quotas. It is not the system Downloads folder.
- Some networks require TURN; `TURN_URL`, `TURN_USER` and `TURN_PASS` alone do not mean TURN is deployed or ready.
- The current version still needs **two-device and cross-network testing**, large-file integrity checks, resume-after-disconnection verification, a production security review and Android/iOS compatibility testing.

## Development and verification

```bash
npm run typecheck
npm run test:all
npm run build
```

GitHub Actions runs dependency installation, automated tests, type checking and Next.js production builds. A passing CI build does **not** prove successful peer transfers on physical devices.

Read the implementation notes:

- [Phase 1 transfer work](docs/PHASE1_SPRINT2.md)
- [Phase 2 mutual pairing and security](docs/PHASE2_REMOTE_PAIRING.md)
- [Phase 3 pending, presence and resume](docs/PHASE3.md)

## Roadmap

**Next:** complete Phase 4 physical-device integration testing and document repairs. Phase 5 Android background handling is next **only after Phase 4**, per the original build order. Do not describe unverified features as production-ready.

---

**PEND is under active development.** The tagline describes the intended end product, not a completed service.

## Phase 4 — Group, folder, request, thumbnail and clipboard development

The `pend-phase4` branch includes the Sprint 7 and Sprint 8 code:

- Groups in local Dexie and separate authenticated queued transfers for each recipient.
- Single-stream PEND folder packages that retain relative paths; `.pendpack` always needs manual approval and extraction to a selected directory currently requires compatible Chromium browsers.
- Authenticated and pairing-checked Request-a-File workflows (create, decline, fulfil) with the migration `supabase/phase4_requests.sql` already installed on the PEND project.
- Search and filters for Inbox; explicit download, delete, media preview, share and folder inspection.
- Up to 200 KiB optional JPEG thumbnails carried through the peer DataChannel before file transfer.
- 10 KiB ECDH/AES-GCM encrypted text clipboard delivered ephemerally over Supabase Realtime when both PEND pages are open.
- Host/direct/relay ICE route hints. **This is not genuine mDNS discovery or proof of zero mobile-data usage.** Native discovery is a future Android requirement, not a completed web feature.

These are **development implementations**, not verified real-device outcomes. Important unresolved items are end-to-end transfers on two networks, 3-device group send, folder hash comparison, file request integration, clipboard revocation behavior, cross-browser support and a production security audit. The planned PeerJS integration also still requires reconciliation with the Supabase Realtime signaling design. Never label PEND production-ready or claim closed-browser background receiving.

Details: [Phase 4 Sprint 7](docs/PHASE4_SPRINT7.md) and [Phase 4 Sprint 8](docs/PHASE4_SPRINT8.md).
