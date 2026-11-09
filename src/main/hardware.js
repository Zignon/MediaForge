'use strict';
// Detects what the machine can do: CPU, GPU(s), and which FFmpeg hardware
// encoders actually work (not just compiled in). Each candidate encoder is
// verified by encoding a few synthetic frames; vendors' encoders are listed by
// FFmpeg even on machines without the matching GPU, so the probe is essential.
const os = require('os');
const { execFile, spawn } = require('child_process');
const { getBinaries } = require('./binaries');

// codec -> ordered list of encoders (best hardware option first, software last)
const ENCODER_MATRIX = {
  h264: [
    { id: 'h264_nvenc', vendor: 'NVIDIA', label: 'NVIDIA NVENC', hwaccel: 'cuda' },
    { id: 'h264_qsv', vendor: 'Intel', label: 'Intel Quick Sync', hwaccel: 'qsv' },
    { id: 'h264_amf', vendor: 'AMD', label: 'AMD AMF/VCE', hwaccel: 'd3d11va' },
    { id: 'libx264', vendor: 'CPU', label: 'x264 (software)', hwaccel: null },
  ],
  hevc: [
    { id: 'hevc_nvenc', vendor: 'NVIDIA', label: 'NVIDIA NVENC', hwaccel: 'cuda' },
    { id: 'hevc_qsv', vendor: 'Intel', label: 'Intel Quick Sync', hwaccel: 'qsv' },
    { id: 'hevc_amf', vendor: 'AMD', label: 'AMD AMF/VCE', hwaccel: 'd3d11va' },
    { id: 'libx265', vendor: 'CPU', label: 'x265 (software)', hwaccel: null },
  ],
  av1: [
    { id: 'av1_nvenc', vendor: 'NVIDIA', label: 'NVIDIA NVENC', hwaccel: 'cuda' },
    { id: 'av1_qsv', vendor: 'Intel', label: 'Intel Quick Sync', hwaccel: 'qsv' },
    { id: 'av1_amf', vendor: 'AMD', label: 'AMD AMF', hwaccel: 'd3d11va' },
    { id: 'libsvtav1', vendor: 'CPU', label: 'SVT-AV1 (software)', hwaccel: null },
    { id: 'libaom-av1', vendor: 'CPU', label: 'libaom AV1 (software)', hwaccel: null },
  ],
  vp9: [
    { id: 'vp9_qsv', vendor: 'Intel', label: 'Intel Quick Sync', hwaccel: 'qsv' },
    { id: 'libvpx-vp9', vendor: 'CPU', label: 'libvpx VP9 (software)', hwaccel: null },
  ],
  mpeg2: [
    { id: 'mpeg2_qsv', vendor: 'Intel', label: 'Intel Quick Sync', hwaccel: 'qsv' },
    { id: 'mpeg2video', vendor: 'CPU', label: 'MPEG-2 (software)', hwaccel: null },
  ],
};

const SOFTWARE_DECODE_HWACCELS = ['cuda', 'qsv', 'd3d11va', 'dxva2'];

function run(bin, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

async function listCompiledEncoders(ffmpeg) {
  const r = await run(ffmpeg, ['-hide_banner', '-encoders']);
  const set = new Set();
  for (const line of (r.stdout + r.stderr).split(/\r?\n/)) {
    const m = line.match(/^\s*[VAS][.F][.S][.X][.B][.D]\s+(\S+)/);
    if (m) set.add(m[1]);
  }
  return set;
}

async function listHwaccels(ffmpeg) {
  const r = await run(ffmpeg, ['-hide_banner', '-hwaccels']);
  return new Set((r.stdout + r.stderr).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.includes(':')));
}

