/* ════════════════════════════════════════════════════════════
   걸어서 그날까지 · D-DAY 지도
   - 여러 여정(멀티 디데이) · localStorage 저장
   - 링크 공유 (?share=...) : 상대의 위치와 디데이를 그대로
   - 한국 주소 후보 검색 + 지도에서 핀 찍기
   - 25/50/75%, D-100, D-10, D-1, D-DAY 이정표 응원
   ════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const ROUTES = window.DDAY_ROUTES || {};
  const STORAGE_KEY = "ddaymap.v2";
  const LEGACY_KEY = "dday-map-state";
  const APP_NAME = "걸어서 그날까지";

  const PRESETS = [
    {
      id: "home", route: "home", emoji: "🏠",
      title: "우리의 서초동 귀환",
      sub: "종암동 → 서초3동 · 은퇴 후 돌아가는 길",
      from: "서울 성북구 종암로25길 30",
      to: "서울 서초구 서초3동 1519-9",
      start: "2026-11-14", target: "2033-12-31"
    },
    {
      id: "snu", route: "snu", emoji: "🎓",
      title: "수능 D-100, 서울대까지",
      sub: "상계동 → 서울대 관악캠퍼스 · 100일",
      from: "서울 노원구 상계동",
      to: "서울대학교 관악캠퍼스",
      start: "today", target: "+100"
    },
    {
      id: "jeju", route: "jeju", emoji: "✈️",
      title: "제주 한 달 살이",
      sub: "제주공항 → 성산일출봉 · 30일",
      from: "제주국제공항",
      to: "성산일출봉",
      start: "today", target: "+30"
    }
  ];
  const EMOJIS = ["🏠", "🎓", "✈️", "🚶", "💪", "🎯", "👶", "💍", "📚", "🌱", "⛰️", "🎉"];

  /* ── 날짜 유틸 ── */
  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const todayISO = () => iso(new Date());
  const parseISO = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d, 12, 0, 0); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
  const dotDate = s => String(s || "").replace(/-/g, ".");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ── 거리 유틸 ── */
  function haversine(a, b) {
    const R = 6371008.8, toRad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function kmText(km) {
    const m = km * 1000;
    if (m < 100) return (m < 10 ? m.toFixed(1) : Math.round(m)) + " m";
    if (km < 100) return km.toFixed(1) + " km";
    return Math.round(km).toLocaleString("ko-KR") + " km";
  }
  function durText(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    if (h >= 24) return Math.round(h / 24) + "일";
    return h ? h + "시간" + (m ? " " + m + "분" : "") : m + "분";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ── 상태 ── */
  let store = { v: 2, journeys: [], activeId: null, onboarded: false, seen: {} };
  let current = null;
  let sharedJourney = null;
  let viewDay = null;           // null = 오늘(live)
  let lastDay = null;
  let map = null;
  let layers = {};
  let playing = false, animId = null;
  let deferredPrompt = null;
  let picking = null, pickLL = null, pickMarker = null;
  let sheetMode = null;
  let form = null;
  let searchResults = { from: [], to: [] };
  let toastTimer = null;
  let msTimer = null;

  const CUMS = new WeakMap();

  const $ = id => document.getElementById(id);

  /* ════════════════ 저장소 ════════════════ */
  function uid() { return "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 2, journeys: store.journeys, activeId: store.activeId,
        onboarded: store.onboarded, seen: store.seen
      }));
    } catch (e) {
      toast("저장 공간이 부족해요. 쓰지 않는 여정을 정리해 주세요.", true);
    }
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.journeys) || !s.journeys.length) return null;
      s.journeys = s.journeys.map(normalizeJourney).filter(Boolean);
      if (!s.journeys.length) return null;
      s.seen = s.seen && typeof s.seen === "object" ? s.seen : {};
      return s;
    } catch (e) { return null; }
  }

  /* 예전 프로토타입(dday-map-state)에서 옮겨 오기 */
  function migrateLegacy() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const preset = s.presetId ? PRESETS.find(p => p.id === s.presetId) : null;
      if (preset && ROUTES[preset.route]) {
        const j = presetJourney(preset);
        if (s.title) j.title = s.title;
        if (s.start) j.start = s.start;
        if (s.target) j.target = s.target;
        return j;
      }
      if (s.custom && Array.isArray(s.custom.pts) && s.custom.pts.length > 1) {
        return normalizeJourney({
          id: uid(), title: s.title || "나의 여정", emoji: "🚶",
          from: { name: s.from || "출발지" }, to: { name: s.to || "도착지" },
          start: s.start, target: s.target, presetId: null,
          route: { pts: s.custom.pts, km: s.custom.km, min: s.custom.min, zones: s.custom.zones, landmarks: [] },
          createdAt: Date.now()
        });
      }
    } catch (e) { /* 무시 */ }
    return null;
  }

  function normalizeJourney(j) {
    if (!j) return null;
    const pts = j.route && Array.isArray(j.route.pts) ? j.route.pts : null;
    if (!pts || pts.length < 2) return null;
    j.id = j.id || uid();
    j.title = (j.title || "나의 여정").slice(0, 60);
    j.emoji = j.emoji || "🚶";
    j.start = j.start || todayISO();
    j.target = (j.target && daysBetween(j.start, j.target) >= 1) ? j.target : addDays(j.start, 1);
    j.from = { name: (j.from && j.from.name) || "출발지", ll: (j.from && j.from.ll) || pts[0].slice() };
    j.to = { name: (j.to && j.to.name) || "도착지", ll: (j.to && j.to.ll) || pts[pts.length - 1].slice() };
    j.route.pts = pts.map(p => [+p[0], +p[1]]);
    if (!j.route.km) j.route.km = pathLength(j.route.pts);
    if (!j.route.min) j.route.min = (j.route.km / 4.5) * 60;
    if (!Array.isArray(j.route.zones) || !j.route.zones.length) {
      j.route.zones = [{ f: 0, name: j.from.name }, { f: 1, name: j.to.name }];
    }
    if (!Array.isArray(j.route.landmarks)) j.route.landmarks = [];
    return j;
  }

  function pathLength(pts) {
    let km = 0;
    for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1], pts[i]) / 1000;
    return km;
  }

  function presetJourney(p, id) {
    const r = ROUTES[p.route];
    if (!r) return null;
    const start = p.start === "today" ? todayISO() : p.start;
    const target = String(p.target).charAt(0) === "+" ? addDays(start, parseInt(p.target.slice(1), 10)) : p.target;
    return normalizeJourney({
      id: id || uid(), title: p.title, emoji: p.emoji,
      from: { name: p.from, ll: r.pts[0].slice() },
      to: { name: p.to, ll: r.pts[r.pts.length - 1].slice() },
      start: start, target: target, presetId: p.id,
      route: {
        pts: r.pts.map(a => a.slice()), km: r.km, min: r.min,
        zones: r.zones.map(z => ({ f: z.f, name: z.name })),
        landmarks: (r.landmarks || []).map(l => ({ name: l.name, ll: l.ll.slice(), km: l.km }))
      },
      createdAt: Date.now()
    });
  }

  /* ════════════════ 경로 계산 ════════════════ */
  function cumOf(j) {
    let c = CUMS.get(j.route);
    if (c && c.length === j.route.pts.length) return c;
    c = [0];
    for (let i = 1; i < j.route.pts.length; i++) {
      c.push(c[i - 1] + haversine(j.route.pts[i - 1], j.route.pts[i]) / 1000);
    }
    CUMS.set(j.route, c);
    return c;
  }
  function pointAt(j, km) {
    const pts = j.route.pts, cum = cumOf(j);
    if (!pts.length) return [37.55, 127.02];
    if (km <= 0) return pts[0];
    if (km >= cum[cum.length - 1]) return pts[pts.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= km) lo = mid; else hi = mid; }
    const t = (km - cum[lo]) / Math.max(cum[hi] - cum[lo], 1e-9);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
  }
  function partialPoints(j, km) {
    const pts = j.route.pts, cum = cumOf(j), out = [];
    for (let i = 0; i < pts.length; i++) { if (cum[i] <= km) out.push(pts[i]); else break; }
    const tip = pointAt(j, km);
    const last = out[out.length - 1];
    if (!last || last[0] !== tip[0] || last[1] !== tip[1]) out.push(tip);
    return out;
  }
  function zoneAt(j, f) {
    let z = j.route.zones[0];
    for (const c of j.route.zones) { if (c.f <= f + 1e-9) z = c; }
    return z;
  }

  /* ════════════════ 지도 ════════════════ */
  function initMap() {
    if (typeof L === "undefined") {
      $("map").innerHTML =
        '<div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center;font-size:13px;color:#8b8175;line-height:1.7">' +
        "지도를 불러오지 못했어요.<br>인터넷 연결을 확인하고 다시 열어 주세요.</div>";
      return false;
    }
    map = L.map("map", {
      zoomControl: false, attributionControl: true, scrollWheelZoom: true,
      preferCanvas: true, worldCopyJump: false
    }).setView([37.545, 127.02], 12);

    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    });
    const esri = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    });
    let errors = 0, switched = false;
    osm.on("tileerror", () => {
      errors++;
      if (!switched && errors > 4) { switched = true; map.removeLayer(osm); esri.addTo(map); }
    });
    osm.addTo(map);
    L.control.zoom({ position: "bottomleft" }).addTo(map);

    map.on("click", onMapClick);

    if (window.ResizeObserver) {
      const host = $("mapWrap");
      let lastH = host.clientHeight, lastW = host.clientWidth;
      new ResizeObserver(() => {
        if (!map) return;
        if (Math.abs(host.clientHeight - lastH) > 4 || Math.abs(host.clientWidth - lastW) > 4) {
          lastH = host.clientHeight; lastW = host.clientWidth;
          map.invalidateSize();
          if (current) fitRoute(current);
        }
      }).observe(host);
    }
    return true;
  }

  function clearRoute() {
    Object.values(layers).forEach(l => {
      try { if (Array.isArray(l)) l.forEach(x => map.removeLayer(x)); else map.removeLayer(l); } catch (e) { }
    });
    layers = {};
  }

  function drawRoute(j) {
    if (!map) return;
    clearRoute();
    const pts = j.route.pts;
    if (!pts || pts.length < 2) return;

    layers.casing = L.polyline(pts, { color: "#fffdf9", weight: 9, opacity: .75, lineCap: "round" }).addTo(map);
    layers.base = L.polyline(pts, { color: "#a89682", weight: 4, opacity: .95, dashArray: "1 9", lineCap: "round" }).addTo(map);
    layers.glow = L.polyline([], { color: "#e8873f", weight: 17, opacity: .18, lineCap: "round" }).addTo(map);
    layers.walked = L.polyline([], { color: "#d1502b", weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(map);

    const s = pts[0], e = pts[pts.length - 1];
    layers.startMk = L.marker(s, {
      icon: L.divIcon({ className: "", html: '<div class="endpoint"></div>', iconSize: [13, 13], iconAnchor: [6, 6] }),
      interactive: false, zIndexOffset: 400
    }).addTo(map);
    layers.endMk = L.marker(e, {
      icon: L.divIcon({ className: "", html: '<div class="endpoint dest"></div>', iconSize: [11, 11], iconAnchor: [5, 5] }),
      interactive: false, zIndexOffset: 400
    }).addTo(map);
    layers.labelStart = L.marker(s, {
      icon: L.divIcon({ className: "", html: '<div class="map-label">출발</div>', iconSize: [0, 0], iconAnchor: [0, 30] }),
      interactive: false
    }).addTo(map);
    layers.labelEnd = L.marker(e, {
      icon: L.divIcon({ className: "", html: '<div class="map-label end">도착</div>', iconSize: [0, 0], iconAnchor: [0, -28] }),
      interactive: false
    }).addTo(map);

    fitRoute(j);
    drawFittedLabels(j);

    layers.marker = L.marker(pointAt(j, 0), {
      icon: L.divIcon({
        className: "", iconSize: [46, 46], iconAnchor: [23, 23],
        html: '<div class="pin-wrap"><div class="pin-ring"></div><div class="pin-core">🚶</div></div>'
      }),
      interactive: false, zIndexOffset: 800
    }).addTo(map);
  }

  /* 칩(라벨)은 지도가 화면에 맞춰진 뒤에, 겹치지 않게 골라서 붙입니다 */
  function drawFittedLabels(j) {
    if (!map) return;
    if (layers.zones) { layers.zones.forEach(l => map.removeLayer(l)); }
    layers.zones = [];
    const placed = [];
    const items = [];

    (j.route.landmarks || []).forEach(l => {
      if (l.ll) items.push({ name: l.name, ll: l.ll, water: true });
    });
    j.route.zones.filter(z => z.f > 0.07 && z.f < 0.92).forEach(z => {
      items.push({ name: z.name, ll: pointAt(j, z.f * j.route.km), water: false });
    });

    const landLLs = (j.route.landmarks || []).filter(l => l.ll).map(l => l.ll);
    for (const it of items) {
      if (placed.length >= 4) break;
      if (!it.water && landLLs.some(ll => haversine(it.ll, ll) < 700)) continue;
      const pt = map.latLngToContainerPoint(L.latLng(it.ll[0], it.ll[1]));
      if (placed.some(q => q.distanceTo(pt) < 82)) continue;
      if (pt.x < 30 || pt.y < 40 || pt.x > map.getSize().x - 30 || pt.y > map.getSize().y - 30) {
        if (!it.water) continue;
      }
      placed.push(pt);
      layers.zones.push(L.marker(it.ll, {
        icon: L.divIcon({
          className: "",
          html: '<div class="map-label' + (it.water ? " water" : "") + '">' + esc(it.name) + "</div>",
          iconSize: [0, 0], iconAnchor: [0, -6]
        }),
        interactive: false
      }).addTo(map));
    }
  }

  function fitRoute(j) {
    if (!map || !j) return;
    const b = L.latLngBounds(j.route.pts);
    map.invalidateSize();
    map.fitBounds(b, { paddingTopLeft: [26, 78], paddingBottomRight: [26, 54], animate: false });
  }

  /* ════════════════ 진행 렌더 ════════════════ */
  function totalDays(j) { return Math.max(1, daysBetween(j.start, j.target)); }
  function liveDay(j) { return clamp(daysBetween(j.start, todayISO()), 0, totalDays(j)); }
  function shownDay(j) {
    return (current === j && viewDay != null) ? clamp(viewDay, 0, totalDays(j)) : liveDay(j);
  }

  function render() {
    const j = current;
    if (!j) return;
    const total = totalDays(j);
    const day = shownDay(j);
    const f = clamp(day / total, 0, 1);
    const walked = f * j.route.km;
    const left = Math.max(0, j.route.km - walked);
    const dday = total - day;
    const live = viewDay == null;
    const today = todayISO();
    const before = live && today < j.start;
    const after = live && today > j.target;

    /* 위치 */
    const p = pointAt(j, walked);
    if (layers.marker) layers.marker.setLatLng(p);
    if (layers.walked) layers.walked.setLatLngs(partialPoints(j, walked));
    if (layers.glow) layers.glow.setLatLngs(partialPoints(j, walked));

    /* D-day */
    const label = $("ddayLabel"), num = $("ddayFloat");
    let lbl = "목표까지", txt = dday === 0 ? "D-DAY" : "D-" + dday;
    if (before) { lbl = "시작까지"; txt = "D-" + daysBetween(today, j.start); }
    else if (after) { lbl = "도착한 지"; txt = "D+" + daysBetween(j.target, today); }
    else if (j === sharedJourney) { lbl = "공유 시점"; }
    else if (!live) { lbl = "미리보기"; }
    label.textContent = lbl;
    num.textContent = txt;
    num.className = "num" + (dday === 0 ? " zero" : "") + (txt.length > 7 ? " small" : "");
    $("statDday").textContent = after ? "완주" : (before ? "D-" + daysBetween(today, j.start) : (dday === 0 ? "D-DAY" : "D-" + dday));

    /* 지역 */
    const z = zoneAt(j, f);
    const near = (j.route.landmarks || []).find(m => Math.abs((m.km || 0) - walked) <= 0.4);
    let zoneLabel;
    if (near && f > 0.001 && f < 0.999) zoneLabel = near.name + " 건너는 중";
    else if (f <= 0.001) zoneLabel = z.name + "에서 출발";
    else if (f >= 0.999) zoneLabel = z.name + " 도착";
    else zoneLabel = z.name + " 부근";
    $("zoneText").textContent = zoneLabel;

    /* 날짜 · 모드 */
    $("dateText").textContent = dotDate(addDays(j.start, day));
    const pill = $("modePill");
    if (j === sharedJourney) { pill.textContent = "공유 시점"; pill.className = "mode-pill shared"; }
    else if (!live) { pill.textContent = "미리보기 ↺"; pill.className = "mode-pill"; }
    else { pill.textContent = before ? "시작 전" : (after ? "완주" : "오늘"); pill.className = "mode-pill"; }

    /* 바 · 수치 */
    $("barFill").style.width = (f * 100).toFixed(2) + "%";
    $("pctText").textContent = f <= 0 ? "0%" : (f * 100 < 1 ? (f * 100).toFixed(1) : Math.round(f * 100)) + "%";
    $("walkedText").textContent = kmText(walked);
    $("totalText").textContent = kmText(j.route.km);
    $("statWalked").textContent = kmText(walked);
    $("statLeft").textContent = kmText(left);
    $("statPace").textContent = kmText(j.route.km / total);

    /* 슬라이더 */
    const slider = $("slider");
    slider.max = total;
    slider.value = day;
    [0, .25, .5, .75].forEach((m, i) => {
      const d = Math.round(total * m);
      $("tick" + i).textContent = i === 0 ? "시작" : "D-" + (total - d);
    });

    /* 각주 */
    let foot = dotDate(j.start) + " → " + dotDate(j.target) + " · " + total.toLocaleString("ko-KR") + "일 · 하루 " + kmText(j.route.km / total) + "씩";
    if (j.approx) foot += "\n정확한 도보 경로를 찾지 못해 직선으로 표시했어요.";
    $("footnote").textContent = foot;
    $("footnote").style.whiteSpace = "pre-line";

    $("routeChip").innerHTML = "<b>" + kmText(j.route.km) + "</b> · 도보 " + durText(j.route.min);

    /* 이정표 */
    renderMilestoneStrip(j, day);

    document.title = (j === sharedJourney ? "공유받은 여정 · " : "") + j.title + " · " + APP_NAME;

    lastDay = day;
  }

  /* ════════════════ 이정표 ════════════════ */
  function milestoneDefs(j) {
    const total = totalDays(j);
    const out = [];
    const seenDays = new Set();
    const put = (key, day, emoji, title, msg) => {
      day = Math.round(day);
      if (day < 1 || day >= total) return;
      if (seenDays.has(day)) return;
      seenDays.add(day);
      out.push({ key, day, emoji, title, msg });
    };
    put("p25", total * 0.25, "🌱", "25% 지점", "넷 중 하나를 지나왔어요. 처음 품었던 마음이 아직 같은 자리에 있어요.");
    put("p50", total * 0.5, "💛", "50% 지점", "절반을 넘었어요. 돌아가는 길의 반은 이미 지나왔네요.");
    put("p75", total * 0.75, "🔥", "75% 지점", "이제 넷 중 셋. 목표가 손에 잡힐 만큼 가까워졌어요.");
    if (total > 100) put("d100", total - 100, "💌", "D-100", "100일 남았어요. 남은 날보다 걸어온 날이 훨씬 많아요.");
    if (total > 10) put("d10", total - 10, "🕯", "D-10", "열흘 남았어요. 이제 날짜를 세는 일만 남았어요.");
    if (total > 1) put("d1", total - 1, "🌙", "D-1", "내일이에요. 오늘은 조금 일찍 쉬어요.");
    out.push({ key: "arrive", day: total, emoji: "🎉", title: "D-DAY", msg: "도착했어요. 오늘 하루가 아니라, 그동안의 모든 날이 만든 자리예요." });
    out.sort((a, b) => a.day - b.day || (a.key === "arrive" ? 1 : -1));
    out.sort((a, b) => a.day - b.day);
    return out;
  }

  function renderMilestoneStrip(j, day) {
    const defs = milestoneDefs(j);
    const next = defs.find(m => m.day > day);
    const el = $("msStripText");
    if (!next) {
      const arrive = defs[defs.length - 1];
      el.textContent = "마지막 이정표 · " + arrive.title + " · " + dotDate(addDays(j.start, arrive.day));
      return;
    }
    el.textContent = "다음 이정표 · " + next.emoji + " " + next.title + " · " + dotDate(addDays(j.start, next.day)) + " (D-" + (totalDays(j) - next.day) + ")";
  }

  function showMilestone(m) {
    $("msEmoji").textContent = m.emoji;
    $("msTitle").textContent = m.title;
    $("msMsg").textContent = m.msg;
    const card = $("msCard");
    card.hidden = false;
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";
    clearTimeout(msTimer);
    msTimer = setTimeout(() => { card.hidden = true; }, 8500);
  }

  function maybeCelebrate(prev, day) {
    if (!current || prev == null || day <= prev) return;
    const hit = milestoneDefs(current).filter(m => m.day > prev && m.day <= day).sort((a, b) => b.day - a.day)[0];
    if (hit) showMilestone(hit);
  }

  function celebrateOnOpen() {
    if (!current || current === sharedJourney) return;
    if (viewDay != null) return;
    const today = todayISO();
    if (today < current.start || today > current.target) return;
    const day = liveDay(current);
    const hit = milestoneDefs(current).find(m => m.day === day);
    if (!hit) return;
    const key = current.id + ":open:" + today;
    if (store.seen[key]) return;
    store.seen[key] = 1;
    saveStore();
    setTimeout(() => showMilestone(hit), 1400);
  }

  /* ════════════════ 여정 활성화 ════════════════ */
  function activate(j, opts) {
    opts = opts || {};
    if (!j) return;
    stopPlay();
    current = j;
    viewDay = (opts.day !== undefined && opts.day !== null) ? opts.day : null;
    lastDay = null;
    if (j !== sharedJourney) store.activeId = j.id;

    renderChips();
    drawRoute(j);
    $("titleText").textContent = j.title;
    render();
    $("shareBanner").hidden = j !== sharedJourney;
    $("mapWrap").classList.toggle("with-banner", j === sharedJourney);
    if (j === sharedJourney) {
      $("shareBannerSub").textContent = dotDate(addDays(j.start, shownDay(j))) + " 기준 · 저장하면 내 목록에 남아요";
    }

    requestAnimationFrame(() => { if (map) { map.invalidateSize(); fitRoute(j); } });
    setTimeout(() => { if (map && current === j) fitRoute(j); }, 280);

    if (opts.celebrate !== false) celebrateOnOpen();
  }

  function renderChips() {
    const box = $("chips");
    const rows = store.journeys.map(j =>
      '<button type="button" class="chip' + (j === current ? " on" : "") + '" data-act="switch" data-id="' + j.id + '">' +
      '<span class="em">' + esc(j.emoji || "🚶") + '</span><span class="nm">' + esc(j.title) + "</span></button>"
    );
    if (sharedJourney && !store.journeys.some(j => j.id === sharedJourney.id)) {
      rows.push('<button type="button" class="chip shared' + (sharedJourney === current ? " on" : "") +
        '" data-act="switch-shared"><span class="sd"></span>공유받음</button>');
    }
    rows.push('<button type="button" class="chip add" data-act="new">＋ 새 여정</button>');
    box.innerHTML = rows.join("");
    requestAnimationFrame(() => {
      const on = box.querySelector(".chip.on");
      if (on && on.scrollIntoView) {
        const r = on.getBoundingClientRect(), br = box.getBoundingClientRect();
        if (r.left < br.left || r.right > br.right) on.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      }
    });
  }

  /* ════════════════ 슬라이더 · 컨트롤 ════════════════ */
  function setDay(d) {
    if (!current) return;
    const prev = lastDay;
    viewDay = clamp(Math.round(d), 0, totalDays(current));
    render();
    maybeCelebrate(prev, shownDay(current));
  }

  function startPlay() {
    if (!current) return;
    const total = totalDays(current);
    playing = true;
    const btn = $("playBtn");
    btn.textContent = "❚❚"; btn.classList.add("playing");
    viewDay = 0;
    render();
    const t0 = performance.now(), DUR = 17000;
    function step(now) {
      if (!playing) return;
      const t = Math.min(1, (now - t0) / DUR);
      const eased = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setDay(eased * total);
      if (t < 1) animId = requestAnimationFrame(step);
      else stopPlay();
    }
    animId = requestAnimationFrame(step);
  }
  function stopPlay() {
    playing = false;
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    const btn = $("playBtn");
    if (btn) { btn.textContent = "▶"; btn.classList.remove("playing"); }
  }

  /* ════════════════ 공유 링크 ════════════════ */
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    const bin = atob(t);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encodePolyline(pts, precision) {
    precision = precision || 5;
    const f = Math.pow(10, precision);
    let out = "", prevLat = 0, prevLng = 0;
    const enc = v => {
      v = v < 0 ? ~(v << 1) : (v << 1);
      let s = "";
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    };
    for (const p of pts) {
      const lat = Math.round(p[0] * f), lng = Math.round(p[1] * f);
      out += enc(lat - prevLat) + enc(lng - prevLng);
      prevLat = lat; prevLng = lng;
    }
    return out;
  }
  function decodePolyline(str, precision) {
    precision = precision || 5;
    const f = Math.pow(10, precision), out = [];
    let idx = 0, lat = 0, lng = 0;
    while (idx < str.length) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push([lat / f, lng / f]);
    }
    return out;
  }
  function simplify(pts, minM) {
    if (pts.length < 3) return pts.slice();
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (haversine(out[out.length - 1], pts[i]) >= minM) out.push(pts[i]);
    }
    const last = pts[pts.length - 1];
    if (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1]) out.push(last);
    return out;
  }

  function baseURL() {
    const here = location.href.split("#")[0].split("?")[0];
    return here;
  }
  function sharePayload(j) {
    const day = shownDay(j);
    const p = {
      v: 1, t: j.title, e: j.emoji || "",
      s: j.start, d: j.target,
      a: [j.from.name, +j.from.ll[0].toFixed(5), +j.from.ll[1].toFixed(5)],
      b: [j.to.name, +j.to.ll[0].toFixed(5), +j.to.ll[1].toFixed(5)],
      k: +j.route.km.toFixed(2), m: Math.round(j.route.min), p: day,
      z: j.route.zones.map(z => [+z.f.toFixed(3), z.name])
    };
    if (j.presetId && ROUTES[j.presetId]) {
      p.r = j.presetId;
    } else {
      p.w = encodePolyline(simplify(j.route.pts, 18), 5);
    }
    return p;
  }
  function shareURL(j) {
    return baseURL() + "?share=" + b64urlEncode(JSON.stringify(sharePayload(j)));
  }
  function shareText(j) {
    const day = shownDay(j), total = totalDays(j);
    const dday = total - day;
    return "[" + APP_NAME + "] '" + j.title + "'\n" +
      "지금 " + (dday === 0 ? "D-DAY" : "D-" + dday) + " · " + kmText(j.route.km) + " 중 " + kmText(j.route.km * (day / total)) + " 걸었어요.\n" +
      shareURL(j);
  }

  function parseShare(raw) {
    const p = JSON.parse(b64urlDecode(raw));
    if (!p || p.v !== 1 || !p.t || !p.s || !p.d || !p.a || !p.b) throw new Error("형식이 맞지 않아요");
    let pts, km, min, zones, landmarks = [];
    if (p.r && ROUTES[p.r]) {
      const r = ROUTES[p.r];
      pts = r.pts.map(a => a.slice());
      km = r.km; min = r.min;
      zones = r.zones.map(z => ({ f: z.f, name: z.name }));
      landmarks = (r.landmarks || []).map(l => ({ name: l.name, ll: l.ll.slice(), km: l.km }));
    } else if (p.w) {
      pts = decodePolyline(p.w, 5);
      km = p.k || pathLength(pts);
      min = p.m || (km / 4.5) * 60;
      zones = Array.isArray(p.z) && p.z.length ? p.z.map(z => ({ f: +z[0], name: String(z[1]) })) : [];
    } else {
      throw new Error("경로가 없어요");
    }
    if (!pts || pts.length < 2) throw new Error("경로가 비어 있어요");
    if (!zones.length) zones = [{ f: 0, name: p.a[0] }, { f: 1, name: p.b[0] }];
    const j = normalizeJourney({
      id: "s" + uid(), title: String(p.t).slice(0, 60), emoji: p.e || "👋",
      from: { name: String(p.a[0]), ll: [+p.a[1], +p.a[2]] },
      to: { name: String(p.b[0]), ll: [+p.b[1], +p.b[2]] },
      start: p.s, target: p.d, presetId: p.r || null,
      route: { pts: pts, km: km, min: min, zones: zones, landmarks: landmarks },
      createdAt: Date.now(), shared: true
    });
    if (!j) throw new Error("여정을 만들 수 없어요");
    j.sharedDay = typeof p.p === "number" ? p.p : 0;
    j.sharedAt = Date.now();
    return j;
  }

  /* ════════════════ 지오코딩 · 경로 찾기 ════════════════ */
  const NOMINATIM = "https://nominatim.openstreetmap.org";
  const TYPE_HINT = {
    railway: "기차역", station: "역", halt: "역", bus_stop: "정류장", bus_station: "버스터미널",
    subway_entrance: "출입구", university: "대학", hospital: "병원", school: "학교",
    apartment: "아파트", building: "건물", neighbourhood: "동네", suburb: "동", quarter: "동"
  };

  function hasHangul(s) { return /[\uAC00-\uD7A3]/.test(s); }

  async function geocodeCandidates(q) {
    const url = NOMINATIM + "/search?format=jsonv2&limit=6&addressdetails=1&accept-language=ko" +
      (hasHangul(q) ? "&countrycodes=kr" : "") + "&q=" + encodeURIComponent(q);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    let res;
    try {
      res = await fetch(url, { headers: { "Accept": "application/json" }, signal: ctl.signal });
    } finally { clearTimeout(t); }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    const out = [];
    for (const r of (Array.isArray(arr) ? arr : [])) {
      if (!r || r.type === "country" || !r.lat || !r.lon) continue;
      const ll = [+r.lat, +r.lon];
      if (out.some(o => haversine(o.ll, ll) < 110)) continue;
      const a = r.address || {};
      out.push({
        name: labelOf(r, q),
        full: r.display_name || q,
        ll: ll,
        hint: a.road || a.pedestrian || a.footway || TYPE_HINT[r.type] || "",
        dong: a.suburb || a.quarter || a.neighbourhood || ""
      });
      if (out.length >= 5) break;
    }
    /* 이름이 겹치면 도로명 같은 힌트를 붙여 구분 */
    const counts = {};
    out.forEach(o => { counts[o.name] = (counts[o.name] || 0) + 1; });
    out.forEach(o => {
      if (counts[o.name] > 1 && o.hint && !o.name.includes(o.hint)) o.name += " · " + o.hint;
    });
    const counts2 = {};
    out.forEach(o => { counts2[o.name] = (counts2[o.name] || 0) + 1; });
    out.forEach(o => {
      if (counts2[o.name] > 1 && o.dong && !o.name.includes(o.dong)) o.name += " " + o.dong;
      delete o.hint; delete o.dong;
    });
    return out;
  }

  async function reverseName(ll) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 9000);
      const res = await fetch(NOMINATIM + "/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=ko&lat=" + ll[0] + "&lon=" + ll[1],
        { headers: { "Accept": "application/json" }, signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const d = await res.json();
      if (!d) return null;
      return labelOf(d, null);
    } catch (e) { return null; }
  }

  /* Nominatim 결과 → 사람이 읽기 좋은 한국 주소 라벨
     예) 서울특별시 성북구 종암동 종암로25길 / 제주특별자치도 제주시 제주국제공항 */
  function labelOf(r, fallback) {
    if (!r) return fallback || "";
    const a = r.address || {};
    const city = a.city || a.province || a.state || a.region || "";
    const prov = a.province && a.city && a.province !== a.city ? a.province : "";
    const district = a.borough || a.city_district || a.county || a.district || "";
    const dong = a.suburb || a.quarter || a.neighbourhood || a.town || a.village || "";
    const road = a.road || a.pedestrian || a.footway || a.residential || "";
    const num = a.house_number || "";
    const nm = (r.name && !/^\d+$/.test(r.name)) ? r.name : (a.amenity || a.aeroway || a.building || a.tourism || "");

    const isRoadName = nm && road && (nm === road);
    const placeName = nm && !isRoadName ? nm : "";

    const head = [prov, city, district].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" ");
    let out;
    if (placeName) {
      out = (head + " " + placeName).trim();
    } else if (road) {
      out = (head + " " + dong + " " + road + (num ? " " + num : "")).replace(/\s+/g, " ").trim();
    } else if (dong) {
      out = (head + " " + dong).trim();
    } else {
      out = "";
    }
    if (!out) out = shortPlace(r.display_name, fallback);
    if (out.length > 46) out = out.slice(0, 46).trim();
    return out;
  }

  function shortPlace(display, fallback) {
    if (!display) return fallback || "";
    let parts = String(display).split(",").map(s => s.trim()).filter(Boolean);
    parts = parts.filter(p => !/^(대한민국|한국|South Korea|North Korea|Korea)$/i.test(p));
    parts = parts.filter(p => !/^\d{4,6}$/.test(p));
    const rev = parts.slice().reverse();
    const head = rev.slice(0, Math.min(4, rev.length)).join(" ");
    const first = parts[0];
    let out = head;
    if (first && !head.includes(first) && !/^\d+$/.test(first) && (head.length + first.length) < 46) {
      out = head + " " + first;
    }
    return out || (parts[0] || fallback || "");
  }

  async function fetchWalkRoute(a, b) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 22000);
    let res;
    try {
      res = await fetch("https://valhalla1.openstreetmap.de/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({
          locations: [{ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }],
          costing: "pedestrian",
          directions_options: { units: "kilometers" }
        })
      });
    } finally { clearTimeout(t); }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const trip = data && data.trip;
    if (!trip || !trip.legs || !trip.legs[0] || !trip.legs[0].shape) throw new Error("경로 없음");
    const pts = simplify(decodePolyline(trip.legs[0].shape, 6), 14);
    if (pts.length < 2) throw new Error("경로 없음");
    return { pts: pts, km: trip.summary.length, min: trip.summary.time / 60 };
  }

  /* "서울특별시 용산구 서울역" → "서울역" 처럼 행정 접두어를 덜어 냄 */
  function zoneName(label) {
    /* "서울역 · 한강대로" 처럼 중복 구분용으로 붙인 꼬리는 지도 라벨에서 덜어 냄 */
    const cut = String(label || "").split(" · ")[0].trim();
    const parts = cut.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return cut || "";
    const admin = /(특별시|광역시|특별자치시|특별자치도|시|도|구|군|동|읍|면|리)$/;
    const rest = parts.filter(p => !admin.test(p));
    const out = rest.join(" ");
    return out.length >= 2 ? out : (cut || "");
  }

  async function buildRoute(from, to) {
    const a = from.ll, b = to.ll;
    const direct = haversine(a, b) / 1000;
    if (direct > 120) {
      const e = new Error("두 곳이 " + Math.round(direct) + "km 떨어져 있어요. 이 앱은 도보 120km 이내 여정을 그려요.");
      e.friendly = true;
      throw e;
    }
    const zones = [{ f: 0, name: zoneName(from.name) }, { f: 1, name: zoneName(to.name) }];
    try {
      const r = await fetchWalkRoute(a, b);
      return { route: { pts: r.pts, km: Math.round(r.km * 100) / 100, min: Math.round(r.min), zones: zones, landmarks: [] }, approx: false };
    } catch (e) {
      const km = Math.max(0.05, Math.round(direct * 1.22 * 100) / 100);
      return { route: { pts: [a.slice(), b.slice()], km: km, min: Math.round((km / 4.5) * 60), zones: zones, landmarks: [] }, approx: true };
    }
  }

  /* ════════════════ 시트 ════════════════ */
  function openSheet(mode) {
    sheetMode = mode;
    $("scrim").classList.add("on");
    const sheet = $("sheet");
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add("on"));
    $("sheetBody").scrollTop = 0;
  }
  function closeSheet() {
    if (sheetMode === "welcome") { store.onboarded = true; saveStore(); }
    $("scrim").classList.remove("on");
    $("sheet").classList.remove("on");
    sheetMode = null;
    pendingConfirm = null;
    pickBarCleanup();
    setTimeout(() => { if (!sheetMode) $("sheet").hidden = true; }, 340);
  }
  function setSheet(title, sub, bodyHTML, footHTML, footShown) {
    $("sheetTitle").textContent = title;
    $("sheetSub").textContent = sub || "";
    $("sheetBody").innerHTML = bodyHTML;
    const foot = $("sheetFoot");
    if (footHTML) { foot.innerHTML = footHTML; foot.hidden = false; }
    else { foot.innerHTML = ""; foot.hidden = true; }
    if (footShown === false) foot.hidden = true;
  }

  /* ── 여정 목록 ── */
  function openList() {
    stopPlay();
    const rows = [];
    if (sharedJourney && !store.journeys.some(j => j.id === sharedJourney.id)) {
      const s = sharedJourney;
      rows.push(rowHTML(s, s === current, true));
    }
    store.journeys.forEach(j => rows.push(rowHTML(j, j === current, false)));

    const install = deferredPrompt
      ? '<div class="install-nudge"><span>홈 화면에 추가하면 앱처럼 열려요.</span><button data-act="install">추가</button></div>'
      : (isIOS() && !isStandalone()
        ? '<div class="install-nudge"><span>Safari 공유 버튼 → ‘홈 화면에 추가’를 누르면 앱처럼 열려요.</span></div>'
        : "");

    const body = '<div class="jlist">' + rows.join("") + "</div>" +
      '<p class="hint" style="margin-top:8px">여정을 누르면 그 지도로 바뀝니다. 여러 개의 디데이를 함께 걸어 보세요.</p>' +
      install +
      '<p class="hint" style="margin-top:10px;color:#b7ab99">데이터는 이 기기 브라우저에만 저장됩니다. 링크를 공유하면 상대도 내 여정을 볼 수 있어요.</p>';

    setSheet("내 여정", store.journeys.length + "개의 여정을 걷는 중", body,
      '<button class="btn slim" data-act="edit">편집</button>' +
      '<button class="btn primary" data-act="new">＋ 새 여정 만들기</button>');
    openSheet("list");
  }

  function rowHTML(j, on, isShared) {
    const total = totalDays(j);
    const day = (j === sharedJourney && j !== current && typeof j.sharedDay === "number")
      ? clamp(j.sharedDay, 0, total)
      : shownDay(j);
    const dday = total - day;
    const pct = Math.round((day / total) * 100);
    return '<div class="jrow' + (on ? " on" : "") + '" data-act="switch" data-id="' + j.id + '" role="button" tabindex="0">' +
      '<span class="jemoji">' + esc(j.emoji || "🚶") + "</span>" +
      '<span class="jmeta"><b>' + esc(j.title) + (isShared ? " · 공유받음" : "") + "</b>" +
      "<span>" + esc(j.from.name) + " → " + esc(j.to.name) + "</span>" +
      "<span>" + dotDate(j.start) + " → " + dotDate(j.target) + " · " + total.toLocaleString("ko-KR") + "일</span></span>" +
      '<span class="jright"><b>' + (dday === 0 ? "D-DAY" : "D-" + dday) + "</b><span>" + pct + "%</span></span>" +
      (isShared ? "" : '<button class="jdel" data-act="del" data-id="' + j.id + '" aria-label="' + esc(j.title) + ' 삭제">✕</button>') +
      "</div>";
  }

  /* ── 새 여정 / 편집 폼 ── */
  function blankForm() {
    const t = todayISO();
    return {
      id: null, emoji: "🚶", title: "", start: t, target: addDays(t, 100),
      from: { name: "", ll: null }, to: { name: "", ll: null },
      presetId: null, route: null
    };
  }
  function formFromJourney(j) {
    return {
      id: j.id, emoji: j.emoji || "🚶", title: j.title,
      start: j.start, target: j.target,
      from: { name: j.from.name, ll: j.from.ll.slice() },
      to: { name: j.to.name, ll: j.to.ll.slice() },
      presetId: j.presetId || null, route: j.route
    };
  }

  function openForm(j) {
    stopPlay();
    form = j ? formFromJourney(j) : blankForm();
    searchResults = { from: [], to: [] };
    renderForm();
    openSheet("form");
  }

  function renderForm() {
    const f = form;
    const isEdit = !!f.id;
    const emojis = EMOJIS.map(e =>
      '<button type="button" class="emo-btn' + (f.emoji === e ? " on" : "") + '" data-act="emoji" data-e="' + e + '">' + e + "</button>"
    ).join("");

    const presets = PRESETS.map(p =>
      '<button type="button" class="preset' + (f.presetId === p.id ? " sel" : "") + '" data-act="preset" data-id="' + p.id + '">' +
      "<b>" + esc(p.emoji + " " + p.title) + "</b><span>" + esc(p.sub) + "</span></button>"
    ).join("");

    const body =
      '<div class="field"><label for="inTitle">여정 제목</label>' +
      '<input type="text" id="inTitle" maxlength="40" placeholder="예) 우리의 서초동 귀환" value="' + esc(f.title) + '"></div>' +

      '<div class="field"><label>이모지</label><div class="emoji-row">' + emojis + "</div></div>" +

      '<div class="field"><label>준비된 여정 <span style="font-weight:400;color:var(--muted)">— 누르면 경로와 날짜가 채워져요</span></label>' +
      '<div class="presets">' + presets + "</div></div>" +

      '<div class="field"><label>기간</label><div class="two">' +
      '<input type="date" id="inStart" aria-label="시작일" value="' + esc(f.start) + '">' +
      '<input type="date" id="inTarget" aria-label="목표일" value="' + esc(f.target) + '"></div>' +
      '<p class="hint" id="dateHint"></p></div>' +

      placeHTML("from", "출발지", f.from, "예) 서울 성북구 종암로25길 30") +
      placeHTML("to", "도착지", f.to, "예) 서울 서초구 서초3동 1519-9") +

      '<p class="hint" id="routeHint">주소를 고르면 걸어갈 길을 새로 찾아요. (도보 120km 이내)</p>' +
      '<p class="hint" style="color:#b7ab99">경로: OpenStreetMap 보행자 네트워크 · 주소: Nominatim</p>';

    setSheet(isEdit ? "여정 고치기" : "새 여정 만들기",
      "제목과 기간, 출발지·도착지만 있으면 돼요.",
      body,
      '<button class="btn" data-act="cancel">취소</button>' +
      '<button class="btn primary" data-act="save" id="saveBtn">' + (isEdit ? "저장하기" : "이 여정으로 걷기") + "</button>");

    renderPlaceState("from");
    renderPlaceState("to");
    updateDateHint();
  }

  function placeHTML(which, label, val, ph) {
    return '<div class="place">' +
      "<label>" + label + "</label>" +
      '<input type="text" id="in' + (which === "from" ? "From" : "To") + '" placeholder="' + ph + '" value="' + esc(val.name) + '" autocomplete="off">' +
      '<div class="place-actions">' +
      '<button type="button" class="mini" data-act="search" data-which="' + which + '">🔍 주소 검색</button>' +
      '<button type="button" class="mini" data-act="pick" data-which="' + which + '">🗺 지도에서</button>' +
      '<button type="button" class="mini" data-act="geo" data-which="' + which + '">📍 내 위치</button>' +
      "</div>" +
      '<div class="results" id="res-' + which + '"></div>' +
      '<div class="chosen" id="chosen-' + which + '"></div>' +
      "</div>";
  }

  function renderPlaceState(which) {
    const el = $("chosen-" + which);
    if (!el) return;
    const p = form[which];
    if (p.ll) {
      el.innerHTML = '<span class="ok">✓ 위치 확인됨</span><span>' + p.ll[0].toFixed(4) + ", " + p.ll[1].toFixed(4) + "</span>";
    } else {
      el.innerHTML = '<span style="color:var(--muted)">주소를 검색해 고르거나, 지도에서 직접 찍어 주세요.</span>';
    }
  }

  function updateDateHint() {
    const h = $("dateHint");
    if (!h || !form) return;
    const n = daysBetween(form.start, form.target);
    if (!form.start || !form.target) { h.className = "hint"; h.textContent = "시작일과 목표일을 정해 주세요."; return; }
    if (n < 1) { h.className = "hint err"; h.textContent = "목표일은 시작일보다 뒤여야 해요."; return; }
    h.className = "hint";
    h.textContent = n.toLocaleString("ko-KR") + "일 동안 한 걸음씩 걷는 여정이에요. (D-" + n + ")";
  }

  /* ── 주소 검색 ── */
  async function doSearch(which) {
    const q = (form[which].name || "").trim();
    const box = $("res-" + which);
    if (!box) return;
    if (!q) { toast("먼저 주소나 장소 이름을 적어 주세요"); return; }
    box.innerHTML = '<div class="res loading">주소를 찾고 있어요…</div>';
    try {
      const list = await geocodeCandidates(q);
      searchResults[which] = list;
      if (!list.length) {
        box.innerHTML = '<div class="res loading">찾지 못했어요. 지번·도로명을 조금 더 자세히 적거나 <b>지도에서</b> 찍어 주세요.</div>';
        return;
      }
      box.innerHTML = list.map((r, i) =>
        '<button type="button" class="res" data-act="res" data-which="' + which + '" data-i="' + i + '">' +
        "<b>" + esc(r.name) + "</b><span>" + esc(r.full) + "</span></button>"
      ).join("");
    } catch (e) {
      box.innerHTML = '<div class="res loading">주소 검색이 잠시 막혔어요. <b>지도에서</b> 직접 찍어 주세요.</div>';
    }
  }

  function chooseResult(which, i) {
    const r = searchResults[which][i];
    if (!r) return;
    form[which] = { name: r.name, ll: r.ll.slice() };
    const input = $("in" + (which === "from" ? "From" : "To"));
    if (input) input.value = r.name;
    const box = $("res-" + which);
    if (box) box.innerHTML = "";
    renderPlaceState(which);
    form.presetId = null;
    markPresetDeselect();
    toast("위치를 확인했어요 · " + r.name);
  }

  function markPresetDeselect() {
    document.querySelectorAll(".preset.sel").forEach(el => el.classList.remove("sel"));
  }

  /* ── 내 위치 ── */
  function useMyLocation(which) {
    if (!navigator.geolocation) { toast("이 브라우저에서는 위치를 쓸 수 없어요"); return; }
    toast("현재 위치를 확인하는 중…");
    navigator.geolocation.getCurrentPosition(async pos => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      const nm = await reverseName(ll);
      form[which] = { name: nm || ("현재 위치 (" + ll[0].toFixed(4) + ", " + ll[1].toFixed(4) + ")"), ll: ll };
      const input = $("in" + (which === "from" ? "From" : "To"));
      if (input) input.value = form[which].name;
      renderPlaceState(which);
      form.presetId = null;
      markPresetDeselect();
      toast("현재 위치를 출발지로 잡았어요");
    }, err => {
      toast("위치를 가져오지 못했어요. 지도에서 직접 찍어 주세요.", true);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* ── 지도에서 찍기 ── */
  function startPick(which) {
    saveFormInputs();
    closeSheet();
    picking = which;
    pickLL = null;
    $("mapWrap").classList.add("picking");
    const bar = $("pickBar");
    bar.hidden = false;
    $("pickText").textContent = "지도를 눌러 " + (which === "from" ? "출발지" : "도착지") + "를 정하세요";
    $("pickOk").disabled = true;
    $("pickRetry").hidden = true;
    if (pickMarker && map) { map.removeLayer(pickMarker); pickMarker = null; }
  }

  function onMapClick(e) {
    if (!picking) return;
    pickLL = [e.latlng.lat, e.latlng.lng];
    if (pickMarker && map) map.removeLayer(pickMarker);
    pickMarker = L.marker(pickLL, {
      icon: L.divIcon({ className: "", html: '<div class="pick-pin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] }),
      interactive: false, zIndexOffset: 900
    }).addTo(map);
    $("pickOk").disabled = false;
    $("pickRetry").hidden = false;
    $("pickText").textContent = "여기를 " + (picking === "from" ? "출발지" : "도착지") + "로 할까요?";
  }

  async function confirmPick() {
    if (!pickLL || !picking) return;
    const which = picking;
    $("pickText").textContent = "이 자리의 주소를 확인하고 있어요…";
    $("pickOk").disabled = true;
    const nm = await reverseName(pickLL);
    form[which] = {
      name: nm || ("지도에서 고른 곳 " + pickLL[0].toFixed(4) + ", " + pickLL[1].toFixed(4)),
      ll: pickLL.slice()
    };
    form.presetId = null;
    endPick();
    renderForm();
    openSheet("form");
    toast("위치를 찍었어요 · " + form[which].name);
  }

  function endPick() {
    picking = null;
    pickLL = null;
    $("mapWrap").classList.remove("picking");
    $("pickBar").hidden = true;
    if (pickMarker && map) { map.removeLayer(pickMarker); pickMarker = null; }
  }
  function pickBarCleanup() {
    if (picking) endPick();
  }

  function saveFormInputs() {
    if (!form) return;
    const t = $("inTitle"); if (t) form.title = t.value;
    const s = $("inStart"); if (s) form.start = s.value || form.start;
    const d = $("inTarget"); if (d) form.target = d.value || form.target;
    const ff = $("inFrom"); if (ff) form.from.name = ff.value;
    const ft = $("inTo"); if (ft) form.to.name = ft.value;
  }

  /* ── 저장 ── */
  function sameSpot(a, b) { return a && b && haversine(a, b) < 40; }

  async function onApply() {
    saveFormInputs();
    const btn = $("saveBtn");
    const hint = $("routeHint");

    form.title = (form.title || "").trim();
    if (!form.title) form.title = "나의 여정";
    if (!form.start || !form.target || daysBetween(form.start, form.target) < 1) {
      $("dateHint").className = "hint err";
      $("dateHint").textContent = "목표일은 시작일보다 최소 하루 뒤여야 해요.";
      return;
    }
    if (!form.from.name.trim() || !form.to.name.trim()) {
      hint.className = "hint err";
      hint.textContent = "출발지와 도착지를 모두 정해 주세요.";
      return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "길을 준비하는 중…";
    hint.className = "hint";
    hint.textContent = "걸어갈 길을 그리고 있어요…";

    try {
      /* 1) 주소만 있고 좌표가 없으면 지오코딩 */
      for (const which of ["from", "to"]) {
        if (!form[which].ll) {
          hint.textContent = (which === "from" ? "출발지" : "도착지") + " 주소를 확인하고 있어요…";
          const list = await geocodeCandidates(form[which].name.trim());
          if (!list.length) throw new Error("'" + form[which].name + "' 위치를 찾지 못했어요. 주소 검색 결과에서 골라 주세요.");
          form[which] = { name: list[0].name, ll: list[0].ll };
        }
      }

      /* 2) 경로 준비 */
      let route = null, approx = false;
      const preset = form.presetId ? PRESETS.find(p => p.id === form.presetId) : null;
      if (preset && ROUTES[preset.route] && sameSpot(form.from.ll, ROUTES[preset.route].pts[0]) && sameSpot(form.to.ll, ROUTES[preset.route].pts[ROUTES[preset.route].pts.length - 1])) {
        const pj = presetJourney(preset);
        route = pj.route;
      } else if (form.route && form.route.pts && form.route.pts.length > 1 &&
        sameSpot(form.from.ll, form.route.pts[0]) && sameSpot(form.to.ll, form.route.pts[form.route.pts.length - 1])) {
        route = form.route;
      } else {
        hint.textContent = "걸어갈 길을 찾고 있어요…";
        const r = await buildRoute({ name: form.from.name, ll: form.from.ll }, { name: form.to.name, ll: form.to.ll });
        route = r.route; approx = r.approx;
      }

      /* 3) 저장 */
      let j = form.id ? store.journeys.find(x => x.id === form.id) : null;
      const data = {
        title: form.title.slice(0, 60), emoji: form.emoji || "🚶",
        from: { name: form.from.name, ll: form.from.ll.slice() },
        to: { name: form.to.name, ll: form.to.ll.slice() },
        start: form.start, target: form.target,
        presetId: preset ? preset.id : null,
        route: route, approx: !!approx
      };
      if (j) {
        Object.assign(j, data);
      } else {
        j = normalizeJourney(Object.assign({ id: uid(), createdAt: Date.now() }, data));
        store.journeys.push(j);
      }
      store.activeId = j.id;
      saveStore();
      if (current === sharedJourney) { sharedJourney = null; }
      closeSheet();
      activate(j);
      toast(approx
        ? "여정을 저장했어요. 다만 정확한 도보 경로를 못 찾아 직선으로 표시했어요."
        : (form.id ? "여정을 고쳤어요" : "새 여정을 그렸어요 · " + kmText(route.km)));
    } catch (e) {
      hint.className = "hint err";
      hint.textContent = (e && e.message ? e.message : "여정을 만들지 못했어요.") +
        (e && e.friendly ? "" : " 주소를 조금 더 자세히 적거나 지도에서 직접 찍어 주세요.");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /* ════════════════ 공유 시트 ════════════════ */
  function openShare() {
    if (!current) return;
    stopPlay();
    const j = current;
    const total = totalDays(j), day = shownDay(j);
    const dday = total - day;
    let url = "";
    let tooLong = false;
    try {
      url = shareURL(j);
      tooLong = url.length > 7500;
    } catch (e) { tooLong = true; }

    const msg = shareText(j);
    const body =
      '<div class="share-preview">' +
      '<div class="sp-top"><span class="sp-emoji">' + esc(j.emoji || "🚶") + '</span><span class="sp-title">' + esc(j.title) + "</span></div>" +
      '<p class="sp-route">' + esc(j.from.name) + '<span class="ar">→</span>' + esc(j.to.name) + "</p>" +
      '<div class="sp-stats">' +
      '<div class="sp-stat"><b>' + (dday === 0 ? "D-DAY" : "D-" + dday) + "</b><span>남은 날</span></div>" +
      '<div class="sp-stat"><b>' + Math.round((day / total) * 100) + "%</b><span>진행</span></div>" +
      '<div class="sp-stat"><b>' + kmText(j.route.km) + "</b><span>전체 길</span></div>" +
      "</div></div>" +

      '<p class="hint" style="margin-bottom:6px">이 링크를 받은 사람은 <b>지금 내가 걸어온 자리와 디데이</b>를 지도에서 그대로 보게 됩니다.</p>' +
      '<div class="share-msg">' + esc(msg.split("\n").slice(0, 2).join("\n")) + "</div>" +
      (url ? '<div class="share-url">' + esc(url) + "</div>" : '<p class="hint err">공유 링크를 만들지 못했어요.</p>') +
      (tooLong ? '<p class="hint err">경로가 길어 링크가 아주 깁니다. 일부 메신저에서는 잘릴 수 있어요.</p>' : "") +
      (location.protocol === "file:" ? '<p class="hint err">지금은 파일로 열려 있어 링크가 그대로 동작하지 않습니다. 배포한 주소에서 공유해 주세요.</p>' : "") +
      '<p class="share-note">링크에는 여정 정보만 담깁니다. 계정도, 위치 기록도 서버로 보내지 않아요.</p>';

    setSheet("여정 공유하기", "링크 하나로 상대의 지도에 내 여정이 열려요",
      body,
      '<button class="btn slim" data-act="copy-msg">문구 복사</button>' +
      '<button class="btn" data-act="copy">링크 복사</button>' +
      '<button class="btn primary" data-act="native">공유하기</button>');
    openSheet("share");
  }

  async function doNativeShare() {
    const j = current;
    if (!j) return;
    let url = "";
    try { url = shareURL(j); } catch (e) { }
    const text = shareText(j);
    if (navigator.share) {
      try {
        await navigator.share({ title: APP_NAME + " · " + j.title, text: text, url: url });
        toast("공유 창을 열었어요");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    const ok = await copyText(url || text);
    toast(ok ? "링크를 복사했어요. 붙여넣어 보내 주세요." : "복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.", !ok);
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ════════════════ 이정표 시트 ════════════════ */
  function openMilestones() {
    if (!current) return;
    const j = current, total = totalDays(j), day = shownDay(j);
    const defs = milestoneDefs(j);
    const rows = defs.map(m => {
      const done = day >= m.day;
      return '<div class="jrow mstone' + (done ? " on" : "") + '">' +
        '<span class="jemoji">' + m.emoji + "</span>" +
        '<span class="jmeta"><b>' + m.title + " · " + dotDate(addDays(j.start, m.day)) + "</b>" +
        "<span>" + esc(m.msg) + "</span></span>" +
        '<span class="jright"><b style="color:' + (done ? "var(--accent)" : "var(--muted)") + '">' + (done ? "지남" : "D-" + (total - m.day)) + "</b></span>" +
        "</div>";
    }).join("");
    setSheet("이정표", "'" + j.title + "'의 응원 지점이에요",
      '<div class="jlist">' + rows + "</div>" +
      '<p class="hint" style="margin-top:8px">이정표에 닿으면 화면에 따뜻한 한마디가 떠요.</p>',
      '<button class="btn primary" data-act="cancel">닫기</button>');
    openSheet("milestones");
  }

  /* ════════════════ 첫 방문 안내 ════════════════ */
  function openWelcome() {
    const body =
      '<div class="welcome-hero"><div class="big">🚶‍♀️🗺️</div>' +
      "<h3>목표일까지, 지도 위의 한 걸음</h3>" +
      "<p>시작일과 목표일, 두 곳을 정하면 그 사이를 하루씩 걸어요. 지금 어디쯤인지 지도가 보여 줍니다.</p></div>" +
      '<div class="wcards">' +
      '<div class="wcard"><span class="we">🗂</span><span><b>여러 여정</b> — 은퇴, 여행, 시험, 건강 목표를 각각 만들어 오가며 봐요.</span></div>' +
      '<div class="wcard"><span class="we">🔗</span><span><b>링크 공유</b> — 가족에게 보내면 내가 걸어온 자리와 디데이가 그대로 열려요.</span></div>' +
      '<div class="wcard"><span class="we">💛</span><span><b>이정표 응원</b> — 25%·50%·75%, D-100·D-10에 한마디가 떠요.</span></div>' +
      "</div>" +
      '<p class="hint" style="text-align:center;margin-top:10px">지금 열려 있는 건 예시 여정이에요. <b>＋ 새 여정</b>으로 나만의 디데이를 만들어 보세요.</p>';

    setSheet("환영해요", "걸어서 그날까지 — D-DAY 지도",
      body,
      '<button class="btn" data-act="welcome-demo">예시 구경</button>' +
      '<button class="btn primary" data-act="welcome-create">내 여정 만들기</button>');
    openSheet("welcome");
  }

  /* ════════════════ 확인 대화상자 ════════════════ */
  function openConfirm(title, desc, okLabel, onOk) {
    pendingConfirm = onOk;
    setSheet(title, "", '<div class="cf-box">' + desc + "</div>",
      '<button class="btn" data-act="confirm-cancel">취소</button>' +
      '<button class="btn primary" data-act="confirm-ok">' + okLabel + "</button>");
    openSheet("confirm");
  }
  let pendingConfirm = null;

  function deleteJourney(id) {
    const j = store.journeys.find(x => x.id === id);
    if (!j) return;
    openConfirm("여정을 지울까요?", "<b>" + esc(j.title) + "</b>를 목록에서 지웁니다.<br>지도와 날짜는 이 기기에서 사라져요.",
      "지우기", () => {
        store.journeys = store.journeys.filter(x => x.id !== id);
        if (store.activeId === id) store.activeId = store.journeys[0] ? store.journeys[0].id : null;
        saveStore();
        if (!store.journeys.length) {
          const d = presetJourney(PRESETS[0]);
          store.journeys.push(d);
          store.activeId = d.id;
          saveStore();
        }
        const next = store.journeys.find(x => x.id === store.activeId) || store.journeys[0];
        closeSheet();
        activate(next);
        toast("여정을 지웠어요");
      });
  }

  /* ════════════════ 시트 이벤트 ════════════════ */
  /* ════════════════ 여정 전환 ════════════════ */
  function goTo(id) {
    if (sharedJourney && id === sharedJourney.id) { activate(sharedJourney, { day: sharedJourney.sharedDay }); closeSheet(); return; }
    const j = store.journeys.find(x => x.id === id);
    if (j) {
      activate(j);
      closeSheet();
    }
  }

  function onSheetClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;

    if (act === "switch") { goTo(el.dataset.id); return; }
    if (act === "switch-shared") { if (sharedJourney) { activate(sharedJourney, { day: sharedJourney.sharedDay }); closeSheet(); } return; }
    if (act === "new") { openForm(null); return; }
    if (act === "edit") {
      const j = current === sharedJourney ? null : current;
      if (!j) { toast("공유받은 여정은 저장한 뒤 고칠 수 있어요"); return; }
      openForm(j);
      return;
    }
    if (act === "del") { e.stopPropagation(); deleteJourney(el.dataset.id); return; }
    if (act === "cancel") { closeSheet(); return; }
    if (act === "save") { onApply(); return; }
    if (act === "emoji") {
      form.emoji = el.dataset.e;
      document.querySelectorAll(".emo-btn").forEach(b => b.classList.toggle("on", b.dataset.e === form.emoji));
      return;
    }
    if (act === "preset") {
      const p = PRESETS.find(x => x.id === el.dataset.id);
      if (!p) return;
      const j = presetJourney(p);
      if (!j) { toast("이 여정의 경로를 불러오지 못했어요"); return; }
      form.emoji = p.emoji; form.title = p.title;
      form.start = j.start; form.target = j.target;
      form.from = { name: j.from.name, ll: j.from.ll.slice() };
      form.to = { name: j.to.name, ll: j.to.ll.slice() };
      form.presetId = p.id; form.route = j.route;
      renderForm();
      toast("경로와 날짜를 채웠어요 · " + kmText(j.route.km));
      return;
    }
    if (act === "search") { saveFormInputs(); doSearch(el.dataset.which); return; }
    if (act === "res") { chooseResult(el.dataset.which, parseInt(el.dataset.i, 10)); return; }
    if (act === "pick") { startPick(el.dataset.which); return; }
    if (act === "geo") { saveFormInputs(); useMyLocation(el.dataset.which); return; }
    if (act === "copy") { copyText(shareURL(current)).then(ok => toast(ok ? "링크를 복사했어요" : "복사하지 못했어요", !ok)); return; }
    if (act === "copy-msg") { copyText(shareText(current)).then(ok => toast(ok ? "공유 문구를 복사했어요" : "복사하지 못했어요", !ok)); return; }
    if (act === "native") { doNativeShare(); return; }
    if (act === "install") { promptInstall(); return; }
    if (act === "welcome-create") { store.onboarded = true; saveStore(); openForm(null); return; }
    if (act === "welcome-demo") { store.onboarded = true; saveStore(); closeSheet(); return; }
    if (act === "confirm-cancel") { pendingConfirm = null; closeSheet(); return; }
    if (act === "confirm-ok") {
      const fn = pendingConfirm; pendingConfirm = null;
      if (fn) fn();
      return;
    }
  }

  function onSheetInput(e) {
    if (!form) return;
    const t = e.target;
    if (t.id === "inTitle") form.title = t.value;
    else if (t.id === "inStart") { form.start = t.value; updateDateHint(); }
    else if (t.id === "inTarget") { form.target = t.value; updateDateHint(); }
    else if (t.id === "inFrom") { onPlaceTyped("from", t.value); }
    else if (t.id === "inTo") { onPlaceTyped("to", t.value); }
  }

  function onPlaceTyped(which, value) {
    const p = form[which];
    (p.llName === undefined) && (p.llName = p.name);
    p.name = value;
    if (p.ll && p.llName !== value) p.ll = null;
    form.presetId = null;
    markPresetDeselect();
    renderPlaceState(which);
  }

  /* ════════════════ 토스트 ════════════════ */
  function toast(msg, isErr) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast on" + (isErr ? " err" : "") + (sheetMode ? " low" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast" + (isErr ? " err" : "") + (sheetMode ? " low" : ""); }, 2800);
  }

  /* ════════════════ PWA ════════════════ */
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }
  async function promptInstall() {
    if (!deferredPrompt) {
      toast(isIOS() ? "Safari 공유 → 홈 화면에 추가" : "브라우저 메뉴에서 ‘홈 화면에 추가’를 눌러 주세요");
      return;
    }
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { }
    deferredPrompt = null;
    closeSheet();
  }
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then(reg => {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              toast("새 버전이 준비됐어요. 앱을 다시 열면 적용됩니다.");
            }
          });
        });
      }).catch(() => { });
    });
  }

  /* ════════════════ 시작 ════════════════ */
  function initUI() {
    $("listBtn").addEventListener("click", openList);
    $("shareBtn").addEventListener("click", openShare);
    $("sheetClose").addEventListener("click", closeSheet);
    $("scrim").addEventListener("click", closeSheet);
    $("sheetBody").addEventListener("click", onSheetClick);
    $("sheetBody").addEventListener("input", onSheetInput);
    $("sheetBody").addEventListener("change", onSheetInput);
    $("sheetFoot").addEventListener("click", onSheetClick);
    $("chips").addEventListener("click", e => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const act = el.dataset.act;
      if (act === "switch") goTo(el.dataset.id);
      else if (act === "switch-shared") { if (sharedJourney) activate(sharedJourney, { day: sharedJourney.sharedDay }); }
      else if (act === "new") openForm(null);
    });

    const slider = $("slider");
    slider.addEventListener("input", e => { stopPlay(); setDay(parseInt(e.target.value, 10)); });
    slider.addEventListener("change", () => { /* 저장은 여정 단위 */ });

    document.querySelectorAll("[data-jump]").forEach(btn => {
      btn.addEventListener("click", () => {
        stopPlay();
        if (!current) return;
        const total = totalDays(current);
        setDay(clamp(shownDay(current) + parseInt(btn.dataset.jump, 10), 0, total));
      });
    });

    $("playBtn").addEventListener("click", () => { playing ? stopPlay() : startPlay(); });
    $("modePill").addEventListener("click", () => {
      if (viewDay != null) { viewDay = null; render(); toast("오늘로 돌아왔어요"); }
      else if (current === sharedJourney) { activate(current, { day: sharedJourney.sharedDay }); }
    });
    $("msStrip").addEventListener("click", openMilestones);
    $("msClose").addEventListener("click", () => { $("msCard").hidden = true; });
    $("pickCancel").addEventListener("click", () => { endPick(); resumeForm(); });
    $("pickRetry").addEventListener("click", () => {
      if (pickMarker && map) { map.removeLayer(pickMarker); pickMarker = null; }
      pickLL = null;
      $("pickOk").disabled = true;
      $("pickRetry").hidden = true;
      $("pickText").textContent = "지도를 눌러 " + (picking === "from" ? "출발지" : "도착지") + "를 정하세요";
    });
    $("pickOk").addEventListener("click", confirmPick);

    $("sbSave").addEventListener("click", saveShared);
    $("sbMine").addEventListener("click", () => {
      const j = store.journeys.find(x => x.id === store.activeId) || store.journeys[0];
      activate(j);
      try { history.replaceState({}, "", location.pathname); } catch (e) { }
      toast("내 여정으로 돌아왔어요 · 공유받은 여정은 위 칩에 남아 있어요");
    });

    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredPrompt = e;
    });
    window.addEventListener("appinstalled", () => { deferredPrompt = null; toast("홈 화면에 추가했어요"); });
    window.addEventListener("resize", () => { if (map) { map.invalidateSize(); if (current) fitRoute(current); } });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { render(); } });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && sheetMode) closeSheet();
    });
  }

  function resumeForm() {
    if (!form) { closeSheet(); return; }
    renderForm();
    openSheet("form");
  }

  function saveShared() {
    if (!sharedJourney) return;
    const copy = normalizeJourney(JSON.parse(JSON.stringify({
      id: uid(), title: sharedJourney.title, emoji: sharedJourney.emoji,
      from: sharedJourney.from, to: sharedJourney.to,
      start: sharedJourney.start, target: sharedJourney.target,
      presetId: sharedJourney.presetId, route: sharedJourney.route,
      createdAt: Date.now()
    })));
    if (!copy) { toast("저장하지 못했어요"); return; }
    store.journeys.push(copy);
    store.activeId = copy.id;
    saveStore();
    sharedJourney = null;
    activate(copy);
    try { history.replaceState({}, "", location.pathname); } catch (e) { }
    toast("내 여정에 저장했어요");
  }

  function boot() {
    const ok = initMap();
    initUI();
    registerSW();

    const saved = readStore();
    if (saved) {
      store = saved;
    } else {
      const legacy = migrateLegacy();
      const first = legacy || presetJourney(PRESETS[0]);
      store = { v: 2, journeys: [first], activeId: first.id, onboarded: false, seen: {} };
      saveStore();
    }

    /* 공유 링크 */
    let sharedError = false;
    try {
      const params = new URLSearchParams(location.search);
      const raw = params.get("share");
      if (raw) {
        try {
          sharedJourney = parseShare(raw);
        } catch (err) {
          sharedError = true;
        }
      }
      if (params.get("new")) {
        setTimeout(() => openForm(null), 600);
      }
    } catch (e) { }

    let start = store.journeys.find(j => j.id === store.activeId) || store.journeys[0];
    if (sharedJourney) {
      activate(sharedJourney, { day: sharedJourney.sharedDay });
    } else {
      activate(start);
    }

    if (sharedError) toast("공유 링크를 읽지 못했어요. 링크가 잘리지 않았는지 확인해 주세요.", true);
    if (!ok) return;

    if (!store.onboarded && !sharedJourney) {
      setTimeout(openWelcome, 700);
    }
    window.addEventListener("pagehide", () => { try { saveStore(); } catch (e) { } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
