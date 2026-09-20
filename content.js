// Shopee Advanced Search - Fixed for Manifest V3 + updated DOM selectors
// Original: https://github.com/icetbr/webext-shopee-advanced-search

const $ = (selector, parent = document) => parent.querySelector(selector),
  $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector)),
  el = (name, attrs) => Object.assign(document.createElement(name), attrs),
  toBase64 = svg => `data:image/svg+xml;base64,${window.btoa(svg)}`,
  toSearchable = string => string
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, ''),
  isBrazil = () => window.location.hostname.endsWith('.br'),
  onMutation = fn => new MutationObserver(fn)
    .observe(document.body, { childList: true, subtree: true });

const split = value => value ? value.split(' ').filter(Boolean) : [];

const filterIconSvg = `
<svg width="26px" height="26px" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
<g stroke="currentColor">
<path d="m4.5 7.5h12"/>
<path d="m6.5 10.5h8"/>
<path d="m8.5 13.5h4"/>
</g>
</svg>`;

const powerIconSvg = fill => `
<svg width="22px" height="22px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<g stroke="${fill}" fill="none" stroke-width="2" stroke-linecap="round">
<path d="M12 3v8"/>
<path d="M6.5 6a8 8 0 1 0 11 0"/>
</g>
</svg>`;

const isThousands = string => ['k', 'mil'].some(s => string?.includes(s));

const parseNumber = string => {
  let number = parseFloat(string?.replace(',', '.').match(/[\d.]+/g));
  number = isThousands(string) ? number * 1000 : number;
  return isNaN(number) ? 0 : number;
};

// ─── Selector strategies ─────────────────────────────────────────────────────
// Shopee changes its DOM regularly. We try multiple known selector patterns.

const PRODUCT_SELECTORS = [
  // Current (2024-2025) Shopee layout
  '[data-sqe="item"]',
  '.shopee-search-item-result__item',
  // Generic fallbacks based on common Shopee class patterns
  'li.col-xs-2-4',
  '.item-card-list__item',
  // React-rendered grid items
  '._1NoI8_',
  '._2kOPfE',
];

const NAME_QUERIES = [
  // Try data attribute first (most stable)
  el => el.querySelector('[data-sqe="name"]')?.textContent,
  // Common class patterns for product name
  el => el.querySelector('._10Wbs- div')?.textContent,
  el => el.querySelector('.ie3A+e')?.textContent,
  el => el.querySelector('[class*="name"]')?.textContent,
  // Fallback: original deep traversal from the repo
  el => {
    const contentEl = el?.firstChild?.firstChild?.firstChild?.firstChild?.children?.[1];
    return contentEl?.children?.[0]?.textContent;
  },
  // Fallback: grab first reasonably-sized text node in the card
  el => {
    const texts = Array.from(el.querySelectorAll('*'))
      .map(n => n.childNodes)
      .reduce((a, b) => [...a, ...b], [])
      .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 5);
    return texts[0]?.textContent;
  },
];

const SOLD_QUERIES = [
  el => el.querySelector('[data-sqe="sold"]')?.textContent,
  el => el.querySelector('._1Wr91d')?.textContent,
  el => el.querySelector('[class*="sold"]')?.textContent,
  el => {
    const contentEl = el?.firstChild?.firstChild?.firstChild?.firstChild?.children?.[1];
    return contentEl?.children?.[1]?.children?.[1]?.textContent;
  },
];

const SEARCHBAR_SELECTORS = [
  '.shopee-searchbar-input',
  '[class*="searchbar"]',
  'form[class*="search"]',
  'header input[type="text"]',
];

const INPUT_SELECTORS = [
  '.shopee-searchbar-input__input',
  '[class*="searchbar"] input[type="text"]',
  'header input[type="text"]',
];

function findProducts() {
  for (const sel of PRODUCT_SELECTORS) {
    const items = $$(sel);
    if (items.length > 0) return items;
  }
  return [];
}

function getProductName(el) {
  for (const fn of NAME_QUERIES) {
    try {
      const text = fn(el);
      if (text && text.trim().length > 0) return text.trim();
    } catch (_) {}
  }
  return '';
}

function getSoldCount(el) {
  for (const fn of SOLD_QUERIES) {
    try {
      const text = fn(el);
      if (text && text.trim().length > 0) return text.trim();
    } catch (_) {}
  }
  return '0';
}

function findSearchBar() {
  for (const sel of SEARCHBAR_SELECTORS) {
    const el = $(sel);
    if (el) return el;
  }
  return null;
}

function findSearchInput() {
  for (const sel of INPUT_SELECTORS) {
    const el = $(sel);
    if (el) return el;
  }
  return null;
}

// ─── Core filter logic ────────────────────────────────────────────────────────

