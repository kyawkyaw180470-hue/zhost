/**
 * Zhost Worker
 * Free Telegram bot hosting — https://github.com/YOUR-USERNAME/zhost
 * Author: Zaw Myo Naing
 *
 * Endpoints:
 *   GET    /                                → worker info
 *   GET    /api/ping                        → { ok, version }
 *   GET    /api/bots/:botId                 → bot config
 *   PUT    /api/bots/:botId                 → save config (+ token)
 *   DELETE /api/bots/:botId                 → delete bot
 *   POST   /api/bots/:botId/webhook         → register webhook on Telegram
 *   DELETE /api/bots/:botId/webhook         → remove webhook
 *   POST   /api/bots/:botId/commands        → sync commands to Telegram
 *   POST   /webhook/:botId                  ← Telegram sends updates here
 *
 * KV keys:
 *   bot:<id>:config   → JSON config (no token)
 *   bot:<id>:token    → Telegram bot token
 *   bot:<id>:secret   → webhook secret token
 */

const VERSION = '1.0.0';
const TELEGRAM_API = 'https://api.telegram.org';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token',
  'Access-Control-Max-Age': '86400',
};

/* ═══════════════════════════════════════════════════════════
   Main entry
   ═══════════════════════════════════════════════════════════ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // ── GET /api/ping ────────────────────────────────────
      if (path === '/api/ping' && method === 'GET') {
        return json({ ok: true, version: VERSION, time: new Date().toISOString() });
      }

      // ── /api/bots/:botId ─────────────────────────────────
      const botApiMatch = path.match(/^\/api\/bots\/([^\/]+)$/);
      if (botApiMatch) {
        const botId = decodeURIComponent(botApiMatch[1]);
        if (method === 'PUT')    return await handlePutConfig(request, env, botId);
        if (method === 'GET')    return await handleGetConfig(env, botId);
        if (method === 'DELETE') return await handleDeleteBot(env, botId);
      }

      // ── /api/bots/:botId/webhook ─────────────────────────
      const webhookApiMatch = path.match(/^\/api\/bots\/([^\/]+)\/webhook$/);
      if (webhookApiMatch) {
        const botId = decodeURIComponent(webhookApiMatch[1]);
        if (method === 'POST')   return await handleRegisterWebhook(request, env, botId, url);
        if (method === 'DELETE') return await handleDeleteWebhook(env, botId);
      }

      // ── /api/bots/:botId/commands ────────────────────────
      const cmdsApiMatch = path.match(/^\/api\/bots\/([^\/]+)\/commands$/);
      if (cmdsApiMatch && method === 'POST') {
        return await handleSyncCommands(request, env, decodeURIComponent(cmdsApiMatch[1]));
      }

      // ── /webhook/:botId  ← Telegram updates ──────────────
      const hookMatch = path.match(/^\/webhook\/([^\/]+)$/);
      if (hookMatch && method === 'POST') {
        return await handleTelegramWebhook(request, env, ctx, decodeURIComponent(hookMatch[1]));
      }

      // ── Root ─────────────────────────────────────────────
      if (path === '/' || path === '') {
        return json({
          name: 'Zhost Worker',
          version: VERSION,
          author: 'Zaw Myo Naing',
          status: 'ok',
        });
      }

      return json({ error: 'Not found', path }, 404);
    } catch (err) {
      return json({ error: err.message, stack: err.stack }, 500);
    }
  },
};

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    throw new Error('Invalid JSON body');
  }
}

/* ═══════════════════════════════════════════════════════════
   Bot config: PUT /api/bots/:botId
   Body: config JSON + optional { token }
   ═══════════════════════════════════════════════════════════ */
async function handlePutConfig(request, env, botId) {
  const body = await readJson(request);

  // Extract token — stored separately, never inside config
  const token = body.token || null;
  delete body.token;

  // Save config
  await env.BOTS.put(`bot:${botId}:config`, JSON.stringify(body));

  // Save token if provided
  if (token) {
    await env.BOTS.put(`bot:${botId}:token`, token);
  }

  return json({
    ok: true,
    version: VERSION,
    botId,
    savedAt: new Date().toISOString(),
  });
}

