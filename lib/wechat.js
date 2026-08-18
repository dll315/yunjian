const { formatDate } = require('./brief');

function truncateContent(text, maxBytes = 3900) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const footer = '\n\n[内容过长，已截断]';
  const limit = Math.max(80, maxBytes - Buffer.byteLength(footer, 'utf8'));
  let low = 0;
  let high = text.length;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= limit) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, best)}${footer}`;
}

function formatPoemMessage(poem) {
  const lines = [
    `## 诗词推送 · ${formatDate(new Date())}`,
    '',
    `**${poem.title}**`,
    poem.author ? `作者：${poem.author}` : '',
    '',
    '>',
    ...String(poem.content)
      .split('\n')
      .map((line) => `> ${line}`),
    '',
    `来源：${poem.source}`,
  ];
  return truncateContent(lines.filter(Boolean).join('\n'));
}

function formatBriefMessage(brief) {
  const lines = [
    `## 科技简报 · ${formatDate(new Date(brief.generatedAt))}`,
    '',
    brief.content,
  ];
  return truncateContent(lines.join('\n'));
}

function formatTestMessage(config) {
  const aiReady = Boolean(config.ai?.apiKey && config.ai?.baseUrl && config.ai?.model);
  return [
    '## 云笺推送测试',
    '',
    `时间：${formatDate(new Date())}`,
    `企业微信机器人：已连接`,
    `AI 整理简报：${aiReady ? '已配置' : '未配置'}`,
    `诗词来源：${config.poem?.source === 'ai' ? 'AI 创作' : config.poem?.source === 'auto' ? '自动（优先 AI）' : '今日诗词'}`,
  ].join('\n');
}

async function pushToWeChat(webhook, content) {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'yunjian/1.0',
    },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content },
    }),
    signal: AbortSignal.timeout(20000),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { errcode: -1, errmsg: text.slice(0, 200) };
  }

  if (!response.ok || data.errcode !== 0) {
    throw new Error(data.errmsg || `企业微信接口返回 ${response.status}`);
  }
  return data;
}

module.exports = {
  formatPoemMessage,
  formatBriefMessage,
  formatTestMessage,
  pushToWeChat,
};
