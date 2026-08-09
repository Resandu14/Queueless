const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const ROOT_DIRECTORY = __dirname;
const DATA_DIRECTORY = path.join(ROOT_DIRECTORY, "data");
const DATABASE_PATH = path.join(DATA_DIRECTORY, "queueless.db");
const PORT = Number(process.env.PORT || 3000);
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
const SECURE_COOKIE = process.env.NODE_ENV === "production" ? "; Secure" : "";
const MOCK_BUSINESS = {
  slug: "bean-bloom",
  name: "Bean & Bloom",
  email: "owner@beanandbloom.lk",
  password: "BeanBloom!2026",
  location: "Colombo 07"
};

fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    location TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    business_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    order_text TEXT NOT NULL,
    tracking_token TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'fulfilled', 'cancelled')),
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    accepted_at TEXT,
    fulfilled_at TEXT,
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    business_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  );
  CREATE INDEX IF NOT EXISTS orders_by_business_and_status
    ON orders (business_id, status, created_at DESC);
`);

function ensureOrderTrackingTokens() {
  const columns = database.prepare("PRAGMA table_info(orders)").all();
  if (!columns.some((column) => column.name === "tracking_token")) {
    database.exec("ALTER TABLE orders ADD COLUMN tracking_token TEXT");
  }
  database.exec("CREATE INDEX IF NOT EXISTS orders_by_tracking_token ON orders(tracking_token)");

  const missingTokens = database
    .prepare("SELECT id FROM orders WHERE tracking_token IS NULL OR tracking_token = ''")
    .all();
  const updateToken = database.prepare("UPDATE orders SET tracking_token = ? WHERE id = ?");
  for (const order of missingTokens) {
    updateToken.run(crypto.randomBytes(24).toString("base64url"), order.id);
  }
}

ensureOrderTrackingTokens();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function seedDatabase() {
  const existingBusiness = database
    .prepare("SELECT id FROM businesses WHERE email = ?")
    .get(MOCK_BUSINESS.email);

  if (!existingBusiness) {
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    database
      .prepare(
        `INSERT INTO businesses (slug, name, email, password_hash, password_salt, location, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        MOCK_BUSINESS.slug,
        MOCK_BUSINESS.name,
        MOCK_BUSINESS.email,
        hashPassword(MOCK_BUSINESS.password, passwordSalt),
        passwordSalt,
        MOCK_BUSINESS.location,
        new Date().toISOString()
      );
  }

  const business = database
    .prepare("SELECT id FROM businesses WHERE slug = ?")
    .get(MOCK_BUSINESS.slug);
  const orderCount = database
    .prepare("SELECT COUNT(*) AS count FROM orders WHERE business_id = ?")
    .get(business.id).count;

  if (orderCount === 0) {
    const now = Date.now();
    const sampleOrders = [
      ["A-01", "Kavindu Silva", "+94771234567", "Mocha, cheese toastie", "fulfilled", null, 3],
      ["A-02", "Leah Wijesinghe", "+94779876543", "2 cold brews", "fulfilled", null, 2],
      ["A-03", "Rishi Patel", "+94775551234", "Double espresso", "cancelled", "Customer request", 1]
    ];
    const insertOrder = database.prepare(
      `INSERT INTO orders (
        public_id, business_id, customer_name, customer_phone, order_text, tracking_token, status,
        cancel_reason, created_at, updated_at, accepted_at, fulfilled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const [publicId, customerName, customerPhone, orderText, status, cancelReason, minutesAgo] of sampleOrders) {
      const timestamp = new Date(now - minutesAgo * 60 * 1000).toISOString();
      insertOrder.run(
        publicId,
        business.id,
        customerName,
        customerPhone,
        orderText,
        crypto.randomBytes(24).toString("base64url"),
        status,
        cancelReason,
        timestamp,
        timestamp,
        status === "fulfilled" ? timestamp : null,
        status === "fulfilled" ? timestamp : null
      );
    }
  }
}

seedDatabase();

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function createSession(businessId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000).toISOString();
  database
    .prepare("INSERT INTO sessions (token, business_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(token, businessId, expiresAt, now.toISOString());
  return token;
}

function getSession(request) {
  const { queueless_business_session: token } = parseCookies(request);
  if (!token) return null;

  const session = database
    .prepare(
      `SELECT sessions.token, businesses.id, businesses.name, businesses.email, businesses.location
       FROM sessions
       JOIN businesses ON businesses.id = sessions.business_id
       WHERE sessions.token = ? AND sessions.expires_at > ?`
    )
    .get(token, new Date().toISOString());
  return session || null;
}

function requireSession(request, response) {
  const session = getSession(request);
  if (!session) {
    sendError(response, 401, "Please sign in to access the business dashboard.");
    return null;
  }
  return session;
}

function orderPayload(order, includeTrackingToken = false) {
  const payload = {
    id: order.id,
    publicId: order.public_id,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    orderText: order.order_text,
    status: order.status,
    cancelReason: order.cancel_reason,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    acceptedAt: order.accepted_at,
    fulfilledAt: order.fulfilled_at,
    business: order.business_name
      ? { name: order.business_name, location: order.business_location }
      : undefined
  };
  if (includeTrackingToken) payload.trackingToken = order.tracking_token;
  return payload;
}

function getNextPublicId() {
  const latest = database.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM orders").get();
  return `A-${String(latest.id + 1).padStart(2, "0")}`;
}

function getOrderWithBusiness(publicId) {
  return database
    .prepare(
      `SELECT orders.*, businesses.name AS business_name, businesses.location AS business_location
       FROM orders
       JOIN businesses ON businesses.id = orders.business_id
       WHERE orders.public_id = ?`
    )
    .get(publicId);
}

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/api/businesses") {
    const businesses = database
      .prepare("SELECT slug, name, location FROM businesses WHERE is_active = 1 ORDER BY name")
      .all();
    return sendJson(response, 200, { businesses });
  }

  if (request.method === "POST" && pathname === "/api/orders") {
    const payload = await readJson(request);
    const businessSlug = String(payload.businessSlug || "").trim();
    const customerName = String(payload.customerName || "").trim();
    const customerPhone = String(payload.customerPhone || "").trim();
    const orderText = String(payload.orderText || "").trim();

    if (!businessSlug || customerName.length < 2 || customerPhone.length < 7 || orderText.length < 3) {
      return sendError(response, 400, "Please provide a store, your name, phone number, and an order description.");
    }
    if (customerName.length > 80 || customerPhone.length > 30 || orderText.length > 500) {
      return sendError(response, 400, "One or more order details are too long.");
    }

    const business = database
      .prepare("SELECT id, name, location FROM businesses WHERE slug = ? AND is_active = 1")
      .get(businessSlug);
    if (!business) return sendError(response, 404, "That store is not accepting orders right now.");

    const now = new Date().toISOString();
    const publicId = getNextPublicId();
    const trackingToken = crypto.randomBytes(24).toString("base64url");
    const result = database
      .prepare(
        `INSERT INTO orders (
          public_id, business_id, customer_name, customer_phone, order_text, tracking_token, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(publicId, business.id, customerName, customerPhone, orderText, trackingToken, now, now);
    const order = database.prepare("SELECT * FROM orders WHERE id = ?").get(result.lastInsertRowid);
    return sendJson(response, 201, { order: orderPayload(order, true) });
  }

  const customerOrderMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9-]+)$/);
  if (request.method === "GET" && customerOrderMatch) {
    const order = getOrderWithBusiness(customerOrderMatch[1]);
    if (!order) return sendError(response, 404, "Order not found.");
    const trackingToken = url.searchParams.get("token") || "";
    const receivedToken = Buffer.from(trackingToken);
    const storedToken = Buffer.from(order.tracking_token || "");
    if (receivedToken.length !== storedToken.length || !crypto.timingSafeEqual(receivedToken, storedToken)) {
      return sendError(response, 404, "Order not found.");
    }

    const position = database
      .prepare(
        `SELECT COUNT(*) AS count FROM orders
         WHERE business_id = ? AND status IN ('pending', 'accepted') AND created_at <= ?`
      )
      .get(order.business_id, order.created_at).count;
    return sendJson(response, 200, {
      order: orderPayload(order),
      queuePosition: order.status === "fulfilled" || order.status === "cancelled" ? 0 : position,
      estimatedWaitMinutes: order.status === "pending" ? Math.max(8, position * 5) : Math.max(5, position * 5)
    });
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const payload = await readJson(request);
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const business = database
      .prepare("SELECT * FROM businesses WHERE email = ? AND is_active = 1")
      .get(email);
    const receivedHash = business ? hashPassword(password, business.password_salt) : "";
    const passwordIsCorrect = Boolean(
      business &&
        crypto.timingSafeEqual(
          Buffer.from(receivedHash, "hex"),
          Buffer.from(business.password_hash, "hex")
        )
    );
    if (!passwordIsCorrect) return sendError(response, 401, "Incorrect email or password.");

    const token = createSession(business.id);
    return sendJson(
      response,
      200,
      { business: { name: business.name, email: business.email, location: business.location } },
      {
        "Set-Cookie": `queueless_business_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_SECONDS}${SECURE_COOKIE}`
      }
    );
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const { queueless_business_session: token } = parseCookies(request);
    if (token) database.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `queueless_business_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_COOKIE}`
    });
  }

  if (request.method === "GET" && pathname === "/api/auth/me") {
    const session = requireSession(request, response);
    if (!session) return;
    return sendJson(response, 200, {
      business: { name: session.name, email: session.email, location: session.location }
    });
  }

  if (request.method === "GET" && pathname === "/api/business/orders") {
    const session = requireSession(request, response);
    if (!session) return;
    const orders = database
      .prepare("SELECT * FROM orders WHERE business_id = ? ORDER BY created_at DESC")
      .all(session.id)
      .map(orderPayload);
    const stats = { pending: 0, accepted: 0, fulfilled: 0, cancelled: 0 };
    const todayStats = database
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM orders
         WHERE business_id = ?
           AND date(created_at, '+5 hours', '+30 minutes') = date('now', '+5 hours', '+30 minutes')
         GROUP BY status`
      )
      .all(session.id);
    for (const row of todayStats) stats[row.status] = row.count;
    return sendJson(response, 200, { orders, stats });
  }

  const businessOrderMatch = pathname.match(/^\/api\/business\/orders\/(\d+)$/);
  if (request.method === "PATCH" && businessOrderMatch) {
    const session = requireSession(request, response);
    if (!session) return;
    const payload = await readJson(request);
    const action = String(payload.action || "");
    const order = database
      .prepare("SELECT * FROM orders WHERE id = ? AND business_id = ?")
      .get(Number(businessOrderMatch[1]), session.id);
    if (!order) return sendError(response, 404, "Order not found.");

    let nextStatus;
    if (action === "accept" && order.status === "pending") nextStatus = "accepted";
    if (action === "fulfill" && order.status === "accepted") nextStatus = "fulfilled";
    if (action === "cancel" && ["pending", "accepted"].includes(order.status)) nextStatus = "cancelled";
    if (!nextStatus) return sendError(response, 400, "That action is not available for this order.");

    const now = new Date().toISOString();
    database
      .prepare(
        `UPDATE orders
         SET status = ?, updated_at = ?, accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_at END,
             fulfilled_at = CASE WHEN ? = 'fulfilled' THEN ? ELSE fulfilled_at END,
             cancel_reason = CASE WHEN ? = 'cancelled' THEN 'Store cancelled' ELSE cancel_reason END
         WHERE id = ?`
      )
      .run(nextStatus, now, nextStatus, now, nextStatus, now, nextStatus, order.id);
    const updatedOrder = database.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
    return sendJson(response, 200, { order: orderPayload(updatedOrder) });
  }

  return sendError(response, 404, "API route not found.");
}

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
  const blockedFiles = new Set(["server.js", "package.json", "README.md"]);
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
  console.log(`Demo business login: ${MOCK_BUSINESS.email} / ${MOCK_BUSINESS.password}`);
});
