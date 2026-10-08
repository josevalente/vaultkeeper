// Camera capture + card identification.
// 1) With a Claude API key (Ajustes): Claude reads name/number/set from the photo.
// 2) Without one: on-device OCR (Tesseract.js) reads the "199/165" number + the name.
// Either way the user confirms the match against the official card image.

import { h, esc, $, norm, similarity } from './util.js';
import { state } from './store.js';
import { findByNumber, searchByName, getSets } from './api.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.130.0/+esm';

let stream;

function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// Opens the full-screen camera. Resolves with candidate cards (brief objects) or null if closed.
export function openScanner({ title = 'Escanear carta' } = {}) {
  return new Promise((resolve) => {
    const ov = h(`
      <div class="scanner" role="dialog" aria-label="${esc(title)}">
        <video playsinline autoplay muted></video>
        <div class="scan-shade"><div class="scan-frame"><span></span><span></span><span></span><span></span></div></div>
        <div class="scan-top">
          <button class="icon-btn scan-close" aria-label="Cerrar">✕</button>
          <div class="scan-title">${esc(title)}</div>
          <span class="scan-mode">${state.settings.claudeKey ? 'Claude Vision' : 'OCR en el teléfono'}</span>
        </div>
        <div class="scan-hint">Encaja la carta en el marco, con buena luz y sin reflejos.</div>
        <div class="scan-status" hidden></div>
        <div class="scan-bottom">
          <label class="pill-btn ghost">Foto
            <input type="file" accept="image/*" hidden>
          </label>
          <button class="shutter" aria-label="Capturar"><span></span></button>
          <button class="pill-btn ghost scan-manual">Buscar</button>
        </div>
      </div>`);
    document.body.appendChild(ov);
    const video = $('video', ov);
    const status = $('.scan-status', ov);
    let busy = false;

    const close = (result) => {
      stopStream();
      ov.remove();
      window.removeEventListener('hashchange', onHash);
      resolve(result);
    };
    const onHash = () => close(null);
    window.addEventListener('hashchange', onHash);

    const setStatus = (msg) => {
      status.hidden = !msg;
      status.textContent = msg || '';
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        stream = s;
        video.srcObject = s;
      })
      .catch(() => setStatus('No pude abrir la cámara. Usa “Foto” para tomar o elegir una imagen.'));

    $('.scan-close', ov).onclick = () => close(null);
    $('.scan-manual', ov).onclick = () => close({ manual: true });

    const run = async (canvas, cropped) => {
      if (busy) return;
      busy = true;
      ov.classList.add('busy');
      try {
        const res = await identify(canvas, cropped, setStatus);
        close(res);
      } catch (e) {
        console.error(e);
        setStatus(`No pude identificarla (${e.message}). Prueba otra foto o usa Buscar.`);
      } finally {
        busy = false;
        ov.classList.remove('busy');
      }
    };

    $('.shutter', ov).onclick = () => {
      if (!video.videoWidth) return setStatus('La cámara aún no está lista…');
      run(captureFrame(video, $('.scan-frame', ov)), true);
    };

    $('input[type=file]', ov).onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const bmp = await loadImage(f);
      run(bmp, false);
    };
  });
}

function captureFrame(video, frame) {
  const vr = video.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  const scale = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
  const ox = (vr.width - vw * scale) / 2, oy = (vr.height - vh * scale) / 2;
  const sx = (fr.left - vr.left - ox) / scale;
  const sy = (fr.top - vr.top - oy) / scale;
  const sw = fr.width / scale, sh = fr.height / scale;
  const c = document.createElement('canvas');
  const outW = Math.min(1100, Math.round(sw));
  c.width = outW;
  c.height = Math.round((outW * sh) / sw);
  c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.src = url;
  await im.decode();
  const max = 1600;
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * s);
  c.height = Math.round(im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c;
}

export async function identify(canvas, cropped, setStatus) {
  if (state.settings.claudeKey && navigator.onLine) {
    setStatus('Claude está leyendo la carta…');
    try {
      const info = await identifyWithClaude(canvas);
      setStatus(`Buscando ${[info.name, info.number && `${info.number}/${info.total || '?'}`].filter(Boolean).join(' · ')}…`);
      let cands = info.number ? await findByNumber(info.number, info.total, info.name) : [];
      if (info.name && cands.length && !cands.some((c) => nameMatch(c.name, info.name))) cands = [];
      if (!cands.length && info.name) cands = await searchByName(info.name);
      if (cands.length) return { info, cands };
    } catch (e) {
      console.warn('Claude falló, uso OCR', e);
      setStatus('Claude no respondió, leyendo con OCR…');
    }
  }
  return identifyWithOCR(canvas, cropped, setStatus);
}

