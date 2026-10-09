// 実行: node tests/test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const N = require('../normalize.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message.split('\n').join('\n     ')); }
}
const ALL = Object.fromEntries(N.CATEGORIES.map(c => [c.id, true]));
const norm = (s, o = {}) => N.normalize(s, o);
const cats = (s, o) => N.analyze(s, o).issues.map(x => x.category);

console.log('康煕部首');
test('⽇⾼⽉⾷⾏ → 日高月食行', () => assert.equal(norm('⽇⾼⽉⾷⾏'), '日高月食行'));
test('全214字が別の文字に変換される', () => {
  for (let c = 0x2F00; c <= 0x2FD5; c++) {
    const ch = String.fromCodePoint(c), r = N.analyze(ch).issues;
    assert.equal(r.length, 1, ch); assert.equal(r[0].category, 'kangxi');
    assert.notEqual(r[0].replacement, ch); assert.equal([...r[0].replacement].length, 1);
  }
});
test('⼾⾭⿈⿊ は日本語の字形（戸青黄黒）に', () => assert.equal(norm('⼾⾭⿈⿊'), '戸青黄黒'));

console.log('CJK部首補助');
test('⺟⻑⻄⺠⻘⻝⻩⻤ → 母長西民青食黄鬼', () => assert.equal(norm('⺟⻑⻄⺠⻘⻝⻩⻤'), '母長西民青食黄鬼'));
test('簡化字形の部首（⻓⻔⻋）は提案のみ', () => {
  assert.equal(norm('⻓⻔⻋'), '⻓⻔⻋');
  assert.equal(norm('⻓⻔⻋', { applySuggestions: true }), '長門車');
});
test('⺀（対応字なし）は指摘のみ', () => {
  const r = N.analyze('⺀').issues; assert.equal(r[0].category, 'radical_sup'); assert.equal(r[0].replacement, null);
});
test('部首補助の割り当て済み全字を検出', () => {
  let n = 0;
  for (let c = 0x2E80; c <= 0x2EF3; c++) { if (c === 0x2E9A) continue; n++; assert.equal(cats(String.fromCodePoint(c))[0], 'radical_sup', c.toString(16)); }
  assert.equal(n, 115);
});

console.log('濁点・半濁点');
test('結合濁点: か+U+3099 → が', () => assert.equal(norm('か\u3099'), 'が'));
test('結合半濁点: ハ+U+309A → パ', () => assert.equal(norm('ハ\u309A'), 'パ'));
test('う+U+3099 → ゔ, ワ+U+3099 → ヷ', () => assert.equal(norm('う\u3099ワ\u3099'), 'ゔヷ'));
test('合成できない結合濁点は指摘のみ（あ゙）', () => {
  const r = N.analyze('あ\u3099').issues;
  assert.equal(r.length, 1); assert.equal(r[0].category, 'combining_kana'); assert.equal(r[0].replacement, null);
  assert.equal(norm('あ\u3099'), 'あ\u3099');
});
test('単独濁点: か゛→が, ハ゜→パ', () => assert.equal(norm('か゛ハ゜'), 'がパ'));
test('かな以外の後の ゛ は対象外', () => assert.deepEqual(cats('A゛'), []));
test('正しい「が」は検出しない', () => assert.deepEqual(cats('がぎぐげごパピプペポ'), []));

console.log('CJK互換漢字');
test('神 (U+FA19) → 神 (U+795E)', () => assert.equal(norm('\uFA19'), '\u795E'));
test('﨑 (U+FA11) は変換しない（正規分解なし）', () => {
  const r = N.analyze('\uFA11').issues;
  assert.equal(r[0].category, 'compat_ideograph'); assert.equal(r[0].replacement, null); assert.equal(r[0].severity, 'info');
  assert.equal(norm('\uFA11'), '\uFA11');
});
test('補助面の互換漢字 U+2F800 → 丽', () => assert.equal(norm('\u{2F800}'), '\u4E3D'));

