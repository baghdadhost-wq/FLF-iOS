/* F.LF iOS touch controls — on-screen pad + special-move buttons.
 * Injected at document start. Sends keyboard events (keyCode) that F.LF's
 * core/controller.js listens for, so Player 1 stays on the default keyboard layout:
 *   up W, down X, left A, right D, defend Z, jump Q, attack S
 */
(function () {
  'use strict'
  if (window.__flfTouch) return
  window.__flfTouch = true

  // ---- 1) stop F.LF from switching P1 to its own (basic) touch pad -------------
  var origAdd = Document.prototype.addEventListener
  Document.prototype.addEventListener = function (type, fn, opt) {
    if (type === 'touchstart' && fn && fn.name === 'ontouch') return
    return origAdd.call(this, type, fn, opt)
  }

  // ---- 2) key sending ------------------------------------------------------------
  var KEY = { up: 87, down: 88, left: 65, right: 68, def: 90, jump: 81, att: 83,
    esc: 27, F1: 112, F2: 113, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120 }
  var held = {}          // key -> number of sources holding it
  function send(type, code) {
    var e
    try { e = new KeyboardEvent(type, { bubbles: true, cancelable: true }) } catch (x) {
      e = document.createEvent('Event'); e.initEvent(type, true, true)
    }
    try { Object.defineProperty(e, 'keyCode', { get: function () { return code } }) } catch (x) {}
    try { Object.defineProperty(e, 'which', { get: function () { return code } }) } catch (x) {}
    document.dispatchEvent(e)
  }
  function press(k) { held[k] = (held[k] || 0) + 1; if (held[k] === 1) send('keydown', KEY[k]) }
  function release(k) { if (!held[k]) return; held[k]--; if (held[k] === 0) send('keyup', KEY[k]) }
  function tap(k, ms) { press(k); return wait(ms || 45).then(function () { release(k) }) }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  var facing = 'right'   // last horizontal direction the player pushed
  var busy = false
  function runSeq(seq) {   // seq: array of key names, 'F' = forward, 'B' = back, '+' prefix = keep holding
    if (busy) return
    busy = true
    var p = Promise.resolve()
    seq.forEach(function (k) {
      p = p.then(function () {
        var key = k === 'F' ? facing : k === 'B' ? (facing === 'right' ? 'left' : 'right') : k
        return tap(key, 45).then(function () { return wait(30) })
      })
    })
    p.then(function () { busy = false }, function () { busy = false })
  }

  // ---- 3) move data (official LF2 v1.9 control guide) --------------------------
  // seq tokens: def/up/down/jump/att, F = forward (direction you last pushed)
  var COMBOS = {
    'D>A': ['def', 'F', 'att'], 'D^A': ['def', 'up', 'att'], 'DvA': ['def', 'down', 'att'],
    'D>J': ['def', 'F', 'jump'], 'D^J': ['def', 'up', 'jump'], 'DvJ': ['def', 'down', 'jump'],
    'DJA': ['def', 'jump', 'att'],
    'RUN': ['F', 'F'], 'RUN+A': ['F', 'F', 'att'], 'RUN+J': ['F', 'F', 'jump'],
    'D^JA': ['def', 'up', 'jump', 'att']
  }
  var CHARS = {
    'عام': { 'D>A': 'D→A', 'D^A': 'D↑A', 'DvA': 'D↓A', 'D>J': 'D→J', 'D^J': 'D↑J', 'DvJ': 'D↓J', 'DJA': 'DJA' },
    'Davis': { 'D>A': 'كرة طاقة', 'DvA': 'لكمات متتالية', 'D^A': 'لكمة التنين', 'D^JA': 'هجوم القفز' },
    'Dennis': { 'D>A': 'كرة طاقة', 'DvA': 'ركلات متتالية', 'D>J': 'ركلة الإعصار', 'D^A': 'الكرة المطاردة' },
    'Woody': { 'D^A': 'ركلة دوّارة', 'DvA': 'ركلة الالتفاف', 'D>A': 'كرة طاقة', 'D>J': 'اندفاع النمر', 'D^J': 'انتقال للعدو', 'DvJ': 'انتقال للصديق' },
    'Deep': { 'D>A': 'موجة طاقة', 'DvA': 'ضربة صاعدة', 'D>J': 'الاندفاع بالسيف', 'D^JA': 'هجوم القفز' },
    'John': { 'D>A': 'كرة طاقة', 'D>J': 'درع الطاقة', 'D^A': 'قرص الطاقة', 'D^J': 'علاج الآخرين', 'DvJ': 'علاج نفسه' },
    'Henry': { 'D>A': 'كف التنين', 'DJA': 'أسهم متعددة', 'D>J': 'السهم القاتل', 'D^J': 'سوناتا الموت' },
    'Rudolf': { 'D>J': 'هجوم القفز', 'D>A': 'نجوم النينجا', 'D^J': 'الاختفاء', 'DvJ': 'استنساخ', 'DJA': 'تحوّل (بعد الإمساك)' },
    'Louis': { 'RUN+A': 'لكمة الرعد', 'RUN+J': 'لكمة الرعد 2', 'D>J': 'ركلة الرعد', 'D^J': 'رمية الإعصار', 'D>A': 'كف العنقاء' },
    'Firen': { 'D>A': 'كرة نار', 'D>J': 'شعلة الجري', 'DvJ': 'الجحيم', 'D^J': 'انفجار' },
    'Freeze': { 'D>A': 'كرة جليد', 'DvJ': 'سيف الجليد', 'D>J': 'رماح الجليد', 'D^J': 'الإعصار الجليدي' },
    'Bandit': {},
    'Julian ★': { 'RUN+A': 'لكمة الروح', 'D^A': 'ضربة صاعدة', 'D>A': 'انفجار الجمجمة', 'DJA': 'صورة المرآة', 'D^J': 'الانفجار الكبير', 'D>J': 'قنبلة الروح' },
    'Firzen ★': { 'D>J': 'مدفع Firzen', 'D^A': 'الكارثة', 'D^J': 'البركان القطبي' },
    'LouisEX ★': { 'DvA': 'رقصة العنقاء', 'RUN+A': 'لكمة الرعد', 'RUN+J': 'لكمة الرعد 2', 'D>A': 'كف العنقاء' },
    'Bat ★': { 'D>J': 'لكمة السرعة', 'D>A': 'ليزر العين', 'D^J': 'استدعاء الخفافيش' },
    'Jan ★': { 'D^A': 'حكم الشيطان', 'D^J': 'بركة الملاك' },
    'Justin ★': { 'DvA': 'لكمة الذئب', 'D>A': 'كرة طاقة' },
    'Sorcerer ★': { 'D>J': 'كرة جليد', 'D>A': 'كرة نار', 'D^J': 'علاج الآخرين', 'DvJ': 'علاج نفسه' },
    'Jack ★': { 'D>A': 'كرة طاقة', 'D^A': 'الركلة الخاطفة' },
    'Mark ★': { 'D>A': 'لكمة التحطيم', 'D>J': 'هجوم الجسد' },
    'Monk ★': { 'D>A': 'كف شاولين' }
  }
  var CHAR_ORDER = ['عام', 'Davis', 'Dennis', 'Woody', 'Deep', 'John', 'Henry', 'Rudolf', 'Louis', 'Firen', 'Freeze',
    'Julian ★', 'Firzen ★', 'LouisEX ★', 'Bat ★', 'Jan ★', 'Justin ★', 'Sorcerer ★', 'Jack ★', 'Mark ★', 'Monk ★']

  var current = 'عام'
  try { current = localStorage.getItem('flf_touch_char') || 'عام' } catch (x) {}
  if (!CHARS[current]) current = 'عام'

  // ---- 4) UI --------------------------------------------------------------------
  var css = '' +
    '#flfpad{position:fixed;inset:0;z-index:99999;pointer-events:none;font-family:-apple-system,Helvetica,sans-serif;' +
    '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}' +
    '#flfpad .b{position:absolute;pointer-events:auto;touch-action:none;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'color:#fff;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.45);border-radius:50%;' +
    'font-weight:700;text-shadow:0 1px 2px #000;box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
    '#flfpad .b.on{background:rgba(255,120,160,.55);border-color:#ffb3cc}' +
    '#flfpad .A{background:rgba(230,60,60,.35)} #flfpad .J{background:rgba(60,160,230,.35)} #flfpad .D{background:rgba(80,200,90,.35)}' +
    '#flfpad .sp{border-radius:10px;font-size:11px;line-height:1.15;text-align:center;padding:2px;background:rgba(150,90,230,.22);border-color:rgba(255,255,255,.3);opacity:.85}' +
    '#flfpad .fk{border-radius:7px;font-size:11px;background:rgba(0,0,0,.35)}' +
    '#flfpad #dpad{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(255,255,255,.10),rgba(255,255,255,.05));border:2px solid rgba(255,255,255,.35)}' +
    '#flfpad #dpad span{position:absolute;color:rgba(255,255,255,.8);font-size:20px;font-weight:700}' +
    '#flfpad #knob{position:absolute;width:44%;height:44%;left:28%;top:28%;border-radius:50%;background:rgba(255,255,255,.28);pointer-events:none}' +
    '#flfpad #moves{position:absolute;pointer-events:auto;display:none;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'background:rgba(10,15,40,.95);color:#fff;border:2px solid #7a8cff;border-radius:12px;padding:10px;max-height:86vh;overflow:auto;width:min(560px,80vw);direction:rtl;font-size:13px}' +
    '#flfpad #moves button{margin:3px;padding:6px 10px;border-radius:8px;border:1px solid #7a8cff;background:#1b2560;color:#fff;font-size:13px}' +
    '#flfpad #moves button.sel{background:#7a8cff}' +
    '#flfpad #moves table{width:100%;border-collapse:collapse;margin-top:6px} #flfpad #moves td{border-bottom:1px solid #334;padding:4px}' +
    '#flfpad.hidden .b,#flfpad.hidden #dpad,#flfpad.hidden #vkb{opacity:.0;pointer-events:none} #flfpad.hidden #tog{opacity:1;pointer-events:auto}'
  css += '#flfpad #vkb{position:absolute;left:0;right:0;bottom:0;display:none;pointer-events:auto;background:rgba(10,12,30,.93);' +
    'padding:4px 4px 6px;border-top:2px solid #7a8cff;direction:ltr;touch-action:none}' +
    '#flfpad #vkb .r{display:flex;justify-content:center;margin:3px 0}' +
    '#flfpad #vkb .k{flex:0 0 auto;min-width:6.4%;margin:0 2px;padding:5px 0;border-radius:6px;background:#2a3370;color:#fff;' +
    'text-align:center;font-size:13px;font-weight:600;border:1px solid #556}' +
    '#flfpad #vkb .k.on{background:#ff78a0}'
  var st = document.createElement('style'); st.textContent = css

  var root = document.createElement('div'); root.id = 'flfpad'

  function mk(cls, label, x) { var d = document.createElement('div'); d.className = 'b ' + cls; d.innerHTML = label; root.appendChild(d); return d }

  // generic hold button
  function holdBtn(el, key) {
    var ids = {}
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); try { el.setPointerCapture(e.pointerId) } catch (x) {}
      ids[e.pointerId] = 1; el.classList.add('on'); press(key)
    })
    function up(e) { if (!ids[e.pointerId]) return; delete ids[e.pointerId]; el.classList.remove('on'); release(key) }
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up)
  }
  function tapBtn(el, fn) {
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); el.classList.add('on'); fn()
      setTimeout(function () { el.classList.remove('on') }, 150)
    })
  }

  // D-pad (8-way, slide your thumb)
  var dpad = document.createElement('div'); dpad.id = 'dpad'
  dpad.innerHTML = '<div id="knob"></div><span style="left:50%;top:4%;transform:translateX(-50%)">▲</span>' +
    '<span style="left:50%;bottom:4%;transform:translateX(-50%)">▼</span><span style="left:5%;top:50%;transform:translateY(-50%)">◀</span>' +
    '<span style="right:5%;top:50%;transform:translateY(-50%)">▶</span>'
  root.appendChild(dpad)
  var knob = dpad.querySelector('#knob')
  var dState = { up: 0, down: 0, left: 0, right: 0 }, dId = null
  function setDir(nx, ny) {
    var want = { up: ny < -0.38, down: ny > 0.38, left: nx < -0.38, right: nx > 0.38 }
    for (var k in want) {
      if (want[k] && !dState[k]) { dState[k] = 1; press(k); if (k === 'left' || k === 'right') facing = k }
      else if (!want[k] && dState[k]) { dState[k] = 0; release(k) }
    }
  }
  function dMove(e) {
    var r = dpad.getBoundingClientRect(), R = r.width / 2
    var nx = (e.clientX - r.left - R) / R, ny = (e.clientY - r.top - R) / R
    var m = Math.sqrt(nx * nx + ny * ny); if (m > 1) { nx /= m; ny /= m }
    knob.style.transform = 'translate(' + (nx * R * 0.5) + 'px,' + (ny * R * 0.5) + 'px)'
    setDir(nx, ny)
  }
  dpad.addEventListener('pointerdown', function (e) { e.preventDefault(); dId = e.pointerId; try { dpad.setPointerCapture(e.pointerId) } catch (x) {} dMove(e) })
  dpad.addEventListener('pointermove', function (e) { if (e.pointerId === dId) dMove(e) })
  function dEnd(e) { if (e.pointerId !== dId) return; dId = null; knob.style.transform = ''; setDir(0, 0) }
  dpad.addEventListener('pointerup', dEnd); dpad.addEventListener('pointercancel', dEnd); dpad.addEventListener('lostpointercapture', dEnd)

  // action buttons
  var bA = mk('A', 'A<br><small>ضرب</small>'), bJ = mk('J', 'J<br><small>قفز</small>'), bD = mk('D', 'D<br><small>دفاع</small>')
  holdBtn(bA, 'att'); holdBtn(bJ, 'jump'); holdBtn(bD, 'def')

  // special move buttons (6 slots, relabelled per character)
  var spBtns = []
  for (var i = 0; i < 7; i++) { var s = mk('sp', ''); spBtns.push(s) }
  var runBtn = mk('sp', 'ركض<br>→→')
  tapBtn(runBtn, function () { runSeq(COMBOS.RUN) })

  // function keys
  var fkeys = [['esc', 'Esc'], ['F1', '⏸'], ['F4', '↻'], ['F7', '❤'], ['F6', 'MP∞'], ['F8', 'أسلحة']]
  var fkBtns = fkeys.map(function (f) { var b = mk('fk', f[1]); tapBtn(b, function () { tap(f[0], 60) }); return b })
  var helpBtn = mk('fk', 'الحركات'); var tog = mk('fk', '👁'); tog.id = 'tog'
  tapBtn(tog, function () { root.classList.toggle('hidden') })

  // full virtual keyboard: every key goes straight to the game as a real key press
  var stageBtn = mk('fk', '🗺️ مراحل')
  tapBtn(stageBtn, function () { if (window.flfStage) window.flfStage.open() })
  var trophyBtn = mk('fk', '🏆 بطولة')
  tapBtn(trophyBtn, function () { if (window.flfTournament) window.flfTournament.open() })
  var kbBtn = mk('fk', '⌨')
  var vkb = document.createElement('div'); vkb.id = 'vkb'; root.appendChild(vkb)
  var KB_ROWS = [
    [['Esc', 27], ['F1', 112], ['F2', 113], ['F3', 114], ['F4', 115], ['F5', 116], ['F6', 117], ['F7', 118], ['F8', 119], ['F9', 120], ['F10', 121], ['⌫', 8]],
    '1234567890-='.split(''),
    'QWERTYUIOP[]'.split(''),
    'ASDFGHJKL;\'\\'.split(''),
    'ZXCVBNM,./'.split('').concat([['Enter', 13]]),
    [['Shift', 16], ['Ctrl', 17], ['Tab', 9], ['Space', 32, 3], ['←', 37], ['↑', 38], ['↓', 40], ['→', 39], ['إخفاء', 0]]
  ]
  var SYM = { '-': 189, '=': 187, '[': 219, ']': 221, ';': 186, "'": 222, ',': 188, '.': 190, '/': 191, '\\': 220 }
  KB_ROWS.forEach(function (row) {
    var r = document.createElement('div'); r.className = 'r'
    row.forEach(function (k) {
      var label, code, grow = 1
      if (typeof k === 'string') { label = k; code = SYM[k] || k.charCodeAt(0) } else { label = k[0]; code = k[1]; grow = k[2] || 1 }
      var el = document.createElement('div'); el.className = 'k'; el.textContent = label
      if (grow > 1) el.style.minWidth = (6.4 * grow) + '%'
      if (label === 'Enter' || label === 'Shift' || label === 'إخفاء') el.style.minWidth = '11%'
      var on = false
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation()
        if (!code) { vkb.style.display = 'none'; return }
        try { el.setPointerCapture(e.pointerId) } catch (x) {}
        on = true; el.classList.add('on'); send('keydown', code)
        if (code === 37 || code === 39) facing = code === 37 ? 'left' : 'right'
      })
      function up() { if (!on) return; on = false; el.classList.remove('on'); send('keyup', code) }
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up)
      r.appendChild(el)
    })
    vkb.appendChild(r)
  })
  tapBtn(kbBtn, function () { vkb.style.display = vkb.style.display === 'block' ? 'none' : 'block' })

  // move list panel
  var panel = document.createElement('div'); panel.id = 'moves'; root.appendChild(panel)
  tapBtn(helpBtn, function () { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; renderPanel() })
  panel.addEventListener('pointerdown', function (e) { e.stopPropagation() })

  var SEQ_TXT = { 'D>A': 'D → A', 'D^A': 'D ↑ A', 'DvA': 'D ↓ A', 'D>J': 'D → J', 'D^J': 'D ↑ J', 'DvJ': 'D ↓ J', 'DJA': 'D J A',
    'RUN': '→ →', 'RUN+A': '→ → A', 'RUN+J': '→ → J', 'D^JA': 'D ↑ J A' }

  function renderPanel() {
    var h = '<b>اختر شخصيتك</b> (أزرار الحركات الخاصة تتغير حسبها):<br>'
    CHAR_ORDER.forEach(function (c) { h += '<button data-c="' + c + '" class="' + (c === current ? 'sel' : '') + '">' + c + '</button>' })
    h += '<table>'
    var m = CHARS[current]
    for (var k in m) h += '<tr><td>' + m[k] + '</td><td dir="ltr" style="text-align:left">' + SEQ_TXT[k] + '</td></tr>'
    h += '</table><div style="margin-top:8px;opacity:.85;line-height:1.6">' +
      '<b>★ الشخصيات المخفية</b> موجودة في قائمة الاختيار بعد Davis (ما عدا «صورة المرآة» عند Julian لأن المحرك لا يدعمها).<br>' +
      '<b>حركات عامة/سرية لكل الشخصيات:</b><br>' +
      'ركض: → → (اضغط مرتين) • ضربة الركض: ركض ثم A • قفزة طويلة (Dash): ركض ثم J<br>' +
      'تدحرج: أثناء الركض اضغط D • ضربة جوية: J ثم A<br>' +
      'إمساك الخصم: اقترب من خصم مترنح واضغط A • رمي: أمسكه ثم اتجاه + A • التقاط سلاح: A بجانبه • رمي السلاح: ركض + A<br>' +
      'الاتجاه "→" في الأزرار = آخر اتجاه حرّكت إليه شخصيتك.<br>' +
      '⏸ إيقاف (F1) • ↻ إعادة (F4) • ❤ استعادة الطاقة (F7) • MP∞ طاقة لا نهائية (F6) • أسلحة من السماء (F8). F5–F9 لا تعمل في Stage mode.</div>' +
      '<button data-close="1" style="margin-top:8px">إغلاق</button>'
    panel.innerHTML = h
    Array.prototype.forEach.call(panel.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.close) { panel.style.display = 'none'; return }
        current = b.dataset.c; try { localStorage.setItem('flf_touch_char', current) } catch (x) {}
        labelSpecials(); layout(); renderPanel()
      })
    })
  }

  var spAssign = []
  function labelSpecials() {
    var m = CHARS[current], keys = Object.keys(m)
    if (current === 'عام') keys = ['D>A', 'D^A', 'DvA', 'D>J', 'D^J', 'DvJ', 'DJA']
    spBtns.forEach(function (b, i) {
      var k = keys[i]
      spAssign[i] = k
      if (k) { b.style.display = 'flex'; b.innerHTML = (current === 'عام' ? '' : m[k] + '<br>') + '<span dir="ltr">' + SEQ_TXT[k] + '</span>' }
      else b.style.display = 'none'
    })
  }
  spBtns.forEach(function (b, i) { tapBtn(b, function () { if (spAssign[i]) runSeq(COMBOS[spAssign[i]]) }) })

  // layout
  function place(el, x, y, w, h) { el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = (h || w) + 'px' }
  function layout() {
    var W = window.innerWidth, H = window.innerHeight
    var s = Math.min(H, W) / 390                        // scale relative to iPhone landscape height
    var safeL = 10 * s, safeR = 10 * s
    // d-pad bottom-left
    var dp = 150 * s
    place(dpad, safeL + 14 * s, H - dp - 14 * s, dp)
    // A/J/D cluster bottom-right
    var bs = 64 * s, bx = W - safeR - bs
    place(bA, bx - bs - 8 * s, H - bs - 14 * s, bs)
    place(bJ, bx, H - bs * 1.6 - 14 * s, bs)
    place(bD, bx - bs * 2 - 16 * s, H - bs * 1.6 - 14 * s, bs)
    // specials: column grid above the action buttons (right side)
    var sw = 70 * s, sh = 34 * s, gap = 6 * s
    var top = 44 * s
    spBtns.filter(function (b, i) { return !!spAssign[i] }).concat([runBtn]).forEach(function (b, i) {
      var col = i % 2, row = Math.floor(i / 2)
      place(b, W - safeR - (2 - col) * (sw + gap), top + row * (sh + gap), sw, sh)
    })
    // function keys top-left
    var fw = 46 * s, fh = 28 * s
    var fx = safeL
    fkBtns.concat([stageBtn, trophyBtn, kbBtn, helpBtn, tog]).forEach(function (b, i) { var ww = (b === helpBtn || b === trophyBtn || b === stageBtn) ? 64 * s : fw; place(b, fx, 6 * s, ww, fh); fx += ww + 4 * s })
    root.style.fontSize = (14 * s) + 'px'
    Array.prototype.forEach.call(vkb.querySelectorAll('.k'), function (k) { k.style.fontSize = (13 * s) + 'px'; k.style.padding = (5 * s) + 'px 0' })
    Array.prototype.forEach.call(root.querySelectorAll('.A,.J,.D'), function (b) { b.style.fontSize = (17 * s) + 'px' })
  }

  function mount() {
    if (!document.body) return setTimeout(mount, 50)
    document.head.appendChild(st); document.body.appendChild(root)
    labelSpecials(); layout()
    window.addEventListener('resize', layout); window.addEventListener('orientationchange', function () { setTimeout(layout, 300) })
    // stop page pinch / double-tap zoom & rubber-banding while playing
    document.addEventListener('touchmove', function (e) { if (e.target.closest && e.target.closest('#moves')) return; e.preventDefault() }, { passive: false })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount()

  // release everything if app goes to background
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) for (var k in held) { while (held[k]) release(k) }
  })
  window.flfTouch = { tap: tap, runSeq: runSeq, press: press, release: release }
})()
