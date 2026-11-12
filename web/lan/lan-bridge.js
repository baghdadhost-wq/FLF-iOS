/* LAN multiplayer bridge (main frame). Connects F.LF's network code to the app's native TCP link. */
(function () {
  if (window.__lan) return
  var L = window.__lan = {
    handler: null,
    queue: [],
    cmd: function (o) {
      var n = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.lan
      if (n) n.postMessage(o)
      else if (L.mock) L.mock(o)
    },
    // data from the other phone (a JSON string)
    recv: function (str) {
      var obj
      try { obj = JSON.parse(str) } catch (e) { return }
      if (L.handler) L.handler.on('data', obj)
      else L.queue.push(obj)
    },
    // status events from the app -> the lobby page
    event: function (ev) {
      var f = document.querySelector('.lobby_window')
      if (f && f.contentWindow) f.contentWindow.postMessage({ lanEvent: ev }, '*')
      if (ev.type === 'closed' && L.handler) L.handler.on('close')
    },
    attach: function (h) {
      L.handler = h
      h.on('log', 'LAN: connected')
      h.on('open', { send: function (o) { L.cmd({ cmd: 'send', data: JSON.stringify(o) }) } })
      var q = L.queue; L.queue = []
      q.forEach(function (o) { h.on('data', o) })
    },
    detach: function () { L.handler = null; L.queue = []; L.cmd({ cmd: 'stop' }) }
  }
  window.addEventListener('message', function (e) {
    if (e.data && e.data.lanCmd) L.cmd(e.data.lanCmd)
  })
})()
