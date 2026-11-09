'use strict';
const $ = (id) => document.getElementById(id);
const state = { settings: {}, jobs: new Map(), hardware: null, containers: {}, running: false, cpuCount: 4 };

const ENCODER_ORDER = {
  h264: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'],
  hevc: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'],
  av1: ['av1_nvenc', 'av1_qsv', 'av1_amf', 'libsvtav1', 'libaom-av1'],
  vp9: ['vp9_qsv', 'libvpx-vp9'],
  mpeg2: ['mpeg2_qsv', 'mpeg2video'],
};
const PRESETS = {
  mp4_h264: { container: 'mp4', videoCodec: 'h264', encoder: 'auto', qualityMode: 'quality', quality: 22, resolution: 'source', audioCodec: 'aac', audioBitrate: 192, speed: 'balanced' },
  mp4_hevc: { container: 'mp4', videoCodec: 'hevc', encoder: 'auto', qualityMode: 'quality', quality: 24, resolution: 'source', audioCodec: 'aac', audioBitrate: 160, speed: 'balanced' },
  mkv_hevc: { container: 'mkv', videoCodec: 'hevc', encoder: 'auto', qualityMode: 'quality', quality: 20, resolution: 'source', audioCodec: 'copy', subtitles: 'keep', speed: 'quality' },
  mkv_av1: { container: 'mkv', videoCodec: 'av1', encoder: 'auto', qualityMode: 'quality', quality: 26, resolution: 'source', audioCodec: 'opus', audioBitrate: 128, speed: 'balanced' },
  webm_vp9: { container: 'webm', videoCodec: 'vp9', encoder: 'auto', qualityMode: 'quality', quality: 28, resolution: 'source', audioCodec: 'opus', audioBitrate: 128, speed: 'balanced' },
  mp4_1080: { container: 'mp4', videoCodec: 'h264', encoder: 'auto', qualityMode: 'quality', quality: 22, resolution: '1080', audioCodec: 'aac', audioBitrate: 192, speed: 'balanced' },
  remux: { container: 'mkv', videoCodec: 'copy', audioCodec: 'copy', subtitles: 'keep' },
};

