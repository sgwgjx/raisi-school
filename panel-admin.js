/* ============================================================
   پنل مدیریت ← بخش «پنل دانش‌آموزی»
   دانش‌آموزان · آزمون آنلاین · کلاس مجازی · منابع آموزشی · تقویم
   این فایل بعد از script.js اجرا می‌شود و به پنل مدیریت موجود وصل می‌شود.
   داده‌ها در Supabase (جدول‌های students / panel_exams / panel_content) و
   فایل‌ها در Storage (باکت panel-files) ذخیره می‌شوند — فایل SQL را حتماً اجرا کنید.
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('atab-stu')) return;

  var BUCKET = 'panel-files';
  var MAX_FILE = 50 * 1024 * 1024;
  var MAX_IMG = 5 * 1024 * 1024;
  var TABS = ['stu', 'oexam', 'vcls', 'res', 'pcal', 'adm'];
  var PRESETS = ['گوگل میت', 'اسکای‌روم', 'شاد', 'ادوبی کانکت', 'بیگ‌بلوباتن', 'زوم', 'ایتا', 'بله'];
  var RES_KINDS = ['جزوه', 'کتاب', 'نمونه سؤال', 'ویدئو', 'سایر'];
  var EV_KINDS = [['ev', 'رویداد'], ['info', 'اطلاعیه'], ['hol', 'تعطیلی']];
  var FILE_EXT = /\.(pdf|docx?|pptx?|xlsx?|txt|zip|rar|7z|jpe?g|png|gif|webp|mp4|webm|mp3|m4a)$/i;
  var IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;

  var PA = window.PanelAdmin = {
    ready: false, dirty: false, uploading: 0,
    content: { vcls: [], resources: [], events: [] },
    exams: [], serverExams: {}, delExams: [], delFiles: [],
    students: [], stuFilter: { cls: '', q: '' }, stuForm: null,
    lastResults: {}, admins: [], adminsErr: '', admForm: false, studentsErr: ''
  };

  /* ---------------- ابزارهای کوچک ---------------- */
  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function val(root, sel) { var el = root.querySelector(sel); return el ? String(el.value) : ''; }
  function nd(s) { return faToEn(String(s == null ? '' : s)).trim(); }               // ارقام فارسی → انگلیسی
  function nf(s) { return String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase(); }
  function isUrl(u) { return /^https?:\/\/\S+$/i.test(u); }
  function fileUrl(p) { return SB.url + '/storage/v1/object/public/' + BUCKET + '/' + p; }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function validNid(v) {
    if (!/^\d{10}$/.test(v) || /^(\d)\1{9}$/.test(v)) return false;
    var s = 0, i;
    for (i = 0; i < 9; i++) s += (+v[i]) * (10 - i);
    var r = s % 11, k = +v[9];
    return r < 2 ? k === r : k === 11 - r;
  }
  function clsOf(id) { return adminClassById(id); }
  function clsName(id) { var c = clsOf(id); return c ? c.name : (id || '—'); }
  function gradeOfClass(id) {
    var c = clsOf(id);
    if (c) return Number(c.grade);
    var g = Number(String(id || '').split('-')[0]);
    return g >= 7 && g <= 9 ? g : 7;
  }
  function todayParts() { return adminTodayParts(); }

  /* تاریخ شمسی ↔ لحظهٔ دقیق (ساعت تهران، ثابت +۳:۳۰) */
  function j2g(jy, jm, jd) {
    jy += 1595;
    var days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + jd +
      ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
    var gy = 400 * Math.floor(days / 146097); days %= 146097;
    if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
    gy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    var gd = days + 1, gm;
    var sal = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (gm = 0; gm < 13; gm++) { var v = sal[gm]; if (gd <= v) break; gd -= v; }
    return [gy, gm, gd];
  }
  function jToIso(y, m, d, hh, mm) {
    var g = j2g(y, m, d);
    return new Date(Date.UTC(g[0], g[1] - 1, g[2], hh, mm) - 210 * 60000).toISOString();
  }
  function tehranParts(iso) {
    try {
      var p = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
        timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date(iso));
      var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
      return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute };
    } catch (e) {
      var t = todayParts(); return { y: t.y, m: t.m, d: t.d, hh: 8, mm: 0 };
    }
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- ارتباط با سرور (با نشست مدیر) ---------------- */
  function api(path, opt) {
    opt = opt || {};
    return SB.ensureToken().then(function (token) {
      var h = { apikey: SB.key, Authorization: 'Bearer ' + token };
      if (!opt.raw) h['Content-Type'] = 'application/json';
      if (opt.prefer) h['Prefer'] = opt.prefer;
      if (opt.headers) for (var k in opt.headers) h[k] = opt.headers[k];
      return fetch(SB.url + path, { method: opt.method || 'GET', headers: h, body: opt.body });
    });
  }
  function apiJson(path, opt) {
    return api(path, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          var er = new Error((j && (j.message || j.error || j.msg)) || ('http ' + r.status));
          er.status = r.status; er.code = j && j.code; throw er;
        }
        return j;
      });
    });
  }
  function errMsg(e) {
    var m = String((e && e.message) || ''), s = e && e.status;
    var c = e && e.code;
    // نشست واقعاً منقضی شده (توکن مدیر نامعتبر/منقضی است)
    if (m === 'not-logged-in' || m === 'session-expired' || (s === 401 && /JWT|token|expired/i.test(m) && c !== '42501'))
      return 'نشست ورود منقضی شده؛ دوباره وارد پنل شوید.';
    // نشست سالم است ولی دیتابیس دسترسی مدیر به جدول/تابع را نمی‌دهد (GRANT / سیاست RLS)
    if (c === '42501' || s === 401 || s === 403 || m === 'forbidden' || /permission denied|row-level security|not allowed/i.test(m))
      return 'دیتابیس اجازهٔ دسترسی مدیر به جدول‌های پنل دانش‌آموزی را نمی‌دهد (' + m + ')؛ فایل fix-access.sql را یک‌بار در Supabase ← SQL Editor اجرا کنید.';
    if (/admin_(list|create|set|delete)_admin|admin_users/i.test(m))
      return 'بخش مدیران هنوز فعال نشده؛ فایل admin-users.sql را یک‌بار در Supabase ← SQL Editor اجرا کنید.';
    if (m === 'not_admin') return 'فقط مدیرها می‌توانند مدیران را مدیریت کنند.';
    if (m === 'bad_username') return 'نام کاربری باید ۳ تا ۳۰ نویسهٔ انگلیسی (حرف کوچک، عدد، _ یا .) باشد.';
    if (m === 'username_taken') return 'این نام کاربری قبلاً استفاده شده است.';
    if (m === 'short_admin_password') return 'رمز مدیر باید حداقل ۶ نویسه باشد.';
    if (m === 'cannot_delete_self') return 'نمی‌توانید حساب خودتان را حذف کنید.';
    if (m === 'cannot_delete_main') return 'مدیر اصلی قابل حذف نیست.';
    if (m === 'forbidden_main') return 'رمز مدیر اصلی را فقط خود او می‌تواند عوض کند.';
    if (s === 404 || /schema cache|does not exist|PGRST20/i.test(m))
      return 'جدول‌های پنل دانش‌آموزی هنوز ساخته نشده‌اند؛ فایل student-panel.sql را در Supabase (SQL Editor) اجرا کنید.';
    if (e && e.code === '23505' || /duplicate key|unique/i.test(m)) return 'این کد ملی قبلاً ثبت شده است.';
    if (m === 'bad_national_id') return 'کد ملی باید ۱۰ رقم باشد.';
    if (m === 'bad_name') return 'نام دانش‌آموز را وارد کنید.';
    if (m === 'short_password') return 'رمز باید حداقل ۴ نویسه باشد.';
    if (m === 'not_found') return 'این مورد دیگر وجود ندارد؛ فهرست را تازه کنید.';
    if (/Failed to fetch|NetworkError|abort/i.test(m)) return 'ارتباط با سرور برقرار نشد؛ اینترنت را بررسی کنید.';
    return 'انجام نشد: ' + m;
  }
  function setState(msg, isErr) {
    qsa('[data-pstate]').forEach(function (el) {
      el.hidden = !msg; el.textContent = msg || '';
      el.classList.toggle('err', !!isErr);
    });
  }

  /* ---------------- مخاطب (کل مدرسه / پایه / کلاس) ---------------- */
  function audHTML(aud) {
    aud = aud || { type: 'school' };
    return '<div class="adm-audwrap adm-row" data-mode="' + (aud.type || 'school') + '">' +
      '<label class="adm-field"><span>مخاطب</span><select class="adm-in adm-audtype">' +
      '<option value="school"' + (aud.type === 'school' || !aud.type ? ' selected' : '') + '>کل مدرسه</option>' +
      '<option value="grade"' + (aud.type === 'grade' ? ' selected' : '') + '>یک پایه</option>' +
      '<option value="class"' + (aud.type === 'class' ? ' selected' : '') + '>یک کلاس</option>' +
      '</select></label>' +
      '<label class="adm-field adm-audgrade"><span>پایه</span><select class="adm-in">' + adminGradeOptions(aud.grade) + '</select></label>' +
      '<label class="adm-field adm-audclass"><span>کلاس</span><select class="adm-in">' + adminClassOptions(aud.classId) + '</select></label>' +
      '</div>';
  }
  function readAud(card) {
    var w = card.querySelector('.adm-audwrap'); if (!w) return { type: 'school' };
    var t = w.querySelector('.adm-audtype').value;
    if (t === 'grade') return { type: 'grade', grade: Number(w.querySelector('.adm-audgrade select').value) };
    if (t === 'class') return { type: 'class', classId: w.querySelector('.adm-audclass select').value };
    return { type: 'school' };
  }
  /* ---------------- انتخاب ساعت (انتخاب‌گر ساده + دکمه‌های میان‌بر) ---------------- */
  function dayPart(h) { return h < 5 ? 'بامداد' : h < 12 ? 'صبح' : h < 16 ? 'بعدازظهر' : h < 19 ? 'عصر' : 'شب'; }
  function timeSumText(hh, mm, dur) {
    var end = hh * 60 + mm + (dur || 0), eh = Math.floor(end / 60) % 24, em = end % 60;
    return dayPart(hh) + ' · از ' + toFa(pad2(hh) + ':' + pad2(mm)) + ' تا ' + toFa(pad2(eh) + ':' + pad2(em)) +
      (end >= 1440 ? ' (فردا)' : '');
  }
  function timeField(e) {
    var h = '', m = '', k, mins = [];
    for (k = 0; k < 24; k++) h += '<option value="' + k + '"' + (k === e.hh ? ' selected' : '') + '>' + toFa(pad2(k)) + '</option>';
    for (k = 0; k < 60; k += 5) mins.push(k);
    if (mins.indexOf(e.mm) < 0) { mins.push(e.mm); mins.sort(function (a, b) { return a - b; }); }
    mins.forEach(function (v) { m += '<option value="' + v + '"' + (v === e.mm ? ' selected' : '') + '>' + toFa(pad2(v)) + '</option>'; });
    return '<div class="adm-field adm-timefield"><span>ساعت شروع</span>' +
      '<div class="adm-time" dir="ltr"><select class="adm-in adm-th" aria-label="ساعت">' + h + '</select>' +
      '<b>:</b><select class="adm-in adm-tm" aria-label="دقیقه">' + m + '</select></div>' +
      '<div class="adm-timesum">' + timeSumText(e.hh, e.mm, e.duration) + '</div></div>';
  }
  function updateTimeSum(card) {
    var th = card.querySelector('.adm-th'), tm = card.querySelector('.adm-tm'), du = card.querySelector('.adm-exdur'), el = card.querySelector('.adm-timesum');
    if (!th || !tm || !el) return;
    el.textContent = timeSumText(+th.value || 0, +tm.value || 0, Math.max(1, Math.min(600, Number(du && du.value) || 30)));
  }
  function dateRow(o) {
    return '<div class="adm-row">' +
      '<label class="adm-field"><span>روز</span><select class="adm-in adm-dD">' + adminDayOptions(o.y, o.m, o.d) + '</select></label>' +
      '<label class="adm-field"><span>ماه</span><select class="adm-in adm-dM">' + adminMonthOptions(o.m) + '</select></label>' +
      '<label class="adm-field"><span>سال</span><select class="adm-in adm-dY">' + adminYearOptions(o.y) + '</select></label>' +
      '</div>';
  }
  function delBtn(act, title) {
    return '<button type="button" class="adm-pdel" data-act="' + act + '" title="' + title + '" aria-label="' + title + '">' + icon('trash') + '</button>';
  }

  /* ============================================================
     بارگذاری از سرور
     ============================================================ */
  function normQ(q) {
    q = q || {};
    var o = arr(q.o).map(String); while (o.length < 4) o.push('');
    return { q: String(q.q || ''), o: o.slice(0, 6), a: (typeof q.a === 'number') ? q.a : -1, img: q.img || '' };
  }
  function fromRow(r) {
    var t = tehranParts(r.start_at);
    return {
      id: r.id, title: r.title || '', kind: r.kind === 'link' ? 'link' : 'online',
      aud: r.aud || { type: 'school' }, y: t.y, m: t.m, d: t.d, hh: t.hh, mm: t.mm,
      duration: r.duration || 30, descr: r.descr || '', url: r.url || '',
      questions: arr(r.questions).map(normQ)
    };
  }
  function fromResource(r) {
    var files = arr(r.files).filter(function (f) { return f && f.path; }).map(function (f) { return { path: f.path, fileName: f.fileName || '', size: f.size || 0 }; });
    if (!files.length && r.path) files = [{ path: r.path, fileName: r.fileName || '', size: r.size || 0 }];
    return {
      id: r.id || uid(), title: r.title || '', kind: r.kind || 'جزوه', subject: r.subject || '',
      mode: files.length ? 'file' : 'link', files: files,
      url: r.url || '', aud: r.aud || { type: 'school' }
    };
  }

  PA.load = function () {
    PA.ready = false;
    setState('در حال دریافت اطلاعات پنل دانش‌آموزی…', false);
    return Promise.all([
      apiJson('/rest/v1/panel_content?id=eq.main&select=data'),
      apiJson('/rest/v1/panel_exams?select=*&order=start_at.desc'),
      apiJson('/rest/v1/students?select=id,national_id,name,class_id,grade&order=grade.asc,class_id.asc,name.asc&limit=1000')
        .then(function (rows) { PA.studentsErr = ''; return rows; }, function (e) { PA.studentsErr = errMsg(e); return null; })
    ]).then(function (r) {
      var c = (r[0] && r[0][0] && r[0][0].data) || {};
      PA.content = {
        vcls: arr(c.vcls).map(function (v) { return { id: v.id || uid(), p: v.p || '', url: v.url || '', aud: v.aud || { type: 'school' } }; }),
        resources: arr(c.resources).map(fromResource),
        events: arr(c.events).map(function (e) {
          return { id: e.id || uid(), y: e.y, m: e.m, d: e.d, title: e.title || '', k: e.k || 'ev', aud: e.aud || { type: 'school' } };
        })
      };
      PA.exams = arr(r[1]).map(fromRow);
      PA.serverExams = {}; PA.exams.forEach(function (e) { PA.serverExams[e.id] = true; });
      if (r[2]) PA.students = arr(r[2]);
      PA.delExams = []; PA.delFiles = []; PA.dirty = false; PA.stuForm = null; PA.lastResults = {};
      PA.stuFilter = { cls: '', q: '' }; var se0 = $('admStuSearch'); if (se0) se0.value = '';
      PA.ready = true;
      setState('', false);
      PA.renderAll();
      loadAdmins();
    }).catch(function (e) {
      PA.ready = false;
      setState(errMsg(e), true);
    });
  };

  function loadStudents() {
    return apiJson('/rest/v1/students?select=id,national_id,name,class_id,grade&order=grade.asc,class_id.asc,name.asc&limit=1000')
      .then(function (rows) { PA.students = arr(rows); PA.studentsErr = ''; PA.renderStudents(); })
      .catch(function (e) { PA.studentsErr = errMsg(e); PA.renderStudents(); });
  }

  /* ============================================================
     تب ۱) دانش‌آموزان — ثبت فوری روی سرور (رمز سمت سرور هش می‌شود)
     ============================================================ */
  /* انتخاب کلاس با دکمه‌های گروه‌بندی‌شده بر اساس پایه (به‌جای فهرست کشویی) */
  function classChips(sel, act, withAll) {
    var by = {}, h = '';
    adminClassList().forEach(function (c) { (by[c.grade] = by[c.grade] || []).push(c); });
    var cnt = {}; PA.students.forEach(function (x) { cnt[x.class_id] = (cnt[x.class_id] || 0) + 1; });
    if (withAll) {
      h += '<div class="adm-cgrp"><button type="button" class="adm-cchip' + (!sel ? ' on' : '') + '" data-act="' + act + '" data-cid="">همه کلاس‌ها <em>' + toFa(PA.students.length) + '</em></button></div>';
    }
    [7, 8, 9].forEach(function (g) {
      if (!by[g]) return;
      h += '<div class="adm-cgrp"><span class="adm-cgl">پایه ' + GRADE_NAMES[g] + '</span>' + by[g].map(function (c) {
        return '<button type="button" class="adm-cchip' + (c.id === sel ? ' on' : '') + '" data-act="' + act + '" data-cid="' + escHTML(c.id) + '">' +
          escHTML(c.name) + (withAll ? ' <em>' + toFa(cnt[c.id] || 0) + '</em>' : '') + '</button>';
      }).join('') + '</div>';
    });
    return h;
  }
  function classPicker(sel) {
    return '<div class="adm-field" style="margin-top:10px"><span>کلاس</span><div class="adm-cpick">' +
      '<input type="hidden" class="sf-class" value="' + escHTML(sel) + '">' + classChips(sel, 'cpick', false) + '</div></div>';
  }
  function stuEmpty() {
    if (!PA.students.length) return '<div class="adm-empty">هنوز دانش‌آموزی ثبت نشده است. با «افزودن دانش‌آموز» یا «افزودن گروهی» شروع کنید.</div>';
    return '<div class="adm-empty">با فیلتر فعلی دانش‌آموزی پیدا نشد (' + toFa(PA.students.length) + ' دانش‌آموز ثبت شده است).<br>' +
      '<button type="button" class="btn btn-primary" style="margin-top:12px" data-act="cclear">نمایش همهٔ دانش‌آموزان</button></div>';
  }
  function stuRow(s) {
    var c = clsOf(s.class_id);
    return '<div class="adm-stu-row" data-id="' + escHTML(s.id) + '" data-nid="' + escHTML(s.national_id) + '">' +
      '<div class="adm-stu-info"><b>' + escHTML(s.name) + '</b><span dir="ltr">' + toFa(s.national_id) + '</span></div>' +
      '<span class="adm-pill' + (c ? '' : ' warn') + '">' + (c ? escHTML(c.name) : 'کلاس حذف‌شده') + '</span>' +
      '<div class="adm-stu-btns">' +
      '<button type="button" class="adm-mini" data-act="sedit">ویرایش</button>' +
      '<button type="button" class="adm-mini" data-act="spass">رمز جدید</button>' +
      delBtn('sdel', 'حذف دانش‌آموز') +
      '</div></div>';
  }
  function stuFormHTML() {
    var f = PA.stuForm; if (!f) return '';
    var classes = adminClassList();
    if (!classes.length) return '<div class="adm-pstate err">ابتدا در زبانهٔ «کلاس‌ها» یک کلاس بسازید.</div>';
    var defCls = PA.stuFilter.cls || classes[0].id;
    if (f.mode === 'bulk') {
      return '<div class="adm-card adm-stuform">' +
        '<div class="adm-card-head"><strong>افزودن گروهی دانش‌آموزان</strong></div>' +
        classPicker(defCls) +
        '<label class="adm-field" style="margin-top:10px"><span>هر دانش‌آموز در یک خط: «نام و نام خانوادگی ، کد ملی ، رمز (اختیاری)»</span>' +
        '<textarea class="adm-in sf-bulk" rows="8" dir="auto" placeholder="علی رضایی ، 0012345678 ، 1234&#10;رضا احمدی ، 0098765432"></textarea></label>' +
        '<div class="adm-note" style="margin:10px 0 0"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg><span>می‌توانید ستون‌های Excel را کپی و اینجا Paste کنید. اگر رمز نوشته نشود، رمز اولیه همان «کد ملی» است. دانش‌آموزی که کد ملی‌اش از قبل ثبت شده باشد، فقط نام و کلاسش به‌روز می‌شود (رمزش تغییر نمی‌کند).</span></div>' +
        '<div class="adm-form-btns"><button type="button" class="btn btn-primary" data-act="sbsave">ثبت دانش‌آموزان</button>' +
        '<button type="button" class="btn btn-outline" data-act="scancel">انصراف</button></div>' +
        '<div class="sf-result" aria-live="polite"></div></div>';
    }
    var st = null;
    if (f.mode === 'edit') PA.students.forEach(function (x) { if (x.id === f.id) st = x; });
    st = st || {};
    return '<div class="adm-card adm-stuform">' +
      '<div class="adm-card-head"><strong>' + (st.id ? 'ویرایش دانش‌آموز' : 'افزودن دانش‌آموز') + '</strong></div>' +
      '<div class="adm-row">' +
      '<label class="adm-field"><span>نام و نام خانوادگی</span><input class="adm-in sf-name" maxlength="60" value="' + escHTML(st.name || '') + '"></label>' +
      '<label class="adm-field"><span>کد ملی (نام کاربری)</span><input class="adm-in sf-nid" dir="ltr" inputmode="numeric" maxlength="10" value="' + escHTML(st.national_id || '') + '"></label>' +
      '<label class="adm-field"><span>' + (st.id ? 'رمز جدید (خالی = بدون تغییر)' : 'رمز عبور (خالی = همان کد ملی)') + '</span>' +
      '<input class="adm-in sf-pass" dir="ltr" maxlength="40" autocomplete="off" placeholder="••••••"></label>' +
      '</div>' + classPicker(st.class_id || defCls) +
      '<div class="adm-form-btns"><button type="button" class="btn btn-primary" data-act="ssave" data-id="' + escHTML(st.id || '') + '">ثبت</button>' +
      (st.id ? '' : '<button type="button" class="btn btn-primary" data-act="ssave" data-id="" data-next="1">ثبت و افزودن بعدی</button>') +
      '<button type="button" class="btn btn-outline" data-act="scancel">انصراف</button></div></div>';
  }
  PA.renderStudents = function () {
    var f = PA.stuFilter, q = nf(nd(f.q));
    var list = PA.students.filter(function (s) {
      if (f.cls && s.class_id !== f.cls) return false;
      if (q && nf(s.name).indexOf(q) < 0 && String(s.national_id).indexOf(q) < 0) return false;
      return true;
    });
    $('admStuClass').innerHTML = classChips(f.cls, 'cfilter', true);
    $('admStuCount').textContent = toFa(PA.students.length) + ' دانش‌آموز' +
      (list.length !== PA.students.length ? ' — نمایش ' + toFa(list.length) : '');
    $('admStuForm').innerHTML = stuFormHTML();
    if (PA.studentsErr) {
      $('admStuList').innerHTML = '<div class="adm-pstate err">دریافت فهرست دانش‌آموزان انجام نشد: ' + escHTML(PA.studentsErr) + '<br>' +
        '<button type="button" class="btn btn-primary" style="margin-top:10px" data-act="sretry">تلاش دوباره</button></div>';
    } else $('admStuList').innerHTML = list.length ? list.map(stuRow).join('') :
      stuEmpty();
    if (PA.flashNid) {   // دانش‌آموزی که همین الان ثبت شد: پیدا، برجسته و در دید
      var fr = null; qsa('#admStuList .adm-stu-row').forEach(function (r) { if (r.getAttribute('data-nid') === PA.flashNid) fr = r; });
      PA.flashNid = null;
      if (fr) { fr.classList.add('adm-new'); if (!PA.stuForm) fr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
  };
  function renderStuListOnly() {
    var f = PA.stuFilter, q = nf(nd(f.q));
    var list = PA.students.filter(function (s) {
      if (f.cls && s.class_id !== f.cls) return false;
      if (q && nf(s.name).indexOf(q) < 0 && String(s.national_id).indexOf(q) < 0) return false;
      return true;
    });
    $('admStuCount').textContent = toFa(PA.students.length) + ' دانش‌آموز' +
      (list.length !== PA.students.length ? ' — نمایش ' + toFa(list.length) : '');
    $('admStuList').innerHTML = list.length ? list.map(stuRow).join('') : stuEmpty();
  }
  function saveStudent(btn) {
    var box = $('admStuForm'), id = btn.getAttribute('data-id') || null;
    var name = val(box, '.sf-name').trim(), nid = nd(val(box, '.sf-nid')), cid = val(box, '.sf-class'), pass = nd(val(box, '.sf-pass'));
    if (!name) return showToast('نام دانش‌آموز را وارد کنید.');
    if (!/^\d{10}$/.test(nid)) return showToast('کد ملی باید ۱۰ رقم باشد.');
    if (!clsOf(cid)) return showToast('کلاس را انتخاب کنید.');
    if (pass && pass.length < 4) return showToast('رمز باید حداقل ۴ نویسه باشد.');
    if (!validNid(nid) && !window.confirm('این کد ملی از نظر ریاضی معتبر نیست. با همین کد ثبت شود؟')) return;
    btn.disabled = true;
    apiJson('/rest/v1/rpc/admin_save_student', {
      method: 'POST',
      body: JSON.stringify({ p_id: id, p_national_id: nid, p_name: name, p_class_id: cid, p_grade: gradeOfClass(cid), p_password: pass })
    }).then(function () {
      var next = !id && btn.getAttribute('data-next') === '1';
      PA.stuForm = next ? { mode: 'add' } : null;
      PA.stuFilter.cls = cid; PA.stuFilter.q = ''; PA.flashNid = nid;   // لیست روی کلاس همین دانش‌آموز می‌رود تا گم نشود
      var se = $('admStuSearch'); if (se) se.value = '';
      showToast((id ? 'ذخیره شد: ' : 'اضافه شد: ') + name + ' ← ' + clsName(cid));
      return loadStudents().then(function () {
        if (next) { var ni = $('admStuForm').querySelector('.sf-name'); if (ni) ni.focus(); }
      });
    }).catch(function (e) { showToast(errMsg(e)); }).then(function () { btn.disabled = false; });
  }
  function parseBulk(text) {
    var rows = [], bad = [];
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line) return;
      var parts = line.split(/\t|,|،|;|؛/).map(nd).filter(function (x) { return x !== ''; });
      if (parts.length === 1) { // «نام ۰۰۱۲۳۴۵۶۷۸» یا «۰۰۱۲۳۴۵۶۷۸ نام» با فاصله
        var m = nd(parts[0]).match(/^(.*?)\s+(\d{10})(?:\s+(\S+))?$/) || nd(parts[0]).match(/^(\d{10})\s+(.+?)(?:\s+(\S+))?$/);
        if (m) parts = /^\d{10}$/.test(m[1]) ? [m[1], m[2], m[3] || ''] : [m[1], m[2], m[3] || ''];
      }
      var a = parts[0] || '', b = parts[1] || '', nid, name;
      if (/^\d{10}$/.test(a)) { nid = a; name = b; }
      else if (/^\d{10}$/.test(b)) { nid = b; name = a; }
      else { bad.push(line); return; }
      if (!name) { bad.push(line); return; }
      rows.push({ national_id: nid, name: name, password: parts[2] || '' });
    });
    return { rows: rows, bad: bad };
  }
  function saveBulk(btn) {
    var box = $('admStuForm'), cid = val(box, '.sf-class');
    var p = parseBulk(val(box, '.sf-bulk'));
    if (!p.rows.length) return showToast('هیچ ردیف معتبری پیدا نشد (هر خط: نام ، کد ملی ۱۰رقمی).');
    if (!clsOf(cid)) return showToast('کلاس را انتخاب کنید.');
    if (!window.confirm(toFa(p.rows.length) + ' دانش‌آموز در «' + clsName(cid) + '» ثبت/به‌روز شود؟')) return;
    btn.disabled = true;
    apiJson('/rest/v1/rpc/admin_bulk_students', {
      method: 'POST', body: JSON.stringify({ p_class_id: cid, p_grade: gradeOfClass(cid), p_rows: p.rows })
    }).then(function (res) {
      var badAll = p.bad.concat(arr(res && res.bad));
      var msg = toFa(res.added) + ' نفر اضافه و ' + toFa(res.updated) + ' نفر به‌روز شد.';
      PA.stuFilter.cls = cid; PA.stuFilter.q = ''; var se2 = $('admStuSearch'); if (se2) se2.value = '';
      loadStudents().then(function () {
        if (badAll.length) {
          PA.stuForm = { mode: 'bulk' }; PA.renderStudents();
          var rbox = $('admStuForm').querySelector('.sf-result');
          if (rbox) rbox.innerHTML = '<div class="adm-pstate err">' + escHTML(msg) + ' ردیف‌های نامعتبر (' + toFa(badAll.length) + '): ' +
            badAll.slice(0, 10).map(escHTML).join(' | ') + '</div>';
        } else { PA.stuForm = null; PA.renderStudents(); }
        showToast(msg);
      });
    }).catch(function (e) { showToast(errMsg(e)); }).then(function () { btn.disabled = false; });
  }
  function resetPassword(s) {
    var p = nd(window.prompt('رمز جدید برای «' + s.name + '» را وارد کنید (حداقل ۴ نویسه):') || '');
    if (!p) return;
    if (p.length < 4) return showToast('رمز باید حداقل ۴ نویسه باشد.');
    apiJson('/rest/v1/rpc/admin_save_student', {
      method: 'POST',
      body: JSON.stringify({ p_id: s.id, p_national_id: s.national_id, p_name: s.name, p_class_id: s.class_id, p_grade: s.grade, p_password: p })
    }).then(function () { showToast('رمز «' + s.name + '» تغییر کرد.'); })
      .catch(function (e) { showToast(errMsg(e)); });
  }
  function deleteStudent(s) {
    if (!window.confirm('«' + s.name + '» و همهٔ نتیجه‌های آزمون او حذف شود؟')) return;
    apiJson('/rest/v1/students?id=eq.' + encodeURIComponent(s.id), { method: 'DELETE' }).then(function () {
      showToast('دانش‌آموز حذف شد.'); return loadStudents();
    }).catch(function (e) { showToast(errMsg(e)); });
  }

  /* ============================================================
     تب مدیران — افزودن مدیر با نام کاربری و رمز (ثبت فوری روی سرور)
     ============================================================ */
  function loadAdmins() {
    return apiJson('/rest/v1/rpc/admin_list_admins', { method: 'POST', body: '{}' })
      .then(function (rows) { PA.admins = arr(rows); PA.adminsErr = ''; PA.renderAdmins(); })
      .catch(function (e) { PA.adminsErr = errMsg(e); PA.renderAdmins(); });
  }
  PA.renderAdmins = function () {
    var box = $('admAdmList'), fbox = $('admAdmForm'); if (!box || !fbox) return;
    fbox.innerHTML = PA.admForm ?
      '<div class="adm-card"><div class="adm-card-head"><strong>مدیر جدید</strong></div>' +
      '<div class="adm-row">' +
      '<label class="adm-field"><span>نام نمایشی (فارسی)</span><input class="adm-in af-name" maxlength="40" placeholder="مثلاً: معاون آموزشی"></label>' +
      '<label class="adm-field"><span>نام کاربری (انگلیسی)</span><input class="adm-in af-user" dir="ltr" maxlength="30" autocapitalize="off" autocomplete="off" placeholder="مثلاً: kazemi"></label>' +
      '<label class="adm-field"><span>رمز (حداقل ۶ نویسه)</span><input type="text" class="adm-in af-pass" dir="ltr" maxlength="40" autocomplete="off"></label>' +
      '</div>' +
      '<div class="adm-note" style="margin:10px 0 0"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg><span>مدیر جدید در پنجرهٔ ورود، «نام کاربری» و رمز خودش را می‌زند. مدیر اصلی با خالی گذاشتن نام کاربری وارد می‌شود. مدیرها دسترسی کامل به پنل دارند.</span></div>' +
      '<div class="adm-form-btns"><button type="button" class="btn btn-primary" data-act="asave">افزودن مدیر</button>' +
      '<button type="button" class="btn btn-outline" data-act="acancel">انصراف</button></div></div>' : '';
    if (PA.adminsErr) { box.innerHTML = '<div class="adm-pstate err">' + escHTML(PA.adminsErr) + '</div>'; return; }
    box.innerHTML = PA.admins.length ? PA.admins.map(function (a) {
      return '<div class="adm-stu-row" data-aid="' + escHTML(a.id) + '">' +
        '<div class="adm-stu-info"><div class="adm-aline"><b>' + escHTML(a.display_name || a.username) + '</b>' +
        '<span class="adm-uname" dir="ltr">' + escHTML(a.username) + '</span></div></div>' +
        '<div class="adm-stu-btns"><button type="button" class="adm-mini" data-act="apass">رمز جدید</button>' +
        (a.is_main ? '' : delBtn('adel', 'حذف مدیر')) + '</div></div>';
    }).join('') : '<div class="adm-empty">در حال دریافت فهرست مدیران…</div>';
  };
  function admOf(b) {
    var row = b.closest('[data-aid]'), id = row ? row.getAttribute('data-aid') : '', r = null;
    PA.admins.forEach(function (x) { if (x.id === id) r = x; });
    return r;
  }
  function saveAdmin(btn) {
    var box = $('admAdmForm'), name = val(box, '.af-name').trim(), user = val(box, '.af-user').trim().toLowerCase(), pass = nd(val(box, '.af-pass'));
    if (!/^[a-z0-9_.]{3,30}$/.test(user)) return showToast('نام کاربری باید ۳ تا ۳۰ نویسهٔ انگلیسی (حرف کوچک، عدد، _ یا .) باشد.');
    if (pass.length < 6) return showToast('رمز مدیر باید حداقل ۶ نویسه باشد.');
    btn.disabled = true;
    apiJson('/rest/v1/rpc/admin_create_admin', { method: 'POST', body: JSON.stringify({ p_username: user, p_name: name || user, p_password: pass }) })
      .then(function () { PA.admForm = false; showToast('مدیر «' + (name || user) + '» اضافه شد.'); return loadAdmins(); })
      .catch(function (e) { showToast(errMsg(e)); }).then(function () { btn.disabled = false; });
  }
  function adminSetPass(b) {
    var a = admOf(b); if (!a) return;
    var p = nd(window.prompt('رمز جدید برای «' + (a.display_name || a.username) + '» (حداقل ۶ نویسه):') || '');
    if (!p) return;
    if (p.length < 6) return showToast('رمز مدیر باید حداقل ۶ نویسه باشد.');
    apiJson('/rest/v1/rpc/admin_set_admin_password', { method: 'POST', body: JSON.stringify({ p_id: a.id, p_password: p }) })
      .then(function () { showToast('رمز «' + (a.display_name || a.username) + '» تغییر کرد.'); })
      .catch(function (e) { showToast(errMsg(e)); });
  }
  function adminDelete(b) {
    var a = admOf(b); if (!a) return;
    if (!window.confirm('مدیر «' + (a.display_name || a.username) + '» حذف شود؟ دیگر نمی‌تواند وارد پنل شود.')) return;
    apiJson('/rest/v1/rpc/admin_delete_admin', { method: 'POST', body: JSON.stringify({ p_id: a.id }) })
      .then(function () { showToast('مدیر حذف شد.'); return loadAdmins(); })
      .catch(function (e) { showToast(errMsg(e)); });
  }

  /* ============================================================
     تب ۲) آزمون آنلاین
     ============================================================ */
  function qBlock(q, e, j) {
    var radios = q.o.map(function (txt, k) {
      return '<label class="adm-qopt"><input type="radio" class="adm-qa" name="qa-' + e.id + '-' + j + '" value="' + k + '"' + (q.a === k ? ' checked' : '') +
        ' title="پاسخ صحیح"><input class="adm-in adm-qo" value="' + escHTML(q.o[k]) + '" placeholder="گزینهٔ ' + toFa(k + 1) + '"></label>';
    }).join('');
    var img = q._busy ? '<span class="adm-upname">در حال آپلود تصویر…</span>' :
      (q.img ? '<img class="adm-qthumb" src="' + escHTML(fileUrl(q.img)) + '" alt=""><button type="button" class="adm-mini" data-act="qimgdel">حذف تصویر</button>' :
        '<button type="button" class="adm-mini" data-act="qimg">' + icon('image') + ' افزودن تصویر (اختیاری)</button>');
    return '<div class="adm-q" data-q="' + j + '">' +
      '<div class="adm-q-head"><b>سؤال ' + toFa(j + 1) + '</b>' + delBtn('qdel', 'حذف سؤال') + '</div>' +
      '<textarea class="adm-in adm-qtext" rows="2" placeholder="متن سؤال">' + escHTML(q.q) + '</textarea>' +
      '<div class="adm-q-opts">' + radios + '</div>' +
      '<div class="adm-q-img">' + img + '</div></div>';
  }
  function examCard(e, i) {
    var online = e.kind === 'online', saved = !!PA.serverExams[e.id];
    var h = '<div class="adm-card" data-i="' + i + '">' +
      '<div class="adm-card-head">' +
      '<input class="adm-in adm-extitle" maxlength="80" value="' + escHTML(e.title) + '" placeholder="عنوان آزمون (مثلاً ریاضی — فصل ۳)">' +
      '<select class="adm-in adm-exkind" style="max-width:160px" aria-label="نوع آزمون">' +
      '<option value="online"' + (online ? ' selected' : '') + '>آنلاین (سؤال‌دار)</option>' +
      '<option value="link"' + (!online ? ' selected' : '') + '>لینک بیرونی</option></select>' +
      delBtn('exdel', 'حذف آزمون') + '</div>' +
      dateRow(e) +
      '<div class="adm-row">' +
      timeField(e) +
      '<label class="adm-field"><span>مدت آزمون (دقیقه)</span><input type="number" min="1" max="600" class="adm-in adm-exdur" value="' + e.duration + '"></label>' +
      '</div>' + audHTML(e.aud) +
      '<label class="adm-field" style="margin-top:10px"><span>توضیحات برای دانش‌آموز (اختیاری)</span><input class="adm-in adm-exdesc" maxlength="200" value="' + escHTML(e.descr) + '"></label>';
    if (online) {
      h += '<div class="adm-note" style="margin:12px 0 8px"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg><span>' +
        'برای هر سؤال، گزینهٔ صحیح را با دایرهٔ کنار آن علامت بزنید. نمره از ۲۰ به‌صورت خودکار روی سرور محاسبه می‌شود و پاسخ‌های صحیح هرگز به دست دانش‌آموز نمی‌رسند.</span></div>' +
        '<div class="adm-qlist">' + e.questions.map(function (q, j) { return qBlock(q, e, j); }).join('') + '</div>' +
        '<button type="button" class="adm-add" data-act="qadd">' + icon('plus') + 'افزودن سؤال</button>';
    } else {
      h += '<label class="adm-field" style="margin-top:10px"><span>لینک آزمون (مثلاً Google Form یا پورس‌لاین)</span>' +
        '<input class="adm-in adm-exurl" dir="ltr" value="' + escHTML(e.url) + '" placeholder="https://forms.gle/..."></label>' +
        '<div class="adm-upname">لینک فقط از ساعت شروع تا پایان زمان آزمون به دانش‌آموز نشان داده می‌شود.</div>';
    }
    if (online && saved) {
      h += '<div class="adm-form-btns"><button type="button" class="adm-mini" data-act="exres">' + icon('users') + ' نتایج دانش‌آموزان</button></div>' +
        '<div class="adm-exresult"></div>';
    }
    return h + '</div>';
  }
  PA.renderExams = function () {
    $('admOExamCount').textContent = toFa(PA.exams.length) + ' آزمون';
    $('admOExamList').innerHTML = PA.exams.length ? PA.exams.map(examCard).join('') :
      '<div class="adm-empty">هنوز آزمونی ساخته نشده است.</div>';
  };
  function collectExams() {
    qsa('#admOExamList > .adm-card').forEach(function (card) {
      var e = PA.exams[+card.getAttribute('data-i')]; if (!e) return;
      e.title = val(card, '.adm-extitle').trim();
      var d = adminCardDate(card); e.y = d.y; e.m = d.m; e.d = d.d;
      var th = card.querySelector('.adm-th'), tmn = card.querySelector('.adm-tm');
      e.hh = th ? (+th.value || 0) : 8; e.mm = tmn ? (+tmn.value || 0) : 0;
      e.duration = Math.max(1, Math.min(600, Number(val(card, '.adm-exdur')) || 30));
      e.descr = val(card, '.adm-exdesc').trim();
      var kd = card.querySelector('.adm-exkind'); if (kd) e.kind = kd.value === 'link' ? 'link' : 'online';
      e.aud = readAud(card);
      var u = card.querySelector('.adm-exurl'); if (u) e.url = u.value.trim();
      if (card.querySelector('.adm-qlist')) {
        // به‌روزرسانی «درجا»: آبجکت سؤال‌ها عوض نمی‌شود تا نتیجهٔ آپلودِ در حال انجام روی همان آبجکت بنشیند
        e.questions = qsa('.adm-q', card).map(function (qb, j) {
          var qo = e.questions[j] || { img: '' };
          var chk = qb.querySelector('.adm-qa:checked');
          qo.q = val(qb, '.adm-qtext');
          qo.o = qsa('.adm-qo', qb).map(function (x) { return x.value; });
          qo.a = chk ? Number(chk.value) : -1;
          return qo;
        });
      }
    });
  }
  function finalizeQ(q) {
    var map = {}, o = [];
    q.o.forEach(function (t, k) { t = String(t || '').trim(); if (t) { map[k] = o.length; o.push(t); } });
    var a = (q.a >= 0 && map[q.a] !== undefined) ? map[q.a] : -1;
    var out = { q: String(q.q || '').trim(), o: o, a: a };
    if (q.img) out.img = q.img;
    return out;
  }
  function showResults(card, e) {
    var box = card.querySelector('.adm-exresult'); if (!box) return;
    box.innerHTML = '<div class="adm-upname">در حال دریافت نتایج…</div>';
    apiJson('/rest/v1/exam_results?exam_id=eq.' + encodeURIComponent(e.id) +
      '&select=score,correct,wrong,unanswered,started_at,submitted_at,students(name,national_id,class_id)&order=submitted_at.desc.nullslast&limit=1000')
      .then(function (rows) {
        rows = arr(rows); PA.lastResults[e.id] = rows;
        var done = rows.filter(function (r) { return r.submitted_at; });
        var avg = done.length ? done.reduce(function (s, r) { return s + Number(r.score || 0); }, 0) / done.length : 0;
        if (!rows.length) { box.innerHTML = '<div class="adm-empty">هنوز هیچ دانش‌آموزی در این آزمون شرکت نکرده است.</div>'; return; }
        box.innerHTML = '<div class="adm-upname">' + toFa(done.length) + ' نفر پایان داده‌اند · ' + toFa(rows.length - done.length) +
          ' نفر نیمه‌کاره · میانگین نمره: ' + toFa(avg.toFixed(1)) + ' از ۲۰ ' +
          '<button type="button" class="adm-mini" data-act="excsv">دانلود جدول (CSV)</button></div>' +
          '<div class="adm-tablewrap"><table class="adm-restable"><thead><tr><th>نام</th><th>کلاس</th><th>نمره</th><th>درست</th><th>غلط</th><th>بی‌پاسخ</th></tr></thead><tbody>' +
          rows.map(function (r) {
            var s = r.students || {};
            return '<tr><td>' + escHTML(s.name || '—') + '</td><td>' + escHTML(clsName(s.class_id)) + '</td>' +
              (r.submitted_at ? '<td><b>' + toFa(r.score) + '</b></td><td>' + toFa(r.correct) + '</td><td>' + toFa(r.wrong) + '</td><td>' + toFa(r.unanswered) + '</td>'
                : '<td colspan="4">نیمه‌کاره</td>') + '</tr>';
          }).join('') + '</tbody></table></div>';
      }).catch(function (er) { box.innerHTML = '<div class="adm-pstate err">' + escHTML(errMsg(er)) + '</div>'; });
  }
  function downloadCsv(e) {
    var rows = PA.lastResults[e.id] || [];
    var lines = [['نام', 'کد ملی', 'کلاس', 'نمره از ۲۰', 'درست', 'غلط', 'بی‌پاسخ', 'وضعیت']];
    rows.forEach(function (r) {
      var s = r.students || {};
      lines.push([s.name || '', s.national_id || '', clsName(s.class_id), r.submitted_at ? r.score : '', r.correct == null ? '' : r.correct,
        r.wrong == null ? '' : r.wrong, r.unanswered == null ? '' : r.unanswered, r.submitted_at ? 'پایان‌یافته' : 'نیمه‌کاره']);
    });
    var csv = '\ufeff' + lines.map(function (l) {
      return l.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'نتایج-' + (e.title || 'آزمون') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ============================================================
     تب ۳) کلاس مجازی
     ============================================================ */
  function vclsCard(v, i) {
    return '<div class="adm-card" data-i="' + i + '"><div class="adm-card-head">' +
      '<input class="adm-in adm-vp" list="admPresetList" maxlength="60" value="' + escHTML(v.p) + '" placeholder="نام کلاس یا پلتفرم (مثلاً ریاضی هفتم ۱ — گوگل میت)">' +
      delBtn('vdel', 'حذف این کلاس') + '</div>' +
      '<label class="adm-field"><span>لینک ورود به کلاس</span><input class="adm-in adm-vurl" dir="ltr" value="' + escHTML(v.url) + '" placeholder="https://meet.google.com/abc-defg-hij"></label>' +
      audHTML(v.aud) + '</div>';
  }
  PA.renderVcls = function () {
    $('admVclsCount').textContent = toFa(PA.content.vcls.length) + ' مورد';
    $('admVclsList').innerHTML = PA.content.vcls.length ? PA.content.vcls.map(vclsCard).join('') :
      '<div class="adm-empty">هنوز کلاس مجازی‌ای ثبت نشده است. با «افزودن کلاس مجازی» لینک اولین کلاس را بگذارید.</div>';
  };
  function collectVcls() {
    qsa('#admVclsList > .adm-card').forEach(function (card) {
      var v = PA.content.vcls[+card.getAttribute('data-i')]; if (!v) return;
      v.p = val(card, '.adm-vp').trim(); v.url = val(card, '.adm-vurl').trim(); v.aud = readAud(card);
    });
  }

  /* ============================================================
     تب ۴) منابع آموزشی (آپلود فایل یا لینک)
     ============================================================ */
  function sizeTxt(b) {
    if (!b) return '';
    return b >= 1048576 ? toFa((b / 1048576).toFixed(1)) + ' مگابایت' : toFa(Math.max(1, Math.round(b / 1024))) + ' کیلوبایت';
  }
  function resCard(r, i) {
    var file;
    if (r.mode === 'file') {
      var fl = r.files.map(function (f, k) {
        return '<div class="adm-rfile" data-fi="' + k + '"><a href="' + escHTML(fileUrl(f.path)) + '" target="_blank" rel="noopener">' + icon('file') + ' ' + escHTML(f.fileName || 'فایل') + '</a>' +
          '<span class="adm-upname">' + sizeTxt(f.size) + '</span>' + delBtn('rfdel', 'حذف این فایل') + '</div>';
      }).join('');
      file = '<div class="adm-rfiles">' + fl + '</div>' +
        (r._busy ? '<span class="adm-upname">در حال آپلود… (تا پایان صبر کنید)</span>' :
          '<button type="button" class="adm-mini" data-act="rpick">' + icon('up') + (r.files.length ? ' افزودن فایل دیگر' : ' انتخاب و آپلود فایل') + '</button>' +
          '<div class="adm-upname">می‌توانید چند فایل را با هم انتخاب کنید. فرمت‌های مجاز: PDF، Word، PowerPoint، Excel، عکس، MP4، MP3، ZIP — هر فایل حداکثر ۵۰ مگابایت</div>');
    } else {
      file = '<label class="adm-field"><span>لینک منبع (آپارات، گوگل درایو، سایت...)</span><input class="adm-in adm-rurl" dir="ltr" value="' + escHTML(r.url) + '" placeholder="https://..."></label>';
    }
    return '<div class="adm-card" data-i="' + i + '"><div class="adm-card-head">' +
      '<input class="adm-in adm-rtitle" maxlength="80" value="' + escHTML(r.title) + '" placeholder="عنوان منبع (مثلاً جزوهٔ فصل ۲ ریاضی)">' +
      delBtn('rdel', 'حذف منبع') + '</div>' +
      '<div class="adm-row">' +
      '<label class="adm-field"><span>دسته</span><select class="adm-in adm-rkind">' +
      RES_KINDS.map(function (k) { return '<option' + (r.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label>' +
      '<label class="adm-field"><span>درس (اختیاری)</span><input class="adm-in adm-rsubj" maxlength="40" value="' + escHTML(r.subject) + '" placeholder="مثلاً ریاضی"></label>' +
      '<label class="adm-field"><span>نوع منبع</span><select class="adm-in adm-rmode">' +
      '<option value="file"' + (r.mode === 'file' ? ' selected' : '') + '>آپلود فایل</option>' +
      '<option value="link"' + (r.mode === 'link' ? ' selected' : '') + '>لینک</option></select></label>' +
      '</div><div style="margin-top:10px">' + file + '</div>' + audHTML(r.aud) + '</div>';
  }
  PA.renderRes = function () {
    $('admResCount').textContent = toFa(PA.content.resources.length) + ' منبع';
    $('admResList').innerHTML = PA.content.resources.length ? PA.content.resources.map(resCard).join('') :
      '<div class="adm-empty">هنوز منبعی ثبت نشده است.</div>';
  };
  function collectRes() {
    qsa('#admResList > .adm-card').forEach(function (card) {
      var r = PA.content.resources[+card.getAttribute('data-i')]; if (!r) return;
      r.title = val(card, '.adm-rtitle').trim(); r.kind = val(card, '.adm-rkind');
      r.subject = val(card, '.adm-rsubj').trim(); r.mode = val(card, '.adm-rmode') === 'link' ? 'link' : 'file';
      var u = card.querySelector('.adm-rurl'); if (u) r.url = u.value.trim();
      r.aud = readAud(card);
    });
  }

  /* ============================================================
     تب ۵) تقویم دانش‌آموزی
     ============================================================ */
  function evCard(ev, i) {
    return '<div class="adm-card" data-i="' + i + '"><div class="adm-card-head">' +
      '<input class="adm-in adm-evt" maxlength="60" value="' + escHTML(ev.title) + '" placeholder="عنوان (مثلاً بازدید علمی / تعطیلی)">' +
      '<select class="adm-in adm-evk" style="max-width:130px" aria-label="نوع رویداد">' +
      EV_KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (ev.k === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select>' +
      delBtn('pdel', 'حذف رویداد') + '</div>' + dateRow(ev) + audHTML(ev.aud) + '</div>';
  }
  PA.renderEvents = function () {
    $('admPcalCount').textContent = toFa(PA.content.events.length) + ' رویداد';
    $('admPcalList').innerHTML = PA.content.events.length ? PA.content.events.map(evCard).join('') :
      '<div class="adm-empty">هنوز رویدادی ثبت نشده است.</div>';
  };
  function collectEvents() {
    qsa('#admPcalList > .adm-card').forEach(function (card) {
      var ev = PA.content.events[+card.getAttribute('data-i')]; if (!ev) return;
      ev.title = val(card, '.adm-evt').trim(); ev.k = val(card, '.adm-evk') || 'ev';
      var d = adminCardDate(card); ev.y = d.y; ev.m = d.m; ev.d = d.d; ev.aud = readAud(card);
    });
  }

  /* ============================================================
     جمع‌آوری، اعتبارسنجی، ذخیره
     ============================================================ */
  PA.renderAll = function () {
    if (!PA.ready) return;
    PA.renderStudents(); PA.renderExams(); PA.renderVcls(); PA.renderRes(); PA.renderEvents(); PA.renderAdmins();
  };
  PA.collect = function () {
    if (!PA.ready) return;
    collectExams(); collectVcls(); collectRes(); collectEvents();
  };

  function validate() {
    var i, j, v, r, e, q, f;
    for (i = 0; i < PA.content.vcls.length; i++) {
      v = PA.content.vcls[i];
      if (!v.p) return { tab: 'vcls', msg: 'نام کلاس مجازی شمارهٔ ' + toFa(i + 1) + ' را بنویسید.' };
      if (!isUrl(v.url)) return { tab: 'vcls', msg: 'لینک کلاس مجازی «' + v.p + '» باید با https:// شروع شود.' };
    }
    for (i = 0; i < PA.content.resources.length; i++) {
      r = PA.content.resources[i];
      if (!r.title) return { tab: 'res', msg: 'عنوان منبع شمارهٔ ' + toFa(i + 1) + ' را بنویسید.' };
      if (r.mode === 'file' && !r.files.length) return { tab: 'res', msg: 'برای «' + r.title + '» فایلی آپلود نشده است (یا نوع را «لینک» کنید).' };
      if (r.mode === 'link' && !isUrl(r.url)) return { tab: 'res', msg: 'لینک «' + r.title + '» باید با https:// شروع شود.' };
    }
    for (i = 0; i < PA.content.events.length; i++) {
      if (!PA.content.events[i].title) return { tab: 'pcal', msg: 'عنوان رویداد شمارهٔ ' + toFa(i + 1) + ' را بنویسید.' };
    }
    for (i = 0; i < PA.exams.length; i++) {
      e = PA.exams[i];
      if (!e.title) return { tab: 'oexam', msg: 'عنوان آزمون شمارهٔ ' + toFa(i + 1) + ' را بنویسید.' };
      if (e.kind === 'link') {
        if (!isUrl(e.url)) return { tab: 'oexam', msg: 'لینک آزمون «' + e.title + '» باید با https:// شروع شود.' };
        continue;
      }
      if (!e.questions.length) return { tab: 'oexam', msg: 'آزمون «' + e.title + '» هنوز سؤالی ندارد.' };
      for (j = 0; j < e.questions.length; j++) {
        f = finalizeQ(e.questions[j]);
        if (!f.q) return { tab: 'oexam', msg: 'متن سؤال ' + toFa(j + 1) + ' از «' + e.title + '» خالی است.' };
        if (f.o.length < 2) return { tab: 'oexam', msg: 'سؤال ' + toFa(j + 1) + ' از «' + e.title + '» حداقل دو گزینه لازم دارد.' };
        if (f.a < 0) return { tab: 'oexam', msg: 'گزینهٔ صحیح سؤال ' + toFa(j + 1) + ' از «' + e.title + '» را علامت بزنید.' };
      }
    }
    return null;
  }
  function goTab(name) {
    var b = document.querySelector('.admin-tabs button[data-atab="' + name + '"]');
    if (b) b.click();
  }
  function buildContent() {
    var ev = PA.content.events.slice().sort(function (a, b) { return (a.y * 10000 + a.m * 100 + a.d) - (b.y * 10000 + b.m * 100 + b.d); });
    return {
      vcls: PA.content.vcls.map(function (v) { return { id: v.id, p: v.p, url: v.url, aud: v.aud }; }),
      resources: PA.content.resources.map(function (r) {
        var o = { id: r.id, title: r.title, kind: r.kind, subject: r.subject || '', aud: r.aud };
        if (r.mode === 'file') {
          o.files = r.files.map(function (f) { return { path: f.path, fileName: f.fileName, size: f.size }; });
          o.path = r.files[0].path; o.fileName = r.files[0].fileName; o.size = r.files[0].size;   // سازگاری با نسخهٔ قدیمی
        } else { o.url = r.url; }
        return o;
      }),
      events: ev.map(function (x) { return { id: x.id, y: x.y, m: x.m, d: x.d, title: x.title, k: x.k, aud: x.aud }; })
    };
  }
  function examRow(e) {
    return {
      id: e.id, title: e.title, kind: e.kind, aud: e.aud, start_at: jToIso(e.y, e.m, e.d, e.hh, e.mm),
      duration: e.duration, descr: e.descr, url: e.kind === 'link' ? e.url : '',
      questions: e.kind === 'online' ? e.questions.map(finalizeQ) : []
    };
  }

  var saving = false;
  PA.save = function () {
    if (saving) return Promise.resolve(false);
    if (!PA.ready) { showToast('اطلاعات پنل دانش‌آموزی هنوز دریافت نشده؛ پنل را دوباره باز کنید.'); return Promise.resolve(false); }
    if (PA.uploading) { showToast('آپلود فایل در حال انجام است؛ کمی صبر کنید.'); return Promise.resolve(false); }
    PA.collect();
    var bad = validate();
    if (bad) { goTab(bad.tab); showToast(bad.msg); return Promise.resolve(false); }

    // منابعی که از حالت «فایل» به «لینک» رفته‌اند → فایلشان پاک می‌شود
    PA.content.resources.forEach(function (r) {
      if (r.mode === 'link' && r.files.length) { r.files.forEach(function (f) { PA.delFiles.push(f.path); }); r.files = []; }
    });
    var content = buildContent();
    var rows = PA.exams.map(examRow);
    var delExams = PA.delExams.slice(), delFiles = PA.delFiles.slice();
    saving = true;
    showToast('در حال ذخیره پنل دانش‌آموزی…');

    var jobs = [api('/rest/v1/panel_content?on_conflict=id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ id: 'main', data: content, updated_at: new Date().toISOString() })
    })];
    if (rows.length) {
      jobs.push(api('/rest/v1/panel_exams?on_conflict=id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: JSON.stringify(rows)
      }));
    }
    return Promise.all(jobs).then(function (rs) {
      for (var i = 0; i < rs.length; i++) {
        if (!rs[i].ok) {
          var st = rs[i].status;
          return rs[i].text().then(function (t) {
            var j = null; try { j = JSON.parse(t); } catch (x) {}
            var er = new Error((j && (j.message || j.error || j.msg)) || t || ('http ' + st));
            er.status = st; er.code = j && j.code; throw er;
          });
        }
      }
      var more = [];
      if (delExams.length) {
        more.push(api('/rest/v1/panel_exams?id=in.(' + delExams.map(encodeURIComponent).join(',') + ')', { method: 'DELETE' }));
      }
      if (delFiles.length) {
        more.push(api('/storage/v1/object/' + BUCKET, { method: 'DELETE', body: JSON.stringify({ prefixes: delFiles }) }).catch(function () {}));
      }
      return Promise.all(more);
    }).then(function () {
      PA.delExams = []; PA.delFiles = [];
      PA.serverExams = {}; PA.exams.forEach(function (e) { PA.serverExams[e.id] = true; });
      PA.dirty = false;
      PA.renderExams(); PA.renderRes(); loadStudents();
      showToast('تغییرات پنل دانش‌آموزی ذخیره شد.');
      return true;
    }).catch(function (e) {
      showToast('ذخیره انجام نشد. ' + errMsg(e));
      return false;
    }).then(function (ok) { saving = false; return ok; });
  };

  /* ============================================================
     آپلود فایل در Storage
     ============================================================ */
  var job = null;
  function pickFile(kind, i, j) {
    job = { kind: kind, i: i, j: j };
    var inp = $('admPanelFile');
    inp.accept = kind === 'qimg' ? 'image/*' : '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,.rar,.7z,image/*,video/mp4,video/webm,audio/mpeg,audio/mp4';
    inp.multiple = kind === 'res';
    inp.value = '';
    inp.click();
  }
  function uploadFile(file, folder) {
    var m = file.name.match(/\.([A-Za-z0-9]{1,8})$/), ext = m ? m[1].toLowerCase() : 'bin';
    var path = folder + '/' + uid() + '.' + ext;
    return api('/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST', raw: true,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file
    }).then(function (r) {
      if (r.ok) return path;
      return r.text().then(function (t) {
        var jj = null; try { jj = JSON.parse(t); } catch (x) {}
        var er = new Error((jj && (jj.message || jj.error)) || t || ('upload ' + r.status)); er.status = r.status;
        if (/bucket not found/i.test(t)) er.status = 404;
        throw er;
      });
    });
  }
  function onFilePicked() {
    var inp = $('admPanelFile'), list = Array.prototype.slice.call(inp.files || []);
    if (!list.length || !job) return;
    var jb = job; job = null;
    var isImg = jb.kind === 'qimg';
    if (isImg) list = list.slice(0, 1);
    var ok = [], skipped = [];
    list.forEach(function (f) {
      if (!(isImg ? IMG_EXT : FILE_EXT).test(f.name)) skipped.push(f.name + ' (نوع نامجاز)');
      else if (f.size > (isImg ? MAX_IMG : MAX_FILE)) skipped.push(f.name + (isImg ? ' (بیش از ۵ مگابایت)' : ' (بیش از ۵۰ مگابایت؛ به‌جایش «لینک» بگذارید)'));
      else ok.push(f);
    });
    if (skipped.length) showToast('این فایل‌ها آپلود نشدند: ' + skipped.join('، '));
    if (!ok.length) return;
    PA.collect();
    var target = isImg ? (PA.exams[jb.i] && PA.exams[jb.i].questions[jb.j]) : PA.content.resources[jb.i];
    if (!target) return;
    target._busy = true; PA.uploading++;
    if (isImg) PA.renderExams(); else PA.renderRes();
    var done = 0;
    ok.reduce(function (p, f) {
      return p.then(function () {
        showToast('در حال آپلود «' + f.name + '»… (' + toFa(done + 1) + ' از ' + toFa(ok.length) + ')');
        return uploadFile(f, isImg ? 'q' : 'res').then(function (path) {
          if (isImg) { if (target.img) PA.delFiles.push(target.img); target.img = path; }
          else { target.files.push({ path: path, fileName: f.name, size: f.size }); }
          done++; PA.dirty = true;
        }).catch(function (e) { showToast('آپلود «' + f.name + '» انجام نشد. ' + errMsg(e)); });
      });
    }, Promise.resolve()).then(function () {
      if (done) showToast((done === ok.length ? toFa(done) + ' فایل آپلود شد' : toFa(done) + ' از ' + toFa(ok.length) + ' فایل آپلود شد') + '؛ برای ثبت نهایی «ذخیره» را بزنید.');
      target._busy = false; PA.uploading--;
      PA.collect();
      if (isImg) PA.renderExams(); else PA.renderRes();
    });
  }
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    var card = b.closest('.adm-card'), i = card ? Number(card.getAttribute('data-i')) : -1;
    var sRow = b.closest('.adm-stu-row'), sid = sRow ? sRow.getAttribute('data-id') : null;
    var stu = null;
    if (sid) PA.students.forEach(function (x) { if (x.id === sid) stu = x; });
    var td = todayParts(), ex, j, qb;

    if (!PA.ready && act !== 'save') return;

    switch (act) {
      /* دانش‌آموزان */
      case 'sadd': PA.stuForm = { mode: 'add' }; PA.renderStudents(); break;
      case 'sbulk': PA.stuForm = { mode: 'bulk' }; PA.renderStudents(); break;
      case 'scancel': PA.stuForm = null; PA.renderStudents(); break;
      case 'sedit': if (stu) { PA.stuForm = { mode: 'edit', id: stu.id }; PA.renderStudents(); $('admStuForm').scrollIntoView({ block: 'center' }); } break;
      case 'ssave': saveStudent(b); break;
      case 'cpick': {
        var wrap = b.closest('.adm-cpick');
        qsa('.adm-cchip', wrap).forEach(function (x) { x.classList.toggle('on', x === b); });
        wrap.querySelector('.sf-class').value = b.getAttribute('data-cid');
        break;
      }
      case 'sretry': loadStudents(); break;
      case 'cclear': PA.stuFilter = { cls: '', q: '' }; { var se3 = $('admStuSearch'); if (se3) se3.value = ''; } PA.renderStudents(); break;
      case 'cfilter': PA.stuFilter.cls = b.getAttribute('data-cid') || ''; PA.renderStudents(); break;
      case 'sbsave': saveBulk(b); break;
      case 'spass': if (stu) resetPassword(stu); break;
      case 'sdel': if (stu) deleteStudent(stu); break;

      /* مدیران */
      case 'aadd': PA.admForm = true; PA.renderAdmins(); break;
      case 'acancel': PA.admForm = false; PA.renderAdmins(); break;
      case 'asave': saveAdmin(b); break;
      case 'apass': adminSetPass(b); break;
      case 'adel': adminDelete(b); break;

      /* آزمون */
      case 'exadd':
        PA.collect();
        PA.exams.unshift({ id: uid(), title: '', kind: 'online', aud: { type: 'school' }, y: td.y, m: td.m, d: td.d, hh: 8, mm: 0,
          duration: 30, descr: '', url: '', questions: [normQ({})] });
        PA.renderExams(); PA.dirty = true; adminScrollTop(); break;
      case 'exdel':
        ex = PA.exams[i]; if (!ex || !window.confirm('این آزمون و نتیجه‌های آن حذف شود؟')) break;
        PA.collect();
        if (PA.serverExams[ex.id]) PA.delExams.push(ex.id);
        ex.questions.forEach(function (q) { if (q.img) PA.delFiles.push(q.img); });
        PA.exams.splice(i, 1); PA.renderExams(); PA.dirty = true; break;
      case 'qadd':
        PA.collect(); ex = PA.exams[i]; if (!ex) break;
        ex.questions.push(normQ({})); PA.renderExams(); PA.dirty = true;
        qb = qsa('#admOExamList > .adm-card')[i]; if (qb) { var qs = qsa('.adm-q', qb); if (qs.length) qs[qs.length - 1].scrollIntoView({ block: 'center' }); }
        break;
      case 'qdel':
        PA.collect(); ex = PA.exams[i]; j = Number(b.closest('.adm-q').getAttribute('data-q')); if (!ex || !ex.questions[j]) break;
        if (ex.questions[j].img) PA.delFiles.push(ex.questions[j].img);
        ex.questions.splice(j, 1); PA.renderExams(); PA.dirty = true; break;
      case 'qimg': pickFile('qimg', i, Number(b.closest('.adm-q').getAttribute('data-q'))); break;
      case 'qimgdel':
        PA.collect(); ex = PA.exams[i]; j = Number(b.closest('.adm-q').getAttribute('data-q')); if (!ex || !ex.questions[j]) break;
        if (ex.questions[j].img) PA.delFiles.push(ex.questions[j].img);
        ex.questions[j].img = ''; PA.renderExams(); PA.dirty = true; break;
      case 'exres': if (PA.exams[i]) showResults(card, PA.exams[i]); break;
      case 'excsv': if (PA.exams[i]) downloadCsv(PA.exams[i]); break;

      /* کلاس مجازی */
      case 'vadd':
        PA.collect(); PA.content.vcls.unshift({ id: uid(), p: '', url: '', aud: { type: 'school' } });
        PA.renderVcls(); PA.dirty = true; adminScrollTop(); break;
      case 'vdel':
        if (!window.confirm('این کلاس مجازی حذف شود؟')) break;
        PA.collect(); PA.content.vcls.splice(i, 1); PA.renderVcls(); PA.dirty = true; break;

      /* منابع */
      case 'radd':
        PA.collect(); PA.content.resources.unshift({ id: uid(), title: '', kind: 'جزوه', subject: '', mode: 'file', files: [], url: '', aud: { type: 'school' } });
        PA.renderRes(); PA.dirty = true; adminScrollTop(); break;
      case 'rdel':
        if (!window.confirm('این منبع حذف شود؟ (فایل آن هم از سرور پاک می‌شود)')) break;
        PA.collect();
        if (PA.content.resources[i]) PA.content.resources[i].files.forEach(function (f) { PA.delFiles.push(f.path); });
        PA.content.resources.splice(i, 1); PA.renderRes(); PA.dirty = true; break;
      case 'rpick': pickFile('res', i); break;
      case 'rfdel': {
        var fr0 = b.closest('[data-fi]'), fi = fr0 ? Number(fr0.getAttribute('data-fi')) : -1, rr = PA.content.resources[i];
        if (!rr || !rr.files[fi]) break;
        if (!window.confirm('فایل «' + (rr.files[fi].fileName || 'فایل') + '» حذف شود؟')) break;
        PA.collect(); PA.delFiles.push(rr.files[fi].path); rr.files.splice(fi, 1);
        PA.renderRes(); PA.dirty = true; break;
      }

      /* تقویم */
      case 'padd':
        PA.collect(); PA.content.events.unshift({ id: uid(), y: td.y, m: td.m, d: td.d, title: '', k: 'ev', aud: { type: 'school' } });
        PA.renderEvents(); PA.dirty = true; adminScrollTop(); break;
      case 'pdel':
        PA.collect(); PA.content.events.splice(i, 1); PA.renderEvents(); PA.dirty = true; break;

      /* ذخیرهٔ همین بخش‌ها */
      case 'save': PA.save(); break;
    }
  }

  // ورودی‌ها: فقط برای پنل دانش‌آموزی؛ جلوی «تغییر ذخیره‌نشدهٔ سایت» گرفته می‌شود تا ذخیرهٔ سنگین سایت بی‌دلیل اجرا نشود
  function onInput(e) {
    e.stopPropagation();
    var t = e.target;
    if (t.id === 'admStuSearch') { PA.stuFilter.q = t.value; renderStuListOnly(); return; }
    if (t.closest && t.closest('#atab-stu, #atab-adm')) return;
    if (t.classList && t.classList.contains('adm-exdur')) { var c2 = t.closest('.adm-card'); if (c2) updateTimeSum(c2); }
    PA.collect(); PA.dirty = true;
  }
  function onChange(e) {
    e.stopPropagation();
    var t = e.target;
    if (t.closest && t.closest('#atab-stu, #atab-adm')) return;
    var card = t.closest ? t.closest('.adm-card') : null;
    if (card && /\badm-(th|tm|exdur)\b/.test(t.className)) updateTimeSum(card);
    if ((t.classList.contains('adm-dM') || t.classList.contains('adm-dY')) && card) {
      var dSel = card.querySelector('.adm-dD');
      adminFillDayOptions(dSel, Number(card.querySelector('.adm-dY').value), Number(card.querySelector('.adm-dM').value), Number(dSel.value) || 1);
    }
    if (t.classList.contains('adm-audtype')) {
      var aw = t.closest('.adm-audwrap'); if (aw) aw.setAttribute('data-mode', t.value);
    }
    PA.collect(); PA.dirty = true;
    if (t.classList.contains('adm-exkind')) {                      // نوع آزمون عوض شد: بخش سؤال/لینک
      var xe = card ? PA.exams[+card.getAttribute('data-i')] : null;
      if (xe && xe.kind === 'online' && !xe.questions.length) xe.questions.push(normQ({}));
      PA.renderExams();
    }
    if (t.classList.contains('adm-rmode')) PA.renderRes();         // فایل ↔ لینک
  }

  /* ---------------- اتصال به پنل مدیریت موجود ---------------- */
  function activeTab() {
    var b = document.querySelector('.admin-tabs button.active');
    return b ? b.getAttribute('data-atab') : '';
  }
  function onGlobalSave() {
    var mine = TABS.indexOf(activeTab()) >= 0;
    if (PA.ready) PA.collect();
    var siteDirty = !!window.adminDirty;
    if (PA.ready && PA.dirty) PA.save();
    if (siteDirty || !mine) window.adminSaveAll();
    else if (!PA.dirty) showToast('تغییر ذخیره‌نشده‌ای وجود ندارد.');
  }

  function bind() {
    var dl = $('admPresetList');
    if (dl) dl.innerHTML = PRESETS.map(function (p) { return '<option value="' + escHTML(p) + '">'; }).join('');
    TABS.forEach(function (n) {
      var s = $('atab-' + n);
      s.addEventListener('click', onClick);
      s.addEventListener('input', onInput);
      s.addEventListener('change', onChange);
      var b = document.querySelector('.admin-tabs button[data-atab="' + n + '"]');
      if (b) b.addEventListener('click', function () {
        if (PA.ready) { PA.collect(); PA.renderAll(); if (n === 'stu') loadStudents(); if (n === 'adm') loadAdmins(); }
      });
    });
    $('admPanelFile').addEventListener('change', onFilePicked);

    // دکمهٔ «ذخیره تغییرات» پایین پنل مستقیم به تابع قدیمی وصل است؛ با شنوندهٔ capture کنترل می‌شود
    var foot = document.querySelector('#adminPanel .admin-foot');
    if (foot) foot.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('#adminSaveBtn') : null;
      if (!b) return;
      e.stopPropagation();
      onGlobalSave();
    }, true);

    // باز شدن پنل → دریافت اطلاعات تازه
    var _open = window.openAdminPanel;
    window.openAdminPanel = function () {
      _open.apply(this, arguments);
      if (adminUnlocked()) PA.load();
    };
    // بستن/قفل پنل با تغییر ذخیره‌نشدهٔ پنل دانش‌آموزی → تأیید
    var _close = window.closeAdminPanel;
    window.closeAdminPanel = function (force) {
      var open = $('adminPanel').classList.contains('open');
      if (!force && open && PA.dirty) {
        if (!window.confirm('تغییرات «پنل دانش‌آموزی» ذخیره نشده است. آیا مطمئنید می‌خواهید پنل را ببندید؟')) return;
        PA.dirty = false;
      }
      return _close.apply(this, arguments);
    };
    var _logout = window.adminLogout;
    window.adminLogout = function () {
      var open = $('adminPanel').classList.contains('open');
      if (open && PA.dirty) {
        if (!window.confirm('تغییرات «پنل دانش‌آموزی» ذخیره نشده است و با قفل شدن پنل از بین می‌رود — ادامه؟')) { adminTouch(); return; }
        PA.dirty = false;
      }
      return _logout.apply(this, arguments);
    };
  }
  bind();
})();