console.log('異体字セレクタ・不可視文字・空白');
test('IVS を削除', () => assert.equal(norm('葛\u{E0100}飾'), '葛飾'));
test('絵文字の FE0F は対象外', () => assert.deepEqual(cats('❤\uFE0F'), []));
test('ZWSP/BOM/SHY/LRM を削除', () => assert.equal(norm('a\u200Bb\uFEFFc\u00ADd\u200Ee'), 'abcde'));
test('U+2028 は改行に', () => assert.equal(norm('a\u2028b'), 'a\nb'));
test('NBSP・EN SPACE → 半角スペース', () => assert.equal(norm('a\u00A0b\u2002c'), 'a b c'));
test('全角スペースは既定では検出しない', () => assert.deepEqual(cats('あ\u3000い'), []));
test('全角スペースはオプションで検出・変換', () => {
  assert.deepEqual(cats('あ\u3000い', { detectIdeographicSpace: true }), ['ideographic_space']);
  assert.equal(norm('あ\u3000い', { detectIdeographicSpace: true, enabled: ALL }), 'あ い');
});
test('改行・タブは対象外', () => assert.deepEqual(cats('a\tb\r\nc\n'), []));

console.log('互換文字');
test('半角カナ: ｶﾞｲﾄﾞ｡ → ガイド。', () => assert.equal(norm('ｶﾞｲﾄﾞ｡'), 'ガイド。'));
test('単独の半角濁点 ﾞ → ゛', () => assert.equal(norm('ﾞ'), '゛'));
test('全角英数字は既定では変換しない／オンで半角', () => {
  assert.equal(norm('ＡＢＣ１２３'), 'ＡＢＣ１２３');
  assert.equal(norm('ＡＢＣ１２３', { enabled: ALL }), 'ABC123');
});
test('全角記号（！？（））は対象外', () => assert.deepEqual(cats('！？（）'), []));
test('囲み・組文字は既定オフ、オンでNFKC', () => {
  assert.deepEqual(cats('①㈱㍿'), ['enclosed', 'enclosed', 'enclosed']);
  assert.equal(norm('①㈱㍿'), '①㈱㍿');
  assert.equal(norm('①㈱㍿', { enabled: ALL }), '1(株)株式会社');
});
test('欧文合字 ﬁ ﬂ → fi fl', () => assert.equal(norm('ﬁle ﬂow'), 'file flow'));
test('縦書き用 ︵︶︒ → （）。相当', () => assert.equal(norm('︵あ︶︒'), '(あ)。'));
test('分解されたアクセント e+U+0301 → é', () => assert.equal(norm('cafe\u0301'), 'caf\u00E9'));

