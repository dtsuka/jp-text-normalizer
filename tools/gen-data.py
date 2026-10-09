#!/usr/bin/env python3
"""unicode-data.js を生成するスクリプト。

必要な UCD ファイル（https://www.unicode.org/Public/UCD/latest/ucd/）:
  UnicodeData.txt, EquivalentUnifiedIdeograph.txt, Unihan.zip(Unihan_Variants.txt)
使い方: python3 tools/gen-data.py <UCDディレクトリ>
"""
import json, os, sys

ucd = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'ucd')
out = os.path.join(os.path.dirname(__file__), '..', 'unicode-data.js')

# --- 文字名（ツールで扱う範囲のみ。CJK統合漢字などはJS側で機械的に生成）
RANGES = [
    (0x0000, 0x024F), (0x0300, 0x036F), (0x0370, 0x04FF), (0x0500, 0x052F),
    (0x061C, 0x061C), (0x1100, 0x11FF), (0x1680, 0x1680), (0x17B4, 0x17B5), (0x180E, 0x180E),
    (0x2000, 0x206F), (0x2100, 0x214F), (0x2212, 0x2212), (0x2460, 0x24FF),
    (0x2500, 0x257F), (0x2776, 0x2793), (0x2E80, 0x2FFF), (0x3000, 0x30FF),
    (0x3130, 0x318F), (0x31C0, 0x31EF), (0x3200, 0x33FF), (0xFB00, 0xFB06),
    (0xFE00, 0xFE6F), (0xFF00, 0xFFEF), (0xFFF0, 0xFFFF), (0x1D173, 0x1D17A),
    (0x1F100, 0x1F2FF), (0xE0000, 0xE007F),
]
names = {}
with open(os.path.join(ucd, 'UnicodeData.txt'), encoding='utf-8') as f:
    for line in f:
        p = line.split(';')
        cp = int(p[0], 16)
        if not any(a <= cp <= b for a, b in RANGES):
            continue
        name = p[1]
        if name.startswith('<'):
            name = p[10] or name  # 制御文字は旧名
            if not name or name.startswith('<'):
                continue
        names[format(cp, 'X')] = name

# --- CJK部首補助 / 康煕部首 → 統合漢字（EquivalentUnifiedIdeograph.txt）
equiv = {}
with open(os.path.join(ucd, 'EquivalentUnifiedIdeograph.txt'), encoding='utf-8') as f:
    for line in f:
        line = line.split('#')[0].strip()
        if not line:
            continue
        a, b = [x.strip() for x in line.split(';')]
        lo, hi = (a.split('..') + [a])[:2]
        for cp in range(int(lo, 16), int(hi, 16) + 1):
            if 0x2E80 <= cp <= 0x2EFF:
                equiv[format(cp, 'X')] = chr(int(b, 16))

# --- 簡体字（日本の文字コード JIS X 0208/0213 に存在しない簡化字）の自動表
def in_jis(c):
    for enc in ('cp932', 'euc_jis_2004'):
        try:
            c.encode(enc); return True
        except UnicodeEncodeError:
            pass
    return False

def cp_of(s):
    return chr(int(s[2:], 16))

trad, zvar, sem = {}, {}, {}
for line in open(os.path.join(ucd, 'Unihan_Variants.txt'), encoding='utf-8'):
    if line.startswith('#') or not line.strip():
        continue
    c, key, val = line.rstrip('\n').split('\t')
    vals = [cp_of(v.split('<')[0]) for v in val.split()]
    c = cp_of(c)
    if key == 'kTraditionalVariant':
        trad[c] = vals
    elif key == 'kZVariant':
        zvar[c] = vals
    elif key == 'kSemanticVariant':
        sem[c] = vals

def japanese_form(t):
    """繁体字 t の日本語での字形候補（cp932 にあればそれ、なければ Z/意味異体字で探す）"""
    for enc in ('cp932',):
        try:
            t.encode(enc); return t
        except UnicodeEncodeError:
            pass
    for v in zvar.get(t, []) + sem.get(t, []):
        try:
            v.encode('cp932'); return v
        except UnicodeEncodeError:
            pass
    return t

simp = {}
for c, ts in trad.items():
    ts = [t for t in ts if t != c]
    if not ts or in_jis(c):
        continue
    if not (0x4E00 <= ord(c) <= 0x9FFF):
        continue  # 基本ブロックのみ（拡張漢字は日本語でもまれなので対象外）
    simp[c] = japanese_form(ts[0])

simp_str = ''.join(k + v for k, v in sorted(simp.items()))

js = '''/* 自動生成ファイル: tools/gen-data.py で生成（手で編集しないでください）
 * 出典: Unicode Character Database (UnicodeData.txt, EquivalentUnifiedIdeograph.txt, Unihan_Variants.txt)
 * © Unicode, Inc. — Unicode License v3
 */
(function (root) {
  var DATA = {
    NAMES: %s,
    RADICAL_EQUIV: %s,
    /* 簡体字→繁体字（日本語字形）を2文字ずつ連結した文字列 */
    SIMPLIFIED_AUTO: %s
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.PTN_DATA = DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this);
''' % (json.dumps(names, ensure_ascii=False, separators=(',', ':')),
       json.dumps(equiv, ensure_ascii=False, separators=(',', ':')),
       json.dumps(simp_str, ensure_ascii=False))
open(out, 'w', encoding='utf-8').write(js)
print('names', len(names), 'radical', len(equiv), 'simplified_auto', len(simp))
