const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const DIST_DIR = path.join(__dirname, "dist");
const upstreamRaw = process.env.API_UPSTREAM_URL || process.env.VITE_API_BASE_URL || "http://localhost:8080";
const upstream = new URL(upstreamRaw);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not found" }));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("internal server error");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      "Content-Type": contentType
    });
    res.end(data);
  });
}

function proxyAPI(req, res, pathname, search) {
  let backendPath = pathname.replace(/^\/api/, "");
  if (!backendPath) backendPath = "/";

  const targetPath = `${backendPath}${search || ""}`;
  const client = upstream.protocol === "https:" ? https : http;

  const headers = { ...req.headers };
  headers.host = upstream.host;
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "https";

  const proxyReq = client.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: targetPath,
      headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    console.error("[proxy] upstream request failed", err.message);
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "upstream unavailable" }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const method = (req.method || "GET").toUpperCase();
  const rawUrl = req.url || "/";
  const url = new URL(rawUrl, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if ((pathname === "/api" || pathname.startsWith("/api/")) && ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method)) {
    proxyAPI(req, res, pathname, url.search);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    sendNotFound(res);
    return;
  }

  const relativePath = pathname.replace(/^\/+/, "");
  let requested = path.resolve(DIST_DIR, relativePath);
  if (!requested.startsWith(DIST_DIR)) {
    sendNotFound(res);
    return;
  }

  if (requested.endsWith(path.sep)) requested = path.resolve(requested, "index.html");

  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    serveFile(res, requested);
    return;
  }

  // SPA fallback
  const fallback = path.join(DIST_DIR, "index.html");
  if (!fs.existsSync(fallback)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("web bundle not found");
    return;
  }
  serveFile(res, fallback);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`web server listening on ${PORT}, proxying /api to ${upstream.origin}`);
});
