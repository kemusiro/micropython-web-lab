export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "child-src 'self'",
  "connect-src 'self'",
  "font-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self'",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "worker-src 'self'",
].join("; ");

export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=(), serial=(), hid=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
});

export const DEVELOPMENT_SECURITY_HEADERS = Object.freeze({
  ...SECURITY_HEADERS,
  "Content-Security-Policy": CONTENT_SECURITY_POLICY
    .replace("connect-src 'self'", "connect-src 'self' ws:")
    .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
});
