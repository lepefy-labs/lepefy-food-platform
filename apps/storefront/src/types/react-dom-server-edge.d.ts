// react-dom 18 does not ship a "server.edge" subpath export, but Next.js aliases
// it internally to the streaming-safe renderer — required to import react-dom/server
// inside app/ (the plain "react-dom/server" entry is blocked by Next's RSC boundary check).
// @types/react-dom has no declarations for this alias, hence this ambient module.
declare module 'react-dom/server.edge' {
  export { renderToStaticMarkup, renderToString } from 'react-dom/server';
}