const filter = ($searchedWordsInput, $excludedWordsInput, $minimumSoldInput) => () => {
  const $products = findProducts();
  const searchedWords = split(toSearchable($searchedWordsInput.value));
  const excludedWords = split(toSearchable($excludedWordsInput.value));
  const minimumSold = parseNumber($minimumSoldInput.value);

  const wordRegex = w => new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i');
  const lacksAllSearchedWords = element =>
    searchedWords.length > 0 && !searchedWords.every(w => wordRegex(w).test(element.dataset.searchableText));
  const hasAnyExcludedWords = element =>
    excludedWords.some(w => wordRegex(w).test(element.dataset.searchableText));
  const hasSoldLessThan = element =>
    element.dataset.soldCount < minimumSold;

  const withSearchableText = el => {
    el.dataset.searchableText = toSearchable(getProductName(el));
    return el;
  };

  const withSoldCount = el => {
    el.dataset.soldCount = parseNumber(getSoldCount(el));
    return el;
  };

  const toggleHidden = (counts, el) => {
    if (lacksAllSearchedWords(el) || hasAnyExcludedWords(el)) {
      el.style.display = 'none';
      counts[0]++;
    } else if (!isNaN(minimumSold) && minimumSold > 0 && hasSoldLessThan(el)) {
      el.style.display = 'none';
      counts[1]++;
    } else {
      el.style.display = '';
    }
    return counts;
  };

  let $loadedProducts = $products
    .map(withSearchableText)
    .filter(p => p.dataset.searchableText);

  if (!isNaN(minimumSold) && minimumSold > 0) {
    $loadedProducts = $loadedProducts.map(withSoldCount);
  }

  const hiddenCounts = $loadedProducts.reduce(toggleHidden, [0, 0]);

  const excludedMsg = excludedWords.length ? ` -'${excludedWords.join(' ')}'` : '';
  console.log(
    '[ShopeeFilter] ' +
    $products.length + ' products, ' +
    $loadedProducts.length + ' loaded, ' +
    `${hiddenCounts[0]} hidden for '${searchedWords.join(' ')}'${excludedMsg},` +
    `${hiddenCounts[1]} hidden for less than ${minimumSold} sold`
  );
};

// ─── Enabled/disabled state ─────────────────────────────────────────────────

const STORAGE_KEY = 'sas-enabled';
const isEnabled = () => localStorage.getItem(STORAGE_KEY) !== 'off';
const setEnabled = value => localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');

const showAllProducts = () => findProducts().forEach(p => { p.style.display = ''; });

// ─── Init ─────────────────────────────────────────────────────────────────────

let filterProducts;
const init = () => {
  if (isEnabled()) {
    filterProducts && filterProducts();
  }

  const $searchBar = findSearchBar();
  if (!$searchBar || $searchBar.querySelector('#sas-excludedWords')) return;

  console.log('[ShopeeFilter] enabled');

  const $searchedWordsInput = findSearchInput();
  if (!$searchedWordsInput) return;

  const $minimumSoldInput = el('input', {
    id: 'sas-minimumSold',
    style: 'width: 70px; margin: 0 4px; padding: 0 6px; border: 1px solid #ccc; border-radius: 4px;',
    placeholder: isBrazil() ? 'vendido X+' : 'sold X+',
    title: isBrazil()
      ? 'Ocultar produtos com menos vendas que este número. Ex: 100'
      : 'Hide products with fewer sales than this number. e.g. 100',
    onkeyup: function(e) { if (e.key === 'Enter' && isEnabled()) filterProducts(); }
  });

  const $excludedWordsInput = el('input', {
    id: 'sas-excludedWords',
    style: 'width: 130px; margin: 0 4px; padding: 0 6px; border: 1px solid #ccc; border-radius: 4px;',
    placeholder: isBrazil() ? 'excluir palavras' : 'exclude words',
    title: isBrazil()
      ? 'Oculta produtos que contenham qualquer uma destas palavras.\nSepare com espaço. Ex: usado ti replica'
      : 'Hides products containing ANY of these words (whole-word match).\nSeparate with a space. e.g. used ti replica',
    onkeyup: function(e) { if (e.key === 'Enter' && isEnabled()) filterProducts(); }
  });

  filterProducts = filter($searchedWordsInput, $excludedWordsInput, $minimumSoldInput);

  const $filterButton = el('button', {
    type: 'button',
    onclick: () => isEnabled() && filterProducts(),
    title: isBrazil() ? 'Aplicar filtro' : 'Apply filter',
    style: `
      background: no-repeat url(${toBase64(filterIconSvg)});
      padding: 13px;
      margin-top: 3px;
      border: none;
      cursor: pointer;
    `,
  });

  const $clearButton = el('button', {
    type: 'button',
    textContent: '✕',
    title: isBrazil() ? 'Limpar filtros' : 'Clear filters',
    onclick: () => {
      $minimumSoldInput.value = '';
      $excludedWordsInput.value = '';
      if (isEnabled()) filterProducts();
    },
    style: `
      background: transparent;
      border: none;
      color: #999;
      font-size: 14px;
      cursor: pointer;
      margin-left: 2px;
      padding: 4px 6px;
    `,
  });

  const applyToggleStyle = () => {
    const on = isEnabled();
    $toggleButton.style.background = `no-repeat center url(${toBase64(powerIconSvg(on ? '#EE4D2D' : '#999'))})`;
    $toggleButton.title = on ? 'Filter is ON (click to turn off)' : 'Filter is OFF (click to turn on)';
    $minimumSoldInput.disabled = !on;
    $excludedWordsInput.disabled = !on;
    $filterButton.disabled = !on;
    $minimumSoldInput.style.opacity = on ? '1' : '0.5';
    $excludedWordsInput.style.opacity = on ? '1' : '0.5';
    $filterButton.style.opacity = on ? '1' : '0.5';
    $clearButton.style.opacity = on ? '1' : '0.5';
  };

  const $toggleButton = el('button', {
    id: 'sas-toggle',
    type: 'button',
    onclick: () => {
      const nowOn = !isEnabled();
      setEnabled(nowOn);
      applyToggleStyle();
      if (nowOn) {
        filterProducts();
      } else {
        showAllProducts();
      }
    },
    style: `
      padding: 13px;
      margin-top: 3px;
      margin-left: 2px;
      border: none;
      cursor: pointer;
      background-size: contain;
    `,
  });

  applyToggleStyle();

  $searchBar.appendChild($minimumSoldInput);
  $searchBar.appendChild($excludedWordsInput);
  $searchBar.appendChild($clearButton);
  $searchBar.appendChild($filterButton);
  $searchBar.appendChild($toggleButton);
};

onMutation(init);
