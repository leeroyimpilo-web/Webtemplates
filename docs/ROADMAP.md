# ShareDit v0.1 checklist

- [x] Select native Kotlin Android foundation with a permissive licence.
- [x] Pin upstream revision and retain copyright notices.
- [x] Prepare an isolated Git branch for ShareDit (no changes to the default branch).
- [x] Add separate application ID and launcher label at bootstrap.
- [x] Set up automatic GitHub Actions debug APK build.
- [ ] Confirm first successful build and retrieve APK.
- [ ] Install on two Android devices and verify sending/receiving.
- [ ] Create original ShareDit user interface and brand assets.
- [ ] Add QR pairing / Wi-Fi Direct / hotspot (not currently implemented).
- [ ] Package signed release and plan Play Store readiness.

## Notes

ShareDit initially speaks the **LocalSend v2** protocol via its upstream code. Both devices should be connected to one LAN, or to a Wi-Fi network allowing peer-to-peer traffic. Do not expose the local receiver to the public internet.

Until build and device tests complete, this is a development starter rather than a validated APK.
