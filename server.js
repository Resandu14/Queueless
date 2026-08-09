require("dotenv").config();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { handleApi, sendError } = require("./lib/api");

const ROOT_DIRECTORY = __dirname;
const PORT = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function serveStatic(response, url) {
  const requestedPath = url.pathname === "/" ? "/queless.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT_DIRECTORY, `.${requestedPath}`);
  const relativePath = path.relative(ROOT_DIRECTORY, filePath);
  const requestedSegments = relativePath.split(path.sep);
  const blockedFiles = new Set(["server.js", "package.json", "README.md", ".env", "vercel.json"]);
  const isBlocked = requestedSegments.some((segment) => segment === "data" || segment.startsWith(".")) || blockedFiles.has(relativePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || isBlocked) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(file);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    if (request.method === "HEAD") {
      response.writeHead(204).end();
      return;
    }
    serveStatic(response, url);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendError(response, 500, "Unexpected server error.");
    else response.end();
  }
});

server.listen(PORT, () => {
  console.log(`Queueless is running at http://localhost:${PORT}/queless.html`);
});