// Encode a handful of synthetic frames; success means the encoder works on this hardware.
function probeEncoder(ffmpeg, encoderId) {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-nostdin', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-frames:v', '6',
      '-c:v', encoderId, '-f', 'null', '-'];
    const p = spawn(ffmpeg, args, { windowsHide: true });
    let err = '';
    const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve({ ok: false, error: 'timeout' }); }, 25000);
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, error: err.trim().split(/\r?\n/).pop() || '' }); });
  });
}

function gpuNames() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'],
      { timeout: 15000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      });
  });
}

async function ffmpegVersion(ffmpeg) {
  const r = await run(ffmpeg, ['-version']);
  const m = (r.stdout + r.stderr).match(/ffmpeg version (\S+)/);
  return { present: r.ok, version: m ? m[1] : 'unknown' };
}

let cached = null;

async function detect(onProgress = () => {}) {
  const { ffmpeg } = getBinaries();
  const cpu = os.cpus();
  const info = {
    cpu: { model: cpu[0] ? cpu[0].model.trim() : 'Unknown CPU', cores: cpu.length },
    memoryGB: Math.round(os.totalmem() / (1024 ** 3)),
    gpus: [],
    ffmpeg: await ffmpegVersion(ffmpeg),
    encoders: {},     // encoderId -> { available: bool, label, vendor, hwaccel, error }
    hwaccels: [],
    best: {},         // codec -> best working encoder id
  };
  if (!info.ffmpeg.present) {
    info.error = 'FFmpeg could not be started. Reinstall Media Forge.';
    cached = info;
    return info;
  }
  onProgress('Reading GPU information…');
  info.gpus = await gpuNames();
  const compiled = await listCompiledEncoders(ffmpeg);
  const hwaccels = await listHwaccels(ffmpeg);
  info.hwaccels = SOFTWARE_DECODE_HWACCELS.filter((h) => hwaccels.has(h));

  // Hint from GPU names so we only spend time probing encoders that could exist.
  const gpuText = info.gpus.join(' ').toLowerCase();
  const likely = {
    NVIDIA: gpuText.includes('nvidia') || gpuText.includes('geforce') || gpuText.includes('quadro') || gpuText.includes('rtx'),
    Intel: gpuText.includes('intel') || gpuText.includes('arc') || gpuText.includes('iris'),
    AMD: gpuText.includes('amd') || gpuText.includes('radeon'),
  };
  const anyGpuInfo = info.gpus.length > 0;

  const probes = [];
  for (const [codec, list] of Object.entries(ENCODER_MATRIX)) {
    for (const enc of list) {
      if (!compiled.has(enc.id)) {
        info.encoders[enc.id] = { ...enc, codec, available: false, error: 'not in this FFmpeg build' };
        continue;
      }
      if (enc.vendor !== 'CPU' && anyGpuInfo && !likely[enc.vendor]) {
        info.encoders[enc.id] = { ...enc, codec, available: false, error: 'no matching GPU found' };
        continue;
      }
      probes.push({ codec, enc });
    }
  }
  // Probe in parallel per vendor to keep startup quick, but limit total concurrency.
  let done = 0;
  const limit = 3;
  const queue = probes.slice();
  await Promise.all(Array.from({ length: limit }, async () => {
    while (queue.length) {
      const { codec, enc } = queue.shift();
      onProgress(`Testing ${enc.label} (${codec.toUpperCase()})…`);
      const r = enc.vendor === 'CPU' ? { ok: true, error: '' } : await probeEncoder(ffmpeg, enc.id);
      info.encoders[enc.id] = { ...enc, codec, available: r.ok, error: r.ok ? '' : r.error };
      onProgress(`Tested ${++done}/${probes.length} encoders`);
    }
  }));

  for (const [codec, list] of Object.entries(ENCODER_MATRIX)) {
    const first = list.find((e) => info.encoders[e.id] && info.encoders[e.id].available);
    info.best[codec] = first ? first.id : null;
  }
  cached = info;
  return info;
}

function getCached() { return cached; }

module.exports = { detect, getCached, ENCODER_MATRIX };
