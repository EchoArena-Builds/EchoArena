import {
  getEquipmentBundle,
  loadEquipmentMeta
} from './equipment-api.js';

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeKey(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return 'Não informado';
  }

  if (typeof value === 'boolean') {
    return value ? 'Ativo' : 'Inativo';
  }

  return String(value);
}

function comparable(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function toAttributes(value) {
  if (Array.isArray(value)) {
    return value.map(item => ({
      label: String(item?.label ?? item?.name ?? item?.raw ?? '').trim(),
      value: item?.value ?? ''
    })).filter(item => item.label);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([label, attributeValue]) => ({
      label,
      value: attributeValue
    }));
  }

  return [];
}

function makeDiff(group, label, before, after) {
  const beforeText = comparable(before);
  const afterText = comparable(after);
  const changed = beforeText !== afterText;
  let kind = 'equal';

  if (changed) {
    const beforeNumber = numericValue(before);
    const afterNumber = numericValue(after);

    if (beforeNumber !== null && afterNumber !== null) {
      kind = afterNumber > beforeNumber ? 'increase' : 'decrease';
    } else {
      kind = 'text';
    }
  }

  return {group, label, before, after, changed, kind};
}

function buildComparison(bundle, draft, meta) {
  const equipment = bundle.equipment;
  const selectedSet = meta.sets.find(item =>
    normalizeKey(item.name) === normalizeKey(draft.setName) ||
    normalizeKey(item.slug) === normalizeKey(draft.setName)
  );
  const oldSet = meta.sets.find(item => item.id === equipment.set_id);
  const oldSlot = meta.slots.find(item => item.id === equipment.slot_id);
  const newSlot = meta.slots.find(item =>
    item.id === (draft.slotId || draft.slot_id) ||
    normalizeKey(item.slug) === normalizeKey(draft.slotSlug) ||
    normalizeKey(item.name) === normalizeKey(draft.slotName)
  );
  const preserve = (incoming, current) =>
    incoming === null || incoming === undefined || incoming === ''
      ? current
      : incoming;

  const diffs = [
    makeDiff('Geral', 'Nome', equipment.name, preserve(draft.name, equipment.name)),
    makeDiff('Geral', 'Slug', equipment.slug, preserve(draft.slug, equipment.slug)),
    makeDiff('Geral', 'Slot', oldSlot?.name || equipment.slot_id, newSlot?.name || oldSlot?.name || equipment.slot_id),
    makeDiff('Geral', 'Conjunto', oldSet?.name || 'Sem conjunto', draft.setName ? (selectedSet?.name || draft.setName) : (oldSet?.name || 'Sem conjunto')),
    makeDiff('Geral', 'Descrição', equipment.description, preserve(draft.description, equipment.description)),
    makeDiff('Geral', 'Recomendação', equipment.recommendation, preserve(draft.recommendation, equipment.recommendation)),
    makeDiff('Geral', 'Ordem', equipment.display_order ?? 0, draft.displayOrder ?? equipment.display_order ?? 0),
    makeDiff('Geral', 'Publicação', equipment.enabled !== false, draft.enabled ?? (equipment.enabled !== false))
  ];

  const oldVariants = new Map(
    bundle.variants.map(row => [row.equipment_rarities?.slug, toAttributes(row.attributes)])
  );

  for (const rarity of meta.rarities) {
    if (!Object.prototype.hasOwnProperty.call(draft.variants || {}, rarity.slug)) continue;
    const oldAttributes = oldVariants.get(rarity.slug) || [];
    const newAttributes = toAttributes(draft.variants[rarity.slug]);
    const oldMap = new Map(oldAttributes.map(item => [normalizeKey(item.label), item]));
    const newMap = new Map(newAttributes.map(item => [normalizeKey(item.label), item]));
    const keys = new Set([...oldMap.keys(), ...newMap.keys()]);

    for (const key of keys) {
      const oldAttribute = oldMap.get(key);
      const newAttribute = newMap.get(key);
      diffs.push(makeDiff(
        `Raridade · ${rarity.name || rarity.slug}`,
        newAttribute?.label || oldAttribute?.label || key,
        oldAttribute?.value,
        newAttribute?.value
      ));
    }
  }

  const oldBonuses = new Map(bundle.bonuses.map(item => [Number(item.required_pieces), item]));
  const newBonuses = new Map((draft.bonuses || []).map(item => [Number(item.required_pieces), item]));
  const bonusKeys = new Set([...oldBonuses.keys(), ...newBonuses.keys()]);

  for (const pieces of bonusKeys) {
    const oldBonus = oldBonuses.get(pieces);
    const newBonus = newBonuses.get(pieces);
    diffs.push(makeDiff(
      'Bônus do conjunto',
      `${pieces} equipamentos`,
      oldBonus?.description,
      newBonus?.description
    ));
  }

  return diffs;
}

