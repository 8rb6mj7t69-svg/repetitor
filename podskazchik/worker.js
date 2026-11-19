// Cloudflare Worker: помощник без собственного сервера. Страница отдаётся из папки public.
import { parse, ask } from './core.js';

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

async function chat(request, env) {
  if (!env.ROUTERAI_API_KEY || !env.MODEL) return json(500, { error: 'Сервис не настроен: нужны ROUTERAI_API_KEY и MODEL.' });
  const raw = await request.text();
  if (raw.length > 200 * 1024) return json(413, { error: 'Слишком длинный запрос.' });
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json(400, { error: 'Некорректный запрос.' }); }
  const p = parse(body);
  if (!p) return json(400, { error: 'Сообщение пустое или слишком длинное. Начни новое задание кнопкой «＋».' });
  try {
    const text = await ask(p, { base: env.API_BASE || 'https://routerai.ru/api/v1', key: env.ROUTERAI_API_KEY, model: env.MODEL });
    return json(200, { text });
  } catch (e) {
    console.error('upstream error:', e.status || e.name); // тексты детей не логируем
    return json(502, { error: 'Помощник сейчас недоступен. Попробуй ещё раз через минуту.' });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      return request.method === 'POST' ? chat(request, env) : json(405, { error: 'Метод не поддерживается.' });
    }
    return env.ASSETS.fetch(request);
  }
};
