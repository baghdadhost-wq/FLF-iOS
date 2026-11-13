"""Small compatibility patches for F.LF so the extra (hidden) LF2 characters run.
usage: python3 patch-engine.py <path to F.LF>"""
import sys, os
root = sys.argv[1]

def patch(rel, old, new, tag, count=-1):
    p = os.path.join(root, rel)
    s = open(p).read()
    if tag in s:
        return
    assert old in s, rel + ': pattern not found'
    s = s.replace(old, new, count)
    open(p, 'w').write(s)

# opoints that spawn a whole character (Julian's mirror image) are not supported: skip instead of crashing
patch('LF/match.js',
      "var obj = new factory[OBJ.type](config, OBJ.data, T.opoint.oid)",
      "if (OBJ.type === 'character' || !OBJ.data || OBJ.data === 'lazy') break // FLF-iOS: skip character spawn\n"
      "            var obj = new factory[OBJ.type](config, OBJ.data, T.opoint.oid)",
      'FLF-iOS: skip character spawn')

# characters without super-punch frames 72/73 (LouisEX) crashed when attacking
patch('LF/character.js',
      "var vol = $.mech.volume(Futil.make_array($.data.frame[72].itr || $.data.frame[73].itr)[0]) // super punch frames\n"
      "                var hit = $.scene.query(vol, $, { tag: 'itr:6', not_team: $.team })",
      "var sp_itr = ($.data.frame[72] && $.data.frame[72].itr) || ($.data.frame[73] && $.data.frame[73].itr) // FLF-iOS: no super punch guard\n"
      "                var hit = sp_itr ? $.scene.query($.mech.volume(Futil.make_array(sp_itr)[0]), $, { tag: 'itr:6', not_team: $.team }) : []",
      'FLF-iOS: no super punch guard')
# drinks (milk/beer): pressing attack while holding one drinks it
patch('LF/character.js',
      "                  var dx = $.con.state.left !== $.con.state.right\n                  if ($.hold.obj.type === 'heavyweapon') {",
      "                  var dx = $.con.state.left !== $.con.state.right\n"
      "                  var DRK = $.proper($.hold.obj.id, 'drink') // FLF-iOS: drinks\n"
      "                  if (DRK) {\n"
      "                    $.effect.heal = ($.effect.heal || 0) + (DRK.hp || 0)\n"
      "                    $.health.mp = Math.min($.health.mp_full, $.health.mp + (DRK.mp || 0))\n"
      "                    $.hold.obj.health.hp -= (DRK.sip || 150)\n"
      "                    if ($.hold.obj.health.hp <= 0) { var empty = $.hold.obj; $.drop_weapon(0, 0); empty.health.hp = 0 }\n"
      "                    $.trans.frame(55, 10)\n"
      "                    return 1\n"
      "                  }\n"
      "                  if ($.hold.obj.type === 'heavyweapon') {",
      'FLF-iOS: drinks')
# LAN multiplayer: allow the app's own scheme, add a built-in "LAN" server, accept the local lobby page
patch('LF/manager.js',
      "if (window.location.href.indexOf('http') === 0) {",
      "if (window.location.href.indexOf('http') === 0 || window.location.href.indexOf('flf:') === 0) { // FLF-iOS: LAN",
      'FLF-iOS: LAN')
patch('LF/manager.js',
      "            for (const S in settings.server) {\n              var op = document.createElement('option')",
      "            settings.server['LAN - Wi-Fi'] = window.location.protocol + '//' + window.location.host // FLF-iOS: LAN server\n"
      "            for (const S in settings.server) {\n              var op = document.createElement('option')",
      'FLF-iOS: LAN server')
patch('LF/manager.js',
      "            util.div('server_select').onchange()\n",
      "            util.div('server_select').value = 'LAN - Wi-Fi' // FLF-iOS: LAN default\n            util.div('server_select').onchange()\n",
      'FLF-iOS: LAN default')
patch('LF/manager.js',
      "const server = JSON.parse(this.responseText)",
      "const server = JSON.parse(this.responseText); if (server.lan) { server.address = window.location.protocol + '//' + window.location.host } // FLF-iOS: LAN address",
      'FLF-iOS: LAN address')
patch('LF/manager.js',
      "              if (event.origin !== server.address) {\n                return\n              }",
      "              if (event.origin !== server.address && !(server.lan && event.source === util.div('lobby_window').contentWindow)) { // FLF-iOS: LAN lobby\n                return\n              }",
      'FLF-iOS: LAN lobby')
# championship mode hooks (web/tournament.js)
patch('game/game.js',
      "var manager = new Manager(package, buildinfo);",
      "var manager = new Manager(package, buildinfo); window.__flfManager = manager; // FLF-iOS: expose manager",
      'FLF-iOS: expose manager')
patch('LF/match.js',
      "    match.prototype.F4 = function () {\n      const $ = this\n      $.destroy()\n      $.manager.match_end()",
      "    match.prototype.F4 = function () {\n      const $ = this\n      $.destroy()\n"
      "      if (window.__flfTourney && window.__flfTourney.onExit($)) return // FLF-iOS: tournament hook\n"
      "      $.manager.match_end()",
      'FLF-iOS: tournament hook')
patch('LF/match.js',
      "        $.manager.summary.show()\n        $.manager.sound.play('1/m_end')",
      "        $.manager.summary.show()\n        $.manager.sound.play('1/m_end')\n"
      "        if (window.__flfTourney) window.__flfTourney.onResult($, teams) // FLF-iOS: tournament result",
      'FLF-iOS: tournament result')
