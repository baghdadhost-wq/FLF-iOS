/* Windows (v86) touch UI: trackpad mouse, toolbar, PC keyboard, CD-ROM (ISO) and phone-file transfer. */
(function () {
  'use strict'
  var EM = null
  var css = '' +
    '#wui{position:fixed;inset:0;z-index:9000;pointer-events:none;font-family:-apple-system,sans-serif;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
    '#wpad{position:absolute;inset:0;pointer-events:auto;touch-action:none}' +
    '#wbar{position:absolute;left:6px;top:6px;display:flex;flex-wrap:wrap;gap:5px;max-width:calc(100vw - 12px);pointer-events:auto;direction:rtl}' +
    '#wbar button{font-size:13px;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.55);background:rgba(20,30,60,.72);color:#fff}' +
    '#wbar button.on{background:#e0502f}' +
    '#wui.min #wbar button:not(#wtog){display:none}' +
    '#wkb{position:absolute;left:0;right:0;bottom:0;display:none;pointer-events:auto;background:rgba(12,14,30,.95);padding:4px 3px 6px;border-top:2px solid #7a8cff;direction:ltr;touch-action:none}' +
    '#wkb .r{display:flex;justify-content:center;margin:3px 0}' +
    '#wkb .k{flex:0 0 auto;min-width:6.2%;margin:0 2px;padding:6px 0;border-radius:6px;background:#2a3370;color:#fff;text-align:center;font-size:13px;font-weight:600;border:1px solid #556}' +
    '#wkb .k.on{background:#ff78a0}#wkb .k.mod.lock{background:#e0a02f;color:#1a1000}' +
    '#wtoast{position:absolute;left:50%;top:48px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:10px;font-size:14px;display:none;direction:rtl;text-align:center;max-width:80vw}'
  var root, pad, bar, kb, toast
  function el(tag, attrs, parent) { var e = document.createElement(tag); for (var k in attrs) e[k] = attrs[k]; if (parent) parent.appendChild(e); return e }
  var toastT
  function say(t, ms) { toast.innerHTML = t; toast.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(function () { toast.style.display = 'none' }, ms || 3500) }

  // ---------- keyboard (PC set-1 scancodes; > 0xFF = extended E0 prefix) ----------
  function sc(code, up) {
    if (!EM) return
    var b = up ? 0x80 : 0
    if (code > 0xFF) EM.keyboard_send_scancodes([0xE0, (code & 0xFF) | b])
    else EM.keyboard_send_scancodes([code | b])
  }
  function tapKey(code) { sc(code, false); setTimeout(function () { sc(code, true) }, 60) }
  function combo(codes) {          // press in order, release in reverse
    codes.forEach(function (c) { sc(c, false) })
    setTimeout(function () { codes.slice().reverse().forEach(function (c) { sc(c, true) }) }, 90)
  }
  var SC = {}
  ;['1234567890-=', 'QWERTYUIOP[]', "ASDFGHJKL;'`", 'ZXCVBNM,./'].forEach(function (row, r) {
    var base = [0x02, 0x10, 0x1E, 0x2C][r]
    row.split('').forEach(function (ch, i) { SC[ch] = base + i })
  })
  SC['\\'] = 0x2B
  var MOD = { Shift: 0x2A, Ctrl: 0x1D, Alt: 0x38, Win: 0x15B }
  var modOn = {}
  var KB_ROWS = [
    [['Esc', 0x01], ['F1', 0x3B], ['F2', 0x3C], ['F3', 0x3D], ['F4', 0x3E], ['F5', 0x3F], ['F6', 0x40], ['F7', 0x41], ['F8', 0x42], ['F9', 0x43], ['F10', 0x44], ['F11', 0x57], ['F12', 0x58], ['Del', 0x153]],
    '`1234567890-='.split('').concat([['⌫', 0x0E, 1.4]]),
    [['Tab', 0x0F, 1.3]].concat('QWERTYUIOP[]\\'.split('')),
    [['Caps', 0x3A, 1.5]].concat("ASDFGHJKL;'".split('')).concat([['Enter', 0x1C, 1.8]]),
    [['Shift', 'Shift', 2]].concat('ZXCVBNM,./'.split('')).concat([['↑', 0x148], ['Home', 0x147], ['End', 0x14F]]),
    [['Ctrl', 'Ctrl', 1.4], ['Win', 'Win', 1.3], ['Alt', 'Alt', 1.3], ['Space', 0x39, 5], ['←', 0x14B], ['↓', 0x150], ['→', 0x14D], ['PgUp', 0x149], ['PgDn', 0x151], ['إخفاء', 0, 1.6]]
  ]
  function buildKeyboard() {
    KB_ROWS.forEach(function (row) {
      var r = el('div', { className: 'r' }, kb)
      row.forEach(function (k) {
        var label, code, w = 1
        if (typeof k === 'string') { label = k; code = SC[k] } else { label = k[0]; code = k[1]; w = k[2] || 1 }
        var e = el('div', { className: 'k', textContent: label }, r)
        e.style.minWidth = (6.2 * w) + '%'
        if (typeof code === 'string') {          // sticky modifier
          e.classList.add('mod')
          e.addEventListener('pointerdown', function (ev) {
            ev.preventDefault()
            if (modOn[code]) { modOn[code] = false; e.classList.remove('lock'); sc(MOD[code], true) } else { modOn[code] = true; e.classList.add('lock'); sc(MOD[code], false) }
          })
          return
        }
        e.addEventListener('pointerdown', function (ev) {
          ev.preventDefault()
          if (!code) { kb.style.display = 'none'; btnKb.classList.remove('on'); return }
          e.classList.add('on'); sc(code, false)
        })
        function up() {
          if (!e.classList.contains('on')) return
          e.classList.remove('on'); setTimeout(function () { sc(code, true); releaseMods() }, 40)
        }
        e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up); e.addEventListener('pointerleave', up)
      })
    })
  }
  function releaseMods() {
    for (var m in modOn) if (modOn[m]) { modOn[m] = false; sc(MOD[m], true) }
    kb.querySelectorAll('.mod.lock').forEach(function (e) { e.classList.remove('lock') })
  }

  // ---------- mouse (touch trackpad) ----------
  var buttons = [false, false, false], dragLock = false
  function sendButtons() { if (EM) EM.bus.send('mouse-click', buttons.slice()) }
  function click(btn) { buttons[btn] = true; sendButtons(); setTimeout(function () { buttons[btn] = false; sendButtons() }, 70) }
  var pdx = 0, pdy = 0
  function move(dx, dy) { pdx += dx; pdy += dy }
  // queued packets (direct touch) go first, then trackpad movement; one small packet per tick
  var Q = []
  setInterval(function () {
    if (!EM) return
    for (var n = 0; n < 2 && Q.length; n++) {
      var q = Q.shift()
      if (typeof q === 'function') { q(); continue }
      EM.bus.send('mouse-delta', [q[0], -q[1]])
    }
    if (Q.length || (!pdx && !pdy)) return
    var sx = Math.max(-60, Math.min(60, pdx)), sy = Math.max(-60, Math.min(60, pdy))
    pdx -= sx; pdy -= sy
    EM.bus.send('mouse-delta', [sx, -sy])
  }, 12)

  // ---------- direct touch: the pointer jumps to the finger ----------
  // Needs Windows pointer speed 1:1 (Mouse > Pointer Options: middle speed, "Enhance pointer precision" off).
  var direct = false
  function guestPoint(x, y) {
    var c = document.querySelector('#screen_container canvas'); if (!c) return null
    var r = c.getBoundingClientRect(); if (!r.width) return null
    return { x: Math.max(0, Math.min(c.width - 1, Math.round((x - r.left) / r.width * c.width))),
             y: Math.max(0, Math.min(c.height - 1, Math.round((y - r.top) / r.height * c.height))) }
  }
  function moveTo(p, then) {
    pdx = pdy = 0; Q.length = 0
    for (var i = 0; i < 14; i++) Q.push([-120, -120])        // to the top-left corner
    var x = p.x, y = p.y
    while (x > 0 || y > 0) { var a = Math.min(60, x), b = Math.min(60, y); Q.push([a, b]); x -= a; y -= b }
    if (then) Q.push(then)
  }
  function speed() {
    var c = document.querySelector('#screen_container canvas')
    var shown = c ? c.getBoundingClientRect().width : innerWidth
    var real = c && c.width ? c.width : 640
    return (real / shown) * 1.25
  }
  function setupPad() {
    var touches = {}, start = null, moved = 0, maxFingers = 0, last2 = null, longT = null, holding = false
    pad.addEventListener('touchstart', function (e) {
      e.preventDefault()
      for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; touches[t.identifier] = { x: t.clientX, y: t.clientY } }
      var n = Object.keys(touches).length
      if (n === 1 && direct) {
        var t0 = e.changedTouches[0], gp = guestPoint(t0.clientX, t0.clientY)
        if (gp) moveTo(gp)
      }
      if (n === 1) {
        start = Date.now(); moved = 0; maxFingers = 1
        clearTimeout(longT)
        longT = setTimeout(function () {           // long-press: hold the left button (drag)
          if (moved < 10 && Object.keys(touches).length === 1) { holding = true; buttons[0] = true; sendButtons(); say('🖱️ سحب… ارفع إصبعك للإفلات', 1500) }
        }, 550)
      } else { maxFingers = Math.max(maxFingers, n); clearTimeout(longT); last2 = null }
    }, { passive: false })
    pad.addEventListener('touchmove', function (e) {
      e.preventDefault()
      var n = Object.keys(touches).length, k = direct ? speed() / 1.25 : speed()
      if (n >= 2) {                                // two fingers: scroll wheel
        var t = e.touches[0], y = t.clientY
        if (last2 !== null && Math.abs(y - last2) > 12) { if (EM) EM.bus.send('mouse-wheel', [y > last2 ? -1 : 1, 0]); last2 = y; moved += 20 }
        if (last2 === null) last2 = y
        return
      }
      for (var i = 0; i < e.changedTouches.length; i++) {
        var c = e.changedTouches[i], p = touches[c.identifier]; if (!p) continue
        var dx = c.clientX - p.x, dy = c.clientY - p.y
        moved += Math.abs(dx) + Math.abs(dy)
        move(Math.round(dx * k), Math.round(dy * k))
        p.x = c.clientX; p.y = c.clientY
      }
    }, { passive: false })
    function end(e) {
      e.preventDefault()
      for (var i = 0; i < e.changedTouches.length; i++) delete touches[e.changedTouches[i].identifier]
      if (Object.keys(touches).length) return
      clearTimeout(longT)
      var quick = Date.now() - start < 260
      if (holding) { holding = false; if (!dragLock) { buttons[0] = false; sendButtons() } }
      else if (direct && moved < 12 && maxFingers < 2) { if (!dragLock) Q.push(function () { click(0) }) }
      else if (quick && moved < 12) { if (maxFingers >= 2) Q.length ? Q.push(function () { click(2) }) : click(2); else if (!dragLock) click(0) }
      last2 = null
    }
    pad.addEventListener('touchend', end, { passive: false })
    pad.addEventListener('touchcancel', end, { passive: false })
  }

  // ---------- CD-ROM ----------
  var cdName = ''
  function insertCD(file, label) {
    if (!EM) return
    try {
      if (EM.eject_cdrom) { try { EM.eject_cdrom() } catch (e) {} }
      EM.set_cdrom({ buffer: file, async: true })
      cdName = label
      say('💿 تم إدخال القرص في محرك الأقراص (D:)<br><small>' + label + '</small><br>افتح My Computer ثم القرص D:', 5000)
    } catch (e) { say('تعذّر إدخال القرص: ' + e.message, 5000) }
  }
  function pickISO() {
    var inp = el('input', { type: 'file', accept: '.iso,.img,.bin,application/x-iso9660-image,application/octet-stream' })
    inp.onchange = function () { var f = inp.files[0]; if (f) insertCD(f, f.name + ' (' + Math.round(f.size / 1048576) + ' MB)') }
    inp.click()
  }
  function pickFiles() {
    var inp = el('input', { type: 'file', multiple: true })
    inp.onchange = function () {
      var fs = Array.prototype.slice.call(inp.files || [])
      if (!fs.length) return
      say('جارِ تجهيز قرص بالملفات…', 2000)
      window.buildISO(fs, 'PHONE').then(function (blob) {
        var f = new File([blob], 'phone-files.iso')
        insertCD(f, fs.length + ' ملف من الهاتف')
      })
    }
    inp.click()
  }

  // ---------- toolbar ----------
  var btnKb
  function button(label, fn, useClick) {
    var b = el('button', { textContent: label }, bar)
    if (useClick) {   // iOS opens the file picker only from a real click
      b.addEventListener('pointerdown', function (e) { e.stopPropagation() })
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(b) })
    } else b.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); fn(b) })
    return b
  }
  function netPanel() {
    var old = document.getElementById('wnet'); if (old) { old.remove(); return }
    var on = window.netEnabled ? netEnabled() : true
    var p = el('div', { id: 'wnet' }, document.body)
    p.style.cssText = 'position:fixed;inset:6% 8%;z-index:99999;background:#c0c0c0;color:#000;border:2px outset #fff;font:13px Tahoma,sans-serif;direction:rtl;overflow:auto;padding:10px 14px;-webkit-user-select:text'
    p.innerHTML = '<b>🌐 الإنترنت داخل Windows (عبر شبكة الهاتف)</b><span id=wnetx style="float:left;cursor:pointer;font-weight:bold;padding:0 6px">✕</span>' +
      '<p>الحالة: <b>' + (on ? 'كرت الشبكة موصول ✓' : 'مطفأة') + '</b> — البيانات المتبادلة: <span id=wnetb>0</span> KB</p>' +
      '<p>Windows XP يتعرّف على كرت الشبكة (Realtek RTL8029) تلقائياً — لا يحتاج تعريفاً إضافياً.</p>' +
      '<p>إذا لم يتصل: Control Panel ← Network Connections ← Local Area Connection ← Properties ← Internet Protocol (TCP/IP) ← <b>Obtain an IP address automatically</b>.</p>' +
      '<p>بعدها كل برنامج يستخدم الإنترنت يعمل عبر شبكة الهاتف (Wi-Fi أو بيانات). متصفح XP القديم (IE6) يفتح غالباً مواقع <b>http</b> البسيطة فقط، مثل: http://frogfind.com و http://68k.news و http://theoldnet.com</p>' +
      '<p><button id=wnett style="font:inherit;padding:4px 10px">' + (on ? 'إطفاء كرت الشبكة' : 'تشغيل كرت الشبكة') + '</button> (يتطلّب إعادة تشغيل Windows)</p>'
    document.getElementById('wnetx').onclick = function () { p.remove() }
    document.getElementById('wnett').onclick = function () {
      p.remove(); say(on ? 'جارِ إطفاء كرت الشبكة وإعادة تشغيل Windows…' : 'جارِ تشغيل كرت الشبكة وإعادة تشغيل Windows…', 4000)
      setTimeout(function () { try { webkit.messageHandlers.lf2.postMessage({ cmd: 'net', on: !on }) } catch (e) {} }, 1200)
    }
    var t = setInterval(function () { var b = document.getElementById('wnetb'); if (!b) return clearInterval(t); b.textContent = Math.round((window.__netBytes || 0) / 1024) }, 1000)
  }
  function buildBar() {
    var tog = button('☰', function () { root.classList.toggle('min') }); tog.id = 'wtog'
    btnKb = button('⌨ لوحة المفاتيح', function (b) { var o = kb.style.display !== 'block'; kb.style.display = o ? 'block' : 'none'; b.classList.toggle('on', o) })
    button('💿 ISO', pickISO, true)
    button('📁 نقل ملفات', pickFiles, true)
    button('⏏ إخراج', function () { try { EM && EM.eject_cdrom && EM.eject_cdrom(); say('⏏ تم إخراج القرص') } catch (e) {} })
    button('ابدأ', function () { combo([0x1D, 0x01]) })              // Ctrl+Esc = Start menu
    button('Alt+F4', function () { combo([0x38, 0x3E]) })
    button('Ctrl+Alt+Del', function () { combo([0x1D, 0x38, 0x153]) })
    button('🖱️ نقر يمين', function () { click(2) })
    var bDirect = button('👆 لمس مباشر', function () {
      direct = !direct; bDirect.classList.toggle('on', direct)
      say(direct ? '👆 لمس مباشر: المؤشر يذهب لمكان إصبعك وتضغط هناك.<br><small>للدقة: Control Panel ← Mouse ← Pointer Options: السرعة في المنتصف وألغِ «Enhance pointer precision»</small>'
                 : '🖐 وضع لوحة اللمس: حرّك إصبعك لتحريك المؤشر، ونقرة = ضغط', 6000)
      try { localStorage.setItem('xp-direct', direct ? '1' : '0') } catch (e) {}
    })
    try { if (localStorage.getItem('xp-direct') === '1') { direct = true; bDirect.classList.add('on') } } catch (e) {}
    button('🌐 الشبكة', netPanel)
    button('🔁 الإقلاع', function () {
      var d = !window.__bootDisk; setBootFromDisk(d)
      say(d ? 'إعادة التشغيل القادمة: من القرص الصلب 💽' : 'إعادة التشغيل القادمة: من قرص CD 📀', 3500)
    })
    button('📤 استخراج النظام', function () { try { webkit.messageHandlers.lf2.postMessage({ cmd: 'export' }) } catch (e) {} })
    button('🗑 حذف القرص', function () { try { webkit.messageHandlers.lf2.postMessage({ cmd: 'deletedisk' }) } catch (e) {} })
    button('✊ سحب', function (b) {
      dragLock = !dragLock; buttons[0] = dragLock; sendButtons(); b.classList.toggle('on', dragLock)
      say(dragLock ? 'الزر الأيسر مضغوط — حرّك إصبعك للسحب، واضغط «سحب» مرة أخرى للإفلات' : 'تم الإفلات', 2500)
    })
  }

  function mount() {
    if (!document.body) return setTimeout(mount, 30)
    var st = el('style', { textContent: css }); document.head.appendChild(st)
    root = el('div', { id: 'wui' }, document.body)
    pad = el('div', { id: 'wpad' }, root)
    bar = el('div', { id: 'wbar' }, root)
    kb = el('div', { id: 'wkb' }, root)
    toast = el('div', { id: 'wtoast' }, root)
    buildBar(); buildKeyboard(); setupPad()
    ;['touchstart', 'touchmove', 'pointerdown'].forEach(function (ev) { kb.addEventListener(ev, function (e) { e.stopPropagation() }, { passive: true }) })
  }
  mount()

  function unlockAudio() {
    try { var ac = EM && EM.speaker_adapter && EM.speaker_adapter.audio_context; if (ac && ac.state !== 'running') ac.resume() } catch (e) {}
  }
  document.addEventListener('touchstart', unlockAudio, { capture: true, passive: true })
  document.addEventListener('touchend', unlockAudio, { capture: true, passive: true })
  window.winSay = function (t, ms) { say(t, ms) }
  window.winReady = function (emulator) {
    EM = emulator
    say('Windows يقلع الآن…<br>اسحب بإصبع لتحريك الماوس • انقر للنقر • إصبعان للنقر الأيمن • ضغطة مطوّلة للسحب', 8000)
  }
  window.winUI = { insertCD: insertCD, buildAndInsert: function (files) { return window.buildISO(files, 'PHONE').then(function (b) { insertCD(new File([b], 'phone-files.iso'), files.length + ' files') }) }, tapKey: tapKey, combo: combo, click: click, move: move }
})()