// ---------- helpers ----------
const fmtBytes = (n) => { if (!n) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
const fmtTime = (s) => { if (s == null || !isFinite(s)) return '—'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- settings UI ----------
const FIELDS = ['container', 'videoCodec', 'encoder', 'hwDecode', 'quality', 'bitrateKbps', 'resolution', 'fps', 'audioCodec', 'audioBitrate', 'subtitles', 'stripMetadata', 'suffix', 'concurrency', 'openFolderWhenDone'];

function applySettingsToUI() {
  const s = state.settings;
  for (const f of FIELDS) {
    const el = $(f); if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!s[f]; else el.value = s[f] ?? '';
  }
  $('qualityVal').textContent = s.quality;
  renderDestination();
  for (const b of $('speedSeg').children) b.classList.toggle('on', b.dataset.v === s.speed);
  for (const b of $('qmodeSeg').children) b.classList.toggle('on', b.dataset.v === s.qualityMode);
  $('qualityRow').classList.toggle('hidden', s.qualityMode === 'bitrate');
  $('bitrateRow').classList.toggle('hidden', s.qualityMode !== 'bitrate');
  $('audioBitrateRow').classList.toggle('hidden', ['copy', 'none', 'flac'].includes(s.audioCodec));
  constrainOptions();
  rebuildEncoderList();
  renderConcurrency();
}

function renderDestination() {
  const s = state.settings;
  const custom = s.outputMode !== 'source';
  $('outputModeCustom').checked = custom;
  $('outputModeSource').checked = !custom;
  $('outputDir').textContent = s.outputDir || '';
  $('outputDir').title = s.outputDir || '';
  $('destBox').classList.toggle('off', !custom);
  $('btnOutputDir').disabled = !custom;
  $('btnOpenOutputDir').disabled = !custom;
}

// Grey out codecs/audio the chosen container cannot hold, and nudge the selection if needed.
function constrainOptions() {
  const s = state.settings;
  const c = state.containers[s.container]; if (!c) return;
  let changed = false;
  for (const o of $('videoCodec').options) o.disabled = !c.video.includes(o.value);
  if (!c.video.includes(s.videoCodec)) { s.videoCodec = c.video[0]; $('videoCodec').value = s.videoCodec; changed = true; }
  for (const o of $('audioCodec').options) o.disabled = !c.audio.includes(o.value);
  if (!c.audio.includes(s.audioCodec)) { s.audioCodec = c.audio[0]; $('audioCodec').value = s.audioCodec; changed = true; }
  if (changed) window.forge.updateSettings({ videoCodec: s.videoCodec, audioCodec: s.audioCodec });
  const encodeDisabled = s.videoCodec === 'copy';
  for (const id of ['encoder', 'hwDecode', 'quality', 'bitrateKbps', 'resolution', 'fps']) $(id).disabled = encodeDisabled;
  for (const seg of ['speedSeg', 'qmodeSeg']) for (const b of $(seg).children) b.disabled = encodeDisabled;
}

function rebuildEncoderList() {
  const s = state.settings; const sel = $('encoder'); const hw = state.hardware;
  const keep = s.encoder;
  sel.innerHTML = '<option value="auto">Auto (best available)</option>';
  const list = ENCODER_ORDER[s.videoCodec] || [];
  let bestLabel = '';
  for (const id of list) {
    const e = hw && hw.encoders[id];
    const o = document.createElement('option'); o.value = id;
    const avail = !hw ? true : !!(e && e.available);
    o.textContent = (e ? e.label : id) + (hw ? (avail ? '' : '  (unavailable)') : '');
    o.disabled = !avail; sel.appendChild(o);
    if (!bestLabel && avail && e) bestLabel = e.label;
  }
  sel.value = [...sel.options].some((o) => o.value === keep && !o.disabled) ? keep : 'auto';
  if (sel.value !== keep) { s.encoder = sel.value; window.forge.updateSettings({ encoder: sel.value }); }
  const note = $('encoderNote');
  if (s.videoCodec === 'copy') { note.textContent = 'Video stream is copied bit-for-bit; only the container changes.'; note.className = 'encoder-note'; return; }
  if (!hw) { note.textContent = 'Scanning hardware…'; note.className = 'encoder-note'; return; }
  const chosen = sel.value === 'auto' ? hw.best[s.videoCodec] : sel.value;
  const e = chosen && hw.encoders[chosen];
  if (!e) { note.textContent = 'No working encoder for this codec on this machine.'; note.className = 'encoder-note'; }
  else if (e.vendor === 'CPU') { note.textContent = `Using ${e.label} on all ${hw.cpu.cores} CPU threads. No GPU encoder for ${s.videoCodec.toUpperCase()} was found.`; note.className = 'encoder-note'; }
  else { note.textContent = `GPU encoding on ${e.label} — fast and leaves the CPU free.`; note.className = 'encoder-note hw'; }
}

function renderConcurrency() {
  const sel = $('concurrency'); const s = state.settings; const hw = state.hardware;
  const max = Math.max(1, Math.min(8, Math.ceil(state.cpuCount / 2)));
  sel.innerHTML = '';
  for (let i = 1; i <= max; i++) { const o = document.createElement('option'); o.value = i; o.textContent = i === 1 ? '1 (one file at a time)' : `${i} files at once`; sel.appendChild(o); }
  sel.value = Math.min(max, s.concurrency || 1);
  const enc = hw && s.videoCodec !== 'copy' ? hw.encoders[s.encoder === 'auto' ? hw.best[s.videoCodec] : s.encoder] : null;
  $('concurrencyHint').textContent = enc && enc.vendor !== 'CPU'
    ? 'GPU encoders already saturate the hardware; 1–2 parallel jobs is usually fastest.'
    : `Software encoders use every core (${state.cpuCount} threads). More parallel jobs mainly helps with many small files.`;
}

function bindSettings() {
  for (const f of FIELDS) {
    const el = $(f); if (!el) continue;
    el.addEventListener(el.type === 'range' ? 'input' : 'change', async () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' || f === 'concurrency' || f === 'audioBitrate' ? Number(el.value) : el.value;
      state.settings[f] = v;
      if (f === 'quality') $('qualityVal').textContent = v;
      await window.forge.updateSettings({ [f]: v });
      if (['container', 'videoCodec', 'encoder', 'audioCodec'].includes(f)) applySettingsToUI();
    });
  }
  const seg = (id, key) => { for (const b of $(id).children) b.addEventListener('click', async () => { state.settings[key] = b.dataset.v; await window.forge.updateSettings({ [key]: b.dataset.v }); applySettingsToUI(); }); };
  seg('speedSeg', 'speed'); seg('qmodeSeg', 'qualityMode');
  $('btnOutputDir').addEventListener('click', async () => { const d = await window.forge.chooseOutputDir(); if (d) { state.settings.outputDir = d; renderDestination(); } });
  $('btnOpenOutputDir').addEventListener('click', () => window.forge.openPath(state.settings.outputDir));
  for (const id of ['outputModeCustom', 'outputModeSource']) {
    $(id).addEventListener('change', async (e) => { if (!e.target.checked) return; state.settings.outputMode = e.target.value; await window.forge.updateSettings({ outputMode: e.target.value }); renderDestination(); });
  }
  $('presetSelect').addEventListener('change', async (e) => {
    const p = PRESETS[e.target.value]; e.target.value = ''; if (!p) return;
    Object.assign(state.settings, p); await window.forge.updateSettings(p); applySettingsToUI();
  });
}

// ---------- hardware ----------
function renderHardwareChip() {
  const hw = state.hardware; const dot = $('hwDot'); const txt = $('hwText');
  if (!hw) { dot.className = 'dot scan'; return; }
  if (hw.error) { dot.className = 'dot bad'; txt.textContent = hw.error; return; }
  const gpuEnc = Object.values(hw.encoders).filter((e) => e.available && e.vendor !== 'CPU');
  const vendors = [...new Set(gpuEnc.map((e) => e.vendor))];
  if (vendors.length) { dot.className = 'dot ok'; txt.textContent = `${vendors.join(' + ')} GPU encoding ready · ${hw.cpu.cores} threads`; }
  else { dot.className = 'dot cpu'; txt.textContent = `CPU encoding · ${hw.cpu.cores} threads · no GPU encoder found`; }
}

function renderHardwareModal() {
  const hw = state.hardware; const body = $('hwBody');
  if (!hw) { body.innerHTML = `<p class="muted">${esc($('hwText').textContent)}</p>`; return; }
  const rows = Object.values(hw.encoders).sort((a, b) => a.codec.localeCompare(b.codec) || (b.available - a.available))
    .map((e) => `<tr><td>${e.codec.toUpperCase()}</td><td>${esc(e.label)}</td><td><code>${esc(e.id)}</code></td><td class="${e.available ? 'ok' : 'no'}">${e.available ? '✓ Working' : esc(e.error || 'Unavailable')}</td></tr>`).join('');
  body.innerHTML = `
    <dl class="hw-grid">
      <dt>CPU</dt><dd>${esc(hw.cpu.model)} — ${hw.cpu.cores} threads</dd>
      <dt>Memory</dt><dd>${hw.memoryGB} GB</dd>
      <dt>GPU</dt><dd>${hw.gpus.length ? hw.gpus.map(esc).join('<br>') : '<span class="muted">Not reported</span>'}</dd>
      <dt>HW decoders</dt><dd>${hw.hwaccels.length ? hw.hwaccels.join(', ') : '<span class="muted">none</span>'}</dd>
      <dt>FFmpeg</dt><dd>${esc(hw.ffmpeg.version)}</dd>
    </dl>
    <table class="enc-table"><thead><tr><th>Codec</th><th>Encoder</th><th>ID</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function detectHardware() {
  state.hardware = null; renderHardwareChip(); $('hwText').textContent = 'Detecting hardware…';
  rebuildEncoderList();
  const info = await window.forge.detectHardware();
  state.hardware = info; renderHardwareChip(); applySettingsToUI(); renderHardwareModal(); updateActionBar();
}

// ---------- queue ----------
function jobEl(j) {
  let el = document.querySelector(`.job[data-id="${j.id}"]`);
  if (!el) { el = document.createElement('div'); el.className = 'job'; el.dataset.id = j.id; $('queueList').appendChild(el); }
  el.className = `job ${j.status}`;
  const i = j.info;
  const meta = i ? `${i.video.width}×${i.video.height} · ${(i.video.codec || '').toUpperCase()} · ${i.video.fps} fps · ${fmtTime(i.duration)} · ${fmtBytes(i.size)}${i.audio.length ? ` · ${i.audio.length} audio` : ''}${i.subtitles ? ` · ${i.subtitles} subs` : ''}` : (j.status === 'probing' ? 'Reading media info…' : '');
  const st = j.stats || {};
  let stats = '';
  if (j.status === 'running') stats = `<div class="job-stats"><span>${st.fps ? `<b>${st.fps.toFixed(0)}</b> fps` : ''}</span><span>${st.speed ? `<b>${st.speed.toFixed(2)}×</b> realtime` : ''}</span><span>Output <b>${fmtBytes(st.size)}</b></span><span>Elapsed <b>${fmtTime(st.elapsed)}</b></span><span>ETA <b>${fmtTime(st.eta)}</b></span></div>`;
  else if (j.status === 'done') stats = `<div class="job-stats"><span>Finished in <b>${fmtTime(st.elapsed)}</b></span><span>Output <b>${fmtBytes(j.outputSize)}</b>${i && j.outputSize ? ` (${Math.round(j.outputSize / i.size * 100)}% of original)` : ''}</span><span>${esc(j.encoderId || 'copy')}</span></div>`;
  const actions = [];
  if (j.status === 'running') actions.push(`<button class="btn ghost tiny" data-act="cancel">Cancel</button>`);
  if (j.status === 'done') actions.push(`<button class="btn ghost tiny" data-act="play">Play</button><button class="btn ghost tiny" data-act="folder">Folder</button>`);
  if (j.log && j.log.length) actions.push(`<button class="btn ghost tiny" data-act="log">Log</button>`);
  if (j.status !== 'running') actions.push(`<button class="btn ghost tiny" data-act="remove" title="Remove">✕</button>`);
  el.innerHTML = `
    <div class="job-name" title="${esc(j.input)}"><span class="badge ${j.status}">${j.status}</span>&nbsp; ${esc(j.name)}</div>
    <div class="job-actions">${actions.join('')}</div>
    <div class="job-meta">${esc(meta)}</div>
    <div class="job-bar"><i style="width:${j.status === 'done' ? 100 : j.progress || 0}%"></i></div>
    ${stats}${j.error ? `<div class="job-error">⚠ ${esc(j.error)}</div>` : ''}`;
  return el;
}

function renderQueue() {
  const list = [...state.jobs.values()];
  $('emptyState').classList.toggle('hidden', list.length > 0);
  $('queueCount').textContent = list.length;
  for (const j of list) jobEl(j);
  updateActionBar();
}

function updateActionBar() {
  const list = [...state.jobs.values()];
  const queued = list.filter((j) => j.status === 'queued' || j.status === 'cancelled' || (j.status === 'failed' && j.info)).length;
  const running = list.filter((j) => j.status === 'running');
  const done = list.filter((j) => j.status === 'done').length;
  $('btnStart').disabled = state.running || queued === 0 || !state.hardware;
  $('btnStop').classList.toggle('hidden', !state.running);
  $('btnStart').classList.toggle('hidden', state.running);
  const status = $('statusText');
  if (state.running) {
    const left = list.filter((j) => j.status === 'queued').length;
    status.innerHTML = `Forging <b>${running.length}</b> file${running.length === 1 ? '' : 's'} · <b>${left}</b> waiting · <b>${done}</b> done`;
  } else if (!state.hardware) status.textContent = 'Checking what this machine can do…';
  else status.innerHTML = queued ? `<b>${queued}</b> file${queued === 1 ? '' : 's'} ready.` : (done ? `All done — <b>${done}</b> file${done === 1 ? '' : 's'} converted.` : 'Ready. Add files to begin.');
}

function bindQueue() {
  $('btnAddFiles').addEventListener('click', async () => { for (const j of await window.forge.openFiles()) state.jobs.set(j.id, j); renderQueue(); });
  $('btnAddFolder').addEventListener('click', async () => { for (const j of await window.forge.openFolder()) state.jobs.set(j.id, j); renderQueue(); });
  $('btnClear').addEventListener('click', () => window.forge.clearFinished());
  $('queueList').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = Number(b.closest('.job').dataset.id); const j = state.jobs.get(id);
    switch (b.dataset.act) {
      case 'cancel': return window.forge.cancelJob(id);
      case 'remove': return window.forge.removeJob(id);
      case 'play': return window.forge.openPath(j.output);
      case 'folder': return window.forge.showInFolder(j.output);
      case 'log': $('logTitle').textContent = j.name; $('logBody').textContent = (j.log || []).join('\n'); $('logModal').classList.remove('hidden'); return;
    }
  });
  $('btnStart').addEventListener('click', async () => { state.running = true; updateActionBar(); await window.forge.start(); });
  $('btnStop').addEventListener('click', () => window.forge.stop());

  // drag & drop
  const dz = $('dropZone');
  let depth = 0;
  dz.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; dz.classList.add('dragover'); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  dz.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; dz.classList.remove('dragover'); } });
  dz.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; dz.classList.remove('dragover');
    const paths = [...e.dataTransfer.files].map((f) => window.forge.pathForFile(f)).filter(Boolean);
    if (paths.length) { for (const j of await window.forge.addPaths(paths)) state.jobs.set(j.id, j); renderQueue(); }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

// ---------- modals ----------
function bindModals() {
  $('hwChip').addEventListener('click', () => { renderHardwareModal(); $('hwModal').classList.remove('hidden'); });
  $('hwClose').addEventListener('click', () => $('hwModal').classList.add('hidden'));
  $('hwRescan').addEventListener('click', detectHardware);
  $('logClose').addEventListener('click', () => $('logModal').classList.add('hidden'));
  for (const m of document.querySelectorAll('.modal')) m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden'); });
}

// ---------- boot ----------
(async function boot() {
  const init = await window.forge.init();
  state.settings = init.settings; state.containers = init.containers; state.hardware = init.hardware; state.cpuCount = init.cpuCount;
  for (const j of init.jobs) state.jobs.set(j.id, j);
  bindSettings(); bindQueue(); bindModals();
  applySettingsToUI(); renderQueue(); renderHardwareChip();
  window.forge.onJobUpdate((j) => { state.jobs.set(j.id, j); jobEl(j); $('emptyState').classList.add('hidden'); $('queueCount').textContent = state.jobs.size; updateActionBar(); });
  window.forge.onJobRemoved((id) => { state.jobs.delete(id); const el = document.querySelector(`.job[data-id="${id}"]`); if (el) el.remove(); renderQueue(); });
  window.forge.onQueueIdle(() => { state.running = false; updateActionBar(); });
  window.forge.onHardwareProgress((msg) => { if (!state.hardware) $('hwText').textContent = msg; });
  if (!state.hardware) detectHardware();
})();
