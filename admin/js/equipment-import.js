import { requireAdmin, logoutAdmin } from './admin-auth.js';

/* =========================================================
   IMPORTAÇÃO DE EQUIPAMENTO POR PRINT — EM LOTE

   Um equipamento gera até 11 prints, um por raridade. Fazer
   um de cada vez é inviável, então este módulo trabalha o
   conjunto inteiro de uma vez:

     1. Você seleciona todos os prints juntos
     2. Marca o recorte UMA vez
     3. Um único motor de OCR processa a fila inteira
     4. Os resultados são fundidos em um só equipamento

   Agora também oferece:

     - Progresso da extração
     - Arquivo atualmente processado
     - Tempo decorrido
     - Cancelamento da coleta
     - Reinício da coleta
     - Resultado individual de cada imagem
     - Registro individual de erros
     - Continuação da fila quando uma imagem falha
     - Preservação dos resultados concluídos ao cancelar

   Nada é salvo automaticamente: tudo passa pela revisão.
========================================================= */

await requireAdmin();

const logoutButton = document.getElementById('logout');

if (logoutButton) {
  logoutButton.onclick = logoutAdmin;
}

/* =========================================================
   VOCABULÁRIO DO JOGO
========================================================= */

const RARITIES = [
  { slug: 'comum', label: 'Comum' },
  { slug: 'raro', label: 'Raro' },
  { slug: 'epico', label: 'Épico' },
  { slug: 'lendario', label: 'Lendário' },
  { slug: 'mitico', label: 'Mítico' },
  { slug: 'supremo', label: 'Supremo' },
  { slug: 'grandioso', label: 'Grandioso' },
  { slug: 'celestial', label: 'Celestial' },
  { slug: 'estelar', label: 'Estelar' },
  { slug: 'imortal', label: 'Imortal' },
  { slug: 'divino', label: 'Divino' }
];

const STATS = [
  {
    key: 'vision_range',
    label: 'Alcance de visão do herói',
    percent: false,
    keywords: ['alcance', 'visao', 'heroi']
  },
  {
    key: 'weapon_damage_to_armor_pct',
    label: 'Dano da arma à armadura do inimigo',
    percent: true,
    keywords: ['dano', 'arma', 'armadura', 'inimigo']
  },
  {
    key: 'weapon_damage_to_health_pct',
    label: 'Dano da arma à vida do inimigo',
    percent: true,
    keywords: ['dano', 'arma', 'vida', 'inimigo']
  },
  {
    key: 'weapon_range_franco',
    label: 'Alcance de tiro com mira do herói',
    percent: false,
    keywords: ['alcance', 'tiro', 'mira']
  },
  {
    key: 'special_ability_cooldown_pct',
    label: 'Tempo de recarregamento da arma',
    percent: true,
    keywords: ['tempo', 'recarregamento', 'arma']
  },
  {
    key: 'weapon_swap_time_pct',
    label: 'Tempo de troca de modo da arma',
    percent: true,
    keywords: ['tempo', 'troca', 'modo', 'arma']
  },
  {
    key: 'crate_opening_cooldown_pct',
    label: 'Tempo de abertura de caixa',
    percent: true,
    keywords: ['tempo', 'abertura', 'caixa']
  }
];

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = id => document.getElementById(id);

const fileInput = $('screenshot');
const zone = $('dropzone');
const raw = $('raw-text');
const status = $('ocr-status');
const reviewArea = $('review-area');
const sendButton = $('send-editor');
const extractButton = $('extract');
const reviewButton = $('review');

if (!fileInput) {
  throw new Error('O campo de seleção de imagens #screenshot não foi encontrado.');
}

if (!zone) {
  throw new Error('A área de upload #dropzone não foi encontrada.');
}

if (!raw) {
  throw new Error('O campo #raw-text não foi encontrado.');
}

if (!status) {
  throw new Error('O elemento #ocr-status não foi encontrado.');
}

if (!reviewArea) {
  throw new Error('A área #review-area não foi encontrada.');
}

if (!sendButton) {
  throw new Error('O botão #send-editor não foi encontrado.');
}

if (!extractButton) {
  throw new Error('O botão #extract não foi encontrado.');
}

if (!reviewButton) {
  throw new Error('O botão #review não foi encontrado.');
}

fileInput.multiple = true;

/* =========================================================
   ESTADO
========================================================= */

/*
  shots:

  [{
    label,
    image,
    url,
    crop,
    text,
    parsed,
    status,
    error,
    durationMs
  }]
*/

let shots = [];
let activeIndex = 0;
let merged = null;

/*
  extractionTask mantém a Promise da execução atual.

  Isso impede que o usuário inicie duas extrações ao mesmo
  tempo por cliques repetidos.
*/

let extractionTask = null;

/*
  extractionRun controla a execução ativa.

  id:
  identifica a execução atual. Quando uma nova execução começa,
  o identificador muda e resultados atrasados da anterior são
  descartados.

  worker:
  guarda o worker do Tesseract que está ativo.

  cancelled:
  informa se o usuário pediu o cancelamento.
*/

const extractionRun = {
  id: 0,
  running: false,
  cancelled: false,
  worker: null,
  startedAt: 0,
  finishedElapsedMs: 0,
  timer: null
};

