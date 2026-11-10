# ShareDit — Android starter

**Status:** Scaffold only. An APK must be built and tested on physical Android devices before it can be considered ready.

ShareDit is a working-name Android file-sharing application. This temporary project lives on a **dedicated branch** of the existing Webtemplates repository so its `main` branch remains unchanged. Move it into a dedicated repository when one is available.

## Foundation

This bootstrap uses the native Kotlin project [mouse233/localsend-kotlin](https://github.com/mouse233/localsend-kotlin), an **unofficial** LocalSend client, under Apache-2.0. It downloads a pinned upstream commit and applies minimal branding and a separate Android application ID. It is **not affiliated with or endorsed by LocalSend**, its maintainer, or SHAREit.

Upstream commit: `53fbdad7e3e123ded9eb1e0ef5fc2b6b34d59e16` (2026-10-15). The clone keeps the upstream `LICENSE`, `NOTICE`, and original source attributions.

## First version

- Discover nearby LocalSend-compatible devices on the **same Wi-Fi / local network**.
- Send and receive files, photos, folders and text.
- Show transfer progress, cancellations and history.
- HTTPS + certificate-fingerprint verification supported by the upstream project.
- Works without an internet connection during sharing **after the app is installed** (both devices must reach each other on the same LAN).

This version does **not** add direct Wi-Fi hotspot pairing, internet/cloud transfer, browser sharing, or a new ShareDit-designed UI. These require later implementation and testing.

## Build with Android Studio

Requires Git, JDK 17, Android Studio and Android SDK Platform 36.

```bash
git clone --branch sharedit-android https://github.com/leeroyimpilo-web/Webtemplates.git sharedit-starter
cd sharedit-starter
bash scripts/bootstrap.sh
cd upstream-app
./gradlew assembleDebug
```

Open `upstream-app` as an Android Studio project. Build output: `upstream-app/app/build/outputs/apk/debug/app-debug.apk`.

## CI build

The `.github/workflows/android-debug.yml` workflow runs on pushes to this branch and uploads **ShareDit-debug-apk** as an Actions artifact when successful.

[Open Actions](https://github.com/leeroyimpilo-web/Webtemplates/actions) | [View branch](https://github.com/leeroyimpilo-web/Webtemplates/tree/sharedit-android)

**No APK has been verified yet.** Check the workflow result before installing. GitHub Actions must be enabled for the repository.

## Development roadmap

1. Build and smoke-test transfers between two physical Android devices.
2. Design ShareDit launcher icon, original screens and onboarding.
3. Add QR code pairing and Wi-Fi Direct/hotspot workflows.
4. Harden security, compatibility and large-file resume.
5. Create a dedicated `sharedit-android` repository and migrate this starter.

## Licensing

ShareDit modifications can be developed under applicable licence terms, but upstream copyright and Apache-2.0 notices must remain intact; dependencies may have their own licences. Do not erase upstream credits when redistributing binaries.
