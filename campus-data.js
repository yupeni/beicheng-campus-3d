// 北成國小 3D 資料：位置依 Google 地圖衛星圖校正，房間配置依 115 學年度校園及校舍配置圖。
// 世界座標：x 向東、north 向北 (公尺)，原點為 Google 地圖標記點 24.675006, 121.7590891；
// 場景中 z = -north。
export const FLOOR_H = 3.4;

// 衛星圖 (北方朝上) 像素 → 世界座標。以「自強館 OSM 腳印 (-25,-83)」與「敬業路 x≈10」兩處校準，
// 操場外圈實測約 102 x 61 m，圖上約 480 px，故 4.71 px/m。下列建築 rect 都以該截圖的像素表示。
const IM_X0 = -117.6; const IM_N0 = -76.5; const IM_PX0 = 490; const IM_PY0 = 705; const IM_S = 4.71;
export const imX = (px) => IM_X0 + (px - IM_PX0) / IM_S;
export const imN = (py) => IM_N0 - (py - IM_PY0) / IM_S;
// 回傳場景矩形 [x0, z0, x1, z1] (z 向南為正)
export const rI = (x0, y0, x1, y1) => [imX(x0), -imN(y0), imX(x1), -imN(y1)];
// 以世界座標 (x, north) 指定矩形
export const rW = (x0, n0, x1, n1) => [Math.min(x0, x1), -Math.max(n0, n1), Math.max(x0, x1), -Math.min(n0, n1)];

export const CATS = {
  class: { label: '普通教室', color: '#7fb2e5' },
  special: { label: '專科・自然教室', color: '#7fd1a0' },
  admin: { label: '行政・辦公', color: '#e88b6e' },
  kids: { label: '幼兒園・托育', color: '#f29bb8' },
  resource: { label: '圖書・資源・課輔', color: '#f0d36a' },
  sport: { label: '運動・餐飲・活動', color: '#b79be0' },
  wc: { label: '廁所', color: '#9aa5ad' },
  circ: { label: '樓梯・電梯・走廊', color: '#e4dccb' },
};
export function categorize(name) {
  if (/廁/.test(name)) return 'wc';
  if (/樓梯|電梯|走廊|露台|通道/.test(name)) return 'circ';
  if (/幼|班$|托嬰|袋鼠|綿羊/.test(name)) return 'kids';
  if (/處|校長|辦公|人事|視網|會議|研討|休息|諮商|儲物|倉庫|機房|共備|探索|聚寶|警衛/.test(name)) return 'admin';
  if (/圖書|樂讀|樂閱|繪本|資源|校史|特教|遊療|巡迴|課輔|英文|英語|教材|書法|本土|媒創|媒體/.test(name)) return 'resource';
  if (/體育|球|游泳|遊戲|樂活|展演|餐廳|廚房|農場|花園|國樂|律動|司令/.test(name)) return 'sport';
  if (/自然|電腦|科技|音教|美術|藝術|理論|琴房|音樂/.test(name)) return 'special';
  return 'class';
}

export const BUILDING_INFO = {
  deyu: { name: '德育樓', note: '4 層樓普通教室，1 樓為風雨走廊' },
  xinqun: { name: '新群育樓', note: '北棟 4 層 + 5 層會議室；南翼為階梯式 1~5 層' },
  yuedu: { name: '樂讀館・樂閱館', note: '圖書館與桌球教室，階梯式屋頂含彩虹農場' },
  zhiyu: { name: '智育樓', note: '行政處室在 1 樓，普通教室 2~4 樓，5 樓研討室' },
  jiuqun: { name: '舊群育樓', note: '藝術教室、托嬰中心、樂活教室' },
  meiyu: { name: '美育樓', note: '展演廳、幼兒園班級、音樂辦公室' },
  youzhi: { name: '幼稚園・琴房翼', note: '琴房、音樂教室、資優班、幼稚園教室' },
  tiyu: { name: '體育樓', note: '3 層樓，地下為游泳池' },
  zixun: { name: '資訊樓', note: '電腦教室、資源班、地下停車場' },
  canteen: { name: '餐廳・廚房', note: '2F 餐廳、1F 廚房' },
  gym: { name: '自強館', note: '體育館・風雨球場' },
  game: { name: '遊戲教室', note: '' },
  recycle: { name: '資源回收室', note: '北成路一段轉角，白色磁磚外牆，木色小門加白色直條拉門' },
  guard: { name: '第四門警衛室', note: '進入第四門右手邊（北側），門口有波浪形遮雨棚與校名牆' },
};

