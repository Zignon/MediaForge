'use strict';
// Job queue: probes inputs, runs FFmpeg with the configured concurrency,
// parses -progress output, and retries once with software decoding when a
// hardware-decode pipeline fails.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { getBinaries } = require('./binaries');
const { buildArgs, outputPath } = require('./encoder-args');
const hardware = require('./hardware');

function ffprobe(file) {
  const { ffprobe: bin } = getBinaries();
  return new Promise((resolve, reject) => {
    execFile(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim() || 'ffprobe failed'));
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error('Could not read media info')); }
      });
  });
}

function summarize(probe) {
  const v = (probe.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (probe.streams || []).filter((s) => s.codec_type === 'audio');
  const s = (probe.streams || []).filter((s) => s.codec_type === 'subtitle');
  const fr = v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate.split('/') : null;
  const fps = fr ? (Number(fr[0]) / Number(fr[1] || 1)) : 0;
  return {
    duration: Number(probe.format && probe.format.duration) || 0,
    size: Number(probe.format && probe.format.size) || 0,
    formatName: probe.format && probe.format.format_long_name,
    video: { codec: v.codec_name, width: v.width, height: v.height, fps: Math.round(fps * 100) / 100, pixFmt: v.pix_fmt, bitrate: Number(v.bit_rate || probe.format.bit_rate) || 0 },
    audio: a.map((t) => ({ codec: t.codec_name, channels: t.channels, lang: t.tags && t.tags.language })),
    subtitles: s.length,
  };
}

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.order = [];
    this.running = new Map(); // id -> child process
    this.concurrency = 1;
    this.active = false;
    this.nextId = 1;
  }

  list() { return this.order.map((id) => this.jobs.get(id)); }

  async add(files) {
    const added = [];
    for (const file of files) {
      if ([...this.jobs.values()].some((j) => j.input === file)) continue;
      const id = this.nextId++;
      const job = { id, input: file, name: path.basename(file), status: 'probing', progress: 0, info: null, error: null, log: [] };
      this.jobs.set(id, job); this.order.push(id); added.push(job);
      this.emit('update', job);
      ffprobe(file).then((probe) => {
        job.probe = probe; job.info = summarize(probe);
        if (!job.info.video.codec) { job.status = 'failed'; job.error = 'No video stream found'; }
        else job.status = 'queued';
        this.emit('update', job);
      }).catch((e) => { job.status = 'failed'; job.error = e.message; this.emit('update', job); });
    }
    return added;
  }

  remove(id) {
    this.cancel(id);
    this.jobs.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.emit('removed', id);
  }

  clearFinished() {
    for (const id of [...this.order]) {
      const j = this.jobs.get(id);
      if (['done', 'failed', 'cancelled'].includes(j.status)) this.remove(id);
    }
  }

  cancel(id) {
    const p = this.running.get(id);
    const j = this.jobs.get(id);
    if (p) { p.cancelled = true; try { p.stdin.write('q'); } catch (_) {} setTimeout(() => { try { p.kill(); } catch (_) {} }, 1500); }
    else if (j && j.status === 'queued') { j.status = 'cancelled'; this.emit('update', j); }
  }

  start(settings) {
    this.settings = settings;
    this.concurrency = Math.max(1, Number(settings.concurrency) || 1);
    this.active = true;
    for (const j of this.jobs.values()) if (j.status === 'cancelled' || j.status === 'failed') { if (j.info) { j.status = 'queued'; j.error = null; j.progress = 0; this.emit('update', j); } }
    this.pump();
  }

  stop() {
    this.active = false;
    for (const id of this.running.keys()) this.cancel(id);
    for (const j of this.jobs.values()) if (j.status === 'queued') { j.status = 'cancelled'; this.emit('update', j); }
  }

  pump() {
    if (!this.active) return;
    while (this.running.size < this.concurrency) {
      const next = this.list().find((j) => j.status === 'queued');
      if (!next) break;
      this.runJob(next);
    }
    if (this.running.size === 0 && !this.list().some((j) => j.status === 'queued')) {
      this.active = false;
      this.emit('idle');
    }
  }

  runJob(job, softwareDecode = false) {
    const s = this.settings;
    const hw = hardware.getCached() || { hwaccels: [], best: {} };
    const encoderId = s.videoCodec === 'copy' ? null
      : (s.encoder === 'auto' ? hw.best[s.videoCodec] : s.encoder);
    if (s.videoCodec !== 'copy' && !encoderId) {
      job.status = 'failed'; job.error = `No working encoder for ${s.videoCodec.toUpperCase()}`; this.emit('update', job); this.pump(); return;
    }
    const spec = { ...s, input: job.input, encoderId, outputDir: s.outputMode === 'source' ? '' : s.outputDir };
    job.encoderId = encoderId; job.output = outputPath(spec);
    const args = buildArgs(spec, job.probe, { hwaccels: hw.hwaccels, softwareDecode });
    job.status = 'running'; job.progress = 0; job.stats = {}; job.startedAt = Date.now();
    job.log = [`ffmpeg ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`];
    this.emit('update', job);

    fs.mkdirSync(path.dirname(job.output), { recursive: true });
    const { ffmpeg } = getBinaries();
    const p = spawn(ffmpeg, args, { windowsHide: true });
    this.running.set(job.id, p);
    let stderr = '';
    let buf = '';
    const duration = job.info.duration || 0;
    let lastEmit = 0;
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      const kv = {};
      for (const l of lines) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
      if (kv.out_time_us || kv.out_time_ms) {
        const us = Number(kv.out_time_us || kv.out_time_ms);
        const secs = us / 1e6;
        if (duration) job.progress = Math.min(99.9, (secs / duration) * 100);
        const elapsed = (Date.now() - job.startedAt) / 1000;
        const speed = parseFloat(kv.speed) || 0;
        const eta = speed > 0 && duration ? Math.max(0, (duration - secs) / speed) : null;
        job.stats = { fps: parseFloat(kv.fps) || 0, speed, bitrate: kv.bitrate, size: Number(kv.total_size) || 0, frame: Number(kv.frame) || 0, eta, elapsed, outTime: secs };
        if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); this.emit('update', job); }
      }
    });
    p.stderr.on('data', (d) => { const t = d.toString(); stderr += t; for (const l of t.split(/\r?\n/)) if (l.trim()) job.log.push(l.trim()); if (job.log.length > 400) job.log.splice(0, job.log.length - 400); });
    p.on('error', (e) => finish(-1, e.message));
    p.on('close', (code) => finish(code, stderr));
    const finish = (code, err) => {
      this.running.delete(job.id);
      if (p.cancelled) { job.status = 'cancelled'; job.error = null; try { fs.unlinkSync(job.output); } catch (_) {} }
      else if (code === 0) { job.status = 'done'; job.progress = 100; job.stats = { ...job.stats, elapsed: (Date.now() - job.startedAt) / 1000, eta: 0 }; try { job.outputSize = fs.statSync(job.output).size; } catch (_) {} }
      else if (!softwareDecode && s.hwDecode && s.videoCodec !== 'copy') {
        job.log.push('--- Hardware decode failed; retrying with software decoding ---');
        this.emit('update', job);
        return this.runJob(job, true);
      } else {
        job.status = 'failed';
        const lines = String(err).trim().split(/\r?\n/).filter(Boolean);
        job.error = lines.slice(-2).join(' ') || `FFmpeg exited with code ${code}`;
        try { fs.unlinkSync(job.output); } catch (_) {}
      }
      this.emit('update', job);
      this.pump();
    };
  }
}

module.exports = { JobQueue, ffprobe };