const options = {
  /*
   * auto:
   * testa imagem colorida melhorada, escala de cinza
   * e preto/branco, escolhendo o melhor resultado.
   *
   * original:
   * preserva as cores e apenas aumenta escala/nitidez.
   *
   * contrast:
   * preserva as cores, mas aumenta mais o contraste.
   *
   * binary:
   * preto e branco. Deve ser usado apenas como fallback.
   */
  readingMode: 'auto',

  scale: 3,
  sharedCrop: true,

  /*
   * Usado somente pelo modo preto e branco.
   * No modo automático o corte é calculado pela própria imagem.
   */
  binaryThreshold: 55
};
/* =========================================================
   TEXTO
========================================================= */

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%+\-\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function similarity(a, b) {
  const first = String(a || '');
  const second = String(b || '');

  if (first === second) {
    return 1;
  }

  if (!first.length || !second.length) {
    return 0;
  }

  const rows = first.length + 1;
  const columns = second.length + 1;

  const matrix = Array.from(
    { length: rows },
    (_, row) => {
      const values = new Array(columns).fill(0);
      values[0] = row;
      return values;
    }
  );

  for (
    let column = 0;
    column < columns;
    column += 1
  ) {
    matrix[0][column] = column;
  }

  for (
    let row = 1;
    row < rows;
    row += 1
  ) {
    for (
      let column = 1;
      column < columns;
      column += 1
    ) {
      const cost =
        first[row - 1] === second[column - 1]
          ? 0
          : 1;

      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }

  return (
    1 -
    matrix[first.length][second.length] /
      Math.max(first.length, second.length)
  );
}
/* =========================================================
   INTERFACE
========================================================= */

function injectStyles() {
  if ($('imp-style')) return;

  const style = document.createElement('style');
  style.id = 'imp-style';

  style.textContent = `
    #ocr-toolbar {
      margin-top: 12px;
    }

    #ocr-toolbar .ocr-row {
      display: flex;
      gap: 14px;
      align-items: center;
      flex-wrap: wrap;
    }

    #ocr-toolbar .ocr-check {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      color: #c8cfdd;
    }

    #ocr-toolbar .ocr-check input {
      width: 17px;
      height: 17px;
      margin: 0;
    }

    #ocr-toolbar .ocr-slider {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #c8cfdd;
    }
    #binary-threshold-control[hidden] {
  display: none !important;
}
    #ocr-toolbar .ocr-slider input {
      width: 100px;
    }

    #ocr-toolbar .ocr-slider output {
      min-width: 28px;
      color: #9da8bd;
      font-size: 11px;
    }

    #ocr-toolbar .ocr-hint {
      margin-top: 10px;
      color: #9da8bd;
      font-size: 11.5px;
      line-height: 1.6;
    }

    #ocr-strip {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      padding-bottom: 6px;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    #ocr-strip .thumb {
      position: relative;
      flex: 0 0 84px;
      height: 60px;
      border-radius: 9px;
      overflow: hidden;
      border: 2px solid #26344f;
      background: #05080f;
      cursor: pointer;
      transition:
        border-color .18s ease,
        transform .18s ease;
    }

    #ocr-strip .thumb:hover {
      transform: translateY(-1px);
    }

    #ocr-strip .thumb.is-active {
      border-color: #8b5cf6;
    }

    #ocr-strip .thumb.is-done {
      border-color: #28613c;
    }

    #ocr-strip .thumb.is-warning {
      border-color: #8a6819;
    }

    #ocr-strip .thumb.is-error {
      border-color: #a33e49;
    }

    #ocr-strip .thumb.is-processing {
      border-color: #9d7cff;
    }

    #ocr-strip .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: .75;
    }

    #ocr-strip .thumb .tag {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 2px 4px;
      background: rgba(5, 8, 15, .85);
      color: #c8cfdd;
      font-size: 8.5px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #ocr-canvas-wrap {
      position: relative;
      margin-top: 12px;
      overflow: hidden;
      border: 1px solid #26344f;
      border-radius: 11px;
      background: #05080f;
    }

    #ocr-canvas {
      display: block;
      width: 100%;
      cursor: crosshair;
      user-select: none;
      touch-action: none;
    }

    #ocr-crop-box {
      position: absolute;
      border: 2px dashed #b99eff;
      background: rgba(139, 92, 246, .15);
      pointer-events: none;
      display: none;
    }

    #ocr-preview-wrap {
      margin-top: 12px;
    }

    #ocr-preview-wrap h4 {
      margin-bottom: 7px;
      color: #9da8bd;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: .1em;
      text-transform: uppercase;
    }

    #ocr-preview {
      display: block;
      width: 100%;
      border: 1px solid #26344f;
      border-radius: 11px;
      background: #fff;
    }

    .ocr-warn {
      margin-top: 10px;
      padding: 11px 13px;
      border: 1px solid #6f5618;
      border-radius: 10px;
      background: #2a2009;
      color: #ffd76d;
      font-size: 11.5px;
      line-height: 1.6;
    }

    #ocr-extraction-panel {
      margin-top: 14px;
      padding: 14px;
      border: 1px solid #26344f;
      border-radius: 12px;
      background: #09111f;
    }

    .ocr-progress-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 9px;
    }

    .ocr-progress-head strong {
      min-width: 0;
      color: #e6eaf2;
      font-size: 12px;
      line-height: 1.4;
    }

    .ocr-progress-head span {
      flex: 0 0 auto;
      color: #aeb7ca;
      font-size: 11px;
      font-weight: 800;
    }

    .ocr-progress-track {
      height: 10px;
      overflow: hidden;
      border: 1px solid #26344f;
      border-radius: 999px;
      background: #05080f;
    }

    #ocr-progress-bar {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #6d4aff, #a78bfa);
      transition: width .25s ease;
    }

    .ocr-progress-meta {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }

    .ocr-progress-meta div {
      padding: 8px 9px;
      border: 1px solid #1f2b42;
      border-radius: 8px;
      background: #07101d;
    }

    .ocr-progress-meta small {
      display: block;
      margin-bottom: 3px;
      color: #65718a;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .07em;
      text-transform: uppercase;
    }

    .ocr-progress-meta strong {
      color: #d7ddeb;
      font-size: 12px;
    }

    .ocr-extraction-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 11px;
    }

    .ocr-extraction-actions .eq-btn:disabled {
      opacity: .45;
      cursor: not-allowed;
    }

    #ocr-file-results {
      display: grid;
      gap: 7px;
      max-height: 300px;
      margin-top: 12px;
      overflow: auto;
      scrollbar-width: thin;
    }

    .ocr-file-result {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      gap: 9px;
      align-items: start;
      padding: 9px 10px;
      border: 1px solid #1f2b42;
      border-radius: 9px;
      background: #07101d;
    }

    .ocr-file-result.is-processing {
      border-color: #7254c9;
      background: #110d23;
    }

    .ocr-file-result.is-success {
      border-color: #28583a;
    }

    .ocr-file-result.is-warning {
      border-color: #6f5618;
    }

    .ocr-file-result.is-error {
      border-color: #75353d;
      background: #210d12;
    }

    .ocr-file-result.is-cancelled {
      border-color: #5d6471;
    }

    .ocr-file-icon {
      padding-top: 1px;
      text-align: center;
      font-size: 13px;
    }

    .ocr-file-info {
      min-width: 0;
    }

    .ocr-file-name {
      color: #d7ddeb;
      font-size: 11.5px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ocr-file-message {
      margin-top: 3px;
      color: #7f8aa0;
      font-size: 10px;
      line-height: 1.45;
      word-break: break-word;
    }

    .ocr-file-time {
      color: #65718a;
      font-size: 9.5px;
      white-space: nowrap;
    }

    .ocr-file-result.is-error .ocr-file-message {
      color: #ff9da5;
    }

    .ocr-file-result.is-warning .ocr-file-message {
      color: #ffd76d;
    }

    .ocr-file-result.is-success .ocr-file-message {
      color: #8fd3a6;
    }

    .ocr-file-result.is-processing .ocr-file-message {
      color: #c5b5ff;
    }

    .imp-card {
      margin-bottom: 16px;
      padding: 18px;
      border: 1px solid #26344f;
      border-radius: 14px;
      background: #0f1728;
    }

    .imp-card h3 {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 14px;
      font-size: 16px;
    }

    .imp-card h3 small {
      color: #65718a;
      font-size: 11px;
      font-weight: 500;
    }

    .imp-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .imp-grid label {
      display: block;
      color: #c8cfdd;
      font-size: 12px;
      font-weight: 600;
    }

    .imp-grid label.full {
      grid-column: 1 / -1;
    }

    .imp-grid input,
    .imp-grid textarea {
      margin-top: 6px;
    }

    .imp-rarity {
      margin-bottom: 12px;
      padding: 13px;
      border: 1px solid #26344f;
      border-radius: 11px;
      background: #09111f;
    }

    .imp-rarity-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }

    .imp-rarity-head strong {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: .05em;
    }

    .imp-rarity-head .eq-btn {
      min-height: 32px;
      padding: 6px 11px;
      font-size: 10.5px;
    }

    .imp-source {
      color: #65718a;
      font-size: 10px;
    }

    .imp-stats {
      display: grid;
      gap: 8px;
    }

    .imp-stat {
      display: grid;
      grid-template-columns:
        minmax(0, 1.6fr)
        110px
        minmax(0, 1fr)
        38px;
      gap: 8px;
      align-items: center;
    }

    .imp-stat select,
    .imp-stat input {
      min-height: 38px;
      font-size: 12px;
    }

    .imp-stat-raw {
      color: #65718a;
      font-size: 10.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .imp-stat .eq-btn,
    .imp-bonus .eq-btn {
      min-height: 38px;
      padding: 0;
      font-size: 12px;
    }

    .imp-bonus {
      display: grid;
      grid-template-columns:
        90px
        minmax(0, 1fr)
        minmax(0, 1.6fr)
        38px;
      gap: 8px;
      margin-bottom: 8px;
    }

    .imp-bonus input {
      min-height: 38px;
      font-size: 12px;
    }

    .imp-missing {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px dashed #6f5618;
      border-radius: 10px;
      color: #ffd76d;
      font-size: 11px;
      line-height: 1.6;
    }

    @media (max-width: 820px) {
      .imp-grid {
        grid-template-columns: 1fr;
      }

      .imp-stat,
      .imp-bonus {
        grid-template-columns: 1fr;
      }

      .imp-stat-raw {
        white-space: normal;
      }

      .ocr-progress-meta {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .ocr-file-result {
        grid-template-columns: 22px minmax(0, 1fr);
      }

      .ocr-file-time {
        grid-column: 2;
      }
    }
  `;

  document.head.appendChild(style);
}

function buildToolbar() {
  if ($('ocr-toolbar')) return;

  const bar = document.createElement('div');
  bar.id = 'ocr-toolbar';

  bar.innerHTML = `
    <div class="ocr-row">
      <label class="ocr-check">
        <input type="checkbox" id="opt-shared" checked>
        Mesmo recorte para todos
      </label>

      <label class="ocr-slider">
        Modo de leitura

        <select
          id="opt-reading-mode"
          class="admin-select"
          style="min-width: 210px"
        >
          <option value="auto" selected>
            Automático — recomendado
          </option>

          <option value="original">
            Original melhorado
          </option>

          <option value="contrast">
            Alto contraste
          </option>

          <option value="binary">
            Preto e branco
          </option>
        </select>
      </label>

      <label class="ocr-slider">
        Escala

        <input
          type="range"
          id="opt-scale"
          min="2"
          max="5"
          step="1"
          value="3"
        >

        <output id="opt-scale-value">
          3×
        </output>
      </label>

      <label
        class="ocr-slider"
        id="binary-threshold-control"
        hidden
      >
        Corte P/B

        <input
          type="range"
          id="opt-threshold"
          min="20"
          max="85"
          value="55"
        >

        <output id="opt-threshold-value">
          55
        </output>
      </label>

      <button
        type="button"
        class="eq-btn"
        id="opt-reset-crop"
      >
        Limpar recorte
      </button>
    </div>

    <p class="ocr-hint">
      Marque com o mouse preferencialmente a área iniciada em
      <strong>“Efeitos por categoria”</strong>.

      No modo automático, o sistema preserva a imagem colorida,
      também gera versões alternativas e escolhe a leitura que
      reconheceu melhor as raridades e os atributos.
    </p>
  `;

  zone.parentElement.insertBefore(
    bar,
    zone.nextSibling
  );

  $('opt-shared')?.addEventListener(
    'change',
    event => {
      options.sharedCrop = event.target.checked;
      renderPreview();
    }
  );

  $('opt-reading-mode')?.addEventListener(
    'change',
    event => {
      options.readingMode = event.target.value;

      const thresholdControl =
        $('binary-threshold-control');

      if (thresholdControl) {
        thresholdControl.hidden =
          options.readingMode !== 'binary';
      }

      renderPreview();
    }
  );

  $('opt-threshold')?.addEventListener(
    'input',
    event => {
      options.binaryThreshold =
        Number(event.target.value);

      const output =
        $('opt-threshold-value');

      if (output) {
        output.textContent =
          event.target.value;
      }

      renderPreview();
    }
  );

  $('opt-scale')?.addEventListener(
    'input',
    event => {
      options.scale =
        Number(event.target.value);

      const output =
        $('opt-scale-value');

      if (output) {
        output.textContent =
          `${event.target.value}×`;
      }

      renderPreview();
    }
  );

  $('opt-reset-crop')?.addEventListener(
    'click',
    () => {
      shots.forEach(shot => {
        shot.crop = null;
      });

      const cropBox =
        $('ocr-crop-box');

      if (cropBox) {
        cropBox.style.display = 'none';
      }

      renderPreview();
      showWarnings();
    }
  );
}

function buildWorkArea() {
  if ($('ocr-canvas-wrap')) return;

  const strip = document.createElement('div');
  strip.id = 'ocr-strip';

  const wrap = document.createElement('div');
  wrap.id = 'ocr-canvas-wrap';

  wrap.innerHTML = `
    <canvas id="ocr-canvas"></canvas>
    <div id="ocr-crop-box"></div>
  `;

  const preview = document.createElement('div');
  preview.id = 'ocr-preview-wrap';

  preview.innerHTML = `
    <h4>Como o leitor enxerga</h4>
    <canvas id="ocr-preview"></canvas>
  `;

  const toolbar = $('ocr-toolbar');

  if (!toolbar?.parentElement) {
    throw new Error('Não foi possível posicionar a área de OCR.');
  }

  toolbar.parentElement.insertBefore(strip, toolbar.nextSibling);
  strip.parentElement.insertBefore(wrap, strip.nextSibling);
  wrap.parentElement.insertBefore(preview, wrap.nextSibling);

  strip.addEventListener('click', event => {
    const thumb = event.target.closest('.thumb');

    if (!thumb) return;

    const nextIndex = Number(thumb.dataset.index);

    if (!Number.isInteger(nextIndex)) return;
    if (!shots[nextIndex]) return;

    activeIndex = nextIndex;

    renderStrip();
    renderPreview();
    showWarnings();
  });

  bindCropSelection();
}

function buildExtractionPanel() {
  if ($('ocr-extraction-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'ocr-extraction-panel';

  panel.innerHTML = `
    <div class="ocr-progress-head">
      <strong id="ocr-progress-title">
        Extração ainda não iniciada
      </strong>

      <span id="ocr-progress-percent">0%</span>
    </div>

    <div
      class="ocr-progress-track"
      role="progressbar"
      aria-label="Progresso da extração"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="0"
    >
      <div id="ocr-progress-bar"></div>
    </div>

    <div class="ocr-progress-meta">
      <div>
        <small>Processados</small>
        <strong id="ocr-count-processed">0 / 0</strong>
      </div>

      <div>
        <small>Concluídos</small>
        <strong id="ocr-count-success">0</strong>
      </div>

      <div>
        <small>Avisos / erros</small>
        <strong id="ocr-count-errors">0</strong>
      </div>

      <div>
        <small>Tempo</small>
        <strong id="ocr-elapsed">00:00</strong>
      </div>
    </div>

    <div class="ocr-extraction-actions">
      <button
        type="button"
        class="eq-btn"
        id="ocr-cancel"
        disabled
      >
        Cancelar coleta
      </button>

      <button
        type="button"
        class="eq-btn"
        id="ocr-restart"
        disabled
      >
        Reiniciar coleta
      </button>
    </div>

    <div id="ocr-file-results"></div>
  `;

  const preview = $('ocr-preview-wrap');

  if (preview?.parentElement) {
    preview.parentElement.insertBefore(panel, preview.nextSibling);
  } else if (status.parentElement) {
    status.parentElement.insertBefore(panel, status);
  }

  $('ocr-cancel')?.addEventListener('click', async () => {
    await cancelExtraction();
  });

  $('ocr-restart')?.addEventListener('click', async () => {
    await restartExtraction();
  });

  updateExtractionPanel();
}

function renderStrip() {
  const strip = $('ocr-strip');

  if (!strip) return;

  strip.innerHTML = shots.map((shot, index) => {
    const classes = ['thumb'];

    if (index === activeIndex) {
      classes.push('is-active');
    }

    if (shot.status === 'success') {
      classes.push('is-done');
    }

    if (shot.status === 'warning') {
      classes.push('is-warning');
    }

    if (shot.status === 'error') {
      classes.push('is-error');
    }

    if (shot.status === 'processing') {
      classes.push('is-processing');
    }

    return `
      <div
        class="${classes.join(' ')}"
        data-index="${index}"
      >
        <img src="${shot.url}" alt="">

        <span class="tag">
          ${escapeHtml(shot.label || `#${index + 1}`)}
        </span>
      </div>
    `;
  }).join('');
}

/* =========================================================
   PAINEL DE PROGRESSO
========================================================= */

function formatDuration(milliseconds = 0) {
  const totalSeconds = Math.max(
    0,
    Math.floor(milliseconds / 1000)
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')}`
  );
}

function getExtractionSummary() {
  const processed = shots.filter(shot =>
    ['success', 'warning', 'error'].includes(shot.status)
  ).length;

  const success = shots.filter(
    shot => shot.status === 'success'
  ).length;

  const warnings = shots.filter(
    shot => shot.status === 'warning'
  ).length;

  const errors = shots.filter(
    shot => shot.status === 'error'
  ).length;

  const cancelled = shots.filter(
    shot => shot.status === 'cancelled'
  ).length;

  return {
    processed,
    success,
    warnings,
    errors,
    cancelled,
    problems: warnings + errors,
    total: shots.length
  };
}

function shotResultInfo(shot) {
  switch (shot.status) {
    case 'processing':
      return {
        icon: '⏳',
        className: 'is-processing',
        message: 'Extraindo e interpretando o texto...'
      };

case 'success': {
  const rarityCount =
    Object.keys(
      shot.parsed?.variants || {}
    ).length;

  const attributeCount =
    countParsedAttributes(
      shot.parsed
    );

  const bonusCount =
    shot.parsed?.bonuses?.length || 0;

  const method =
    shot.ocrMethod
      ? ` Método: ${shot.ocrMethod}.`
      : '';

  return {
    icon: '✓',
    className: 'is-success',

    message:
      `${rarityCount} raridade(s), ` +
      `${attributeCount} atributo(s) e ` +
      `${bonusCount} bônus reconhecido(s).` +
      method
  };
}

case 'warning': {
  const method =
    shot.ocrMethod
      ? ` Melhor tentativa: ${shot.ocrMethod}.`
      : '';

  return {
    icon: '!',
    className: 'is-warning',

    message:
      (
        shot.error ||
        'Texto lido, mas nenhum dado estruturado foi reconhecido.'
      ) +
      method
  };
}
    case 'error':
      return {
        icon: '✕',
        className: 'is-error',
        message:
          shot.error ||
          'Não foi possível processar este arquivo.'
      };

    case 'cancelled':
      return {
        icon: '■',
        className: 'is-cancelled',
        message:
          shot.error ||
          'Não processado porque a coleta foi cancelada.'
      };

    default:
      return {
        icon: '•',
        className: '',
        message: 'Aguardando processamento.'
      };
  }
}

function renderExtractionResults() {
  const container = $('ocr-file-results');

  if (!container) return;

  if (!shots.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = shots.map(shot => {
    const info = shotResultInfo(shot);

    return `
      <div class="ocr-file-result ${info.className}">
        <div class="ocr-file-icon">
          ${info.icon}
        </div>

        <div class="ocr-file-info">
          <div
            class="ocr-file-name"
            title="${escapeHtml(shot.label)}"
          >
            ${escapeHtml(shot.label)}
          </div>

          <div class="ocr-file-message">
            ${escapeHtml(info.message)}
          </div>
        </div>

        <div class="ocr-file-time">
          ${
            shot.durationMs
              ? formatDuration(shot.durationMs)
              : ''
          }
        </div>
      </div>
    `;
  }).join('');
}

function updateExtractionPanel(customTitle = '') {
  const panel = $('ocr-extraction-panel');

  if (!panel) return;

  const summary = getExtractionSummary();

  /*
    Arquivos cancelados não entram como processados.

    Quando toda a coleta é cancelada antes de terminar, a barra
    mostra apenas o que realmente chegou a ser processado.
  */

  const percent = summary.total
    ? Math.round(
        (summary.processed / summary.total) * 100
      )
    : 0;

  const current = shots.find(
    shot => shot.status === 'processing'
  );

  let title = customTitle;

  if (!title) {
    if (extractionRun.running && current) {
      title = `Processando ${current.label}`;
    } else if (extractionRun.cancelled) {
      title = 'Coleta cancelada';
    } else if (
      summary.processed === summary.total &&
      summary.total > 0
    ) {
      title = summary.problems
        ? 'Coleta concluída com avisos'
        : 'Coleta concluída';
    } else if (summary.total > 0) {
      title = 'Pronto para iniciar a extração';
    } else {
      title = 'Extração ainda não iniciada';
    }
  }

  const titleElement = $('ocr-progress-title');
  const percentElement = $('ocr-progress-percent');
  const progressBar = $('ocr-progress-bar');
  const processedElement = $('ocr-count-processed');
  const successElement = $('ocr-count-success');
  const errorElement = $('ocr-count-errors');
  const elapsedElement = $('ocr-elapsed');
  const cancelButton = $('ocr-cancel');
  const restartButton = $('ocr-restart');

  if (titleElement) {
    titleElement.textContent = title;
  }

  if (percentElement) {
    percentElement.textContent = `${percent}%`;
  }

  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }

  const track = panel.querySelector('.ocr-progress-track');

  if (track) {
    track.setAttribute(
      'aria-valuenow',
      String(percent)
    );
  }

  if (processedElement) {
    processedElement.textContent =
      `${summary.processed} / ${summary.total}`;
  }

  if (successElement) {
    successElement.textContent =
      String(summary.success);
  }

  if (errorElement) {
    errorElement.textContent =
      String(summary.problems);
  }

  let elapsed = extractionRun.finishedElapsedMs;

  if (
    extractionRun.running &&
    extractionRun.startedAt
  ) {
    elapsed =
      Date.now() - extractionRun.startedAt;
  }

  if (elapsedElement) {
    elapsedElement.textContent =
      formatDuration(elapsed);
  }

  if (cancelButton) {
    cancelButton.disabled =
      !extractionRun.running;
  }

  if (restartButton) {
    restartButton.disabled =
      extractionRun.running || !shots.length;
  }

  renderExtractionResults();
}

function startElapsedTimer() {
  stopElapsedTimer();

  extractionRun.timer = window.setInterval(() => {
    if (!extractionRun.running) return;

    updateExtractionPanel();
  }, 500);
}

function stopElapsedTimer() {
  if (!extractionRun.timer) return;

  clearInterval(extractionRun.timer);
  extractionRun.timer = null;
}

/* =========================================================
   RECORTE
========================================================= */

function currentShot() {
  return shots[activeIndex] || null;
}

function effectiveCrop(shot) {
  if (!shot) return null;

  if (shot.crop) {
    return shot.crop;
  }

  if (options.sharedCrop) {
    const reference = shots.find(item => item.crop);

    if (reference) {
      return reference.crop;
    }
  }

  return null;
}

function bindCropSelection() {
  const canvas = $('ocr-canvas');
  const box = $('ocr-crop-box');

  if (!canvas || !box) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;

  canvas.addEventListener('pointerdown', event => {
    const shot = currentShot();

    if (!shot) return;
    if (extractionRun.running) return;

    dragging = true;

    canvas.setPointerCapture(event.pointerId);

    const rect = canvas.getBoundingClientRect();

    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;

    box.style.display = 'block';
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = '0px';
    box.style.height = '0px';
  });

  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    box.style.left =
      `${Math.min(startX, x)}px`;

    box.style.top =
      `${Math.min(startY, y)}px`;

    box.style.width =
      `${Math.abs(x - startX)}px`;

    box.style.height =
      `${Math.abs(y - startY)}px`;
  });

  function finish() {
    if (!dragging) return;

    dragging = false;

    const shot = currentShot();

    if (!shot) return;

    const rect = canvas.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      box.style.display = 'none';
      return;
    }

    const left =
      parseFloat(box.style.left) || 0;

    const top =
      parseFloat(box.style.top) || 0;

    const width =
      parseFloat(box.style.width) || 0;

    const height =
      parseFloat(box.style.height) || 0;

    if (width < 20 || height < 20) {
      shot.crop = null;
      box.style.display = 'none';
    } else {
      /*
        Guarda o recorte em proporção entre 0 e 1.

        Isso permite reaplicar o mesmo recorte em imagens com
        resoluções diferentes.
      */

      shot.crop = {
        x: left / rect.width,
        y: top / rect.height,
        w: width / rect.width,
        h: height / rect.height
      };
    }

    renderPreview();
    showWarnings();
  }

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}

/* =========================================================
   PREPARO DA IMAGEM
========================================================= */

/* =========================================================
   PREPARO DA IMAGEM
========================================================= */

function getShotSourceArea(shot) {
  if (!shot?.image) {
    throw new Error(
      'A imagem do arquivo não está disponível.'
    );
  }

  const image = shot.image;
  const relative = effectiveCrop(shot);

  if (
    !image.naturalWidth ||
    !image.naturalHeight
  ) {
    throw new Error(
      'A imagem não possui dimensões válidas.'
    );
  }

  const area = relative
    ? {
        x:
          relative.x *
          image.naturalWidth,

        y:
          relative.y *
          image.naturalHeight,

        w:
          relative.w *
          image.naturalWidth,

        h:
          relative.h *
          image.naturalHeight
      }
    : {
        x: 0,
        y: 0,
        w: image.naturalWidth,
        h: image.naturalHeight
      };

  const x = Math.max(
    0,
    Math.min(
      area.x,
      image.naturalWidth - 1
    )
  );

  const y = Math.max(
    0,
    Math.min(
      area.y,
      image.naturalHeight - 1
    )
  );

  const width = Math.max(
    1,
    Math.min(
      area.w,
      image.naturalWidth - x
    )
  );

  const height = Math.max(
    1,
    Math.min(
      area.h,
      image.naturalHeight - y
    )
  );

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new Error(
      'O recorte possui dimensões inválidas.'
    );
  }

  return {
    x,
    y,
    w: width,
    h: height
  };
}

