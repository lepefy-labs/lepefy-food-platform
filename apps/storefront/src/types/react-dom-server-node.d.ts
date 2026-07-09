// react-dom 18 ships a real "server.node" subpath export (server.node.js) with
// the legacy synchronous APIs (renderToStaticMarkup/renderToString) — required
// because "react-dom/server.edge" only exposes streaming APIs, and the plain
// "react-dom/server" entry is blocked by Next's RSC boundary check inside app/.
// @types/react-dom has no declarations for this subpath, hence this ambient module.
declare module 'react-dom/server.node' {
  export { renderToStaticMarkup, renderToString } from 'react-dom/server';
}
