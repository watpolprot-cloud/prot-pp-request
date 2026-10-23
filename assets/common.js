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
  PP.pp6Opts = function (cfg, level) {
    var y = parseInt(cfg.year, 10), L = parseInt(level, 10) || 1, max = PP.semKey(cfg.latest), out = [];
    for (var yr = y; yr >= y - (L - 1) && yr >= y - 5; yr--) {
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
    out.push({ v: cfg.latest, l: lab(cfg.latest, false), s: 'ออกเอกสารได้ตามปกติ' });
    if (cfg.pending) out.push({ v: cfg.pending, l: lab(cfg.pending, true), s: 'ต้องรอผลการเรียนเข้าระบบก่อน จึงได้ช้ากว่าปกติ' });
    return out;
  };
  PP.nidOk = function (n) { if (!/^\d{13}$/.test(n)) return false; var s = 0; for (var i = 0; i < 12; i++) s += (+n[i]) * (13 - i); return (11 - s % 11) % 10 === +n[12]; };
  PP.telFmt = function (t) { return t && t.length === 10 ? t.slice(0, 3) + '-' + t.slice(3, 6) + '-' + t.slice(6) : (t || ''); };
  PP.PURPOSES = ['ขอทุนการศึกษา', 'ศึกษาต่อ', 'สมัครงาน', 'อื่น ๆ'];
  PP.PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง'];
  PP.REASONS = {
    name: ['เปลี่ยนชื่อหรือชื่อสกุล', 'เปลี่ยนคำนำหน้า', 'สะกดไม่ถูกต้อง', 'อื่น ๆ'],
    dob: ['ข้อมูลในทะเบียนไม่ถูกต้อง', 'อื่น ๆ'],
    fa: ['เปลี่ยนชื่อหรือชื่อสกุล', 'สะกดไม่ถูกต้อง', 'ในทะเบียนยังไม่มีข้อมูล', 'ไม่มีข้อมูลหรือไม่ประสงค์ระบุ', 'อื่น ๆ'],
    mo: ['เปลี่ยนชื่อหรือชื่อสกุล', 'สะกดไม่ถูกต้อง', 'ในทะเบียนยังไม่มีข้อมูล', 'ไม่มีข้อมูลหรือไม่ประสงค์ระบุ', 'อื่น ๆ']
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
