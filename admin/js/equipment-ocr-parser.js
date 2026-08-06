
const RARITY_ALIASES = [
  ['comum','comum'],['raro','raro'],['épico','epico'],['epico','epico'],
  ['lendário','lendario'],['lendario','lendario'],['mítico','mitico'],['mitico','mitico'],
  ['supremo','supremo'],['grandioso','grandioso'],['celestial','celestial'],
  ['estelar','estelar'],['imortal','imortal'],['divino','divino']
];

function clean(text) {
  return String(text || '')
    .replace(/\r/g,'')
    .replace(/[•●▪]/g,'*')
    .replace(/[ \t]+/g,' ')
    .trim();
}

function normalizeKey(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}

function detectRarity(line) {
  const n = normalizeKey(line);
  const found = RARITY_ALIASES.find(([label]) => n.includes(normalizeKey(label)));
  return found?.[1] || null;
}

function extractAttributeLines(block) {
  return block
    .split('\n')
    .map(clean)
    .filter(Boolean)
    .filter(line => /[+\-]?\d/.test(line))
    .map((line, index) => ({
      key: `atributo_${index+1}`,
      label: line.replace(/^[-*]\s*/,''),
      value: null,
      raw: line
    }));
}

export function parseEquipmentText(rawText) {
  const text = clean(rawText);
  const lines = text.split('\n').map(clean).filter(Boolean);

  const nameLine = lines.find(line => /implante|eye|e\.?y\.?e\.?/i.test(line)) || lines[0] || '';
  const setLine = lines.find(line => /conjunto/i.test(line)) || '';

  const result = {
    name: nameLine.replace(/conjunto.*$/i,'').trim(),
    setName: setLine.replace(/^.*conjunto\s*/i,'Conjunto ').trim(),
    description: '',
    recommendation: '',
    variants: {},
    bonuses: []
  };

  let current = null;
  let bucket = [];

  const flush = () => {
    if (current) result.variants[current] = extractAttributeLines(bucket.join('\n'));
    bucket = [];
  };

  for (const line of lines) {
    const rarity = detectRarity(line);
    if (rarity) {
      flush();
      current = rarity;
      continue;
    }
    if (current) bucket.push(line);
  }
  flush();

  const bonusPatterns = [
    { pieces: 2, regex: /2\s*pe[cç]as/i },
    { pieces: 4, regex: /4\s*pe[cç]as/i },
    { pieces: 6, regex: /6\s*pe[cç]as|conjunto completo/i }
  ];

  for (const item of bonusPatterns) {
    const index = lines.findIndex(line => item.regex.test(line));
    if (index >= 0) {
      const desc = [];
      for (let i=index+1; i<lines.length; i++) {
        if (bonusPatterns.some(x => x.regex.test(lines[i]))) break;
        if (lines[i]) desc.push(lines[i]);
      }
      result.bonuses.push({
        required_pieces: item.pieces,
        title: item.pieces === 6 ? 'Conjunto completo' : `Bônus de ${item.pieces} peças`,
        description: desc.join(' ')
      });
    }
  }

  return result;
}
