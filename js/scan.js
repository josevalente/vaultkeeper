// Camera capture + card identification.
// 1) With a Claude API key (Ajustes): Claude reads name/number/set from the photo.
// 2) Without one: on-device OCR (Tesseract.js) reads the "199/165" number + the name.
// Either way the user confirms the match against the official card image.

import { h, esc, $, norm, similarity } from './util.js';
import { state, save } from './store.js';
import { findByNumber, searchByName, getSets, setCards, searchCatalog, getCatalog } from './api.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.130.0/+esm';

let stream;

function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// Opens the full-screen camera. Resolves with { info, cands, shot } (or { burst: [...] } in burst
// mode, several cards one after another), { manual: true } to search instead, or null if closed.
export function openScanner({ title = 'Escanear carta', burst = false } = {}) {
  return new Promise((resolve) => {
    const ov = h(`
      <div class="scanner" role="dialog" aria-label="${esc(title)}">
        <video playsinline autoplay muted></video>
        <div class="scan-shade"><div class="scan-frame"><span></span><span></span><span></span><span></span></div></div>
        <div class="scan-top">
          <button class="icon-btn scan-close" aria-label="Cerrar">✕</button>
          <div class="scan-title">${esc(title)}</div>
          <button class="scan-lang" aria-label="Idioma de la carta">${state.settings.scanLang === 'ja' ? 'JP' : 'EN'}</button>
          <span class="scan-mode">${state.settings.claudeKey ? 'Claude' : 'OCR'}</span>
        </div>
        <div class="scan-hint">${burst ? 'Ráfaga: captura una carta, cambia a la siguiente y vuelve a capturar. Toca “Listo” al terminar.' : 'Encaja la carta en el marco, con buena luz y sin reflejos.'}</div>
        <div class="scan-status" hidden></div>
        ${burst ? '<div class="burst-strip"></div>' : ''}
        <div class="scan-bottom">
          <label class="pill-btn ghost">Foto
            <input type="file" accept="image/*" hidden>
          </label>
          <button class="shutter" aria-label="Capturar"><span></span></button>
          ${burst ? '<button class="pill-btn scan-done">Listo</button>' : '<button class="pill-btn ghost scan-manual">Buscar</button>'}
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
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        stream = s;
        video.srcObject = s;
      })
      .catch(() => setStatus('No pude abrir la cámara. Usa “Foto” para tomar o elegir una imagen.'));

    $('.scan-close', ov).onclick = () => close(null);
    $('.scan-manual', ov)?.addEventListener('click', () => close({ manual: true }));
    $('.scan-lang', ov).onclick = (e) => {
      state.settings.scanLang = state.settings.scanLang === 'ja' ? 'en' : 'ja';
      save({ silent: true });
      e.target.textContent = state.settings.scanLang === 'ja' ? 'JP' : 'EN';
      setStatus(state.settings.scanLang === 'ja' ? 'Modo carta japonesa: busco por el número impreso.' : 'Modo carta en inglés.');
    };

    // Burst: every capture is identified in the background, one after another.
    const results = [];
    let queue = Promise.resolve();
    const strip = $('.burst-strip', ov);
    const paintStrip = () => {
      if (!strip) return;
      strip.innerHTML = results.map((r) => `<span class="${r.state}"><img src="${r.shot}" alt=""></span>`).join('');
      const done = results.filter((r) => r.state !== 'wait').length;
      setStatus(results.length ? `${results.length} capturada${results.length === 1 ? '' : 's'} · ${done} leída${done === 1 ? '' : 's'}` : '');
    };
    const enqueue = (canvas, cropped) => {
      const r = { shot: thumb(canvas), state: 'wait' };
      results.push(r);
      paintStrip();
      queue = queue.then(async () => {
        try {
          Object.assign(r, await identify(canvas, cropped, () => {}));
          r.state = r.cands?.length ? 'ok' : 'bad';
        } catch {
          Object.assign(r, { info: {}, cands: [], state: 'bad' });
        }
        paintStrip();
      });
    };
    $('.scan-done', ov)?.addEventListener('click', async (e) => {
      e.target.textContent = 'Terminando…';
      await queue;
      close(results.length ? { burst: results } : null);
    });

    const run = async (canvas, cropped) => {
      if (burst) return enqueue(canvas, cropped);
      if (busy) return;
      busy = true;
      ov.classList.add('busy');
      try {
        const res = await identify(canvas, cropped, setStatus);
        res.shot = thumb(canvas);
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
      setStatus('Abriendo foto…');
      try {
        run(await loadImage(f), false);
      } catch (err) {
        setStatus(`No pude abrir la foto (${err.message}).`);
      }
    };
  });
}

// Small preview of what was captured, shown next to the matches so a bad crop is obvious.
function thumb(canvas) {
  const t = document.createElement('canvas');
  const s = 260 / canvas.width;
  t.width = 260;
  t.height = Math.round(canvas.height * s);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.7);
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
  const outW = Math.min(1500, Math.round(sw));
  c.width = outW;
  c.height = Math.round((outW * sh) / sw);
  c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

async function loadImage(file) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    src = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('no pude abrir la imagen'));
      im.src = url;
    });
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const w = src.naturalWidth || src.width, hgt = src.naturalHeight || src.height;
  const s = Math.min(1, 1600 / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(hgt * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function identify(canvas, cropped, setStatus) {
  if (state.settings.scanLang === 'ja') return identifyJapanese(canvas, cropped, setStatus);
  if (state.settings.claudeKey && navigator.onLine) {
    setStatus('Claude está leyendo la carta…');
    try {
      const info = await identifyWithClaude(canvas);
      // Claude noticed it's a Japanese card even though the scanner is in English mode.
      if (info.lang === 'ja') {
        const en = info.nameEn || info.name;
        let cands = info.number ? (await searchCatalog('jp', '', info.number, info.total).catch(() => [])).filter((c) => nameMatch(c.name, en)) : [];
        if (!cands.length && en) cands = await searchCatalog('jp', en).catch(() => []);
        if (cands.length) return { info: { ...info, name: en }, cands };
      }
      setStatus(`Buscando ${[info.name, info.number && `${info.number}/${info.total || '?'}`].filter(Boolean).join(' · ')}…`);
      let cands = info.number ? await findByNumber(info.number, info.total, info.name, { nameFallback: false }) : [];
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

// Japanese cards: prices come from TCGplayer Japan (data/catalogo/jp.json). Claude reads the card and
// gives the English name; without Claude, the on-device OCR reads only the printed number.
async function identifyJapanese(canvas, cropped, setStatus) {
  let info = null;
  if (state.settings.claudeKey && navigator.onLine) {
    setStatus('Claude está leyendo la carta japonesa…');
    try {
      info = await identifyWithClaude(canvas);
      const en = info.nameEn || info.name;
      let cands = info.number ? await searchCatalog('jp', '', info.number, info.total) : [];
      const byName = cands.filter((c) => nameMatch(c.name, en));
      if (byName.length) cands = byName;
      if (!cands.length && en) cands = await searchCatalog('jp', en);
      if (cands.length) return { info: { ...info, name: en }, cands };
    } catch (e) {
      console.warn('Claude falló, uso OCR', e);
    }
  }
  setStatus('Leyendo el número (OCR)…');
  const worker = await getWorker(setStatus);
  const cat = await getCatalog('jp');
  const totals = new Set(cat.items.map((e) => parseInt(String(e.no || '').split('/')[1], 10)).filter(Boolean));
  const k = Math.min(3, Math.max(1, 1400 / canvas.width));
  const NUM = (psm) => ({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: psm });
  const zones = cropped
    ? [[[0.0, 0.9, 0.55, 0.1], 'dark', '11'], [[0.0, 0.9, 0.55, 0.1], 'bright', '11'], [[0, 0.8, 0.65, 0.2], 'adark', '11'], [[0, 0.8, 0.65, 0.2], 'abright', '11'], [[0.35, 0.85, 0.65, 0.15], 'adark', '11']]
    : [[[0, 0.5, 1, 0.5], 'gray', '11'], [[0, 0.5, 1, 0.5], 'adark', '11']];
  for (const [[x, y, w, hh], mode, psm] of zones) {
    const text = await ocr(worker, region(canvas, x, y, w, hh, { mode, scale: Math.min(3.2, k * 1.8) }), NUM(psm));
    for (const num of parseNumbers(text, totals)) {
      const cands = await searchCatalog('jp', '', num.number, num.total).catch(() => []);
      if (cands.length) return { info: { ...(info || {}), number: num.number, total: num.total, via: info ? 'claude' : 'ocr' }, cands };
    }
  }
  return { info: { ...(info || {}), via: info ? 'claude' : 'ocr' }, cands: [] };
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
    name_en: { type: 'string', description: 'The official English name of this card (e.g. "Pikachu ex"); same as name if the card is in English' },
  },
  required: ['is_pokemon_card', 'name', 'number', 'set_total', 'set_name', 'language', 'name_en'],
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
  return { name: out.name, nameEn: out.name_en, lang: out.language, number: out.number, total: out.set_total, setName: out.set_name, via: 'claude' };
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
  if (mode === 'bright' || mode === 'dark') {
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i];
      const ink = mode === 'bright' ? g > 200 : g < Math.min(110, mean * 0.7);
      d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
    }
  } else if (mode === 'abright' || mode === 'adark') {
    // Adaptive (local-mean) threshold: copes with glare and with white digits outlined in black.
    const W = c.width, H = c.height, r = Math.max(6, Math.round(H / 7));
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += d[(y * W + x) * 4];
        I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
      }
    }
    const gray = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = d[i * 4];
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const m = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const g = gray[y * W + x];
        const ink = mode === 'abright' ? g > m + 28 && g > 150 : g < m - 28;
        const o = (y * W + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = ink ? 0 : 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const fixDigits = (t) => t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[S]/g, '5').replace(/[B]/g, '8');

// `totals` = printed set sizes that exist (165, 131…). Used to validate reads and to split
// runs like "19971654" where the italic slash was read as a 7 → 199/165.
// Returns every plausible reading, best first.
function parseNumbers(text, totals) {
  const t = text.toUpperCase();
  const out = [];
  const add = (number, total) => !out.some((o) => o.number === number && o.total === total) && out.push({ number, total });
  for (const g of t.matchAll(/\b(TG|GG|RC|SV)\s?(\d{1,3})\s*\/\s*(TG|GG|RC|SV)?\s?(\d{2,3})/g)) add(`${g[1]}${g[2]}`, `${g[3] || g[1]}${g[4]}`);
  const ok = (a, b) => {
    const A = parseInt(a, 10), B = parseInt(b, 10);
    return A >= 1 && B >= 10 && A <= B * 2 + 20 && (!totals?.size || totals.has(B));
  };
  const clean = fixDigits(t);
  for (const m of clean.matchAll(/(\d{1,3})\s*\/\s*(\d{2,3})/g)) if (ok(m[1], m[2])) add(m[1].padStart(3, '0'), m[2]);
  // Digit runs where the slash was misread ("119971650220" → 199/165): try every offset,
  // keep the plausible splits and rank 3-digit/3-digit reads with a "7" separator first.
  const splits = [];
  for (const run of clean.replace(/[^\d]+/g, ' ').split(' ')) {
    if (run.length < 5) continue;
    for (let st = 0; st < run.length - 3; st++) {
      for (let p = 1; p <= 3; p++) {
        const sep = run[st + p];
        if (!sep || !'71'.includes(sep)) continue;
        for (const L of [3, 2]) {
          const a = run.slice(st, st + p), b = run.slice(st + p + 1, st + p + 1 + L);
          if (b.length === L && ok(a, b)) splits.push({ a, b, q: (a.length === 3 ? 2 : 0) + (L === 3 ? 2 : 0) + (sep === '7' ? 1 : 0) - st * 0.1 });
        }
      }
    }
  }
  splits.sort((x, y) => y.q - x.q).slice(0, 2).forEach((x) => add(x.a.padStart(3, '0'), x.b));
  return out;
}

const NAME_STOP = /^(basic|stage|stage1|stage2|hp|pokemon|pokémon|trainer|trainers|item|supporter|tool|energy|evolves|from|ex|v|vmax|vstar|gx|tera|weakness|resistance|retreat|ability|rule|illus)$/i;
const PREFIX = /^(Mega|Dark|Light|Alolan|Galarian|Hisuian|Paldean|Radiant|Shining|Team|Iron|Great|Scream|Walking|Roaring|Gouging|Raging|Mr\.?)$/i;

// Tesseract word list (works whether the build returns data.words or nested blocks).
async function readWords(worker, canvas, params) {
  await worker.setParameters(params);
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const words = data.words?.length
    ? data.words
    : (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).flatMap((l) => l.words || [])));
  return { text: data.text || '', words };
}

// The card name is the biggest line of letters near the top (HP is digits, so it's ignored).
function pickName(words) {
  const ws = words
    .map((w) => ({ ...w, clean: String(w.text || '').replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ.'-]+$/g, '') }))
    .filter((w) => /^[A-Za-zÀ-ÿ.'-]{3,}$/.test(w.clean) && !NAME_STOP.test(w.clean) && !/from|evolve|ability|pok[eé]mon/i.test(w.clean) && w.clean.length <= 13 && (w.confidence ?? 100) > 35 && /[aeiouyáéíóú]/i.test(w.clean))
    .map((w) => ({ ...w, h: w.bbox.y1 - w.bbox.y0 }));
  if (!ws.length) return '';
  ws.sort((a, b) => b.h - a.h);
  const top = ws[0];
  const line = ws
    .filter((w) => Math.abs(w.bbox.y0 - top.bbox.y0) < top.h * 0.6 && w.h > top.h * 0.7)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const i = line.indexOf(top);
  const prev = line[i - 1], next = line[i + 1];
  const name = PREFIX.test(top.clean) && next ? `${top.clean} ${next.clean}` : prev && PREFIX.test(prev.clean) ? `${prev.clean} ${top.clean}` : top.clean;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function ocr(worker, canvas, params) {
  await worker.setParameters(params);
  const { data } = await worker.recognize(canvas);
  return data.text || '';
}

// Name printed in a tight crop (card fills the frame): first Capitalised word, keeping prefixes like "Mega".
function parseName(text) {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ.]+$/g, ''))
    .filter((w) => /^[A-Za-zÀ-ÿ.'-]{3,13}$/.test(w) && !NAME_STOP.test(w) && /[aeiouy]/i.test(w));
  const caps = words.filter((w) => /^[A-ZÀ-Ý]/.test(w));
  const pick = (caps.length ? caps : words).slice(0, 2);
  if (pick.length === 2 && !PREFIX.test(pick[0])) pick.pop();
  return pick.join(' ');
}

// Two strategies, cheapest first:
//  1) tight crops that assume the card fills the camera frame (fast and accurate when framed well);
//  2) position-independent reads of the top/bottom zones for loosely framed or tilted photos.
// Several name guesses are kept; a collector number is only accepted when its card matches one.
async function identifyWithOCR(canvas, cropped, setStatus) {
  const worker = await getWorker(setStatus);
  const k = Math.min(3, Math.max(1, 1400 / canvas.width)); // upscale small captures

  // ── names
  setStatus('Leyendo nombre…');
  const names = [];
  const addName = (n) => {
    if (!n || n.length < 4) return false;
    const dup = names.find((x) => similarity(baseName(x), baseName(n)) >= 0.8);
    if (!dup) names.push(n);
    return !!dup; // true = two passes agree
  };
  const NAME7 = { tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' };
  const TOPH = cropped ? 0.3 : 0.5; // a gallery photo may have the card anywhere in the middle
  const SPARSE = { tessedit_char_whitelist: '', tessedit_pageseg_mode: '11' };
  const nameSteps = [
    ...(cropped
      ? [
          () => ocr(worker, region(canvas, 0.16, 0.025, 0.5, 0.07, { mode: 'gray', scale: 2 }), NAME7).then(parseName),
          () => ocr(worker, region(canvas, 0.16, 0.025, 0.5, 0.07, { mode: 'dark', scale: 2 }), NAME7).then(parseName),
          () => ocr(worker, region(canvas, 0.04, 0.02, 0.7, 0.09, { mode: 'gray', scale: 2 }), NAME7).then(parseName),
        ]
      : []),
    () => readWords(worker, region(canvas, 0, 0, 1, TOPH, { mode: 'gray', scale: k }), SPARSE).then((r) => pickName(r.words)),
    () => readWords(worker, region(canvas, 0, 0, 1, TOPH, { mode: 'adark', scale: k }), SPARSE).then((r) => pickName(r.words)),
  ];
  for (const step of nameSteps) if (addName(await step().catch(() => ''))) break;
  const name = names[0] || '';
  const matches = (c) => names.some((n) => nameMatch(c.name, n));

  // ── collector number
  setStatus(name ? `Leí “${name}”. Buscando el número…` : 'Leyendo número…');
  const sets = await getSets().catch(() => []);
  const totals = new Set(sets.map((x) => x.official).filter(Boolean));
  const maxIdx = Math.max(1, ...sets.map((x) => x.idx));
  const NUM = (psm) => ({ tessedit_char_whitelist: '0123456789/', tessedit_pageseg_mode: psm });
  const T1 = [0.15, 0.93, 0.2, 0.045], T2 = [0.1, 0.92, 0.32, 0.07]; // card fills the frame
  const BL = cropped ? [0, 0.8, 0.65, 0.2] : [0, 0.5, 1, 0.5]; // bottom zone, wherever the card sits in it
  const passes = [
    ...(cropped
      ? [
          [T1, 'bright', '6', 3, true], // full-art: white numbers with dark outline
          [T1, 'dark', '6', 3, true], // regular frame: black numbers
          [T2, 'bright', '6', 3, true],
          [T2, 'dark', '6', 3, true],
          [[0, 0.9, 0.55, 0.09], 'gray', '11', 2.4, true],
        ]
      : []),
    [BL, 'dark', '11'],
    [BL, 'abright', '11'],
    [BL, 'bright', '11'],
    [BL, 'adark', '11'],
    [BL, 'gray', '11'],
    [[0.35, 0.8, 0.65, 0.2], 'adark', '11'], // older layouts print it bottom-right
  ];
  const keyOf = (r) => r.number + '/' + r.total;
  const votes = new Map(), first = new Map(), lookups = new Map();
  const reads = [];
  const lookup = (num) => {
    if (!lookups.has(keyOf(num))) lookups.set(keyOf(num), findByNumber(num.number, num.total, name, { nameFallback: false }).catch(() => []));
    return lookups.get(keyOf(num));
  };
  const deadline = Date.now() + 12000;
  let pi = 0;
  for (const [[x, y, w, hh], mode, psm, sc, tight] of passes) {
    if (Date.now() > deadline) break;
    const text = await ocr(worker, region(canvas, x, y, w, hh, { mode, scale: sc ? Math.max(sc, k) : Math.min(3.2, k * 1.6) }), NUM(psm));
    for (const num of parseNumbers(text, totals)) {
      const key = keyOf(num);
      if (!votes.has(key)) reads.push(num), first.set(key, pi);
      votes.set(key, (votes.get(key) || 0) + 1);
      // Accept right away when a tight read (or any read seen twice) points to a card with our name.
      if (names.length && (tight || votes.get(key) >= 2)) {
        const good = (await lookup(num)).filter(matches);
        if (good.length) return { info: { name, ...num, via: 'ocr' }, cands: good.sort((a, b) => b.setIdx - a.setIdx) };
      }
    }
    pi++;
  }

  // Score what we have: votes + name + early pass + recency (ferias move mostly modern sets).
  reads.sort((a, b) => votes.get(keyOf(b)) - votes.get(keyOf(a)) || first.get(keyOf(a)) - first.get(keyOf(b)));
  const scored = new Map();
  let fallback = null;
  for (const num of reads.slice(0, 8)) {
    const cands = await lookup(num);
    if (!cands.length) continue;
    fallback ||= { info: { name, ...num, via: 'ocr' }, cands };
    for (const c of cands) {
      const nm = matches(c);
      if (names.length && !nm) continue;
      const sc = votes.get(keyOf(num)) + (nm ? 3 : 0) + (first.get(keyOf(num)) <= 1 ? 1 : 0) + (c.setIdx / maxIdx) * 1.5;
      if (!scored.has(c.id) || scored.get(c.id).sc < sc) scored.set(c.id, { c, sc, num });
    }
  }
  if (scored.size) {
    const best = [...scored.values()].sort((a, b) => b.sc - a.sc);
    return { info: { name, ...best[0].num, via: 'ocr' }, cands: best.map((x) => x.c) };
  }
  if (!names.length && fallback) return fallback;

  // The printed total ("/165") is often right even when the number isn't: look for the name
  // inside the sets with that total, ranked by how close the number looks.
  if (reads.length) {
    setStatus(`Buscando “${name}” en la expansión…`);
    const tot = [...new Set(reads.map((r) => parseInt(r.total, 10)))].slice(0, 4);
    const pool = [];
    for (const t of tot) for (const st of sets.filter((x) => x.official === t)) pool.push(...(await setCards(st.id).catch(() => [])));
    const hits = pool.filter(matches);
    if (hits.length) {
      const dist = (c) => Math.min(...reads.map((r) => digitDistance(String(c.number), r.number)));
      hits.sort((a, b) => dist(a) - dist(b) || b.setIdx - a.setIdx);
      return { info: { name, number: reads[0].number, total: reads[0].total, via: 'ocr' }, cands: hits };
    }
  }

  // Nothing agreed → fuzzy search by each name guess (the user picks from the images).
  const exact = [];
  for (const n of names) exact.push(await searchByName(n).catch(() => []));
  const hitIdx = exact.findIndex((l) => l.length);
  if (hitIdx >= 0) return { info: { name: names[hitIdx], via: 'ocr' }, cands: fallback ? mergeById(exact[hitIdx], fallback.cands) : exact[hitIdx] };
  for (const n of names) {
    setStatus(`Buscando “${n}”…`);
    const cands = await fuzzyName(n);
    if (cands.length) return { info: { name: n, via: 'ocr' }, cands: fallback ? mergeById(cands, fallback.cands) : cands };
  }
  return fallback || { info: { name, via: 'ocr' }, cands: [] };
}

function digitDistance(a, b) {
  a = a.replace(/^0+/, '').padStart(3, '0');
  b = b.replace(/^0+/, '').padStart(3, '0');
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

const mergeById = (a, b) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];

// OCR often garbles a letter ("Umbheon"), so fall back to prefixes and rank by similarity.
async function fuzzyName(name) {
  const base = baseName(name);
  let cands = await searchByName(name).catch(() => []);
  if (cands.length) return cands;
  const word = base.split(' ').sort((a, b) => b.length - a.length)[0] || '';
  for (const n of [5, 4, 3]) {
    if (word.length < n) continue;
    cands = (await searchByName(word.slice(0, n)).catch(() => [])).filter((c) => similarity(baseName(c.name), base) >= 0.45);
    if (cands.length) return cands.sort((a, b) => similarity(baseName(b.name), base) - similarity(baseName(a.name), base));
  }
  return [];
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
