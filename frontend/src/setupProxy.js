// Proxy the visualiser WebSocket through the CRA dev server. With this in
// place the front-end can connect to `wss://<same-host>/ws/detect-stream`
// regardless of how the page itself is served (localhost, LAN IP, ngrok…),
// and a single ngrok tunnel on port 3000 covers both the React app and the
// detection backend on port 5000.
//
// react-scripts loads this file automatically on dev server start; it has
// http-proxy-middleware as a transitive dependency, so no install is needed.

const { createProxyMiddleware } = require('http-proxy-middleware');

// Path filter goes inside the proxy config (not app.use). When path is
// passed to app.use, Express strips it from req.url before the proxy sees
// the request, which breaks the proxy's auto-attach to the server's
// `upgrade` event — and silently drops WebSocket handshakes.
module.exports = function (app) {
  const wsProxy = createProxyMiddleware('/ws/detect-stream', {
    target: 'http://localhost:5000',
    changeOrigin: true,
    ws: true,
    logLevel: 'warn',
  });
  app.use(wsProxy);
};
