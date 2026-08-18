const { callChatCompletion } = require('./ai');

const USER_AGENT = 'yunjian/1.0 (poem)';

const THEMES = [
  '春日',
  '秋夜',
  '山居',
  '江舟',
  '月下',
  '边塞',
  '田园',
  '赠别',
  '登高',
  '怀古',
  '夜雨',
  '闲适',
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function cleanText(text) {
  return String(text || '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchFromJinrishici() {
  const response = await fetch('https://v1.jinrishici.com/all.json', {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`今日诗词接口返回 ${response.status}`);
  }

  const data = await response.json();
  const content = cleanText(data.content);
  if (!content) {
    throw new Error('今日诗词接口没有返回诗句');
  }

  return {
    title: cleanText(data.origin) || '无名',
    author: cleanText(data.author) || '佚名',
    content,
    category: cleanText(data.category) || '',
    source: '今日诗词',
  };
}

function parseAiPoem(output, model) {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  let title = '';
  let contentLines = [];
  let inBody = false;

  for (const line of lines) {
    const titleMatch = line.match(/^标题[：:]\s*(.+)/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    if (/^正文[：:]?$/.test(line) || /^诗句[：:]?$/.test(line)) {
      inBody = true;
      continue;
    }
    if (/^(赏析|注释|解析|译文)[：:]?/.test(line)) {
      inBody = false;
      continue;
    }
    if (inBody && line && !/^作者[：:]/.test(line)) {
      contentLines.push(line.replace(/^[0-9]+[.、]?/, '').trim());
    }
  }

  if (!title) {
    const firstLine = contentLines[0] || output.split(/\r?\n/)[0] || '无题';
    title = firstLine.replace(/[，。！？；：,.!?;:]/g, '').slice(0, 16) || '无题';
  }
  if (contentLines.length === 0) {
    contentLines = output
      .split(/\r?\n/)
      .filter((line) => line.trim() && !/^标题[：:]/.test(line))
      .map((line) => line.trim());
  }

  return {
    title,
    author: `AI · ${model || '创作'}`,
    content: contentLines.join('\n') || output.slice(0, 200),
    category: 'AI 原创',
    source: 'AI 创作',
  };
}

async function createAiPoem(poemConfig, aiConfig) {
  const theme = poemConfig.theme || pickRandom(THEMES);
  const prompt = `请写一首主题为「${theme}」的原创古诗词，可以是绝句、律诗或词牌。
要求：意境自然，用典克制，避免直白的现代语；每句一行，不要出现空行。
输出格式严格如下：
标题：起一个合适的题目
正文：
第一句
第二句
第三句
第四句`;

  const output = await callChatCompletion(aiConfig, [
    {
      role: 'system',
      content: '你是一位功底扎实、风格含蓄的中国古典诗词创作者，只输出诗词本身。',
    },
    { role: 'user', content: prompt },
  ]);

  return parseAiPoem(output, aiConfig.model);
}

async function generatePoem(config) {
  const poemConfig = config.poem || {};
  const aiReady =
    config.ai?.enabled && config.ai?.apiKey && config.ai?.baseUrl && config.ai?.model;
  const source = poemConfig.source || 'auto';

  if (source === 'ai' || (source === 'auto' && aiReady)) {
    try {
      return await createAiPoem(poemConfig, config.ai);
    } catch (error) {
      if (source === 'ai') throw error;
      console.error('AI 作诗失败，回退到今日诗词:', error.message);
    }
  }

  return fetchFromJinrishici();
}

module.exports = { generatePoem, pickRandom };
