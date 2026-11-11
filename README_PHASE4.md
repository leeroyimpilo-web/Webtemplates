# PEND · Phase 4 Development

This branch contains the Phase 0–3 app plus Phase 4 Sprint 7 and Sprint 8 feature implementations. The canonical GitHub README provides the full product background, setup and safety limitations. See `docs/PHASE4_SPRINT7.md` and `docs/PHASE4_SPRINT8.md` for Phase 4-specific instructions and limitations.

## Build from source

```bash
npm ci
cp .env.example .env.local
# Configure the dedicated PEND Supabase project (URL + publishable key)
npm run typecheck
npm run test:all
npm run build
npm run dev
```

Database migration (PEND project only): `supabase/phase4_requests.sql`. Previous Phase 0–3 migrations are already installed. Enable Supabase Anonymous Sign-Ins.

## Features

- Local groups that queue separate trusted transfers for each member
- Folder packaging without loading entire files into JS memory; safe manual approval and folder extraction on Chromium desktop
- File-request RPCs restricted to mutually approved paired devices, with protected decline/reply flow
- Inbox file search, size/date filters, on-demand preview, download, sharing and folder inspection
- JPEG preview (max 200 KiB) over WebRTC before file data, optional for supported images and videos
- Encrypted text clipboard (AES-256-GCM/ECDH) to a trusted paired device, max 10 KiB; Realtime receives ciphertext only
- ICE connection route hints without claiming LAN-only usage or verified Wi-Fi connectivity

## Important

This is **development-only**. Device acceptance tests from earlier phases and Phase 4 integration tests are outstanding. Browser tabs must be open for foreground WebRTC transfers. A background native Android app belongs in Phase 5, **after Phase 4**, not before. Cross-network transfers require properly configured TURN. Never use Supabase Storage for file bytes.