function createBaseCanvas(shot) {
  const image = shot.image;
  const area = getShotSourceArea(shot);
  const scale = Math.max(
    1,
    Number(options.scale) || 3
  );

  const canvas =
    document.createElement('canvas');

  canvas.width = Math.max(
    1,
    Math.round(area.w * scale)
  );

  canvas.height = Math.max(
    1,
    Math.round(area.h * scale)
  );

  const context = canvas.getContext(
    '2d',
    {
      willReadFrequently: true
    }
  );

  if (!context) {
    throw new Error(
      'Não foi possível criar o contexto da imagem.'
    );
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.drawImage(
    image,
    area.x,
    area.y,
    area.w,
    area.h,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas;
}

function cloneCanvas(source) {
  const canvas =
    document.createElement('canvas');

  canvas.width = source.width;
  canvas.height = source.height;

  const context =
    canvas.getContext(
      '2d',
      {
        willReadFrequently: true
      }
    );

  if (!context) {
    throw new Error(
      'Não foi possível copiar a imagem.'
    );
  }

  context.drawImage(source, 0, 0);

  return canvas;
}

function applyContrastToCanvas(
  canvas,
  contrastAmount = 18,
  saturationAmount = 1.05
) {
  const context = canvas.getContext(
    '2d',
    {
      willReadFrequently: true
    }
  );

  if (!context) return canvas;

  const imageData =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  const data = imageData.data;

  const contrast =
    Math.max(
      -100,
      Math.min(100, contrastAmount)
    );

  const factor =
    (
      259 *
      (contrast + 255)
    ) /
    (
      255 *
      (259 - contrast)
    );

  for (
    let index = 0;
    index < data.length;
    index += 4
  ) {
    let red = data[index];
    let green = data[index + 1];
    let blue = data[index + 2];

    const luminance =
      red * 0.299 +
      green * 0.587 +
      blue * 0.114;

    red =
      luminance +
      (red - luminance) *
      saturationAmount;

    green =
      luminance +
      (green - luminance) *
      saturationAmount;

    blue =
      luminance +
      (blue - luminance) *
      saturationAmount;

    data[index] = Math.max(
      0,
      Math.min(
        255,
        factor * (red - 128) + 128
      )
    );

    data[index + 1] = Math.max(
      0,
      Math.min(
        255,
        factor * (green - 128) + 128
      )
    );

    data[index + 2] = Math.max(
      0,
      Math.min(
        255,
        factor * (blue - 128) + 128
      )
    );

    data[index + 3] = 255;
  }

  context.putImageData(
    imageData,
    0,
    0
  );

  return canvas;
}

function applyGrayscaleToCanvas(
  canvas,
  contrastAmount = 20
) {
  const context = canvas.getContext(
    '2d',
    {
      willReadFrequently: true
    }
  );

  if (!context) return canvas;

  const imageData =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  const data = imageData.data;

  const factor =
    (
      259 *
      (contrastAmount + 255)
    ) /
    (
      255 *
      (259 - contrastAmount)
    );

  for (
    let index = 0;
    index < data.length;
    index += 4
  ) {
    let value =
      data[index] * 0.299 +
      data[index + 1] * 0.587 +
      data[index + 2] * 0.114;

    value =
      factor *
      (value - 128) +
      128;

    value = Math.max(
      0,
      Math.min(255, value)
    );

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  context.putImageData(
    imageData,
    0,
    0
  );

  return canvas;
}

function calculateOtsuThreshold(
  imageData
) {
  const histogram =
    new Array(256).fill(0);

  const data = imageData.data;
  let pixelCount = 0;

  for (
    let index = 0;
    index < data.length;
    index += 4
  ) {
    const value = Math.round(
      data[index] * 0.299 +
      data[index + 1] * 0.587 +
      data[index + 2] * 0.114
    );

    histogram[value] += 1;
    pixelCount += 1;
  }

  if (!pixelCount) return 128;

  let totalSum = 0;

  for (
    let value = 0;
    value < 256;
    value += 1
  ) {
    totalSum +=
      value *
      histogram[value];
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let bestThreshold = 128;

  for (
    let threshold = 0;
    threshold < 256;
    threshold += 1
  ) {
    backgroundWeight +=
      histogram[threshold];

    if (!backgroundWeight) {
      continue;
    }

    const foregroundWeight =
      pixelCount -
      backgroundWeight;

    if (!foregroundWeight) {
      break;
    }

    backgroundSum +=
      threshold *
      histogram[threshold];

    const backgroundMean =
      backgroundSum /
      backgroundWeight;

    const foregroundMean =
      (
        totalSum -
        backgroundSum
      ) /
      foregroundWeight;

    const difference =
      backgroundMean -
      foregroundMean;

    const variance =
      backgroundWeight *
      foregroundWeight *
      difference *
      difference;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

function applyBinaryToCanvas(
  canvas,
  forcedThreshold = null
) {
  const context = canvas.getContext(
    '2d',
    {
      willReadFrequently: true
    }
  );

  if (!context) return canvas;

  const imageData =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  const data = imageData.data;

  const threshold =
    Number.isFinite(forcedThreshold)
      ? forcedThreshold
      : calculateOtsuThreshold(
          imageData
        );

  for (
    let index = 0;
    index < data.length;
    index += 4
  ) {
    const luminance =
      data[index] * 0.299 +
      data[index + 1] * 0.587 +
      data[index + 2] * 0.114;

    /*
     * Não invertemos.
     *
     * O Tesseract aceita texto claro em fundo escuro.
     * Inverter indiscriminadamente estava destruindo
     * informações importantes do painel.
     */
    const value =
      luminance >= threshold
        ? 255
        : 0;

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  context.putImageData(
    imageData,
    0,
    0
  );

  return canvas;
}

function applySharpenToCanvas(
  source,
  strength = 0.55
) {
  const width = source.width;
  const height = source.height;

  if (
    width < 3 ||
    height < 3
  ) {
    return source;
  }

  const sourceContext =
    source.getContext(
      '2d',
      {
        willReadFrequently: true
      }
    );

  if (!sourceContext) {
    return source;
  }

  const sourceData =
    sourceContext.getImageData(
      0,
      0,
      width,
      height
    );

  const output =
    new ImageData(
      width,
      height
    );

  const input =
    sourceData.data;

  const result =
    output.data;

  const center =
    1 + 4 * strength;

  const side =
    -strength;

  for (
    let y = 1;
    y < height - 1;
    y += 1
  ) {
    for (
      let x = 1;
      x < width - 1;
      x += 1
    ) {
      const index =
        (y * width + x) * 4;

      const left =
        index - 4;

      const right =
        index + 4;

      const top =
        index - width * 4;

      const bottom =
        index + width * 4;

      for (
        let channel = 0;
        channel < 3;
        channel += 1
      ) {
        const value =
          input[index + channel] *
            center +
          input[left + channel] *
            side +
          input[right + channel] *
            side +
          input[top + channel] *
            side +
          input[bottom + channel] *
            side;

        result[index + channel] =
          Math.max(
            0,
            Math.min(255, value)
          );
      }

      result[index + 3] = 255;
    }
  }

  /*
   * Copia as bordas, pois o filtro acima processa
   * somente pixels com vizinhos completos.
   */
  for (
    let x = 0;
    x < width;
    x += 1
  ) {
    for (
      const y of [0, height - 1]
    ) {
      const index =
        (y * width + x) * 4;

      result[index] =
        input[index];

      result[index + 1] =
        input[index + 1];

      result[index + 2] =
        input[index + 2];

      result[index + 3] = 255;
    }
  }

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    for (
      const x of [0, width - 1]
    ) {
      const index =
        (y * width + x) * 4;

      result[index] =
        input[index];

      result[index + 1] =
        input[index + 1];

      result[index + 2] =
        input[index + 2];

      result[index + 3] = 255;
    }
  }

  sourceContext.putImageData(
    output,
    0,
    0
  );

  return source;
}

function buildProcessedCanvases(shot) {
  const base =
    createBaseCanvas(shot);

  const original =
    applySharpenToCanvas(
      cloneCanvas(base),
      0.35
    );

  const contrast =
    applySharpenToCanvas(
      applyContrastToCanvas(
        cloneCanvas(base),
        24,
        1.08
      ),
      0.55
    );

  const grayscale =
    applySharpenToCanvas(
      applyGrayscaleToCanvas(
        cloneCanvas(base),
        24
      ),
      0.5
    );

  const configuredCut =
    (
      Number(
        options.binaryThreshold
      ) /
      100
    ) *
    255;

  const binary =
    applyBinaryToCanvas(
      applyGrayscaleToCanvas(
        cloneCanvas(base),
        18
      ),
      options.readingMode === 'binary'
        ? configuredCut
        : null
    );

  switch (options.readingMode) {
    case 'original':
      return [
        {
          name: 'original',
          label: 'Original melhorado',
          canvas: original
        }
      ];

    case 'contrast':
      return [
        {
          name: 'contrast',
          label: 'Alto contraste',
          canvas: contrast
        }
      ];

    case 'binary':
      return [
        {
          name: 'binary',
          label: 'Preto e branco',
          canvas: binary
        }
      ];

    case 'auto':
    default:
      return [
        {
          name: 'contrast',
          label: 'Colorida melhorada',
          canvas: contrast
        },
        {
          name: 'original',
          label: 'Original melhorado',
          canvas: original
        },
        {
          name: 'grayscale',
          label: 'Escala de cinza',
          canvas: grayscale
        },
        {
          name: 'binary',
          label: 'Preto e branco',
          canvas: binary
        }
      ];
  }
}

function buildProcessedCanvas(shot) {
  const versions =
    buildProcessedCanvases(shot);

  return versions[0]?.canvas || null;
}

function cropCanvasRegion(
  source,
  {
    x = 0,
    y = 0,
    w = 1,
    h = 1
  } = {}
) {
  const sourceX =
    Math.max(
      0,
      Math.floor(
        source.width * x
      )
    );

  const sourceY =
    Math.max(
      0,
      Math.floor(
        source.height * y
      )
    );

  const sourceWidth =
    Math.max(
      1,
      Math.min(
        source.width - sourceX,
        Math.floor(
          source.width * w
        )
      )
    );

  const sourceHeight =
    Math.max(
      1,
      Math.min(
        source.height - sourceY,
        Math.floor(
          source.height * h
        )
      )
    );

  const canvas =
    document.createElement('canvas');

  canvas.width = sourceWidth;
  canvas.height = sourceHeight;

  const context =
    canvas.getContext('2d');

  if (!context) {
    throw new Error(
      'Não foi possível criar a região da imagem.'
    );
  }

  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas;
}
function renderPreview() {
  const shot = currentShot();

  if (!shot?.image) {
    return;
  }

  const canvas = $('ocr-canvas');
  const box = $('ocr-crop-box');
  const preview = $('ocr-preview');

  if (!canvas || !box || !preview) {
    return;
  }

  const image = shot.image;

  if (
    !image.naturalWidth ||
    !image.naturalHeight
  ) {
    console.warn(
      '[OCR] A imagem ainda não possui dimensões válidas.'
    );

    return;
  }

  const context = canvas.getContext('2d');

  if (!context) {
    console.warn(
      '[OCR] Não foi possível criar o contexto do canvas principal.'
    );

    return;
  }

  /*
   * Define as dimensões internas reais do canvas.
   *
   * O CSS mantém a exibição responsiva com width: 100%.
   */
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  context.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  /*
   * Reposiciona visualmente o recorte existente.
   */
  const relative = effectiveCrop(shot);

  if (relative) {
    const rect =
      canvas.getBoundingClientRect();

    box.style.display = 'block';

    box.style.left =
      `${relative.x * rect.width}px`;

    box.style.top =
      `${relative.y * rect.height}px`;

    box.style.width =
      `${relative.w * rect.width}px`;

    box.style.height =
      `${relative.h * rect.height}px`;
  } else {
    box.style.display = 'none';
  }

  /*
   * Gera a imagem pré-processada exibida em
   * "Como o leitor enxerga".
   */
  try {
    const processed =
      buildProcessedCanvas(shot);

    if (
      !processed ||
      !processed.width ||
      !processed.height
    ) {
      throw new Error(
        'A imagem processada ficou vazia.'
      );
    }

    preview.width =
      processed.width;

    preview.height =
      processed.height;

    const previewContext =
      preview.getContext('2d');

    if (!previewContext) {
      throw new Error(
        'Não foi possível criar o contexto da prévia.'
      );
    }

    previewContext.clearRect(
      0,
      0,
      preview.width,
      preview.height
    );

    previewContext.drawImage(
      processed,
      0,
      0,
      preview.width,
      preview.height
    );
  } catch (error) {
    console.warn(
      '[OCR] Não foi possível montar a prévia:',
      error
    );

    /*
     * Evita deixar um resultado antigo visível.
     */
    const previewContext =
      preview.getContext('2d');

    if (previewContext) {
      previewContext.clearRect(
        0,
        0,
        preview.width,
        preview.height
      );
    }
  }
}
/* =========================================================
   AVISOS
========================================================= */

function showWarnings() {
  document
    .querySelectorAll('.ocr-warn')
    .forEach(item => item.remove());

  const warnings = [];
  const shot = currentShot();

  if (
    shot &&
    !effectiveCrop(shot)
  ) {
    const ratio =
      shot.image.naturalWidth /
      shot.image.naturalHeight;

    if (
      ratio > 2.2 ||
      shot.image.naturalWidth > 2200
    ) {
      warnings.push(
        'A imagem parece conter vários painéis juntos. ' +
        'Marque com o mouse apenas o painel de efeitos ' +
        'de um item.'
      );
    }
  }

  if (!warnings.length) return;
  if (!status.parentElement) return;

  const container =
    document.createElement('div');

  container.className = 'ocr-warn';

  container.innerHTML = warnings
    .map(escapeHtml)
    .join('<br><br>');

  status.parentElement.insertBefore(
    container,
    status
  );
}

/* =========================================================
   LEITURA ESTRUTURADA
========================================================= */

function normalizeRarityCandidate(value = '') {
  return normalize(value)
    .replace(/\b0\b/g, 'o')
    .replace(/\b1\b/g, 'i')
    .replace(/\|/g, 'i')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[^a-z]/g, '');
}

function matchRarity(line) {
  const clean = normalize(line);

  if (!clean) {
    return null;
  }

  const words = clean
    .split(/\s+/)
    .filter(Boolean);

  const candidates = new Set();

  candidates.add(
    normalizeRarityCandidate(clean)
  );

  for (const word of words) {
    candidates.add(
      normalizeRarityCandidate(word)
    );
  }

  for (
    let index = 0;
    index < words.length - 1;
    index += 1
  ) {
    candidates.add(
      normalizeRarityCandidate(
        words[index] + words[index + 1]
      )
    );
  }

  let bestRarity = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (
      !candidate ||
      candidate.length < 3
    ) {
      continue;
    }

    for (const rarity of RARITIES) {
      const expected =
        normalizeRarityCandidate(
          rarity.label
        );

      let score = similarity(
        candidate,
        expected
      );

      if (
        candidate.includes(expected) ||
        expected.includes(candidate)
      ) {
        score = Math.max(
          score,
          0.88
        );
      }

      if (score > bestScore) {
        bestScore = score;
        bestRarity = rarity;
      }
    }
  }

  return bestScore >= 0.68
    ? bestRarity
    : null;
}

function matchStat(line) {
  const clean = normalize(line);

  const numberMatch = clean.match(
    /([+-]?\s*\d+(?:[.,]\d+)?)\s*(%?)/
  );

  if (!numberMatch) {
    return null;
  }

  const value = Number(
    String(numberMatch[1])
      .replace(/\s/g, '')
      .replace(',', '.')
  );

  if (!Number.isFinite(value)) {
    return null;
  }

 const isPercent =
  numberMatch[2] === '%' ||
  clean.includes('%');

  let best = null;
  let bestScore = 0;

  for (const stat of STATS) {
    const hits = stat.keywords.filter(
      word => clean.includes(word)
    ).length;

    const score =
      hits / stat.keywords.length +
      (stat.percent === isPercent ? 0.12 : 0);

    if (score > bestScore) {
      bestScore = score;
      best = stat;
    }
  }

  if (!best || bestScore < 0.5) {
    return {
      key: null,
      label: line.trim(),
      value,
      percent: isPercent,
      raw: line.trim()
    };
  }

  return {
    key: best.key,
    label: best.label,
    value,
    percent: best.percent,
    raw: line.trim()
  };
}

function matchSetBonusHeader(line) {
  const clean = normalize(line);

  if (!clean.includes('equipamento')) {
    return null;
  }

  const numberMatch =
    clean.match(/(\d+)/);

  return numberMatch
    ? Number(numberMatch[1])
    : null;
}

function parseText(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const result = {
    name: '',
    setName: '',
    variants: {},
    bonuses: []
  };

  for (const line of lines.slice(0, 12)) {
    const clean = normalize(line);

    if (
      !result.setName &&
      clean.includes('conjunto')
    ) {
      result.setName = line
        .replace(
          /conjunto\s*(de\s*equipamento[s]?)?/i,
          ''
        )
        .replace(
          /\(\s*\d+\s*\/\s*\d+\s*\)/,
          ''
        )
        .trim();

      continue;
    }

    if (
      !result.name &&
      line.length >= 4 &&
      !matchRarity(line) &&
      !matchStat(line)
    ) {
      result.name = line
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
  }

  let currentRarity = null;
  let currentBonus = null;

  for (const line of lines) {
  const rarity = matchRarity(line);

if (rarity) {
  currentRarity = rarity.slug;
  currentBonus = null;

  if (!result.variants[currentRarity]) {
    result.variants[currentRarity] = [];
  }

  /*
   * Em vez de depender da grafia exata da raridade,
   * pega o conteúdo a partir do primeiro número.
   */
  const numberPosition =
    line.search(/[+-]?\s*\d/);

  if (numberPosition >= 0) {
    const remainder =
      line
        .slice(numberPosition)
        .trim();

    const inlineStat =
      matchStat(remainder);

    if (inlineStat) {
      result.variants[
        currentRarity
      ].push(inlineStat);
    }
  }

  continue;
}

    const pieces =
      matchSetBonusHeader(line);

    if (pieces) {
      currentBonus = {
        required_pieces: pieces,
        title: `Bônus de ${pieces} peças`,
        description: ''
      };

      result.bonuses.push(currentBonus);
      currentRarity = null;

      continue;
    }

    const stat = matchStat(line);

    if (!stat) continue;

    if (currentBonus) {
      currentBonus.description =
        currentBonus.description
          ? `${currentBonus.description} · ${stat.raw}`
          : stat.raw;

      continue;
    }

    if (currentRarity) {
      result.variants[currentRarity]
        .push(stat);
    }
  }

  for (
    const [slug, attributes]
    of Object.entries(result.variants)
  ) {
    if (!attributes.length) {
      delete result.variants[slug];
    }
  }

  return result;
}
/* =========================================================
   AVALIAÇÃO E ESCOLHA DA MELHOR LEITURA
========================================================= */

function countParsedAttributes(parsed) {
  if (!parsed?.variants) {
    return 0;
  }

  return Object.values(
    parsed.variants
  ).reduce(
    (total, attributes) =>
      total +
      (
        Array.isArray(attributes)
          ? attributes.length
          : 0
      ),
    0
  );
}

function countRecognizedAttributes(
  parsed
) {
  if (!parsed?.variants) {
    return 0;
  }

  return Object.values(
    parsed.variants
  ).reduce(
    (total, attributes) =>
      total +
      (
        Array.isArray(attributes)
          ? attributes.filter(
              attribute =>
                Boolean(
                  attribute?.key
                )
            ).length
          : 0
      ),
    0
  );
}

function countRarityMentions(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter(line =>
      Boolean(matchRarity(line))
    )
    .length;
}

function scoreOcrCandidate({
  text,
  parsed,
  confidence = 0
}) {
  const cleanText =
    String(text || '').trim();

  if (!cleanText) {
    return -1000;
  }

  const rarityCount =
    Object.keys(
      parsed?.variants || {}
    ).length;

  const rarityMentions =
    countRarityMentions(
      cleanText
    );

  const attributeCount =
    countParsedAttributes(
      parsed
    );

  const recognizedAttributes =
    countRecognizedAttributes(
      parsed
    );

  const bonusCount =
    parsed?.bonuses?.length || 0;

  const validLines =
    cleanText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line =>
        line.length >= 2
      ).length;

  const replacementCharacters =
    (
      cleanText.match(
        /[�□■]{1}/g
      ) || []
    ).length;

  let score = 0;

  score += rarityCount * 120;
  score += rarityMentions * 28;
  score += attributeCount * 22;
  score += recognizedAttributes * 35;
  score += bonusCount * 30;
  score += Math.min(validLines, 30) * 1.5;
  score += Math.max(
    0,
    Math.min(100, confidence)
  ) * 0.15;

  if (parsed?.name) {
    score += 8;
  }

  if (parsed?.setName) {
    score += 8;
  }

  score -=
    replacementCharacters * 12;

  /*
   * Evita selecionar uma leitura enorme e cheia de ruído
   * somente porque ela contém muitas linhas.
   */
  if (
    cleanText.length > 5000
  ) {
    score -= 30;
  }

  return score;
}

function mergeOcrTexts(
  firstText,
  secondText
) {
  const lines = [];

  const seen =
    new Set();

  for (
    const line of [
      ...String(firstText || '')
        .split(/\r?\n/),

      ...String(secondText || '')
        .split(/\r?\n/)
    ]
  ) {
    const trimmed =
      line.trim();

    if (!trimmed) continue;

    const key =
      normalize(trimmed);

    if (!key) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    lines.push(trimmed);
  }

  return lines.join('\n');
}

async function recognizeCanvas(
  worker,
  canvas,
  {
    psm = '4',
    label = ''
  } = {}
) {
  await worker.setParameters({
    tessedit_pageseg_mode:
      String(psm),

    preserve_interword_spaces:
      '1',

    user_defined_dpi:
      '300',

    tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
      'ÀÁÂÃÉÊÍÓÔÕÚÇ' +
      'abcdefghijklmnopqrstuvwxyz' +
      'àáâãéêíóôõúç' +
      '0123456789+-%.,/() '
  });

  const result =
    await worker.recognize(
      canvas
    );

  const text =
    String(
      result?.data?.text || ''
    ).trim();

  const parsed =
    parseText(text);

  const confidence =
    Number(
      result?.data?.confidence
    ) || 0;

  return {
    label,
    psm: String(psm),
    text,
    parsed,
    confidence,
    score: scoreOcrCandidate({
      text,
      parsed,
      confidence
    })
  };
}

function getAutomaticOcrAttempts(
  versions
) {
  const byName =
    new Map(
      versions.map(version => [
        version.name,
        version
      ])
    );

  const attempts = [];

  const contrast =
    byName.get('contrast');

  const original =
    byName.get('original');

  const grayscale =
    byName.get('grayscale');

  const binary =
    byName.get('binary');

  /*
   * PSM 4:
   * considera colunas/blocos de tamanhos diferentes.
   *
   * PSM 11:
   * procura textos esparsos e independentes.
   */
  if (contrast) {
    attempts.push({
      ...contrast,
      psm: '4'
    });

    attempts.push({
      ...contrast,
      psm: '11'
    });
  }

  if (original) {
    attempts.push({
      ...original,
      psm: '11'
    });
  }

  if (grayscale) {
    attempts.push({
      ...grayscale,
      psm: '4'
    });
  }

  /*
   * A versão binária fica por último e funciona
   * somente como fallback.
   */
  if (binary) {
    attempts.push({
      ...binary,
      psm: '11'
    });
  }

  return attempts;
}

async function recognizeShotRobustly(
  worker,
  shot,
  shouldCancel
) {
  const versions =
    buildProcessedCanvases(shot);

  let attempts;

  if (
    options.readingMode === 'auto'
  ) {
    attempts =
      getAutomaticOcrAttempts(
        versions
      );
  } else {
    const version =
      versions[0];

    attempts = [
      {
        ...version,
        psm: '4'
      },
      {
        ...version,
        psm: '11'
      }
    ];
  }

  const candidates = [];

  for (const attempt of attempts) {
    if (shouldCancel()) {
      throw new Error(
        'OCR_CANCELLED'
      );
    }

    const candidate =
      await recognizeCanvas(
        worker,
        attempt.canvas,
        {
          psm: attempt.psm,
          label:
            `${attempt.label} / ` +
            `PSM ${attempt.psm}`
        }
      );

    candidates.push(candidate);

    /*
     * Resultado suficientemente bom:
     * pelo menos uma raridade e um atributo.
     *
     * Evita executar passagens desnecessárias.
     */
    const rarityCount =
      Object.keys(
        candidate.parsed
          ?.variants || {}
      ).length;

    const attributeCount =
      countParsedAttributes(
        candidate.parsed
      );

    if (
      rarityCount >= 1 &&
      attributeCount >= 1 &&
      candidate.score >= 160
    ) {
      break;
    }
  }

  candidates.sort(
    (first, second) =>
      second.score -
      first.score
  );

  let best =
    candidates[0] || {
      label: 'Nenhuma leitura',
      psm: '',
      text: '',
      parsed: parseText(''),
      confidence: 0,
      score: -1000
    };

  /*
   * Segunda etapa.
   *
   * Quando a primeira leitura encontra pouco conteúdo,
   * divide o painel em duas regiões sobrepostas:
   *
   * 1. cabeçalho;
   * 2. área de efeitos e raridades.
   *
   * A sobreposição evita cortar justamente o título
   * "Efeitos por categoria".
   */
  const bestVersionName =
    best.label
      .toLowerCase()
      .includes('original')
      ? 'original'
      : best.label
          .toLowerCase()
          .includes('cinza')
        ? 'grayscale'
        : best.label
            .toLowerCase()
            .includes('preto')
          ? 'binary'
          : 'contrast';

  const bestVersion =
    versions.find(
      version =>
        version.name ===
        bestVersionName
    ) ||
    versions[0];

  const bestRarityCount =
    Object.keys(
      best.parsed?.variants || {}
    ).length;

  const bestAttributeCount =
    countParsedAttributes(
      best.parsed
    );

  if (
    bestVersion &&
    (
      bestRarityCount === 0 ||
      bestAttributeCount === 0
    )
  ) {
    if (shouldCancel()) {
      throw new Error(
        'OCR_CANCELLED'
      );
    }

    const headerCanvas =
      cropCanvasRegion(
        bestVersion.canvas,
        {
          x: 0,
          y: 0,
          w: 1,
          h: 0.42
        }
      );

    const effectsCanvas =
      cropCanvasRegion(
        bestVersion.canvas,
        {
          x: 0,
          y: 0.25,
          w: 1,
          h: 0.75
        }
      );

    const headerResult =
      await recognizeCanvas(
        worker,
        headerCanvas,
        {
          psm: '11',
          label:
            `${bestVersion.label} / cabeçalho`
        }
      );

    if (shouldCancel()) {
      throw new Error(
        'OCR_CANCELLED'
      );
    }

    const effectsResult =
      await recognizeCanvas(
        worker,
        effectsCanvas,
        {
          psm: '4',
          label:
            `${bestVersion.label} / efeitos`
        }
      );

    const combinedText =
      mergeOcrTexts(
        headerResult.text,
        effectsResult.text
      );

    const combinedParsed =
      parseText(combinedText);

    const combinedCandidate = {
      label:
        `${bestVersion.label} / ` +
        'leitura em duas etapas',

      psm: '11 + 4',
      text: combinedText,
      parsed: combinedParsed,

      confidence:
        (
          headerResult.confidence +
          effectsResult.confidence
        ) /
        2,

      score: 0
    };

    combinedCandidate.score =
      scoreOcrCandidate(
        combinedCandidate
      );

    candidates.push(
      combinedCandidate
    );

    if (
      combinedCandidate.score >
      best.score
    ) {
      best =
        combinedCandidate;
    }
  }

  return {
    best,
    candidates
  };
}
/* =========================================================
   FUSÃO DOS PRINTS
========================================================= */

function mostFrequent(values) {
  const tally = new Map();

  values
    .filter(Boolean)
    .forEach(value => {
      const clean =
        String(value).trim();

      if (!clean) return;

      tally.set(
        clean,
        (tally.get(clean) ?? 0) + 1
      );
    });

  let best = '';
  let bestCount = 0;

  for (const [value, count] of tally) {
    if (
      count > bestCount ||
      (
        count === bestCount &&
        value.length > best.length
      )
    ) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}

function mergeShots() {
  const readable = shots.filter(
    shot => shot.parsed
  );

  const result = {
    name: mostFrequent(
      readable.map(
        shot => shot.parsed.name
      )
    ),
    setName: mostFrequent(
      readable.map(
        shot => shot.parsed.setName
      )
    ),
    description: '',
    recommendation: '',
    variants: {},
    bonuses: [],
    sources: {}
  };

  for (const shot of readable) {
    for (
      const [slug, attributes]
      of Object.entries(
        shot.parsed.variants
      )
    ) {
      const known = attributes.filter(
        attribute => attribute.key
      ).length;

      const current =
        result.variants[slug];

      const currentKnown = current
        ? current.filter(
            attribute => attribute.key
          ).length
        : -1;

      if (known > currentKnown) {
        result.variants[slug] =
          attributes;

        result.sources[slug] =
          shot.label;
      }
    }
  }

  const seen = new Set();

  for (const shot of readable) {
    for (
      const bonus
      of shot.parsed.bonuses
    ) {
      if (
        seen.has(
          bonus.required_pieces
        )
      ) {
        continue;
      }

      seen.add(
        bonus.required_pieces
      );

      result.bonuses.push(bonus);
    }
  }

  result.bonuses.sort(
    (first, second) =>
      first.required_pieces -
      second.required_pieces
  );

  return result;
}

/* =========================================================
   REVISÃO
========================================================= */

function statRow(attribute, rarity) {
  const statOptions = STATS.map(stat => `
    <option
      value="${stat.key}"
      ${
        stat.key === attribute.key
          ? 'selected'
          : ''
      }
    >
      ${escapeHtml(stat.label)}
    </option>
  `).join('');

  return `
    <div
      class="imp-stat"
      data-rarity="${escapeHtml(rarity)}"
    >
      <select class="admin-select imp-stat-key">
        <option value="">
          — não reconhecido —
        </option>

        ${statOptions}
      </select>

      <input
        class="admin-input imp-stat-value"
        type="number"
        step="0.01"
        value="${
          Number.isFinite(attribute.value)
            ? attribute.value
            : ''
        }"
      >

      <span
        class="imp-stat-raw"
        title="${escapeHtml(attribute.raw || '')}"
      >
        ${escapeHtml(attribute.raw || '')}
      </span>

      <button
        type="button"
        class="eq-btn imp-remove"
        title="Remover"
      >
        ✕
      </button>
    </div>
  `;
}

function renderReview(data) {
  const found = RARITIES.filter(
    rarity => data.variants[rarity.slug]
  );

  const missing = RARITIES.filter(
    rarity => !data.variants[rarity.slug]
  );

  const rarityBlocks = found.map(rarity => {
    const attributes =
      data.variants[rarity.slug];

    const source =
      data.sources?.[rarity.slug];

    return `
      <div
        class="imp-rarity"
        data-rarity="${rarity.slug}"
      >
        <div class="imp-rarity-head">
          <div>
            <strong>
              ${escapeHtml(rarity.label)}
            </strong>

            ${
              source
                ? `
                  <div class="imp-source">
                    de ${escapeHtml(source)}
                  </div>
                `
                : ''
            }
          </div>

          <button
            type="button"
            class="eq-btn imp-add"
            data-rarity="${rarity.slug}"
          >
            Adicionar atributo
          </button>
        </div>

        <div class="imp-stats">
          ${attributes
            .map(
              attribute =>
                statRow(
                  attribute,
                  rarity.slug
                )
            )
            .join('')}
        </div>
      </div>
    `;
  }).join('');

  const bonusRows = (
    data.bonuses || []
  ).map(bonus => `
    <div class="imp-bonus">
      <input
        class="admin-input"
        type="number"
        min="1"
        max="6"
        value="${bonus.required_pieces}"
        title="Peças"
      >

      <input
        class="admin-input"
        value="${escapeHtml(bonus.title)}"
        title="Título"
      >

      <input
        class="admin-input"
        value="${escapeHtml(bonus.description)}"
        title="Descrição"
      >

      <button
        type="button"
        class="eq-btn imp-bonus-remove"
      >
        ✕
      </button>
    </div>
  `).join('');

  reviewArea.innerHTML = `
    <div class="imp-card">
      <h3>Identificação</h3>

      <div class="imp-grid">
        <label>
          Nome

          <input
            class="admin-input"
            id="r-name"
            value="${escapeHtml(data.name)}"
          >
        </label>

        <label>
          Conjunto

          <input
            class="admin-input"
            id="r-set"
            value="${escapeHtml(data.setName)}"
          >
        </label>

        <label class="full">
          Descrição

          <textarea
            class="admin-textarea"
            id="r-desc"
            rows="3"
          >${escapeHtml(data.description)}</textarea>
        </label>

        <label class="full">
          Recomendação

          <textarea
            class="admin-textarea"
            id="r-rec"
            rows="3"
          >${escapeHtml(data.recommendation)}</textarea>
        </label>
      </div>
    </div>

    <div class="imp-card">
      <h3>
        Raridades

        <small>
          ${found.length} de
          ${RARITIES.length} reconhecidas
        </small>
      </h3>

      ${
        rarityBlocks ||
        `
          <div class="admin-empty">
            Nenhuma raridade reconhecida.
            Refaça o recorte ou ajuste o contraste.
          </div>
        `
      }

      ${
        missing.length
          ? `
            <div class="imp-missing">
              Faltando:
              ${missing
                .map(
                  rarity =>
                    escapeHtml(rarity.label)
                )
                .join(', ')}.

              Adicione os prints correspondentes
              e leia novamente.
            </div>
          `
          : ''
      }
    </div>

    <div class="imp-card">
      <h3>Bônus do conjunto</h3>

      <div id="imp-bonuses">
        ${
          bonusRows ||
          `
            <div class="admin-empty">
              Nenhum bônus reconhecido.
            </div>
          `
        }
      </div>
    </div>
  `;

  bindReviewEvents();

  sendButton.disabled = false;
}

function bindReviewEvents() {
  reviewArea
    .querySelectorAll('.imp-remove')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          button
            .closest('.imp-stat')
            ?.remove();
        }
      );
    });

  reviewArea
    .querySelectorAll('.imp-bonus-remove')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          button
            .closest('.imp-bonus')
            ?.remove();
        }
      );
    });

  reviewArea
    .querySelectorAll('.imp-add')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          const rarity =
            button.dataset.rarity;

          const list =
            reviewArea.querySelector(
              `.imp-rarity[data-rarity="${rarity}"] .imp-stats`
            );

          if (!list) return;

          const wrapper =
            document.createElement('div');

          wrapper.innerHTML = statRow(
            {
              key: null,
              value: 0,
              raw: ''
            },
            rarity
          );

          const node =
            wrapper.firstElementChild;

          if (!node) return;

          list.appendChild(node);

          node
            .querySelector('.imp-remove')
            ?.addEventListener(
              'click',
              () => node.remove()
            );
        }
      );
    });
}

