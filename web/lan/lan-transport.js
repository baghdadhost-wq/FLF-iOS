/* transport module loaded by F.LF core/network.js for the LAN "server" */
define(function () {
  return {
    setup: function (config, handler) { window.__lan.attach(handler) },
    teardown: function () { window.__lan.detach() }
  }
})
