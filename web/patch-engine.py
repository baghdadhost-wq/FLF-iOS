"""Small compatibility patches for F.LF so the extra (hidden) LF2 characters run.
usage: python3 patch-engine.py <path to F.LF>"""
import sys, os
root = sys.argv[1]

def patch(rel, old, new, tag):
    p = os.path.join(root, rel)
    s = open(p).read()
    if tag in s:
        return
    assert old in s, rel + ': pattern not found'
    s = s.replace(old, new)
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
print('engine patched')