/* =========================================================
   SELEÇÃO DE ARQUIVOS
========================================================= */

function loadImage(file) {
  return new Promise(
    (resolve, reject) => {
      const image = new Image();
      const url =
        URL.createObjectURL(file);

      image.onload = () => {
        resolve({
          image,
          url
        });
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);

        reject(
          new Error(
            `Não foi possível abrir ${file.name}`
          )
        );
      };

      image.src = url;
    }
  );
}

function releaseShotUrls() {
  for (const shot of shots) {
    if (shot.url) {
      URL.revokeObjectURL(shot.url);
    }
  }
}

fileInput.addEventListener(
  'change',
  async () => {
    const files = [
      ...(fileInput.files || [])
    ];

    if (!files.length) return;

    if (extractionRun.running) {
      await cancelExtraction();
    }

    status.textContent =
      `Carregando ${files.length} imagem(ns)...`;

    injectStyles();

    const loaded = [];
    const loadErrors = [];

    for (const file of files) {
      try {
        const {
          image,
          url
        } = await loadImage(file);

        loaded.push({
          label: file.name
            .replace(/\.[^.]+$/, '')
            .slice(0, 48),

          image,
          url,
          crop: null,
          text: '',
          parsed: null,
          status: 'pending',
          error: '',
          durationMs: 0,
             
           ocrMethod: '',
ocrScore: 0,
ocrConfidence: 0,
ocrAttempts: []
        });
      } catch (error) {
        console.warn(
          '[import]',
          error.message
        );

        loadErrors.push(
          error.message
        );
      }
    }

    if (!loaded.length) {
      status.textContent =
        'Nenhuma imagem pôde ser aberta.';

      return;
    }

    releaseShotUrls();

    shots = loaded;
    activeIndex = 0;
    merged = null;

    extractionRun.cancelled = false;
    extractionRun.startedAt = 0;
    extractionRun.finishedElapsedMs = 0;

    raw.value = '';
    reviewArea.innerHTML = '';

    sendButton.disabled = true;
    reviewButton.disabled = false;
    extractButton.disabled = false;

    zone.style.display = 'none';

    buildToolbar();
    buildWorkArea();
    buildExtractionPanel();

    renderStrip();
    renderPreview();
    showWarnings();
    updateExtractionPanel();

    let message =
      `${shots.length} print(s) carregado(s). ` +
      'Marque o painel de efeitos em um deles — ' +
      'o recorte vale para todos.';

    if (loadErrors.length) {
      message +=
        ` ${loadErrors.length} arquivo(s) ` +
        'não puderam ser abertos.';
    }

    status.textContent = message;
  }
);