# stage mode hooks (web/stage.js)
patch('LF/match.js',
      "    match.prototype.check_gameover = function () {\n      const $ = this",
      "    match.prototype.check_gameover = function () {\n      const $ = this\n"
      "      if (window.__flfStage && window.__flfStage.tick($)) return // FLF-iOS: stage hook",
      'FLF-iOS: stage hook')
patch('LF/match.js',
      "      if (window.__flfTourney && window.__flfTourney.onExit($)) return // FLF-iOS: tournament hook",
      "      if (window.__flfTourney && window.__flfTourney.onExit($)) return // FLF-iOS: tournament hook\n"
      "      if (window.__flfStage && window.__flfStage.onExit($, reason)) return // FLF-iOS: stage exit",
      'FLF-iOS: stage exit')
# stage mode: movable walking limit for the player's team (mechanics) and camera limit (background)
patch('LF/mechanics.js',
      "    if (ps.z < this.bg.zboundary[0]) { // z bounding",
      "    if (this.bg.xlimit != null && this.parent.team === this.bg.xlimit_team && ps.x > this.bg.xlimit) { // FLF-iOS: stage limit\n"
      "      ps.x = this.bg.xlimit\n"
      "      if (ps.vx > 0) ps.vx = 0\n"
      "    }\n"
      "    if (ps.z < this.bg.zboundary[0]) { // z bounding",
      'FLF-iOS: stage limit')
patch('LF/background.js',
      "        if (xLimit > $.width - screenW) xLimit = $.width - screenW",
      "        if (xLimit > $.width - screenW) xLimit = $.width - screenW\n"
      "        if ($.camlimit != null && xLimit > $.camlimit - screenW) xLimit = Math.max(0, $.camlimit - screenW) // FLF-iOS: stage camera",
      'FLF-iOS: stage camera')
# exit reasons + let stage mode veto accidental exits; remember the running match
patch('LF/match.js',
      "    match.prototype.F4 = function () {\n      const $ = this\n      $.destroy()",
      "    match.prototype.F4 = function (reason) { // FLF-iOS: exit reason\n      const $ = this\n"
      "      if (window.__flfStage && window.__flfStage.ignoreExit && window.__flfStage.ignoreExit($, reason)) return\n"
      "      $.destroy()",
      'FLF-iOS: exit reason')
patch('LF/match.js',
      "            if (K === 'att' || K === 'jump') {\n              $.F4()",
      "            if (K === 'att' || K === 'jump') {\n              $.F4('gameover') // FLF-iOS: reason gameover",
      'FLF-iOS: reason gameover')
patch('LF/match.js',
      "                case 'esc':\n                case 'F4':\n                  $.F4()",
      "                case 'esc':\n                case 'F4':\n                  $.F4('key:' + I) // FLF-iOS: reason key",
      'FLF-iOS: reason key')
patch('LF/match.js',
      "      $.gameover_state = false",
      "      $.gameover_state = false\n      if (window.__flfCurrentMatch && window.__flfCurrentMatch !== $ && !window.__flfCurrentMatch.destroyed && window.__flfAutoClose) {\n"
      "        try { window.__flfCurrentMatch.destroy() } catch (e) {} // FLF-iOS: close stray match\n      }\n"
      "      window.__flfAutoClose = false\n      window.__flfCurrentMatch = $",
      'FLF-iOS: close stray match', 1)
# being caught: if the catcher is gone / dead / not catching any more, release instead of hanging forever
patch('LF/character.js',
      "          case 'TU':\n            if ($.frame.N === 135) {",
      "          case 'TU':\n"
      "            var CT = $.catching // FLF-iOS: release orphan catch\n"
      "            if (!CT || CT.health.hp <= 0 || !$.match.character[CT.uid] || CT.catching !== $) {\n"
      "              $.statemem.lostTU = ($.statemem.lostTU || 0) + 1\n"
      "              if ($.statemem.lostTU > 3) {\n"
      "                $.catching = null\n"
      "                if ($.ps.vy === 0 && $.ps.y < 0) $.ps.vy = 1\n"
      "                $.trans.frame($.ps.y < 0 ? 180 : 0, 25)\n"
      "                break\n"
      "              }\n"
      "            } else { $.statemem.lostTU = 0 }\n"
      "            if ($.frame.N === 135) {",
      'FLF-iOS: release orphan catch', 1)
# safety net: a fighter frozen in the air (same frame, same height) for 2 seconds is made to fall
patch('LF/livingobject.js',
      "      $.effect.timein--\n      if ($.effect.timein < 0 && $.effect.stuck) {\n        ; // stuck!\n      } else {\n        $.state_update('transit')\n      }",
      "      $.effect.timein--\n      if ($.effect.timein < 0 && $.effect.stuck) {\n        ; // stuck!\n      } else {\n        $.state_update('transit')\n      }\n"
      "      if ($.type === 'character' && $.health && $.health.hp > 0) { // FLF-iOS: air freeze guard\n"
      "        if ($.ps.y < 0 && $.frame.N === $._hangN && Math.abs($.ps.y - $._hangY) < 0.5) {\n"
      "          if (++$._hangT > 60) {\n"
      "            $._hangT = 0\n"
      "            $.effect.stuck = false; $.effect.timein = 0; $.effect.timeout = 0\n"
      "            $.catching = null\n"
      "            $.ps.vy = 1\n"
      "            $.trans.frame($.data.frame[212] ? 212 : 0, 30)\n"
      "          }\n"
      "        } else { $._hangT = 0; $._hangN = $.frame.N; $._hangY = $.ps.y }\n"
      "      }",
      'FLF-iOS: air freeze guard', 1)
print('engine patched')
