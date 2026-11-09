# Media Forge — Microsoft Store submission checklist

Work top to bottom. Items marked **YOU** need your Microsoft account or a decision from you; everything else is already done in this repo.

## 1. Partner Center account — YOU
- [ ] Register a developer account at https://partner.microsoft.com/dashboard (one-time fee; individual or company).
- [ ] Create a new app: **Apps and games → New product → MSIX or PWA app**, reserve the name **Media Forge**. If the name is taken, pick a variant (e.g. "Media Forge Converter") and update `productName`/`displayName` in `electron-builder.store.json`.
- [ ] Open **Product management → Product identity** and copy the three values into `store.identity.json` (copy `store.identity.example.json` first):
  - `Package/Identity/Name` → `identityName` (looks like `12345YourName.MediaForge`)
  - `Package/Identity/Publisher` → `publisher` (looks like `CN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
  - `Package/Properties/PublisherDisplayName` → `publisherDisplayName`

## 2. Build the Store package — on your Windows PC
- [ ] Install Node.js 18+ and the **Windows 10/11 SDK** (free; electron-builder uses its `makeappx.exe`). Visual Studio Installer → Individual components → "Windows 11 SDK", or the standalone SDK installer.
- [ ] In the project folder:
  ```
  npm install
  npm run store
  ```
  Output: `dist-store\MediaForge-Store-1.2.0-x64.appx`. Do **not** sign it — the Store signs it for you.
- [ ] Optional local test: Partner Center can't be used for sideloading, so to try the package before upload run `electron-builder --win --x64 --config electron-builder.store.json` after temporarily setting `publisher` to the subject of a self-signed cert created with `New-SelfSignedCertificate -Type Custom -Subject "CN=Test" -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My`, sign with `signtool`, trust the cert, then double-click the .appx. Simpler alternative: run `npm run pack` and test `dist\win-unpacked\Media Forge.exe` — it is the same code the .appx contains.
- [ ] Run the **Windows App Certification Kit** (ships with the SDK) against the .appx and fix anything it flags. Expected warnings for Electron apps (unsigned binaries, "Package sanity") are acceptable; failures are not.

## 3. Upload & configure — YOU
- [ ] **Packages**: drag the .appx in. Device family: Windows 10/11 desktop only (x64). Untick Xbox/HoloLens/etc.
- [ ] **Pricing and availability**: Free, all markets (or choose).
- [ ] **Properties**: Category *Multimedia design / Video production*; paste privacy policy URL (see §4); support email; system requirements from `LISTING.md`.
- [ ] **Age ratings**: complete the IARC questionnaire (all "No").
- [ ] **Store listing**: paste every section from `LISTING.md`; upload `screenshots/*.png`, `StoreLogo-300.png`, `Poster-1920x1080.png`, `Hero-2400x1200.png`.
- [ ] **Submission options → Notes for certification**: paste the text in §5.
- [ ] Submit. Certification normally takes 1–3 business days.

## 4. Privacy policy URL — YOU
The Store requires a public URL. Host `store/PRIVACY.md`:
- quickest: push this repo to GitHub, enable GitHub Pages, or just link to the raw file on GitHub;
- or paste the text onto any web page you control.
Replace `PUT-YOUR-SUPPORT-EMAIL-HERE` before publishing.

## 5. Notes for certification (paste into the submission)
> Media Forge is an Electron desktop application (runFullTrust) that converts video files locally using a bundled FFmpeg. It makes no network connections and collects no data. To test: launch the app, click "Add files", choose any .mkv/.avi/.mpg/.mp4, click "Start forging"; the converted file appears in Videos\Media Forge. The app spawns ffmpeg.exe and ffprobe.exe from its own resources folder and runs a short PowerShell query (Get-CimInstance Win32_VideoController) to read the GPU name for encoder selection.

## 6. Licensing — read this once
- Media Forge itself is MIT. It bundles the **GPL v3** build of FFmpeg (needed for x264/x265). GPL software is permitted in the Store; Microsoft's policy only requires that you (a) include the license text — done, it ships in `resources\ffmpeg\FFMPEG-LICENSE.txt` and is quoted in the listing's *Additional license terms* — and (b) make the corresponding source available. Point your homepage to this repository and to https://github.com/BtbN/FFmpeg-Builds (the exact FFmpeg build used; `npm run fetch-ffmpeg` logs the download URL).
- Keeping the app **free** avoids any question about GPL and the Store's standard license terms. If you want to charge for it, switch to the **LGPL** FFmpeg build (`FFMPEG_ZIP_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip npm run fetch-ffmpeg`); you lose libx264/libx265 software encoders (GPU encoders and SVT-AV1/VP9 remain), and `ENCODER_MATRIX` in `src/main/hardware.js` already handles their absence.
- Patent note: H.264/H.265 encoding is covered by patent pools. GPU encoders are licensed by the hardware vendors; CPU x264/x265 output for personal use is the same situation every FFmpeg-based converter in the Store is in. Not legal advice — ask a lawyer if you plan to monetise.

## 7. What is already handled in the repo
- `electron-builder.store.json` — AppX target, x64, file associations for 13 video extensions, `runFullTrust` (added automatically by electron-builder for Electron apps), background colour matching the icon.
- `build/appx/` — 35 tile images: Square44x44, Square150x150, Wide310x150, Square310x310 and StoreLogo at scale 100/125/150/200/400, plus taskbar `targetsize` and `altform-unplated` variants, all generated from the app icon.
- `scripts/build-store.js` — fills in your identity, refuses to build with placeholders, fetches FFmpeg if missing.
- `store/LISTING.md`, `store/PRIVACY.md`, listing artwork and three 1920×1080 screenshots.
- The app stores settings in its per-user data folder (MSIX-virtualised), needs no registry entries, no admin rights and no installer-time prerequisites, and degrades gracefully if FFmpeg is missing — all requirements of Store policy 10.x for desktop apps.

## 8. Releasing updates later
Bump `version` in `package.json` (Store requires each upload to be higher), run `npm run store`, upload the new .appx to the existing product, update "What's new". The Store delivers the update to users automatically.

## 9. Hands-off publishing from GitHub (recommended)
The repository ships a GitHub Actions workflow (`.github/workflows/build.yml`) that builds the installer and the Store package on Microsoft-hosted Windows runners, so you never need the Windows SDK locally. Once the secrets below exist, **pushing a tag such as `v1.2.0` builds the .appx and submits it to the Store automatically**; the "Run workflow" button with *publish* ticked does the same from any commit.

Add these under **Settings → Secrets and variables → Actions** in the GitHub repo:

| Secret | Where to find it |
|---|---|
| `STORE_IDENTITY_NAME` | Partner Center → your app → Product management → Product identity → *Package/Identity/Name* |
| `STORE_PUBLISHER` | same page → *Package/Identity/Publisher* (starts with `CN=`) |
| `STORE_PUBLISHER_DISPLAY_NAME` | same page → *Package/Properties/PublisherDisplayName* |
| `STORE_APP_ID` | same page → *Store ID* (e.g. `9NBLGGH4R315`) |
| `STORE_SELLER_ID` | Partner Center → Account settings → Organization profile → Legal info → *Seller ID* |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Partner Center → Account settings → User management → **Azure AD applications → Add Azure AD application** (role: *Manager*), then create a client secret on that application. This gives the pipeline API access to submit on your behalf. |

Before the first automated submission you still have to complete the one-time listing in Partner Center by hand (listing text, screenshots, age rating, privacy URL — §3 and §4); the pipeline only uploads packages and submits. Every tag after that is fully automatic.

With only the three `STORE_IDENTITY_*` secrets set, the workflow builds the .appx and attaches it to the run as an artifact for you to upload manually.
