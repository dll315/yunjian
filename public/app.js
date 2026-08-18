(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  let state = null;
  let adminPassword = '';
  let settingsLoaded = false;
  let setupMode = false;
  let toastTimer = null;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new Error(data.message || `请求失败（${response.status}）`);
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function toast(message, type = 'ok') {
    const el = $('#toast');
    el.textContent = message;
    el.classList.remove('hidden', 'error');
    if (type === 'error') el.classList.add('error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function timeShort(ts) {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function formatDate(ts) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  }

  function renderStatus() {
    $('#webhookBadge').textContent = state.webhookConfigured ? '机器人已配置' : '机器人未配置';
    $('#webhookBadge').className = `badge ${state.webhookConfigured ? 'badge-ok' : 'badge-muted'}`;
    $('#aiBadge').textContent = state.aiConfigured ? 'AI 已配置' : 'AI 未配置';
    $('#aiBadge').className = `badge ${state.aiConfigured ? 'badge-ok' : 'badge-muted'}`;
    renderSchedulerSummary();
  }

  function renderSchedulerSummary() {
    const scheduler = state?.scheduler || {};
    const badge = $('#schedulerBadge');
    badge.textContent = scheduler.enabled ? '定时推送已开启' : '定时推送未开启';
    badge.className = `badge ${scheduler.enabled ? 'badge-ok' : 'badge-muted'}`;

    const nextEl = $('#schedulerNext');
    if (!nextEl) return;
    const itemNames = { poem: '古诗词', brief: '科技简报' };
    if (scheduler.enabled && scheduler.nextRun) {
      const text = `下次 ${scheduler.nextRun.time} 推送${itemNames[scheduler.nextRun.item] || scheduler.nextRun.item}`;
      nextEl.textContent = text;
      badge.title = text;
    } else if (scheduler.enabled) {
      const text = '今天的时间已过，从明天开始生效';
      nextEl.textContent = text;
      badge.title = text;
    } else {
      nextEl.textContent = '尚未设置推送时间';
      badge.title = '';
    }
  }

  function addTimeRow(value = '09:00') {
    const list = $('#schedulerTimes');
    const row = document.createElement('div');
    row.className = 'time-row';

    const input = document.createElement('input');
    input.type = 'time';
    input.className = 'scheduler-time';
    input.value = value;
    input.setAttribute('aria-label', '推送时间');
    row.appendChild(input);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn icon-btn-sm';
    remove.setAttribute('aria-label', '删除时间');
    remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.addEventListener('click', () => {
      row.remove();
      if (list.children.length === 0) addTimeRow('09:00');
      refreshIcons();
    });
    row.appendChild(remove);
    list.appendChild(row);
    refreshIcons();
  }

  function renderTimeRows(times) {
    const list = $('#schedulerTimes');
    list.innerHTML = '';
    const values = times && times.length ? times : ['09:00'];
    values.forEach((value) => addTimeRow(value));
  }

  function ensureSchedulerTimes() {
    if ($('#schedulerTimes').children.length === 0) addTimeRow('09:00');
  }

  function toggleSchedulerOptions() {
    $('#schedulerOptions').classList.toggle('disabled', !$('#schedulerEnabled').checked);
  }

  function renderLogs(logs) {
    const list = $('#logList');
    const kinds = { poem: '诗词', brief: '简报', test: '测试' };
    if (!logs || logs.length === 0) {
      list.innerHTML = '<li class="log-empty">还没有推送记录</li>';
      return;
    }
    list.innerHTML = logs
      .map(
        (log) => `
          <li class="log-item">
            <span class="dot ${log.ok ? 'dot-ok' : 'dot-err'}"></span>
            <span class="log-kind">${kinds[log.kind] || escapeHtml(log.kind)}</span>
            <span class="log-detail" title="${escapeHtml(log.detail)}">${escapeHtml(log.detail)}</span>
            <time>${timeShort(log.ts)}</time>
          </li>`
      )
      .join('');
  }

  function renderPoem(poem) {
    $('#poemTitle').textContent = poem.title;
    $('#poemAuthor').textContent = [poem.author, poem.category || '', poem.source || '']
      .filter(Boolean)
      .join(' · ');
    $('#poemText').innerHTML = String(poem.content || '')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => `<span class="poem-line">${escapeHtml(line)}</span>`)
      .join('');
    $('#poemSource').textContent = `来源：${poem.source || '-'}`;
    $('#poemTime').textContent = `取于 ${timeShort(new Date())}`;
  }

  async function fetchPoem() {
    const btn = $('#refreshPoemBtn');
    const text = $('#poemText');
    btn.disabled = true;
    btn.querySelector('span').textContent = '取诗中';
    text.innerHTML = '<span class="poem-loading">正在取诗…</span>';
    try {
      const poem = await api('/api/poem', { method: 'POST' });
      renderPoem(poem);
    } catch (error) {
      text.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = '换一首';
    }
  }

  function renderMarkdown(text) {
    const lines = String(text || '').split('\n');
    let out = '';
    let listOpen = false;

    const closeList = () => {
      if (listOpen) {
        out += '</ul>';
        listOpen = false;
      }
    };

    const inline = (value) => {
      let html = escapeHtml(value);
      html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
      );
      return html;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        closeList();
        out += '<div class="md-gap"></div>';
        continue;
      }
      if (/^###\s+/.test(line)) {
        closeList();
        out += `<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`;
      } else if (/^##\s+/.test(line)) {
        closeList();
        out += `<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`;
      } else if (/^#\s+/.test(line)) {
        closeList();
        out += `<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`;
      } else if (/^[-*]\s+/.test(line) || /^\d+[.、]\s+/.test(line)) {
        if (!listOpen) {
          out += '<ul>';
          listOpen = true;
        }
        out += `<li>${inline(line.replace(/^[-*]\s+/, '').replace(/^\d+[.、]\s+/, ''))}</li>`;
      } else if (/^>\s?/.test(line)) {
        closeList();
        out += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`;
      } else {
        closeList();
        out += `<p>${inline(line)}</p>`;
      }
    }
    closeList();
    return out;
  }

  function renderBrief(brief) {
    if (!brief) return;
    $('#briefBody').innerHTML = renderMarkdown(brief.content || brief.raw);
    const meta = [
      `生成于 ${formatDate(brief.generatedAt)}`,
      brief.aiUsed ? 'AI 整理' : '原始摘要',
      `来源：${(brief.sources || []).join(' / ')}`,
    ];
    $('#briefMeta').innerHTML = meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('');
  }

  async function refreshBrief() {
    const btn = $('#refreshBriefBtn');
    const body = $('#briefBody');
    btn.disabled = true;
    btn.querySelector('span').textContent = '整理中';
    body.innerHTML = '<div class="loading-state"><i data-lucide="loader-circle"></i><span>正在抓取并整理资讯…</span></div>';
    refreshIcons();
    try {
      const brief = await api('/api/brief/refresh', { method: 'POST' });
      renderBrief(brief);
    } catch (error) {
      body.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
      $('#briefMeta').innerHTML = '';
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = '获取简报';
    }
  }

  async function loadBriefCache() {
    try {
      const brief = await api('/api/brief');
      renderBrief(brief);
    } catch {
      // 尚未生成简报时保持空状态
    }
  }

  async function push(kind) {
    const mapping = {
      poem: { btn: $('#pushPoemBtn'), label: '推送中' },
      brief: { btn: $('#pushBriefBtn'), label: '推送中' },
      test: { btn: $('#testPushBtn'), label: '发送中' },
    };
    const target = mapping[kind];
    if (!target) return;
    const span = target.btn.querySelector('span');
    target.btn.disabled = true;
    span.textContent = target.label;
    try {
      await api('/api/push', { method: 'POST', body: JSON.stringify({ kind }) });
      toast('推送成功');
      const result = await api('/api/logs');
      renderLogs(result.logs);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      target.btn.disabled = false;
      span.textContent = kind === 'test' ? '发送测试' : '推送';
    }
  }

  function renderSettingsGate() {
    const locked = !setupMode && !settingsLoaded;
    $('#settingsBody').classList.toggle('hidden', locked);
    $('#unlockRow').classList.toggle('hidden', !setupMode && settingsLoaded);
    $('#unlockBtn').classList.toggle('hidden', setupMode || settingsLoaded);
    $('#newPasswordField').classList.toggle('hidden', setupMode || !settingsLoaded);
    $('#passwordLabel').textContent = setupMode
      ? '初始化管理密码（至少 4 位）'
      : settingsLoaded
        ? '管理密码已解锁'
        : '当前管理密码';
  }

  function populateSettings(settings) {
    $('#webhook').value = settings.wechat.webhook || '';
    $('#aiEnabled').checked = Boolean(settings.ai.enabled);
    $('#aiBaseUrl').value = settings.ai.baseUrl || '';
    $('#aiModel').value = settings.ai.model || '';
    $('#aiKey').value = '';
    $('#aiKey').placeholder = settings.ai.hasKey ? `已保存：${settings.ai.apiKeyMasked}` : 'sk-...';
    $('#poemSource').value = settings.poem.source || 'jinrishici';
    $('#poemTheme').value = settings.poem.theme || '';
    $$('input[name="briefSource"]').forEach((input) => {
      input.checked = (settings.brief.sources || []).includes(input.value);
    });
    $('#perSource').value = settings.brief.perSource || 5;
    $('#maxItems').value = settings.brief.maxItems || 14;
    $('#aiPrompt').value = settings.brief.aiPrompt || '';
    $('#schedulerEnabled').checked = Boolean(settings.scheduler.enabled);
    $('#schedulerTimezone').value = settings.scheduler.timezone || 'Asia/Shanghai';
    renderTimeRows(settings.scheduler.times || []);
    $$('input[name="schedulerItem"]').forEach((input) => {
      input.checked = (settings.scheduler.items || []).includes(input.value);
    });
    toggleSchedulerOptions();
    renderSchedulerSummary();
  }

  function collectConfig() {
    const sources = $$('input[name="briefSource"]:checked').map((input) => input.value);
    if (sources.length === 0) {
      toast('请至少选择一个科技简报来源', 'error');
      return null;
    }
    const apiKeyValue = $('#aiKey').value.trim();
    const schedulerEnabled = $('#schedulerEnabled').checked;
    const schedulerTimes = $$('.scheduler-time')
      .map((input) => input.value.trim())
      .filter(Boolean);
    const schedulerItems = $$('input[name="schedulerItem"]:checked').map((input) => input.value);
    if (schedulerEnabled && schedulerTimes.length === 0) {
      toast('请至少添加一个推送时间', 'error');
      return null;
    }
    if (schedulerEnabled && schedulerItems.length === 0) {
      toast('请至少选择一种推送内容', 'error');
      return null;
    }
    return {
      wechat: { webhook: $('#webhook').value.trim() },
      ai: {
        enabled: $('#aiEnabled').checked,
        baseUrl: $('#aiBaseUrl').value.trim(),
        model: $('#aiModel').value.trim(),
        ...(apiKeyValue ? { apiKey: apiKeyValue } : {}),
      },
      poem: {
        source: $('#poemSource').value,
        theme: $('#poemTheme').value.trim(),
      },
      brief: {
        sources,
        perSource: Number($('#perSource').value) || 5,
        maxItems: Number($('#maxItems').value) || 14,
        aiPrompt: $('#aiPrompt').value.trim(),
      },
      scheduler: {
        enabled: schedulerEnabled,
        timezone: $('#schedulerTimezone').value.trim() || 'Asia/Shanghai',
        times: schedulerTimes,
        items: schedulerItems,
      },
    };
  }

  async function unlockSettings() {
    const password = $('#currentPassword').value.trim();
    if (!password) {
      toast('请输入管理密码', 'error');
      return;
    }
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ password }) });
      const settings = await api('/api/settings/load', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      adminPassword = password;
      settingsLoaded = true;
      setupMode = false;
      populateSettings(settings);
      renderSettingsGate();
      toast('设置已解锁');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const payload = {};
    if (setupMode) {
      const initialPassword = $('#currentPassword').value.trim();
      if (initialPassword.length < 4) {
        toast('管理密码至少需要 4 位', 'error');
        return;
      }
      payload.currentPassword = initialPassword;
    } else {
      if (!adminPassword) {
        toast('请先解锁设置', 'error');
        return;
      }
      payload.currentPassword = adminPassword;
      const newPassword = $('#newPassword').value.trim();
      if (newPassword) payload.newPassword = newPassword;
    }

    const config = collectConfig();
    if (!config) return;
    payload.config = config;

    const btn = $('#saveSettingsBtn');
    const span = btn.querySelector('span');
    btn.disabled = true;
    span.textContent = '保存中';
    try {
      const result = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
      adminPassword = payload.newPassword || payload.currentPassword;
      state = result.state || state;
      setupMode = Boolean(state.needsSetup);
      settingsLoaded = true;
      $('#newPassword').value = '';
      renderStatus();
      renderSettingsGate();
      toast('配置已保存');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
      span.textContent = '保存配置';
    }
  }

  function openSettings() {
    const drawer = $('#settingsDrawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    $('#drawerBackdrop').classList.remove('hidden');
    document.body.classList.add('no-scroll');
    ensureSchedulerTimes();
    toggleSchedulerOptions();
    renderSettingsGate();
  }

  function closeSettings() {
    const drawer = $('#settingsDrawer');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    $('#drawerBackdrop').classList.add('hidden');
    document.body.classList.remove('no-scroll');
  }

  function toggleApiKey() {
    const input = $('#aiKey');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    $('#toggleKeyBtn').textContent = isPassword ? '隐藏' : '显示';
  }

  async function loadState() {
    state = await api('/api/state');
    setupMode = Boolean(state.needsSetup);
    renderStatus();
    renderLogs(state.logs || []);
  }

  function bindEvents() {
    $('#refreshPoemBtn').addEventListener('click', fetchPoem);
    $('#pushPoemBtn').addEventListener('click', () => push('poem'));
    $('#refreshBriefBtn').addEventListener('click', refreshBrief);
    $('#pushBriefBtn').addEventListener('click', () => push('brief'));
    $('#openSettingsBtn').addEventListener('click', openSettings);
    $('#closeSettingsBtn').addEventListener('click', closeSettings);
    $('#drawerBackdrop').addEventListener('click', closeSettings);
    $('#unlockBtn').addEventListener('click', unlockSettings);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#testPushBtn').addEventListener('click', () => push('test'));
    $('#toggleKeyBtn').addEventListener('click', toggleApiKey);
    $('#addTimeBtn').addEventListener('click', () => addTimeRow());
    $('#schedulerEnabled').addEventListener('change', toggleSchedulerOptions);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSettings();
    });
  }

  async function boot() {
    bindEvents();
    try {
      await Promise.all([loadState(), loadBriefCache()]);
      await fetchPoem();
    } catch (error) {
      toast(`初始化失败：${error.message}`, 'error');
    }
    refreshIcons();
  }

  boot();
})();
