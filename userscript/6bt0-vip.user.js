// ==UserScript==
// @name         6bt0（不太灵） 网盘直链导出
// @namespace    https://github.com/Yanqing797/6bt0-unlock
// @version      1.5.5
// @description  6bt0 / 0bt0~9bt0 网盘直链导出 + 最新资源列表批量下载
// @author       Yanqing
// @homepageURL  https://github.com/Yanqing797/6bt0-unlock
// @supportURL   https://github.com/Yanqing797/6bt0-unlock/issues
// @updateURL    https://raw.githubusercontent.com/Yanqing797/6bt0-unlock/main/userscript/6bt0-vip.user.js
// @downloadURL  https://raw.githubusercontent.com/Yanqing797/6bt0-unlock/main/userscript/6bt0-vip.user.js
// @license      MIT
// @match        *://*.6bt0.com/*
// @include      /^https?:\/\/([\w-]+\.)?([0-9]bt0)\.[a-z]{2,}\//
// @match        *://*.butailing.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  // 先把旧版面板干掉（旧版没有「导出全部页链接」按钮），再决定要不要继续
  var __stale = document.getElementById('unlock-panel');
  if (__stale && !__stale.querySelector('#unlock-tlist-all')) {
    __stale.remove();
    window.__6bt0UnlockLoaded = false;
  }
  if (window.__6bt0UnlockLoaded) return;
  window.__6bt0UnlockLoaded = true;

  /* ────────────────────────── 常量 ────────────────────────── */
  const FIX = { app_id: '83768d9ad4', identity: '23734adac0301bccdcb107c4aa21f96c' };
  const API = '/prod/api/v1/';
  const TYPE_NAME = {
    ali: '阿里云盘', quark: '夸克', xunlei: '迅雷', baidu: '百度', '115': '115',
    guangya: '光鸭', yidong: '移动云盘', uc: 'UC', '123': '123网盘', other: '其他',
  };
  const LS_TOKEN = 'token';
  const LS_ACC = '6bt0_unlock_account';
  const PREFIX = 'unlock-';  // 注意：class 名不能带冒号，否则 CSS 选择器失效

  /* ────────────────────────── 工具 ────────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeHref = (u) => {
    try {
      const x = new URL(String(u || ''), location.href);
      return /^(https?|magnet):$/.test(x.protocol) ? x.href : '';
    } catch { return ''; }
  };
  const isVip = (u) => !!u && (Number(u.is_vip) === 2 || Number(u.is_permanent_vip) === 1
    || String(u.vip_type) === '4');
  const $ = (sel, root = document) => root.querySelector(sel);
  const tok = () => localStorage.getItem(LS_TOKEN) || '';
  const randId = () => 'u' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 4);
  const randPw = () => 'Kq' + Math.random().toString(36).slice(2, 10) + '!9';

  function toast(msg, kind, ms) {
    const el = document.createElement('div');
    el.className = 'unlock-toast ' + (kind || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, ms || 2600);
  }

  function logStep(p) {
    const box = $('#unlock-progress');
    if (box) box.textContent = p;
  }

  /* ────────────────────────── 反检测：节流 / 配额 ────────────────────────── */
  const LS_BUDGET = '6bt0_unlock_budget';
  const LS_LASTREG = '6bt0_unlock_lastreg';
  const HOURLY_BUDGET = 120;          // 每小时最多 120 次接口调用
  const jitter = () => sleep(200 + Math.random() * 500);

  function budget() {
    const now = Date.now();
    let b = {};
    try { b = JSON.parse(localStorage.getItem(LS_BUDGET) || '{}'); } catch {}
    if (!b || typeof b !== 'object' || !Number.isFinite(b.t) || !Number.isFinite(b.n) || now - b.t > 3600e3) {
      b = { t: now, n: 0 };
    }
    b.n += 1;
    localStorage.setItem(LS_BUDGET, JSON.stringify(b));
    return b.n;
  }

  function regCooldownLeft() {
    const t = Number(localStorage.getItem(LS_LASTREG) || 0);
    if (!Number.isFinite(t) || t <= 0) return 0;
    return Math.max(0, 24 * 3600e3 - (Date.now() - t));
  }

  /* ────────────────────────── 失败冷却 ────────────────────────── */
  let cooldownUntil = 0;
  const cooling = () => Date.now() < cooldownUntil;
  let coolTimer = null;
  function startCooldown(sec) {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + sec * 1000);
    if (coolTimer) clearTimeout(coolTimer);
    const tick = () => {
      const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (left > 0) {
        logStep('触发站点风控，冷却 ' + left + ' 秒后再试（这段时间别点按钮）');
        coolTimer = setTimeout(tick, 1000);
      } else {
        logStep('');
      }
    };
    tick();
  }

  /* ────────────────────────── API ────────────────────────── */
  async function api(path, { params = {}, token = tok(), method = 'GET', body } = {}) {
    const AUTH_PATH = /^(getCaptcha|login|reg|getInfo|modifyPassword|resetpass|verifyResetCode)/.test(path);
    if (cooling() && !AUTH_PATH) {
      return { code: -4, message: '正在冷却中（被站点风控），稍候再试' };
    }
    if (budget() > HOURLY_BUDGET) {
      return { code: -2, message: '本小时请求数已达上限（120），为降低被风控概率已暂停，稍后再试' };
    }
    await jitter();
    const q = new URLSearchParams({ ...FIX, ...params });
    if (token) q.set('access_token', token);
    const opt = { method, credentials: 'include', headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh_CN',
      'Content-Type': 'application/json;charset=UTF-8',
    } };
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) opt.body = JSON.stringify(body);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(API + path.replace(/^\//, '') + '?' + q.toString(), { ...opt, signal: ctrl.signal, cache: 'no-store' });
      const txt = await r.text();
      if (!txt || !txt.trim()) return { code: -6, message: '空响应（可能被风控），稍后重试' };
      try {
        return JSON.parse(txt);
      } catch {
        // 返回了 HTML / 非 JSON：基本就是 WAF 挑战页或被风控
        if (r.status === 429 || r.status === 403 || r.status === 503 || /^\s*</.test(txt)) {
          const isData = /^(getTList|getVideoDetail|getTrDetail|getVideoList)/.test(path);
          if (isData) startCooldown(90);
          return {
            code: -5,
            message: isData
              ? '被站点风控拦截（HTTP ' + r.status + '），已冷却 90 秒'
              : '站点返回异常页面（HTTP ' + r.status + '），稍后重试',
          };
        }
        return { code: r.status, message: txt.slice(0, 160) };
      }
    } catch (e) {
      const abort = String(e && e.name) === 'AbortError';
      // 只有"取数据"的接口失败才冷却；登录/验证码/用户信息失败不锁面板，否则一次超时就把人锁死
      const dataPath = /^(getTList|getVideoDetail|getTrDetail|getVideoList)/.test(path);
      if (dataPath) startCooldown(60);
      return {
        code: abort ? -3 : -1,
        message: dataPath
          ? (abort ? '请求超时（站点在限流），已自动冷却 60 秒' : '网络被重置（站点风控），已自动冷却 60 秒')
          : (abort ? '请求超时，稍后重试' : '网络异常，稍后重试'),
      };
    } finally {
      clearTimeout(timer);
    }
  }


  /* ────────────────────────── 账号 ────────────────────────── */
  async function whoami() {
    if (!tok()) return null;
    const r = await api('getInfo');
    return (r && r.data && r.data.user) || null;
  }

  async function getCaptcha() {
    const r = await api('getCaptcha', { token: '' });
    if (r.code !== 200) throw new Error(r.message || '验证码获取失败');
    return r.data; // { key, img }
  }

  async function doLogin(username, password, code, key) {
    const r = await api('login', { params: { username, password, code, key }, token: '' });
    if (r.code === 200 && r.data && r.data.access_token) {
      localStorage.setItem(LS_TOKEN, r.data.access_token);
      return true;
    }
    throw new Error(r.message || '登录失败');
  }

  async function doRegister(username, password, email, code, key) {
    const r = await api('reg', {
      params: { username, password, repassword: password, email, code, key },
      token: '',
    });
    if (r.code === 200) {
      const t = r.data && r.data.access_token;
      if (t) { localStorage.setItem(LS_TOKEN, t); return true; }
      localStorage.removeItem(LS_TOKEN);   // 注册成功但没给 token：不能沿用旧账号的 token
      return false;
    }
    throw new Error(r.message || '注册失败');
  }

  /* ────────────────────────── 主流程 ────────────────────────── */

  async function fetchLinks(idcode) {
    let r = await api('getVideoDetail', { params: { id: idcode } });
    if ([10103, 10104].includes(Number(r.code)) && tok()) {
      r = await api('getVideoDetail', { params: { id: idcode }, token: '' });   // token 失效则匿名重试
    }
    if (r.code !== 200 || !r.data) throw new Error(r.message || '获取失败');
    const d = r.data;
    const rows = [];
    for (const k in (d.movies_online_seed || {})) {
      for (const it of (d.movies_online_seed[k] || [])) {
        if (!it || typeof it !== 'object') continue;
        if (it.link) rows.push({
          type: TYPE_NAME[k] || k, name: it.seed_name || '', link: it.link, code: it.code || '',
        });
      }
    }
    return { title: d.title || idcode, year: d.years || '', rows };
  }

  /* ── 最新资源列表（getTList：需 VIP=0 的免费资源，每条带 down 下载页）── */
  const TL = { sc: 1, page: 1, rows: [] };

  let TLseq = 0;
  async function loadTList(sc, page) {
    const seq = ++TLseq;
    const box = $('#unlock-tlist-rows');
    if (!box) return;
    box.innerHTML = '<div>加载中…</div>';
    const r = await api('getTList', { params: { sc, page, limit: 10 } });
    if (seq !== TLseq) return;                       // 有更新的请求了，丢弃旧响应
    if (r.code !== 200) {
      TL.rows = [];
      box.innerHTML = '<div style="color:#f53f3f">加载失败：' + esc(r.message || r.code)
        + '<br><span style="color:#5d6878">站点有频率限制，等 10~30 分钟再试；别连续点。</span></div>';
      return;
    }
    const rows = Array.isArray(r.data && r.data.list) ? r.data.list : [];
    TL.sc = sc; TL.page = page; TL.rows = rows;
    const prev = $('#unlock-tlist-prev'), next = $('#unlock-tlist-next');
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = rows.length < 10;
    if (!rows.length) { box.innerHTML = '<div>没有更多了（第 ' + page + ' 页）</div>'; return; }
    box.innerHTML = rows.map((it, i) => {
      const name = esc(String(it.zname || it.title || '').slice(0, 48));
      const fmtDate = (v) => {
        const str = String(v == null ? '' : v);
        if (/^\d{10}$/.test(str)) {
          const d = new Date(Number(str) * 1000);
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
        return str.slice(0, 10);
      };
      const meta = [it.zsize, fmtDate(it.ezt), Number(it.need_vip) === 1 ? 'VIP' : '免费']
        .filter(Boolean).map(esc).join(' · ');
      return '<div style="padding:5px 0">' + name
        + '<br><span style="color:#5d6878">' + meta + '</span> '
        + '<a href="#" data-open="' + i + '" style="color:#4d8bff;margin-left:6px">下载</a></div>';
    }).join('');
    box.querySelectorAll('[data-open]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const it = TL.rows[Number(a.dataset.open)];
        if (!it) return;
        // down 会 302 到 magnet/网盘协议，用真实 a 标签点击最稳（window.open 常被弹窗拦截）
        const url = safeHref(it.zlink || it.down || '');
        if (!url) { toast('这条没有可用链接', 'err'); return; }
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        link.remove();
      };
    });
  }

  /* ── 多页抓取：把当前分类下所有页的 down 链接拉出来 ── */
  let crawlStop = false;
  async function crawlAllPages(sc) {
    const btn = $('#unlock-tlist-all');
    crawlStop = false;
    btn.disabled = true;
    btn.textContent = '抓取中…（再点一次停止）';
    btn.onclick = () => { crawlStop = true; btn.textContent = '正在停止…'; };

    const all = [];
    let page = 1;
    const MAX = 10;   // 每类最多 200 条；站点风控敏感，想更多就再点一次
    try {
      while (page <= MAX && !crawlStop) {
        logStep('抓取第 ' + page + ' 页…（已收集 ' + all.length + ' 条）');
        const r = await api('getTList', { params: { sc, page, limit: 20 } });
        if (r.code !== 200) {
          toast('第 ' + page + ' 页失败：' + (r.message || r.code), 'err', 5000);
          break;
        }
        const rows = Array.isArray(r.data && r.data.list) ? r.data.list : [];
        if (!rows.length) break;
        for (const it of rows) {
          if (it && it.down) {
            all.push({
              title: String(it.title || '').trim(),
              name: String(it.zname || '').slice(0, 80),
              size: String(it.zsize || ''),
              date: String(it.ezt || '').slice(0, 10),
              url: safeHref(it.down),
            });
          }
        }
        page += 1;
        await sleep(1200 + Math.random() * 1300);   // 刻意放慢，别惊动站点
      }
    } finally {
      logStep('');
      btn.disabled = false;
      btn.textContent = '导出全部页链接';
      btn.onclick = () => crawlAllPages(TL.sc).catch((e) => toast(String(e.message || e), 'err'));
    }

    if (!all.length) { toast('没抓到链接', 'err'); return; }
    const txt = all.map((r) => `${r.title}\t${r.name}\t${r.size}\t${r.date}\t${r.url}`).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    download('6bt0-全部资源', txt);
    toast((crawlStop ? '已停止，' : '') + '共 ' + all.length + ' 条（已复制并下载）', 'ok', 5000);
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/\.txt$/, '') + '-' + Date.now() + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ────────────────────────── UI ────────────────────────── */
  const CSS = `
  #unlock-panel{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:min(290px,calc(100vw - 32px));
    font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
    color:#e8ecf3;background:#151a23;border:1px solid #2a3342;border-radius:12px;
    box-shadow:0 12px 32px rgba(0,0,0,.45);overflow:hidden;user-select:none;
    max-height:calc(100vh - 36px);display:flex;flex-direction:column}
  #unlock-panel.min .unlock-body{display:none}
  .unlock-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:move;
    background:linear-gradient(135deg,#1b2330,#141a24);border-bottom:1px solid #232c3a}
  .unlock-head b{font-size:13px;font-weight:600;letter-spacing:.3px}
  .unlock-dot{width:8px;height:8px;border-radius:50%;background:#f53f3f;flex:0 0 auto}
  .unlock-dot.on{background:#00b42a}
  .unlock-head .sp{flex:1}
  .unlock-min{cursor:pointer;opacity:.6;padding:0 4px}
  .unlock-min:hover{opacity:1}
  .unlock-body{padding:12px;overflow-y:auto;overscroll-behavior:contain}
  .unlock-row{display:flex;gap:8px;margin-bottom:8px}
  .unlock-btn{flex:1;padding:9px 10px;border-radius:8px;border:1px solid #2f3a4c;background:#1e2634;
    color:#dfe6f0;cursor:pointer;font-size:12.5px;transition:.15s;white-space:nowrap}
  .unlock-btn:hover:not(:disabled){background:#26313f;border-color:#3d4b61}
  .unlock-btn:disabled{opacity:.45;cursor:not-allowed}
  .unlock-btn.primary{background:#165dff;border-color:#165dff;color:#fff;font-weight:600}
  .unlock-btn.primary:hover:not(:disabled){background:#0e4fd8}
  .unlock-btn.ghost{background:transparent}
  .unlock-meta{font-size:11.5px;color:#7d8899;margin:2px 0 10px;min-height:16px;word-break:break-all}
  .unlock-meta b{color:#c9d4e3;font-weight:500}
  #unlock-progress{font-size:11.5px;color:#f7ba1e;min-height:15px;margin-bottom:6px}
  .unlock-sep{height:1px;background:#232c3a;margin:10px -12px}
  .unlock-input{width:100%;box-sizing:border-box;background:#0f141c;border:1px solid #2f3a4c;
    color:#dfe6f0;border-radius:8px;padding:7px 9px;font-size:12.5px;outline:none}
  .unlock-input:focus{border-color:#165dff}
  .unlock-cap{display:flex;gap:6px;align-items:center;margin-top:8px}
  .unlock-cap img{height:36px;max-width:42%;object-fit:contain;flex:0 1 auto;border-radius:6px;background:#fff;cursor:pointer}
  .unlock-cap .unlock-input{flex:1 1 auto;width:auto;min-width:52px}
  .unlock-cap .unlock-btn{flex:0 0 56px;padding:9px 6px}
  .unlock-list{max-height:180px;overflow:auto;margin-top:8px;font-size:11.5px;color:#93a1b5}
  .unlock-list div{padding:3px 0;border-bottom:1px dashed #222b38;word-break:break-all}
  .unlock-list a{color:#4d8bff;text-decoration:none}
  .unlock-tip{font-size:11px;color:#5d6878;margin-top:8px;line-height:1.45}
  .unlock-toast{position:fixed;right:18px;top:18px;z-index:2147483001;max-width:320px;
    padding:10px 14px;border-radius:8px;font-size:13px;color:#fff;background:#1e2634;
    border:1px solid #2f3a4c;box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .4s}
  .unlock-toast.ok{background:#0d3320;border-color:#1f6b3f}
  .unlock-toast.err{background:#3a1215;border-color:#7a2a2f}
  `;

  function mount() {
    if ($('#unlock-panel')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = 'unlock-panel';
    p.innerHTML = `
      <div class="unlock-head">
        <span class="unlock-dot" id="unlock-dot"></span>
        <b>6bt0 解锁</b><span class="sp"></span>
        <span class="unlock-min" id="unlock-min">—</span>
      </div>
      <div class="unlock-body">
        <div class="unlock-meta" id="unlock-meta">正在检测登录状态…</div>
        <div id="unlock-progress"></div>
        <div class="unlock-row">
          <button class="unlock-btn" id="unlock-export">导出本页直链</button>
          <button class="unlock-btn" id="unlock-batch">批量导出</button>
        </div>
        <div class="unlock-row">
          <button class="unlock-btn" id="unlock-tlist">最新资源列表</button>
        </div>
        <div id="unlock-tlistbox" style="display:none">
          <div class="unlock-row" style="margin:2px 0 6px">
            <button class="unlock-btn" data-sc="1">电影</button>
            <button class="unlock-btn" data-sc="2">剧集</button>
            <button class="unlock-btn" data-sc="3">热门</button>
          </div>
          <div class="unlock-list" id="unlock-tlist-rows" style="max-height:230px"></div>
          <div class="unlock-row" style="margin-top:6px">
            <button class="unlock-btn" id="unlock-tlist-prev">上一页</button>
            <button class="unlock-btn" id="unlock-tlist-next">下一页</button>
            <button class="unlock-btn" id="unlock-tlist-copy">复制本页</button>
          </div>
          <div class="unlock-row">
            <button class="unlock-btn" id="unlock-tlist-all" title="会连续请求约 20 页（每页间隔 1~2.5 秒），可能触发站点限流，建议一次只抓一个分类">导出全部页链接</button>
          </div>
        </div>
        <div class="unlock-sep"></div>
        <div class="unlock-row">
          <button class="unlock-btn ghost" id="unlock-reg">自动注册小号</button>
          <button class="unlock-btn ghost" id="unlock-login">登录</button>
        </div>
        <div class="unlock-row">
          <button class="unlock-btn ghost" id="unlock-reset" title="清掉本机保存的账号和登录凭证，重新开始">重置本机账号</button>
        </div>
        <div id="unlock-auth" style="display:none">
          <div class="unlock-cap">
            <img id="unlock-capimg" title="点击刷新" />
            <input class="unlock-input" id="unlock-capcode" placeholder="算术答案" />
            <button class="unlock-btn" id="unlock-authgo">确定</button>
          </div>
          <div class="unlock-tip" id="unlock-authtip"></div>
        </div>
        <div id="unlock-batchbox" style="display:none">
          <input class="unlock-input" id="unlock-ids" placeholder="影片 idcode，逗号分隔，如 37508847,37068446" />
          <div class="unlock-row" style="margin-top:8px">
            <button class="unlock-btn" id="unlock-batchgo">开始抓取</button>
          </div>
        </div>
        <div class="unlock-list" id="unlock-result" style="display:none"></div>
        <div class="unlock-tip" id="unlock-status">
          每部影片可导出约 3 条公开网盘直链（含提取码）；「最新资源列表」可翻全站免费资源。
        </div>
      </div>`;
    document.body.appendChild(p);

    // 折叠 + 拖动
    $('#unlock-min').onclick = () => p.classList.toggle('min');
    (function drag() {
      const head = p.querySelector('.unlock-head');
      let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
      head.addEventListener('mousedown', (e) => {
        if (e.target.id === 'unlock-min') return;
        on = true;
        const r = p.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        p.style.right = 'auto'; p.style.bottom = 'auto';
        p.style.left = ox + 'px'; p.style.top = oy + 'px';
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!on) return;
        p.style.left = Math.max(0, Math.min(innerWidth - 60, ox + e.clientX - sx)) + 'px';
        p.style.top = Math.max(0, Math.min(innerHeight - 40, oy + e.clientY - sy)) + 'px';
      });
      document.addEventListener('mouseup', () => (on = false));
    })();

    $('#unlock-export').onclick = () => run('export');
    $('#unlock-batch').onclick = () => {
      const b = $('#unlock-batchbox');
      b.style.display = b.style.display === 'none' ? 'block' : 'none';
    };
    $('#unlock-batchgo').onclick = () => run('batch');
    $('#unlock-reg').onclick = () => auth('reg');
    $('#unlock-login').onclick = () => auth('login');

    // 最新资源列表
    $('#unlock-tlist').onclick = () => {
      const b = $('#unlock-tlistbox');
      b.style.display = b.style.display === 'none' ? 'block' : 'none';
      if (b.style.display === 'block' && !TL.rows.length) loadTList(1, 1).catch(e => toast(String(e.message || e), 'err'));
    };
    p.querySelectorAll('[data-sc]').forEach((btn) => {
      btn.onclick = () => loadTList(Number(btn.dataset.sc), 1).catch(e => toast(String(e.message || e), 'err'));
    });
    $('#unlock-tlist-prev').onclick = () => {
      if (TL.page <= 1) return;
      loadTList(TL.sc, TL.page - 1).catch(() => {});
    };
    $('#unlock-tlist-next').onclick = () => {
      loadTList(TL.sc, TL.page + 1).catch(() => {});
    };
    $('#unlock-reset').onclick = () => {
      localStorage.removeItem(LS_ACC);
      localStorage.removeItem(LS_LASTREG);
      localStorage.removeItem(LS_TOKEN);
      authMode = 'reg';
      $('#unlock-auth').style.display = 'block';
      tip('已清除本机账号与登录态，可以重新自动注册', 'ok');
      refreshMeta();
    };
    $('#unlock-tlist-all').onclick = () => crawlAllPages(TL.sc).catch((e) => toast(String(e.message || e), 'err'));
    $('#unlock-tlist-copy').onclick = async () => {
      const links = TL.rows.filter(r => r.down).map(r => location.origin + r.down).join('\n');
      if (!links) { toast('当前没有可复制的链接', 'err'); return; }
      try { await navigator.clipboard.writeText(links); toast('已复制 ' + TL.rows.length + ' 条下载链接', 'ok'); }
      catch { toast('复制失败，请手动选择', 'err'); }
    };

    refreshMeta();
  }

  async function refreshMeta() {
    const meta = $('#unlock-meta'), dot = $('#unlock-dot');
    if (!meta) return;
    let u = null;
    try { u = await whoami(); } catch { u = null; }
    if (!u) {
      dot && dot.classList.remove('on');
      const acc = loadAcc();
      meta.innerHTML = acc && acc.username
        ? `未登录 · 已保存账号 <b>${esc(acc.username)}</b>`
        : '未登录（点下面自动注册）';
      return;
    }
    const vip = isVip(u);
    dot && dot.classList.toggle('on', vip);
    meta.innerHTML = `<b>${esc(u.nickname || u.username)}</b> · ${vip ? '会员 ✔' : '普通用户'}`
      + (u.vip_expire_at ? `<br>到期 <b>${esc(u.vip_expire_at)}</b>` : '');
  }

  /* ────────────────────────── 动作 ────────────────────────── */
  const busy = (id, on) => { const b = $('#' + id); if (b) b.disabled = on; };

  async function run(kind) {
    try {
      if (kind === 'export') {
        const m = (location.pathname + location.hash).match(/\/(?:mv|tv|detail|video)\/(\d+)/);
        if (!m) { toast('请在影片详情页使用', 'err'); return; }
        busy('unlock-export', true);
        logStep('抓取直链…');
        const { title, rows } = await fetchLinks(m[1]);
        logStep('');
        busy('unlock-export', false);
        render(title, rows);
      } else if (kind === 'batch') {
        const raw = ($('#unlock-ids').value || '').split(/[\s,，]+/).filter(Boolean);
        const ids = [...new Set(raw.map((x) => (String(x).match(/\d{4,}/) || [''])[0]).filter(Boolean))].slice(0, 50);
        if (!ids.length) { toast('填几个 idcode（网址里 /mv/ 后面那串数字）', 'err'); return; }
        busy('unlock-batchgo', true);
        let all = [];
        for (let i = 0; i < ids.length; i++) {
          logStep(`批量 ${i + 1}/${ids.length} …`);
          try {
            const { title, year, rows } = await fetchLinks(ids[i]);
            all = all.concat(rows.map((r) => ({ ...r, title: `${title}${year ? '(' + year + ')' : ''}` })));
          } catch (e) {
            const msg = String((e && e.message) || e);
            if (/冷却|上限|风控|拦截/.test(msg)) {
              logStep('');
              busy('unlock-batchgo', false);
              toast('已停止：' + msg, 'err', 6000);
              render('已处理 ' + i + '/' + ids.length + ' 部（提前停止）', all);
              return;
            }
          }
          await sleep(600 + Math.random() * 500);
        }
        logStep('');
        busy('unlock-batchgo', false);
        render('批量 ' + ids.length + ' 部', all);
      }
    } catch (e) {
      logStep('');
      busy('unlock-export', false); busy('unlock-batchgo', false);
      toast(String(e.message || e), 'err');
    }
  }

  function render(title, rows) {
    const box = $('#unlock-result');
    box.style.display = 'block';
    if (!rows.length) { box.innerHTML = '<div>没有拿到直链（可能没会员/该片无网盘资源）</div>'; return; }
    box.innerHTML = `<div style="color:#c9d4e3;margin-bottom:6px">${esc(title)} · ${rows.length} 条</div>`
      + rows.slice(0, 200).map((r) => {
        const href = safeHref(r.link);
        return `<div>[${esc(r.type)}] ${esc(String(r.name).slice(0, 34))}<br>`
          + (href ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(href)}</a>` : esc(r.link))
          + (r.code ? ` 码:${esc(r.code)}` : '') + '</div>';
      }).join('');
    const txt = rows.map((r) => `${r.type}\t${r.name}\t${r.link}\t${r.code || ''}`).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    download('6bt0-links.txt', txt);
    toast(`✔ ${rows.length} 条直链已复制并下载`, 'ok');
  }

  /* ────────────────────────── 登录 / 注册（全自动） ────────────────────────── */
  let authMode = 'reg';
  let capData = null;
  let authBusy = false;

  const loadAcc = () => { try { return JSON.parse(localStorage.getItem(LS_ACC) || '{}'); } catch { return {}; } };
  const saveAcc = (o) => localStorage.setItem(LS_ACC, JSON.stringify({ ...loadAcc(), ...o }));

  function tip(msg, kind) {
    const el = $('#unlock-authtip');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = kind === 'err' ? '#f53f3f' : kind === 'ok' ? '#00b42a' : '#5d6878';
  }

  async function auth(mode) {
    authMode = mode;
    const box = $('#unlock-auth');
    const willOpen = box.style.display !== 'block';
    box.style.display = willOpen ? 'block' : 'none';
    if (!willOpen) return;
    tip('');
    if (mode === 'reg') {
      const left = regCooldownLeft();
      const acc0 = loadAcc();
      if (left > 0 && acc0.username) {
        // 已经有号就别再注册（批量注册是最容易被风控的行为）
        authMode = 'login';
        tip('本机已有账号 ' + acc0.username + '，自动切到登录（填一次验证码即可）');
        await loadCaptcha();
        return;
      }
      // 冷却已过：每次都生成全新身份，避免复用旧用户名撞“已存在”
      const uname = randId();
      saveAcc({ username: uname, password: randPw(), email: uname + '@mailinator.com' });
      tip('算出图片里的算术题 → 点确定，注册成功后会自动登录（无需再点登录）');
    } else {
      const acc = loadAcc();
      tip(acc.username ? '用本机保存的账号 ' + acc.username + ' 登录，只需填一次验证码' : '本机还没有账号，请先点「自动注册小号」');
    }
    await loadCaptcha();
  }

  async function loadCaptcha() {
    try {
      capData = await getCaptcha();
      $('#unlock-capimg').src = capData.img;
      $('#unlock-capcode').value = '';
    } catch (e) {
      tip('验证码加载失败：' + (e.message || e), 'err');
    }
  }

  /** 拿到 token 后立刻校验，成功则刷新页面让站点自身也进入登录态 */
  async function finishAuth(okMsg, expected) {
    for (let i = 0; i < 3; i++) {
      const u = await whoami();
      // 不再要求用户名完全相等：站点可能对用户名做归一化。
      // 只要拿到有效用户且 token 已改写，就认为登录成功。
      const same = !expected || String(u && u.username || '').toLowerCase() === String(expected).toLowerCase();
      if (u && (same || tok())) {
        tip('✔ ' + okMsg + '：' + (u.nickname || u.username), 'ok');
        toast('✔ ' + okMsg + '，即将刷新页面', 'ok');
        await refreshMeta();
        setTimeout(() => location.reload(), 900);
        return true;
      }
      await sleep(700);
    }
    tip('已拿到凭证但校验失败（站点可能限制新号）。稍后点「登录」再试一次。', 'err');
    return false;
  }

  function bindAuth() {
    document.addEventListener('click', async (ev) => {
      if (ev.target.id === 'unlock-capimg') { loadCaptcha(); return; }
      if (ev.target.id !== 'unlock-authgo') return;
      if (authBusy) return;

      const code = ($('#unlock-capcode').value || '').trim();
      if (!code || !capData) { tip('先填验证码答案', 'err'); return; }

      authBusy = true;
      const btn = $('#unlock-authgo');
      btn.disabled = true;
      const acc = loadAcc();

      try {
        if (authMode === 'reg') {
          tip('注册中…');
          const username = acc.username || randId();
          const password = acc.password || randPw();
          const email = username + '@mailinator.com';
          const logged = await doRegister(username, password, email, code, capData.key);
          saveAcc({ username, password, email, at: Date.now() });
          localStorage.setItem(LS_LASTREG, String(Date.now()));
          if (!logged) {
            authMode = 'login';
            tip('注册成功但没有返回登录凭证，请再填一次验证码登录', 'err');
            await loadCaptcha();
            return;
          }
          const ok = await finishAuth('注册成功并已登录', username);
          if (!ok) {
            tip('注册成功，但登录校验没通过；请点「登录」重试', 'err');
            toast('自动登录校验失败，请点「登录」重试', 'err', 5000);
            return;                       // 保持面板打开
          }
        } else {
          if (!acc.username || !acc.password) throw new Error('本机没有可用账号，请先点「自动注册小号」或「重置本机账号」');
          tip('登录中…');
          await doLogin(acc.username, acc.password, code, capData.key);
          const ok = await finishAuth('登录成功', acc.username);
          if (!ok) { tip('登录未通过校验，请重试或重置本机账号', 'err'); return; }
        }
        $('#unlock-auth').style.display = 'none';
      } catch (err) {
        tip('✘ ' + (err.message || err), 'err');
        toast(String(err.message || err), 'err', 4000);
        await loadCaptcha();          // 失败后自动换一张，输入框保留在页面上
      } finally {
        authBusy = false;
        btn.disabled = false;
      }
    });
  }

  /* ────────────────────────── 诊断模式（?__6bt0dbg=1） ────────────────────────── */
  // 把状态写进 document.title，无法执行 JS 的环境也能读取：标题形如
  // DBG|user=xxx|vip=1|tok=1|info=200|list=200:10|detail=200:3|msgs=...
  async function runDebug() {
    const parts = [];
    const t0 = Date.now();
    const tk = tok();
    parts.push('tok=' + (tk ? tk.length : 0));
    const info = await api('getInfo');
    parts.push('info=' + info.code);
    const u = (info.data || {}).user;
    parts.push('user=' + (u ? u.username : '-'));
    parts.push('vip=' + (u ? u.is_vip : '-'));
    if (info.message) parts.push('imsg=' + String(info.message).slice(0, 20));
    const list = await api('getTList', { params: { sc: 1, page: 1, limit: 3 } });
    const rows = (list.data && list.data.list) || [];
    parts.push('list=' + list.code + ':' + rows.length);
    if (list.message) parts.push('lmsg=' + String(list.message).slice(0, 20));
    const det = await api('getVideoDetail', { params: { id: '35811064' } });
    const dd = det.data || {};
    const n = Object.values(dd.movies_online_seed || {}).reduce((a, v) => a + (v || []).filter((x) => x && x.link).length, 0);
    parts.push('detail=' + det.code + ':' + n);
    parts.push('ms=' + (Date.now() - t0));
    // 再模拟一次"点开资源列表"，把 DOM 结果也报出来
    let domInfo = 'nodom';
    try {
      const box = $('#unlock-tlist-rows');
      if (box) {
        await loadTList(1, 1);
        const rows = box.querySelectorAll('div').length;
        const txt = (box.innerText || '').replace(/\s+/g, ' ').slice(0, 40);
        domInfo = 'rows=' + rows + ',txt=' + txt;
      }
    } catch (e) { domInfo = 'err=' + String(e && e.message || e).slice(0, 30); }
    const metaEl = $('#unlock-meta');
    parts.push('dom={' + domInfo + '}');
    parts.push('meta=' + ((metaEl && metaEl.innerText) || '-').replace(/\s+/g, ' ').slice(0, 30));
    document.title = 'DBG|' + parts.join('|').slice(0, 300);
  }

  /* ────────────────────────── 启动 ────────────────────────── */
  function boot() {
    mount();
    bindAuth();
    if (location.search.indexOf('__6bt0dbg') >= 0) {
      runDebug().catch((e) => { document.title = 'DBG|ERR|' + String(e && e.message || e).slice(0, 60); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
