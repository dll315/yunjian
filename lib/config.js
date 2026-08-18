const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

const DEFAULTS = {
  admin: {
    passwordHash: '',
  },
  wechat: {
    webhook: '',
  },
  ai: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  poem: {
    source: 'jinrishici',
    theme: '',
  },
  brief: {
    sources: ['hackernews', 'github', 'solidot', 'sspai'],
    perSource: 5,
    maxItems: 14,
    aiPrompt:
      '请用中文整理一份简洁的科技简报，输出 Markdown。分 6-8 条要点，每条格式为：- **标题** - 一句话中文摘要（来源）。优先挑选有技术价值、值得阅读的条目，去掉重复内容。',
  },
  scheduler: {
    enabled: false,
    timezone: 'Asia/Shanghai',
    times: ['09:00'],
    items: ['poem', 'brief'],
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, extra) {
  const result = structuredClone(base);
  if (!isPlainObject(extra)) return result;
  for (const [key, value] of Object.entries(extra)) {
    if (isPlainObject(value)) {
      result[key] = deepMerge(result[key] || {}, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('读取配置失败，使用默认配置:', error.message);
    }
    return structuredClone(DEFAULTS);
  }
}

async function saveConfig(next) {
  const tempFile = `${CONFIG_FILE}.tmp`;
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(tempFile, CONFIG_FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .createHash('sha256')
    .update(`${salt}:${password}`)
    .digest('hex');
  return `${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const [salt, hash] = String(storedHash).split('$');
  if (!salt || !hash) return false;
  const candidate = crypto
    .createHash('sha256')
    .update(`${salt}:${password}`)
    .digest('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function maskSecret(value, keep = 4) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= keep * 2) return `${'*'.repeat(Math.min(text.length, 8))}`;
  return `${text.slice(0, keep)}...${text.slice(-keep)}`;
}

module.exports = {
  DEFAULTS,
  deepMerge,
  loadConfig,
  saveConfig,
  hashPassword,
  verifyPassword,
  maskSecret,
};
