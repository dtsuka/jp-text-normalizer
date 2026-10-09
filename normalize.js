/*!
 * PDF由来の紛らわしい文字 検出・正規化モジュール
 * ブラウザ: <script src="unicode-data.js"> の後に読み込むと window.PdfTextNormalizer が使えます。
 * Node.js: const N = require('./normalize.js');
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var data = isNode ? require('./unicode-data.js') : root.PTN_DATA;
  var api = factory(data || { NAMES: {}, RADICAL_EQUIV: {}, SIMPLIFIED_AUTO: '' });
  if (isNode) module.exports = api;
  else root.PdfTextNormalizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  /* ------------------------------------------------------------------
   * カテゴリ定義
   *  severity: error = ほぼ確実に誤り / warning = 要確認 / info = 参考
   *  defaultOn: 「正規化」ボタンで既定で変換するか
   * ------------------------------------------------------------------ */
  var CATEGORIES = [
    { id: 'kangxi', label: '康煕部首', severity: 'error', defaultOn: true,
      desc: 'U+2F00–2FDF。見た目は通常の漢字と同じだが別の文字（例: ⽇→日, ⾼→高）。検索・照合・読み上げで問題になります。' },
    { id: 'radical_sup', label: 'CJK部首補助', severity: 'error', defaultOn: true,
      desc: 'U+2E80–2EFF。部首の異体（例: ⻑→長, ⻄→西, ⺠→民）。中国簡化字形の部首は提案のみ。' },
    { id: 'combining_kana', label: '結合文字の濁点・半濁点', severity: 'error', defaultOn: true,
      desc: 'か＋U+3099 のように濁点が別文字になったもの（見た目は「が」）。NFCで1文字に合成します。合成できないものは指摘のみ。' },
    { id: 'spacing_mark', label: '単独の濁点・半濁点（゛゜）', severity: 'warning', defaultOn: true,
      desc: 'かな＋「゛」(U+309B)／「゜」(U+309C)。合成できる組み合わせのみ1文字にします。' },
    { id: 'decomposed', label: '分解されたアクセント記号等', severity: 'error', defaultOn: true,
      desc: 'e＋U+0301 のように分解された文字（é）。NFCで合成します。' },
    { id: 'compat_ideograph', label: 'CJK互換漢字', severity: 'error', defaultOn: true,
      desc: 'U+F900–FAFF, U+2F800–2FA1F。正規分解を持つものだけ統合漢字に変換（例: 神→神）。﨑など正規分解のない12字は正規の漢字なので参考表示のみ。' },
    { id: 'variation_selector', label: '異体字セレクタ', severity: 'warning', defaultOn: true,
      desc: 'U+FE00–FE0F, U+E0100–E01EF（IVS）。字形指定の不可視文字。削除すると標準の字形になります（絵文字の FE0F は対象外）。' },
    { id: 'invisible', label: 'ゼロ幅・不可視・制御文字', severity: 'error', defaultOn: true,
      desc: 'ゼロ幅スペース(U+200B)、BOM(U+FEFF)、ソフトハイフン(U+00AD)、方向制御文字、制御文字など。削除します（U+2028/2029 は改行に）。' },
    { id: 'odd_space', label: '特殊な空白', severity: 'warning', defaultOn: true,
      desc: 'ノーブレークスペース(U+00A0)、U+2000–200A の各種スペースなど。通常の半角スペースに置換します。' },
    { id: 'ideographic_space', label: '全角スペース（U+3000）', severity: 'info', defaultOn: false,
      desc: '「全角スペースも検出する」をオンにした場合のみ検出。変換をオンにすると半角スペースに置換します。' },
    { id: 'halfwidth_kana', label: '半角カナ', severity: 'warning', defaultOn: true,
      desc: 'U+FF61–FF9F（ｶﾞ→ガ, ｡→。）。全角に変換します。' },
    { id: 'fullwidth_ascii', label: '全角英数字', severity: 'info', defaultOn: false,
      desc: 'Ａ–Ｚ, ａ–ｚ, ０–９。変換をオンにすると半角にします（全角記号は対象外）。' },
    { id: 'enclosed', label: '囲み文字・組文字・単位記号', severity: 'info', defaultOn: false,
      desc: '①, ㈱, ㍿, ㌔, ㎡, № など。変換をオンにするとNFKCで展開します（①→1, ㍿→株式会社）。' },
    { id: 'ligature', label: '欧文合字', severity: 'error', defaultOn: true,
      desc: 'ﬁ, ﬂ, ﬀ など（U+FB00–FB06）。英文PDFでよく混入します。fi, fl に分解します。' },
    { id: 'vertical', label: '縦書き用・小字形の互換文字', severity: 'warning', defaultOn: true,
      desc: '縦書きPDFからコピーした ︵︶︒︑︙ など（U+FE10–FE19, FE30–FE6B）。通常の記号に変換します。' },
    { id: 'simplified', label: '簡体字（中国語）', severity: 'warning', defaultOn: false,
      desc: '日本語では使わない簡化字（这, 说, 门, 车…）。日本の字体を提案します。変換をオンにすると提案どおり置換します。' },
    { id: 'traditional', label: '繁体字・旧字体', severity: 'warning', defaultOn: false,
      desc: '台湾・香港の字形（說, 稅, 戶, 黃…）や旧字体（國, 學…）。人名などで正しい場合もあるので要確認。' },
    { id: 'lookalike', label: '紛らわしい文字', severity: 'warning', defaultOn: false,
      desc: 'カタカナ語中の漢字（プ口グラム→ロ）、ダッシュ類（―, —）、ハングル「ㅡ」、英単語中のキリル・ギリシャ文字など。' },
    { id: 'cjk_misc', label: 'CJK字画・漢字構成記述文字', severity: 'warning', defaultOn: false,
      desc: 'U+31C0–31EF（字画）, U+2FF0–2FFF（構成記述文字）。通常の文章には現れない文字。指摘のみ。' },
    { id: 'pua', label: '私用領域（外字）', severity: 'error', defaultOn: false,
      desc: 'U+E000–F8FF など。フォント固有の外字で、他の環境では別の文字に見えるか表示されません。指摘のみ。' },
    { id: 'broken', label: '置換文字・不正な文字', severity: 'error', defaultOn: false,
      desc: '�(U+FFFD)、非文字、対になっていないサロゲート。変換に失敗した跡です。指摘のみ。' }
  ];
  var CAT_BY_ID = {};
  CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });

  /* ------------------------------------------------------------------
   * 対応表
   * ------------------------------------------------------------------ */
  function pairs(str) {
    var a = Array.from(str.replace(/\s+/g, '')), m = {};
    for (var i = 0; i + 1 < a.length; i += 2) m[a[i]] = a[i + 1];
    return m;
  }

  // 康煕部首: NFKCの結果が日本語で通常使わない旧字形になるものは日本語の字に寄せる
  var KANGXI_JA = pairs('⼾戸 ⾭青 ⿈黄 ⿊黒');

  // CJK部首補助のうち中国簡化字形（C-SIMPLIFIED）: 日本語での対応字（提案のみ）
  var RADICAL_C_SIMPLIFIED_JA = pairs(
    '⺰糸 ⻅見 ⻈言 ⻉貝 ⻋車 ⻐金 ⻓長 ⻔門 ⻙韋 ⻚頁 ⻛風 ⻜飛 ⻠食 ⻢馬 ⻥魚 ⻦鳥 ⻧鹵 ⻪黽 ⻬斉 ⻮歯 ⻰竜 ⻳亀');

  // 簡体字 → 日本の字体（手作業で選定。自動表より優先）
  var SIMPLIFIED_JA = pairs(
    '们們 这這 说説 门門 车車 东東 时時 长長 书書 见見 电電 读読 话話 语語 认認 计計 让譲 试試 请請 谢謝 ' +
    '设設 论論 证証 识識 议議 发発 对対 关関 开開 问問 间間 网網 页頁 题題 实実 买買 卖売 热熱 动動 务務 ' +
    '劳労 办弁 为為 业業 乐楽 产産 亲親 从従 众衆 优優 价価 伤傷 华華 单単 历歴 压圧 县県 变変 听聴 员員 ' +
    '响響 图図 场場 坏壊 块塊 报報 处処 备備 复復 夺奪 妇婦 孙孫 宁寧 层層 岁歳 币幣 带帯 师師 应応 张張 ' +
    '强強 归帰 录録 总総 战戦 户戸 扩拡 护護 择択 换換 无無 显顕 术術 权権 极極 构構 标標 样様 树樹 桥橋 ' +
    '检検 汉漢 沟溝 济済 涉渉 测測 满満 灵霊 爷爺 现現 环環 种種 积積 稳穏 笔筆 简簡 类類 级級 纪紀 约約 ' +
    '线線 组組 细細 经経 结結 给給 统統 继継 续続 维維 综綜 编編 缘縁 罗羅 职職 联連 肃粛 脑脳 节節 获獲 ' +
    '营営 虑慮 补補 观観 规規 视視 览覧 觉覚 订訂 训訓 讯訊 许許 访訪 评評 诗詩 诚誠 质質 费費 资資 贵貴 ' +
    '贸貿 赛賽 赵趙 转転 轮輪 软軟 较較 输輸 辑輯 边辺 违違 释釈 钱銭 铁鉄 银銀 错錯 键鍵 阳陽 阴陰 际際 ' +
    '陆陸 险険 难難 鸡鶏 鱼魚 鸟鳥 马馬 驾駕 验験 龙竜 齐斉 齿歯 风風 飞飛 饭飯 馆館 丝糸 两両 严厳 丧喪 ' +
    '举挙 义義 习習 乡郷 亚亜 亿億 仅僅 传伝 伟偉 仪儀 俭倹 债債 兑兌 兰蘭 兴興 养養 农農 决決 况況 净浄 ' +
    '凤鳳 击撃 刘劉 则則 刚剛 创創 别別 剧劇 劝勧 势勢 协協 卫衛 厅庁 厉励 吗嗎 吴呉 围囲 园園 圆円 圣聖 ' +
    '坚堅 坛壇 垒塁 尘塵 岛島 岭嶺 帅帥 帐帳 库庫 庆慶 废廃 异異 弃棄 弹弾 彻徹 忆憶 态態 怀懐 恶悪 惊驚 ' +
    '惯慣 戏戯 执執 扫掃 扬揚 拟擬 挥揮 损損 摄摂 敌敵 晓暁 暂暫 杂雑 杀殺 杨楊 枪槍 栏欄 梦夢 欢歓 ' +
    '毕畢 气気 汤湯 泽沢 洁潔 浓濃 涂塗 润潤 渐漸 灭滅 炼錬 烦煩 烧焼 爱愛 牵牽 犹猶 狮獅 猎猟 畅暢 疗療 ' +
    '盐塩 监監 盘盤 础礎 确確 离離 穷窮 竞競 紧緊 纠糾 红紅 纤繊 纯純 纸紙 纳納 练練 织織 终終 ' +
    '绍紹 绘絵 络絡 绝絶 绿緑 缩縮 罚罰 罢罷 聪聡 肤膚 胁脅 脏臓 苏蘇 药薬 蓝藍 虽雖 袭襲 讨討 讲講 词詞 ' +
    '译訳 详詳 误誤 谁誰 调調 谈談 该該 诉訴 贝貝 负負 贡貢 财財 责責 败敗 货貨 购購 贯貫 贴貼 赏賞 赔賠 ' +
    '赖頼 赞賛 轨軌 轻軽 载載 辅輔 辆輛 迁遷 过過 运運 还還 进進 远遠 连連 迟遅 选選 递逓 遗遺 邮郵 邻隣 ' +
    '郑鄭 酱醤 鉴鑑 针針 钟鐘 钢鋼 铃鈴 锁鎖 锅鍋 镇鎮 闪閃 闭閉 闲閑 闻聞 阀閥 阁閣 阅閲 队隊 阵陣 阶階 ' +
    '陈陳 隐隠 雾霧 韩韓 顶頂 项項 顺順 须須 顾顧 顿頓 预預 领領 频頻 颜顔 额額 饥飢 饮飲 饰飾 饱飽 驱駆 ' +
    '骑騎 鲁魯 鲜鮮 鸣鳴 龄齢 龟亀 达達 适適 乌烏 宾賓 寻尋 导導 岂豈 尝嘗 尔爾 尧堯 扑撲 抚撫 拥擁 挤擠 ' +
    '挡擋 枣棗 栋棟 栈桟 涛濤 涩渋 渊淵 渔漁 滨浜 滩灘 灾災 烛燭 牺犠 玛瑪 琐瑣 畴疇 皱皺 盏盞 矿鉱 码碼 ' +
    '砖磚 硕碩 祸禍 秃禿 窝窩 竖竪 笼籠 筹籌 粪糞 纬緯 纲綱 纵縦 纷紛 纹紋 绅紳 绩績 绪緒 绳縄 绵綿 ' +
    '缓緩 缝縫 肠腸 肿腫 胜勝 腾騰 舰艦 舱艙 艺芸 芜蕪 苇葦 荣栄 荡蕩 莲蓮 萨薩 虏虜 蚁蟻 蜡蝋 讼訟 ' +
    '讽諷 谋謀 谓謂 谜謎 谱譜 谦謙 贞貞 贤賢 贩販 贪貪 贫貧 贬貶 贱賤 贷貸 贺賀 赁賃 赌賭 赠贈 趋趨 跃躍 ' +
    '轰轟 辉輝 迈邁 逊遜 邓鄧 酝醞 酿醸 钓釣 钝鈍 钞鈔 钦欽 铅鉛 铜銅 铭銘 铺舗 锋鋒 锐鋭 锡錫 锦錦 ' +
    '镜鏡 闸閘 闺閨 阔闊 陕陝 隶隷 雏雛 顷頃 颁頒 颂頌 颇頗 颈頚 颗顆 飘飄 饲飼 饶饒 饼餅 驰馳 驳駁 驴驢 ' +
    '驻駐 驼駝 骂罵 骗騙 骚騒 骤驟 鲸鯨 鸭鴨 鹤鶴'
  );

  // 上表のうち JIS X 0208 にも収録されている字（日本語ではまれ）。「参考」扱い
  var SIMPLIFIED_IN_JIS = {};
  Array.from('涛从价决况听坏梦弃无气渊犹畴网隶').forEach(function (c) { SIMPLIFIED_IN_JIS[c] = 1; });

  // 繁体字・旧字体 → 日本の字体（提案）
  var TRADITIONAL_JA = pairs(
    '說説 稅税 銳鋭 閱閲 悅悦 脫脱 戶戸 黃黄 靑青 淸清 吳呉 內内 兩両 增増 尙尚 卽即 旣既 槪概 鄕郷 錄録 ' +
    '綠緑 緣縁 值値 敎教 眞真 歲歳 溫温 產産 彥彦 顏顔 查査 爭争 淨浄 硏研 絕絶 姬姫 爲為 衞衛 擧挙 從従 ' +
    '實実 發発 圖図 學学 國国 會会 對対 當当 體体 號号 舊旧 萬万 來来 樂楽 歡歓 廣広 應応 廳庁 戰戦 價価 ' +
    '傳伝 寫写 區区 單単 圓円 處処 德徳 惡悪 擇択 數数 晝昼 條条 檢検 歸帰 氣気 澤沢 獨独 營営 盡尽 礦鉱 ' +
    '稱称 經経 縣県 總総 聲声 肅粛 與与 舉挙 藝芸 蟲虫 證証 讀読 變変 豐豊 輕軽 辭辞 邊辺 醫医 鐵鉄 關関 ' +
    '險険 雙双 雜雑 靜静 鬭闘 黨党 齒歯 齡齢 龍竜 龜亀 臺台 灣湾 歷歴 曆暦 壓圧 觀観 鹽塩 啟啓 麵麺 鷄鶏 ' +
    '雞鶏 劍剣 戲戯 拜拝 搖揺 擴拡 濟済 燈灯 爐炉 狀状 碎砕 禮礼 稻稲 穩穏 竊窃 絲糸 繪絵 續続 聽聴 腦脳 ' +
    '螢蛍 譯訳 讓譲 豫予 賣売 贊賛 轉転 遲遅 鄰隣 醉酔 錢銭 鑛鉱 隱隠 霸覇 顯顕 驛駅 驗験 髮髪 鬪闘 默黙 ' +
    '齋斎 齊斉 黑黒 爭争 讀読 晉晋 獻献 圍囲 團団 壞壊 壯壮 學学 寶宝 屬属 巖巌 彈弾 恆恒 懷懐 拂払 擔担 ' +
    '據拠 攝摂 斷断 晩晩 曉暁 榮栄 樓楼 櫻桜 殘残 毆殴 滯滞 滿満 瀨瀬 灑洒 燒焼 犧犠 獵猟 癡痴 發発 盜盗 ' +
    '縱縦 繩縄 纖繊 聯連 莊荘 萊莱 藏蔵 虛虚 號号 蠶蚕 裝装 覺覚 譽誉 貳弐 賴頼 軍軍 輛両 辯弁 遙遥 遞逓 ' +
    '邊辺 鄭鄭 醬醤 釋釈 鎭鎮 隨随 雜雑 靈霊 顚顛 飜翻 驅駆 體体 鬥闘 鹼鹸 麥麦 黃黄 點点 齡齢'
  );
  // 上表のうち JIS X 0208（cp932）に収録されている旧字体。日本語の人名・固有名詞で普通に使われるため「参考」扱い
  var TRADITIONAL_IN_JIS = {};
  Array.from('悅靑淸兩增鄕綠敎眞顏爭淨爲衞擧從實發圖學國會對當體號舊萬來樂歡廣應廳戰價傳寫區單圓處德惡擇數晝條檢歸氣澤獨營盡礦稱經縣總聲肅與舉藝蟲證讀變豐輕辭邊醫鐵關險雙雜靜黨齒齡龍龜臺灣壓觀鹽鷄劍戲拜搖擴濟燈爐碎禮稻穩竊絲繪續聽腦螢譯讓豫賣贊轉遲鄰醉錢鑛隱霸顯驛驗髮鬪默齋齊黑晉獻圍團壞壯寶屬巖彈恆懷拂擔據攝斷曉榮樓櫻殘毆滯滿瀨灑燒犧獵癡盜縱繩纖聯莊藏蠶裝覺譽貳賴輛辯遙遞釋鎭隨靈飜驅鬥麥點').forEach(function (c) { TRADITIONAL_IN_JIS[c] = 1; });
  // 同一文字の組（軍軍 など）を除去
  Object.keys(TRADITIONAL_JA).forEach(function (k) { if (TRADITIONAL_JA[k] === k) delete TRADITIONAL_JA[k]; });
  // 辯/辦/瓣 → 弁 は意味で使い分けがあるので注記
  var NOTE_BY_CHAR = {
    '办': '「辦」の簡体字。日本語では「弁」（例: 办公→弁公）',
    '发': '「發（発）」「髮（髪）」両方の簡体字。文脈により「髪」の場合あり',
    '复': '「復」「複」両方の簡体字。文脈により「複」の場合あり',
    '历': '「歴」「暦」両方の簡体字。文脈により「暦」の場合あり',
    '联': '「聯」の簡体字。日本語では「連」（連合）または「聯」',
    '综': '「綜」の簡体字。日本語では「総」に書き換える場合も',
    '辆': '「輛」の簡体字（車両の「両」）',
    '钟': '「鐘」「鍾」の簡体字。「時計」の意味の場合あり',
    '胜': '「勝」の簡体字（日本語の「胜（なまぐさ）」は別字）',
    '强': '「強」の異体字'
  };

  // 簡体字の自動表（Unihan由来）。手作業表を優先し、繁体字表で日本の字体に寄せる
  var SIMPLIFIED_AUTO = pairs(DATA.SIMPLIFIED_AUTO || '');

  // カタカナ語の中に紛れやすい漢字・記号
  var KATAKANA_LOOKALIKE = pairs('一ー 二ニ 口ロ 力カ 工エ 夕タ 卜ト 八ハ 匕ヒ 才オ 千チ 三ミ');
  var KATAKANA_LOOKALIKE_STRICT = { '一': 1, '二': 1, '八': 1, '千': 1, '三': 1, '才': 1 }; // 両側がカタカナのときのみ
  var DASHES = { 0x2010: 1, 0x2011: 1, 0x2012: 1, 0x2013: 1, 0x2014: 1, 0x2015: 1, 0x2212: 1, 0x2500: 1, 0x2501: 1, 0xFF0D: 1, 0x30FC: 0 };
  // ラテン文字に見えるキリル・ギリシャ文字
  var CYR_GREEK_LATIN = pairs(
    'АA ВB ЕE КK МM НH ОO РP СC ТT ХX УY аa еe оo рp сc уy хx іi јj ѕs ІI ЈJ ЅS ԁd ԛq ԝw ҮY һh ' +
    'ΑA ΒB ΕE ΖZ ΗH ΙI ΚK ΜM ΝN ΟO ΡP ΤT ΥY ΧX οo νv ιi κk');

  /* ------------------------------------------------------------------
   * 文字情報
   * ------------------------------------------------------------------ */
  function hex(cp) {
    var h = cp.toString(16).toUpperCase();
    while (h.length < 4) h = '0' + h;
    return h;
  }
  function uplus(cp) { return 'U+' + hex(cp); }

  function inRange(cp, ranges) {
    for (var i = 0; i < ranges.length; i += 2) if (cp >= ranges[i] && cp <= ranges[i + 1]) return true;
    return false;
  }
  var UNIFIED = [0x3400, 0x4DBF, 0x4E00, 0x9FFF, 0x20000, 0x2A6DF, 0x2A700, 0x2EE5F, 0x30000, 0x323AF];
  var COMPAT_IDEO = [0xF900, 0xFAFF, 0x2F800, 0x2FA1F];
  var PUA = [0xE000, 0xF8FF, 0xF0000, 0xFFFFD, 0x100000, 0x10FFFD];

  function charName(cp) {
    var n = DATA.NAMES[hex(cp)];
    if (n) return n;
    if (inRange(cp, UNIFIED)) return 'CJK UNIFIED IDEOGRAPH-' + hex(cp);
    if (inRange(cp, COMPAT_IDEO)) return 'CJK COMPATIBILITY IDEOGRAPH-' + hex(cp);
    if (cp >= 0xE0100 && cp <= 0xE01EF) return 'VARIATION SELECTOR-' + (cp - 0xE0100 + 17);
    if (inRange(cp, PUA)) return '<private use>';
    if (cp >= 0xD800 && cp <= 0xDFFF) return '<surrogate>';
    if (cp >= 0xAC00 && cp <= 0xD7A3) return 'HANGUL SYLLABLE';
    return '';
  }

  var GC_LIST = ['Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'Mn', 'Mc', 'Me', 'Nd', 'Nl', 'No', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
    'Sm', 'Sc', 'Sk', 'So', 'Zs', 'Zl', 'Zp', 'Cc', 'Cf', 'Cs', 'Co', 'Cn'];
  var GC_RE = GC_LIST.map(function (g) { return new RegExp('^\\p{' + g + '}$', 'u'); });
  function generalCategory(cp) {
    if (cp >= 0xD800 && cp <= 0xDFFF) return 'Cs';
    var s = String.fromCodePoint(cp);
    for (var i = 0; i < GC_RE.length; i++) if (GC_RE[i].test(s)) return GC_LIST[i];
    return 'Cn';
  }
  function charInfo(cp) {
    return { cp: cp, code: uplus(cp), name: charName(cp), gc: generalCategory(cp) };
  }

  var RE_HAN = /^\p{Script=Han}$/u;
  var RE_LATIN = /^\p{Script=Latin}$/u;
  var RE_LETTER = /^\p{L}$/u;
  var RE_MARK = /^\p{M}$/u;
  var RE_PICTO = /^\p{Extended_Pictographic}$/u;
  function str(cp) { return cp == null ? '' : String.fromCodePoint(cp); }
  function isHan(cp) { return cp != null && RE_HAN.test(str(cp)); }
  function isLatin(cp) { return cp != null && RE_LATIN.test(str(cp)); }
  function isLetter(cp) { return cp != null && RE_LETTER.test(str(cp)); }
  var RE_LCG = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]$/u;
  function isLCG(cp) { return cp != null && RE_LETTER.test(str(cp)) && RE_LCG.test(str(cp)); }
  function isPicto(cp) { return cp != null && RE_PICTO.test(str(cp)); }
  function isVS(cp) { return (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF); }
  function isMark(cp) { return cp != null && !isVS(cp) && RE_MARK.test(str(cp)); }
  function isKana(cp) { return cp != null && cp >= 0x3041 && cp <= 0x30FF && cp !== 0x3099 && cp !== 0x309A && cp !== 0x309B && cp !== 0x309C && cp !== 0x30FB; }
  function isKatakana(cp) { return cp != null && ((cp >= 0x30A1 && cp <= 0x30FA) || cp === 0x30FC || (cp >= 0x31F0 && cp <= 0x31FF)); }
  function nfc(s) { return s.normalize('NFC'); }
  function nfkc(s) { return s.normalize('NFKC'); }
  function cpLen(s) { return Array.from(s).length; }

  var INVISIBLE = {};
  [0x00AD, 0x034F, 0x061C, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x180E, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F,
    0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069,
    0x206A, 0x206B, 0x206C, 0x206D, 0x206E, 0x206F, 0x3164, 0xFEFF, 0xFFA0, 0xFFF9, 0xFFFA, 0xFFFB,
    0x1D173, 0x1D174, 0x1D175, 0x1D176, 0x1D177, 0x1D178, 0x1D179, 0x1D17A].forEach(function (c) { INVISIBLE[c] = 1; });
  var ODD_SPACE = {};
  [0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
    0x202F, 0x205F].forEach(function (c) { ODD_SPACE[c] = 1; });

  function isEnclosed(cp) {
    return (cp >= 0x2460 && cp <= 0x24FF) || (cp >= 0x3200 && cp <= 0x33FF) ||
      (cp >= 0x1F100 && cp <= 0x1F1E5) || (cp >= 0x1F200 && cp <= 0x1F2FF) ||
      cp === 0x2116 || cp === 0x2121 || cp === 0x213B;
  }

  /* ------------------------------------------------------------------
   * 1文字の判定（前後の文字を参照）
   * 戻り値: { cat, rep(置換文字列|null), auto(既定で変換対象か), note, severity? } | null
   * ------------------------------------------------------------------ */
  function classify(cps, k, opts) {
    var c = cps[k], prev = k > 0 ? cps[k - 1] : null, next = k + 1 < cps.length ? cps[k + 1] : null;
    var ch = str(c), r;

    // 不正なサロゲート・置換文字・非文字
    if (c >= 0xD800 && c <= 0xDFFF) return { cat: 'broken', rep: null, note: '対になっていないサロゲート（文字化け）' };
    if (c === 0xFFFD) return { cat: 'broken', rep: null, note: '置換文字。元の文字が失われています' };
    if ((c & 0xFFFE) === 0xFFFE || (c >= 0xFDD0 && c <= 0xFDEF)) return { cat: 'broken', rep: null, note: '非文字' };

    // 結合濁点・半濁点（合成できなかったもの）
    if (c === 0x3099 || c === 0x309A) {
      return { cat: 'combining_kana', rep: null, note: '直前の文字と合成できない結合' + (c === 0x3099 ? '濁点' : '半濁点') + '（意図的な表記の可能性もあります）' };
    }

    // 康煕部首
    if (c >= 0x2F00 && c <= 0x2FDF) {
      r = nfkc(ch);
      if (KANGXI_JA[ch]) return { cat: 'kangxi', rep: KANGXI_JA[ch], auto: true, note: '康煕部首。日本語の字形に合わせて「' + KANGXI_JA[ch] + '」を提案（NFKCでは「' + r + '」）' };
      if (r !== ch) return { cat: 'kangxi', rep: r, auto: true, note: '康煕部首（見た目は同じ別文字）' };
      return { cat: 'kangxi', rep: null, note: '未割り当ての康煕部首領域' };
    }

    // CJK部首補助
    if (c >= 0x2E80 && c <= 0x2EFF) {
      var eq = DATA.RADICAL_EQUIV[hex(c)];
      var name = charName(c);
      if (/C-SIMPLIFIED/.test(name)) {
        var ja = RADICAL_C_SIMPLIFIED_JA[ch] || null;
        return { cat: 'radical_sup', rep: ja, auto: false,
          note: '中国簡化字形の部首' + (eq ? '（簡体字「' + eq + '」相当）' : '') + '。日本語なら「' + (ja || '?') + '」の可能性' };
      }
      if (eq && eq.codePointAt(0) >= 0x4E00 && eq.codePointAt(0) <= 0x9FFF) {
        return { cat: 'radical_sup', rep: eq, auto: true, note: 'CJK部首補助（見た目は同じ別文字）' };
      }
      if (eq) return { cat: 'radical_sup', rep: eq, auto: false, note: '対応する統合漢字「' + eq + '」は拡張領域の文字（' + uplus(eq.codePointAt(0)) + '）。要確認' };
      return { cat: 'radical_sup', rep: null, note: '対応する通常の漢字がない部首' };
    }

    // CJK字画・漢字構成記述文字
    if ((c >= 0x31C0 && c <= 0x31EF) || (c >= 0x2FF0 && c <= 0x2FFF)) {
      return { cat: 'cjk_misc', rep: null, note: c >= 0x31C0 ? 'CJK字画（筆画）' : '漢字構成記述文字（IDS）' };
    }

    // CJK互換漢字
    if (inRange(c, COMPAT_IDEO)) {
      r = nfc(ch);
      if (r !== ch) return { cat: 'compat_ideograph', rep: r, auto: true, note: 'CJK互換漢字（正規分解: ' + uplus(r.codePointAt(0)) + '）。字形の区別が必要な場合は変換をオフに' };
      if (generalCategory(c) === 'Lo') return { cat: 'compat_ideograph', rep: null, severity: 'info', note: '互換漢字ブロックにあるが正規の統合漢字（変換不要）' };
      return null;
    }

    // 異体字セレクタ
    if (isVS(c)) {
      if ((c === 0xFE0E || c === 0xFE0F) && (isPicto(prev) || (prev != null && /[0-9#*\u2122\u00A9\u00AE]/.test(str(prev))))) return null;
      return { cat: 'variation_selector', rep: '', auto: true,
        note: c >= 0xE0100 ? '漢字の異体字指定（IVS）。削除すると標準字形になります' : '異体字セレクタ（不可視）' };
    }

    // 改行区切り
    if (c === 0x2028 || c === 0x2029) return { cat: 'invisible', rep: '\n', auto: true, note: (c === 0x2028 ? '行' : '段落') + '区切り文字。通常の改行に変換' };

    // 不可視文字
    if (INVISIBLE[c]) {
      if (c === 0x200D && isPicto(prev) && isPicto(next)) return null; // 絵文字のZWJシーケンス
      return { cat: 'invisible', rep: '', auto: true, note: '不可視文字' };
    }
    if (c >= 0xE0000 && c <= 0xE007F) {
      if (isPicto(prev) || (prev >= 0xE0000 && prev <= 0xE007F)) return null; // 絵文字のタグシーケンス
      return { cat: 'invisible', rep: '', auto: true, note: 'タグ文字（不可視）' };
    }
    if ((c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) || (c >= 0x7F && c <= 0x9F)) {
      return { cat: 'invisible', rep: '', auto: true, note: '制御文字' };
    }

    // 空白
    if (ODD_SPACE[c]) return { cat: 'odd_space', rep: ' ', auto: true, note: '特殊な空白。半角スペースに置換' };
    if (c === 0x3000) return opts.detectIdeographicSpace ? { cat: 'ideographic_space', rep: ' ', auto: true, note: '全角スペース' } : null;

    // 半角カナ
    if (c >= 0xFF61 && c <= 0xFF9F) {
      r = c === 0xFF9E ? '\u309B' : c === 0xFF9F ? '\u309C' : nfkc(ch);
      return { cat: 'halfwidth_kana', rep: r, auto: true, note: '半角カナ・半角記号' };
    }
    // 全角英数字（記号は対象外）。カタカナ語中の全角マイナスは紛らわしい文字として扱う
    if ((c >= 0xFF10 && c <= 0xFF19) || (c >= 0xFF21 && c <= 0xFF3A) || (c >= 0xFF41 && c <= 0xFF5A)) {
      return { cat: 'fullwidth_ascii', rep: nfkc(ch), auto: true, note: '全角英数字' };
    }
    // 欧文合字
    if (c >= 0xFB00 && c <= 0xFB06) return { cat: 'ligature', rep: nfkc(ch), auto: true, note: '合字（1文字で複数の文字を表す）' };
    // 縦書き用・小字形
    if ((c >= 0xFE10 && c <= 0xFE19) || (c >= 0xFE30 && c <= 0xFE4F) || (c >= 0xFE50 && c <= 0xFE6B)) {
      r = nfkc(ch);
      return { cat: 'vertical', rep: r !== ch ? r : null, auto: r !== ch, note: '縦書き用／小字形の互換文字' };
    }
    // 囲み文字・組文字
    if (isEnclosed(c)) {
      r = nfkc(ch);
      if (r === ch) return null;
      return { cat: 'enclosed', rep: r, auto: true, note: (c >= 0x3300 && c <= 0x33FF ? 'CJK互換用文字（組文字・単位記号）' : '囲み文字・組文字') + '。NFKCでは「' + r + '」' };
    }
    // 私用領域
    if (inRange(c, PUA)) return { cat: 'pua', rep: null, note: '私用領域（外字）。環境によって表示が異なります' };

    // 紛らわしい文字
    if (c === 0x3161 || c === 0x1173) {
      return { cat: 'lookalike', rep: 'ー', auto: true, note: 'ハングルの「ㅡ」。長音符「ー」の誤りの可能性' };
    }
    if (KATAKANA_LOOKALIKE[ch] && isKatakana(next)) {
      var strict = KATAKANA_LOOKALIKE_STRICT[ch];
      if (isKatakana(prev) || (!strict && !isHan(prev) && !isKatakana(prev))) {
        return { cat: 'lookalike', rep: KATAKANA_LOOKALIKE[ch], auto: true, note: 'カタカナ語の中の漢字「' + ch + '」。カタカナ「' + KATAKANA_LOOKALIKE[ch] + '」の誤りの可能性' };
      }
    }
    if (KATAKANA_LOOKALIKE[ch] === 'ー' || DASHES[c]) {
      if (DASHES[c] && isKatakana(prev) && isKatakana(next)) {
        return { cat: 'lookalike', rep: 'ー', auto: true, note: 'カタカナ語の中のダッシュ・罫線類。長音符「ー」の誤りの可能性' };
      }
    }
    if (CYR_GREEK_LATIN[ch]) {
      // 同じ「単語」（ラテン・キリル・ギリシャ文字の連続）にラテン文字があるか
      var hasLatin = false, j;
      for (j = k - 1; j >= 0 && isLCG(cps[j]); j--) if (isLatin(cps[j])) { hasLatin = true; break; }
      if (!hasLatin) for (j = k + 1; j < cps.length && isLCG(cps[j]); j++) if (isLatin(cps[j])) { hasLatin = true; break; }
      if (hasLatin) {
        return { cat: 'lookalike', rep: CYR_GREEK_LATIN[ch], auto: true,
          note: (c >= 0x0400 ? 'キリル' : 'ギリシャ') + '文字がラテン文字の単語に混入（ラテン文字「' + CYR_GREEK_LATIN[ch] + '」の誤りの可能性）' };
      }
    }

    // 簡体字・繁体字
    if (SIMPLIFIED_JA[ch]) {
      if (SIMPLIFIED_IN_JIS[ch]) {
        return { cat: 'simplified', rep: SIMPLIFIED_JA[ch], auto: true, severity: 'info', note: '簡体字と同形（JISにもあるが日本語ではまれ）。日本語の字体は「' + SIMPLIFIED_JA[ch] + '」' };
      }
      return { cat: 'simplified', rep: SIMPLIFIED_JA[ch], auto: true, note: NOTE_BY_CHAR[ch] || '中国語の簡体字。日本語の字体は「' + SIMPLIFIED_JA[ch] + '」' };
    }
    if (SIMPLIFIED_AUTO[ch]) {
      var t = SIMPLIFIED_AUTO[ch];
      var tj = TRADITIONAL_JA[t] || t;
      return { cat: 'simplified', rep: tj, auto: true, note: '日本の文字コード（JIS）にない簡体字。対応する繁体字は「' + t + '」' + (tj !== t ? '（日本の字体「' + tj + '」）' : '') };
    }
    if (TRADITIONAL_JA[ch]) {
      if (TRADITIONAL_IN_JIS[ch]) {
        return { cat: 'traditional', rep: TRADITIONAL_JA[ch], auto: true, severity: 'info', note: '旧字体（JISにある字）。常用字体は「' + TRADITIONAL_JA[ch] + '」。人名・固有名詞では正しい場合が多い' };
      }
      return { cat: 'traditional', rep: TRADITIONAL_JA[ch], auto: true, note: '日本の文字コード（JIS X 0208）にない繁体字。日本の字体は「' + TRADITIONAL_JA[ch] + '」' };
    }
    return null;
  }

  /* ------------------------------------------------------------------
   * 解析
   * ------------------------------------------------------------------ */
  function analyze(text, opts) {
    opts = opts || {};
    text = text == null ? '' : String(text);
    var cps = [], offs = [], lines = [], cols = [];
    var line = 1, col = 1, i = 0;
    while (i < text.length) {
      var c = text.codePointAt(i);
      cps.push(c); offs.push(i); lines.push(line); cols.push(col);
      i += c > 0xFFFF ? 2 : 1;
      if (c === 0x0A || (c === 0x0D && text.charCodeAt(i) !== 0x0A) || c === 0x2028 || c === 0x2029) { line++; col = 1; }
      else col++;
    }
    offs.push(text.length);

    var issues = [];
    function push(k, n, res) {
      var cat = CAT_BY_ID[res.cat];
      var seq = cps.slice(k, k + n);
      issues.push({
        start: offs[k], end: offs[k + n], text: text.slice(offs[k], offs[k + n]),
        codePoints: seq, chars: seq.map(charInfo),
        category: res.cat, categoryLabel: cat.label,
        severity: res.severity || cat.severity,
        replacement: res.rep == null ? null : res.rep,
        auto: !!res.auto && res.rep != null,
        note: res.note || '', line: lines[k], col: cols[k]
      });
    }

    var k = 0;
    while (k < cps.length) {
      var c0 = cps[k], c1 = k + 1 < cps.length ? cps[k + 1] : null, composed;

      // かな＋濁点・半濁点（結合・単独・半角）
      if (isKana(c0) && c1 != null && (c1 === 0x3099 || c1 === 0x309A || c1 === 0x309B || c1 === 0x309C || c1 === 0xFF9E || c1 === 0xFF9F)) {
        var comb = (c1 === 0x3099 || c1 === 0x309B || c1 === 0xFF9E) ? 0x3099 : 0x309A;
        composed = nfc(String.fromCodePoint(c0, comb));
        if (cpLen(composed) === 1) {
          var catK = c1 <= 0x309A ? 'combining_kana' : c1 <= 0x309C ? 'spacing_mark' : 'halfwidth_kana';
          push(k, 2, { cat: catK, rep: composed, auto: true,
            note: catK === 'combining_kana' ? '濁点・半濁点が結合文字で分かれています（' + uplus(c1) + '）'
              : catK === 'spacing_mark' ? '単独の' + (comb === 0x3099 ? '濁点「゛」' : '半濁点「゜」') + 'を合成'
                : '半角の濁点・半濁点を合成' });
          k += 2; continue;
        }
      }
      // 半角カナ＋半角濁点
      if (c0 >= 0xFF66 && c0 <= 0xFF9D && (c1 === 0xFF9E || c1 === 0xFF9F)) {
        composed = nfkc(String.fromCodePoint(c0, c1));
        if (cpLen(composed) === 1) { push(k, 2, { cat: 'halfwidth_kana', rep: composed, auto: true, note: '半角カナ（濁点付き）' }); k += 2; continue; }
      }
      // 分解された文字（基底文字＋結合文字）
      if (c1 != null && isMark(c1) && !isMark(c0) && c1 !== 0x3099 && c1 !== 0x309A && !inRange(c0, COMPAT_IDEO)) {
        var n = 1;
        while (k + n < cps.length && isMark(cps[k + n]) && cps[k + n] !== 0x3099 && cps[k + n] !== 0x309A) n++;
        var cluster = String.fromCodePoint.apply(null, cps.slice(k, k + n));
        composed = nfc(cluster);
        if (composed !== cluster && cpLen(composed) < n) {
          push(k, n, { cat: 'decomposed', rep: composed, auto: true, note: '結合文字で分解された文字。NFCで合成' });
          k += n; continue;
        }
      }

      var res = classify(cps, k, opts);
      if (res) push(k, 1, res);
      k++;
    }

    var counts = {};
    CATEGORIES.forEach(function (c) { counts[c.id] = 0; });
    issues.forEach(function (x) { counts[x.category]++; });
    return { issues: issues, counts: counts, length: cps.length };
  }

  function defaultEnabled() {
    var e = {};
    CATEGORIES.forEach(function (c) { e[c.id] = c.defaultOn; });
    return e;
  }

  /** その指摘が変換されるか */
  function willConvert(issue, opts) {
    opts = opts || {};
    var enabled = opts.enabled || defaultEnabled();
    if (issue.replacement == null || !enabled[issue.category]) return false;
    return issue.auto || !!opts.applySuggestions;
  }

  /**
   * 正規化
   * opts.enabled: { カテゴリID: true/false }（省略時は既定値）
   * opts.applySuggestions: 「要確認」の提案（部首補助の簡化字形など）も適用
   * opts.detectIdeographicSpace: 全角スペースを検出
   */
  function normalize(text, opts) {
    opts = opts || {};
    text = text == null ? '' : String(text);
    var issues = opts.issues || analyze(text, opts).issues;
    var out = '', pos = 0;
    issues.forEach(function (x) {
      if (!willConvert(x, opts)) return;
      out += text.slice(pos, x.start) + x.replacement;
      pos = x.end;
    });
    return out + text.slice(pos);
  }

  var SAMPLE_TEXT = [
    '【康煕部首】⽇本の⾼校で⽉に⼀度、⾷事会を⾏う。⼾籍・⾭空・⿈⾦',
    '【CJK部首補助】⻑野県の⻄側、⺠間の⻘年が⻝堂で⻤ごっこ。⻩色い⺟',
    '【結合濁点】か\u3099っこう、ハ\u309Aソコン、て\u3099ーた\u3099',
    '【単独濁点】か゛くせい、ハ゜ン',
    '【互換漢字】\uFA19社・\uFA1B・\uFA10（→神社・福・塚）、山\uFA11さん（﨑は正規の漢字）',
    '【異体字セレクタ】葛\uDB40\uDD00飾区、辻\uDB40\uDD01、邊\uFE00',
    '【不可視文字】ゼロ\u200B幅\u200Bスペース、\uFEFFBOM、ソフト\u00ADハイフン',
    '【特殊な空白】価格:\u00A01,000円\u2002（NBSP・EN SPACE）',
    '【半角カナ】ｶﾞｲﾄﾞﾌﾞｯｸ｡ﾊﾟｿｺﾝ',
    '【全角英数】ＰＤＦ２０２６年',
    '【囲み・組文字】①②、㈱ABC、㍿、㌔、㎡、№1',
    '【合字】ﬁle ofﬁce workﬂow',
    '【縦書き用】︵縦書き︶︒続く︙',
    '【分解アクセント】cafe\u0301 re\u0301sume\u0301',
    '【簡体字】这是说明书。门、车、东京、时间、长野',
    '【繁体字】說明、稅金、戶籍、黃色',
    '【紛らわしい】プ口グラム、ラ一メン、デ―タ、コㅡヒー、Аpple（Aがキリル文字）',
    '【その他】私用領域\uE000、文字化け\uFFFD、字画\u31C0'
  ].join('\n');

  return {
    CATEGORIES: CATEGORIES,
    analyze: analyze,
    normalize: normalize,
    willConvert: willConvert,
    defaultEnabled: defaultEnabled,
    charInfo: charInfo,
    charName: charName,
    generalCategory: generalCategory,
    uplus: uplus,
    SAMPLE_TEXT: SAMPLE_TEXT,
    tables: {
      KANGXI_JA: KANGXI_JA, RADICAL_C_SIMPLIFIED_JA: RADICAL_C_SIMPLIFIED_JA,
      SIMPLIFIED_JA: SIMPLIFIED_JA, SIMPLIFIED_AUTO: SIMPLIFIED_AUTO, TRADITIONAL_JA: TRADITIONAL_JA,
      KATAKANA_LOOKALIKE: KATAKANA_LOOKALIKE, CYR_GREEK_LATIN: CYR_GREEK_LATIN
    }
  };
});
