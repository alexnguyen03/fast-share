# Fast Share

Send marked-up phone screenshots to a computer on the same Wi-Fi and paste them.

Fast Share is for the moment you are testing on a phone and need the picture on the PC you are working at. Share one or more images from Photos, crop or mark them, and send them to one chosen computer. That computer notifies you, stores the files, and can place a single image on the clipboard.

[LocalSend](https://localsend.org) already moves files between nearby devices. Fast Share starts after that: the image is annotated on the phone, then ready to paste on the destination PC.

## Status

The Tauri app receives images on the computer, keeps history for a configurable number of days, and sends marked-up images from the phone UI. The iOS share extension is Swift source in `share-extension/`. Attach it again after generating the Xcode project.

Clients:

- iPhone, and the same phone UI on Android
- Windows, macOS, and Linux

The Photos share sheet is the iOS share extension. Android runs the phone UI; it does not register that share target yet. There is no cloud relay and no account.

## Build

Install [Rust](https://rustup.rs) (stable, MSVC on Windows) and Node.js 22, then from this repository:

```bash
npm install
```

`npm run typecheck` checks the TypeScript. `cargo test --manifest-path src-tauri/Cargo.toml` runs the host tests. Those two do not need a phone or a simulator.

The computer app is the host. `npm run tauri dev` and `npm run tauri build` follow the OS you are on. iOS and Android are separate targets and open the phone UI.

System packages match the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Desktop (Windows and Linux)

This version ships a portable program. It does not build an MSI, NSIS setup, `.dmg`, or `.deb`.

Windows needs the Microsoft C++ Build Tools with the “Desktop development with C++” workload, and the WebView2 runtime (already present on Windows 10 version 1803 and later).

On Debian or Ubuntu:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Then:

```bash
npm run tauri dev
npm run tauri build -- --no-bundle
```

`tauri dev` opens the history panel and starts receiving on the LAN. The portable build writes `src-tauri/target/release/fast-share.exe` on Windows and `src-tauri/target/release/fast-share` on Linux. Run that file. Nothing is installed.

### macOS

Desktop-only development needs the Xcode Command Line Tools:

```bash
xcode-select --install
npm run tauri dev
npm run tauri build -- --no-bundle
```

The window is the same host panel as on Windows and Linux. The executable is `src-tauri/target/release/fast-share`.

Install full Xcode, and open it once, before an iOS build.

### iOS

iOS builds run on a Mac. Add the Rust targets and CocoaPods:

```bash
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
brew install cocoapods
npm run tauri ios init
bash scripts/setup-ios-share-extension.sh
npm run tauri ios dev
```

`tauri ios init` regenerates `src-tauri/gen/apple`. Run the setup script again after every init. It copies `share-extension/` into that project, reattaches the share target, and points the main target at the app group. The `fastshare` URL scheme comes from `src-tauri/Info.ios.plist`. Edit the Swift files in `share-extension/`, not under `gen/`.

On a device, pick your Apple team in Xcode. The App ID still needs the app group `group.com.alexnguyen03.fastshare` on [Apple Developer](https://developer.apple.com/account/resources). Share from Photos into Fast Share, mark the images, and send them to a computer on the same Wi-Fi that is running the desktop app.

`npm run tauri ios build` produces the release archive. Without a Mac, use the device build below.

### Android

Install Android Studio and, in the SDK Manager, the Android SDK Platform, Platform-Tools, Build-Tools, Command-line Tools, and the NDK (Side by side). Point `JAVA_HOME` at Android Studio’s `jbr`, and set `ANDROID_HOME` and `NDK_HOME`. Then:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android init
npm run tauri android dev
```

`tauri android dev` installs the phone UI on an emulator or a USB device. Use it to scan a computer QR code and confirm the computer is listed. Sending from the Android share sheet is not wired up yet.

`npm run tauri android build` writes the APK and AAB under `src-tauri/gen/android`.

## Device builds

GitHub Actions builds a portable Windows executable and an unsigned iOS app for this version. The signed iOS app is built only after the four signing secrets below are set. Android is not built.

The workflow is [`.github/workflows/build.yml`](.github/workflows/build.yml). It runs on a push that changes the app, and from the Actions tab with **Run workflow** once that file is on the default branch. Download the artifacts from the run:

- `fast-share-windows` — `fast-share.exe`. Run it. It does not install.
- `fast-share-ios-unsigned` — `FastShare-unsigned.ipa`. This file has no Apple signature.
- `fast-share-ios` — `FastShare.ipa`, only after the signing secrets exist.

`FastShare-unsigned.ipa` does not install by itself. On Windows, install [iTunes](https://www.apple.com/itunes/download/win64), connect the iPhone, and turn on Developer Mode under Settings → Privacy & Security. [Sideloadly](https://sideloadly.io/) then signs the IPA with a free Apple ID and installs it. That signature lasts about 7 days. A free profile often drops the app group, so Share from Photos may not hand images to the app. The signed IPA below is the build that keeps that path.

An iPhone installs the signed IPA only when Apple has signed it for that device. That needs the [Apple Developer Program](https://developer.apple.com/programs/) (USD 99 per year). There is no Mac requirement for creating the certificate: the signing files are made in the browser and with OpenSSL, then stored as GitHub Actions secrets.

1. Enroll in the Apple Developer Program. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources), register an App Group named `group.com.alexnguyen03.fastshare`.
2. Connect the iPhone. In iTunes, or in the Apple Devices app, open the phone summary and click the serial number until it changes to the UDID. Register that device under Devices.
3. Register two explicit App IDs, and enable App Groups on both, selecting the group above:
   - `com.alexnguyen03.fastshare`
   - `com.alexnguyen03.fastshare.share`
4. Create an **Apple Distribution** certificate. On Windows, Git’s OpenSSL can make the request:

   ```bash
   openssl genrsa -out ios-distribution.key 2048
   openssl req -new -key ios-distribution.key -out ios-distribution.csr -subj "/CN=Fast Share Distribution"
   ```

   Upload `ios-distribution.csr` when creating the certificate. Save the downloaded certificate as `ios_distribution.cer`, then:

   ```bash
   openssl x509 -in ios_distribution.cer -inform DER -out ios_distribution.pem
   openssl pkcs12 -export -legacy -out ios-distribution.p12 -inkey ios-distribution.key -in ios_distribution.pem
   ```

5. Create two **Ad Hoc** provisioning profiles, one per App ID. Select the distribution certificate and this iPhone. Download both `.mobileprovision` files.
6. In the GitHub repository, open Settings → Secrets and variables → Actions and add:

   | Secret | Value |
   | --- | --- |
   | `IOS_CERTIFICATE` | Base64 of `ios-distribution.p12` |
   | `IOS_CERTIFICATE_PASSWORD` | Password set when exporting the `.p12` |
   | `IOS_MOBILE_PROVISION` | Base64 of the app profile |
   | `IOS_SHARE_MOBILE_PROVISION` | Base64 of the share-extension profile |

   PowerShell, one line and no wrapping:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("ios-distribution.p12"))
   ```

   Do the same for each `.mobileprovision` file. Do not commit the key, the certificate, or the profiles.

7. Push the branch again after the secrets exist. The next run builds `FastShare.ipa` as `fast-share-ios`. Runs without these secrets still publish `fast-share.exe` and `FastShare-unsigned.ipa`.

Adding another phone means editing both Ad Hoc profiles to include its UDID, updating the two profile secrets, and running the workflow again.

Install `FastShare.ipa` from `fast-share-ios` without re-signing it. A new signature would drop the app group, and the Photos share sheet would not open the app. Use Sideloadly only for `FastShare-unsigned.ipa`.

1. Install the classic [iTunes for Windows](https://www.apple.com/itunes/download/win64) so the Apple Mobile Device service is running. Connect the phone and tap Trust.
2. Install [Python](https://www.python.org/downloads/), then:

   ```bash
   pip install pymobiledevice3
   pymobiledevice3 usbmux list
   pymobiledevice3 apps install FastShare.ipa
   ```

   `usbmux list` should show the iPhone before `apps install`.

3. On the iPhone, open Settings → General → VPN & Device Management, and trust the developer certificate.
4. Start `fast-share.exe` on the computer. Join the same Wi-Fi. Share a photo into Fast Share.

The `.p12` password and the provisioning profiles are credentials. Keep them in GitHub secrets only.

## License

[MIT](LICENSE)