console.log('簡体字・繁体字・紛らわしい文字');
test('簡体字の提案: 这说门车东长 → 這説門車東長', () => {
  const r = N.analyze('这说门车东长').issues;
  assert.ok(r.every(x => x.category === 'simplified'));
  assert.equal(r.map(x => x.replacement).join(''), '這説門車東長');
  assert.equal(norm('这说门车东长'), '这说门车东长'); // 既定では変換しない
  assert.equal(norm('这说门车东长', { enabled: ALL }), '這説門車東長');
});
test('自動表の簡体字も日本の字体に寄せる（读→読, 产→産）', () => {
  assert.equal(N.analyze('读').issues[0].replacement, '読');
  assert.equal(N.analyze('产').issues[0].replacement, '産');
});
test('日本語の漢字は誤検出しない', () => {
  const ja = '日本語の文章を正しく表示するための確認です。東京都千代田区、学校、国際会議、図書館、経済、発表、総合、関係、写真、気温、渡辺さん、一覧、データ一覧、二人、八百屋、力仕事、入力フォーム、工場';
  assert.deepEqual(N.analyze(ja).issues.map(x => x.text), []);
});
test('繁体字: 說稅戶黃 → 説税戸黄（警告）、澤は参考', () => {
  const r = N.analyze('說稅戶黃澤').issues;
  assert.equal(r.map(x => x.replacement).join(''), '説税戸黄沢');
  assert.equal(r[4].severity, 'info');
});
test('カタカナ語の中の漢字: プ口グラム→プログラム, ラ一メン→ラーメン', () => {
  assert.equal(norm('プ口グラム ラ一メン', { enabled: ALL }), 'プログラム ラーメン');
});
test('ダッシュ・ハングル: デ―タ→データ, コㅡヒー→コーヒー', () => assert.equal(norm('デ―タ コㅡヒー', { enabled: ALL }), 'データ コーヒー'));
test('英単語中のキリル文字 Аpple → Apple', () => {
  assert.deepEqual(cats('\u0410pple'), ['lookalike']);
  assert.deepEqual(cats('Привет'), []); // ロシア語の単語は対象外
});
test('私用領域・置換文字・孤立サロゲートは指摘のみ', () => {
  assert.deepEqual(cats('\uE000\uFFFD\uD800'), ['pua', 'broken', 'broken']);
  assert.equal(norm('\uE000\uFFFD', { enabled: ALL }), '\uE000\uFFFD');
});

console.log('誤検出チェック');
test('JIS X 0208 の全文字で「要修正」「要確認」が出ない（参考のみ）', () => {
  const dec = new TextDecoder('shift_jis'); let t = '';
  // JIS X 0208 の範囲のみ（0x87 の NEC特殊文字、0xED 以降の NEC/IBM 拡張は除外）
  for (let b1 = 0x81; b1 <= 0xEA; b1++) {
    if ((b1 > 0x84 && b1 < 0x88) || (b1 > 0x9F && b1 < 0xE0)) continue;
    for (let b2 = 0x40; b2 <= 0xFC; b2++) {
      if (b2 === 0x7F) continue;
      const ch = dec.decode(new Uint8Array([b1, b2]));
      if (ch !== '\uFFFD') t += ch;
    }
  }
  assert.ok([...t].length > 6800, 'JIS文字数: ' + [...t].length);
  const bad = N.analyze(t).issues.filter(x => x.severity !== 'info').map(x => x.text);
  assert.deepEqual(bad, []);
});

console.log('その他');
test('位置（行・列）が正しい', () => {
  const r = N.analyze('あいう\r\nえ⽇\n𠮷⾼').issues;
  assert.deepEqual(r.map(x => [x.line, x.col]), [[2, 2], [3, 2]]);
});
test('サロゲートペアを含むテキストのオフセット', () => {
  const t = '𠮷野家⽇'; const r = N.analyze(t).issues;
  assert.equal(t.slice(r[0].start, r[0].end), '⽇');
});
test('サンプルテキストの全カテゴリ（全角スペース除く）が検出される', () => {
  const c = N.analyze(N.SAMPLE_TEXT).counts;
  for (const cat of N.CATEGORIES) {
    if (cat.id === 'ideographic_space') continue;
    assert.ok(c[cat.id] > 0, cat.id + ' が0件');
  }
});
test('正規化は冪等（2回目は変化なし）', () => {
  const once = norm(N.SAMPLE_TEXT, { enabled: ALL, applySuggestions: true });
  assert.equal(norm(once, { enabled: ALL, applySuggestions: true }), once);
});
test('文字名の取得', () => {
  assert.equal(N.charName(0x2F00), 'KANGXI RADICAL ONE');
  assert.equal(N.charName(0x2ED1), 'CJK RADICAL LONG ONE');
  assert.equal(N.charName(0x4E00), 'CJK UNIFIED IDEOGRAPH-4E00');
  assert.equal(N.charName(0x3099), 'COMBINING KATAKANA-HIRAGANA VOICED SOUND MARK');
  assert.equal(N.generalCategory(0x200B), 'Cf');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
