const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const {
  loadConfig,
  saveConfig,
  verifyPassword,
  hashPassword,
  maskSecret,
} = require('./lib/config');
const { generatePoem } = require('./lib/poem');
const { generateBrief, readBriefCache, SOURCES } = require('./lib/brief');
const {
  formatPoemMessage,
  formatBriefMessage,
  formatTestMessage,
  pushToWeChat,
} = require('./lib/wechat');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOG_FILE = path.join(ROOT, 'data', 'push-log.jsonl');
const SCHEDULER_STATE_FILE = path.join(ROOT, 'data', 'scheduler-state.json');
const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_SIZE = 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_SIZE) {
      throw createError(413, '请求体过大');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw createError(400, '请求体不是合法的 JSON');
  }
}

async function readLogs(limit = 100) {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendLog(entry) {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.appendFile(LOG_FILE, `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`, 'utf8');
}

let schedulerState = {};
let schedulerRunning = false;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function zonedTimeToEpoch(year, month, day, hour, minute, timeZone) {
  let epoch = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i += 1) {
    const current = zonedParts(new Date(epoch), timeZone);
    const wanted = (year * 10000 + month * 100 + day) * 1440 + hour * 60 + minute;
    const actual =
      (current.year * 10000 + current.month * 100 + current.day) * 1440 +
      current.hour * 60 +
      current.minute;
    if (actual === wanted) break;
    epoch += (wanted - actual) * 60000;
  }
  return epoch;
}

function normalizeClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return `${pad2(hour)}:${pad2(minute)}`;
}

function nextSchedulerRun() {
  const scheduler = config.scheduler;
  if (!scheduler || !scheduler.enabled || !scheduler.times.length || !scheduler.items.length) {
    return null;
  }
  const timeZone = scheduler.timezone || 'Asia/Shanghai';
  const now = Date.now();
  const today = zonedParts(new Date(now), timeZone);
  const candidates = [];
  for (const clock of scheduler.times) {
    const [hour, minute] = clock.split(':').map(Number);
    for (const item of scheduler.items) {
      for (const offset of [0, 1]) {
        const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
        const epoch = zonedTimeToEpoch(
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          hour,
          minute,
          timeZone
        );
        if (epoch > now) {
          candidates.push({ ts: new Date(epoch).toISOString(), time: clock, item });
        }
      }
    }
  }
  candidates.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return candidates[0] || null;
}

async function readSchedulerState() {
  try {
    const raw = await fs.readFile(SCHEDULER_STATE_FILE, 'utf8');
    schedulerState = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('读取定时任务状态失败:', error.message);
    }
    schedulerState = {};
  }
}

async function saveSchedulerState() {
  const cutoff = Date.now() - 7 * 86400000;
  const lastRuns = {};
  for (const [key, value] of Object.entries(schedulerState.lastRuns || {})) {
    if (new Date(value).getTime() >= cutoff) lastRuns[key] = value;
  }
  const next = { lastRuns };
  const tempFile = `${SCHEDULER_STATE_FILE}.tmp`;
  await fs.mkdir(path.dirname(SCHEDULER_STATE_FILE), { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(tempFile, SCHEDULER_STATE_FILE);
}

async function performPush(kind, trigger = 'manual') {
  if (!config.wechat.webhook) {
    throw createError(400, '尚未配置企业微信机器人');
  }

  let content = '';
  let extra = { trigger };
  try {
    if (kind === 'poem') {
      const poem = await generatePoem(config);
      content = formatPoemMessage(poem);
      extra = { ...extra, title: poem.title };
    } else if (kind === 'brief') {
      let brief = await readBriefCache();
      if (!brief) brief = await generateBrief(config);
      content = formatBriefMessage(brief);
      extra = { ...extra, generatedAt: brief.generatedAt, aiUsed: brief.aiUsed };
    } else if (kind === 'test') {
      content = formatTestMessage(config);
      extra = { ...extra, test: true };
    } else {
      throw createError(400, '推送类型只能是 poem、brief 或 test');
    }

    await pushToWeChat(config.wechat.webhook, content);
    await appendLog({
      kind,
      ok: true,
      detail: trigger === 'scheduled' ? '定时推送成功' : '推送成功',
      extra,
    });
    return { ok: true, kind, ts: new Date().toISOString(), extra };
  } catch (error) {
    await appendLog({ kind, ok: false, detail: error.message, extra });
    throw error;
  }
}

async function runScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const scheduler = config.scheduler;
    if (
      !scheduler ||
      !scheduler.enabled ||
      !scheduler.times.length ||
      !scheduler.items.length ||
      !config.wechat.webhook
    ) {
      return;
    }

    const timeZone = scheduler.timezone || 'Asia/Shanghai';
    const now = zonedParts(new Date(), timeZone);
    const clock = `${pad2(now.hour)}:${pad2(now.minute)}`;
    if (!scheduler.times.includes(clock)) return;

    const dateKey = `${now.year}-${pad2(now.month)}-${pad2(now.day)}`;
    let changed = false;
    for (const item of scheduler.items) {
      const runKey = `${dateKey}|${clock}|${item}`;
      if (schedulerState.lastRuns?.[runKey]) continue;
      try {
        await performPush(item, 'scheduled');
        schedulerState.lastRuns = {
          ...(schedulerState.lastRuns || {}),
          [runKey]: new Date().toISOString(),
        };
        changed = true;
      } catch (error) {
        console.error(`定时推送失败 ${item}:`, error.message);
      }
    }
    if (changed) await saveSchedulerState();
  } catch (error) {
    console.error('定时任务执行异常:', error.message);
  } finally {
    schedulerRunning = false;
  }
}

