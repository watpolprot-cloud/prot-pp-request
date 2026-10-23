/**
 * ระบบคำร้อง ปพ.1 / ปพ.6 / ปพ.7 ออนไลน์ — งานทะเบียน โรงเรียนพรตพิทยพยัต
 *
 * Google Apps Script เว็บแอป (Deploy: Execute as "Me", Who has access "Anyone")
 * - หน้าเว็บนักเรียนและหลังบ้านอยู่บน GitHub Pages เรียกใช้ผ่าน doPost (JSON)
 * - ฐานข้อมูลคือ Google Sheets ที่ฟังก์ชัน setup() สร้างให้ (เก็บ ID ไว้ใน Script Properties: SS_ID)
 * - เลขประจำตัวประชาชนไม่ถูกเก็บแบบอ่านได้ เก็บเป็นค่าแฮช SHA-256 ผสมค่าลับ (Script Properties: PEPPER)
 *
 * ฟังก์ชันที่ผู้ดูแลกด Run เองในหน้าแก้ไขสคริปต์ได้
 *   setup()        สร้าง/ซ่อมฐานข้อมูล ค่าเริ่มต้น และตัวตั้งเวลารายวัน (รันซ้ำได้ ไม่ลบข้อมูล)
 *   dailyJob()     งานรายวัน: หมดอายุคำร้องที่ไม่ส่งรูป ปิดคำร้องที่พร้อมรับนานเกินกำหนด ลบข้อมูลเก่า
 *   openStaging()  เปิดรับการนำเข้ารายชื่อนักเรียนจาก SGS (ต้นภาคเรียน)
 */
var VERSION = '1.0.0';

var SHEETS = {
  STU: 'นักเรียน', REQ: 'คำร้อง', LOG: 'ประวัติ', SET: 'ตั้งค่า',
  USR: 'ผู้ใช้หลังบ้าน', STG: 'นำเข้า', SES: 'เซสชัน'
};

// [key, หัวคอลัมน์ภาษาไทย, รูปแบบ ('@' = ข้อความ)] — ห้ามสลับลำดับคอลัมน์ในชีต
var COLS = {
  STU: [
    ['sid', 'รหัสนักเรียน', '@'], ['nidHash', 'รหัสยืนยันตัวตน (แฮช)', '@'],
    ['prefix', 'คำนำหน้า', '@'], ['fname', 'ชื่อ', '@'], ['lname', 'นามสกุล', '@'],
    ['dob', 'วันเกิด (ค.ศ. ปปปป-ดด-วว)', '@'], ['father', 'ชื่อบิดา', '@'], ['mother', 'ชื่อมารดา', '@'],
    ['level', 'ชั้น ม.', '@'], ['room', 'ห้อง', '@'], ['no', 'เลขที่', '@'], ['updatedAt', 'ปรับปรุงเมื่อ', '']
  ],
  REQ: [
    ['no', 'เลขคำร้อง', '@'], ['year', 'ปีการศึกษา', '@'], ['sid', 'รหัสนักเรียน', '@'],
    ['name', 'ชื่อ-สกุล', '@'], ['cls', 'ชั้น/ห้อง', '@'], ['status', 'รหัสสถานะ', '@'], ['statusTh', 'สถานะ', '@'],
    ['pp1', 'ปพ.1 (ชุด)', ''], ['scope', 'ผลการเรียนถึงภาคเรียน', '@'], ['lang', 'ภาษา ปพ.1', '@'], ['pp7', 'ปพ.7 (ชุด)', ''],
    ['purpose', 'เพื่อ', '@'], ['other', 'ระบุอื่น ๆ', '@'], ['needBy', 'ต้องใช้ภายใน', '@'], ['phone', 'โทรศัพท์', '@'],
    ['changes', 'ข้อมูลที่ขอแก้ (JSON)', '@'], ['channel', 'ช่องทาง', '@'],
    ['submittedAt', 'ยื่นเมื่อ', ''], ['photoDue', 'กำหนดส่งรูป', ''], ['photoAt', 'ได้รับรูปเมื่อ', ''],
    ['signAt', 'เสนอลงนามเมื่อ', ''], ['readyAt', 'พร้อมรับเมื่อ', ''], ['doneAt', 'ปิดคำร้องเมื่อ', ''],
    ['fixAt', 'ส่งกลับแก้ไขเมื่อ', ''], ['resume', 'สถานะก่อนส่งกลับ', '@'],
    ['issueReason', 'เหตุผลที่ต้องแก้ไข', '@'], ['issueTodo', 'สิ่งที่นักเรียนต้องทำ', '@'], ['issueText', 'ข้อความถึงนักเรียน', '@'],
    ['note', 'บันทึกภายใน', '@'], ['rating', 'คะแนนความพึงพอใจ', ''], ['reprint', 'พิมพ์ใหม่ (ครั้ง)', ''],
    ['fixCount', 'ส่งกลับ (ครั้ง)', ''], ['createdBy', 'ผู้บันทึก', '@'], ['updatedAt', 'แก้ไขล่าสุด', ''],
    ['pp6', 'ปพ.6 (แผ่น)', ''], ['pp6Sems', 'ปพ.6 ภาคเรียนที่ขอ', '@']
  ],
  LOG: [['time', 'เวลา', ''], ['no', 'เลขคำร้อง', '@'], ['who', 'ผู้ทำ', '@'], ['action', 'การกระทำ', '@'], ['detail', 'รายละเอียด', '@']],
  SET: [['key', 'ชื่อค่า', '@'], ['value', 'ค่า', '@'], ['desc', 'คำอธิบาย', '@']],
  USR: [
    ['username', 'ชื่อผู้ใช้', '@'], ['displayName', 'ชื่อที่แสดง', '@'], ['role', 'บทบาท (admin/staff)', '@'],
    ['tempPassword', 'รหัสผ่านชั่วคราว (พิมพ์ที่นี่ ระบบลบให้เมื่อตั้งรหัสใหม่)', '@'],
    ['passHash', 'passHash (ระบบใช้)', '@'], ['salt', 'salt (ระบบใช้)', '@'], ['active', 'ใช้งาน (TRUE/FALSE)', '@'], ['lastLogin', 'เข้าใช้ล่าสุด', '']
  ],
  SES: [['tokenHash', 'tokenHash', '@'], ['kind', 'ประเภท', '@'], ['subject', 'ผู้ใช้', '@'], ['expires', 'หมดอายุ', ''], ['created', 'สร้างเมื่อ', '']]
};
COLS.STG = COLS.STU.concat([['batch', 'ชุดนำเข้า', '@']]);