/* =========================================================
   CONTROLE DA EXTRAÇÃO
========================================================= */

function resetExtractionState() {
  for (const shot of shots) {
    shot.text = '';
    shot.parsed = null;
    shot.status = 'pending';
    shot.error = '';
    shot.durationMs = 0;
     
     shot.ocrMethod = '';
shot.ocrScore = 0;
shot.ocrConfidence = 0;
shot.ocrAttempts = [];
  }

  raw.value = '';
  merged = null;

  reviewArea.innerHTML = '';
  sendButton.disabled = true;

  extractionRun.cancelled = false;
  extractionRun.startedAt = 0;
  extractionRun.finishedElapsedMs = 0;

  renderStrip();

  updateExtractionPanel(
    'Pronto para iniciar uma nova coleta'
  );
}

async function terminateExtractionWorker() {
  const worker =
    extractionRun.worker;

  if (!worker) return;

  extractionRun.worker = null;

  try {
    await worker.terminate();
  } catch (error) {
    console.warn(
      '[OCR] Falha ao encerrar worker:',
      error
    );
  }
}

async function cancelExtraction() {
  if (!extractionRun.running) return;

  extractionRun.cancelled = true;

  status.textContent =
    'Cancelando a coleta...';

  updateExtractionPanel(
    'Cancelando a coleta...'
  );

  await terminateExtractionWorker();

  if (extractionTask) {
    try {
      await extractionTask;
    } catch {
      /*
        O erro provocado pela interrupção do worker é tratado
        dentro da própria função runExtraction().
      */
    }
  }
}

