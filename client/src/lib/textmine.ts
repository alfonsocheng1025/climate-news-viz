/**
 * 轻量前端文本挖掘：从文章标题 + 导语中提取
 *  1) 关键词词云（高频实词，去停用词）
 *  2) 实体提及排行（连续大写词组的近似命名实体识别）
 *
 * 说明：这是不依赖后端 NLP 的「近似」方法，适合在浏览器即时计算。
 * 实体识别基于「连续首字母大写的词组」启发式（适用于拉丁字母语种），
 * 中文/非拉丁文本主要贡献关键词词云。
 */

import type { Article } from "./climate";

// 英文常见停用词 + 新闻高频虚词
const STOP_EN = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","at","by","from",
  "as","is","are","was","were","be","been","being","it","its","this","that","these",
  "those","he","she","they","we","you","i","his","her","their","our","your","my",
  "will","would","can","could","should","may","might","must","has","have","had","do",
  "does","did","not","no","yes","up","down","out","over","after","before","than",
  "then","into","about","more","most","said","say","says","new","one","two","also",
  "who","what","when","where","why","how","which","there","here","all","some","any",
  "such","only","just","very","so","if","because","while","during","through","per",
  "amid","amp","via","s","t","re","ve","ll","m","d","year","years","day","days","week",
  "month","time","get","got","make","made","like","now","still","back","first","last",
  "many","much","other","another","each","both","between","against","without","within",
]);

// 多语种停用词（西/法/德/葡/意），用于过滤翻译/外文报道带来的虚词噪声
// 例：del、para、que、los、una、por、con、die、mayo 等
const STOP_MULTI = new Set([
  // 西班牙语 / 葡萄牙语
  "el","la","los","las","un","una","unos","unas","de","del","al","y","o","que","qual",
  "para","por","con","sin","sobre","como","mas","pero","este","esta","estos","estas",
  "ese","esa","esto","eso","su","sus","se","le","les","lo","nos","me","te","mi","tu",
  "es","son","fue","fueron","ser","estar","esta","hay","han","ha","hace","todo","todos",
  "toda","todas","muy","mas","menos","entre","hasta","desde","cuando","donde","quien",
  "cual","ano","anos","dia","dias","hoy","ayer","manana",
  // 葡萄牙语特有
  "os","as","um","uma","dos","das","nao","sim","com","sem","pelo","pela","seu","sua",
  "isso","isto","aquele","sao","foi","tem","ate","mais","muito","entao","porque",
  // 月份（多语）
  "enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre",
  "octubre","noviembre","diciembre","janeiro","fevereiro","marco","maio","junho",
  "julho","setembro","outubro","novembro","dezembro",
  // 法语
  "le","les","des","une","du","et","ou","qui","que","quoi","dans","pour","par","sur",
  "avec","sans","sous","vers","chez","mais","donc","car","ne","pas","plus","tres",
  "cette","ces","cet","ils","elles","nous","vous","leur","leurs","son","ses","est",
  "sont","etre","avoir","fait","deux","aux","ans","jour","jours",
  // 德语
  "der","die","das","den","dem","des","ein","eine","einen","einem","einer","und","oder",
  "aber","auch","als","auf","aus","bei","mit","nach","von","vor","zu","zur","zum","fur",
  "ist","sind","war","waren","sein","hat","haben","wird","werden","nicht","sich","sie",
  "sein","ich","wir","ihr","ihre","sein","dass","wie","was","wer","wenn","weil","uber",
  "mehr","sehr","noch","schon","jahr","jahre","tag",
  // 意大利语
  "il","lo","gli","le","un","uno","una","di","da","in","con","su","per","tra","fra",
  "che","chi","non","piu","come","anche","questo","questa","sono","era","essere","ha",
  "hanno","sul","della","delle","degli","nel","nella","anno","anni","giorno",
  // 其他高频外文实词噪声 / 截断碎片
  "calor","nino","nina","nda","clima","climatico","climatica","medio","ambiente",
  "gobierno","pais","paises","mundo","agua","energia","region","ciudad","nacional",
]);

// 中文停用词（精简）
const STOP_ZH = new Set([
  "的","了","和","是","在","我","有","他","这","中","大","来","上","国","个","到",
  "说","们","为","子","与","也","你","对","生","能","而","会","以","及","等","就",
  "着","或","被","把","让","从","向","但","并","其","之","该","将","已","可","因",
  "于","年","月","日","号","报道","新闻","表示","记者","报","图","视频","点击","分享",
]);

// 实体黑名单（太泛的词组 / 句首函数词）
const ENTITY_STOP = new Set([
  "The","A","An","This","That","New","Mr","Ms","Mrs","Dr","Sir","According","After",
  "Before","During","Climate","Change","Global","Warming","Weather","Energy","Carbon",
  "As","At","In","On","Of","To","For","With","By","From","It","He","She","They","We",
  "But","And","Or","While","When","Where","What","How","Why","Who","Now","Here","There",
  "More","Most","Some","All","One","Two","First","Last","Next","Many","Other","Both",
  "Health","June","July","January","February","March","April","May","August","September",
  "October","November","December","Monday","Tuesday","Wednesday","Thursday","Friday",
  "Saturday","Sunday","Report","News","Study","World","Government","State","States",
]);