var ST = {
  photo: 'รอรูปถ่าย', work: 'กำลังจัดทำ', hold: 'รอผลการเรียน', sign: 'เสนอลงนาม', ready: 'พร้อมรับ',
  done: 'รับเอกสารแล้ว', fix: 'ต้องแก้ไข', cancel: 'ยกเลิก', expired: 'หมดอายุ'
};
var OPEN = ['photo', 'work', 'hold', 'sign', 'ready', 'fix'];
var PURPOSES = ['ขอทุนการศึกษา', 'ศึกษาต่อ', 'สมัครงาน', 'อื่น ๆ'];
var PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง'];
var REASONS = {
  name: ['เปลี่ยนชื่อหรือชื่อสกุล', 'เปลี่ยนคำนำหน้า', 'สะกดไม่ถูกต้อง', 'อื่น ๆ'],
  dob: ['ข้อมูลในทะเบียนไม่ถูกต้อง', 'อื่น ๆ'],
  fa: ['เปลี่ยนชื่อหรือชื่อสกุล', 'สะกดไม่ถูกต้อง', 'ในทะเบียนยังไม่มีข้อมูล', 'ไม่มีข้อมูลหรือไม่ประสงค์ระบุ', 'อื่น ๆ'],
  mo: ['เปลี่ยนชื่อหรือชื่อสกุล', 'สะกดไม่ถูกต้อง', 'ในทะเบียนยังไม่มีข้อมูล', 'ไม่มีข้อมูลหรือไม่ประสงค์ระบุ', 'อื่น ๆ']
};
var FIX = [
  { r: 'รูปถ่ายไม่ถูกระเบียบ', todo: 'นำรูปถ่ายใหม่ (ชุดนักเรียน ทรงผมถูกระเบียบ ไม่สวมเครื่องประดับ) ใส่ลิ้นชักที่ 2 พร้อมใบนำส่งที่เขียนเลขคำร้องและลงชื่อแล้ว' },
  { r: 'รูปถ่ายไม่ครบจำนวน', todo: 'นำรูปถ่ายที่ยังขาดใส่ลิ้นชักที่ 2 พร้อมใบนำส่งที่เขียนเลขคำร้อง' },
  { r: 'ยังไม่ได้ลงชื่อในใบนำส่งรูปถ่าย', todo: 'ติดต่อครูปรางทองที่หน้าห้องสำนักงานวิชาการ เพื่อลงชื่อผู้ขอ' },
  { r: 'ต้องแสดงหลักฐานการเปลี่ยนชื่อหรือชื่อสกุล', todo: 'นำหลักฐานการเปลี่ยนชื่อหรือชื่อสกุลฉบับจริงมาแสดงที่ครูปรางทอง หน้าห้องสำนักงานวิชาการ' },
  { r: 'ข้อมูลในคำร้องไม่ชัดเจน', todo: 'ติดต่อครูปรางทองที่หน้าห้องสำนักงานวิชาการ เพื่อยืนยันข้อมูล' },
  { r: 'อื่น ๆ', todo: '' }
];
var DEFAULT_HOLIDAYS = [
  '2026-10-23 วันปิยมหาราช', '2026-12-05 วันพ่อแห่งชาติ', '2026-12-10 วันรัฐธรรมนูญ', '2026-12-31 วันสิ้นปี',
  '2027-01-01 วันขึ้นปีใหม่', '2027-04-06 วันจักรี', '2027-04-13 วันสงกรานต์', '2027-04-14 วันสงกรานต์', '2027-04-15 วันสงกรานต์',
  '2027-05-04 วันฉัตรมงคล', '2027-06-03 วันเฉลิมพระชนมพรรษาพระราชินี', '2027-07-28 วันเฉลิมพระชนมพรรษา ร.10',
  '2027-08-12 วันแม่แห่งชาติ', '2027-10-13 วันนวมินทรมหาราช', '2027-10-23 วันปิยมหาราช'
].join('\n');
var DEFAULTS = [
  ['open', 'TRUE', 'เปิดรับคำร้องออนไลน์ (TRUE/FALSE)'],
  ['announce', 'ผลการเรียนภาคเรียนที่ 1/2569 ยังไม่เข้าระบบ SGS ถ้าต้องการผลการเรียนรวมภาคเรียนนี้ ระบบจะพักคำร้องไว้และจัดทำต่อเมื่อผลเข้าระบบ', 'ข้อความประกาศหน้าแรกของนักเรียน (เว้นว่างได้)'],
  ['year', '2569', 'ปีการศึกษาที่ใช้กับเลขคำร้อง'],
  ['nextNo', '1', 'เลขคำร้องถัดไป (ระบบเพิ่มเอง)'],
  ['latest', '2/2568', 'ภาคเรียนล่าสุดที่ผลการเรียนเข้า SGS แล้ว (ภาค/ปี)'],
  ['pending', '1/2569', 'ภาคเรียนปัจจุบันที่ยังรอผลการเรียน (เว้นว่างถ้าไม่มี)'],
  ['allowEnglish', 'TRUE', 'ให้เลือกขอ ปพ.1 ฉบับภาษาอังกฤษ (TRUE/FALSE)'],
  ['photoDays', '7', 'จำนวนวันให้ส่งรูปหลังยื่นคำร้อง'],
  ['workMin', '3', 'วันทำการขั้นต่ำที่คาดว่าเอกสารพร้อม'],
  ['workMax', '5', 'วันทำการสูงสุดที่คาดว่าเอกสารพร้อม'],
  ['autoCloseDays', '14', 'ปิดคำร้องอัตโนมัติเมื่อพร้อมรับเกินกี่วัน'],
  ['retentionDays', '400', 'ลบข้อมูลส่วนบุคคลในคำร้องที่ปิดแล้วเกินกี่วัน'],
  ['holidays', DEFAULT_HOLIDAYS, 'วันหยุดที่ไม่นับเป็นวันทำการ (บรรทัดละ 1 วัน: ปปปป-ดด-วว ชื่อวันหยุด, ปี ค.ศ.)'],
  ['staffName', 'นางปรางทอง จันทคาม', 'ชื่อเจ้าหน้าที่ในใบคำร้อง'],
  ['registrarName', 'นางสาวประภาภรณ์ พรมศรี', 'ชื่อนายทะเบียนในใบคำร้อง'],
  ['approverName', 'นายเอกรินทร์ นิรันดร์', 'ผู้ลงนามเห็นควรในใบคำร้อง'],
  ['approverTitle', 'ผู้ช่วยผู้อำนวยการกลุ่มบริหารวิชาการ', 'ตำแหน่งผู้ลงนามเห็นควร'],
  ['studentUrl', 'https://watpolprot-cloud.github.io/prot-pp-request/', 'ลิงก์หน้าเว็บนักเรียน (ใช้ทำ QR)'],
  ['adminUrl', 'https://watpolprot-cloud.github.io/prot-pp-request/admin.html', 'ลิงก์หน้าหลังบ้าน'],
  ['stagingOpen', 'TRUE', 'เปิดรับการนำเข้ารายชื่อนักเรียน (ระบบปิดเองหลังนำเข้าเสร็จ)']
];

/* ===================== HTTP ===================== */
function doGet() {
  return json_({ ok: true, app: 'pp-request', version: VERSION });
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = ROUTES[body.action];
    if (!fn) throw userErr_('ไม่รู้จักคำสั่งนี้');
    out = fn(body) || {};
    out.ok = true;
  } catch (err) {
    if (err && err.user) {
      out = { ok: false, error: err.message, code: err.code || '' };
    } else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง', detail: String(err && err.message || err) };
    }
  }
  return json_(out);
}

var ROUTES = {
  config: function () { return { config: config_() }; },
  verify: verify_, me: me_, logout: logout_, submit: submit_, cancel: studentCancel_, received: received_,
  login: login_, setPassword: setPassword_, adminLogout: logout_,
  adminList: adminList_, adminAct: adminAct_, adminFix: adminFix_, adminNote: adminNote_,
  adminSaveSettings: adminSaveSettings_, adminFindStudent: adminFindStudent_, adminCreate: adminCreate_,
  adminReport: adminReport_,
  stage: stage_, stageCommit: stageCommit_
};

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function userErr_(msg, code) { var e = new Error(msg); e.user = true; if (code) e.code = code; return e; }

