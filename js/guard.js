/* =========================================================
   PORTEIRO GLOBAL — Echo Arena

   Arquivo único que decide se uma página pública pode ser
   exibida. Carregado como script CLÁSSICO no <head>, roda
   antes de o navegador desenhar qualquer coisa.

   ---------------------------------------------------------
   COMO USAR — em QUALQUER página pública, atual ou futura:
   primeira linha dentro do <head>:

       <script src="./js/guard.js"></script>

   Em subpasta, ajuste o caminho: ../js/guard.js
   ---------------------------------------------------------

   Comportamento em manutenção:
     visitante  → tela de manutenção
     admin      → página normal + faixa vermelha de aviso

   O painel em /admin/ NÃO usa este arquivo.
   ========================================================= */

(function () {
  'use strict';

  var SUPABASE_URL = 'https://suwlxuwhkoilesdlyqll.supabase.co';
  var ANON_KEY     = 'sb_publishable_z2QOcUx2s3otTuOMNo0VoQ_9wz-yQAt';

  /* Mesma chave definida em js/supabase.js. Se mudar lá, mude aqui. */
  var STORAGE_KEY  = 'echo-arena-auth';

  var TIMEOUT_MS = 5000;
  var GUARD_ID = 'echo-boot-guard';

  /* ---------- 1. esconde tudo imediatamente ---------- */

  var guard = document.createElement('style');
  guard.id = GUARD_ID;
  guard.textContent = 'body{visibility:hidden !important}';
  (document.head || document.documentElement).appendChild(guard);

  function reveal() {
    var element = document.getElementById(GUARD_ID);
    if (element) element.remove();
  }

  var safety = setTimeout(reveal, TIMEOUT_MS + 2000);

  function finish() {
    clearTimeout(safety);
    reveal();
  }

  /* ---------- 2. utilidades ---------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#039;'
      }[c];
    });
  }

  function whenBodyReady(callback) {
    if (document.body) {
      callback();
    } else {
      document.addEventListener('DOMContentLoaded', callback);
    }
  }

  /* Token da sessão, lido direto do storage do Supabase.
     Evita depender do SDK, que carrega depois. */
  function accessToken() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      var parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) return parsed[0] || null;

      return parsed.access_token ||
             (parsed.currentSession && parsed.currentSession.access_token) ||
             null;
    } catch (error) {
      return null;
    }
  }

  function userIdFromToken(token) {
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      return payload.sub || null;
    } catch (error) {
      return null;
    }
  }

  function request(path, options) {
    var settings = options || {};
    var token = settings.token;

    return fetch(SUPABASE_URL + path, {
      method: settings.method || 'GET',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + (token || ANON_KEY),
        'Content-Type': 'application/json'
      },
      body: settings.body
    }).then(function (response) {
      if (!response.ok) throw new Error('status ' + response.status);
      return response.json();
    });
  }

  /* ---------- 3. telas ---------- */

  function showMaintenance(siteName) {
    /* Avisa os módulos da página que não há mais o que montar. */
    window.__ECHO_BLOCKED = true;

    var name = escapeHtml(siteName || 'Echo Arena');

    whenBodyReady(function () {
      document.title = name + ' — Manutenção';

      document.body.innerHTML =
        '<div class="mnt-wrap">' +
          '<div class="mnt-glow"></div>' +
          '<main class="mnt-card">' +
            '<div class="mnt-mark"></div>' +
            '<h1>' + name + '</h1>' +
            '<p class="mnt-tag">Manutenção em andamento</p>' +
            '<p class="mnt-copy">Estamos ajustando os bastidores da arena. ' +
              'O site volta ao ar em instantes.</p>' +
            '<div class="mnt-bar"><i></i></div>' +
            '<button class="mnt-retry" type="button">Tentar novamente</button>' +
          '</main>' +
        '</div>';

      var style = document.createElement('style');

      style.textContent =
        '.mnt-wrap{position:fixed;inset:0;display:grid;place-items:center;padding:24px;' +
          'background:radial-gradient(circle at 50% 0%,#1b1240 0%,#0A0714 55%);overflow:hidden;' +
          'font-family:Inter,system-ui,-apple-system,sans-serif}' +
        '.mnt-glow{position:absolute;width:min(560px,90vw);aspect-ratio:1;border-radius:50%;' +
          'background:radial-gradient(circle,#8B5CF633,transparent 62%);filter:blur(10px)}' +
        '.mnt-card{position:relative;width:min(460px,100%);padding:38px 30px;text-align:center;' +
          'border:1px solid #251B45;border-radius:20px;background:rgba(19,14,36,.86);' +
          'backdrop-filter:blur(8px);box-shadow:0 30px 90px rgba(0,0,0,.55)}' +
        '.mnt-mark{width:54px;height:54px;margin:0 auto 20px;border-radius:14px;position:relative;' +
          'background:linear-gradient(140deg,#A78BFA,#6D28D9);box-shadow:0 0 26px #8b5cf655;' +
          'animation:mntPulse 2.4s ease-in-out infinite}' +
        '.mnt-mark::after{content:"";position:absolute;inset:14px;background:#fff;opacity:.92;' +
          'clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}' +
        '@keyframes mntPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}' +
        '.mnt-card h1{margin:0;font-size:26px;font-weight:700;letter-spacing:.02em;' +
          'text-transform:uppercase;color:#EDE9F7}' +
        '.mnt-tag{margin:8px 0 0;font-size:11px;font-weight:700;letter-spacing:.16em;' +
          'text-transform:uppercase;color:#B794FF}' +
        '.mnt-copy{margin:20px 0 0;color:#A79CC8;font-size:13px;line-height:1.7}' +
        '.mnt-bar{height:4px;margin:26px 0 22px;border-radius:4px;background:#251B45;overflow:hidden}' +
        '.mnt-bar i{display:block;width:38%;height:100%;border-radius:4px;' +
          'background:linear-gradient(90deg,#8B5CF6,#C4B5FD);' +
          'animation:mntSlide 1.9s ease-in-out infinite}' +
        '@keyframes mntSlide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}' +
        '.mnt-retry{padding:11px 22px;border:1px solid #31245C;border-radius:10px;background:#181130;' +
          'color:#A79CC8;font:inherit;font-size:12px;font-weight:600;letter-spacing:.05em;' +
          'text-transform:uppercase;cursor:pointer}' +
        '.mnt-retry:hover{background:#1C1436;color:#EDE9F7}' +
        '@media(max-width:420px){.mnt-card{padding:30px 22px}.mnt-card h1{font-size:22px}}';

      document.head.appendChild(style);

      document.querySelector('.mnt-retry').addEventListener('click', function () {
        location.reload();
      });

      finish();
    });
  }

  function showAdminBanner() {
    whenBodyReady(function () {
      if (document.getElementById('echo-mnt-banner')) return;

      var bar = document.createElement('div');
      bar.id = 'echo-mnt-banner';

      bar.innerHTML =
        '<strong>MODO MANUTENÇÃO ATIVO</strong> — ' +
        'o site está fora do ar para todos os visitantes. ' +
        'Você vê esta página por ser administrador.';

      bar.setAttribute(
        'style',
        'position:sticky;top:0;z-index:9999;padding:11px 16px;text-align:center;' +
        'background:linear-gradient(90deg,#2a1016,#3a141d,#2a1016);' +
        'border-bottom:2px solid #a13a4c;color:#ffb4bd;' +
        'font-family:Inter,system-ui,sans-serif;font-size:12.5px;' +
        'letter-spacing:.03em;line-height:1.5'
      );

      document.body.prepend(bar);
      finish();
    });
  }

  /* ---------- 4. decisão ---------- */

  var controller = null;
  var timer = null;

  if (typeof AbortController === 'function') {
    controller = new AbortController();
    timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  }

  fetch(SUPABASE_URL + '/rest/v1/rpc/site_status', {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: '{}',
    signal: controller ? controller.signal : undefined
  })
    .then(function (response) {
      if (!response.ok) throw new Error('status ' + response.status);
      return response.json();
    })
    .then(function (data) {
      if (timer) clearTimeout(timer);

      var status = Array.isArray(data) ? data[0] : data;

      if (!status || status.maintenance_mode !== true) {
        finish();
        return null;
      }

      /* Em manutenção: admin passa, com aviso. */
      var token = accessToken();
      var userId = token ? userIdFromToken(token) : null;

      if (!token || !userId) {
        showMaintenance(status.site_name);
        return null;
      }

      return request(
        '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(userId),
        { token: token }
      )
        .then(function (rows) {
          var profile = Array.isArray(rows) ? rows[0] : rows;

          if (profile && profile.role === 'admin') {
            showAdminBanner();
          } else {
            showMaintenance(status.site_name);
          }
        })
        .catch(function () {
          showMaintenance(status.site_name);
        });
    })
    .catch(function (error) {
      if (timer) clearTimeout(timer);

      /* Sem resposta, o site continua no ar. */
      console.warn('[guard] verificação indisponível:', error.message);
      finish();
    });
})();
