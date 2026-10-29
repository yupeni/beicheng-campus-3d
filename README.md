# 北成國小 3D 互動校園導覽

純靜態網站（Three.js r160 已內附於 `vendor/`），無需建置。

## 上線
整個資料夾上傳到任何靜態空間（GitHub Pages、Netlify、學校主機）即可；必須透過 http(s) 提供，不能直接雙擊 index.html。
本機預覽：`python3 -m http.server 8765` → http://localhost:8765

## 嵌入既有網站
```html
<iframe src="https://你的網址/3dschoold/" style="width:100%;height:80vh;border:0" allow="fullscreen" title="北成國小 3D 校園導覽"></iframe>
```
網址參數：`?night=1` 夜景、`?floor=2` 只看到 2 樓、`?room=教務處` 直接飛到某空間。

## 資料來源與修改
- `campus-data.js`：各棟位置、樓層、每層教室順序（平面圖座標，可直接改教室名稱）。
- `world.json`：周邊道路、鄰近建築、水圳、農地，來自 OpenStreetMap（© OpenStreetMap contributors, ODbL），由 `tools/build_world.py` 產生。頁面底部已標示出處，請保留。
- 各棟位置是對照 Google 地圖衛星圖量測後手動標定（座標換算在 `campus-data.js` 開頭），房間配置依學校配置圖；精度約數公尺。
- 人行道、圍牆、校門、操場、籃球場、校內步道也都在 `campus-data.js`，可直接調整座標。