// ── 一般樓層 part：rows 為各樓層 西→東 (axis x) 或 北→南 (axis z) 的房間序列。
//    語法：以空白分隔；`名稱:權重`；`_N` 為寬度 N 的空白；廁所、樓梯自動變窄。corridor：走廊在哪一側。
// ── 階梯式 col：k 層高的實心柱體，頂層為 names 房間 (k=0 為地下層，屋頂與地面齊平)。
export const PARTS = [
  { bid: 'deyu', rect: rI(650, 62, 1075, 165), axis: 'x', corridor: 'S', rows: {
    '4F': '電梯 410 廁 409 408 廁 407 空中花園:2.2',
    '3F': '電梯 教師休息室 廁 自然4 406 廁 405 樓梯 404 廁 403',
    '2F': '電梯 108 廁 107 106 廁 105 樓梯 104 廁 103',
    '1F': '_9.5 102 廁 101',
  } },
  { bid: 'xinqun', roof: 'red', rect: rI(385, 120, 655, 215), axis: 'x', corridor: 'S', rows: {
    '4F': '樓梯 607 廁 606 自然6 廁 露台',
    '3F': '樓梯 603 廁 602 402 廁 本土語言 樓梯',
    '2F': '電梯 206 廁 207 208 廁 209',
    '1F': '_3 201 廁 書法',
  } },
  { bid: 'xinqun', rect: rI(430, 125, 560, 165), axis: 'x', rows: { '5F': '會議室:2 儲物間 露台' } },
  { bid: 'xinqun', col: 5, rect: rI(380, 250, 406, 460), axis: 'z', names: '露台 共備教室(社會6):2' },
  { bid: 'xinqun', col: 4, rect: rI(406, 250, 425, 460), axis: 'z', names: '608 609' },
  { bid: 'xinqun', col: 3, rect: rI(425, 250, 442, 460), axis: 'z', names: '604 605' },
  { bid: 'xinqun', col: 2, rect: rI(442, 250, 453, 460), axis: 'z', names: '205 204' },
  { bid: 'xinqun', col: 1, rect: rI(453, 250, 462, 460), axis: 'z', names: '202 203' },
  { bid: 'yuedu', col: 3, rect: rI(585, 255, 601, 440), axis: 'z', names: '彩虹農場:4 電梯' },
  { bid: 'yuedu', col: 2, rect: rI(601, 255, 617, 400), axis: 'z', names: '樂讀館:3 教材室' },
  { bid: 'yuedu', col: 1, rect: rI(617, 255, 629, 440), axis: 'z', names: '樂閱館:4 廁' },
  { bid: 'yuedu', col: 1, rect: rI(629, 300, 641, 400), axis: 'z', names: '桌球教室' },
  { bid: 'zhiyu', rect: rI(650, 365, 975, 480), axis: 'x', corridor: 'N', rows: {
    '4F': '樓梯 511 廁 510 509 廁 508 樓梯 多元探索中心:1.6',
    '3F': '樓梯 507 廁 506 505 廁 自然5 樓梯 校史館(課照B):1.6',
    '2F': '樓梯 繪本館(課照A) 廁 504 503 廁 502 樓梯 校長室:1.6',
    '1F': '樓梯 輔導處 廁 學務處 視網 人事會計 教務處 總務處',
  } },
  { bid: 'zhiyu', rect: rI(780, 368, 975, 398), axis: 'x', base: 5, rows: { '5F': '研討室 自然共用教室' } },
  { bid: 'jiuqun', col: 2, rect: rI(300, 300, 318, 455), axis: 'z', names: '廁 藝術1 藝術2 藝術3 英語B課輔E' },
  { bid: 'jiuqun', col: 1, rect: rI(318, 300, 335, 455), axis: 'z', names: '英文A 資源6 資源7 托嬰中心(社會處):2 廁' },
  { bid: 'jiuqun', col: 0, rect: rI(335, 300, 348, 455), axis: 'z', names: '倉庫 樂活教室:4' },
  { bid: 'meiyu', col: 4, rect: rI(235, 310, 255, 440), axis: 'z', names: '廁 展演廳:2 音樂辦公室' },
  { bid: 'meiyu', col: 3, rect: rI(255, 310, 277, 440), axis: 'z', names: '廁 綿羊班 301 401' },
  { bid: 'meiyu', col: 2, rect: rI(277, 310, 296, 440), axis: 'z', names: '廁 袋鼠班 幼稚園教室' },
  { bid: 'youzhi', col: 4, rect: rI(135, 390, 153, 540), axis: 'z', names: '理論 琴房:2' },
  { bid: 'youzhi', col: 3, rect: rI(153, 390, 168, 540), axis: 'z', names: '音教2 資優班1 資優班2 音教1' },
  { bid: 'youzhi', col: 2, rect: rI(168, 390, 182, 540), axis: 'z', names: '幼稚園教室:2 國樂 律動' },
  { bid: 'game', col: 1, rect: rI(185, 455, 235, 535), axis: 'x', names: '遊戲教室' },
  { bid: 'tiyu', rect: rI(280, 462, 600, 562), axis: 'x', corridor: 'N', rows: {
    '3F': '601 501 308 廁 自然3 309 310',
    '2F': '302 303 304 廁 305 306 307',
    '1F': '幼幼班 健康中心 廁 第二電腦教室 科技教室',
  } },
  { bid: 'zixun', rect: rI(635, 488, 845, 578), axis: 'x', corridor: 'N', rows: {
    '2F': '廁 媒體夢工廠(媒體5+6):2 第1電腦教室:1.6 資源5 機房 樓梯 媒創中心(音樂資源教室):1.6',
    '1F': '廁 諮商室 遊療室 巡迴 特教共用 資源1 資源2 資源3 資源4 樓梯 英文D',
  } },
  { bid: 'recycle', col: 1, rect: rW(-87, 80, -76, 73), axis: 'x', names: '資源回收室' },
  { bid: 'guard', col: 1, rect: rW(-7.7, 22, -3, 15), axis: 'z', names: '警衛室' }, // 貼齊大門圍牆 (x=-3)，東面窗口對著進入的車輛
  { bid: 'canteen', rect: rI(572, 42, 652, 112), axis: 'x', corridor: 'S', rows: { '2F': '餐廳:3', '1F': '廚房:3' } },
];