function renderComparison(host, diffs) {
  const changed = diffs.filter(item => item.changed);
  const counts = {
    increase: diffs.filter(item => item.kind === 'increase').length,
    decrease: diffs.filter(item => item.kind === 'decrease').length,
    text: diffs.filter(item => item.kind === 'text').length,
    equal: diffs.filter(item => item.kind === 'equal').length
  };
  const groups = [...new Set(changed.map(item => item.group))];
  const rows = groups.map(group => `
    <section class="equipment-change-group">
      <h4>${escapeHtml(group)}</h4>
      ${changed.filter(item => item.group === group).map(item => {
        const beforeNumber = numericValue(item.before);
        const afterNumber = numericValue(item.after);
        const largeChange = beforeNumber !== null && afterNumber !== null && beforeNumber !== 0 && Math.abs((afterNumber - beforeNumber) / beforeNumber) >= .8;
        return `<div class="equipment-change-row">
          <strong>${escapeHtml(item.label)}${largeChange ? ' · ⚠ alteração superior a 80%' : ''}</strong>
          <div class="equipment-change-values">
            <span class="equipment-change-before"><small>ANTES</small><br>${escapeHtml(displayValue(item.before))}</span>
            <span class="equipment-change-arrow">→</span>
            <span class="equipment-change-after"><small>AGORA</small><br>${escapeHtml(displayValue(item.after))}</span>
          </div>
        </div>`;
      }).join('')}
    </section>
  `).join('');

  host.innerHTML = `
    <div class="equipment-change-head">
      <div><h3>Comparação com o equipamento cadastrado</h3><p>Somente os campos diferentes são exibidos abaixo.</p></div>
    </div>
    <div class="equipment-change-summary">
      <div class="equipment-change-stat"><strong>${changed.length}</strong><small>alterações</small></div>
      <div class="equipment-change-stat"><strong>${counts.increase}</strong><small>aumentos</small></div>
      <div class="equipment-change-stat"><strong>${counts.decrease}</strong><small>reduções</small></div>
      <div class="equipment-change-stat"><strong>${counts.text}</strong><small>textos modificados</small></div>
      <div class="equipment-change-stat"><strong>${counts.equal}</strong><small>campos iguais</small></div>
    </div>
    ${changed.length ? rows : '<div class="equipment-change-empty"><strong>Nenhuma alteração encontrada</strong><br>Os dados importados são idênticos aos já cadastrados.</div>'}
  `;
  host.classList.add('is-visible');
}

async function initComparison(params, importedDraft) {
  const host = document.getElementById('equipment-change-review');
  const equipmentId = params.get('id');
  if (!host || !equipmentId || !importedDraft) return;

  try {
    const [bundle, meta] = await Promise.all([
      getEquipmentBundle(equipmentId),
      loadEquipmentMeta()
    ]);
    renderComparison(host, buildComparison(bundle, importedDraft, meta));
  } catch (error) {
    console.error('Erro ao comparar equipamento:', error);
    host.innerHTML = '<div class="equipment-change-empty">Não foi possível carregar a comparação. Os dados do formulário continuam disponíveis para revisão.</div>';
    host.classList.add('is-visible');
  }
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível preparar o recorte da imagem.'));
    };
    image.src = url;
  });
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem enquadrada.')), type, .92);
  });
}

