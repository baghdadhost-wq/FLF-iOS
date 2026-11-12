/* Championship mode for F.LF (1 on 1 and 2 on 2), built on the game's own match engine.
 * Needs the engine hooks from web/patch-engine.py (window.__flfManager, onResult, onExit).
 */
(function () {
  'use strict'
  if (window.flfTournament) return

  var DATA_URL = '../../LF2_19/data/data.js'
  var BASE = '../../LF2_19/'
  var chars = null          // [{name, pic, index}]

  function loadChars(cb) {
    if (chars) return cb(chars)
    var x = new XMLHttpRequest()
    x.open('GET', DATA_URL, true)
    x.onload = function () {
      // one object per line in data.js; keep the engine's order of characters
      var list = [], i = 0
      x.responseText.split('\n').forEach(function (line) {
        var code = line.replace(/\/\/.*$/, '')
        if (!/type:\s*'character'/.test(code)) return
        var n = /name:\s*'([^']*)'/.exec(code), p = /pic:\s*'([^']*)'/.exec(code)
        list.push({ name: n ? n[1] : '?', pic: p ? BASE + p[1] : '', index: i++ })
      })
      chars = list; cb(list)
    }
    x.send()
  }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t } return a }

  // ---------------- UI ----------------
  var css = '#tourney{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;background:rgba(5,8,25,.92);' +
    'font-family:-apple-system,sans-serif;color:#fff;direction:rtl}' +
    '#tourney .box{width:min(820px,94vw);max-height:92vh;overflow:auto;background:#121a45;border:2px solid #ffcc4d;border-radius:14px;padding:12px;text-align:center}' +
    '#tourney h2{margin:2px 0 8px;color:#ffd76a;font-size:20px}' +
    '#tourney button{font-size:15px;padding:9px 16px;margin:4px;border-radius:10px;border:1px solid #7a8cff;background:#1b2560;color:#fff}' +
    '#tourney button.sel{background:#ffcc4d;color:#1a1300;border-color:#ffcc4d}' +
    '#tourney button.go{background:#e0502f;border-color:#ff8a3c;font-weight:700;font-size:17px}' +
    '#tourney .grid{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:8px 0}' +
    '#tourney .ch{width:68px;cursor:pointer;border:2px solid transparent;border-radius:8px;padding:2px;font-size:10px;background:#0b1030}' +
    '#tourney .ch img{width:60px;height:60px;display:block;margin:0 auto;image-rendering:pixelated}' +
    '#tourney .ch.sel{border-color:#ffcc4d;background:#3a3010}' +
    '#tourney .bracket{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;direction:ltr;margin:8px 0}' +
    '#tourney .round{display:flex;flex-direction:column;justify-content:space-around;gap:6px;min-width:150px}' +
    '#tourney .round h4{margin:0;color:#ffd76a;font-size:13px}' +
    '#tourney .slot{background:#0b1030;border:1px solid #334;border-radius:8px;padding:4px 6px;font-size:12px;display:flex;align-items:center;gap:5px}' +
    '#tourney .slot img{width:24px;height:24px}' +
    '#tourney .slot.me{border-color:#ffcc4d}#tourney .slot.out{opacity:.35;text-decoration:line-through}' +
    '#tourney .big{font-size:42px;margin:6px}'
  var root, box
  function ui() {
    if (root) return
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
    root = document.createElement('div'); root.id = 'tourney'
    box = document.createElement('div'); box.className = 'box'; root.appendChild(box)
    document.body.appendChild(root)
    ;['pointerdown', 'touchstart', 'touchmove'].forEach(function (ev) {
      root.addEventListener(ev, function (e) { e.stopPropagation() }, { passive: true })
    })
  }
  function show(html) { ui(); box.innerHTML = html; root.style.display = 'flex'; return box }
  function hide() { if (root) root.style.display = 'none' }

  // ---------------- tournament state ----------------
  var T = null   // { mode, me, rounds:[ [entry,...] ], round, matchIndex, ... }
  // entry: { name, members:[charIndex,...], me:bool, out:bool }

  function entryName(e) { return e.members.map(function (i) { return chars[i].name }).join(' + ') }

  function openSetup() {
    loadChars(function () {
      var mode = (T && T.mode) || 1, pick = (T && T.pick != null) ? T.pick : 0
      function render() {
        var h = '<h2>🏆 البطولة</h2>' +
          '<div><button data-m="1" class="' + (mode === 1 ? 'sel' : '') + '">1 ضد 1 (8 مقاتلين)</button>' +
          '<button data-m="2" class="' + (mode === 2 ? 'sel' : '') + '">2 ضد 2 (4 فرق، معك شريك)</button></div>' +
          '<div style="margin-top:6px">اختر مقاتلك:</div><div class="grid">'
        chars.forEach(function (c) {
          h += '<div class="ch ' + (c.index === pick ? 'sel' : '') + '" data-c="' + c.index + '"><img src="' + c.pic + '">' + c.name + '</div>'
        })
        h += '</div><button class="go" id="t_start">ابدأ البطولة</button><button id="t_close">إغلاق</button>'
        show(h)
        box.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { mode = +b.dataset.m; render() } })
        box.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { pick = +b.dataset.c; render() } })
        box.querySelector('#t_close').onclick = hide
        box.querySelector('#t_start').onclick = function () { start(mode, pick) }
      }
      render()
    })
  }

  function start(mode, pick) {
    var others = shuffle(chars.map(function (c) { return c.index }).filter(function (i) { return i !== pick }))
    var entries = []
    if (mode === 1) {
      entries.push({ members: [pick], me: true })
      for (var i = 0; i < 7; i++) entries.push({ members: [others[i % others.length]] })
    } else {
      entries.push({ members: [pick, others[0]], me: true })
      for (var k = 0; k < 3; k++) entries.push({ members: [others[1 + k * 2], others[2 + k * 2]] })
    }
    entries = [entries[0]].concat(shuffle(entries.slice(1)))
    // put the player in a random slot of the first round
    var pos = Math.floor(Math.random() * entries.length)
    var me = entries.shift(); entries.splice(pos, 0, me)
    T = { mode: mode, pick: pick, rounds: [entries], round: 0, active: true, result: null }
    showBracket('')
  }

  function roundName(r) {
    var n = T.rounds[0].length / Math.pow(2, r)
    return n === 8 ? 'ربع النهائي' : n === 4 ? 'نصف النهائي' : n === 2 ? 'النهائي' : 'البطل'
  }

  function bracketHTML() {
    var h = '<div class="bracket">'
    var total = Math.log2(T.rounds[0].length)
    for (var r = 0; r <= total; r++) {
      var list = T.rounds[r] || []
      h += '<div class="round"><h4>' + roundName(r) + '</h4>'
      var slots = T.rounds[0].length / Math.pow(2, r)
      for (var i = 0; i < slots; i++) {
        var e = list[i]
        if (!e) { h += '<div class="slot">…</div>'; continue }
        h += '<div class="slot ' + (e.me ? 'me ' : '') + (e.out ? 'out' : '') + '">' +
          e.members.map(function (m) { return '<img src="' + chars[m].pic + '">' }).join('') + entryName(e) + (e.me ? ' ⭐' : '') + '</div>'
      }
      h += '</div>'
    }
    return h + '</div>'
  }

  function myPair() {
    var list = T.rounds[T.round]
    for (var i = 0; i < list.length; i += 2) {
      if (list[i].me || list[i + 1].me) return i
    }
    return -1
  }

  function showBracket(msg) {
    var list = T.rounds[T.round]
    if (list.length === 1) {   // champion decided
      var champ = list[0]
      show('<h2>🏆 نهاية البطولة</h2><div class="big">' + (champ.me ? '🥇' : '🏅') + '</div>' +
        '<div style="font-size:18px">' + (champ.me ? 'مبروك! أنت بطل البطولة' : 'البطل: ' + entryName(champ)) + '</div>' +
        bracketHTML() + '<button class="go" id="t_again">بطولة جديدة</button><button id="t_quit">خروج</button>')
      box.querySelector('#t_again').onclick = openSetup
      box.querySelector('#t_quit').onclick = quit
      T.active = false
      return
    }
    var i = myPair(), opp = i < 0 ? null : (list[i].me ? list[i + 1] : list[i])
    var h = '<h2>🏆 ' + roundName(T.round) + '</h2>' + (msg ? '<div style="font-size:16px;margin:4px">' + msg + '</div>' : '') + bracketHTML()
    if (opp) h += '<div>خصمك: <b>' + entryName(opp) + '</b></div><button class="go" id="t_fight">قاتل!</button>'
    else h += '<button class="go" id="t_next">متابعة باقي المباريات</button>'
    h += '<button id="t_quit">انسحاب</button>'
    show(h)
    var f = box.querySelector('#t_fight'); if (f) f.onclick = function () { fight(list[i], list[i + 1]) }
    var n = box.querySelector('#t_next'); if (n) n.onclick = function () { finishRound(null); showBracket('') }
    box.querySelector('#t_quit').onclick = quit
  }

  function fight(a, b) {
    var M = window.__flfManager
    if (!M) { alert('game not ready'); return }
    hide()
    T.current = { a: a, b: b }
    T.result = null
    var players = []
    function add(e, team) {
      e.members.forEach(function (ci, k) {
        var human = e.me && k === 0
        players.push({ use: true, name: human ? 'You' : chars[ci].name, type: human ? 'human' : 'computer',
          selected: ci, selected_AI: Math.random() < 0.5 ? 0 : 1, team: team })
      })
    }
    // the human must be players[0] (uses player-1 controls)
    if (a.me) { add(a, 1); add(b, 2) } else { add(b, 1); add(a, 2) }
    if (!T.started) { M.start_game(); T.started = true }
    M.start_match({ players: players, options: { background: -1 } })
  }

  function finishRound(myWin) {
    var list = T.rounds[T.round], next = []
    for (var i = 0; i < list.length; i += 2) {
      var a = list[i], b = list[i + 1], w
      if (a.me || b.me) w = myWin ? (a.me ? a : b) : (a.me ? b : a)
      else w = Math.random() < 0.5 ? a : b       // computer vs computer: simulated
      ;(w === a ? b : a).out = true
      next.push({ members: w.members, me: w.me })
    }
    T.round++
    T.rounds[T.round] = next
  }

  function quit() {
    hide()
    var wasActive = T && T.started
    T = null
    if (wasActive && window.__flfManager) window.__flfManager.match_end()
  }

  // ---- engine hooks ----
  window.__flfTourney = {
    onResult: function (match, aliveTeams) {
      if (!T || !T.active || !T.current) return
      T.result = !!aliveTeams[1]   // the player's side is team 1
    },
    onExit: function (match) {   // match closed (attack after game over, F4 or Esc)
      if (!T || !T.active || !T.current) return false
      var res = T.result
      T.current = null
      if (res === null) {           // left mid-fight: treat as a loss
        res = false
      }
      finishRound(res)
      var meStill = T.rounds[T.round].some(function (e) { return e.me })
      if (!meStill) {
        var champ = T.rounds[T.round]
        // simulate the remaining rounds so the bracket is complete
        while (T.rounds[T.round].length > 1) finishRound(null)
        show('<h2>🏆 خرجت من البطولة</h2><div class="big">💥</div>' + bracketHTML() +
          '<button class="go" id="t_again">حاول مرة أخرى</button><button id="t_quit">خروج</button>')
        box.querySelector('#t_again').onclick = openSetup
        box.querySelector('#t_quit').onclick = quit
        T.active = false
        window.__flfManager.match_end()
        return true
      }
      window.__flfManager.match_end()
      showBracket(T.rounds[T.round].length === 1 ? '' : '✅ فزت! تأهلت إلى ' + roundName(T.round))
      return true
    }
  }

  window.flfTournament = { open: openSetup }
})()
