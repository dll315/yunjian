const fs = require('fs');

async function main() {
  const ai = JSON.parse(fs.readFileSync('data/config.json', 'utf8')).ai;
  const messages = [
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
        '额外要求：精炼新闻内容，去除无关信息，只保留汉语',
        '',
        '以下是今天抓取到的资讯 JSON：',
        JSON.stringify([
          { title: '测试标题一', summary: '测试摘要一' },
          { title: '测试标题二', summary: '测试摘要二' },
        ]),
        '',
        '现在开始整理，只输出 Markdown 正文。',
      ].join('\n'),
    },
  ];

  const started = Date.now();
  const response = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: 8000,
      messages,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const text = await response.text();
  console.log('status:', response.status, 'elapsed:', ((Date.now() - started) / 1000).toFixed(1) + 's');
  if (!response.ok) {
    console.log(text.slice(0, 1000));
    return;
  }
  const data = JSON.parse(text);
  const choice = data.choices?.[0];
  const content = String(choice?.message?.content || '');
  console.log('finish_reason:', choice?.finish_reason);
  console.log('usage:', JSON.stringify(data.usage));
  console.log('content length:', content.length);
  console.log('content first 300:', JSON.stringify(content.slice(0, 300)));
  console.log('contains 科技简报:', content.includes('科技简报'));
  const idx = content.indexOf('科技简报');
  if (idx >= 0) {
    console.log('around head:', JSON.stringify(content.slice(Math.max(0, idx - 120), idx + 240)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