async function restartExtraction() {
  if (!shots.length) {
    status.textContent =
      'Selecione os prints primeiro.';

    return;
  }

  if (extractionRun.running) {
    await cancelExtraction();
  }

  resetExtractionState();

  extractionTask = runExtraction()
    .catch(error => {
      console.error(
        '[OCR] Erro não tratado:',
        error
      );
    })
    .finally(() => {
      extractionTask = null;
    });

  await extractionTask;
}

/* =========================================================
   EXTRAÇÃO EM LOTE
========================================================= */

function classifyShotResult(shot) {
  const text =
    String(shot.text || '').trim();

  const rarityCount =
    Object.keys(
      shot.parsed?.variants || {}
    ).length;

  const bonusCount =
    shot.parsed?.bonuses?.length || 0;

  if (!text) {
    shot.status = 'warning';

    shot.error =
      'O OCR não encontrou texto. Verifique o recorte, ' +
      'o contraste ou a qualidade da imagem.';

    return;
  }

  if (!rarityCount && !bonusCount) {
    shot.status = 'warning';

    shot.error =
      'O texto foi extraído, mas nenhuma raridade ou ' +
      'bônus pôde ser identificado.';

    return;
  }

  shot.status = 'success';
  shot.error = '';
}

function buildRawText() {
  raw.value = shots
    .filter(
      shot =>
        shot.text ||
        shot.error
    )
    .map(shot => {
      const header =
        `===== ${shot.label} =====`;

      if (shot.text) {
        let content =
          `${header}\n${shot.text}`;

        if (
          shot.status === 'warning' &&
          shot.error
        ) {
          content +=
            `\n\n[AVISO] ${shot.error}`;
        }

        return content;
      }

      if (shot.status === 'cancelled') {
        return (
          `${header}\n` +
          `[CANCELADO] ${shot.error}`
        );
      }

      return (
        `${header}\n` +
        `[ERRO] ${
          shot.error ||
          'Não foi possível processar.'
        }`
      );
    })
    .join('\n\n');
}

