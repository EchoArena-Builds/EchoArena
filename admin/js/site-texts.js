import { supabase } from '../../js/supabase.js';

/* =========================================================
   ELEMENTOS
========================================================= */

const body = document.getElementById('settings-body');
const message = document.getElementById('message');
const saveButton = document.getElementById('save');
const reloadButton = document.getElementById('reload');

/* =========================================================
   ESTADO
========================================================= */

let settings = null;
let isSaving = false;

/* Campos de texto: chave no banco → rótulo e ajuda. */
const TEXT_FIELDS = [
  {
    key: 'site_name',
    label: 'Nome do site',
    help: 'Aparece no título da aba e nos metadados.',
    max: 60
  },
  {
    key: 'site_description',
    label: 'Descrição',
    help: 'Usada por buscadores e ao compartilhar links.',
    max: 200,
    textarea: true
  },
  {
    key: 'site_keywords',
    label: 'Palavras-chave',
    help: 'Separadas por vírgula.',
    max: 200
  },
  {
    key: 'contact_email',
    label: 'E-mail de contato',
    help: 'Exibido para quem quiser falar com a administração.',
    max: 120,
    type: 'email'
  }
];

const SOCIAL_FIELDS = [
  { key: 'discord_url',   label: 'Discord' },
  { key: 'youtube_url',   label: 'YouTube' },
  { key: 'twitch_url',    label: 'Twitch' },
  { key: 'instagram_url', label: 'Instagram' },
  { key: 'twitter_url',   label: 'Twitter / X' },
  { key: 'github_url',    label: 'GitHub' }
];

/* Interruptores agrupados por assunto. */
const TOGGLE_GROUPS = [
  {
    title: 'Acesso ao site',
    description: 'Controla quem consegue entrar e o que vê sem login.',
    items: [
      {
        key: 'maintenance_mode',
        label: 'Modo manutenção',
        help: 'Site sai do ar para visitantes. Use com cuidado.',
        critical: true
      },
      {
        key: 'registration_enabled',
        label: 'Cadastro aberto',
        help: 'Permite que novos usuários criem conta.'
      },
      {
        key: 'allow_guest_view',
        label: 'Visitante pode navegar',
        help: 'Sem login, o visitante consegue ver o conteúdo público.'
      }
    ]
  },
  {
    title: 'Exige login para',
    description: 'Marque o que só deve funcionar para quem tem conta.',
    items: [
      { key: 'login_required_for_builds',       label: 'Criar builds' },
      { key: 'login_required_for_compare',      label: 'Comparar' },
      { key: 'login_required_for_comments',     label: 'Comentar' },
      { key: 'login_required_for_favorites',    label: 'Favoritar' },
      { key: 'login_required_for_team_builder', label: 'Montar composições' },
      { key: 'login_required_for_tierlists',    label: 'Ver tier lists' }
    ]
  },
  {
    title: 'Recursos do sistema',
    description: 'Funções internas da plataforma.',
    items: [
      {
        key: 'analytics_enabled',
        label: 'Registrar métricas',
        help: 'Guarda eventos de navegação para os relatórios.'
      },
      {
        key: 'realtime_enabled',
        label: 'Atualização em tempo real',
        help: 'Reflete mudanças sem recarregar a página.'
      }
    ]
  }
];

/* =========================================================
   UTILITÁRIOS
========================================================= */