/* ═══════════════════════════════════════════════════════════
   Bot config: GET /api/bots/:botId
   ═══════════════════════════════════════════════════════════ */
async function handleGetConfig(env, botId) {
  const configStr = await env.BOTS.get(`bot:${botId}:config`);
  if (!configStr) return json({ error: 'Bot not found' }, 404);

  try {
    return json(JSON.parse(configStr));
  } catch (e) {
    return json({ error: 'Config corrupted' }, 500);
  }
}

/* ═══════════════════════════════════════════════════════════
   Delete bot: DELETE /api/bots/:botId
   ═══════════════════════════════════════════════════════════ */
async function handleDeleteBot(env, botId) {
  await Promise.all([
    env.BOTS.delete(`bot:${botId}:config`),
    env.BOTS.delete(`bot:${botId}:token`),
    env.BOTS.delete(`bot:${botId}:secret`),
  ]);
  return json({ ok: true, botId });
}

/* ═══════════════════════════════════════════════════════════
   Register webhook: POST /api/bots/:botId/webhook
   ═══════════════════════════════════════════════════════════ */
async function handleRegisterWebhook(request, env, botId, url) {
  let token = null;
  try {
    const body = await request.json();
    token = body.token;
  } catch (e) { /* allow empty body — fall back to stored token */ }

  if (!token) token = await env.BOTS.get(`bot:${botId}:token`);
  if (!token) return json({ error: 'No token provided or stored' }, 400);

  // Generate webhook secret for verification
  const secret = generateSecret();
  await env.BOTS.put(`bot:${botId}:secret`, secret);

  // Webhook URL: same origin as this request
  const webhookUrl = `${url.protocol}//${url.host}/webhook/${botId}`;

  // Call Telegram setWebhook
  const tgUrl = `${TELEGRAM_API}/bot${token}/setWebhook`;
  const res = await fetch(tgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query', 'edited_message'],
      drop_pending_updates: true,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    return json({ error: data.description || 'setWebhook failed', telegram: data }, 400);
  }

  return json({ ok: true, webhookUrl, message: 'Webhook registered' });
}

/* ═══════════════════════════════════════════════════════════
   Delete webhook: DELETE /api/bots/:botId/webhook
   ═══════════════════════════════════════════════════════════ */
async function handleDeleteWebhook(env, botId) {
  const token = await env.BOTS.get(`bot:${botId}:token`);
  if (!token) return json({ error: 'No token stored' }, 400);

  const tgUrl = `${TELEGRAM_API}/bot${token}/deleteWebhook`;
  const res = await fetch(tgUrl, { method: 'POST' });
  const data = await res.json();

  await env.BOTS.delete(`bot:${botId}:secret`);

  if (!data.ok) {
    return json({ error: data.description || 'deleteWebhook failed' }, 400);
  }
  return json({ ok: true, message: 'Webhook deleted' });
}

/* ═══════════════════════════════════════════════════════════
   Sync commands: POST /api/bots/:botId/commands
   Body: { token, commands: [{command, description}] }
   ═══════════════════════════════════════════════════════════ */
