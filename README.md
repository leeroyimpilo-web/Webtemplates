# PEND — Peer-to-Peer File Transfer (Phase 0)

> **Development status:** Phase 0 scaffold. **No files transfer yet.** Phase 1 is deliberately not started. This repository is independent of the previous ShareDit Android scaffold.

**Tagline:** Send any file, any size, to anyone. Pending until they're online. Paired once, auto-receive forever. (Product *vision*, not current implementation.)

## Included

- Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn-compatible UI primitives, dark styling, responsive bottom navigation/sidebar.
- PWA manifest, 192/512 icons and basic offline fallback service worker.
- Anonymous Supabase auth and device registration with SHA-256 public key fingerprint.
- Non-extractable ECDH P-256 private key stored in Dexie/IndexedDB, public JWK registered in Postgres. Device UUID stored in localStorage.
- Schema for devices, pairings, pairing codes, transfers and transfer requests, with row-level security, least-privilege table grants and pairing-code isolation.
- Home, Contacts, Inbox, Send, Settings. Preferences update Supabase after onboarding.
- CI workflow to typecheck/build and capture package lockfile.

## Not included

No WebRTC, PeerJS transfer, chunking, pairing codes, presence, auto-receive or background heartbeat yet. They belong to later phases and are **not claimed as working**. The mobile web PWA cannot guarantee background operation or indefinite retention of large pending files. Later Capacitor Android native services and storage testing are required for that promise.

## Development

1. Create a **dedicated Supabase project** (do not reuse another app’s database). Enable **Anonymous Sign-Ins** in Authentication -> Providers.
2. Open Supabase SQL Editor and execute `supabase/schema.phase0.sql` once. The SQL creates all five tables, constraints, indexes and RLS policies. **Pairing-code tables deliberately have no browser-read policies.**
3. Copy `.env.example` to `.env.local` and fill:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_XXXXXXXXXXXXXXXX
   TURN_URL=
   TURN_USER=
   TURN_PASS=
   ```

   The `NEXT_PUBLIC_SUPABASE_ANON_KEY` variable accepts Supabase’s publishable key. **Never put a secret/service-role key or TURN credentials in `NEXT_PUBLIC_` vars.**
4. Run:

   ```bash
   npm install
   npm run typecheck
   npm run build
   npm run dev
   ```

5. Browse `http://localhost:3000`, enter a device name, and confirm the device appears in `public.devices` owned by the anonymous user.
6. Install PWA on Chrome Android/desktop via the browser’s install option **over HTTPS** (localhost permitted for development).

If env vars are missing, a setup panel appears rather than fake success. No Supabase project was changed by the code alone.

## Phase 0 acceptance tests

- [ ] SQL applied to a dedicated PEND Supabase project; RLS checked using two anonymous clients
- [ ] Anonymous sign-ins enabled in project
- [ ] Project URL and publishable key configured
- [ ] Build/typecheck successful
- [ ] Browser prompts for device name on first visit
- [ ] Device row inserted and accessible only to its owner; other users cannot enumerate devices
- [ ] Device private ECDH key never uploaded; fingerprint matches public key
- [ ] PWA install tested in an HTTPS-capable browser

## Architecture & security notes

- `devices.user_id` is text per specification, storing Supabase `auth.uid()::text`.
- Public keys are metadata, but must not be trusted until paired with a mutual authentication flow in Phase 2.
- 6-digit codes have only 1 million possibilities. Future pairing validation MUST be rate-limited and performed with a server-side protected RPC or Edge Function. The hash column is not exposed to browsers. SHA-256 alone is not a substitute for brute-force protection.
- The `private` Postgres schema includes `SECURITY DEFINER` RLS helpers. They return booleans only, explicitly check `auth.uid()`, and are not exposed by Supabase Data API. Review database advisors before production.
- In web browsers the file API cannot always write arbitrary folders, retain all pending multi-GB blobs indefinitely, or keep heartbeats running while the tab is closed. Phase 3 acceptance tests require device-dependent strategies and documented limits.
- Supabase is never used for file storage: only identity, signaling and transfer metadata in future phases.
- Two-factor device confirmation is planned before creating a trusted pairing; **no automatic trust** at registration.

## Build order

Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> [request approval] -> Phase 4 -> Phase 5.

User approval is required before starting the next phase. See `docs/PHASES.md`.
