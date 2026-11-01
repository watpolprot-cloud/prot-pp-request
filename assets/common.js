/* ระบบคำร้อง ปพ. งานทะเบียน — ฟังก์ชันร่วมของหน้านักเรียนและหลังบ้าน */
(function () {
  'use strict';
  var C = window.PP_CONFIG || {};
  var TH = 'th-TH-u-ca-buddhist';
  var PP = { config: C };

  PP.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------- API ---------- */
  PP.api = function (action, data) {
    var body = JSON.stringify(Object.assign({ action: action }, data || {}));
    function once() {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 45000) : null;
      return fetch(C.apiUrl, { method: 'POST', body: body, redirect: 'follow', signal: ctl ? ctl.signal : undefined })
        .then(function (res) { return res.json(); })
        .finally(function () { if (timer) clearTimeout(timer); });
    }
    return once().catch(function () { return once(); }).catch(function () {
      var e = new Error('เชื่อมต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง'); e.code = 'NET'; throw e;
    }).then(function (j) {
      if (!j || !j.ok) {
        var e = new Error((j && j.error) || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
        e.code = j && j.code; if (j && j.detail) e.detail = j.detail; throw e;
      }
      return j;
    });
  };

  /* ---------- storage (ปลอดภัยเมื่อเบราว์เซอร์ปิดการเก็บข้อมูล) ---------- */
  PP.store = {
    get: function (k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v, persist) {
      try { (persist ? localStorage : sessionStorage).setItem(k, v); (persist ? sessionStorage : localStorage).removeItem(k); } catch (e) { }
    },
    del: function (k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { } }
  };

  /* ---------- dates ---------- */
  function d(v) { return v instanceof Date ? v : new Date(v); }
  PP.iso = function (x) { x = d(x); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  PP.parseISO = function (s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); };
  PP.fD = function (v) { return v ? new Intl.DateTimeFormat(TH, { day: 'numeric', month: 'short', year: 'numeric' }).format(d(v)) : ''; };
  PP.fT = function (v) { return v ? new Intl.DateTimeFormat(TH, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d(v)) + ' น.' : ''; };
  PP.fDT = function (v) { return v ? PP.fD(v) + ' ' + PP.fT(v) : ''; };
  PP.fWeek = function (v) { return new Intl.DateTimeFormat(TH, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d(v)); };
  PP.fLong = function (isoDate) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return ''; return new Intl.DateTimeFormat(TH, { day: 'numeric', month: 'long', year: 'numeric' }).format(PP.parseISO(isoDate)); };
  PP.dateParts = function (isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return { d: '', m: '', y: '' };
    var x = PP.parseISO(isoDate);
    return { d: String(x.getDate()), m: new Intl.DateTimeFormat(TH, { month: 'long' }).format(x), y: String(x.getFullYear() + 543) };
  };
  PP.age = function (dob) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dob))) return null;
    var b = PP.parseISO(dob), n = new Date(), a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  };

  /* ---------- working days ---------- */
  var HOL = {};
  PP.setHolidays = function (list) { HOL = {}; (list || []).forEach(function (h) { HOL[h.d] = h.name || true; }); };
  PP.isWork = function (x) { var w = x.getDay(); return w !== 0 && w !== 6 && !HOL[PP.iso(x)]; };
  PP.addWork = function (v, n) { var x = d(v); x = new Date(x.getFullYear(), x.getMonth(), x.getDate(), 12); var k = 0; while (k < n) { x.setDate(x.getDate() + 1); if (PP.isWork(x)) k++; } return x; };
  PP.workBetween = function (a, b) {
    var x = d(a); x = new Date(x.getFullYear(), x.getMonth(), x.getDate(), 12);
    var e = d(b); e = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 12);
    var n = 0; while (x < e) { x.setDate(x.getDate() + 1); if (PP.isWork(x)) n++; } return n;
  };
  PP.nextWorkdays = function (k) { var out = [], x = new Date(); x.setHours(12, 0, 0, 0); while (out.length < k) { x.setDate(x.getDate() + 1); if (PP.isWork(x)) out.push(new Date(x)); } return out; };

  /* ---------- domain ---------- */
  PP.ST = {
    photo: { label: 'รอรูปถ่าย', tone: 'wait', stage: 1 }, work: { label: 'กำลังจัดทำ', tone: 'work', stage: 2 },
    hold: { label: 'รอผลการเรียน', tone: 'hold', stage: 2 }, sign: { label: 'เสนอลงนาม', tone: 'work', stage: 3 },
    ready: { label: 'พร้อมรับ', tone: 'ready', stage: 4 }, done: { label: 'รับเอกสารแล้ว', tone: 'done', stage: 5 },
    fix: { label: 'ต้องแก้ไข', tone: 'alert', stage: 0 }, cancel: { label: 'ยกเลิก', tone: 'done', stage: 0 },
    expired: { label: 'หมดอายุ', tone: 'done', stage: 0 }
  };
  PP.OPEN = ['photo', 'work', 'hold', 'sign', 'ready', 'fix'];
  PP.STAGES = ['รอรูปถ่าย', 'กำลังจัดทำ', 'เสนอผู้บริหารลงนาม', 'พร้อมรับ', 'รับเอกสารแล้ว'];
  PP.isOpen = function (r) { return PP.OPEN.indexOf(r.status) > -1; };
  PP.pill = function (r) { var s = PP.ST[r.status] || { label: r.status, tone: 'done' }; return '<span class="pill t-' + s.tone + '">' + s.label + '</span>'; };
  PP.stageOf = function (r) { if (r.status === 'fix') return (PP.ST[r.resume] || PP.ST.work).stage; return (PP.ST[r.status] || { stage: 0 }).stage; };
  PP.photos = function (r) { return (r.pp1 || 0) + (r.pp7 || 0); };
  PP.semsText = function (list) { return (list || []).join(', '); };
  PP.docsText = function (r) {
    var a = [];
    if (r.pp1) a.push('ปพ.1 × ' + r.pp1 + (r.lang === 'en' ? ' (อังกฤษ)' : ''));
    if (r.pp7) a.push('ปพ.7 × ' + r.pp7);
    if (r.pp6) a.push('ปพ.6 × ' + r.pp6 + ' (' + PP.semsText(r.pp6Sems) + ')');
    return a.join(' · ');
  };
  // ปพ.6 เลือกได้ทีละภาคเรียน ตั้งแต่ปีที่นักเรียนน่าจะเข้า ม.1 (ไม่เกิน 6 ปี) จนถึงภาคเรียนล่าสุดที่ผลเข้า SGS
  // ปพ.6 ขอได้เฉพาะช่วงชั้นปัจจุบัน: ม.ต้นเริ่มที่ ม.1 ภาคเรียนที่ 1 · ม.ปลายเริ่มที่ ม.4 ภาคเรียนที่ 1
  PP.pp6Start = function (level) { var L = parseInt(level, 10) || 1; return L >= 4 ? 4 : 1; };
  PP.pp6Opts = function (cfg, level) {
    var y = parseInt(cfg.year, 10), L = Math.min(6, Math.max(1, parseInt(level, 10) || 1)), max = PP.semKey(cfg.latest), out = [];
    for (var yr = y; yr >= y - (L - PP.pp6Start(L)); yr--) {
      var sems = [1, 2].map(function (t) { return t + '/' + yr; }).filter(function (v) { return PP.semKey(v) <= max; });
      if (sems.length) out.push({ year: yr, lv: L - (y - yr), sems: sems });
    }
    return out;
  };
  PP.DOCS = {
    pp1: { code: 'ปพ.1', name: 'ระเบียนแสดงผลการเรียน (ใบรับรองผลการเรียน)', note: 'แสดงผลการเรียนทุกรายวิชาตั้งแต่เข้าเรียนจนถึงภาคเรียนที่เลือก มี 2 หน้า ใช้รูปถ่าย 1 รูปต่อ 1 ชุด', imgs: ['assets/samples/pp1-1.jpg', 'assets/samples/pp1-2.jpg'], thumb: 'assets/samples/pp1-1-t.jpg' },
    pp6: { code: 'ปพ.6', name: 'รายงานผลการเรียนรายภาคเรียน', note: 'แสดงผลการเรียนของภาคเรียนเดียว 1 ภาคเรียนได้ 1 แผ่น ไม่ต้องใช้รูปถ่าย', imgs: ['assets/samples/pp6.jpg'], thumb: 'assets/samples/pp6-t.jpg' },
    pp7: { code: 'ปพ.7', name: 'ใบรับรองสภาพการเป็นนักเรียน', note: 'รับรองว่ากำลังศึกษาอยู่ที่โรงเรียนในภาคเรียนปัจจุบัน ใช้รูปถ่าย 1 รูปต่อ 1 ชุด', imgs: ['assets/samples/pp7.jpg'], thumb: 'assets/samples/pp7-t.jpg' }
  };
  PP.semKey = function (v) { var m = String(v || '').match(/^(\d)\/(\d{4})$/); return m ? (+m[2]) * 10 + (+m[1]) : 0; };
  PP.fullName = function (o) { return (o.pre || o.prefix || '') + (o.fn || o.fname || '') + ' ' + (o.ln || o.lname || ''); };
  PP.isM6 = function (level) { return String(level) === '6'; };
  // จำนวนภาคเรียนของ ม.ปลาย จนถึง scope (ใช้กับ ม.6 ให้ตรงกับรายงาน "พิมพ์ ปพ.1 4/5 ภาคเรียน" ของ SGS)
  PP.m6Count = function (scope, year) {
    var m = String(scope || '').match(/^(\d)\/(\d{4})$/), y = parseInt(year, 10);
    if (!m || !y) return 0;
    var n = (+m[2] - (y - 2)) * 2 + (+m[1]);
    return n >= 1 && n <= 6 ? n : 0;
  };
  PP.scopeText = function (scope, level, year) {
    if (!scope) return '';
    var n = PP.isM6(level) ? PP.m6Count(scope, year || (PP.cfg && PP.cfg.year)) : 0;
    return n ? 'ผลการเรียน ' + n + ' ภาคเรียน (ถึง ' + scope + ')' : 'ผลการเรียนถึงภาคเรียนที่ ' + scope;
  };
  PP.scopeOpts = function (cfg, level) {
    var out = [];
    function lab(s, pending) {
      var n = PP.isM6(level) ? PP.m6Count(s, cfg.year) : 0;
      if (n) return 'ผลการเรียน ' + n + ' ภาคเรียน (' + (pending ? 'รวม ' : 'ถึง ') + s + ')';
      return pending ? 'รวมภาคเรียนที่ ' + s : 'ผลการเรียนถึงภาคเรียนที่ ' + s;
    }
    out.push({ v: cfg.latest, l: lab(cfg.latest, false), s: '' });
    if (cfg.pending) out.push({ v: cfg.pending, l: lab(cfg.pending, true), s: 'ต้องรอผลการเรียนเข้าระบบก่อน จึงได้ช้ากว่าปกติ' });
    return out;
  };
  PP.telFmt = function (t) { return t && t.length === 10 ? t.slice(0, 3) + '-' + t.slice(3, 6) + '-' + t.slice(6) : (t || ''); };
  PP.PURPOSES = ['ขอทุนการศึกษา', 'ศึกษาต่อ', 'สมัครงาน', 'อื่น ๆ'];
  PP.PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง'];
  PP.MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  // ปีเกิด (พ.ศ.) ที่เลือกได้ในแบบฟอร์ม: อายุประมาณ 10 ถึง 25 ปี
  // ตู้ลิ้นชัก 10 ชั้น แถวเดียว (นับจากบนลงล่าง): 1 รับแบบฟอร์ม · 2 ส่งเอกสาร · 3–8 รับเอกสาร ม.1–ม.6 · 9–10 ว่าง
  PP.DRAWERS = [
    { n: 1, short: 'รับแบบฟอร์ม', label: 'รับแบบฟอร์ม', sub: 'ใบนำส่งรูปถ่าย และแบบคำร้องกระดาษ' },
    { n: 2, short: 'ส่งเอกสาร', label: 'ส่งเอกสาร', sub: 'ใบนำส่งที่กรอกแล้วพร้อมรูปถ่าย' }
  ].concat([1, 2, 3, 4, 5, 6].map(function (lv) { return { n: lv + 2, lv: lv, short: 'รับ ม.' + lv, label: 'รับเอกสาร ม.' + lv, sub: 'เอกสาร ปพ. ที่พร้อมรับของนักเรียนชั้น ม.' + lv }; }))
    .concat([{ n: 9, short: '', label: 'ว่าง', sub: '' }, { n: 10, short: '', label: 'ว่าง', sub: '' }]);
  PP.drawerNo = function (level) { var lv = parseInt(level, 10); return lv >= 1 && lv <= 6 ? lv + 2 : 0; };
  PP.drawerName = function (level) { var n = PP.drawerNo(level); return n ? 'ลิ้นชักที่ ' + n + ' (ม.' + (n - 2) + ')' : 'ลิ้นชักระดับชั้น'; };
  // ภาพตู้ลิ้นชัก 10 ชั้น เน้นชั้นที่ hi; mode 'in' = ใส่เอกสาร, 'out' = หยิบออก; คืนค่าเป็นกลุ่ม SVG ขนาด 160 x 262
  PP.cabinetG = function (hi, mode, id) {
    var g = '', H = 22, top = 10, x = 26, w = 92;
    g += '<rect x="' + (x - 7) + '" y="' + (top - 6) + '" width="' + (w + 14) + '" height="' + (10 * H + 10) + '" rx="7" fill="#EFE8FA" stroke="#3A1468" stroke-width="2"/>';
    PP.DRAWERS.forEach(function (d) {
      var y = top + (d.n - 1) * H, on = d.n === hi;
      g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + (H - 3) + '" rx="3" fill="' + (on ? '#F5B700' : '#fff') + '" stroke="' + (on ? '#8A5A00' : '#b9b0c9') + '" stroke-width="' + (on ? 2 : 1.2) + '"/>' +
        '<text x="' + (x + 9) + '" y="' + (y + 14) + '" text-anchor="middle" font-family="Chakra Petch,sans-serif" font-weight="700" font-size="11" fill="' + (on ? '#2A1300' : '#3A1468') + '">' + d.n + '</text>' +
        (d.short ? '<text x="' + (x + 20) + '" y="' + (y + 13.5) + '" font-family="IBM Plex Sans Thai,sans-serif" font-weight="' + (on ? 700 : 500) + '" font-size="9" fill="' + (on ? '#2A1300' : '#6b6380') + '">' + d.short + '</text>' : '') +
        '<rect x="' + (x + w - 14) + '" y="' + (y + 7) + '" width="9" height="5" rx="2.5" fill="' + (on ? '#2A1300' : '#b9b0c9') + '"/>';
    });
    g += '<rect x="' + (x - 3) + '" y="' + (top + 10 * H + 4) + '" width="7" height="10" fill="#3A1468"/><rect x="' + (x + w - 4) + '" y="' + (top + 10 * H + 4) + '" width="7" height="10" fill="#3A1468"/>';
    if (hi) {
      var cy = top + (hi - 1) * H + (H - 3) / 2;
      var paper = '<rect x="0" y="-10" width="18" height="22" rx="1.5" fill="#fff" stroke="#8d84a3" stroke-width="1.2"/><path d="M4 -3h10M4 2h10M4 7h7" stroke="#c9c2d6" stroke-width="1.6" stroke-linecap="round"/>';
      g += mode === 'in'
        ? '<g class="cab-in" style="--cy:' + cy + 'px"><g transform="translate(132 ' + cy + ')">' + paper + '</g></g><g class="dw-bob"><path d="M156 ' + cy + 'h-30M134 ' + (cy - 7) + 'l-8 7 8 7" fill="none" stroke="#E2A800" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>'
        : mode === 'out'
          ? '<g class="cab-out"><g transform="translate(132 ' + cy + ')">' + paper + '</g></g><g class="dw-bob"><path d="M124 ' + cy + 'h30M146 ' + (cy - 7) + 'l8 7-8 7" fill="none" stroke="#E2A800" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>'
          : '<path d="M156 ' + cy + 'h-30M134 ' + (cy - 7) + 'l-8 7 8 7" fill="none" stroke="#E2A800" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    return g;
  };
  PP.cabinetSVG = function (hi, mode, cls) {
    return '<svg class="' + (cls || 'cab-art') + '" viewBox="0 0 162 252" role="img" aria-label="ตู้ลิ้นชัก 10 ชั้น' + (hi ? ' ลิ้นชักที่ ' + hi : '') + '">' + PP.cabinetG(hi, mode) + '</svg>';
  };
  PP.birthYears = function () { var y = new Date().getFullYear() + 543, out = []; for (var i = y - 10; i >= y - 25; i--) out.push(i); return out; };
  // วันเกิดจากช่องเลือก วัน/เดือน/ปี พ.ศ. → ปปปป-ดด-วว (ค.ศ.) หรือ '' ถ้ายังไม่ครบหรือไม่มีวันนั้นจริง
  PP.dobISO = function (d, m, yBE) {
    d = +d; m = +m; var y = (+yBE) - 543;
    if (!d || !m || !yBE) return '';
    var x = new Date(y, m - 1, d);
    if (x.getMonth() !== m - 1 || x.getDate() !== d) return '';
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };

  /* ---------- toast ---------- */
  var tT;
  PP.toast = function (m, ms) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = m; t.hidden = false; clearTimeout(tT);
    tT = setTimeout(function () { t.hidden = true; }, ms || 3800);
  };

  window.PP = PP;
})();