function setMessage(text = '', type = '') {
  if (!message) return;
  message.textContent = text;
  message.className = `settings-message${type ? ` ${type}` : ''}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function valueOf(key) {
  return settings?.[key] ?? '';
}

/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function renderTextField(field) {
  const value = escapeHtml(valueOf(field.key));

  const control = field.textarea
    ? `<textarea
         class="admin-textarea"
         id="f-${field.key}"
         data-field="${field.key}"
         rows="3"
         maxlength="${field.max}"
       >${value}</textarea>`
    : `<input
         class="admin-input"
         id="f-${field.key}"
         data-field="${field.key}"
         type="${field.type || 'text'}"
         maxlength="${field.max}"
         value="${value}"
       >`;

  return `
    <div class="settings-field ${field.textarea ? 'full' : ''}">
      <label for="f-${field.key}">${escapeHtml(field.label)}</label>
      ${control}
      <div class="help">${escapeHtml(field.help || '')}</div>
    </div>
  `;
}

function renderSocialField(field) {
  return `
    <div class="settings-field">
      <label for="f-${field.key}">${escapeHtml(field.label)}</label>
      <input
        class="admin-input"
        id="f-${field.key}"
        data-field="${field.key}"
        type="url"
        placeholder="https://..."
        value="${escapeHtml(valueOf(field.key))}"
      >
    </div>
  `;
}

function renderToggle(item) {
  const checked = settings?.[item.key] === true ? 'checked' : '';

  return `
    <label class="settings-toggle ${item.critical ? 'is-critical' : ''}">
      <input type="checkbox" data-field="${item.key}" ${checked}>

      <span class="settings-toggle-copy">
        <strong>${escapeHtml(item.label)}</strong>
        ${item.help ? `<span>${escapeHtml(item.help)}</span>` : ''}
      </span>
    </label>
  `;
}

function render() {
  body.innerHTML = `
    <article class="settings-card">
      <div class="settings-card-head">
        <h2>Identidade</h2>
        <p>Como o site se apresenta em buscadores e ao ser compartilhado.</p>
      </div>

      <div class="settings-grid">
        ${TEXT_FIELDS.map(renderTextField).join('')}
      </div>
    </article>

    <article class="settings-card" style="margin-top:16px">
      <div class="settings-card-head">
        <h2>Redes sociais</h2>
        <p>Deixe em branco o que não usar — links vazios não aparecem no site.</p>
      </div>

      <div class="settings-grid">
        ${SOCIAL_FIELDS.map(renderSocialField).join('')}
      </div>
    </article>

    ${TOGGLE_GROUPS.map(group => `
      <article class="settings-card" style="margin-top:16px">
        <div class="settings-card-head">
          <h2>${escapeHtml(group.title)}</h2>
          <p>${escapeHtml(group.description)}</p>
        </div>

        <div class="settings-toggles">
          ${group.items.map(renderToggle).join('')}
        </div>
      </article>
    `).join('')}

    <article class="settings-card" style="margin-top:16px">
      <div class="settings-card-head">
        <h2>Envio de arquivos</h2>
        <p>Limite aplicado aos uploads feitos pelo painel.</p>
      </div>

      <div class="settings-grid">
        <div class="settings-field">
          <label for="f-max_upload_size_mb">Tamanho máximo (MB)</label>
          <input
            class="admin-input"
            id="f-max_upload_size_mb"
            data-field="max_upload_size_mb"
            type="number"
            min="1"
            max="200"
            value="${escapeHtml(valueOf('max_upload_size_mb') || 25)}"
          >
          <div class="help">Recomendado entre 10 e 50 MB.</div>
        </div>
      </div>
    </article>
  `;
}

/* =========================================================
   COLETA E SALVAMENTO
========================================================= */

function collect() {
  const payload = {};

  body.querySelectorAll('[data-field]').forEach(element => {
    const key = element.dataset.field;

    if (element.type === 'checkbox') {
      /* Manutenção tem fluxo próprio, com senha mestra. */
      if (key === 'maintenance_mode') return;

      payload[key] = element.checked;
      return;
    }

    if (element.type === 'number') {
      const number = Number(element.value);
      payload[key] = Number.isFinite(number) ? number : null;
      return;
    }

    payload[key] = element.value.trim() || null;
  });

  return payload;
}

function validate(payload) {
  const email = payload.contact_email;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('E-mail de contato inválido.');
  }

  for (const field of SOCIAL_FIELDS) {
    const url = payload[field.key];

    if (url && !/^https?:\/\/.+/i.test(url)) {
      throw new Error(`O link de ${field.label} precisa começar com http:// ou https://`);
    }
  }

  const size = payload.max_upload_size_mb;

  if (size !== null && (size < 1 || size > 200)) {
    throw new Error('O tamanho máximo deve ficar entre 1 e 200 MB.');
  }
}

async function save() {
  if (isSaving || !settings) return;

  isSaving = true;
  saveButton.disabled = true;
  saveButton.textContent = 'Salvando...';

  try {
    const payload = collect();

    validate(payload);

    payload.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('system_settings')
      .update(payload)
      .eq('id', settings.id);

    if (error) throw error;

    settings = { ...settings, ...payload };

    if (payload.maintenance_mode === true) {
      setMessage('Salvo. Atenção: o modo manutenção está ATIVO.', 'error');
    } else {
      setMessage('Configurações salvas.', 'ok');
    }
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    setMessage(error.message || 'Não foi possível salvar.', 'error');
  } finally {
    isSaving = false;
    saveButton.disabled = false;
    saveButton.textContent = 'Salvar alterações';
  }
}

/* =========================================================
   CARREGAMENTO
========================================================= */

async function load() {
  body.innerHTML = '<div class="settings-loading">Carregando configurações...</div>';
  setMessage('Carregando...');

  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      body.innerHTML = `
        <div class="settings-loading">
          Nenhuma configuração encontrada.<br>
          Crie a linha inicial em system_settings antes de usar esta tela.
        </div>
      `;
      setMessage('Tabela de configurações vazia.', 'error');
      return;
    }

    settings = data;
    setMessage('');
    render();
  } catch (error) {
    console.error('Erro ao carregar configurações:', error);
    body.innerHTML = '<div class="settings-loading">Não foi possível carregar as configurações.</div>';
    setMessage(error.message || 'Não foi possível carregar.', 'error');
  }
}

/* =========================================================
   EVENTOS
========================================================= */

saveButton?.addEventListener('click', save);
reloadButton?.addEventListener('click', () => load());

/* =========================================================
   MODO MANUTENÇÃO
   Ação separada do "Salvar": derruba o site na hora e exige
   a senha mestra, conferida no banco.
========================================================= */

