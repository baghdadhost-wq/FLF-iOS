/* Minimal ISO 9660 + Joliet builder (single root directory).
 * buildISO(files) -> Promise<Blob>   files: array of File/Blob with .name
 * File contents are not copied: the result is a Blob made of slices of the originals.
 */
(function (root) {
  'use strict'
  var SECTOR = 2048

  function bothU32(v, a, o) {     // little-endian then big-endian
    a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; a[o + 2] = (v >>> 16) & 255; a[o + 3] = (v >>> 24) & 255
    a[o + 4] = (v >>> 24) & 255; a[o + 5] = (v >>> 16) & 255; a[o + 6] = (v >>> 8) & 255; a[o + 7] = v & 255
  }
  function bothU16(v, a, o) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; a[o + 2] = (v >>> 8) & 255; a[o + 3] = v & 255 }
  function le32(v, a, o) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; a[o + 2] = (v >>> 16) & 255; a[o + 3] = (v >>> 24) & 255 }
  function be32(v, a, o) { a[o] = (v >>> 24) & 255; a[o + 1] = (v >>> 16) & 255; a[o + 2] = (v >>> 8) & 255; a[o + 3] = v & 255 }
  function le16(v, a, o) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255 }
  function be16(v, a, o) { a[o] = (v >>> 8) & 255; a[o + 1] = v & 255 }
  function ascii(s, a, o, len) { for (var i = 0; i < len; i++) a[o + i] = i < s.length ? s.charCodeAt(i) & 127 : 32 }
  function ucs2(s, a, o, len) {   // big-endian UCS-2, padded with spaces
    for (var i = 0; i < len / 2; i++) { var c = i < s.length ? s.charCodeAt(i) : 32; a[o + i * 2] = c >> 8; a[o + i * 2 + 1] = c & 255 }
  }
  function recDate(d, a, o) {
    a[o] = d.getUTCFullYear() - 1900; a[o + 1] = d.getUTCMonth() + 1; a[o + 2] = d.getUTCDate()
    a[o + 3] = d.getUTCHours(); a[o + 4] = d.getUTCMinutes(); a[o + 5] = d.getUTCSeconds(); a[o + 6] = 0
  }
  function vdDate(d, a, o) {
    function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n }
    var s = p(d.getUTCFullYear(), 4) + p(d.getUTCMonth() + 1, 2) + p(d.getUTCDate(), 2) + p(d.getUTCHours(), 2) + p(d.getUTCMinutes(), 2) + p(d.getUTCSeconds(), 2) + '00'
    ascii(s, a, o, 16); a[o + 16] = 0
  }
  function emptyDate(a, o) { ascii('0000000000000000', a, o, 16); a[o + 16] = 0 }

  // ISO 9660 level 1 names (8.3, upper case, unique)
  function shortNames(names) {
    var used = {}, out = []
    names.forEach(function (n) {
      var dot = n.lastIndexOf('.'), base = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot + 1) : ''
      var clean = function (s) { return s.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }
      base = clean(base) || 'FILE'; ext = clean(ext).slice(0, 3)
      var b = base.slice(0, 8), cand = b + (ext ? '.' + ext : ''), k = 1
      while (used[cand]) { var suf = '~' + k++; cand = base.slice(0, 8 - suf.length) + suf + (ext ? '.' + ext : '') }
      used[cand] = 1; out.push(cand)
    })
    return out
  }
  function jolietName(n) { return n.replace(/[*\/:;?\\]/g, '_').slice(0, 64) }

  function dirRecord(nameBytes, lba, size, isDir, date) {
    var len = 33 + nameBytes.length; if (len & 1) len++
    var r = new Uint8Array(len)
    r[0] = len; r[1] = 0
    bothU32(lba, r, 2); bothU32(size, r, 10); recDate(date, r, 18)
    r[25] = isDir ? 2 : 0; r[26] = 0; r[27] = 0; bothU16(1, r, 28)
    r[32] = nameBytes.length; r.set(nameBytes, 33)
    return r
  }
  function bytesAscii(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 127; return b }
  function bytesUcs2(s) { var b = new Uint8Array(s.length * 2); for (var i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 255 } return b }

  // lay out directory records so that none crosses a sector boundary
  function packDir(records) {
    var sectors = [], cur = [], used = 0
    records.forEach(function (r) {
      if (used + r.length > SECTOR) { sectors.push(cur); cur = []; used = 0 }
      cur.push(r); used += r.length
    })
    sectors.push(cur)
    var out = new Uint8Array(sectors.length * SECTOR)
    sectors.forEach(function (sec, i) { var o = i * SECTOR; sec.forEach(function (r) { out.set(r, o); o += r.length }) })
    return out
  }

  function buildISO(files, label) {
    label = (label || 'TRANSFER').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 32)
    var now = new Date()
    var names = files.map(function (f) { return f.name || 'FILE' })
    var shorts = shortNames(names)

    // pass 1: count directory sizes (they don't depend on LBAs)
    function makeRecords(rootLba, rootSize, joliet, fileLbas) {
      var recs = [dirRecord(new Uint8Array([0]), rootLba, rootSize, true, now), dirRecord(new Uint8Array([1]), rootLba, rootSize, true, now)]
      files.forEach(function (f, i) {
        var nb = joliet ? bytesUcs2(jolietName(names[i]) + ';1') : bytesAscii(shorts[i] + ';1')
        recs.push(dirRecord(nb, fileLbas ? fileLbas[i] : 0, f.size, false, now))
      })
      return recs
    }
    var priDirLen = packDir(makeRecords(0, 0, false)).length
    var jolDirLen = packDir(makeRecords(0, 0, true)).length

    var lbaPVD = 16, lbaSVD = 17, lbaTerm = 18
    var lbaPathL = 19, lbaPathM = 20, lbaJPathL = 21, lbaJPathM = 22
    var lbaPriDir = 23, lbaJolDir = lbaPriDir + priDirLen / SECTOR
    var next = lbaJolDir + jolDirLen / SECTOR
    var fileLbas = files.map(function (f) { var l = next; next += Math.max(1, Math.ceil(f.size / SECTOR)); return l })
    var total = next

    var priDir = packDir(makeRecords(lbaPriDir, priDirLen, false, fileLbas))
    var jolDir = packDir(makeRecords(lbaJolDir, jolDirLen, true, fileLbas))

    var head = new Uint8Array(lbaPriDir * SECTOR)
    function volDesc(o, joliet) {
      head[o] = joliet ? 2 : 1; ascii('CD001', head, o + 1, 5); head[o + 6] = 1
      if (joliet) { ucs2('', head, o + 8, 32); ucs2(label, head, o + 40, 32) } else { ascii('', head, o + 8, 32); ascii(label, head, o + 40, 32) }
      bothU32(total, head, o + 80)
      if (joliet) { head[o + 88] = 0x25; head[o + 89] = 0x2F; head[o + 90] = 0x45 }   // UCS-2 level 3
      bothU16(1, head, o + 120); bothU16(1, head, o + 124); bothU16(SECTOR, head, o + 128)
      bothU32(10, head, o + 132)
      le32(joliet ? lbaJPathL : lbaPathL, head, o + 140); le32(0, head, o + 144)
      be32(joliet ? lbaJPathM : lbaPathM, head, o + 148); be32(0, head, o + 152)
      var rootRec = dirRecord(new Uint8Array([0]), joliet ? lbaJolDir : lbaPriDir, joliet ? jolDirLen : priDirLen, true, now)
      head.set(rootRec.subarray(0, 34), o + 156)
      var txt = joliet ? ucs2 : ascii
      txt('', head, o + 190, 128); txt('', head, o + 318, 128); txt('F.LF iOS', head, o + 446, 128); txt('F.LF iOS', head, o + 574, 128)
      txt('', head, o + 702, joliet ? 36 : 37); txt('', head, o + 739, joliet ? 36 : 37); txt('', head, o + 776, joliet ? 36 : 37)
      vdDate(now, head, o + 813); vdDate(now, head, o + 830); emptyDate(head, o + 847); emptyDate(head, o + 864)
      head[o + 881] = 1
    }
    volDesc(lbaPVD * SECTOR, false)
    volDesc(lbaSVD * SECTOR, true)
    var t = lbaTerm * SECTOR; head[t] = 255; ascii('CD001', head, t + 1, 5); head[t + 6] = 1
    function pathTable(o, lba, big) {
      head[o] = 1; head[o + 1] = 0
      if (big) { be32(lba, head, o + 2); be16(1, head, o + 6) } else { le32(lba, head, o + 2); le16(1, head, o + 6) }
      head[o + 8] = 0; head[o + 9] = 0
    }
    pathTable(lbaPathL * SECTOR, lbaPriDir, false); pathTable(lbaPathM * SECTOR, lbaPriDir, true)
    pathTable(lbaJPathL * SECTOR, lbaJolDir, false); pathTable(lbaJPathM * SECTOR, lbaJolDir, true)

    var parts = [head, priDir, jolDir]
    files.forEach(function (f) {
      parts.push(f)
      var pad = Math.max(1, Math.ceil(f.size / SECTOR)) * SECTOR - f.size
      if (pad) parts.push(new Uint8Array(pad))
    })
    return Promise.resolve(new Blob(parts, { type: 'application/octet-stream' }))
  }

  root.buildISO = buildISO
})(typeof window !== 'undefined' ? window : globalThis)
