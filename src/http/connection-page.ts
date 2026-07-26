import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The page is served from the same origin as the MCP bearer endpoint, so it
 * stays scriptless. `font-src 'self'` is the only relaxation: it admits the
 * three same-origin typefaces below and nothing else. Styles remain inline
 * because `style-src` does not list 'self'.
 */
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  vary: "Accept",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function readPublicAsset(name: string): Buffer {
  return readFileSync(new URL(`./public/${name}`, import.meta.url));
}

const CONNECTION_PAGE = readPublicAsset("index.html");

/**
 * An exact-match table rather than a filesystem lookup. Request paths are only
 * ever compared against these keys, so no user-supplied string reaches the
 * filesystem and path traversal is not expressible.
 */
const FONT_ASSETS = new Map<string, Buffer>([
  ["/assets/text.woff2", readPublicAsset("text.woff2")],
  ["/assets/text-italic.woff2", readPublicAsset("text-italic.woff2")],
  ["/assets/mono.woff2", readPublicAsset("mono.woff2")],
]);

function accepts(request: IncomingMessage, mediaType: string): boolean {
  return (
    request.headers.accept?.split(",").some((value) => {
      const [type, ...parameters] = value.split(";").map((part) => part.trim().toLowerCase());
      if (type !== mediaType) {
        return false;
      }
      const quality = parameters.find((parameter) => parameter.startsWith("q="));
      return quality === undefined || Number(quality.slice(2)) > 0;
    }) ?? false
  );
}

/**
 * Treat only a plain HTML GET as a setup-page visit. MCP clients that ask for
 * the event-stream media type must continue through the transport auth path.
 */
export function acceptsConnectionPage(request: IncomingMessage): boolean {
  return (
    request.method === "GET" &&
    accepts(request, "text/html") &&
    !accepts(request, "text/event-stream")
  );
}

export function respondConnectionPage(response: ServerResponse): void {
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-language": "en",
    "content-type": "text/html; charset=utf-8",
  });
  response.end(CONNECTION_PAGE);
}

/** True when the path names one of the connection page's own typefaces. */
export function isFontAssetRequest(request: IncomingMessage, pathname: string): boolean {
  return (request.method === "GET" || request.method === "HEAD") && FONT_ASSETS.has(pathname);
}

export function respondFontAsset(
  request: IncomingMessage,
  pathname: string,
  response: ServerResponse,
): void {
  const asset = FONT_ASSETS.get(pathname);
  if (asset === undefined) {
    return;
  }

  response.writeHead(200, {
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": asset.byteLength,
    "content-type": "font/woff2",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(asset);
}
