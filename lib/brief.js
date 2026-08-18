const fs = require('fs/promises');
const path = require('path');
const { callChatCompletion } = require('./ai');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'brief-cache.json');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) yunjian/1.0';

const SOURCES = {
  hackernews: { label: 'Hacker News', type: 'hn' },
  github: { label: 'GitHub 新星', type: 'github' },
  solidot: { label: '奇客 Solidot', type: 'rss', url: 'https://www.solidot.org/index.rss' },
  sspai: { label: '少数派', type: 'rss', url: 'https://sspai.com/feed' },
  infoq: { label: 'InfoQ', type: 'rss', url: 'https://www.infoq.cn/feed' },
};

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeEntities(
    String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

function parseFeed(xml) {
  const items = [];
  const itemPattern = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];
    const title = stripHtml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    const hrefLink = (block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1];
    const textLink = stripHtml((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]);
    const description = stripHtml(
      (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] ||
        (block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i) || [])[1] ||
        (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1]
    );
    const pubDate = stripHtml(
      (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] ||
        (block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1] ||
        (block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i) || [])[1]
    );

    if (title) {
      items.push({
        title,
        url: hrefLink || textLink || '',
        summary: description.slice(0, 140),
        pubDate,
      });
    }
  }
  return items;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchHackerNews(limit) {
  const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
  const selectedIds = ids.slice(0, Math.max(limit * 3, 15));
  const items = await Promise.all(
    selectedIds.map(async (id) => {
      const item = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return {
        title: item.title || '',
        url: item.url || `https://news.ycombinator.com/item?id=${id}`,
        summary: `${item.score || 0} 分，${item.descendants || 0} 条讨论`,
        pubDate: new Date((item.time || 0) * 1000).toISOString(),
        score: item.score || 0,
      };
    })
  );
  return items
    .filter((item) => item.title)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function fetchGitHub(limit) {
  const since = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const data = await fetchJson(
    `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=30`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  return (data.items || []).slice(0, limit).map((repo) => ({
    title: repo.full_name,
    url: repo.html_url,
    summary: [
      stripHtml(repo.description) || '暂无简介',
      repo.language ? `语言 ${repo.language}` : '',
      `${repo.stargazers_count} stars`,
    ]
      .filter(Boolean)
      .join(' · '),
    pubDate: repo.created_at || '',
  }));
}

async function fetchRssSource(source, limit) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const xml = await response.text();
  return parseFeed(xml).slice(0, limit);
}

async function fetchSource(sourceId, limit) {
  const source = SOURCES[sourceId];
  if (source.type === 'hn') return fetchHackerNews(limit);
  if (source.type === 'github') return fetchGitHub(limit);
  return fetchRssSource(source, limit);
}

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function renderBrief(groups, generatedAt, errors) {
  const lines = [`# 科技简报 · ${formatDate(new Date(generatedAt))}`, ''];
  for (const group of groups) {
    lines.push(`## ${group.label}`, '');
    for (const item of group.items) {
      lines.push(`- **${item.title}**`);
      if (item.summary) lines.push(`  ${item.summary}`);
      if (item.url) lines.push(`  ${item.url}`);
      lines.push('');
    }
  }
  if (errors.length) {
    lines.push(`> 部分来源暂不可用：${errors.join('；')}`, '');
  }
  return lines.join('\n').trim();
}

async function generateBrief(config) {
  const settings = config.brief || {};
  const enabledSources = (settings.sources || Object.keys(SOURCES)).filter(
    (id) => SOURCES[id]
  );
  const results = await Promise.allSettled(
    enabledSources.map((id) => fetchSource(id, settings.perSource || 5))
  );

  const groups = [];
  const errors = [];
  results.forEach((result, index) => {
    const sourceId = enabledSources[index];
    if (result.status === 'rejected') {
      errors.push(`${SOURCES[sourceId].label}: ${result.reason?.message || '获取失败'}`);
      return;
    }
    groups.push({
      id: sourceId,
      label: SOURCES[sourceId].label,
      items: result.value.slice(0, settings.maxItems || 14),
    });
  });

  const allItems = groups.flatMap((group) => group.items);
  if (allItems.length === 0) {
    throw new Error(`科技资讯获取失败：${errors.join('；')}`);
  }

  const generatedAt = new Date().toISOString();
  const rawBrief = renderBrief(groups, generatedAt, errors);
  let aiUsed = false;
  let content = rawBrief;

  if (config.ai?.enabled && config.ai?.apiKey && config.ai?.baseUrl && config.ai?.model) {
    try {
      const rawAiContent = await callChatCompletion(config.ai, [
        {
          role: 'system',
          content:
            '你是严谨的中文科技编辑，擅长把新闻提炼成易读的简报。回答中只输出最终 Markdown 简报正文，绝对不要输出思考过程、解析说明、开场白或任何额外解释。',
        },
        {
          role: 'user',
          content: [
            '任务是整理一份科技简报，最终回复必须符合以下格式：',
            '第一行是“# 科技简报”，之后按条目输出，风格简洁紧凑，可直接发送到企业微信群机器人。',
            `额外要求：${settings.aiPrompt || DEFAULT_AI_PROMPT}`,
            '',
            '以下是今天抓取到的资讯 JSON：',
            JSON.stringify(allItems),
            '',
            '现在开始整理，只输出 Markdown 正文。',
          ].join('\n'),
        },
      ]);
      content = cleanAiBrief(rawAiContent);
      aiUsed = true;
    } catch (error) {
      const aiError = String(error.message || error || '未知错误').split('\n')[0];
      console.error('AI 整理简报失败，使用原始摘要:', aiError);
      content = `${rawBrief}\n\n> AI 整理失败（${aiError}），已使用原始摘要。`;
    }
  }

  const brief = {
    content,
    generatedAt,
    aiUsed,
    sources: groups.map((group) => group.label),
    raw: rawBrief,
    errors,
  };
  await writeBriefCache(brief);
  return brief;
}

const DEFAULT_AI_PROMPT = '请用中文整理一份简洁的科技简报，输出 Markdown。分 6-8 条要点，每条格式为：- **标题** - 一句话中文摘要（来源）。优先挑选有技术价值、值得阅读的条目，去掉重复内容。';

function cleanAiBrief(content) {
  const original = String(content || '').trim();
  if (!original) return original;

  let text = original
    .replace(/^\uFEFF/, '')
    .replace(/(?:^|\n)\s*(?:思考过程|思考|解析|分析|说明|解释)[：:].*?(?=\n\s*(?:#|[-*]|$))/gs, '\n')
    .trim();

  const headingMatch = text.match(/^#{1,3}\s*科技简报\b/m);
  if (headingMatch) {
    return text.slice(headingMatch.index).trim();
  }

  const resultMarker = text.match(/(?:^|\n)\s*(?:简报|结果|整理结果|如下)[：:]?\s*\n/);
  if (resultMarker) {
    const candidate = text.slice(resultMarker.index + resultMarker[0].length).trim();
    if (candidate && !/^(?:好的|以下是|上面|如上|ok|好的)/i.test(candidate)) {
      return candidate.replace(/\s*---+\s*$/, '').trim();
    }
  }

  const sourcePattern = /^(?:Hacker News|GitHub|奇客 Solidot|少数派|InfoQ)/m;
  const sourceMatch = text.search(sourcePattern);
  if (sourceMatch > 0) {
    const candidate = text.slice(sourceMatch).trim();
    if (candidate) return candidate.replace(/\s*---+\s*$/, '').trim();
  }

  return original.replace(/\s*---+\s*$/, '').trim();
}

async function readBriefCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeBriefCache(brief) {
  const tempFile = `${CACHE_FILE}.tmp`;
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(brief, null, 2), 'utf8');
  await fs.rename(tempFile, CACHE_FILE);
}

module.exports = {
  SOURCES,
  generateBrief,
  readBriefCache,
  writeBriefCache,
  formatDate,
};