// 去除 HTML 实体与转义残留（如 &#xfc; 被截断成 xfc），顺便解码常见实体。
function cleanText(s: string): string {
  if (!s) return "";
  return s
    // 数值实体 &#123; / &#xAB;
    .replace(/&#x?[0-9a-f]+;?/gi, " ")
    // 命名实体 &amp; &nbsp; 等
    .replace(/&[a-z]+;/gi, " ")
    // 裸露的转义碎片（如 \u00fc -> u00fc 或 xfc、x39）
    .replace(/\bx[0-9a-f]{2,4}\b/gi, " ")
    .replace(/\bu[0-9a-f]{4}\b/gi, " ");
}

/**
 * 解码文本中的 HTML 实体（用于标题/导语的友好展示）。
 * 例：&#x2014; -> —；&amp; -> &；&#39; -> '；&uuml; -> ü。
 * 与 cleanText 不同：cleanText 是为词频统计「去噪」（直接丢弃实体），
 * 这里是为展示「还原」成可读字符。
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", deg: "°",
  eacute: "é", egrave: "è", agrave: "à", uuml: "ü", ouml: "ö",
  auml: "ä", ntilde: "ñ", ccedil: "ç", szlig: "ß", iexcl: "¡",
  iquest: "¿", trade: "™", reg: "®", copy: "©", euro: "€", pound: "£",
};

export function decodeEntities(s: string): string {
  if (!s) return "";
  return s
    // 十六进制数值实体 &#x2014;
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return " "; }
    })
    // 十进制数值实体 &#8212;
    .replace(/&#(\d+);?/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return " "; }
    })
    // 命名实体 &amp; &mdash; 等
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface TermCount {
  text: string;
  count: number;
}

function tokensFor(s: string): string[] {
  if (!s) return [];
  // 拉丁词（过滤以单字母 x/u 开头的转义碎片）
  const latin = ((s.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'-]{2,}/gi) ?? []) as string[])
    .filter((w) => !/^x[0-9a-f]{2,4}$/i.test(w) && !/^u[0-9a-f]{4}$/i.test(w));
  // 中文双字词（粗切：相邻汉字两两成词）
  const zhChars = s.match(/[\u4e00-\u9fa5]/g) ?? [];
  const zhBigrams: string[] = [];
  for (let i = 0; i < zhChars.length - 1; i++) {
    zhBigrams.push(zhChars[i] + zhChars[i + 1]);
  }
  return [...latin, ...zhBigrams];
}

/** 关键词词云：标题权重更高 */
export function buildWordCloud(arts: Article[], limit = 60): TermCount[] {
  const freq = new Map<string, number>();
  for (const a of arts) {
    const title = cleanText(a.title ?? "");
    const lede = cleanText(a.lede ?? "");
    // 标题词权重 2，导语权重 1
    for (const w of tokensFor(title)) addTerm(freq, w, 2);
    for (const w of tokensFor(lede)) addTerm(freq, w, 1);
  }
  return Array.from(freq.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function addTerm(freq: Map<string, number>, w: string, weight: number) {
  // 过滤停用词与过短词
  if (/^[a-zà-ÿ'-]+$/i.test(w)) {
    if (STOP_EN.has(w) || STOP_MULTI.has(w) || w.length < 3) return;
  } else {
    // 中文 bigram
    if (STOP_ZH.has(w)) return;
    // 含停用字的 bigram 大多无意义
    if (Array.from(w).some((c) => STOP_ZH.has(c))) return;
  }
  freq.set(w, (freq.get(w) ?? 0) + weight);
}

/**
 * 近似命名实体：抓取连续「首字母大写」的词组（>=1 词，可含 of/and/&）。
 * 例："United Nations"、"European Union"、"Donald Trump"、"COP30"（全大写也算）。
 */
export function buildEntities(arts: Article[], limit = 20): TermCount[] {
  const freq = new Map<string, number>();
  const re = /\b([A-Z][a-zà-ÿ]+(?:\s+(?:of|and|&|the|de|del|la)?\s*[A-Z][a-zà-ÿ]+){0,3}|[A-Z]{2,}\d*)\b/g;
  for (const a of arts) {
    const text = cleanText(`${a.title ?? ""}. ${a.lede ?? ""}`);
    const seen = new Set<string>(); // 同一篇内同实体只计一次
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      let ent = m[1].trim().replace(/\s+/g, " ");
      // 去掉领头的冠词 The/A/An（“The Trump” -> “Trump”）
      ent = ent.replace(/^(The|A|An)\s+/i, "").trim();
      // 跳过被截断的重音词（如 “El Ni” <- El Niño）：末词长度 <=2 且多词时可疑
      const words = ent.split(" ");
      if (words.length >= 2 && words[words.length - 1].length <= 2) {
        ent = words.slice(0, -1).join(" ");
      }
      if (!ent) continue;
      const w2 = ent.split(" ");
      // 句首单个大写词常是普通词 -> 跳过单词且在黑名单
      if (w2.length === 1 && (ENTITY_STOP.has(ent) || ent.length < 3)) continue;
      if (w2.every((w) => ENTITY_STOP.has(w))) continue;
      if (seen.has(ent)) continue;
      seen.add(ent);
      freq.set(ent, (freq.get(ent) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .map(([text, count]) => ({ text, count }))
    .filter((e) => e.count >= 2) // 至少被 2 篇提及，去噪
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** 媒体/机构排行：按 domain 聚合（outlet 作为展示名优先） */
export function buildOutletRanking(
  arts: Article[],
  limit = 12,
): { domain: string; label: string; count: number }[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const a of arts) {
    const domain = a.domain || "未知来源";
    const label = a.outlet || a.domain || "未知来源";
    const cur = map.get(domain);
    if (cur) cur.count += 1;
    else map.set(domain, { label, count: 1 });
  }
  return Array.from(map.entries())
    .map(([domain, v]) => ({ domain, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
