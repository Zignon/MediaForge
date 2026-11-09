# Media Forge

Hardware-accelerated video converter for Windows x64. Converts MPEG, MKV, AVI, MOV, WMV, TS, WebM, FLV and more to MP4, MKV, MOV, WebM, AVI or MPEG-TS using whatever your machine does best: NVIDIA NVENC, Intel Quick Sync, AMD AMF, or every CPU core with x264 / x265 / SVT-AV1 / VP9.

## Install

Run `MediaForge-Setup-<version>-x64.exe`. The installer:

- installs the app, its runtime, and a full FFmpeg engine (nothing else to download);
- installs the Visual C++ 2015-2022 runtime silently if it is missing (when bundled);
- adds Start Menu / desktop shortcuts, an **Open with → Media Forge** entry and a **Convert with Media Forge** right-click option for video files, and an Add/Remove Programs entry with a clean uninstaller.

Requires Windows 10 or 11, 64-bit.

## How it uses your hardware

On launch Media Forge test-encodes a few frames with every GPU encoder FFmpeg knows about, so only encoders that work on *this* machine are offered. "Auto" picks the best working one for the selected codec; software encoders fall back to all CPU threads. Hardware decoding (CUDA / QSV / D3D11VA) is used when available and automatically retried in software if the GPU cannot decode a particular file. Click the hardware chip in the top-right for the full report.

## Build from source

```
npm install
npm run dist        # fetch FFmpeg + VC++ redist, package the app, compile the installer
```

Individual steps: `npm run fetch-ffmpeg`, `npm run fetch-vcredist`, `npm run pack` (electron-builder → `dist/win-unpacked`), `npm run installer` (NSIS → `dist/MediaForge-Setup-*.exe`). The build needs Node 18+ and `curl`; it runs on Windows, Linux or macOS with no wine or Visual Studio required. `npm start` runs the app from source (put `ffmpeg.exe`/`ffprobe.exe` in `vendor/ffmpeg` first).

## Layout

```
src/main/        Electron main process: hardware detection, FFmpeg job queue, argument builder
src/renderer/    GUI (HTML/CSS/JS) in the icon's navy / steel / forge-amber palette
src/preload.js   IPC bridge
build/           icon.ico, installer bitmaps, mediaforge.nsi (installer script)
scripts/         fetch-ffmpeg.js, fetch-vcredist.js, after-pack.js (exe icon stamping), build-installer.js
assets/          icon PNGs used by the app
```

## Licensing

Media Forge is MIT licensed. It bundles the GPL build of FFmpeg from BtbN/FFmpeg-Builds; see `LICENSE.txt`.

## Microsoft Store

`npm run store` (Windows only, needs the Windows SDK) builds `dist-store/MediaForge-Store-<version>-x64.appx` using the identity from `store.identity.json`. Listing copy, privacy policy, tile art, screenshots and a step-by-step checklist are in `store/`. Start with `store/SUBMISSION-CHECKLIST.md`.
