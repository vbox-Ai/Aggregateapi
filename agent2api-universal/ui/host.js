/* ── Agent2API · 宿主能力统一层（L2 契约的 UI 侧入口）─────────────────────
 *
 * 目标：一份面板代码，在六个宿主里都正确渲染、正确降级。
 *
 *   Windows / macOS / Linux  → Tauri 壳（window.workbuddyDesktop 由 bridge.rs 注入）
 *   Android(KSU)             → WebUI（ksu.exec 可用，exec/插件全开）
 *   Android(APK)             → 内嵌 WebView（无 exec，前台 Service）
 *   iOS(越狱 daemon + 壳)     → WKWebView（无 exec，有隔离登录容器）
 *   浏览器 / PWA              → 纯 HTTP shim（web_shim.rs 注入，只有新标签 + 轮询）
 *
 * 三条规则（六端一致）：
 *   1. 能力不足 → 不渲染（data-cap-require）
 *   2. 能力不足但用户可能点到 → 一句话说明（guard），不抛异常、不静默假成功
 *   3. 能力判断只来自 /api/host 与壳注入，**不看 userAgent**
 *
 * 依赖：window.workbuddyDesktop（上游已有的桥，桌面/IPC 或纯 HTTP 两套实现）
 * 产出：window.A2AHost，以及向后兼容的 window.A2A_LOGIN_OPEN
 */
