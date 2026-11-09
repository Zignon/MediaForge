'use strict';
// Translates a Media Forge job into an FFmpeg command line.
const path = require('path');

const CONTAINERS = {
  mp4:  { ext: 'mp4',  video: ['h264', 'hevc', 'av1', 'mpeg2', 'copy'], audio: ['aac', 'ac3', 'mp3', 'opus', 'flac', 'copy', 'none'], subs: 'mov_text' },
  mkv:  { ext: 'mkv',  video: ['h264', 'hevc', 'av1', 'vp9', 'mpeg2', 'copy'], audio: ['aac', 'ac3', 'eac3', 'mp3', 'opus', 'flac', 'copy', 'none'], subs: 'copy' },
  mov:  { ext: 'mov',  video: ['h264', 'hevc', 'av1', 'copy'], audio: ['aac', 'ac3', 'mp3', 'copy', 'none'], subs: 'mov_text' },
  webm: { ext: 'webm', video: ['vp9', 'av1', 'copy'], audio: ['opus', 'none', 'copy'], subs: null },
  avi:  { ext: 'avi',  video: ['h264', 'mpeg2', 'copy'], audio: ['mp3', 'ac3', 'aac', 'copy', 'none'], subs: null },
  ts:   { ext: 'ts',   video: ['h264', 'hevc', 'mpeg2', 'copy'], audio: ['aac', 'ac3', 'mp3', 'copy', 'none'], subs: null },
};

const RESOLUTIONS = {
  source: null, '2160': 2160, '1440': 1440, '1080': 1080, '720': 720, '576': 576, '480': 480, '360': 360,
};

// Per-encoder speed/quality knobs for the three user-facing speed modes.
const SPEED = {
  libx264:   { fast: ['-preset', 'veryfast'], balanced: ['-preset', 'medium'], quality: ['-preset', 'slow'] },
  libx265:   { fast: ['-preset', 'veryfast'], balanced: ['-preset', 'medium'], quality: ['-preset', 'slow'] },
  libsvtav1: { fast: ['-preset', '10'], balanced: ['-preset', '8'], quality: ['-preset', '5'] },
  'libaom-av1': { fast: ['-cpu-used', '8', '-row-mt', '1'], balanced: ['-cpu-used', '6', '-row-mt', '1'], quality: ['-cpu-used', '4', '-row-mt', '1'] },
  'libvpx-vp9': { fast: ['-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1'], balanced: ['-deadline', 'good', '-cpu-used', '2', '-row-mt', '1'], quality: ['-deadline', 'good', '-cpu-used', '0', '-row-mt', '1'] },
  nvenc:     { fast: ['-preset', 'p2', '-tune', 'hq'], balanced: ['-preset', 'p4', '-tune', 'hq'], quality: ['-preset', 'p6', '-tune', 'hq', '-multipass', 'qres'] },
  qsv:       { fast: ['-preset', 'veryfast'], balanced: ['-preset', 'medium'], quality: ['-preset', 'veryslow'] },
  amf:       { fast: ['-quality', 'speed'], balanced: ['-quality', 'balanced'], quality: ['-quality', 'quality'] },
  mpeg2video: { fast: [], balanced: [], quality: [] },
};

function encoderFamily(id) {
  if (id.endsWith('_nvenc')) return 'nvenc';
  if (id.endsWith('_qsv')) return 'qsv';
  if (id.endsWith('_amf')) return 'amf';
  return id;
}

