# PEND — peer-to-peer transfer (Phase 2 development)

**Prototype status: Phase 2 remote pairing and trusted in-app receipt implemented, unverified on real devices.** The user explicitly approved continuing beyond the Phase 1 acceptance tests; those issues remain logged for repair later. Do not label this app production ready.

**Product vision:** Send any file, any size, to anyone. Pending until they are online. Paired once, auto-receive forever. Those claims describe the long-term product, not today's browser prototype.

## Quick start

```bash
npm ci
cp .env.example .env.local
# Configure PEND Supabase URL and publishable key (never use a service-role key in NEXT_PUBLIC envs)
npm run typecheck
npm run test:all
npm run build
npm run dev
```

Apply database migration `supabase/phase2_pairing_and_trust.sql` after Phase 0 and Phase 1 migrations. Do not reapply previously run migrations to a new database without reviewing schema differences. Enable anonymous sign-ins in Supabase Auth.

**Phase 2:** Contacts page produces 10-minute, one-use six-digit codes and QR codes; both device owners must confirm fingerprints. Paired contacts can be selected in Send, and active browsers receive P2P chunks into PEND's private Inbox if safety and network rules allow it. Revoking a pairing revokes future trusted transfer invitations.

**Hard limits:** browser must be open to auto-receive; default WiFi-only blocks unknown network type from auto-save; auto files >= 5 GiB require confirmation; executables are not auto-accepted. Storage is private OPFS, not Downloads. No files stored on Supabase. Peer connection without TURN is not reliable on all networks. Offline queue, background service, and reconnection resume are future phases.

Details: [Phase 2 testing and security notes](docs/PHASE2_REMOTE_PAIRING.md); Phase 1 outstanding tests in docs/PHASE1_SPRINT2.md.