function initImageCrop() {
  const form = document.getElementById('form');
  const fileInput = document.getElementById('image-file');
  const cardPreview = document.getElementById('preview-image');
  const fullPreview = document.getElementById('preview-full-image');
  const zoom = document.getElementById('equipment-crop-zoom');
  const positionX = document.getElementById('equipment-crop-x');
  const positionY = document.getElementById('equipment-crop-y');
  const zoomValue = document.getElementById('equipment-crop-zoom-value');
  const xValue = document.getElementById('equipment-crop-x-value');
  const yValue = document.getElementById('equipment-crop-y-value');
  const reset = document.getElementById('equipment-crop-reset');
  const status = document.getElementById('equipment-crop-status');
  if (!form || !fileInput || !cardPreview || !fullPreview) return;

  let submittingCroppedFile = false;

  const syncFullPreview = () => {
    const sourceImage = cardPreview.querySelector('img');
    if (!sourceImage?.src) return;
    const current = fullPreview.querySelector('img');
    if (current?.src === sourceImage.src) return;
    const image = document.createElement('img');
    image.src = sourceImage.src;
    image.alt = 'Imagem completa do equipamento';
    fullPreview.replaceChildren(image);
  };

  const applyPreviewTransform = () => {
    const image = cardPreview.querySelector('img');
    const zoomNumber = Number(zoom?.value || 100);
    const xNumber = Number(positionX?.value || 0);
    const yNumber = Number(positionY?.value || 0);
    if (image) image.style.transform = `translate(${xNumber}%, ${yNumber}%) scale(${zoomNumber / 100})`;
    if (zoomValue) zoomValue.value = `${zoomNumber}%`;
    if (xValue) xValue.value = String(xNumber);
    if (yValue) yValue.value = String(yNumber);
    if (status) status.textContent = fileInput.files?.[0]
      ? 'Este enquadramento será aplicado ao arquivo salvo.'
      : 'Selecione uma nova imagem para aplicar o enquadramento.';
  };

  new MutationObserver(() => {
    syncFullPreview();
    applyPreviewTransform();
  }).observe(cardPreview, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});

  [zoom, positionX, positionY].forEach(control => control?.addEventListener('input', applyPreviewTransform));
  fileInput.addEventListener('change', () => {
    if (zoom) zoom.value = '100';
    if (positionX) positionX.value = '0';
    if (positionY) positionY.value = '0';
    window.setTimeout(applyPreviewTransform, 0);
  });
  reset?.addEventListener('click', () => {
    if (zoom) zoom.value = '100';
    if (positionX) positionX.value = '0';
    if (positionY) positionY.value = '0';
    applyPreviewTransform();
  });

  form.addEventListener('submit', async event => {
    const file = fileInput.files?.[0];
    if (submittingCroppedFile || !file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const submitter = event.submitter;
    if (status) status.textContent = 'Aplicando enquadramento...';

    try {
      const image = await loadImageFile(file);
      const size = 1000;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      const zoomScale = Number(zoom?.value || 100) / 100;
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoomScale;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const x = (size - width) / 2 + (Number(positionX?.value || 0) / 100) * width;
      const y = (size - height) / 2 + (Number(positionY?.value || 0) / 100) * height;
      context.drawImage(image, x, y, width, height);
      const outputType = file.type === 'image/png' ? 'image/png' : 'image/webp';
      const blob = await canvasBlob(canvas, outputType);
      const extension = outputType === 'image/png' ? 'png' : 'webp';
      const croppedFile = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-enquadrada.${extension}`, {type: outputType});
      const transfer = new DataTransfer();
      transfer.items.add(croppedFile);
      fileInput.files = transfer.files;
      submittingCroppedFile = true;
      if (status) status.textContent = 'Enquadramento aplicado.';
      form.requestSubmit(submitter || undefined);
    } catch (error) {
      console.error('Erro ao enquadrar imagem:', error);
      if (status) status.textContent = error.message || 'Não foi possível aplicar o enquadramento.';
      window.alert(error.message || 'Não foi possível aplicar o enquadramento da imagem.');
    }
  }, true);

  syncFullPreview();
  applyPreviewTransform();
}

function ensureSaveFeedbackUi() {
  let overlay = document.getElementById('equipment-save-feedback');
  if (overlay) return overlay;

  const style = document.createElement('style');
  style.id = 'equipment-save-feedback-style';
  style.textContent = `
    .equipment-save-feedback{position:fixed;inset:0;z-index:20000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(1,7,17,.95);backdrop-filter:blur(9px);color:#f8fafc}
    .equipment-save-feedback.is-visible{display:flex}
    .equipment-save-feedback-card{width:min(680px,100%);overflow:hidden;border:1px solid #2a405d;border-radius:24px;background:#081525;box-shadow:0 35px 100px rgba(0,0,0,.65);text-align:center}
    .equipment-save-feedback-line{height:4px;background:linear-gradient(90deg,#6d28d9,#a855f7)}
    .equipment-save-feedback.is-success .equipment-save-feedback-card{border-color:#19875c}.equipment-save-feedback.is-success .equipment-save-feedback-line{background:#35df8d}
    .equipment-save-feedback.is-error .equipment-save-feedback-card{border-color:#b83f52}.equipment-save-feedback.is-error .equipment-save-feedback-line{background:#fb7185}
    .equipment-save-feedback-body{padding:34px 36px 30px}
    .equipment-save-feedback-icon{width:96px;height:96px;margin:0 auto 20px;display:grid;place-items:center;border:2px solid #9b5cf6;border-radius:50%;color:#c4a1ff;font-size:48px;box-shadow:0 0 0 12px rgba(139,92,246,.06)}
    .equipment-save-feedback.is-success .equipment-save-feedback-icon{border-color:#35df8d;color:#70efae}.equipment-save-feedback.is-error .equipment-save-feedback-icon{border-color:#fb7185;color:#fda4af}
    .equipment-save-spinner{width:38px;height:38px;border:4px solid rgba(255,255,255,.13);border-top-color:#b384ff;border-radius:50%;animation:equipment-save-spin .8s linear infinite}
    @keyframes equipment-save-spin{to{transform:rotate(360deg)}}
    .equipment-save-feedback-kicker{color:#b994f5;font-size:11px;font-weight:900;letter-spacing:.15em}.equipment-save-feedback.is-success .equipment-save-feedback-kicker{color:#79edae}.equipment-save-feedback.is-error .equipment-save-feedback-kicker{color:#fda4af}
    .equipment-save-feedback h2{margin:9px 0;font-size:30px;line-height:1.2}.equipment-save-feedback-copy{color:#aab6c8;font-size:13px;line-height:1.6}
    .equipment-save-feedback-name{margin:22px 0;padding:17px;border:1px solid #283a55;border-radius:13px;background:#07101d;color:#fff;font-size:21px;font-weight:900}
    .equipment-save-feedback-details{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.equipment-save-feedback-details div{padding:12px;border:1px solid #283a55;border-radius:10px;color:#b9c4d5;font-size:11px}
    .equipment-save-feedback-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:25px}.equipment-save-feedback-button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 17px;border:1px solid #344763;border-radius:11px;background:#101d31;color:#fff;text-decoration:none;font-size:12px;font-weight:800;cursor:pointer}.equipment-save-feedback-button.primary{border:0;background:linear-gradient(135deg,#9857f7,#6d28d9);box-shadow:0 9px 26px rgba(124,58,237,.28)}
    @media(max-width:600px){.equipment-save-feedback{padding:10px}.equipment-save-feedback-body{padding:26px 18px}.equipment-save-feedback h2{font-size:24px}.equipment-save-feedback-details{grid-template-columns:1fr}.equipment-save-feedback-button{flex:1}}
  `;
  document.head.appendChild(style);

  overlay = document.createElement('div');
  overlay.id = 'equipment-save-feedback';
  overlay.className = 'equipment-save-feedback';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-live', 'assertive');
  document.body.appendChild(overlay);
  return overlay;
}

function equipmentFormStats() {
  const rarityCount = document.querySelectorAll('[data-rarity], .rarity-card, .rarity-block').length || Number(document.getElementById('import-rarity-count')?.textContent) || 0;
  const attributeCount = document.querySelectorAll('.attr-row').length || Number(document.getElementById('import-attribute-count')?.textContent) || 0;
  const bonusCount = document.querySelectorAll('.bonus-row').length || Number(document.getElementById('import-bonus-count')?.textContent) || 0;
  return {rarityCount, attributeCount, bonusCount};
}

function initSaveFeedback(params) {
  const form = document.getElementById('form');
  const message = document.getElementById('message');
  if (!form || !message) return;

  const overlay = ensureSaveFeedbackUi();
  const wasEditing = Boolean(params.get('id'));
  const receiptKey = 'equipment-save-success-receipt';
  let savePending = false;
  let timeoutId = null;

  const equipmentName = () =>
    document.getElementById('name')?.value?.trim() || 'Equipamento';

  const openOverlay = state => {
    overlay.className = `equipment-save-feedback is-visible ${state ? `is-${state}` : ''}`;
    document.documentElement.style.overflow = 'hidden';
  };

  const closeOverlay = () => {
    sessionStorage.removeItem(receiptKey);
    overlay.className = 'equipment-save-feedback';
    overlay.innerHTML = '';
    document.documentElement.style.overflow = '';
    document.querySelectorAll('#form button[type="submit"]').forEach(button => { button.disabled = false; });
  };

  const showSaving = () => {
    openOverlay('saving');
    overlay.innerHTML = `<div class="equipment-save-feedback-card"><div class="equipment-save-feedback-line"></div><div class="equipment-save-feedback-body">
      <div class="equipment-save-feedback-icon"><span class="equipment-save-spinner"></span></div>
      <div class="equipment-save-feedback-kicker">GRAVANDO NO BANCO DE DADOS</div>
      <h2>Salvando equipamento...</h2>
      <div class="equipment-save-feedback-copy">Aguarde a confirmação. Não feche esta página.</div>
      <div class="equipment-save-feedback-name">${escapeHtml(equipmentName())}</div>
    </div></div>`;
  };

  const showSuccess = (text, restoredReceipt = null) => {
    savePending = false;
    window.clearTimeout(timeoutId);
    const currentParams = new URLSearchParams(location.search);
    const editingNow = restoredReceipt?.editing ?? (wasEditing || Boolean(currentParams.get('id')));
    const stats = restoredReceipt?.stats || equipmentFormStats();
    const savedId = restoredReceipt?.savedId || currentParams.get('id');
    const savedName = restoredReceipt?.name || equipmentName();
    const confirmedText = restoredReceipt?.text || text || 'Os dados foram confirmados no banco de dados.';

    if (!restoredReceipt) {
      sessionStorage.setItem(receiptKey, JSON.stringify({
        editing: editingNow,
        stats,
        savedId: savedId || null,
        name: savedName,
        text: confirmedText,
        createdAt: Date.now()
      }));
    }

    openOverlay('success');
    overlay.innerHTML = `<div class="equipment-save-feedback-card"><div class="equipment-save-feedback-line"></div><div class="equipment-save-feedback-body">
      <div class="equipment-save-feedback-icon">✓</div>
      <div class="equipment-save-feedback-kicker">${editingNow ? 'ATUALIZAÇÃO CONCLUÍDA' : 'CADASTRO CONCLUÍDO'}</div>
      <h2>Equipamento ${editingNow ? 'atualizado' : 'salvo'} com sucesso!</h2>
      <div class="equipment-save-feedback-copy">${escapeHtml(confirmedText)}</div>
      <div class="equipment-save-feedback-name">${escapeHtml(savedName)}</div>
      <div class="equipment-save-feedback-details"><div>✓ Informações gerais confirmadas</div><div>✓ ${stats.rarityCount} raridades processadas</div><div>✓ ${stats.attributeCount} atributos confirmados</div><div>✓ ${stats.bonusCount} bônus processados</div></div>
      <div class="equipment-save-feedback-actions"><button type="button" class="equipment-save-feedback-button" data-save-action="continue">Continuar editando</button><a class="equipment-save-feedback-button" href="./equipments.html">Voltar à lista</a><a class="equipment-save-feedback-button primary" href="${savedId ? `./equipment-editor.html?id=${encodeURIComponent(savedId)}` : './equipments.html'}">${savedId ? 'Abrir equipamento salvo' : 'Ver equipamentos'}</a></div>
    </div></div>`;
    overlay.querySelector('[data-save-action="continue"]')?.addEventListener('click', closeOverlay);
    overlay.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => sessionStorage.removeItem(receiptKey));
    });
  };

  const showError = text => {
    savePending = false;
    window.clearTimeout(timeoutId);
    openOverlay('error');
    overlay.innerHTML = `<div class="equipment-save-feedback-card"><div class="equipment-save-feedback-line"></div><div class="equipment-save-feedback-body">
      <div class="equipment-save-feedback-icon">!</div><div class="equipment-save-feedback-kicker">FALHA NO SALVAMENTO</div><h2>O equipamento não foi salvo</h2>
      <div class="equipment-save-feedback-copy">${escapeHtml(text || 'Revise os dados e tente novamente.')}</div>
      <div class="equipment-save-feedback-actions"><button type="button" class="equipment-save-feedback-button primary" data-save-action="close">Voltar ao editor</button></div>
    </div></div>`;
    overlay.querySelector('[data-save-action="close"]')?.addEventListener('click', closeOverlay);
  };

  const inspectMessage = () => {
    if (!savePending) return;
    const text = message.textContent?.trim() || '';
    if (!text) return;
    if (/sucesso|\bsalv[oa]\b|\batualizad[oa]\b|conclu[ií]d/i.test(text)) {
      showSuccess(text);
    } else if (/erro|falha|n[aã]o foi poss[ií]vel|inv[aá]lid|obrigat[oó]ri/i.test(text)) {
      showError(text);
    }
  };

  new MutationObserver(inspectMessage).observe(message, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true
  });

  form.addEventListener('submit', () => {
    savePending = true;
    document.querySelectorAll('#form button[type="submit"]').forEach(button => { button.disabled = true; });
    showSaving();
    timeoutId = window.setTimeout(() => {
      if (savePending) showError('O banco de dados não confirmou o salvamento dentro do tempo esperado. Confira sua conexão e tente novamente.');
    }, 45000);
    window.setTimeout(inspectMessage, 0);
  }, true);

  try {
    const receipt = JSON.parse(sessionStorage.getItem(receiptKey) || 'null');
    const currentId = new URLSearchParams(location.search).get('id');
    const currentName = equipmentName();
    const fresh = receipt?.createdAt && Date.now() - receipt.createdAt < 10 * 60 * 1000;
    const sameEquipment =
      (receipt?.savedId && currentId && receipt.savedId === currentId) ||
      (receipt?.name && currentName && normalizeKey(receipt.name) === normalizeKey(currentName));

    if (receipt && fresh && sameEquipment) {
      window.setTimeout(() => showSuccess(receipt.text, receipt), 0);
    } else if (receipt) {
      sessionStorage.removeItem(receiptKey);
    }
  } catch {
    sessionStorage.removeItem(receiptKey);
  }
}

export async function initEquipmentEditorEnhancements({params, importedDraft}) {
  await initComparison(params, importedDraft);
  initImageCrop();
  initSaveFeedback(params);
}