// Constant-quality flag per encoder. `q` is the user's 0-51 style value (lower = better).
function qualityArgs(encoderId, q) {
  const fam = encoderFamily(encoderId);
  switch (fam) {
    case 'nvenc': return ['-rc', 'vbr', '-cq', String(q), '-b:v', '0'];
    case 'qsv': return ['-global_quality', String(q), '-look_ahead', '0'];
    case 'amf': return ['-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q), '-qp_b', String(q)];
    case 'libsvtav1': return ['-crf', String(Math.min(63, Math.round(q * 1.2)))];
    case 'libaom-av1': return ['-crf', String(Math.min(63, Math.round(q * 1.2))), '-b:v', '0'];
    case 'libvpx-vp9': return ['-crf', String(Math.min(63, Math.round(q * 1.2))), '-b:v', '0'];
    case 'mpeg2video': return ['-q:v', String(Math.max(2, Math.round(q / 3)))];
    default: return ['-crf', String(q)];
  }
}

function bitrateArgs(encoderId, kbps) {
  const fam = encoderFamily(encoderId);
  const b = `${kbps}k`;
  const max = `${Math.round(kbps * 1.5)}k`;
  const buf = `${kbps * 2}k`;
  if (fam === 'nvenc') return ['-rc', 'vbr', '-b:v', b, '-maxrate', max, '-bufsize', buf];
  if (fam === 'amf') return ['-rc', 'vbr_latency', '-b:v', b, '-maxrate', max, '-bufsize', buf];
  return ['-b:v', b, '-maxrate', max, '-bufsize', buf];
}

const AUDIO = {
  aac:  { codec: 'aac', bitrate: true },
  ac3:  { codec: 'ac3', bitrate: true },
  eac3: { codec: 'eac3', bitrate: true },
  mp3:  { codec: 'libmp3lame', bitrate: true },
  opus: { codec: 'libopus', bitrate: true },
  flac: { codec: 'flac', bitrate: false },
};

function outputPath(job) {
  const ext = CONTAINERS[job.container].ext;
  const base = path.basename(job.input, path.extname(job.input));
  const dir = job.outputDir || path.dirname(job.input);
  let name = `${base}${job.suffix || ''}.${ext}`;
  if (path.resolve(path.join(dir, name)) === path.resolve(job.input)) name = `${base}-converted.${ext}`;
  return path.join(dir, name);
}

/**
 * @param job  { input, container, videoCodec, encoderId, hwDecode(bool), speed, qualityMode, quality, bitrateKbps,
 *               resolution, fps, audioCodec, audioBitrate, subtitles('keep'|'drop'), outputDir, suffix }
 * @param probe ffprobe json for the input
 * @param opts  { hwaccels: string[], softwareDecode: bool }
 */
function buildArgs(job, probe, opts = {}) {
  const container = CONTAINERS[job.container];
  const encoder = job.videoCodec === 'copy' ? null : job.encoderId;
  const fam = encoder ? encoderFamily(encoder) : null;
  const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error'];

  // ---- input / hardware decode ----
  if (encoder && job.hwDecode && !opts.softwareDecode) {
    const want = fam === 'nvenc' ? 'cuda' : fam === 'qsv' ? 'qsv' : fam === 'amf' ? 'd3d11va' : 'd3d11va';
    const avail = opts.hwaccels || [];
    const pick = avail.includes(want) ? want : avail.includes('d3d11va') ? 'd3d11va' : avail.includes('dxva2') ? 'dxva2' : null;
    if (pick) args.push('-hwaccel', pick); // frames are returned to system memory so filters work
  }
  args.push('-i', job.input);

  // ---- stream mapping ----
  args.push('-map', '0:v:0');
  const hasAudio = (probe.streams || []).some((s) => s.codec_type === 'audio');
  if (hasAudio && job.audioCodec !== 'none') args.push('-map', '0:a?');
  const TEXT_SUBS = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'];
  const subs = (probe.streams || []).filter((s) => s.codec_type === 'subtitle');
  if (subs.length && job.subtitles === 'keep' && container.subs) {
    if (container.subs === 'copy') args.push('-map', '0:s?', '-c:s', 'copy');
    else {
      // MP4/MOV can only carry text subtitles; bitmap tracks (PGS, VobSub) are skipped.
      const textIdx = subs.map((s, i) => (TEXT_SUBS.includes(s.codec_name) ? i : -1)).filter((i) => i >= 0);
      for (const i of textIdx) args.push('-map', `0:s:${i}`);
      if (textIdx.length) args.push('-c:s', container.subs);
    }
  }
  if (job.stripMetadata === false) {
    args.push('-map_metadata', '0', '-map_chapters', '0');
  } else {
    // Strip everything: global tags, per-stream tags (titles, language, encoder
    // strings), chapters, and the muxer's own "encoder"/date tags.
    args.push('-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1', '-map_metadata:s:s', '-1',
      '-map_chapters', '-1', '-fflags', '+bitexact', '-flags', '+bitexact');
  }

  // ---- video ----
  if (!encoder) {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', encoder);
    const speedTable = SPEED[fam] || SPEED[encoder] || {};
    args.push(...(speedTable[job.speed] || speedTable.balanced || []));
    if (job.qualityMode === 'bitrate' && job.bitrateKbps) args.push(...bitrateArgs(encoder, job.bitrateKbps));
    else args.push(...qualityArgs(encoder, job.quality));

    const filters = [];
    const h = RESOLUTIONS[job.resolution];
    if (h) filters.push(`scale=-2:'min(${h},ih)'`);
    if (fam === 'qsv' || fam === 'nvenc' || fam === 'amf') filters.push('format=nv12');
    else if (job.videoCodec !== 'av1' && job.videoCodec !== 'vp9') filters.push('format=yuv420p');
    if (filters.length) args.push('-vf', filters.join(','));
    if (job.fps && job.fps !== 'source') args.push('-r', String(job.fps));

    if (job.videoCodec === 'hevc' && (job.container === 'mp4' || job.container === 'mov')) args.push('-tag:v', 'hvc1');
    if (fam === 'libx264' || fam === 'libx265') args.push('-threads', '0');
    if (fam === 'libx265') args.push('-x265-params', 'log-level=error');
  }

  // ---- audio ----
  if (hasAudio && job.audioCodec !== 'none') {
    if (job.audioCodec === 'copy') args.push('-c:a', 'copy');
    else {
      const a = AUDIO[job.audioCodec];
      args.push('-c:a', a.codec);
      if (a.bitrate && job.audioBitrate) args.push('-b:a', `${job.audioBitrate}k`);
      if (job.audioCodec === 'opus' || job.audioCodec === 'aac') args.push('-ac', '2');
    }
  } else if (!hasAudio || job.audioCodec === 'none') {
    args.push('-an');
  }

  // ---- container specifics ----
  if (job.container === 'mp4' || job.container === 'mov') args.push('-movflags', '+faststart');
  if (job.container === 'ts') args.push('-f', 'mpegts');
  if (job.container === 'avi') args.push('-f', 'avi');

  args.push(outputPath(job));
  return args;
}

module.exports = { buildArgs, outputPath, CONTAINERS, RESOLUTIONS, encoderFamily };
