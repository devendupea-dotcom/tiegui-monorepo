const DEFAULT_SCRIPT_SOURCES = ["'self'", "'unsafe-inline'"];

function buildSourceDirective(name, sources) {
  return `${name} ${sources.join(" ")}`;
}

function uniqueSources(sources) {
  return [...new Set(sources.filter(Boolean))];
}

function buildBaseCspDirectives(options = {}) {
  const scriptSources = uniqueSources([
    ...DEFAULT_SCRIPT_SOURCES,
    ...(options.scriptSrc ?? []),
    ...(options.allowUnsafeEval ? ["'unsafe-eval'"] : []),
  ]);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    buildSourceDirective("script-src", scriptSources),
    "connect-src 'self' https: wss:",
    "frame-src 'self'",
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
}

const STRICT_TRANSPORT_SECURITY =
  "max-age=63072000; includeSubDomains; preload";

function buildPermissionsPolicy(options = {}) {
  const microphonePolicy = options.allowMicrophone ? "(self)" : "()";

  return [
    "camera=()",
    `microphone=${microphonePolicy}`,
    "geolocation=()",
    "payment=(self)",
    "usb=()",
    "serial=()",
    "bluetooth=()",
    "browsing-topics=()",
  ].join(", ");
}

function buildContentSecurityPolicy(options = {}) {
  const directives = buildBaseCspDirectives(options);
  if (options.upgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

export function buildSecurityHeaders(options = {}) {
  const headers = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(options),
    },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: buildPermissionsPolicy(options),
    },
  ];

  if (options.enableHsts) {
    headers.push({
      key: "Strict-Transport-Security",
      value: STRICT_TRANSPORT_SECURITY,
    });
  }

  return headers;
}