function buildMaintenanceModal(turningOn) {
  const overlay = document.createElement('div');
  overlay.id = 'maintenance-modal';

  overlay.innerHTML = `
    <div class="mm-backdrop"></div>

    <div class="mm-card" role="dialog" aria-modal="true">
      <div class="mm-icon">${turningOn ? '&#9888;' : '&#10003;'}</div>

      <h2>${turningOn ? 'Derrubar o site?' : 'Reativar o site?'}</h2>

      <p>
        ${turningOn
          ? 'Todos os visitantes verão a tela de manutenção. O painel administrativo continua acessível para você.'
          : 'O site volta ao ar imediatamente para todos os visitantes.'}
      </p>

      <label for="mm-password">Senha mestra</label>
      <input id="mm-password" type="password" autocomplete="off" placeholder="Digite para confirmar">

      <div class="mm-error" id="mm-error"></div>

      <div class="mm-actions">
        <button type="button" id="mm-cancel">Cancelar</button>
        <button type="button" id="mm-confirm" class="${turningOn ? 'danger' : 'primary'}">
          ${turningOn ? 'Derrubar site' : 'Reativar site'}
        </button>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #maintenance-modal{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:20px}
    #maintenance-modal .mm-backdrop{position:absolute;inset:0;background:rgba(3,7,15,.82);backdrop-filter:blur(5px)}
    #maintenance-modal .mm-card{position:relative;width:min(430px,100%);padding:26px;
      border:1px solid #71303b;border-radius:18px;background:#12101f;
      box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}
    #maintenance-modal .mm-icon{font-size:34px;line-height:1;margin-bottom:12px;color:#ff9aaa}
    #maintenance-modal h2{margin:0 0 10px;font-size:20px}
    #maintenance-modal p{margin:0 0 18px;color:#9aa4bb;font-size:12.5px;line-height:1.6}
    #maintenance-modal label{display:block;margin-bottom:7px;font-size:11px;font-weight:700;
      letter-spacing:.06em;text-transform:uppercase;color:#c8cfdd;text-align:left}
    #maintenance-modal input{width:100%;padding:12px 13px;border:1px solid #31245c;border-radius:10px;
      background:#08101e;color:#ece9f8;font:inherit}
    #maintenance-modal input:focus{outline:none;border-color:#8b5cf6}
    #maintenance-modal .mm-error{min-height:18px;margin-top:9px;color:#ff8585;font-size:11.5px;text-align:left}
    #maintenance-modal .mm-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
    #maintenance-modal .mm-actions button{padding:12px;border:1px solid #31245c;border-radius:10px;
      background:#161331;color:#ece9f8;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer}
    #maintenance-modal .mm-actions button.danger{border-color:#71303b;background:#2a1016;color:#ff9aaa}
    #maintenance-modal .mm-actions button.primary{border-color:transparent;
      background:linear-gradient(180deg,#8b5cf6,#6d28d9);color:#fff}
    #maintenance-modal .mm-actions button:disabled{opacity:.6;cursor:wait}
    @media(max-width:420px){#maintenance-modal .mm-actions{grid-template-columns:1fr}}
  `;

  overlay.appendChild(style);
  return overlay;
}

function askMaintenance(turningOn) {
  return new Promise((resolve) => {
    const overlay = buildMaintenanceModal(turningOn);
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#mm-password');
    const errorBox = overlay.querySelector('#mm-error');
    const confirmButton = overlay.querySelector('#mm-confirm');
    const cancelButton = overlay.querySelector('#mm-cancel');

    setTimeout(() => input.focus(), 30);

    function close(result) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    function onKey(event) {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter' && document.activeElement === input) confirm();
    }

    async function confirm() {
      const password = input.value;

      if (!password) {
        errorBox.textContent = 'Digite a senha mestra.';
        return;
      }

      confirmButton.disabled = true;
      cancelButton.disabled = true;
      confirmButton.textContent = 'Verificando...';
      errorBox.textContent = '';

      try {
        const { error } = await supabase.rpc('admin_set_maintenance', {
          new_mode: turningOn,
          master_password: password
        });

        if (error) throw error;

        close(true);
      } catch (error) {
        console.error('[manutenção]', error);
        errorBox.textContent = error.message || 'Não foi possível aplicar.';
        input.value = '';
        input.focus();
        confirmButton.disabled = false;
        cancelButton.disabled = false;
        confirmButton.textContent = turningOn ? 'Derrubar site' : 'Reativar site';
      }
    }

    confirmButton.addEventListener('click', confirm);
    cancelButton.addEventListener('click', () => close(false));
    overlay.querySelector('.mm-backdrop').addEventListener('click', () => close(false));
    document.addEventListener('keydown', onKey);
  });
}

body?.addEventListener('change', async (event) => {
  const toggle = event.target.closest('[data-field="maintenance_mode"]');
  if (!toggle) return;

  const turningOn = toggle.checked;
  const confirmed = await askMaintenance(turningOn);

  if (!confirmed) {
    toggle.checked = !turningOn;
    return;
  }

  settings.maintenance_mode = turningOn;

  setMessage(
    turningOn
      ? 'Site fora do ar. Visitantes veem a tela de manutenção.'
      : 'Site reativado.',
    turningOn ? 'error' : 'ok'
  );
});

await load();