const baseName = (n) => norm(n).replace(/\b(ex|v|vmax|vstar|gx|ex|break|lv x|prime)\b/g, '').trim();
const nameMatch = (a, b) => similarity(baseName(a), baseName(b)) >= 0.6;

// ───────────────────────── Claude Vision

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    is_pokemon_card: { type: 'boolean' },
    name: { type: 'string', description: 'Card name exactly as printed, e.g. "Charizard ex"' },
    number: { type: 'string', description: 'Collector number before the slash, e.g. "199" or "TG05"; empty if unreadable' },
    set_total: { type: 'string', description: 'Number after the slash, e.g. "165"; empty if none' },
    set_name: { type: 'string', description: 'Set/expansion name if you can tell, else empty' },
    language: { type: 'string', description: 'Language of the card text, e.g. "en", "ja", "es"' },
  },
  required: ['is_pokemon_card', 'name', 'number', 'set_total', 'set_name', 'language'],
  additionalProperties: false,
};

let sdkPromise;

async function identifyWithClaude(canvas) {
  sdkPromise ||= import(ANTHROPIC_SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  const client = new Anthropic({ apiKey: state.settings.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 45000 });
  const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  const model = state.settings.claudeModel || 'claude-opus-5-5';
  const params = {
    model,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: CARD_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          {
            type: 'text',
            text:
              'Identify this Pokémon TCG card. Read the card name at the top and the collector number printed at the bottom (format "NNN/TTT"). ' +
              'Report exactly what is printed; leave a field empty rather than guessing.',
          },
        ],
      },
    ],
  };
  // Claude Haiku has no server-side refusal fallback; the others opt into it.
  const supportsFallback = !model.startsWith('claude-haiku');
  let msg;
  try {
    msg = supportsFallback
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (e) {
    if (e?.status === 400 && supportsFallback) msg = await client.messages.create(params);
    else throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude rechazó la solicitud');
  const text = msg.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Respuesta vacía');
  const out = JSON.parse(text);
  if (!out.is_pokemon_card) throw new Error('No parece una carta Pokémon');
  return { name: out.name, number: out.number, total: out.set_total, setName: out.set_name, via: 'claude' };
}

// ───────────────────────── Tesseract OCR

let workerPromise;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('no se pudo cargar el OCR (¿sin internet la primera vez?)'));
    document.head.appendChild(s);
  });
}