async function runExtraction() {
  if (!shots.length) {
    status.textContent =
      'Selecione os prints primeiro.';

    return;
  }

  if (extractionRun.running) {
    status.textContent =
      'Já existe uma coleta em andamento.';

    return;
  }

  if (
    typeof Tesseract === 'undefined' ||
    typeof Tesseract.createWorker !== 'function'
  ) {
    status.textContent =
      'O leitor Tesseract não foi carregado na página.';

    updateExtractionPanel(
      'Tesseract não carregado'
    );

    return;
  }

  const runId =
    ++extractionRun.id;

  extractionRun.running = true;
  extractionRun.cancelled = false;
  extractionRun.startedAt = Date.now();
  extractionRun.finishedElapsedMs = 0;

  extractButton.disabled = true;
  reviewButton.disabled = true;
  fileInput.disabled = true;

  startElapsedTimer();

  updateExtractionPanel(
    'Preparando o leitor...'
  );

  let worker = null;

  try {
    status.textContent =
      'Preparando o leitor OCR...';

    worker =
      await Tesseract.createWorker('por');

    if (
      extractionRun.cancelled ||
      runId !== extractionRun.id
    ) {
      try {
        await worker.terminate();
      } catch {
        // Worker já pode ter sido encerrado.
      }

      return;
    }

    extractionRun.worker = worker;

    for (
      let index = 0;
      index < shots.length;
      index += 1
    ) {
      if (
        extractionRun.cancelled ||
        runId !== extractionRun.id
      ) {
        break;
      }

      const shot = shots[index];
      const startedAt =
        performance.now();

      shot.status = 'processing';
      shot.error = '';
      shot.durationMs = 0;

      status.textContent =
        `Lendo ${index + 1} de ` +
        `${shots.length} — ${shot.label}`;

      updateExtractionPanel(
        `Lendo ${index + 1} de ` +
        `${shots.length} — ${shot.label}`
      );

      renderStrip();

      try {
const robustResult =
  await recognizeShotRobustly(
    worker,
    shot,
    () =>
      extractionRun.cancelled ||
      runId !== extractionRun.id
  );

if (
  extractionRun.cancelled ||
  runId !== extractionRun.id
) {
  shot.status = 'cancelled';

  shot.error =
    'Processamento interrompido pelo usuário.';

  break;
}

const best =
  robustResult.best;

shot.text =
  String(
    best.text || ''
  ).trim();

shot.parsed =
  best.parsed ||
  parseText(shot.text);

shot.ocrMethod =
  best.label || '';

shot.ocrScore =
  Number(best.score) || 0;

shot.ocrConfidence =
  Number(best.confidence) || 0;

shot.ocrAttempts =
  robustResult.candidates.map(
    candidate => ({
      method:
        candidate.label,

      psm:
        candidate.psm,

      score:
        Math.round(
          candidate.score
        ),

      confidence:
        Math.round(
          candidate.confidence
        ),

      rarities:
        Object.keys(
          candidate.parsed
            ?.variants || {}
        ).length,

      attributes:
        countParsedAttributes(
          candidate.parsed
        )
    })
  );

classifyShotResult(shot);
      } catch (error) {
        if (
          extractionRun.cancelled ||
          runId !== extractionRun.id
        ) {
          shot.status = 'cancelled';

          shot.error =
            'Processamento interrompido pelo usuário.';

          break;
        }

        console.error(
          `[OCR] Falha em ${shot.label}:`,
          error
        );

        shot.status = 'error';

        shot.error =
          error?.message ||
          'Erro desconhecido durante o reconhecimento da imagem.';

        shot.text = '';
        shot.parsed = null;
      } finally {
        shot.durationMs =
          performance.now() - startedAt;

        buildRawText();
        renderStrip();
        updateExtractionPanel();
      }
    }

    if (extractionRun.cancelled) {
      for (const shot of shots) {
        if (shot.status === 'pending') {
          shot.status = 'cancelled';

          shot.error =
            'Não processado porque a coleta foi cancelada.';
        }
      }

      buildRawText();
      renderStrip();

      const summary =
        getExtractionSummary();

      status.textContent =
        `Coleta cancelada. ` +
        `${summary.processed} de ` +
        `${summary.total} arquivo(s) ` +
        'chegaram a ser processados. ' +
        'Os resultados concluídos foram preservados.';

      updateExtractionPanel(
        'Coleta cancelada'
      );

      return;
    }

    const recognized =
      new Set();

    shots.forEach(shot => {
      Object.keys(
        shot.parsed?.variants || {}
      ).forEach(slug => {
        recognized.add(slug);
      });
    });

    const summary =
      getExtractionSummary();

    status.textContent =
      `Leitura concluída. ` +
      `${summary.success} arquivo(s) concluído(s), ` +
      `${summary.warnings} com aviso e ` +
      `${summary.errors} com erro. ` +
      `${recognized.size} de ` +
      `${RARITIES.length} raridades reconhecidas.`;

    updateExtractionPanel(
      summary.problems
        ? 'Coleta concluída com avisos'
        : 'Coleta concluída com sucesso'
    );
  } catch (error) {
    if (extractionRun.cancelled) {
      status.textContent =
        'Coleta cancelada. Os resultados já ' +
        'concluídos foram preservados.';

      updateExtractionPanel(
        'Coleta cancelada'
      );

      return;
    }

    console.error('[OCR]', error);

    status.textContent =
      'Não foi possível iniciar ou continuar ' +
      `o leitor: ${
        error?.message ||
        'erro desconhecido'
      }`;

    updateExtractionPanel(
      'Falha geral no leitor OCR'
    );
  } finally {
    stopElapsedTimer();

    if (
      extractionRun.startedAt &&
      !extractionRun.finishedElapsedMs
    ) {
      extractionRun.finishedElapsedMs =
        Date.now() -
        extractionRun.startedAt;
    }

    if (
      extractionRun.worker === worker
    ) {
      extractionRun.worker = null;

      try {
        await worker?.terminate();
      } catch (error) {
        console.warn(
          '[OCR] Falha ao finalizar worker:',
          error
        );
      }
    }

    if (runId === extractionRun.id) {
      extractionRun.running = false;

      extractButton.disabled = false;
      reviewButton.disabled = false;
      fileInput.disabled = false;

      updateExtractionPanel();
    }
  }
}

