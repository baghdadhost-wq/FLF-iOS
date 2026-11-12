/* LF2 (v86 / Windows 95) touch controls — on-screen pad, special-move buttons and full keyboard.
 * Sends PC scancodes straight into the emulated keyboard (window.emulator).
 * Keys come from this LF2 image's data/control.txt (the WASD player):
 *   up W, down X, left A, right D, attack S, jump Tab, defend `
 */
(function () {
  'use strict'
  if (window.__lf2Touch) return
  window.__lf2Touch = true

  // ---- 2) key sending ------------------------------------------------------------
  // set-1 scancodes; values > 0xFF are extended (0xE0 prefix)
  var KEY = { up: 0x11, down: 0x2D, left: 0x1E, right: 0x20, att: 0x1F, jump: 0x0F, def: 0x29,
    esc: 0x01, F1: 0x3B, F2: 0x3C, F3: 0x3D, F4: 0x3E, F5: 0x3F, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44 }
  var held = {}          // key -> number of sources holding it
  function send(type, code) {
    var em = window.emulator
    if (!em || !em.keyboard_send_scancodes) return
    var brk = type === 'keyup' ? 0x80 : 0
    if (code > 0xFF) em.keyboard_send_scancodes([0xE0, (code & 0xFF) | brk])
    else em.keyboard_send_scancodes([code | brk])
  }
  // LF2 polls key state once per frame, so every press is held at least MIN_HOLD ms
  var MIN_HOLD = 90, downAt = {}
  function press(k) { held[k] = (held[k] || 0) + 1; if (held[k] === 1) { downAt[k] = Date.now(); send('keydown', KEY[k]) } }
  function release(k) {
    if (!held[k]) return
    var left = MIN_HOLD - (Date.now() - (downAt[k] || 0))
    if (left > 0) { setTimeout(function () { release(k) }, left); return }
    held[k]--; if (held[k] === 0) send('keyup', KEY[k])
  }
  function tap(k, ms) { press(k); return wait(ms || 80).then(function () { release(k) }) }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  // special-move input speed (emulated PC speed differs per iPhone)
  var TIMING = { 'سريع': [70, 45], 'عادي': [110, 60], 'بطيء': [170, 90] }
  var speed = 'عادي'
  try { speed = localStorage.getItem('lf2_touch_speed') || 'عادي' } catch (x) {}
  var facing = 'right'   // last horizontal direction the player pushed
  var busy = false
  function runSeq(seq) {   // seq: array of key names, 'F' = forward, 'B' = back, '+' prefix = keep holding
    if (busy) return
    busy = true
    var p = Promise.resolve()
    seq.forEach(function (k) {
      p = p.then(function () {
        var key = k === 'F' ? facing : k === 'B' ? (facing === 'right' ? 'left' : 'right') : k
        var T = TIMING[speed] || TIMING['عادي']; return tap(key, T[0]).then(function () { return wait(T[1]) })
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
    'Louis': { 'RUN+A': 'لكمة الرعد', 'RUN+J': 'لكمة الرعد 2', 'D>J': 'ركلة الرعد', 'D^J': 'رمية الإعصار', 'D>A': 'كف العنقاء', 'DJA': 'خلع الدرع ← LouisEX (طاقة قليلة)' },
    'Firen': { 'D>A': 'كرة نار', 'D>J': 'شعلة الجري', 'DvJ': 'الجحيم', 'D^J': 'انفجار' },
    'Freeze': { 'D>A': 'كرة جليد', 'DvJ': 'سيف الجليد', 'D>J': 'رماح الجليد', 'D^J': 'الإعصار الجليدي' },
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
  try { current = localStorage.getItem('lf2_touch_char') || 'عام' } catch (x) {}
  if (!CHARS[current]) current = 'عام'

  // ---- 4) UI --------------------------------------------------------------------
  var css = '' +
    '#lf2pad{position:fixed;inset:0;z-index:99999;pointer-events:none;font-family:-apple-system,Helvetica,sans-serif;' +
    '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}' +
    '#lf2pad .b{position:absolute;pointer-events:auto;touch-action:none;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'color:#fff;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.45);border-radius:50%;' +
    'font-weight:700;text-shadow:0 1px 2px #000;box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
    '#lf2pad .b.on{background:rgba(255,120,160,.55);border-color:#ffb3cc}' +
    '#lf2pad .A{background:rgba(230,60,60,.35)} #lf2pad .J{background:rgba(60,160,230,.35)} #lf2pad .D{background:rgba(80,200,90,.35)}' +
    '#lf2pad .sp{border-radius:10px;font-size:11px;line-height:1.15;text-align:center;padding:2px;background:rgba(150,90,230,.22);border-color:rgba(255,255,255,.3);opacity:.85}' +
    '#lf2pad .fk{border-radius:7px;font-size:11px;background:rgba(0,0,0,.35)}' +
    '#lf2pad #dpad{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(255,255,255,.10),rgba(255,255,255,.05));border:2px solid rgba(255,255,255,.35)}' +
    '#lf2pad #dpad span{position:absolute;color:rgba(255,255,255,.8);font-size:20px;font-weight:700}' +
    '#lf2pad #knob{position:absolute;width:44%;height:44%;left:28%;top:28%;border-radius:50%;background:rgba(255,255,255,.28);pointer-events:none}' +
    '#lf2pad #moves{position:absolute;pointer-events:auto;display:none;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'background:rgba(10,15,40,.95);color:#fff;border:2px solid #7a8cff;border-radius:12px;padding:10px;max-height:86vh;overflow:auto;width:min(560px,80vw);direction:rtl;font-size:13px}' +
    '#lf2pad #moves button{margin:3px;padding:6px 10px;border-radius:8px;border:1px solid #7a8cff;background:#1b2560;color:#fff;font-size:13px}' +
    '#lf2pad #moves button.sel{background:#7a8cff}' +
    '#lf2pad #moves table{width:100%;border-collapse:collapse;margin-top:6px} #lf2pad #moves td{border-bottom:1px solid #334;padding:4px}' +
    '#lf2pad.hidden .b,#lf2pad.hidden #dpad,#lf2pad.hidden #vkb{opacity:.0;pointer-events:none} #lf2pad.hidden #tog{opacity:1;pointer-events:auto}'
  css += '#lf2pad #vkb{position:absolute;left:0;right:0;bottom:0;display:none;pointer-events:auto;background:rgba(10,12,30,.93);' +
    'padding:4px 4px 6px;border-top:2px solid #7a8cff;direction:ltr;touch-action:none}' +
    '#lf2pad #vkb .r{display:flex;justify-content:center;margin:3px 0}' +
    '#lf2pad #vkb .k{flex:0 0 auto;min-width:6.4%;margin:0 2px;padding:5px 0;border-radius:6px;background:#2a3370;color:#fff;' +
    'text-align:center;font-size:13px;font-weight:600;border:1px solid #556}' +
    '#lf2pad #vkb .k.on{background:#ff78a0}'
  var st = document.createElement('style'); st.textContent = css

  var root = document.createElement('div'); root.id = 'lf2pad'

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
  var kbBtn = mk('fk', '⌨')
  // reveal hidden characters: type "lf2.net" on the character-select screen
  var secretBtn = mk('fk', 'كشف ★')
  tapBtn(secretBtn, function () {
    if (busy) return
    busy = true
    var p = Promise.resolve()
    'lf2.net'.toUpperCase().split('').forEach(function (ch) {
      p = p.then(function () { send('keydown', SC[ch]); return wait(70) })
        .then(function () { send('keyup', SC[ch]); return wait(70) })
    })
    p.then(function () { busy = false })
  })
  var vkb = document.createElement('div'); vkb.id = 'vkb'; root.appendChild(vkb)
  var KB_ROWS = [
    [['Esc', 0x01], ['F1', 0x3B], ['F2', 0x3C], ['F3', 0x3D], ['F4', 0x3E], ['F5', 0x3F], ['F6', 0x40], ['F7', 0x41], ['F8', 0x42], ['F9', 0x43], ['F10', 0x44], ['⌫', 0x0E]],
    '1234567890-='.split(''),
    'QWERTYUIOP[]'.split(''),
    'ASDFGHJKL;\'\\'.split(''),
    'ZXCVBNM,./'.split('').concat([['Enter', 0x1C]]),
    [['Shift', 0x2A], ['Ctrl', 0x1D], ['Alt', 0x38], ['Tab', 0x0F], ['Space', 0x39, 3], ['←', 0x14B], ['↑', 0x148], ['↓', 0x150], ['→', 0x14D], ['إخفاء', 0]]
  ]
  var SC = {}
  ;['1234567890-=', 'QWERTYUIOP[]', 'ASDFGHJKL;\'`', 'ZXCVBNM,./'].forEach(function (row, r) {
    var base = [0x02, 0x10, 0x1E, 0x2C][r]
    row.split('').forEach(function (ch, i) { SC[ch] = base + i })
  })
  SC['\\'] = 0x2B
  var SYM = SC
  KB_ROWS.forEach(function (row) {
    var r = document.createElement('div'); r.className = 'r'
    row.forEach(function (k) {
      var label, code, grow = 1
      if (typeof k === 'string') { label = k; code = SC[k] } else { label = k[0]; code = k[1]; grow = k[2] || 1 }
      var el = document.createElement('div'); el.className = 'k'; el.textContent = label
      if (grow > 1) el.style.minWidth = (6.4 * grow) + '%'
      if (label === 'Enter' || label === 'Shift' || label === 'إخفاء') el.style.minWidth = '11%'
      var on = false
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation()
        if (!code) { vkb.style.display = 'none'; return }
        try { el.setPointerCapture(e.pointerId) } catch (x) {}
        on = true; t0 = Date.now(); el.classList.add('on'); send('keydown', code)
        if (code === 0x14B || code === 0x14D) facing = code === 0x14B ? 'left' : 'right'
      })
      var t0 = 0
      function up() {
        if (!on) return; on = false; el.classList.remove('on')
        var left = MIN_HOLD - (Date.now() - t0)
        setTimeout(function () { send('keyup', code) }, Math.max(0, left))
      }
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
    h += '</table><div style="margin-top:8px"><b>سرعة إدخال الحركات:</b> '
    Object.keys(TIMING).forEach(function (k) { h += '<button data-sp="' + k + '" class="' + (k === speed ? 'sel' : '') + '">' + k + '</button>' })
    h += '<br><small>إذا لم تخرج الحركة الخاصة جرّب «بطيء»، وإذا كانت بطيئة جرّب «سريع».</small></div>'
    h += '<div style="margin-top:8px;opacity:.85;line-height:1.6">' +
      '<b>الشخصيات المخفية ★:</b> في شاشة اختيار الشخصيات اضغط زر «كشف ★» (يكتب lf2.net) فتظهر كل الشخصيات. ' +
      'Louis يتحول إلى LouisEX بالضغط على D+J+A معاً عندما تكون طاقته قليلة. Firen وFreeze في نفس الفريق ويركضان نحو بعض بطاقة قليلة → Firzen.<br>' +
      '<b>حركات عامة/سرية لكل الشخصيات:</b><br>' +
      'ركض: → → (اضغط مرتين) • ضربة الركض: ركض ثم A • قفزة طويلة (Dash): ركض ثم J<br>' +
      'تدحرج: أثناء الركض اضغط D • ضربة جوية: J ثم A<br>' +
      'إمساك الخصم: اقترب من خصم مترنح واضغط A • رمي: أمسكه ثم اتجاه + A • التقاط سلاح: A بجانبه • رمي السلاح: ركض + A<br>' +
      'الاتجاه "→" في الأزرار = آخر اتجاه حرّكت إليه شخصيتك.<br>' +
      '⏸ إيقاف (F1) • ↻ إعادة (F4) • ❤ استعادة الطاقة (F7) • MP∞ طاقة لا نهائية (F6) • أسلحة من السماء (F8). F5–F9 لا تعمل في Stage mode.<br>' +
      'في القائمة الرئيسية: F1–F8 لاختيار نمط اللعب، أو استخدم ⌨ والأسهم وEnter.</div>' +
      '<button data-close="1" style="margin-top:8px">إغلاق</button>'
    panel.innerHTML = h
    Array.prototype.forEach.call(panel.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.close) { panel.style.display = 'none'; return }
        if (b.dataset.sp) { speed = b.dataset.sp; try { localStorage.setItem('lf2_touch_speed', speed) } catch (x) {} renderPanel(); return }
        current = b.dataset.c; try { localStorage.setItem('lf2_touch_char', current) } catch (x) {}
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
    var dp = 140 * s
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
    // function keys: 2-column grid in the left margin (outside the 4:3 game picture)
    var gameW = H * 4 / 3, marginL = Math.max(0, (W - gameW) / 2)
    var cols = 2, fw2 = Math.max(58 * s, (marginL - safeL - 8 * s) / cols - 4 * s), fh2 = 28 * s
    var list = fkBtns.concat([secretBtn, kbBtn, helpBtn, tog])
    if (marginL < 120 * s) {   // narrow screen (iPad): fall back to a top row
      var fx = safeL
      list.forEach(function (b) { place(b, fx, 6 * s, 50 * s, fh2); fx += 54 * s })
    } else {
      list.forEach(function (b, i) { place(b, safeL + (i % cols) * (fw2 + 4 * s), 6 * s + Math.floor(i / cols) * (fh2 + 4 * s), fw2, fh2) })
    }
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
    if (document.hidden) for (var k in held) { if (held[k]) { held[k] = 0; send('keyup', KEY[k]) } }
  })
  window.lf2Touch = { tap: tap, runSeq: runSeq, press: press, release: release }
})()