async function getWorker(setStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(TESSERACT_URL);
      setStatus?.('Preparando OCR (solo la primera vez)…');
      return window.Tesseract.createWorker('eng');
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

// Crops a fraction of the card, upscales it and binarises it so Tesseract sees black text on white.
// mode: 'gray' | 'dark' (text darker than background) | 'bright' (white text with dark outline, full-arts)
function region(src, x, y, w, hgt, { scale = 2, mode = 'gray' } = {}) {
  const c = document.createElement('canvas');
  const sw = src.width * w, sh = src.height * hgt;
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, src.width * x, src.height * y, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  const mean = sum / (d.length / 4);
  if (mode !== 'gray') {
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i];
      const ink = mode === 'bright' ? g > 200 : g < Math.min(110, mean * 0.7);
      d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const fixDigits = (t) => t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[S]/g, '5').replace(/[B]/g, '8');

// `totals` = printed set sizes that exist (165, 131…). Used to validate reads and to split
// runs like "19971654" where the italic slash was read as a 7 → 199/165.
function parseNumber(text, totals) {
  const t = text.toUpperCase();
  const g = t.match(/\b(TG|GG|RC|SV)\s?(\d{1,3})\s*\/\s*(TG|GG|RC|SV)?\s?(\d{2,3})/);
  if (g) return { number: `${g[1]}${g[2]}`, total: `${g[3] || g[1]}${g[4]}` };
  const ok = (a, b) => {
    const A = parseInt(a, 10), B = parseInt(b, 10);
    return A >= 1 && B >= 10 && A <= B * 2 + 20 && (!totals?.size || totals.has(B));
  };
  const clean = fixDigits(t);
  for (const m of clean.matchAll(/(\d{1,3})\s*\/\s*(\d{2,3})/g)) if (ok(m[1], m[2])) return { number: m[1], total: m[2] };
  for (const run of clean.replace(/[^\d]+/g, ' ').split(' ')) {
    if (run.length < 4) continue;
    for (let p = Math.min(3, run.length - 3); p >= 1; p--) {
      if (!'71'.includes(run[p])) continue;
      for (const L of [3, 2]) {
        const a = run.slice(0, p), b = run.slice(p + 1, p + 1 + L);
        if (b.length === L && ok(a, b)) return { number: a, total: b };
      }
    }
  }
  return null;
}

const NAME_STOP = /^(basic|stage|stage1|stage2|hp|pokemon|pokémon|trainer|item|supporter|tool|energy|evolves|from|ex|v|vmax|vstar|gx|tera)$/i;

function parseName(text) {
  const words = text
    .replace(/[^A-Za-zÀ-ÿ'\.\- \n]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ\.]+$/g, ''))
    .filter((w) => w.length >= 3 && !NAME_STOP.test(w));
  // Prefer Capitalised words (card names are printed in title case); keep "Mega"/"Dark" style prefixes.
  const caps = words.filter((w) => /^[A-ZÀ-Ý]/.test(w));
  const pick = (caps.length ? caps : words).slice(0, 2);
  if (pick.length === 2 && !/^(Mega|Dark|Light|Alolan|Galarian|Hisuian|Paldean|Radiant|Shining|Team|Iron|Great|Scream|Walking|Roaring|Gouging|Raging)$/i.test(pick[0])) pick.pop();
  return pick.join(' ');
}

async function ocr(worker, canvas, params) {
  await worker.setParameters(params);
  const { data } = await worker.recognize(canvas);
  return data.text || '';
}

async function identifyWithOCR(canvas, cropped, setStatus) {
  const worker = await getWorker(setStatus);

  // 1) Name (top-left). Used to validate whatever the number passes read.
  setStatus('Leyendo nombre…');
  const NAME = { tessedit_char_whitelist: '', tessedit_pageseg_mode: cropped ? '7' : '11' };
  let name = '';
  const namePasses = cropped
    ? [
        [0.16, 0.025, 0.5, 0.07, 'gray'],
        [0.16, 0.025, 0.5, 0.07, 'dark'],
        [0.04, 0.02, 0.7, 0.09, 'gray'],
      ]
    : [[0, 0, 1, 0.3, 'gray']];
  for (const [x, y, w, hh, mode] of namePasses) {
    name = parseName(await ocr(worker, region(canvas, x, y, w, hh, { mode, scale: cropped ? 2 : 1 }), NAME));
    if (name.length >= 4) break;
  }

  // 2) Collector number (bottom). Each read is checked against the name before accepting it.
  setStatus(name ? `Leí “${name}”. Buscando el número…` : 'Leyendo número…');
  const totals = new Set((await getSets().catch(() => [])).map((x) => x.official).filter(Boolean));
  const P = (psm) => ({ tessedit_char_whitelist: '0123456789/TGRCSV', tessedit_pageseg_mode: psm });
  const T1 = [0.15, 0.93, 0.2, 0.045], T2 = [0.1, 0.92, 0.32, 0.07], WIDE = [0, 0.9, 0.55, 0.09], RIGHT = [0.5, 0.9, 0.5, 0.09];
  const passes = cropped
    ? [
        [T1, 'bright', '6'], // full-art: white numbers with dark outline
        [T1, 'dark', '6'], // regular frame: black numbers
        [T2, 'bright', '6'],
        [T2, 'dark', '6'],
        [T1, 'gray', '7'],
        [WIDE, 'gray', '11'],
        [T2, 'bright', '11'],
        [RIGHT, 'gray', '11'], // older layouts print the number bottom-right
        [RIGHT, 'dark', '6'],
      ]
    : [
        [[0, 0.55, 1, 0.45], 'gray', '11'],
        [[0, 0.55, 1, 0.45], 'bright', '11'],
      ];
  const tried = new Set();
  let fallback = null;
  for (const [[x, y, w, hh], mode, psm] of passes) {
    const num = parseNumber(await ocr(worker, region(canvas, x, y, w, hh, { mode, scale: cropped ? 3 : 1.2 }), P(psm)), totals);
    if (!num || tried.has(num.number + '/' + num.total)) continue;
    tried.add(num.number + '/' + num.total);
    const cands = await findByNumber(num.number, num.total, name).catch(() => []);
    if (!cands.length) continue;
    const info = { name, number: num.number, total: num.total, via: 'ocr' };
    if (!name) return { info, cands };
    const good = cands.filter((c) => nameMatch(c.name, name));
    if (good.length) return { info, cands: good };
    fallback ||= { info, cands };
  }

  // 3) No number agreed with the name → search by name (user picks from the images).
  if (name) {
    setStatus(`Buscando “${name}”…`);
    const cands = await searchByName(name).catch(() => []);
    if (cands.length) return { info: { name, via: 'ocr' }, cands };
  }
  return fallback || { info: { name, via: 'ocr' }, cands: [] };
}

export async function testClaudeKey() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 64, 64);
  sdkPromise ||= import(ANTHROPIC_SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  const client = new Anthropic({ apiKey: state.settings.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  const r = await client.messages.create({ model: state.settings.claudeModel, max_tokens: 1000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with: ok' }] });
  return r.content.find((b) => b.type === 'text')?.text || 'ok';
}
