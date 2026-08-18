async function callChatCompletion(aiConfig, messages) {
  const baseUrl = String(aiConfig.baseUrl || '').replace(/\/+$/, '');
  const model = aiConfig.model || 'gpt-4o-mini';
  const apiKey = aiConfig.apiKey || '';

  if (!baseUrl || !apiKey) {
    throw new Error('AI 配置不完整：需要 baseUrl 和 apiKey');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'yunjian/1.0',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 8000,
      messages,
    }),
    signal: AbortSignal.timeout(180000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AI 接口返回 ${response.status}: ${text.slice(0, 240)}`);
  }

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI 接口没有返回可用的内容');
  }
  return String(content).trim();
}

module.exports = { callChatCompletion };
