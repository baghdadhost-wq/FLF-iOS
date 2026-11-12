/*\
 * soundpack (iOS / Web Audio replacement for F.LF's LF/soundpack.js)
 * Same interface as the original: new soundmanager(config) -> {play(path), TU()}
 * and soundmanager.support(callback).
 * Decodes the whole sound sprite once into an AudioBuffer and plays slices,
 * which works on iOS where <audio> sprites stay silent.
\*/
define([], function () {
  const AC = window.AudioContext || window.webkitAudioContext
  let ctx = null
  let master = null

  function getCtx() {
    if (!ctx && AC) {
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.9
      master.connect(ctx.destination)
    }
    return ctx
  }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch (e) {}

  // iOS only starts audio after a real user gesture
  function unlock() {
    const c = getCtx()
    if (!c || (c.state === 'running' && unlock.done)) return
    unlock.done = c.state === 'running'
    if (c.state !== 'running') { c.resume().catch(function () {}) }
    try {
      const b = c.createBuffer(1, 1, 22050)
      const s = c.createBufferSource()
      s.buffer = b; s.connect(c.destination); s.start(0)
    } catch (e) {}
  }
  ;['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, unlock, true)
  })
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(function () {})
  })

  function pickExts(exts) {
    const a = document.createElement('audio')
    const types = { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg; codecs="vorbis"', wav: 'audio/wav', ac3: 'audio/ac3', aac: 'audio/aac' }
    const prefer = ['m4a', 'mp3', 'ogg', 'wav']
    const list = prefer.filter(function (e) { return exts.indexOf(e) !== -1 && a.canPlayType && a.canPlayType(types[e]) })
    exts.forEach(function (e) { if (list.indexOf(e) === -1) list.push(e) })
    return list
  }

  function loadBuffer(urls, i, done) {
    if (i >= urls.length) { done(null); return }
    const xhr = new XMLHttpRequest()
    xhr.open('GET', urls[i], true)
    xhr.responseType = 'arraybuffer'
    xhr.onload = function () {
      if (xhr.status !== 200 && xhr.status !== 0) { loadBuffer(urls, i + 1, done); return }
      const c = getCtx()
      const ok = function (buf) { done(toMono(c, buf)) }
      const bad = function () { loadBuffer(urls, i + 1, done) }
      try {
        const p = c.decodeAudioData(xhr.response, ok, bad)
        if (p && p.catch) p.catch(bad)
      } catch (e) { bad() }
    }
    xhr.onerror = function () { loadBuffer(urls, i + 1, done) }
    xhr.send()
  }

  function toMono(c, buf) {
    if (!buf || buf.numberOfChannels < 2) return buf
    try {
      const n = buf.length, m = c.createBuffer(1, n, buf.sampleRate), out = m.getChannelData(0)
      const L = buf.getChannelData(0), R = buf.getChannelData(1)
      for (let i = 0; i < n; i++) out[i] = (L[i] + R[i]) * 0.5
      return m
    } catch (e) { return buf }
  }

  function soundmanager(config) {
    if (!config || !AC) {
      return { play: function () {}, TU: function () {}, dummy: true }
    }
    getCtx()
    this.packs = {}
    this.buffer = {}
    this.time = 0
    const This = this
    config.packs.forEach(function (pk) {
      const data = pk.data
      const entry = This.packs[pk.id] = { frame: data.sound, buf: null }
      const urls = pickExts(data.ext).map(function (ext) {
        const src = data.file + '.' + ext
        return config.resourcemap ? config.resourcemap.get(src) : src
      })
      loadBuffer(urls, 0, function (buf) { entry.buf = buf })
    })
  }
  soundmanager.prototype.play = function (path) {
    if (this.buffer[path]) return // play each sound once only in one TU
    this.buffer[path] = true
    let I, id
    if (path.charAt(1) === '/') { I = path.charAt(0); id = path.slice(2) } else {
      const str = path.split('/'); I = str[0]; id = str[1]
    }
    const pk = this.packs[I]
    if (!pk || !pk.buf || !pk.frame[id] || !ctx || ctx.state !== 'running') return
    const f = pk.frame[id]
    try {
      const s = ctx.createBufferSource()
      s.buffer = pk.buf
      s.connect(master)
      s.start(0, f.start, Math.max(0.01, f.end - f.start))
    } catch (e) {}
  }
  soundmanager.prototype.TU = function () {
    this.time++
    if (this.time % 5 === 0) {
      for (const I in this.buffer) this.buffer[I] = null
    }
  }
  soundmanager.support = function (callback) {
    if (AC) setTimeout(function () { callback({ autoplay: true, webaudio: true }) }, 0)
  }
  return soundmanager
})