// 風雨走廊 (屋頂 + 柱)
export const COVERED = [
  rI(650, 165, 1075, 185),   // 德育樓南側
  rI(600, 215, 640, 360),    // 樂讀館旁南北向
  rI(470, 215, 580, 232),    // 群育樓南側
  rI(300, 456, 600, 462),    // 體育樓北緣
];

// 鋪面：停車場 / 中庭 / 廣場 (矩形，場景座標)
export const PLAZAS = [
  { rect: rW(-63, 70, -44, 81), color: '#c68b72', name: '第二門紅磚廣場' },
  { rect: rW(-72, -4, -4, 34), color: '#bdb7ad', name: '中庭・停車場・集合場' },
  { rect: rI(850, 480, 1075, 650), color: '#bdb7ad', name: '停車場' },
  { rect: rI(470, 215, 650, 365), color: '#d8c7b0', name: '遊戲區廣場' },
  { rect: rI(285, 560, 880, 660), color: '#d8c7b0', name: '操場前廣場' },
];

// 校內動線 (步道)，折線為世界座標 [x, north]，w 為寬度
// kind：vehicle 車道 (深灰磚)、walk 人行步道 (淺灰水泥)、brick 紅磚步道 (有頂走廊與門口)
export const PATHS = [
  // 停車場單一出入口 (第四門)：沿南側車道往西、在西端迴轉、再沿北側車道往東開出，形成單向迴圈
  { kind: 'vehicle', loop: true, w: 3.4, pts: [[-4, 11.8], [-9, 12.4], [-11.5, 16], [-12, 20], [-14, 23.8], [-18, 24.2], [-40, 24.2], [-66, 24.2], [-70, 22], [-71.5, 16], [-70, 10], [-66, 4.7], [-40, 4.7], [-26, 4.7], [-16, 5.2], [-10, 7], [-4, 8.2]] }, // 入口在北側 (警衛室窗口旁)、出口車道整體南移、出口在南側 (校名牆旁)
  { kind: 'brick', w: 3.5, pts: [[-4, -30], [-28, -30], [-40, -30]] },           // 第五門 (有頂紅磚步道)
  { kind: 'brick', w: 3.5, pts: [[-8, 33], [-8, -30], [-8, -62], [-8, -100]] },  // 東側縱向有頂步道
  { kind: 'walk', w: 4, pts: [[-100, 34], [-100, 10], [-100, -24]] },            // 中央縱向 (新群育樓與樂讀館之間)
  { kind: 'walk', w: 4, pts: [[-100, -20], [-100, -50]] },
  { kind: 'walk', w: 3, pts: [[-100, 10], [-125, 10], [-150, 25]] },             // 往群育樓
  { kind: 'walk', w: 3, pts: [[-60, 34], [-100, 34], [-135, 36]] },              // 德育樓南側往西
  { kind: 'walk', w: 3, pts: [[-100, -24], [-135, -24], [-175, -20]] },          // 體育樓北側
  { kind: 'walk', w: 3, pts: [[-70, -50], [-70, -62]] },                         // 往操場
  { kind: 'walk', w: 2.5, pts: [[-4, -104], [-20, -105], [-40, -108]] },         // 自強館後門小徑
  { kind: 'vehicle', w: 5, pts: [[-53, 89], [-52, 82.2], [-46, 76], [-38, 71], [-30, 67.5], [-22, 64.3], [-22, 72]] }, // 德育樓前接送迴車道 (入口→出口)
  { kind: 'vehicle', w: 5, pts: [[-98, 66], [-110, 56], [-122, 52], [-134, 51]] },                                  // 通道旁往新群育樓穿堂的機車道
  { kind: 'vehicle', w: 5, pts: [[-4, -61], [-12, -58], [-30, -56], [-50, -55]] },           // 第六門車道
];

