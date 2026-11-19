// Подсказчик: сервер без зависимостей (Node.js 18+). Ключ routerai хранится только здесь.
import http from 'node:http';
import fs from 'node:fs';
import { parse, ask } from './core.js';

const PORT = Number(process.env.PORT) || 3000;
const KEY = process.env.ROUTERAI_API_KEY || '';
const MODEL = process.env.MODEL || '';
const BASE = process.env.API_BASE || 'https://routerai.ru/api/v1';
const PER_IP_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR) || 60;
const PER_DAY_TOTAL = Number(process.env.DAILY_LIMIT) || 5000;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_BODY = 200 * 1024;
const INDEX = fs.readFileSync(new URL('./public/index.html', import.meta.url));

const hits = new Map();
let day = { key: '', n: 0 };
function allow(ip) {
  const now = Date.now(), today = new Date().toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, n: 0 };
  if (day.n >= PER_DAY_TOTAL) return 'day';
  let h = hits.get(ip);
  if (!h || h.reset < now) { h = { n: 0, reset: now + 3600e3 }; hits.set(ip, h); }
  if (h.n >= PER_IP_PER_HOUR) return 'ip';
  h.n++; day.n++;
  return null;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, 600e3).unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || 'unknown';
}
function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function chat(req, res) {
  if (!KEY || !MODEL) return send(res, 500, { error: 'Сервер не настроен: нужны ROUTERAI_API_KEY и MODEL.' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'Некорректный запрос.' }); }
  const p = parse(body);
  if (!p) return send(res, 400, { error: 'Сообщение пустое или слишком длинное. Начни новое задание кнопкой «＋».' });
  const lim = allow(clientIp(req));
  if (lim === 'ip') return send(res, 429, { error: 'Слишком много запросов. Попробуй через час или попроси учителя.' });
  if (lim === 'day') return send(res, 429, { error: 'На сегодня лимит помощника исчерпан. Попробуй завтра.' });
  try {
    send(res, 200, { text: await ask(p, { base: BASE, key: KEY, model: MODEL }) });
  } catch (e) {
    console.error('upstream error:', e.status || e.name); // тексты детей не логируем
    send(res, 502, { error: 'Помощник сейчас недоступен. Попробуй ещё раз через минуту.' });
  }
}

http.createServer((req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  const url = (req.url || '').split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(INDEX);
  }
  if (req.method === 'GET' && url === '/healthz') return send(res, 200, { ok: true });
  if (req.method === 'POST' && url === '/api/chat') return chat(req, res);
  send(res, 404, { error: 'Не найдено.' });
}).listen(PORT, () => console.log('Подсказчик: http://localhost:' + PORT));