/* ===================== Sheet helpers ===================== */
var _ss = null, _set = null;
function ss_() {
  if (!_ss) {
    var id = PropertiesService.getScriptProperties().getProperty('SS_ID');
    if (!id) throw userErr_('ระบบยังไม่ได้ติดตั้งฐานข้อมูล (setup)');
    _ss = SpreadsheetApp.openById(id);
  }
  return _ss;
}
var _colsOk = {};
function sh_(key) {
  var sh = ss_().getSheetByName(SHEETS[key]);
  if (!_colsOk[key] && sh) {
    var need = COLS[key].length, have = sh.getMaxColumns();
    if (have < need) {
      sh.insertColumnsAfter(have, need - have);
      sh.getRange(1, have + 1, 1, need - have).setValues([COLS[key].slice(have).map(function (c) { return c[1]; })])
        .setFontWeight('bold').setBackground('#3A1468').setFontColor('#FFFFFF').setWrap(true);
      COLS[key].slice(have).forEach(function (c, j) { if (c[2] === '@') sh.getRange(2, have + j + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@'); });
    } else if (sh.getRange(1, need).getValues()[0][0] === '') {
      sh.getRange(1, 1, 1, need).setValues([COLS[key].map(function (c) { return c[1]; })]);
    }
    _colsOk[key] = true;
  }
  return sh;
}
function rows_(key) {
  var sh = sh_(key), cols = COLS[key], n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var v = sh.getRange(2, 1, n, cols.length).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] === '' || v[i][0] === null) continue;
    var o = { _row: i + 2 };
    for (var j = 0; j < cols.length; j++) o[cols[j][0]] = v[i][j];
    out.push(o);
  }
  return out;
}
function toRow_(key, o) {
  return COLS[key].map(function (c) { var v = o[c[0]]; return v === undefined || v === null ? '' : v; });
}
function ensureRows_(key, lastRow) {
  var sh = sh_(key), max = sh.getMaxRows();
  if (lastRow <= max) return;
  var add = lastRow - max + 200;
  sh.insertRowsAfter(max, add);
  textFormat_(sh, COLS[key], max + 1, add);
}
function textFormat_(sh, cols, fromRow, n) {
  cols.forEach(function (c, j) { if (c[2] === '@') sh.getRange(fromRow, j + 1, n, 1).setNumberFormat('@'); });
}
function put_(key, o) { sh_(key).getRange(o._row, 1, 1, COLS[key].length).setValues([toRow_(key, o)]); }
function add_(key, o) { addMany_(key, [o]); return o; }
function addMany_(key, list) {
  if (!list.length) return;
  var sh = sh_(key), r = sh.getLastRow() + 1;
  ensureRows_(key, r + list.length - 1);
  sh.getRange(r, 1, list.length, COLS[key].length).setValues(list.map(function (o, i) { o._row = r + i; return toRow_(key, o); }));
}
function lock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw userErr_('มีผู้ใช้งานพร้อมกันจำนวนมาก กรุณาลองใหม่อีกครั้ง');
  try { _set = null; return fn(); } finally { lock.releaseLock(); }
}

/* ===================== Settings ===================== */
function settings_() {
  if (_set) return _set;
  var s = {};
  rows_('SET').forEach(function (r) { s[String(r.key)] = { value: r.value === null ? '' : String(r.value), _row: r._row }; });
  _set = s;
  return s;
}
function sv_(k) { var s = settings_(); return s[k] ? s[k].value : ''; }
function setSv_(k, v) {
  var s = settings_(), sh = sh_('SET');
  if (s[k]) { sh.getRange(s[k]._row, 2).setValue(String(v)); s[k].value = String(v); }
  else { var o = add_('SET', { key: k, value: String(v), desc: '' }); s[k] = { value: String(v), _row: o._row }; }
}
function bool_(k) { return String(sv_(k)).trim().toUpperCase() === 'TRUE'; }
function int_(k, d) { var n = parseInt(sv_(k), 10); return isNaN(n) ? d : n; }
function semKey_(v) { var m = String(v || '').match(/^(\d)\/(\d{4})$/); return m ? (+m[2]) * 10 + (+m[1]) : 0; }
function holidays_() {
  return String(sv_('holidays')).split(/\r?\n/).map(function (l) {
    var m = l.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/); return m ? { d: m[1], name: m[2] } : null;
  }).filter(Boolean);
}
function pendingSem_() {
  var p = sv_('pending');
  return p && semKey_(p) > semKey_(sv_('latest')) ? p : '';
}
function config_() {
  return {
    open: bool_('open'), announce: sv_('announce'), year: sv_('year'),
    latest: sv_('latest'), pending: pendingSem_(), allowEnglish: bool_('allowEnglish'),
    photoDays: int_('photoDays', 7), workMin: int_('workMin', 3), workMax: int_('workMax', 5),
    holidays: holidays_()
  };
}

/* ===================== Crypto / sessions ===================== */
function sha_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}
var _pepper = null;
function pepper_() {
  if (_pepper) return _pepper;
  var p = PropertiesService.getScriptProperties().getProperty('PEPPER');
  if (!p) throw new Error('missing PEPPER');
  _pepper = p;
  return p;
}
function nidHash_(nid) { return sha_('nid|' + pepper_() + '|' + nid); }
function nidOk_(n) {
  if (!/^\d{13}$/.test(n)) return false;
  var s = 0;
  for (var i = 0; i < 12; i++) s += (+n.charAt(i)) * (13 - i);
  return (11 - s % 11) % 10 === +n.charAt(12);
}
function newToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function pwHash_(pw, salt) { var h = salt + '|' + pw; for (var i = 0; i < 300; i++) h = sha_(h + '|' + salt); return h; }
function cache_() { return CacheService.getScriptCache(); }

function createSession_(kind, subject, hours) {
  var tok = newToken_(), h = sha_('tok|' + tok), now = new Date();
  var exp = new Date(now.getTime() + hours * 3600e3);
  add_('SES', { tokenHash: h, kind: kind, subject: subject, expires: exp, created: now });
  cache_().put('ses|' + h, kind + '|' + subject, Math.min(21600, hours * 3600));
  return tok;
}
function session_(tok, kind) {
  if (!tok || typeof tok !== 'string' || tok.length < 20) return null;
  var h = sha_('tok|' + tok), c = cache_().get('ses|' + h);
  if (c) { var i = c.indexOf('|'); return c.slice(0, i) === kind ? c.slice(i + 1) : null; }
  var now = new Date();
  var r = rows_('SES').filter(function (x) { return x.tokenHash === h && x.kind === kind && x.expires instanceof Date && x.expires > now; })[0];
  if (!r) return null;
  var ttl = Math.min(21600, Math.floor((r.expires - now) / 1000));
  if (ttl > 1) cache_().put('ses|' + h, kind + '|' + r.subject, ttl);
  return String(r.subject);
}
function logout_(b) {
  if (b.token) {
    var h = sha_('tok|' + String(b.token));
    cache_().remove('ses|' + h);
    lock_(function () {
      rows_('SES').filter(function (x) { return x.tokenHash === h; }).forEach(function (x) { x.expires = new Date(0); put_('SES', x); });
    });
  }
  return {};
}