function startScheduler() {
  runScheduler();
  setInterval(runScheduler, 30000);
}

function getPublicState() {
  const nextRun = nextSchedulerRun();
  return {
    needsSetup: !config.admin.passwordHash,
    webhookConfigured: Boolean(config.wechat.webhook),
    aiConfigured:
      Boolean(config.ai.enabled && config.ai.baseUrl && config.ai.apiKey && config.ai.model),
    poem: {
      source: config.poem.source,
      theme: config.poem.theme,
    },
    brief: {
      sources: config.brief.sources,
      perSource: config.brief.perSource,
      maxItems: config.brief.maxItems,
      aiConfigured:
        Boolean(config.ai.enabled && config.ai.baseUrl && config.ai.apiKey && config.ai.model),
    },
    scheduler: {
      enabled: Boolean(config.scheduler.enabled),
      timezone: config.scheduler.timezone,
      times: config.scheduler.times,
      items: config.scheduler.items,
      nextRun,
    },
    serverTime: new Date().toISOString(),
  };
}

function applySettings(next) {
  if (next.wechat && typeof next.wechat === 'object') {
    if (typeof next.wechat.webhook === 'string') {
      config.wechat.webhook = next.wechat.webhook.trim();
    }
  }

  if (next.ai && typeof next.ai === 'object') {
    if (typeof next.ai.enabled === 'boolean') config.ai.enabled = next.ai.enabled;
    if (typeof next.ai.baseUrl === 'string' && next.ai.baseUrl.trim()) {
      config.ai.baseUrl = next.ai.baseUrl.trim().replace(/\/+$/, '');
    }
    if (typeof next.ai.model === 'string' && next.ai.model.trim()) {
      config.ai.model = next.ai.model.trim();
    }
    if (typeof next.ai.apiKey === 'string' && next.ai.apiKey.trim()) {
      config.ai.apiKey = next.ai.apiKey.trim();
    }
    if (next.ai.clearApiKey === true) {
      config.ai.apiKey = '';
    }
  }

  if (next.poem && typeof next.poem === 'object') {
    if (typeof next.poem.source === 'string') {
      const allowed = ['jinrishici', 'ai', 'auto'];
      if (allowed.includes(next.poem.source)) config.poem.source = next.poem.source;
    }
    if (typeof next.poem.theme === 'string') {
      config.poem.theme = next.poem.theme.trim();
    }
  }

  if (next.brief && typeof next.brief === 'object') {
    if (Array.isArray(next.brief.sources)) {
      const valid = next.brief.sources.filter((id) => SOURCES[id]);
      if (valid.length > 0) config.brief.sources = valid;
    }
    if (Number.isFinite(next.brief.perSource)) {
      config.brief.perSource = Math.min(Math.max(1, Math.floor(next.brief.perSource)), 10);
    }
    if (Number.isFinite(next.brief.maxItems)) {
      config.brief.maxItems = Math.min(Math.max(1, Math.floor(next.brief.maxItems)), 50);
    }
    if (typeof next.brief.aiPrompt === 'string' && next.brief.aiPrompt.trim()) {
      config.brief.aiPrompt = next.brief.aiPrompt.trim();
    }
  }

  if (next.scheduler && typeof next.scheduler === 'object') {
    const candidate = {
      enabled: config.scheduler.enabled,
      timezone: config.scheduler.timezone,
      times: [...config.scheduler.times],
      items: [...config.scheduler.items],
    };

    if (typeof next.scheduler.enabled === 'boolean') {
      candidate.enabled = next.scheduler.enabled;
    }

    if (typeof next.scheduler.timezone === 'string' && next.scheduler.timezone.trim()) {
      const timezone = next.scheduler.timezone.trim();
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        throw createError(400, '时区设置无效');
      }
      candidate.timezone = timezone;
    }

    if (Array.isArray(next.scheduler.times)) {
      const times = next.scheduler.times
        .map(normalizeClock)
        .filter((value) => value)
        .filter((value, index, list) => list.indexOf(value) === index);
      candidate.times = times;
    }

    if (Array.isArray(next.scheduler.items)) {
      candidate.items = [...new Set(next.scheduler.items.filter((item) => ['poem', 'brief'].includes(item)))];
    }

    if (candidate.enabled && candidate.times.length === 0) {
      throw createError(400, '开启定时推送后至少需要一个推送时间');
    }
    if (candidate.enabled && candidate.items.length === 0) {
      throw createError(400, '请至少选择一种推送内容');
    }

    config.scheduler = candidate;
  }
}