(function () {
  'use strict';
  if (window.A2AHost) return;

  // ── 1. 默认能力表（与 crates/host-api 的 Capabilities 字段一一对应）──────
  var DEFAULT_CAPS = {
    execHelpers: false, plugins: false, sidecar: false,
    isolatedLogin: false, fileDialogs: false, notifications: false,
    selfUpdate: false, systemProxy: false, portChange: false,
    loopbackBind: true, secureStore: 'file'
  };

  var DEFAULTS_BY_PLATFORM = {
    windows:  { execHelpers: true, plugins: true, sidecar: true, isolatedLogin: true, fileDialogs: true, notifications: true, selfUpdate: true, systemProxy: true, portChange: true, secureStore: 'dpapi' },
    macos:    { execHelpers: true, plugins: true, sidecar: true, isolatedLogin: true, fileDialogs: true, notifications: true, selfUpdate: true, systemProxy: true, portChange: true, secureStore: 'keychain' },
    linux:    { execHelpers: true, plugins: true, sidecar: true, isolatedLogin: true, fileDialogs: true, notifications: true, selfUpdate: true, systemProxy: true, portChange: true, secureStore: 'file' },
    android:  { execHelpers: false, plugins: false, sidecar: false, isolatedLogin: true, fileDialogs: true, notifications: true, selfUpdate: false, systemProxy: false, portChange: true, secureStore: 'file' },
    ios:      { execHelpers: false, plugins: false, sidecar: false, isolatedLogin: true, fileDialogs: false, notifications: false, selfUpdate: false, systemProxy: false, portChange: false, secureStore: 'keychain' },
    web:      { execHelpers: false, plugins: false, sidecar: false, isolatedLogin: false, fileDialogs: false, notifications: false, selfUpdate: false, systemProxy: false, portChange: false, loopbackBind: false, secureStore: 'browser' }
  };

  // ── 2. 壳注入（每端一行）：window.__A2A_HOST__ = { platform, form, caps, native } ──
  var injected = window.__A2A_HOST__ || {};
  var platform = String(injected.platform || guessPlatform());
  var form = String(injected.form || (injected.platform ? 'daemon' : 'browser'));

  var caps = Object.assign({}, DEFAULT_CAPS, DEFAULTS_BY_PLATFORM[platform] || {});
  if (injected.caps) Object.assign(caps, injected.caps);

  // ── 3. 向后兼容：上游/模块补丁里的两个老入口 ────────────────────────────
  var bridge = window.workbuddyDesktop || {};
  var nativeLogin = injected.native && injected.native.loginOpen
    ? window.__A2A_NATIVE_LOGIN_OPEN__
    : null;

  // ── 4. 事件总线（桌面是 push，网页端是轮询，统一成 on/off）──────────────
  var listeners = Object.create(null);
  function emit(name, payload) {
    (listeners[name] || []).forEach(function (cb) {
      try { cb(payload); } catch (e) { console.warn('[A2AHost] listener error', name, e); }
    });
  }
  function on(name, cb) {
    (listeners[name] = listeners[name] || []).push(cb);
    return function off() {
      listeners[name] = (listeners[name] || []).filter(function (f) { return f !== cb; });
    };
  }

  // ── 5. 透传调用：方法名与 web_shim.rs 的 170 个方法同名 ─────────────────
  function call(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    var fn = bridge[method];
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('宿主未实现 ' + method + '（' + platform + '）'));
    }
    try {
      return Promise.resolve(fn.apply(bridge, args));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // ── 6. 能力闸门：不抛异常，只回答"能不能 + 为什么" ─────────────────────
  var FEATURE_TEXT = {
    execHelpers: '本端不允许启动外部程序',
    plugins: '插件在本端不可用（需要能启动外部进程的宿主）',
    sidecar: '订阅内核在本端不可用（需要启动 mihomo sidecar）',
    isolatedLogin: '本端无法提供隔离登录容器，将使用新标签页',
    fileDialogs: '本端没有文件选择器，请手动输入路径或粘贴内容',
    notifications: '本端不支持系统通知',
    selfUpdate: '本端不支持原地更新，请重新安装',
    systemProxy: '本端不支持跟随系统代理',
    portChange: '本端不能改端口，请改配置后重启后端',
    loopbackBind: '本端无法监听本地端口'
  };

  function has(feature) { return !!caps[feature]; }

  /** 能力不足时：返回 false，并（可选）把一句人话交给调用方 toast / 打日志 */
  function guard(feature, opts) {
    if (has(feature)) return true;
    var text = FEATURE_TEXT[feature] || ('本端不支持 ' + feature);
    var where = (opts && opts.context) ? opts.context + '：' : '';
    var message = where + text + '（' + platform + '）';
    if (!opts || opts.silent !== true) {
      console.info('[A2AHost] ' + message);
      if (bridge.api_request) {
        // 上报到网关日志，便于排障（失败无所谓）
        try {
          bridge.api_request({ method: 'POST', path: '/api/logs', body: { level: 'info', target: 'host', message: message } });
        } catch (e) { /* ignore */ }
      }
      if (typeof window.toast === 'function') { try { window.toast(message); } catch (e) {} }
    }
    return false;
  }

  // ── 7. 隔离登录：按端分发（这是 patch-ui.sh 想解决的那件事的正解）──────
  var login = {
    /**
     * @param {string} url   授权页
     * @param {string} state 面板发起登录时拿到的 state（Cookie 抓取型回调需要）
     */
    open: function (url, state) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;

      // ① 壳提供了原生隔离容器（iOS WKWebsiteDataStore.nonPersistent / Tauri 子窗口）
      if (nativeLogin) {
        try { nativeLogin(url, state ? String(state) : ''); return true; } catch (e) { /* 落到下一档 */ }
      }
      // ② WKWebView 通用桥（iOS 兜底壳注入的 messageHandler）
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.a2aLogin) {
          window.webkit.messageHandlers.a2aLogin.postMessage({ url: url, state: state ? String(state) : '', origin: String(location.origin) });
          return true;
        }
      } catch (e) { /* ignore */ }
      // ③ Android KSU WebUI：老朋友 ksu.exec（保留，模块用户还在用）
      try {
        if (window.ksu && typeof window.ksu.exec === 'function') {
          var intent = 'agent2api://login'
            + '?gateway=' + encodeURIComponent(location.origin)
            + '&token=' + encodeURIComponent(panelToken())
            + '&state=' + encodeURIComponent(state ? String(state) : '')
            + '&url=' + encodeURIComponent(url);
          var cb = 'a2a_login_' + Date.now();
          window[cb] = function () { delete window[cb]; };
          window.ksu.exec("am start -a android.intent.action.VIEW -d '" + intent + "'", '{}', cb);
          return true;
        }
      } catch (e) { /* ignore */ }
      // ④ 纯浏览器：新标签（与 web_shim.rs 的行为一致）
      try {
        var win = window.open(url, '_blank', 'noopener,noreferrer');
        if (win) return true;
      } catch (e) { /* ignore */ }
      // ⑤ 弹窗被拦：退回当前窗口，登录完再手动回来
      location.href = url;
      return true;
    }
  };

  function panelToken() {
    try {
      var sid = localStorage.getItem('agent2api.activeServer') || '';
      if (sid) {
        var a = JSON.parse(localStorage.getItem('agent2api.panelAuth.' + sid) || 'null');
        if (a && a.access) return String(a.access);
      }
      var b = JSON.parse(localStorage.getItem('agent2api.panelAuth.origin') || 'null');
      if (b && b.access) return String(b.access);
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('agent2api.panelAuth.') === 0) {
          var v = JSON.parse(localStorage.getItem(k) || 'null');
          if (v && v.access) return String(v.access);
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // ── 8. 能力驱动渲染：声明式，六端同一份 HTML ────────────────────────────
  function applyCapabilities(root) {
    var scope = root || document;
    // 8a. data-cap-require="plugins sidecar" → 一个都不满足就整个节点移除
    scope.querySelectorAll('[data-cap-require]').forEach(function (el) {
      var need = String(el.getAttribute('data-cap-require')).split(/\s+/).filter(Boolean);
      var ok = need.every(function (f) { return has(f); });
      if (!ok) el.remove();
    });
    // 8b. data-cap-disable="sidecar" → 保留但禁用，并给悬停说明
    scope.querySelectorAll('[data-cap-disable]').forEach(function (el) {
      var need = String(el.getAttribute('data-cap-disable')).split(/\s+/).filter(Boolean);
      var missing = need.filter(function (f) { return !has(f); });
      if (!missing.length) return;
      el.setAttribute('disabled', 'disabled');
      el.classList.add('is-cap-disabled');
      el.title = FEATURE_TEXT[missing[0]] || ('本端不支持 ' + missing[0]);
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        guard(missing[0], { context: el.textContent ? el.textContent.trim().slice(0, 12) : '' });
      }, true);
    });
    // 8c. 面板根节点带上平台标记，方便 CSS 做端特化（safe-area / 桌面双栏）
    if (document.body) {
      document.body.setAttribute('data-a2a-platform', platform);
      document.body.setAttribute('data-a2a-form', form);
    }
  }

  // ── 9. 与后端对齐：/api/host 是能力的最终真相（壳注入只是加速首屏）──────
  var ready = new Promise(function (resolve) {
    var done = false;
    function finish() { if (!done) { done = true; resolve(caps); } }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/host', true);
      xhr.timeout = 3000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (data && data.caps) Object.assign(caps, data.caps);
            if (data && data.platform) { platform = data.platform; }
            if (data && data.form) { form = data.form; }
          } catch (e) { /* 老网关没有这个端点，用注入值 */ }
        }
        applyCapabilities();
        emit('caps:ready', caps);
        finish();
      };
      xhr.onerror = xhr.ontimeout = function () { applyCapabilities(); finish(); };
      xhr.send();
    } catch (e) {
      applyCapabilities();
      finish();
    }
  });

  // ── 10. 导出 ────────────────────────────────────────────────────────────
  window.A2AHost = {
    platform: platform,
    form: form,
    caps: caps,
    ready: ready,
    has: has,
    guard: guard,
    call: call,
    on: on,
    login: login,
    refreshCapabilities: applyCapabilities,
    // 供调试：console 里 A2AHost.dump() 一眼看清本端能力
    dump: function () { return JSON.parse(JSON.stringify({ platform: platform, form: form, caps: caps })); }
  };

  // patch-ui.sh 注入的老入口 → 统一到 login.open（保住已发布面板的兼容性）
  var legacyOpen = window.A2A_LOGIN_OPEN;
  window.A2A_LOGIN_OPEN = function (url, state) {
    // 壳/页面自己实现过就不抢（老模块里 m.html 的 stateCapture 版本）
    if (typeof legacyOpen === 'function' && legacyOpen !== window.A2A_LOGIN_OPEN) {
      try { return legacyOpen(url, state); } catch (e) { /* 落到统一实现 */ }
    }
    return login.open(url, state);
  };

  function guessPlatform() {
    var ua = String(navigator.userAgent || '');
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Macintosh/i.test(ua)) return 'macos';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Linux/i.test(ua)) return 'linux';
    return 'web';
  }

  // DOM 就绪后先按"壳注入的能力"渲染一次，/api/host 回来再校正
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyCapabilities(); });
  } else {
    applyCapabilities();
  }
})();
