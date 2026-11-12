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
print('engine patched')