async function handleSyncCommands(request, env, botId) {
  const body = await readJson(request);
  let token = body.token;
  if (!token) token = await env.BOTS.get(`bot:${botId}:token`);
  if (!token) return json({ error: 'No token' }, 400);

  const commands = (body.commands || [])
    .map(c => ({
      command: String(c.command || '').replace(/^\//, '').toLowerCase(),
      description: String(c.description || '').slice(0, 256),
    }))
    .filter(c => /^[a-z0-9_]{1,32}$/.test(c.command));

  const tgUrl = `${TELEGRAM_API}/bot${token}/setMyCommands`;
  const res = await fetch(tgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  const data = await res.json();
  if (!data.ok) return json({ error: data.description || 'setMyCommands failed' }, 400);

  return json({ ok: true, count: commands.length });
}

/* ═══════════════════════════════════════════════════════════
   Telegram webhook: POST /webhook/:botId
   ═══════════════════════════════════════════════════════════ */
async function handleTelegramWebhook(request, env, ctx, botId) {
  // Load config
  const configStr = await env.BOTS.get(`bot:${botId}:config`);
  if (!configStr) return new Response('Bot not configured', { status: 404 });

  // Load token
  const token = await env.BOTS.get(`bot:${botId}:token`);
  if (!token) return new Response('Bot has no token', { status: 400 });

  // Verify webhook secret
  const secret = await env.BOTS.get(`bot:${botId}:secret`);
  if (secret) {
    const received = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (received !== secret) return new Response('Unauthorized', { status: 401 });
  }

  let config;
  try {
    config = JSON.parse(configStr);
  } catch (e) {
    return new Response('Config corrupted', { status: 500 });
  }

  let update;
  try {
    update = await request.json();
  } catch (e) {
    return new Response('Invalid update', { status: 400 });
  }

  // Process update in background — return 200 fast
  ctx.waitUntil(
    processUpdate(update, config, token).catch(err => console.error('processUpdate:', err))
  );

  return new Response('OK', { status: 200 });
}

/* ═══════════════════════════════════════════════════════════
   Process a Telegram update
   ═══════════════════════════════════════════════════════════ */
async function processUpdate(update, config, token) {
  // Handle inline button callbacks
  if (update.callback_query) {
    return await handleCallbackQuery(update.callback_query, config, token);
  }

  // Handle text messages
  const message = update.message || update.edited_message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const firstWord = text.toLowerCase().split(/\s/)[0];

  let reply = null;
  let replyMarkup = null;

  /* ── 1. /start with welcome text ──────────────────────── */
  if (firstWord === '/start' && config.welcome && config.welcome.text) {
    reply = applyPlaceholders(config.welcome.text, config, message);
    if (config.welcome.attach_keyboard !== false && hasReplyKeyboard(config)) {
      replyMarkup = buildReplyKeyboardMarkup(config);
    }
  }

  /* ── 2. Command match ─────────────────────────────────── */
  if (!reply && Array.isArray(config.commands)) {
    const cmd = config.commands.find(c =>
      c.enabled !== false &&
      c.cmd &&
      c.cmd.toLowerCase() === firstWord
    );
    if (cmd) {
      reply = applyPlaceholders(cmd.reply || '', config, message);
      if (firstWord === '/start' && hasReplyKeyboard(config)) {
        replyMarkup = buildReplyKeyboardMarkup(config);
      }
    }
  }

  /* ── 3. Menu button match (buttons[] or reply_keyboard[]) ── */
  if (!reply) {
    // Simple format: config.buttons = [{label, reply}]
    if (Array.isArray(config.buttons)) {
      const btn = config.buttons.find(b =>
        b.enabled !== false &&
        b.label &&
        b.label.toLowerCase() === text.toLowerCase()
      );
      if (btn) reply = applyPlaceholders(btn.reply || '', config, message);
    }
    // Extended format: config.reply_keyboard = [[{text, reply}, ...], ...]
    if (!reply && Array.isArray(config.reply_keyboard)) {
      const flat = config.reply_keyboard.flat();
      const btn = flat.find(b => b && b.text && b.text.toLowerCase() === text.toLowerCase());
      if (btn && btn.reply) reply = applyPlaceholders(btn.reply, config, message);
    }
  }

  /* ── 4. Auto-reply rules ──────────────────────────────── */
  if (!reply && Array.isArray(config.auto_replies)) {
    for (const rule of config.auto_replies) {
      if (rule.enabled === false) continue;
      if (matchRule(rule, text)) {
        reply = applyPlaceholders(rule.reply || '', config, message);
        break;
      }
    }
  }

  /* ── 5. Fallback ──────────────────────────────────────── */
  if (!reply && config.options && config.options.fallback_reply) {
    reply = applyPlaceholders(config.options.fallback_reply, config, message);
  }

  if (!reply) return;

  await sendMessage(token, chatId, reply, {
    parse_mode: config.options && config.options.markdown ? 'Markdown' : undefined,
    reply_markup: replyMarkup,
  });
}

/* ═══════════════════════════════════════════════════════════
   Handle inline button callback
   ═══════════════════════════════════════════════════════════ */
async function handleCallbackQuery(cb, config, token) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const data = cb.data || '';

  // Remove loading spinner on the button
  await answerCallbackQuery(token, cb.id);

  if (!chatId || !data) return;

  await sendMessage(token, chatId, data, {
    parse_mode: config.options && config.options.markdown ? 'Markdown' : undefined,
  });
}

/* ═══════════════════════════════════════════════════════════
   Match an auto-reply rule against text
   ═══════════════════════════════════════════════════════════ */
function matchRule(rule, text) {
  const caseSensitive = !!(rule.case_sensitive || rule.caseSensitive);
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? (rule.match || '') : (rule.match || '').toLowerCase();

  switch (rule.mode) {
    case 'exact':  return hay === needle;
    case 'starts': return hay.startsWith(needle);
    case 'ends':   return hay.endsWith(needle);
    case 'regex':
      try { return new RegExp(rule.match, caseSensitive ? '' : 'i').test(text); }
      catch { return false; }
    case 'contains':
    default:       return hay.includes(needle);
  }
}

/* ═══════════════════════════════════════════════════════════
   Replace {bot_name}, {user_name}, {date} placeholders
   ═══════════════════════════════════════════════════════════ */
function applyPlaceholders(text, config, message) {
  if (!text) return '';
  const botName = (config.bot && config.bot.name) || (config.name) || 'Bot';
  const userName = (message.from && (message.from.first_name || message.from.username)) || 'there';
  const date = new Date().toISOString().slice(0, 10);

  return String(text)
    .replace(/\{bot_name\}/g, botName)
    .replace(/\{user_name\}/g, userName)
    .replace(/\{date\}/g, date);
}

/* ═══════════════════════════════════════════════════════════
   Build Telegram reply keyboard markup
   ═══════════════════════════════════════════════════════════ */
function hasReplyKeyboard(config) {
  if (Array.isArray(config.reply_keyboard) && config.reply_keyboard.length) return true;
  if (Array.isArray(config.buttons) && config.buttons.length) return true;
  return false;
}

function buildReplyKeyboardMarkup(config) {
  let rows;

  if (Array.isArray(config.reply_keyboard) && config.reply_keyboard.length) {
    rows = config.reply_keyboard.map(row => row.map(b => ({ text: b.text })));
  } else if (Array.isArray(config.buttons) && config.buttons.length) {
    // Simple format: one button per row, or 2 per row
    rows = [];
    const buttons = config.buttons.filter(b => b.enabled !== false);
    for (let i = 0; i < buttons.length; i += 2) {
      const row = [{ text: buttons[i].label }];
      if (buttons[i + 1]) row.push({ text: buttons[i + 1].label });
      rows.push(row);
    }
  } else {
    return null;
  }

  const kb = config.keyboard || {};
  return {
    keyboard: rows,
    resize_keyboard: kb.resize !== false,
    one_time_keyboard: !!kb.once,
    input_field_placeholder: kb.placeholder || undefined,
  };
}

/* ═══════════════════════════════════════════════════════════
   Telegram API: sendMessage
   ═══════════════════════════════════════════════════════════ */
async function sendMessage(token, chatId, text, opts = {}) {
  const body = { chat_id: chatId, text };
  if (opts.parse_mode) body.parse_mode = opts.parse_mode;
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;

  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('sendMessage failed:', err);
  }
  return res;
}

/* ═══════════════════════════════════════════════════════════
   Telegram API: answerCallbackQuery
   ═══════════════════════════════════════════════════════════ */
async function answerCallbackQuery(token, callbackQueryId) {
  const url = `${TELEGRAM_API}/bot${token}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════
   Random webhook secret generator (64 hex chars)
   ═══════════════════════════════════════════════════════════ */
function generateSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}