function settingsView() {
  return {
    admin: {
      passwordSet: Boolean(config.admin.passwordHash),
    },
    wechat: {
      webhook: config.wechat.webhook,
    },
    ai: {
      enabled: config.ai.enabled,
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
      apiKeyMasked: maskSecret(config.ai.apiKey),
      hasKey: Boolean(config.ai.apiKey),
    },
    poem: {
      source: config.poem.source,
      theme: config.poem.theme,
    },
    brief: {
      sources: config.brief.sources,
      perSource: config.brief.perSource,
      maxItems: config.brief.maxItems,
      aiPrompt: config.brief.aiPrompt,
    },
    scheduler: {
      enabled: config.scheduler.enabled,
      timezone: config.scheduler.timezone,
      times: config.scheduler.times,
      items: config.scheduler.items,
    },
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, { ...getPublicState(), logs: await readLogs(8) });
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    return sendJson(res, 200, { logs: await readLogs(100) });
  }

  if (req.method === 'POST' && pathname === '/api/auth') {
    const body = await readJsonBody(req);
    if (!verifyPassword(body.password, config.admin.passwordHash)) {
      throw createError(401, '管理密码不正确');
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/settings/load') {
    const body = await readJsonBody(req);
    if (!verifyPassword(body.password, config.admin.passwordHash)) {
      throw createError(401, '管理密码不正确');
    }
    return sendJson(res, 200, settingsView());
  }

  if (req.method === 'POST' && pathname === '/api/settings') {
    const body = await readJsonBody(req);

    if (!config.admin.passwordHash) {
      const initialPassword = String(body.currentPassword || '');
      if (initialPassword.length < 4) {
        throw createError(400, '管理密码至少需要 4 位');
      }
      config.admin.passwordHash = hashPassword(initialPassword);
      applySettings(body.config || {});
      await saveConfig(config);
      return sendJson(res, 200, { ok: true, state: getPublicState() });
    }

    if (!verifyPassword(body.currentPassword, config.admin.passwordHash)) {
      throw createError(401, '当前管理密码不正确');
    }

    if (body.newPassword) {
      if (String(body.newPassword).length < 4) {
        throw createError(400, '新管理密码至少需要 4 位');
      }
      config.admin.passwordHash = hashPassword(String(body.newPassword));
    }

    applySettings(body.config || {});
    await saveConfig(config);
    return sendJson(res, 200, { ok: true, state: getPublicState() });
  }

  if (req.method === 'POST' && pathname === '/api/poem') {
    const poem = await generatePoem(config);
    return sendJson(res, 200, poem);
  }

  if (req.method === 'GET' && pathname === '/api/poem') {
    const poem = await generatePoem(config);
    return sendJson(res, 200, poem);
  }

  if (req.method === 'GET' && pathname === '/api/brief') {
    const brief = await readBriefCache();
    if (!brief) {
      throw createError(404, '还没有生成科技简报，请先点击“获取简报”');
    }
    return sendJson(res, 200, brief);
  }

  if (req.method === 'POST' && pathname === '/api/brief/refresh') {
    const brief = await generateBrief(config);
    return sendJson(res, 200, brief);
  }

  if (req.method === 'POST' && pathname === '/api/push') {
    const body = await readJsonBody(req);
    const kind = body.kind;
    if (!['poem', 'brief', 'test'].includes(kind)) {
      throw createError(400, '推送类型只能是 poem、brief 或 test');
    }
    return sendJson(res, 200, await performPush(kind));
  }

  throw createError(404, '接口不存在');
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname || '/');
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (
    filePath !== PUBLIC_DIR &&
    !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)
  ) {
    throw createError(403, '禁止访问');
  }

  let target = filePath;
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    throw createError(404, '文件不存在');
  }

  const data = await fs.readFile(target);
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

let config;

async function main() {
  config = await loadConfig();
  await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
  await readSchedulerState();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else {
        await serveStatic(req, res, url);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}]`, req.method, req.url, error.message);
      if (!res.headersSent) {
        sendJson(res, error.statusCode || 500, { message: error.message || '服务器错误' });
      } else {
        res.end();
      }
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`云笺服务已启动: http://localhost:${PORT}`);
    console.log(`监听地址: ${HOST}:${PORT}`);
    startScheduler();
  });
}

main();