// 操場 (跑道+草皮)、籃球場、遊戲區、噴水池
export const TRACK = { cx: -117.6, n: -78.5, len: 102, wid: 61 };
export const COURTS = [rW(-145.7, -109.6, -117.7, -124.6), rW(-142.3, -129.5, -114.3, -144.5)]; // 兩面藍色籃球場 (依空拍圖) // 兩面藍色籃球場 (依空拍圖)
export const COVERED_COURT = rW(-167, -110.4, -145.4, -146); // 西南角有頂球場 (風雨球場)
export const PLAY = { rect: rI(480, 225, 580, 335), color: '#9ccf7a', name: '滑梯遊戲區' };
export const FOUNTAIN = { x: -16.5, n: 16 }; // 噴水池：依使用者指定，位於中間花圃島東端
export const GREEN = [
  { rect: rW(-84, -3, -72, 34), color: '#86b86a' },   // 停車場西側小草坪
  { rect: rW(-172, -100, -140, -140), color: '#7fb069' },
  { rect: rW(-70, -100, -52, -62), color: '#7fb069' },
  { rect: rW(-185, 10, -150, 40), color: '#7fb069' },
];

// 校園邊界：依使用者在衛星圖上畫的紅框 (不規則五邊形)，圍牆退縮到道路內側約 6~8 m。
// 順序使「右手邊」為校外：南側往東 → 東側往北 → 北側往西 → 西北斜邊往西南 → 西側往南。
export const BOUNDARY = [[-165.5, -159], [-3, -108], [-3, 59], [-35, 68], [-72, 99], [-202, -5]];
export const SIDEWALK_SEGMENTS = [0, 1, 2, 3]; // 前 5 個頂點之間鋪人行道 (西北斜邊與西側不鋪)

// 校門：位置在邊界線上 [x, north]
export const GATES = [
  // 第一門 (機車通道口) 位於西北斜邊的專用通道上，鋼網拉門在 campus.js 的通道區塊建造
  { name: '汽車入口', x: -52, n: 82.2, style: 'opening', half: 6 },   // 德育樓前接送區：汽車入口 (無門)
  { name: '汽車出口', x: -22, n: 64.3, style: 'opening', half: 6 },   // 汽車出口 (無門)
  { name: '第四門', x: -4, n: 10, cutBack: 10, style: 'opening' }, // 無門框：兩車道 + 道閘桿 (實景) // 南側為校名牆，圍牆在此中斷
  { name: '第五門', x: -4, n: -30, style: 'small', half: 2.0 },        // 行人小門，內側有有頂紅磚步道
  { name: '第六門', x: -4, n: -61, style: 'sliding' }, // 位於自強館北側，入口通往停車場與自強館
  { name: '自強館後門', x: -4, n: -104, style: 'small', half: 2.4 }, // 自強館南端的小門
];
export const FLAG = { x: -49, n: -1.8 }; // 升旗台：依使用者指定，位於停車場南側靠智育樓的空地 (x -58~-40)

export const MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=24.675006,121.7590891';