/* ===================== Common ===================== */
function str_(v, max) { return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function clampInt_(v, a, b) { var n = parseInt(v, 10); if (isNaN(n)) n = 0; return Math.max(a, Math.min(b, n)); }
function iso_(d) { return d instanceof Date && !isNaN(d.getTime()) && d.getTime() > 0 ? d.toISOString() : ''; }
function fullName_(s) { return String(s.prefix || '') + String(s.fname || '') + ' ' + String(s.lname || ''); }
function log_(no, who, action, detail) { add_('LOG', { time: new Date(), no: no || '', who: who, action: action, detail: detail || '' }); }
function setStatus_(r, st) { r.status = st; r.statusTh = ST[st]; r.updatedAt = new Date(); }
function parseJson_(s) { try { return s ? JSON.parse(String(s)) : {}; } catch (e) { return {}; } }
function needsHold_(r) { return (+r.pp1 > 0) && r.scope && semKey_(r.scope) > semKey_(sv_('latest')); }
// รูปถ่ายใช้เฉพาะ ปพ.1 และ ปพ.7 (1 รูปต่อ 1 ชุด) ส่วน ปพ.6 ไม่ต้องใช้รูป
function photosOf_(r) { return (+r.pp1 || 0) + (+r.pp7 || 0); }
function semsOf_(r) { return String(r.pp6Sems || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
function reqBy_(no) {
  no = String(no || '');
  var list = rows_('REQ');
  for (var i = 0; i < list.length; i++) if (String(list[i].no) === no) return list[i];
  return null;
}

function studentRow_(sid) {
  var sh = sh_('STU'), n = sh.getLastRow() - 1;
  if (n < 1) return null;
  var cell = sh.getRange(2, 1, n, 1).createTextFinder(sid).matchEntireCell(true).findNext();
  if (!cell) return null;
  var v = sh.getRange(cell.getRow(), 1, 1, COLS.STU.length).getValues()[0];
  var o = { _row: cell.getRow() };
  COLS.STU.forEach(function (c, j) { o[c[0]] = v[j]; });
  return o;
}
function studentsMap_() {
  var m = {};
  rows_('STU').forEach(function (s) { m[String(s.sid)] = s; });
  return m;
}
function pubStudent_(s) {
  return {
    sid: String(s.sid), prefix: String(s.prefix), fname: String(s.fname), lname: String(s.lname), dob: String(s.dob),
    father: String(s.father), mother: String(s.mother), level: String(s.level), room: String(s.room), no: String(s.no)
  };
}
function pubReq_(r) {
  return {
    no: String(r.no), year: String(r.year), sid: String(r.sid), cls: String(r.cls), status: String(r.status),
    pp1: +r.pp1 || 0, scope: String(r.scope || ''), lang: String(r.lang || 'th'), pp7: +r.pp7 || 0,
    pp6: +r.pp6 || 0, pp6Sems: semsOf_(r),
    purpose: String(r.purpose || ''), other: String(r.other || ''), needBy: String(r.needBy || ''),
    submittedAt: iso_(r.submittedAt), photoDue: iso_(r.photoDue), photoAt: iso_(r.photoAt), signAt: iso_(r.signAt),
    readyAt: iso_(r.readyAt), doneAt: iso_(r.doneAt), fixAt: iso_(r.fixAt), resume: String(r.resume || ''),
    issue: r.status === 'fix' ? { reason: String(r.issueReason || ''), todo: String(r.issueTodo || ''), text: String(r.issueText || '') } : null,
    rating: +r.rating || null, changes: parseJson_(r.changes), channel: String(r.channel || 'online')
  };
}
function adminReq_(r) {
  var o = pubReq_(r);
  o.name = String(r.name); o.phone = String(r.phone || ''); o.note = String(r.note || '');
  o.reprint = +r.reprint || 0; o.fixCount = +r.fixCount || 0; o.createdBy = String(r.createdBy || '');
  o.lastIssue = { reason: String(r.issueReason || ''), text: String(r.issueText || '') };
  return o;
}

/* ===================== Student API ===================== */
function needStudent_(tok) {
  var sid = session_(tok, 'student');
  if (!sid) throw userErr_('กรุณายืนยันตัวตนอีกครั้ง', 'AUTH');
  return sid;
}
function meData_(sid) {
  var s = studentRow_(sid);
  if (!s) throw userErr_('ไม่พบข้อมูลนักเรียน', 'AUTH');
  var reqs = rows_('REQ').filter(function (r) { return String(r.sid) === sid; }).map(pubReq_)
    .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
  return { student: pubStudent_(s), requests: reqs, config: config_() };
}
function verify_(b) {
  var sid = String(b.sid || '').replace(/\D/g, ''), nid = String(b.nid || '').replace(/\D/g, '');
  if (!/^\d{5}$/.test(sid)) throw userErr_('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก');
  if (!nidOk_(nid)) throw userErr_('เลขประจำตัวประชาชนไม่ถูกต้อง ลองตรวจทีละหลักอีกครั้ง');
  var c = cache_(), fk = 'fail|' + sid, fails = +(c.get(fk) || 0);
  if (fails >= 5) throw userErr_('ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
  var s = studentRow_(sid);
  if (!s || !s.nidHash || String(s.nidHash) !== nidHash_(nid)) {
    c.put(fk, String(fails + 1), 900);
    throw userErr_('รหัสนักเรียนหรือเลขประจำตัวประชาชนไม่ตรงกับข้อมูลในทะเบียน ถ้ามั่นใจว่าถูกต้อง กรุณาติดต่อครูปรางทอง หรือใช้ใบคำร้องกระดาษในลิ้นชักที่ 1');
  }
  c.remove(fk);
  var tok = lock_(function () { return createSession_('student', sid, b.remember ? 24 * 30 : 6); });
  var res = meData_(sid);
  res.token = tok;
  return res;
}
function me_(b) { return meData_(needStudent_(b.token)); }

function validateReq_(p, s) {
  var pp1 = clampInt_(p.pp1, 0, 2), pp7 = clampInt_(p.pp7, 0, 2);
  // ปพ.6: 1 ภาคเรียน = 1 แผ่น ต้องเป็นภาคเรียนที่ผลการเรียนเข้า SGS แล้ว และอยู่ในช่วงชั้นปัจจุบัน
  // ม.ต้น (ม.1-3) ขอได้ตั้งแต่ ม.1 ภาคเรียนที่ 1 · ม.ปลาย (ม.4-6) ขอได้ตั้งแต่ ม.4 ภาคเรียนที่ 1
  var yr = parseInt(sv_('year'), 10) || 0, maxK = semKey_(sv_('latest')), lv = parseInt(s && s.level, 10) || 0;
  var minK = lv >= 1 && lv <= 6 ? (yr - (lv - (lv >= 4 ? 4 : 1))) * 10 + 1 : (yr - 5) * 10 + 1, seen = {}, sems = [];
  (Array.isArray(p.pp6Sems) ? p.pp6Sems : []).slice(0, 20).forEach(function (x) {
    x = str_(x, 10); var k = semKey_(x);
    if (!k || k > maxK || k < minK || !/^[12]\//.test(x)) throw userErr_('ภาคเรียนของ ปพ.6 ไม่ถูกต้อง กรุณาเลือกใหม่');
    if (!seen[x]) { seen[x] = true; sems.push(x); }
  });
  sems.sort(function (a, b) { return semKey_(a) - semKey_(b); });
  if (pp1 + pp7 + sems.length < 1) throw userErr_('เลือกเอกสารอย่างน้อย 1 ชนิด');
  var scope = '';
  if (pp1) {
    scope = str_(p.scope, 10);
    var allowed = [sv_('latest')];
    if (pendingSem_()) allowed.push(pendingSem_());
    if (allowed.indexOf(scope) < 0) throw userErr_('ช่วงผลการเรียนไม่ถูกต้อง กรุณาเลือกใหม่');
  }
  var lang = pp1 && p.lang === 'en' && bool_('allowEnglish') ? 'en' : 'th';
  var purpose = str_(p.purpose, 40);
  if (PURPOSES.indexOf(purpose) < 0) throw userErr_('เลือกวัตถุประสงค์ของการขอเอกสาร');
  var other = purpose === 'อื่น ๆ' ? str_(p.other, 120) : '';
  if (purpose === 'อื่น ๆ' && !other) throw userErr_('ระบุวัตถุประสงค์ของการขอเอกสาร');
  var needBy = str_(p.needBy, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(needBy)) needBy = '';
  var phone = String(p.phone || '').replace(/\D/g, '');
  if (!/^0\d{9}$/.test(phone)) throw userErr_('เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0');
  var ch = {}, src = p.changes || {};
  ['name', 'dob', 'fa', 'mo'].forEach(function (k) {
    var c = src[k];
    if (!c || !s) return;
    var reason = str_(c.reason, 60);
    if (REASONS[k].indexOf(reason) < 0) throw userErr_('เลือกเหตุผลที่ขอแก้ไขข้อมูลให้ครบ');
    if (k === 'name') {
      var to = { pre: str_(c.to && c.to.pre, 20), fn: str_(c.to && c.to.fn, 60), ln: str_(c.to && c.to.ln, 60) };
      if (PREFIXES.indexOf(to.pre) < 0 || !to.fn || !to.ln) throw userErr_('กรอกชื่อ-สกุลที่ขอแก้ไขให้ครบ');
      ch.name = { from: { pre: String(s.prefix), fn: String(s.fname), ln: String(s.lname) }, to: to, reason: reason };
    } else {
      var t = str_(c.to, 120);
      if (!t && reason.indexOf('ไม่มีข้อมูล') < 0) throw userErr_('กรอกข้อมูลที่ขอแก้ไขให้ครบ');
      var from = k === 'dob' ? String(s.dob) : String(k === 'fa' ? s.father : s.mother);
      ch[k] = { from: from, to: t, reason: reason };
    }
  });
  return { pp1: pp1, pp7: pp7, pp6: sems.length, pp6Sems: sems.join(','), scope: scope, lang: lang, purpose: purpose, other: other, needBy: needBy, phone: phone, changes: ch };
}
function nextNo_() {
  var n = int_('nextNo', 1);
  setSv_('nextNo', n + 1);
  return String(n).padStart(4, '0');
}
function newRequest_(s, v, channel, who, manual) {
  var now = new Date();
  var r = {
    no: nextNo_(), year: sv_('year'), sid: s ? String(s.sid) : String(manual.sid),
    name: s ? fullName_(s) : fullName_(manual), cls: s ? s.level + '/' + s.room : manual.level + '/' + manual.room,
    pp1: v.pp1, scope: v.scope, lang: v.lang, pp7: v.pp7, pp6: v.pp6, pp6Sems: v.pp6Sems, purpose: v.purpose, other: v.other, needBy: v.needBy,
    phone: v.phone, changes: JSON.stringify(v.changes), channel: channel, submittedAt: now,
    photoDue: '', reprint: 0, fixCount: 0, createdBy: who, updatedAt: now
  };
  if (photosOf_(r) > 0) { r.photoDue = new Date(now.getTime() + int_('photoDays', 7) * 864e5); setStatus_(r, 'photo'); }
  else setStatus_(r, 'work');
  add_('REQ', r);
  log_(r.no, who, 'ยื่นคำร้อง', (channel === 'online' ? 'ยื่นผ่านระบบออนไลน์' : 'บันทึกจากใบคำร้องกระดาษ' + (s ? '' : ' (ไม่พบในทะเบียน)')) + (photosOf_(r) ? '' : ' · ไม่ต้องใช้รูปถ่าย'));
  return r;
}
function submit_(b) {
  var sid = needStudent_(b.token);
  if (!bool_('open')) throw userErr_('ขณะนี้ปิดรับคำร้องออนไลน์ชั่วคราว');
  var s = studentRow_(sid);
  if (!s) throw userErr_('ไม่พบข้อมูลนักเรียน', 'AUTH');
  var v = validateReq_(b.req || {}, s);
  var r = lock_(function () {
    var now = new Date();
    var mine = rows_('REQ').filter(function (x) { return String(x.sid) === sid; });
    var today = mine.filter(function (x) { return x.submittedAt instanceof Date && (now - x.submittedAt) < 864e5; }).length;
    if (today >= 3) throw userErr_('ยื่นคำร้องได้ไม่เกิน 3 ครั้งต่อวัน');
    if (mine.filter(function (x) { return OPEN.indexOf(String(x.status)) > -1; }).length >= 3) throw userErr_('มีคำร้องที่ยังไม่ปิด 3 รายการแล้ว กรุณารอให้เสร็จก่อน');
    return newRequest_(s, v, 'online', 'นักเรียน');
  });
  return { request: pubReq_(r) };
}
function studentCancel_(b) {
  var sid = needStudent_(b.token);
  return lock_(function () {
    var r = reqBy_(b.no);
    if (!r || String(r.sid) !== sid) throw userErr_('ไม่พบคำร้องนี้');
    if (!(r.status === 'photo' || (r.status === 'work' && photosOf_(r) === 0))) throw userErr_('ยกเลิกเองได้เฉพาะคำร้องที่ยังไม่ได้ส่งรูปถ่ายหรือยังไม่เริ่มจัดทำ ถ้าต้องการยกเลิก กรุณาติดต่อครูปรางทอง');
    setStatus_(r, 'cancel'); r.doneAt = new Date(); put_('REQ', r);
    log_(r.no, 'นักเรียน', 'ยกเลิกคำร้อง', '');
    return { request: pubReq_(r) };
  });
}
function received_(b) {
  var sid = needStudent_(b.token);
  return lock_(function () {
    var r = reqBy_(b.no);
    if (!r || String(r.sid) !== sid) throw userErr_('ไม่พบคำร้องนี้');
    if (r.status !== 'ready') throw userErr_('คำร้องนี้ยังไม่อยู่ในสถานะพร้อมรับ');
    var rating = clampInt_(b.rating, 0, 5);
    setStatus_(r, 'done'); r.doneAt = new Date(); r.rating = rating || ''; put_('REQ', r);
    log_(r.no, 'นักเรียน', 'ยืนยันรับเอกสาร', rating ? 'ให้คะแนน ' + rating + ' จาก 5' : '');
    return { request: pubReq_(r) };
  });
}

/* ===================== Admin auth ===================== */
function users_() { return rows_('USR'); }
function login_(b) {
  var u = str_(b.username, 40).toLowerCase(), pw = String(b.password || '');
  var c = cache_(), fk = 'afail|' + u, fails = +(c.get(fk) || 0);
  if (fails >= 5) throw userErr_('ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
  var user = users_().filter(function (x) { return String(x.username).toLowerCase() === u; })[0];
  function bad() { c.put(fk, String(fails + 1), 900); return userErr_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); }
  if (!user || String(user.active).toUpperCase() !== 'TRUE' || !pw) throw bad();
  if (!user.passHash) {
    if (user.tempPassword && pw === String(user.tempPassword)) {
      c.remove(fk);
      var st = newToken_();
      c.put('setup|' + sha_(st), u, 900);
      return { setup: true, setupToken: st, displayName: String(user.displayName) };
    }
    throw bad();
  }
  if (pwHash_(pw, String(user.salt)) !== String(user.passHash)) throw bad();
  c.remove(fk);
  return lock_(function () {
    user.lastLogin = new Date(); put_('USR', user);
    log_('', String(user.displayName), 'เข้าสู่ระบบหลังบ้าน', '');
    return { token: createSession_('admin', u, 12), user: { username: u, displayName: String(user.displayName), role: String(user.role) } };
  });
}
function setPassword_(b) {
  var c = cache_(), key = 'setup|' + sha_(String(b.setupToken || '')), u = c.get(key);
  if (!u) throw userErr_('หมดเวลาตั้งรหัสผ่าน กรุณาเข้าสู่ระบบด้วยรหัสผ่านชั่วคราวอีกครั้ง');
  var pw = String(b.newPassword || '');
  if (pw.length < 8) throw userErr_('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร');
  return lock_(function () {
    var user = users_().filter(function (x) { return String(x.username).toLowerCase() === u; })[0];
    if (!user) throw userErr_('ไม่พบผู้ใช้');
    user.salt = newToken_().slice(0, 24); user.passHash = pwHash_(pw, user.salt); user.tempPassword = ''; user.lastLogin = new Date();
    put_('USR', user);
    c.remove(key);
    log_('', String(user.displayName), 'ตั้งรหัสผ่านใหม่', '');
    return { token: createSession_('admin', u, 12), user: { username: u, displayName: String(user.displayName), role: String(user.role) } };
  });
}
function needAdmin_(b) {
  var u = session_(b.token, 'admin');
  if (!u) throw userErr_('กรุณาเข้าสู่ระบบอีกครั้ง', 'AUTH');
  var user = users_().filter(function (x) { return String(x.username).toLowerCase() === u; })[0];
  if (!user || String(user.active).toUpperCase() !== 'TRUE') throw userErr_('บัญชีนี้ถูกปิดการใช้งาน', 'AUTH');
  return { username: u, displayName: String(user.displayName), role: String(user.role) };
}

/* ===================== Admin API ===================== */
function settingsObj_() {
  var s = settings_(), o = {};
  Object.keys(s).forEach(function (k) { if (k !== 'stagingOpen') o[k] = s[k].value; });
  return o;
}
function adminList_(b) {
  var me = needAdmin_(b), now = new Date();
  var stu = studentsMap_();
  var list = rows_('REQ').filter(function (r) {
    if (OPEN.indexOf(String(r.status)) > -1) return true;
    var t = r.doneAt instanceof Date && r.doneAt.getTime() > 0 ? r.doneAt : r.updatedAt;
    return t instanceof Date && (now - t) < 45 * 864e5;
  });
  var nos = {};
  list.forEach(function (r) { nos[String(r.no)] = true; });
  var logs = {};
  rows_('LOG').forEach(function (l) {
    var k = String(l.no);
    if (!nos[k]) return;
    (logs[k] = logs[k] || []).push({ t: iso_(l.time), who: String(l.who), action: String(l.action), detail: String(l.detail) });
  });
  var out = list.map(function (r) {
    var o = adminReq_(r), s = stu[String(r.sid)];
    o.student = s ? pubStudent_(s) : null;
    o.log = logs[String(r.no)] || [];
    return o;
  });
  return { requests: out, config: config_(), settings: settingsObj_(), me: me, fixReasons: FIX, students: Object.keys(stu).length, serverTime: iso_(now) };
}
function canDo_(r, act) {
  var s = String(r.status);
  switch (act) {
    case 'recv': return s === 'photo';
    case 'sign': return s === 'work';
    case 'ready': return s === 'sign';
    case 'staffdone': return s === 'ready';
    case 'resume': return s === 'fix';
    case 'cancel': return OPEN.indexOf(s) > -1;
    case 'reopen': return s === 'cancel' || s === 'expired';
    case 'reprint': return true;
  }
  return false;
}
var ACT_TEXT = { recv: 'ได้รับรูปถ่ายแล้ว', sign: 'เสนอผู้บริหารลงนาม', ready: 'พร้อมรับ', staffdone: 'บันทึกว่านักเรียนรับเอกสารแล้ว', resume: 'นักเรียนแก้ไขแล้ว ดำเนินการต่อ', cancel: 'ยกเลิกคำร้อง', reopen: 'เปิดคำร้องอีกครั้ง', reprint: 'บันทึกการพิมพ์เอกสารใหม่' };
function doAct_(r, act) {
  var now = new Date(), detail = '';
  if (act === 'recv') {
    r.photoAt = now;
    if (needsHold_(r)) { setStatus_(r, 'hold'); detail = 'พักรอผลการเรียน ' + r.scope; } else setStatus_(r, 'work');
  } else if (act === 'sign') { r.signAt = now; setStatus_(r, 'sign'); }
  else if (act === 'ready') { r.readyAt = now; setStatus_(r, 'ready'); detail = 'ลิ้นชัก ม.' + String(r.cls).split('/')[0]; }
  else if (act === 'staffdone') { r.doneAt = now; setStatus_(r, 'done'); }
  else if (act === 'resume') {
    var back = String(r.resume || 'work');
    if (back === 'photo' || (photosOf_(r) > 0 && !r.photoAt)) setStatus_(r, 'photo');
    else if ((back === 'work' || back === 'hold') && needsHold_(r)) setStatus_(r, 'hold');
    else setStatus_(r, back === 'hold' ? 'work' : back);
    r.issueTodo = '';
  }
  else if (act === 'cancel') { r.doneAt = now; setStatus_(r, 'cancel'); }
  else if (act === 'reopen') {
    r.doneAt = '';
    if (photosOf_(r) > 0 && !r.photoAt) { r.photoDue = new Date(now.getTime() + int_('photoDays', 7) * 864e5); setStatus_(r, 'photo'); }
    else setStatus_(r, needsHold_(r) ? 'hold' : 'work');
  }
  else if (act === 'reprint') { r.reprint = (+r.reprint || 0) + 1; r.updatedAt = now; }
  return detail;
}
function adminAct_(b) {
  var me = needAdmin_(b), act = String(b.act || '');
  if (!ACT_TEXT[act]) throw userErr_('คำสั่งไม่ถูกต้อง');
  var nos = (Array.isArray(b.nos) ? b.nos : [b.no]).map(String).slice(0, 200);
  return lock_(function () {
    var all = rows_('REQ'), done = [], skipped = [], logs = [];
    nos.forEach(function (no) {
      var r = all.filter(function (x) { return String(x.no) === no; })[0];
      if (!r || !canDo_(r, act)) { skipped.push(no); return; }
      var d = doAct_(r, act);
      put_('REQ', r);
      logs.push({ time: new Date(), no: no, who: me.displayName, action: ACT_TEXT[act], detail: d });
      done.push(no);
    });
    addMany_('LOG', logs);
    return { done: done, skipped: skipped };
  });
}
function adminFix_(b) {
  var me = needAdmin_(b);
  var idx = clampInt_(b.reason, 0, FIX.length - 1), fx = FIX[idx], text = str_(b.text, 300);
  if (!fx.todo && !text) throw userErr_('เหตุผล "อื่น ๆ" ต้องพิมพ์ข้อความถึงนักเรียน');
  return lock_(function () {
    var r = reqBy_(b.no);
    if (!r) throw userErr_('ไม่พบคำร้อง');
    if (OPEN.indexOf(String(r.status)) < 0 || r.status === 'fix') throw userErr_('ส่งกลับได้เฉพาะคำร้องที่ยังดำเนินการอยู่');
    r.resume = r.status; r.fixAt = new Date(); r.issueReason = fx.r; r.issueTodo = fx.todo; r.issueText = text;
    r.fixCount = (+r.fixCount || 0) + 1;
    setStatus_(r, 'fix'); put_('REQ', r);
    log_(r.no, me.displayName, 'ส่งกลับให้แก้ไข', fx.r + (text ? ': ' + text : ''));
    return {};
  });
}
function adminNote_(b) {
  needAdmin_(b);
  return lock_(function () {
    var r = reqBy_(b.no);
    if (!r) throw userErr_('ไม่พบคำร้อง');
    r.note = str_(b.note, 500); r.updatedAt = new Date(); put_('REQ', r);
    return {};
  });
}
var SETTING_RULES = {
  open: 'bool', allowEnglish: 'bool', announce: 'text300', latest: 'sem', pending: 'sem0',
  photoDays: 'int1-30', workMin: 'int1-30', workMax: 'int1-30', autoCloseDays: 'int3-90',
  holidays: 'text4000', staffName: 'text80', registrarName: 'text80', approverName: 'text80', approverTitle: 'text80'
};
function adminSaveSettings_(b) {
  var me = needAdmin_(b), patch = b.patch || {};
  return lock_(function () {
    var changed = [];
    Object.keys(patch).forEach(function (k) {
      var rule = SETTING_RULES[k];
      if (!rule) return;
      var v = patch[k];
      if (rule === 'bool') v = v === true || String(v).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
      else if (rule === 'sem') { v = str_(v, 10); if (!semKey_(v)) throw userErr_('ภาคเรียนต้องอยู่ในรูปแบบ ภาค/ปี เช่น 2/2568'); }
      else if (rule === 'sem0') { v = str_(v, 10); if (v && !semKey_(v)) throw userErr_('ภาคเรียนต้องอยู่ในรูปแบบ ภาค/ปี เช่น 1/2569 หรือเว้นว่าง'); }
      else if (rule.indexOf('int') === 0) { var m = rule.match(/int(\d+)-(\d+)/); v = String(clampInt_(v, +m[1], +m[2])); }
      else if (rule === 'holidays' || rule === 'text4000') v = String(v || '').slice(0, 4000);
      else { var mx = +rule.replace('text', ''); v = k === 'announce' ? String(v || '').trim().slice(0, mx) : str_(v, mx); }
      if (sv_(k) !== v) { setSv_(k, v); changed.push(k); }
    });
    var released = 0;
    if (changed.indexOf('latest') > -1) {
      var logs = [];
      rows_('REQ').forEach(function (r) {
        if (r.status === 'hold' && !needsHold_(r)) {
          setStatus_(r, 'work'); put_('REQ', r); released++;
          logs.push({ time: new Date(), no: String(r.no), who: 'ระบบ', action: 'ผลการเรียนเข้าระบบแล้ว', detail: 'ดำเนินการต่อ (ผลถึง ' + sv_('latest') + ')' });
        }
      });
      addMany_('LOG', logs);
    }
    if (changed.length) log_('', me.displayName, 'แก้ไขตั้งค่า', changed.join(', '));
    return { settings: settingsObj_(), config: config_(), released: released, changed: changed };
  });
}
function adminFindStudent_(b) {
  needAdmin_(b);
  var sid = String(b.sid || '').replace(/\D/g, '');
  var s = /^\d{5}$/.test(sid) ? studentRow_(sid) : null;
  var open = rows_('REQ').filter(function (r) { return String(r.sid) === sid && OPEN.indexOf(String(r.status)) > -1; }).map(function (r) { return String(r.no); });
  return { student: s ? pubStudent_(s) : null, open: open };
}
function adminCreate_(b) {
  var me = needAdmin_(b);
  var sid = String(b.sid || '').replace(/\D/g, '');
  if (!/^\d{4,6}$/.test(sid)) throw userErr_('รหัสนักเรียนไม่ถูกต้อง');
  var s = studentRow_(sid), manual = null;
  if (!s) {
    var m = b.manual || {};
    manual = { sid: sid, prefix: str_(m.prefix, 20), fname: str_(m.fname, 60), lname: str_(m.lname, 60), level: str_(m.level, 2), room: str_(m.room, 3) };
    if (PREFIXES.indexOf(manual.prefix) < 0 || !manual.fname || !manual.lname || !/^[1-6]$/.test(manual.level) || !/^\d{1,2}$/.test(manual.room)) throw userErr_('ไม่พบรหัสนี้ในทะเบียน กรุณากรอกคำนำหน้า ชื่อ นามสกุล ชั้น และห้องให้ครบ');
  }
  var v = validateReq_(b.req || {}, s);
  var r = lock_(function () { return newRequest_(s, v, 'paper', me.displayName, manual); });
  return { request: adminReq_(r) };
}
function adminReport_(b) {
  needAdmin_(b);
  var hol = {};
  holidays_().forEach(function (h) { hol[h.d] = true; });
  var all = rows_('REQ'), byStatus = {}, byLevel = {}, byMonth = {}, fixes = {}, chan = { online: 0, paper: 0 };
  var durs = [], ratings = [], within = 0, maxW = int_('workMax', 5), reprint = 0, pp1 = 0, pp7 = 0, pp6 = 0;
  all.forEach(function (r) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    var lv = String(r.cls).split('/')[0];
    byLevel[lv] = byLevel[lv] || { n: 0, pp1: 0, pp7: 0, pp6: 0 };
    byLevel[lv].n++; byLevel[lv].pp1 += +r.pp1 || 0; byLevel[lv].pp7 += +r.pp7 || 0; byLevel[lv].pp6 += +r.pp6 || 0;
    pp1 += +r.pp1 || 0; pp7 += +r.pp7 || 0; pp6 += +r.pp6 || 0;
    if (r.submittedAt instanceof Date) { var m = Utilities.formatDate(r.submittedAt, 'Asia/Bangkok', 'yyyy-MM'); byMonth[m] = (byMonth[m] || 0) + 1; }
    chan[String(r.channel) === 'paper' ? 'paper' : 'online']++;
    if (r.issueReason && +r.fixCount) fixes[r.issueReason] = (fixes[r.issueReason] || 0) + (+r.fixCount);
    var start = r.photoAt instanceof Date ? r.photoAt : (photosOf_(r) === 0 && r.submittedAt instanceof Date ? r.submittedAt : null);
    if (start && r.readyAt instanceof Date && r.readyAt > start) {
      var d = workBetween_(start, r.readyAt, hol); durs.push(d); if (d <= maxW) within++;
    }
    if (+r.rating) ratings.push(+r.rating);
    reprint += +r.reprint || 0;
  });
  var avg = function (a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length * 100) / 100 : null; };
  return {
    total: all.length, byStatus: byStatus, byLevel: byLevel, byMonth: byMonth, fixes: fixes, channel: chan,
    avgWorkdays: avg(durs), withinPct: durs.length ? Math.round(within / durs.length * 100) : null, timedCount: durs.length,
    avgRating: avg(ratings), ratingCount: ratings.length, reprint: reprint, pp1: pp1, pp7: pp7, pp6: pp6, workMax: maxW
  };
}
function workBetween_(a, b, hol) {
  var tz = 'Asia/Bangkok';
  var x = new Date(Utilities.formatDate(a, tz, 'yyyy-MM-dd') + 'T12:00:00Z');
  var e = new Date(Utilities.formatDate(b, tz, 'yyyy-MM-dd') + 'T12:00:00Z');
  var n = 0;
  while (x < e) {
    x = new Date(x.getTime() + 864e5);
    var w = x.getUTCDay(), key = Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd');
    if (w !== 0 && w !== 6 && !hol[key]) n++;
  }
  return n;
}

/* ===================== Import from SGS (staging) ===================== */
function stage_(b) {
  if (!bool_('stagingOpen')) throw userErr_('ปิดรับการนำเข้ารายชื่ออยู่');
  var rows = b.rows, batch = str_(b.batch, 40);
  if (!batch || !Array.isArray(rows) || rows.length > 800) throw userErr_('ข้อมูลนำเข้าไม่ถูกต้อง');
  return lock_(function () {
    var now = new Date(), out = [], bad = 0;
    rows.forEach(function (x) {
      var sid = String(x.sid || '').replace(/\D/g, ''), nid = String(x.nid || '').replace(/\D/g, '');
      if (!/^\d{4,6}$/.test(sid)) { bad++; return; }
      var ok = nidOk_(nid);
      if (!ok) bad++;
      out.push({
        sid: sid, nidHash: ok ? nidHash_(nid) : '', prefix: str_(x.prefix, 20), fname: str_(x.fname, 60), lname: str_(x.lname, 60),
        dob: /^\d{4}-\d{2}-\d{2}$/.test(String(x.dob)) ? String(x.dob) : '', father: str_(x.father, 120), mother: str_(x.mother, 120),
        level: str_(x.level, 2), room: str_(x.room, 3), no: str_(x.no, 3), updatedAt: now, batch: batch
      });
    });
    addMany_('STG', out);
    return { staged: out.length, invalid: bad };
  });
}
function stageCommit_(b) {
  if (!bool_('stagingOpen')) throw userErr_('ปิดรับการนำเข้ารายชื่ออยู่');
  var batch = str_(b.batch, 40), total = +b.total || 0;
  return lock_(function () {
    var st = rows_('STG').filter(function (x) { return String(x.batch) === batch; });
    if (!st.length || st.length !== total) throw userErr_('จำนวนรายการไม่ตรง: ได้รับ ' + st.length + ' จาก ' + total);
    var map = {};
    st.forEach(function (x) { map[String(x.sid)] = x; });
    var list = Object.keys(map).sort().map(function (k) { var o = map[k]; delete o.batch; delete o._row; return o; });
    var stu = sh_('STU');
    if (stu.getLastRow() > 1) stu.getRange(2, 1, stu.getLastRow() - 1, COLS.STU.length).clearContent();
    addMany_('STU', list);
    var sg = sh_('STG');
    if (sg.getLastRow() > 1) sg.getRange(2, 1, sg.getLastRow() - 1, COLS.STG.length).clearContent();
    setSv_('stagingOpen', 'FALSE');
    log_('', 'ระบบ', 'นำเข้ารายชื่อนักเรียนจาก SGS', list.length + ' คน');
    return { students: list.length };
  });
}
function openStaging() { _set = null; setSv_('stagingOpen', 'TRUE'); }

/* ===================== Maintenance ===================== */
function dailyJob() {
  lock_(function () {
    var now = new Date(), logs = [], auto = int_('autoCloseDays', 14), keep = int_('retentionDays', 400);
    rows_('REQ').forEach(function (r) {
      if (r.status === 'photo' && r.photoDue instanceof Date && now > r.photoDue) {
        setStatus_(r, 'expired'); r.doneAt = now; put_('REQ', r);
        logs.push({ time: now, no: String(r.no), who: 'ระบบ', action: 'คำร้องหมดอายุ', detail: 'ไม่ได้รับรูปถ่ายภายในกำหนด' });
      } else if (r.status === 'ready' && r.readyAt instanceof Date && (now - r.readyAt) > auto * 864e5) {
        setStatus_(r, 'done'); r.doneAt = now; put_('REQ', r);
        logs.push({ time: now, no: String(r.no), who: 'ระบบ', action: 'ปิดคำร้องอัตโนมัติ', detail: 'พร้อมรับเกิน ' + auto + ' วัน' });
      } else if (OPEN.indexOf(String(r.status)) < 0 && r.doneAt instanceof Date && r.doneAt.getTime() > 0 && (now - r.doneAt) > keep * 864e5 && r.name !== '(ลบข้อมูลแล้ว)') {
        r.name = '(ลบข้อมูลแล้ว)'; r.phone = ''; r.changes = ''; r.note = ''; r.other = ''; r.issueText = ''; put_('REQ', r);
      }
    });
    addMany_('LOG', logs);
    var ses = sh_('SES'), live = rows_('SES').filter(function (x) { return x.expires instanceof Date && x.expires > now; });
    if (ses.getLastRow() > 1) ses.getRange(2, 1, ses.getLastRow() - 1, COLS.SES.length).clearContent();
    addMany_('SES', live);
  });
}

/* ===================== Setup ===================== */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SS_ID'), ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else { ss = SpreadsheetApp.create('ระบบคำร้อง ปพ. งานทะเบียน (ฐานข้อมูล)'); props.setProperty('SS_ID', ss.getId()); }
  _ss = ss; _set = null;
  ss.setSpreadsheetTimeZone('Asia/Bangkok');
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', newToken_() + newToken_());
  var order = ['REQ', 'STU', 'LOG', 'SET', 'USR', 'STG', 'SES'];
  order.forEach(function (k) {
    var sh = ss.getSheetByName(SHEETS[k]) || ss.insertSheet(SHEETS[k]);
    var cols = COLS[k];
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[1]; })])
      .setFontWeight('bold').setBackground('#3A1468').setFontColor('#FFFFFF').setWrap(true);
    sh.setFrozenRows(1);
    textFormat_(sh, cols, 2, sh.getMaxRows() - 1);
  });
  ['Sheet1', 'ชีต1', 'แผ่นงาน1'].forEach(function (n) { var s1 = ss.getSheetByName(n); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1); });
  var s = settings_();
  var add = DEFAULTS.filter(function (d) { return !s[d[0]]; }).map(function (d) { return { key: d[0], value: d[1], desc: d[2] }; });
  addMany_('SET', add);
  _set = null;
  if (rows_('USR').length === 0) {
    addMany_('USR', [
      { username: 'noppol', displayName: 'ครูนพพล ภาณุสุวัฒน์', role: 'admin', active: 'TRUE' },
      { username: 'prangthong', displayName: 'ครูปรางทอง จันทคาม', role: 'staff', active: 'TRUE' },
      { username: 'prapaporn', displayName: 'ครูประภาภรณ์ พรมศรี', role: 'staff', active: 'TRUE' }
    ]);
  }
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyJob'; });
  if (!has) ScriptApp.newTrigger('dailyJob').timeBased().atHour(6).everyDays(1).inTimezone('Asia/Bangkok').create();
  Logger.log('ฐานข้อมูล: ' + ss.getUrl());
  return ss.getUrl();
}
