"""把 OpenStreetMap (Overpass) 的 JSON 轉成 3D 場景用的 world.json。
座標原點 = Google 地圖標記點 (24.675006, 121.7590891)，單位公尺，x 向東、y 向北。
用法: python3 -I tools/build_world.py osm.json world.json
資料來源 © OpenStreetMap contributors (ODbL)"""
import json, math, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf8'))
lat0, lon0 = 24.675006, 121.7590891
kx = 111320 * math.cos(math.radians(lat0)); ky = 110574
xy = lambda p: [round((p['lon'] - lon0) * kx, 1), round((p['lat'] - lat0) * ky, 1)]
CAMPUS = (-205, -165, 0, 110)   # 北成國小範圍 (x0, y0, x1, y1)：範圍內的 OSM 物件不重複繪製
VIEW = (-420, -300, 280, 260)   # 只保留校園周邊這個範圍
out = {'roads': [], 'buildings': [], 'areas': [], 'water': [], 'gym': []}
for e in d['elements']:
    t = e['tags']; pts = [xy(p) for p in e['geometry']]
    mx = sum(p[0] for p in pts) / len(pts); my = sum(p[1] for p in pts) / len(pts)
    if not (VIEW[0] < mx < VIEW[2] and VIEW[1] < my < VIEW[3]):
        continue
    inside = CAMPUS[0] < mx < CAMPUS[2] and CAMPUS[1] < my < CAMPUS[3]
    all_in = all(CAMPUS[0] < p[0] < CAMPUS[2] and CAMPUS[1] < p[1] < CAMPUS[3] for p in pts)
    if t.get('building') == 'school' and e['id'] != 1360094788:
        continue  # 只呈現北成國小，不畫鄰近學校
    if 'highway' in t:
        if all_in: continue  # 完全位於校內的道路不畫
        out['roads'].append({'n': t.get('name', ''), 'c': t['highway'], 'p': pts})
    elif 'building' in t:
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        if e['id'] == 1360094788:
            out['gym'] = pts[:-1]; continue
        if CAMPUS[0] < cx < CAMPUS[2] and CAMPUS[1] < cy < CAMPUS[3]:
            continue
        out['buildings'].append({'n': t.get('name', ''), 't': t['building'], 'p': pts, 'id': e['id']})
    elif 'waterway' in t:
        out['water'].append({'k': t['waterway'], 'p': pts})
    elif 'landuse' in t or 'leisure' in t:
        if inside or t.get('leisure') in ('pitch', 'swimming_pool'): continue
        k = t.get('landuse') or t.get('leisure')
        out['areas'].append({'k': k, 'p': pts, 'n': t.get('name', '')})
json.dump(out, open(dst, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print({k: len(v) for k, v in out.items()})
