/**
 * GDELT 的 sourcecountry 字段使用 FIPS 10-4 国家代码（不是 ISO！）。
 * 例如：CH=中国（非瑞士）、UK=英国、GM=德国、SP=西班牙、TU=土耳其、SZ=瑞士。
 * 世界地图（world-atlas countries-110m）用英文国名（geo.properties.name）匹配，
 * 因此必须先把 FIPS 代码翻译成「地图用的英文国名」，热力图才能正确着色。
 *
 * mapName：world-atlas 110m 里 properties.name 的精确写法（已对齐其命名差异）。
 * zh：中文显示名（用于排行 / KPI / tooltip）。
 */

interface CountryInfo {
  mapName: string; // world-atlas properties.name
  zh: string;
}

// 覆盖 GDELT 常见来源国（FIPS 10-4）。未覆盖的代码回退为原代码本身。
export const FIPS_COUNTRY: Record<string, CountryInfo> = {
  US: { mapName: "United States of America", zh: "美国" },
  UK: { mapName: "United Kingdom", zh: "英国" },
  CH: { mapName: "China", zh: "中国" },
  IN: { mapName: "India", zh: "印度" },
  CA: { mapName: "Canada", zh: "加拿大" },
  AS: { mapName: "Australia", zh: "澳大利亚" },
  FR: { mapName: "France", zh: "法国" },
  GM: { mapName: "Germany", zh: "德国" },
  IT: { mapName: "Italy", zh: "意大利" },
  SP: { mapName: "Spain", zh: "西班牙" },
  RS: { mapName: "Russia", zh: "俄罗斯" },
  JA: { mapName: "Japan", zh: "日本" },
  KS: { mapName: "South Korea", zh: "韩国" },
  KN: { mapName: "North Korea", zh: "朝鲜" },
  BR: { mapName: "Brazil", zh: "巴西" },
  MX: { mapName: "Mexico", zh: "墨西哥" },
  AR: { mapName: "Argentina", zh: "阿根廷" },
  CI: { mapName: "Chile", zh: "智利" },
  CO: { mapName: "Colombia", zh: "哥伦比亚" },
  PE: { mapName: "Peru", zh: "秘鲁" },
  VE: { mapName: "Venezuela", zh: "委内瑞拉" },
  TU: { mapName: "Turkey", zh: "土耳其" },
  SZ: { mapName: "Switzerland", zh: "瑞士" },
  SW: { mapName: "Sweden", zh: "瑞典" },
  NO: { mapName: "Norway", zh: "挪威" },
  FI: { mapName: "Finland", zh: "芬兰" },
  DA: { mapName: "Denmark", zh: "丹麦" },
  NL: { mapName: "Netherlands", zh: "荷兰" },
  BE: { mapName: "Belgium", zh: "比利时" },
  AU: { mapName: "Austria", zh: "奥地利" },
  PO: { mapName: "Poland", zh: "波兰" },
  EZ: { mapName: "Czechia", zh: "捷克" },
  HU: { mapName: "Hungary", zh: "匈牙利" },
  GR: { mapName: "Greece", zh: "希腊" },
  PL: { mapName: "Portugal", zh: "葡萄牙" }, // 注意：FIPS PO=波兰，PL 非标准；GDELT 偶用 PO=葡萄牙? 这里以波兰为准
  RO: { mapName: "Romania", zh: "罗马尼亚" },
  BU: { mapName: "Bulgaria", zh: "保加利亚" },
  RI: { mapName: "Serbia", zh: "塞尔维亚" },
  HR: { mapName: "Croatia", zh: "克罗地亚" },
  EI: { mapName: "Ireland", zh: "爱尔兰" },
  UP: { mapName: "Ukraine", zh: "乌克兰" },
  EG: { mapName: "Egypt", zh: "埃及" },
  SF: { mapName: "South Africa", zh: "南非" },
  NI: { mapName: "Nigeria", zh: "尼日利亚" },
  KE: { mapName: "Kenya", zh: "肯尼亚" },
  GH: { mapName: "Ghana", zh: "加纳" },
  ET: { mapName: "Ethiopia", zh: "埃塞俄比亚" },
  MO: { mapName: "Morocco", zh: "摩洛哥" },
  AG: { mapName: "Algeria", zh: "阿尔及利亚" },
  TS: { mapName: "Tunisia", zh: "突尼斯" },
  SA: { mapName: "Saudi Arabia", zh: "沙特阿拉伯" },
  AE: { mapName: "United Arab Emirates", zh: "阿联酋" },
  IS: { mapName: "Israel", zh: "以色列" },
  IR: { mapName: "Iran", zh: "伊朗" },
  IZ: { mapName: "Iraq", zh: "伊拉克" },
  PK: { mapName: "Pakistan", zh: "巴基斯坦" },
  BG: { mapName: "Bangladesh", zh: "孟加拉国" },
  CE: { mapName: "Sri Lanka", zh: "斯里兰卡" },
  NP: { mapName: "Nepal", zh: "尼泊尔" },
  ID: { mapName: "Indonesia", zh: "印度尼西亚" },
  MY: { mapName: "Malaysia", zh: "马来西亚" },
  RP: { mapName: "Philippines", zh: "菲律宾" },
  TH: { mapName: "Thailand", zh: "泰国" },
  VM: { mapName: "Vietnam", zh: "越南" },
  SN: { mapName: "Singapore", zh: "新加坡" },
  BM: { mapName: "Myanmar", zh: "缅甸" },
  CB: { mapName: "Cambodia", zh: "柬埔寨" },
  NZ: { mapName: "New Zealand", zh: "新西兰" },
  // 一个中国原则：台湾、香港、澳门均为中国不可分割的一部分，
  // 地图着色全部归入「中国」（mapName: China），统计篇数并入中国。
  TW: { mapName: "China", zh: "中国台湾" },
  HK: { mapName: "China", zh: "中国香港" },
  MC: { mapName: "China", zh: "中国澳门" },
  QA: { mapName: "Qatar", zh: "卡塔尔" },
  KU: { mapName: "Kuwait", zh: "科威特" },
  LE: { mapName: "Lebanon", zh: "黎巴嫩" },
  JO: { mapName: "Jordan", zh: "约旦" },
   EC: { mapName: "Ecuador", zh: "厄瓜多尔" },
  UY: { mapName: "Uruguay", zh: "乌拉圭" },
  BO: { mapName: "Bolivia", zh: "玻利维亚" },
  PA: { mapName: "Paraguay", zh: "巴拉圭" },
  GT: { mapName: "Guatemala", zh: "危地马拉" },
  CS: { mapName: "Costa Rica", zh: "哥斯达黎加" },
  ZI: { mapName: "Zimbabwe", zh: "津巴布韦" },
  ZA: { mapName: "Zambia", zh: "赞比亚" },
  UG: { mapName: "Uganda", zh: "乌干达" },
  TZ: { mapName: "Tanzania", zh: "坦桑尼亚" },
  WA: { mapName: "Namibia", zh: "纳米比亚" },
  SU: { mapName: "Sudan", zh: "苏丹" },
};

// world-atlas 110m 中部分国家的 properties.name 写法差异修正
const MAP_NAME_FIX: Record<string, string> = {
  Tanzania: "United Republic of Tanzania",
  Serbia: "Republic of Serbia",
  "Bosnia and Herzegovina": "Bosnia and Herz.",
  "South Korea": "South Korea",
  "North Korea": "North Korea",
};

/** FIPS 代码 -> 中文国名（找不到回退原码） */
export function fipsToZh(code: string | null | undefined): string {
  if (!code) return "未知";
  return FIPS_COUNTRY[code]?.zh ?? code;
}

/** FIPS 代码 -> 地图英文国名（找不到回退原码） */
export function fipsToMapName(code: string | null | undefined): string {
  if (!code) return "";
  const info = FIPS_COUNTRY[code];
  if (!info) return code;
  return MAP_NAME_FIX[info.mapName] ?? info.mapName;
}
