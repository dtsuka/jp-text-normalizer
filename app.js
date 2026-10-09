(function () {
  'use strict';
  var N = window.PdfTextNormalizer;
  var $ = function (id) { return document.getElementById(id); };
  var input = $('input'), preview = $('preview'), output = $('output');
  var STORE_KEY = 'pdf-text-normalizer:v1';
  var MAX_ROWS = 1500;

  var state = {
    enabled: N.defaultEnabled(),
    applySuggestions: false,
    detectIdeographicSpace: false,
    onlyFound: true,
    filterCat: '',
    result: { issues: [], counts: {}, length: 0 },
    outputFresh: false
  };

  // 設定の保存・復元（テキストは保存しない）
  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) {
      Object.keys(saved.enabled || {}).forEach(function (k) { if (k in state.enabled) state.enabled[k] = !!saved.enabled[k]; });
      state.applySuggestions = !!saved.applySuggestions;
      state.detectIdeographicSpace = !!saved.detectIdeographicSpace;
      if (typeof saved.onlyFound === 'boolean') state.onlyFound = saved.onlyFound;
    }
  } catch (e) { /* ignore */ }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        enabled: state.enabled, applySuggestions: state.applySuggestions,
        detectIdeographicSpace: state.detectIdeographicSpace, onlyFound: state.onlyFound
      }));
    } catch (e) { /* ignore */ }
  }
  function convOpts() {
    return { enabled: state.enabled, applySuggestions: state.applySuggestions, detectIdeographicSpace: state.detectIdeographicSpace };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function visible(s) {
    // 置換後の文字列を表で見やすく
    if (s === '') return '（削除）';
    if (s === ' ') return '␣（半角スペース）';
    if (s === '\n') return '↵（改行）';
    return s;
  }
  var SHORT = { 0x200B: 'ZWSP', 0x200C: 'ZWNJ', 0x200D: 'ZWJ', 0x200E: 'LRM', 0x200F: 'RLM', 0xFEFF: 'BOM', 0x00AD: 'SHY',
    0x2060: 'WJ', 0x2028: 'LS', 0x2029: 'PS', 0x00A0: 'NBSP', 0x3000: '全角SP', 0x034F: 'CGJ' };
  function needsBadge(issue) {
    var cps = issue.codePoints;
    if (cps.length !== 1) return false;
    var c = cps[0], gc = issue.chars[0].gc;
    return gc === 'Cf' || gc === 'Cc' || gc === 'Zl' || gc === 'Zp' || gc === 'Mn' || gc === 'Zs' || gc === 'Cs' ||
      (c >= 0xFE00 && c <= 0xFE0F) || (c >= 0xE0100 && c <= 0xE01EF) || (c >= 0xE0000 && c <= 0xE007F);
  }
  function badgeText(issue) {
    var c = issue.codePoints[0];
    if (SHORT[c]) return SHORT[c];
    if ((c >= 0xFE00 && c <= 0xFE0F)) return 'VS' + (c - 0xFE00 + 1);
    if (c >= 0xE0100 && c <= 0xE01EF) return 'VS' + (c - 0xE0100 + 17);
    if (c === 0x3099) return '◌゙';
    if (c === 0x309A) return '◌゚';
    return N.uplus(c);
  }

  /* ---------------- 解析と描画 ---------------- */
  function analyze() {
    var text = input.value;
    state.result = N.analyze(text, { detectIdeographicSpace: state.detectIdeographicSpace });
    $('input-stat').textContent = state.result.length.toLocaleString() + ' 文字';
    updateButtons();
    renderPreview(text);
    renderCategories();
    renderTable();
    renderSummary();
    if (state.outputFresh) {
      state.outputFresh = false;
      $('output-stat').textContent = '入力または設定が変更されました。もう一度「正規化する」を押してください。';
    }
  }

  function renderSummary() {
    var r = state.result, n = r.issues.length;
    var by = { error: 0, warning: 0, info: 0 };
    r.issues.forEach(function (x) { by[x.severity]++; });
    var conv = r.issues.filter(function (x) { return N.willConvert(x, convOpts()); }).length;
    $('summary-line').textContent = n === 0
      ? (input.value ? '問題のある文字は見つかりませんでした 🎉' : '問題は見つかっていません')
      : '指摘 ' + n + ' 件（要修正 ' + by.error + '・要確認 ' + by.warning + '・参考 ' + by.info + '）／ 正規化で変換されるもの ' + conv + ' 件';
  }

  function renderPreview(text) {
    var issues = state.result.issues;
    preview.textContent = '';
    if (!text) {
      preview.appendChild(el('span', 'placeholder', 'ハイライト結果がここに表示されます。マウスを重ねると詳細が出ます。'));
      return;
    }
    var frag = document.createDocumentFragment(), pos = 0;
    issues.forEach(function (x, i) {
      if (x.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, x.start)));
      var m = el('mark', 'hl sev-' + x.severity);
      m.dataset.i = i;
      if (needsBadge(x)) {
        m.appendChild(el('span', 'inv', badgeText(x)));
        if (x.codePoints[0] === 0x2028 || x.codePoints[0] === 0x2029) m.appendChild(document.createTextNode('\n'));
      } else {
        m.textContent = x.text;
      }
      frag.appendChild(m);
      pos = x.end;
    });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    preview.appendChild(frag);
  }

  function renderCategories() {
    var box = $('categories'), counts = state.result.counts;
    box.textContent = '';
    var shown = 0;
    N.CATEGORIES.forEach(function (c) {
      var cnt = counts[c.id] || 0;
      if (state.onlyFound && cnt === 0) return;
      shown++;
      var row = el('label', 'cat sev-' + c.severity + (cnt === 0 ? ' zero' : ''));
      var cb = el('input');
      cb.type = 'checkbox'; cb.checked = !!state.enabled[c.id]; cb.dataset.cat = c.id;
      cb.title = 'このカテゴリを正規化で変換する';
      cb.addEventListener('change', function () {
        state.enabled[c.id] = cb.checked; persist(); refreshConversionViews();
      });
      var body = el('div', 'cat-body');
      body.appendChild(el('div', 'name', c.label));
      body.appendChild(el('div', 'desc', c.desc));
      row.appendChild(cb);
      row.appendChild(body);
      row.appendChild(el('span', 'count', String(cnt)));
      box.appendChild(row);
    });
    if (!shown) box.appendChild(el('p', 'hint', input.value ? '検出されたカテゴリはありません。' : 'テキストを入力すると、ここにカテゴリ別の件数が表示されます。'));
  }

  function renderTable() {
    var tbody = $('issues-body'), issues = state.result.issues, opts = convOpts();
    tbody.textContent = '';
    var list = [];
    issues.forEach(function (x, i) { if (!state.filterCat || x.category === state.filterCat) list.push(i); });
    if (!list.length) {
      var tr0 = el('tr', 'empty'), td0 = el('td', null, issues.length ? '該当する指摘はありません' : 'まだ指摘はありません');
      td0.colSpan = 7; tr0.appendChild(td0); tbody.appendChild(tr0);
      $('issues-note').textContent = '';
      return;
    }
    var frag = document.createDocumentFragment();
    list.slice(0, MAX_ROWS).forEach(function (i) {
      var x = issues[i], tr = el('tr');
      tr.dataset.i = i;
      tr.appendChild(el('td', 'pos', x.line + '行 ' + x.col + '列'));
      var tdc = el('td', 'ch');
      if (needsBadge(x)) { var mk = el('mark', 'hl sev-' + x.severity); mk.appendChild(el('span', 'inv', badgeText(x))); tdc.appendChild(mk); }
      else tdc.textContent = x.text;
      tr.appendChild(tdc);
      tr.appendChild(el('td', 'code', x.chars.map(function (c) { return c.code; }).join(' ')));
      var tdn = el('td');
      x.chars.forEach(function (c) {
        tdn.appendChild(el('div', 'uname', c.name || '(名前なし)'));
      });
      tdn.appendChild(el('div', 'gc', '一般カテゴリ: ' + x.chars.map(function (c) { return c.gc; }).join(' + ')));
      tr.appendChild(tdn);
      var tdk = el('td');
      tdk.appendChild(el('span', 'tag sev-' + x.severity, x.categoryLabel));
      tr.appendChild(tdk);
      var tdt = el('td');
      if (x.replacement == null) tdt.appendChild(el('span', 'none', '（指摘のみ）'));
      else {
        tdt.appendChild(el('span', 'to', visible(x.replacement)));
        if (!N.willConvert(x, opts)) tdt.appendChild(el('span', 'off', x.auto ? '変換オフ' : '提案（要確認）'));
      }
      tr.appendChild(tdt);
      tr.appendChild(el('td', null, x.note));
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    $('issues-note').textContent = list.length > MAX_ROWS ? '表示は先頭 ' + MAX_ROWS + ' 件までです（全 ' + list.length + ' 件）。' : '全 ' + list.length + ' 件。行をクリックすると入力欄の該当箇所を選択します。';
  }

  function renderFilterOptions() {
    var sel = $('filter-cat');
    N.CATEGORIES.forEach(function (c) {
      var o = el('option', null, c.label); o.value = c.id; sel.appendChild(o);
    });
  }

  function renderAbout() {
    var dl = el('dl'), box = $('about-list');
    N.CATEGORIES.forEach(function (c) {
      var wrap = el('div');
      wrap.appendChild(el('dt', null, c.label + (c.defaultOn ? '' : '（既定では変換しない）')));
      wrap.appendChild(el('dd', null, c.desc));
      dl.appendChild(wrap);
    });
    box.appendChild(dl);
    dl.style.display = 'contents';
  }

  function refreshConversionViews() {
    renderTable();
    renderSummary();
    if (state.outputFresh) doNormalize(true);
  }

  /* ---------------- 正規化 ---------------- */
  function doNormalize(silent) {
    var text = input.value;
    var opts = convOpts();
    opts.issues = state.result.issues;
    var out = N.normalize(text, opts);
    output.value = out;
    var changed = state.result.issues.filter(function (x) { return N.willConvert(x, convOpts()); }).length;
    var remain = N.analyze(out, { detectIdeographicSpace: state.detectIdeographicSpace }).issues.length;
    $('output-stat').textContent = changed + ' 箇所を変換しました。' + (remain ? '正規化後も残っている指摘: ' + remain + ' 件（変換オフのカテゴリや指摘のみの文字）' : '正規化後の指摘は 0 件です。');
    $('btn-copy').disabled = !out;
    $('btn-to-input').disabled = !out;
    state.outputFresh = true;
    if (!silent) revealOutput();
  }

  // 出力欄までスクロールしてフォーカスを移す（動きを減らす設定ではスクロールアニメなし）
  function revealOutput() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('output-section').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    try { output.focus({ preventScroll: true }); } catch (e) { output.focus(); }
  }

  function updateButtons() {
    var empty = !input.value;
    $('btn-normalize').disabled = empty;
    $('btn-normalize-top').disabled = empty;
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 1600);
  }

  function copyOutput() {
    var text = output.value;
    function fallback() {
      output.focus(); output.select();
      try { document.execCommand('copy'); toast('コピーしました'); } catch (e) { toast('コピーできませんでした'); }
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('コピーしました'); }, fallback);
    } else fallback();
  }

  /* ---------------- ツールチップ ---------------- */
  var tip = $('tooltip');
  function showTip(mark, ev) {
    var x = state.result.issues[+mark.dataset.i];
    if (!x) return;
    tip.textContent = '';
    var head = el('div');
    head.appendChild(el('span', 't-ch', needsBadge(x) ? badgeText(x) : x.text));
    head.appendChild(el('span', 't-code', x.chars.map(function (c) { return c.code; }).join(' ')));
    tip.appendChild(head);
    x.chars.forEach(function (c) { tip.appendChild(el('div', 't-muted', (c.name || '(名前なし)') + ' [' + c.gc + ']')); });
    tip.appendChild(el('div', null, '種類: ' + x.categoryLabel));
    if (x.replacement != null) {
      tip.appendChild(el('div', null, '変換後: ' + visible(x.replacement) +
        (N.willConvert(x, convOpts()) ? '' : x.auto ? '（変換オフ）' : '（提案・要確認）')));
    } else tip.appendChild(el('div', null, '変換: なし（指摘のみ）'));
    if (x.note) tip.appendChild(el('div', 't-muted', x.note));
    tip.appendChild(el('div', 't-muted', x.line + '行 ' + x.col + '列'));
    tip.hidden = false;
    moveTip(ev);
  }
  function moveTip(ev) {
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(ev.clientX + 14, window.innerWidth - w - 8);
    var top = ev.clientY + 18;
    if (top + h > window.innerHeight - 8) top = ev.clientY - h - 12;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  preview.addEventListener('mouseover', function (ev) {
    var m = ev.target.closest('mark.hl'); if (m) showTip(m, ev);
  });
  preview.addEventListener('mousemove', function (ev) { if (!tip.hidden) moveTip(ev); });
  preview.addEventListener('mouseout', function (ev) {
    var m = ev.target.closest('mark.hl');
    if (m && !m.contains(ev.relatedTarget)) tip.hidden = true;
  });
  // タップ・クリックでも詳細表示＆入力欄の該当箇所を選択
  preview.addEventListener('click', function (ev) {
    var m = ev.target.closest('mark.hl'); if (!m) return;
    showTip(m, ev); selectIssue(+m.dataset.i, false);
  });

  function selectIssue(i, scrollPreview) {
    var x = state.result.issues[i]; if (!x) return;
    var prev = preview.querySelector('mark.active'); if (prev) prev.classList.remove('active');
    var m = preview.querySelector('mark[data-i="' + i + '"]');
    if (m) { m.classList.add('active'); if (scrollPreview) m.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    input.focus({ preventScroll: true });
    input.setSelectionRange(x.start, x.end);
  }
  $('issues-body').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-i]'); if (tr) selectIssue(+tr.dataset.i, true);
  });

  /* ---------------- イベント ---------------- */
  var timer = null;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(analyze, input.value.length > 50000 ? 400 : 120);
  });
  $('btn-sample').addEventListener('click', function () {
    input.value = N.SAMPLE_TEXT + (input.value ? '\n' + input.value : '');
    analyze(); input.focus();
  });
  $('btn-clear').addEventListener('click', function () {
    input.value = ''; output.value = ''; $('output-stat').textContent = '';
    $('btn-copy').disabled = true; $('btn-to-input').disabled = true;
    state.outputFresh = false; analyze(); input.focus();
  });
  $('btn-normalize').addEventListener('click', function () { clearTimeout(timer); analyze(); doNormalize(false); });
  $('btn-normalize-top').addEventListener('click', function () {
    // 入力直後（解析待ち）でも最新のテキストで正規化する
    clearTimeout(timer); analyze(); doNormalize(false);
  });
  $('btn-copy').addEventListener('click', copyOutput);
  $('btn-to-input').addEventListener('click', function () {
    input.value = output.value; state.outputFresh = false; analyze();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  var optIdeo = $('opt-ideo-space'), optSug = $('opt-suggest'), optOnly = $('opt-only-found');
  optIdeo.checked = state.detectIdeographicSpace;
  optSug.checked = state.applySuggestions;
  optOnly.checked = state.onlyFound;
  optIdeo.addEventListener('change', function () {
    state.detectIdeographicSpace = optIdeo.checked;
    if (optIdeo.checked) state.enabled.ideographic_space = true;
    persist(); var fresh = state.outputFresh; analyze(); if (fresh) doNormalize(true);
  });
  optSug.addEventListener('change', function () { state.applySuggestions = optSug.checked; persist(); refreshConversionViews(); });
  optOnly.addEventListener('change', function () { state.onlyFound = optOnly.checked; persist(); renderCategories(); });
  $('filter-cat').addEventListener('change', function (e) { state.filterCat = e.target.value; renderTable(); });
  $('btn-cat-all').addEventListener('click', function () {
    N.CATEGORIES.forEach(function (c) { state.enabled[c.id] = true; });
    persist(); renderCategories(); refreshConversionViews();
  });
  $('btn-cat-default').addEventListener('click', function () {
    state.enabled = N.defaultEnabled(); persist(); renderCategories(); refreshConversionViews();
  });

  renderFilterOptions();
  renderAbout();
  // ?sample でサンプルを挿入した状態で開く（デモ用）
  if (/[?&]sample\b/.test(location.search)) input.value = N.SAMPLE_TEXT;
  analyze();
  if (/[?&]sample\b/.test(location.search) && /[?&]normalize\b/.test(location.search)) doNormalize(true);
})();