extractButton.addEventListener(
  'click',
  () => {
    if (!shots.length) {
      status.textContent =
        'Selecione os prints primeiro.';

      return;
    }

    if (
      extractionTask ||
      extractionRun.running
    ) {
      status.textContent =
        'Já existe uma coleta em andamento.';

      return;
    }

    /*
      Ao clicar novamente em Extrair dados, os resultados
      anteriores são zerados.

      As imagens e os recortes permanecem.
    */

    resetExtractionState();

    extractionTask = runExtraction()
      .catch(error => {
        console.error(
          '[OCR] Erro não tratado:',
          error
        );
      })
      .finally(() => {
        extractionTask = null;
      });
  }
);

/* =========================================================
   REVISÃO E ENVIO
========================================================= */

reviewButton.addEventListener(
  'click',
  () => {
    if (extractionRun.running) {
      status.textContent =
        'Aguarde o término da coleta ou cancele ' +
        'antes de montar a revisão.';

      return;
    }

    if (
      !shots.some(
        shot => shot.parsed
      )
    ) {
      /*
        Permite revisar texto colado manualmente.
      */

      merged =
        parseText(raw.value);

      merged.description = '';
      merged.recommendation = '';
      merged.sources = {};
    } else {
      merged = mergeShots();
    }

    renderReview(merged);

    const count =
      Object.keys(
        merged.variants
      ).length;

    status.textContent = count
      ? (
          `Revisão montada com ${count} raridade(s). ` +
          'Confira antes de enviar.'
        )
      : (
          'Nenhuma raridade reconhecida. ' +
          'Revise o texto extraído.'
        );
  }
);

sendButton.addEventListener(
  'click',
  () => {
    const variants = {};

    reviewArea
      .querySelectorAll('.imp-rarity')
      .forEach(block => {
        const rarity =
          block.dataset.rarity;

        const stats = {};

        block
          .querySelectorAll('.imp-stat')
          .forEach(row => {
            const key =
              row.querySelector(
                '.imp-stat-key'
              )?.value;

            const value = Number(
              row.querySelector(
                '.imp-stat-value'
              )?.value
            );

            if (
              !key ||
              !Number.isFinite(value)
            ) {
              return;
            }

            stats[key] = value;
          });

        if (
          rarity &&
          Object.keys(stats).length
        ) {
          variants[rarity] = stats;
        }
      });

    const bonuses = [
      ...reviewArea.querySelectorAll(
        '.imp-bonus'
      )
    ]
      .map(row => {
        const inputs =
          row.querySelectorAll('input');

        return {
          required_pieces:
            Number(inputs[0]?.value) || 0,

          title:
            inputs[1]?.value.trim() || '',

          description:
            inputs[2]?.value.trim() || ''
        };
      })
      .filter(
        bonus =>
          bonus.required_pieces > 0
      );

    const draft = {
      name:
        $('r-name')?.value.trim() || '',

      setName:
        $('r-set')?.value.trim() || '',

      description:
        $('r-desc')?.value.trim() || '',

      recommendation:
        $('r-rec')?.value.trim() || '',

      variants,
      bonuses
    };

    if (!draft.name) {
      status.textContent =
        'Informe o nome do equipamento ' +
        'antes de enviar.';

      return;
    }

    sessionStorage.setItem(
      'equipment-import-draft',
      JSON.stringify(draft)
    );

    location.href =
      './equipment-editor.html?import=1';
  }
);

/* =========================================================
   LIMPEZA AO SAIR DA PÁGINA
========================================================= */

window.addEventListener(
  'beforeunload',
  () => {
    stopElapsedTimer();

    /*
      Não usamos await aqui porque beforeunload não aguarda
      Promises. O encerramento normal acontece no fluxo de OCR.
    */

    try {
      extractionRun.worker?.terminate();
    } catch {
      // Ignora erro durante o fechamento da página.
    }

    releaseShotUrls();
  }
);

/* =========================================================
   INICIALIZAÇÃO VISUAL
========================================================= */

injectStyles();

sendButton.disabled = true;

status.textContent =
  'Selecione os prints do equipamento para iniciar.';
