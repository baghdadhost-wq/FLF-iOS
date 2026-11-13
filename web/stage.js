/* Stage mode for F.LF: the original LF2 stages (5 areas x 5 stages) with phases, enemy waves and bosses.
 * Uses engine hooks from web/patch-engine.py (window.__flfManager, check_gameover -> tick, F4 -> onExit).
 */
(function () {
  'use strict'
  if (window.flfStage) return

  var DATA_URL = '../../LF2_19/data/data.js'
  var BASE = '../../LF2_19/'
  var STAGES_URL = '/stages.json'
  var AREAS = ['الغابة (Lion Forest)', 'السجن (Stanley Prison)', 'السور العظيم (Great Wall)', 'الجزيرة (Queen\'s Island)', 'البرج المحرّم (Forbidden Tower)']
  var AREA_BG = [1, 2, 3, 4, 5]          // index in the game's background list
  var RANDOM_HERO = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]
  var RANDOM_GANG = [30, 31]
  var MAX_ALIVE = 7

  var chars = null, stages = null, objects = null

  function get(url, cb) {
    var x = new XMLHttpRequest(); x.open('GET', url, true)
    x.onload = function () { cb(x.responseText) }; x.send()
  }
  function loadAll(cb) {
    if (chars && stages) return cb()
    get(DATA_URL, function (txt) {
      chars = []; objects = {}
      var i = 0
      txt.split('\n').forEach(function (line) {
        var code = line.replace(/\/\/.*$/, '')
        var id = /\{id:\s*(\d+)/.exec(code)
        if (!id) return
        var pack = []; var re = /\{id:(\d+)\}/g, m
        while ((m = re.exec(code))) pack.push(+m[1])
        objects[+id[1]] = { pack: pack }
        if (!/type:\s*'character'/.test(code)) return
        var n = /name:\s*'([^']*)'/.exec(code), p = /pic:\s*'([^']*)'/.exec(code)
        chars.push({ id: +id[1], name: n ? n[1] : '?', pic: p ? BASE + p[1] : '', index: i++ })
      })
      get(STAGES_URL, function (t) { stages = JSON.parse(t); cb() })
    })
  }

  // ---------- UI ----------
  var css = '#lfstage{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;background:rgba(5,8,25,.92);' +
    'font-family:-apple-system,sans-serif;color:#fff;direction:rtl}' +
    '#lfstage .box{width:min(820px,94vw);max-height:92vh;overflow:auto;background:#10203a;border:2px solid #5fd38d;border-radius:14px;padding:12px;text-align:center}' +
    '#lfstage h2{margin:2px 0 8px;color:#8ff0b5;font-size:20px}' +
    '#lfstage button{font-size:15px;padding:9px 16px;margin:4px;border-radius:10px;border:1px solid #5fd38d;background:#163a2a;color:#fff}' +
    '#lfstage button.sel{background:#5fd38d;color:#06210f}' +
    '#lfstage button.go{background:#e0502f;border-color:#ff8a3c;font-weight:700;font-size:17px}' +
    '#lfstage .grid{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:8px 0}' +
    '#lfstage .ch{width:68px;border:2px solid transparent;border-radius:8px;padding:2px;font-size:10px;background:#0b1626}' +
    '#lfstage .ch img{width:60px;height:60px;display:block;margin:0 auto}' +
    '#lfstage .ch.sel{border-color:#5fd38d;background:#1d4a33}' +
    '#lfstage .big{font-size:42px;margin:6px}' +
    '#lfstagemsg{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:100000;pointer-events:none;font:800 26px -apple-system,sans-serif;' +
    'color:#fff;text-shadow:0 2px 6px #000,0 0 12px #000;display:none;text-align:center;direction:rtl}' +
    '#lfstagehud{position:fixed;right:50%;transform:translateX(50%);bottom:4px;z-index:99998;pointer-events:none;font:700 12px -apple-system,sans-serif;' +
    'color:#fff;background:rgba(0,0,0,.45);padding:2px 10px;border-radius:8px;display:none;direction:rtl}'
  var root, box, msg, hud
  function ui() {
    if (root) return
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
    root = document.createElement('div'); root.id = 'lfstage'
    box = document.createElement('div'); box.className = 'box'; root.appendChild(box)
    msg = document.createElement('div'); msg.id = 'lfstagemsg'
    hud = document.createElement('div'); hud.id = 'lfstagehud'
    document.body.appendChild(root); document.body.appendChild(msg); document.body.appendChild(hud)
    ;['pointerdown', 'touchstart', 'touchmove'].forEach(function (ev) {
      root.addEventListener(ev, function (e) { e.stopPropagation() }, { passive: true })
    })
  }
  function show(html) { ui(); box.innerHTML = html; root.style.display = 'flex' }
  function hide() { if (root) root.style.display = 'none' }
  var msgTimer
  function flash(text, ms) {
    ui(); msg.innerHTML = text; msg.style.display = 'block'
    clearTimeout(msgTimer); msgTimer = setTimeout(function () { msg.style.display = 'none' }, ms || 2000)
  }
  function setHud(text) { ui(); hud.style.display = text ? 'block' : 'none'; hud.innerHTML = text || '' }

  // ---------- state ----------
  var S = null

  function stageTitle(st) { return 'المرحلة ' + (Math.floor(st.id / 10) + 1) + '-' + (st.id % 10 + 1) }

  function openSetup() {
    loadAll(function () {
      var pick = (S && S.pick != null) ? S.pick : 10, area = (S && S.area) || 0
      function render() {
        var h = '<h2>🗺️ وضع المراحل (Stage mode)</h2><div>اختر المنطقة:</div><div>'
        AREAS.forEach(function (a, i) { h += '<button data-a="' + i + '" class="' + (i === area ? 'sel' : '') + '">' + (i + 1) + '. ' + a + '</button>' })
        h += '</div><div style="margin-top:6px">اختر مقاتلك:</div><div class="grid">'
        chars.forEach(function (c) {
          h += '<div class="ch ' + (c.index === pick ? 'sel' : '') + '" data-c="' + c.index + '"><img src="' + c.pic + '">' + c.name + '</div>'
        })
        h += '</div><button class="go" id="s_start">ابدأ</button><button id="s_close">إغلاق</button>'
        show(h)
        box.querySelectorAll('[data-a]').forEach(function (b) { b.onclick = function () { area = +b.dataset.a; render() } })
        box.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { pick = +b.dataset.c; render() } })
        box.querySelector('#s_close').onclick = hide
        box.querySelector('#s_start').onclick = function () {
          var list = stages.filter(function (s) { return Math.floor(s.id / 10) === area })
          S = { pick: pick, area: area, list: list, idx: 0, hpCarry: null, started: false }
          startStage()
        }
      }
      render()
    })
  }

  function resolveId(id) {
    if (id === 1000) return RANDOM_HERO[Math.floor(Math.random() * RANDOM_HERO.length)]
    if (id === 3000) return RANDOM_GANG[Math.floor(Math.random() * RANDOM_GANG.length)]
    return id
  }
  function neededObjects(st) {
    var ids = {}
    function add(id) { if (ids[id]) return; ids[id] = 1; ((objects[id] && objects[id].pack) || []).forEach(add) }
    st.phases.forEach(function (p) {
      p.spawns.forEach(function (sp) {
        if (sp.id === 1000) RANDOM_HERO.forEach(add)
        else if (sp.id === 3000) RANDOM_GANG.forEach(add)
        else if (objects[sp.id]) add(sp.id)
      })
    })
    return Object.keys(ids).map(Number)
  }

  function startStage() {
    var M = window.__flfManager
    if (!M) { alert('game not ready'); return }
    hide()
    var st = S.list[S.idx]
    S.stage = st; S.phase = -1; S.loading = true; S.t = 0; S.pending = []; S.enemies = {}
    S.result = null; S.deadT = 0; S.clearT = 0
    if (!S.started) { M.start_game(); S.started = true }
    window.__flfAutoClose = true      // the engine closes any match still running in the background
    var match = M.start_match({
      players: [{ use: true, name: 'You', type: 'human', selected: S.pick, selected_AI: 0, team: 1 }],
      options: { background: AREA_BG[S.area] }
    })
    S.match = match
    flash(stageTitle(st), 2500)
    var mine = S
    match.data.load({ object: neededObjects(st), AI: [1] }, function () {
      mine.loading = false
    })
    setTimeout(function () { if (mine.loading) mine.loading = false }, 12000)   // never stay stuck loading
  }

  function humans(m) {
    var out = []
    for (var k in m.character) { var c = m.character[k]; if (c.team === 1) out.push(c) }
    return out
  }

  function beginPhase(m, n) {
    S.phase = n
    var ph = S.stage.phases[n]
    // walking limit for the player's team + camera stops at the same line
    if (m.background) {
      m.background.xlimit = ph.bound
      m.background.xlimit_team = 1
      m.background.camlimit = ph.bound
    }
    S.pending = []
    ph.spawns.forEach(function (sp) {
      if (sp.ratio != null && sp.ratio < 1 && !sp.boss && Math.random() > sp.ratio) return
      var copies = 1 + (sp.reserve && sp.id !== 300 ? 0 : 0)
      for (var c = 0; c < copies; c++) S.pending.push({ sp: sp, left: (sp.times || 1), at: S.t + 15 + Math.floor(Math.random() * 60) })
    })
    if (n > 0) flash('➜ GO', 1800)
  }

  function bossAlive() {
    for (var u in S.enemies) if (S.enemies[u].sp.boss) return true
    return S.pending.some(function (p) { return p.sp.boss })
  }

  function spawn(m, P) {
    var sp = P.sp, id = resolveId(sp.id)
    var bound = S.stage.phases[S.phase].bound
    var pos = m.background.get_pos(Math.random(), Math.random())
    var x = (sp.x != null && sp.x < 0) ? Math.max(20, bound - 900) : Math.max(60, bound - 30 - Math.random() * 120)
    if (id >= 100 && id < 300) {           // weapons and drinks fall from the sky
      m.create_weapon(id, { x: Math.max(40, bound - 200 - Math.random() * 400), y: -600, z: pos.z })
      return null
    }
    if (id === 300 || !objects[id]) return null  // criminals are not supported by the engine
    var before = {}; for (var k in m.character) before[k] = 1
    m.create_characters([{ id: id, controller: { type: 'AIscript', id: 1 }, team: 2, pos: { x: x, y: 0, z: pos.z } }], {})
    var uid = null; for (var k2 in m.character) if (!before[k2]) uid = k2
    if (uid == null) return null
    var ch = m.character[uid]
    var hp = sp.hp || 500
    ch.health.hp = ch.health.hp_full = ch.health.hp_bound = hp
    return uid
  }

  // called every game tick from match.check_gameover
  function tick(m) {
    if (!S || S.match !== m) return false
    if (S.loading || S.result) return true
    S.t++
    if (S.phase < 0) { beginPhase(m, 0) }
    var ph = S.stage.phases[S.phase]
    var bound = ph.bound

    // players may not walk past the current phase's limit
    var hs = humans(m), aliveH = 0
    hs.forEach(function (c) { if (c.health.hp > 0) aliveH++ })
    // the camera follows only the player(s), never the enemies
    var bg = m.background
    if (bg && hs.length && (!S.camSet || S.camN !== hs.length)) {
      var follow = {}; hs.forEach(function (c) { follow[c.uid] = c })
      bg.char = follow; S.camSet = true; S.camN = hs.length
    }

    // dead enemies: respawn if they have more "times"
    var alive = 0
    for (var u in S.enemies) {
      var e = S.enemies[u], ch = m.character[u]
      if (!ch || ch.health.hp <= 0 || e.deadAt) {
        if (!e.deadAt) e.deadAt = S.t
        if (ch && ch.health.hp > 0) ch.health.hp = -1   // dead stays dead (the engine regenerates hp >= 0)
        var since = S.t - e.deadAt
        if (ch && since > 30 && ch.sp) { if (since % 4 < 2) ch.sp.hide(); else ch.sp.show() }   // blink
        if (since > 60) {
          if (ch && !e.removed) { e.removed = true; if (ch.sp) ch.sp.hide(); m.destroy_object(ch) }
          delete S.enemies[u]
          if (e.left > 0 && (!e.sp.soldier || bossAlive())) S.pending.push({ sp: e.sp, left: e.left, at: S.t + 30 })
        }
      } else alive++
    }
    // soldiers stop coming once the boss is gone
    if (!bossAlive()) S.pending = S.pending.filter(function (p) { return !p.sp.soldier })

    // spawn waiting enemies (bosses first)
    S.pending.sort(function (a, b) { return (b.sp.boss ? 1 : 0) - (a.sp.boss ? 1 : 0) })
    for (var i = 0; i < S.pending.length && alive < MAX_ALIVE; i++) {
      var P = S.pending[i]
      if (P.at > S.t) continue
      S.pending.splice(i--, 1)
      var uid = spawn(m, P)
      if (uid != null) { S.enemies[uid] = { sp: P.sp, left: P.left - 1 }; alive++ }
    }

    var remaining = alive + S.pending.length
    setHud(stageTitle(S.stage) + ' • الجزء ' + (S.phase + 1) + '/' + S.stage.phases.length + ' • الأعداء: ' + remaining)

    // game over
    if (aliveH === 0) {
      if (!S.deadT) S.deadT = S.t
      if (S.t - S.deadT > 90) { S.result = 'lose'; end(m) }
      return true
    }
    // phase cleared
    if (remaining === 0 && Object.keys(S.enemies).length === 0) {
      if (!S.clearT) S.clearT = S.t
      if (S.t - S.clearT > 45) {
        S.clearT = 0
        if (S.phase + 1 < S.stage.phases.length) beginPhase(m, S.phase + 1)
        else { S.result = 'win'; end(m) }
      }
    } else S.clearT = 0
    return true
  }

  function end(m) {
    var hs = humans(m)
    S.hpCarry = hs.length ? hs[0].health.hp : null
    setHud('')
    var last = S.idx + 1 >= S.list.length
    if (S.result === 'win') {
      flash(last ? '🏆 أنهيت المنطقة!' : '✅ STAGE CLEAR', 2500)
      setTimeout(function () {
        show('<h2>' + (last ? '🏆 أنهيت ' + AREAS[S.area] : '✅ ' + stageTitle(S.stage) + ' — تم!') + '</h2><div class="big">' + (last ? '🥇' : '⭐') + '</div>' +
          (last ? (S.area + 1 < AREAS.length ? '<button class="go" id="s_nextarea">المنطقة التالية</button>' : '<div>أنهيت كل المراحل!</div>') :
            '<button class="go" id="s_next">المرحلة التالية</button>') + '<button id="s_quit">خروج</button>')
        var nb = box.querySelector('#s_next'); if (nb) nb.onclick = function () { close(m); S.idx++; startStage() }
        var na = box.querySelector('#s_nextarea'); if (na) na.onclick = function () {
          close(m); S.area++; S.idx = 0; S.list = stages.filter(function (s) { return Math.floor(s.id / 10) === S.area }); startStage()
        }
        box.querySelector('#s_quit').onclick = function () { close(m); quit() }
      }, 2200)
    } else {
      flash('GAME OVER', 2500)
      setTimeout(function () {
        show('<h2>💥 انتهت المحاولة</h2><div>' + stageTitle(S.stage) + '</div>' +
          '<button class="go" id="s_retry">أعد المرحلة</button><button id="s_menu">اختيار آخر</button><button id="s_quit">خروج</button>')
        box.querySelector('#s_retry').onclick = function () { close(m); startStage() }
        box.querySelector('#s_menu').onclick = function () { close(m); openSetup() }
        box.querySelector('#s_quit').onclick = function () { close(m); quit() }
      }, 2200)
    }
  }

  function close(m) {
    if (m && !m.destroyed) { S.closing = true; m.destroy(); S.closing = false }
  }
  function quit() {
    hide(); setHud('')
    var M = window.__flfManager
    S = null
    if (M) M.match_end()
  }

  window.__flfStage = {
    tick: tick,
    ignoreExit: function (m, reason) {
      if (!S || S.match !== m || S.result) return false
      if (reason === 'gameover') return true            // stage mode handles game over itself
      if (S.loading || S.t < 90) return true            // ignore exits in the first seconds of a stage
      return false
    },
    onExit: function (m, reason) {   // Esc / F4 during a stage
      if (!S || S.match !== m) return false
      S.exitReason = (reason || '?') + ' @' + S.t
      if (S.result) return true       // our own end screen is handling it
      setHud('')
      show('<h2>⏸ خرجت من المرحلة</h2><div style="font-size:11px;opacity:.6;direction:ltr">' + S.exitReason + '</div><button class="go" id="s_retry">أعد المرحلة</button><button id="s_menu">اختيار آخر</button><button id="s_quit">خروج</button>')
      box.querySelector('#s_retry').onclick = function () { startStage() }
      box.querySelector('#s_menu').onclick = openSetup
      box.querySelector('#s_quit').onclick = quit
      S.result = 'quit'
      return true
    }
  }
  // test helper: defeat every enemy currently on screen
  window.__flfStage.killAll = function () {
    if (!S || !S.match) return
    for (var u in S.enemies) { var c = S.match.character[u]; if (c) c.health.hp = -1 }
  }
  window.__flfStage.debug = function () {
    if (!S || !S.match) return null
    var m = S.match, h = humans(m)[0]
    return { y: h && Math.round(h.ps.y), vy: h && Math.round(h.ps.vy * 10) / 10, fr: h && h.frame.N, st: h && h.state(), x: h && Math.round(h.ps.x), bound: S.stage.phases[Math.max(0, S.phase)].bound, cam: Math.round(m.background.camerax),
      onField: Object.keys(m.character).length, phase: S.phase, t: S.t, pending: S.pending.length, enemies: Object.keys(S.enemies).length,
      result: S.result, loading: S.loading, hp: Object.keys(m.character).map(function (k) { return m.character[k].team + ':' + Math.round(m.character[k].health.hp) }).join(',') }
  }
  window.flfStage = { open: openSetup }
})()
