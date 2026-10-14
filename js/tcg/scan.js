// Identify a Magic / Yu-Gi-Oh card from a photo for the shared camera scanner (js/scan.js):
//  · with a Claude API key: Claude reads the name and the printed code;
//  · without it: the on-device OCR reads the printed code (set + number / "LOB-EN001"), and if
//    that fails, the name at the top.
// Returns { info, cands } like the Pokémon reader; cands are printings (js/tcg/games.js).

import { ocrBox, ocrTopName } from '../scan.js';
import { game, settings } from './store.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.130.0/+esm';
let sdk;

const SCHEMA = {
  type: 'object',
  properties: {
    is_card: { type: 'boolean' },
    name: { type: 'string', description: 'Card name exactly as printed, in English if the card is in English' },
    set_code: { type: 'string', description: 'Set code printed on the card, empty if unreadable' },
    collector_number: { type: 'string', description: 'Collector number / printed card code, empty if unreadable' },
    language: { type: 'string' },
  },
  required: ['is_card', 'name', 'set_code', 'collector_number', 'language'],
  additionalProperties: false,
};

async function claudeRead(canvas, signal) {
  sdk ||= import(SDK);
  const { default: Anthropic } = await sdk;
  const s = settings();
  const client = new Anthropic({ apiKey: s.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 25000 });
  const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  const msg = await client.messages.create(
    {
      model: s.claudeModel || 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }, { type: 'text', text: `${game.claudeHint} Report exactly what is printed; leave a field empty rather than guessing.` }] }],
    },
    signal ? { signal } : undefined
  );
  const out = JSON.parse(msg.content.find((b) => b.type === 'text')?.text || '{}');
  if (!out.is_card) throw new Error(`No parece una carta de ${game.short}`);
  return out;
}

const codeQuery = (o) => (game.id === 'mtg' ? (o.set_code && o.collector_number ? `${o.set_code} ${String(o.collector_number).split('/')[0].replace(/^0+(?=\d)/, '')}` : '') : o.collector_number || '');

export async function readCard(canvas, cropped, setStatus, { signal } = {}) {
  if (settings().claudeKey && navigator.onLine) {
    setStatus('Claude está leyendo la carta…');
    try {
      const o = await claudeRead(canvas, signal);
      const code = codeQuery(o);
      setStatus(`Buscando ${[o.name, code].filter(Boolean).join(' · ')}…`);
      let cands = code ? await game.search(code) : [];
      if (o.name && cands.length && !cands.some((c) => c.name.toLowerCase() === o.name.toLowerCase())) cands = [];
      if (!cands.length && o.name) cands = await game.search(o.name);
      if (cands.length) return { info: { name: o.name, number: code || '', via: 'claude' }, cands };
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      setStatus(`${e?.status === 401 ? 'Tu API key de Claude no es válida' : 'Claude no pudo'}: leo con OCR…`);
    }
  }
  // OCR: the printed code first (it identifies the exact printing), then the name.
  setStatus('Leyendo el código impreso…');
  const text = await ocrBox(canvas, game.ocr.box, { whitelist: game.ocr.whitelist, psm: '6', mode: 'gray' }).catch(() => '');
  const code = game.parseCode(text);
  if (code) {
    setStatus(`Leí ${code}. Buscando…`);
    const cands = await game.search(code).catch(() => []);
    if (cands.length) return { info: { number: code, name: cands[0].name, via: 'ocr' }, cands };
  }
  setStatus('Leyendo el nombre…');
  const name = await ocrTopName(canvas).catch(() => '');
  if (name) {
    setStatus(`Leí “${name}”. Buscando…`);
    const cands = await game.search(name).catch(() => []);
    return { info: { name, via: 'ocr' }, cands };
  }
  return { info: { via: 'ocr' }, cands: [] };
}
