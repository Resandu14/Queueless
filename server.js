require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { createClient } = require("@supabase/supabase-js");

const ROOT_DIRECTORY = __dirname;
const PORT = Number(process.env.PORT || 3000);
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
const SECURE_COOKIE = process.env.NODE_ENV === "production" ? "; Secure" : "";
const ACCESS_COOKIE = "queueless_business_access";
const REFRESH_COOKIE = "queueless_business_refresh";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseIsConfigured = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_SERVICE_ROLE_KEY &&
    !SUPABASE_URL.includes("your-project-ref") &&
    !SUPABASE_ANON_KEY.includes("paste-") &&
    !SUPABASE_SERVICE_ROLE_KEY.includes("paste-")
);

const supabaseAdmin = supabaseIsConfigured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const supabaseAuth = supabaseIsConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function requireSupabase(response) {
  if (supabaseIsConfigured) return true;
  sendError(response, 500, "Add your Supabase keys to .env, then restart the server.");
  return false;
}

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

function cookieHeader(name, value, maxAge = SESSION_DURATION_SECONDS) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE_COOKIE}`;
}

function clearCookieHeader(name) {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_COOKIE}`;
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
    business: order.businesses
      ? { name: order.businesses.name, location: order.businesses.location }
      : undefined
  };
  if (includeTrackingToken) payload.trackingToken = order.tracking_token;
  return payload;
}

async function getSession(request, response) {
  if (!requireSupabase(response)) return null;

  const cookies = parseCookies(request);
  const accessToken = cookies[ACCESS_COOKIE];
  if (!accessToken) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id, name, email, location")
    .eq("owner_id", data.user.id)
    .eq("is_active", true)
    .single();

  if (businessError || !business) return null;
  return { user: data.user, business };
}

async function requireSession(request, response) {
  const session = await getSession(request, response);
  if (!session) {
    sendError(response, 401, "Please sign in to access the business dashboard.");
    return null;
  }
  return session;
}

async function getNextPublicId() {
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return `A-${String((count || 0) + 1).padStart(2, "0")}`;
}

async function getOrderWithBusiness(publicId) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*, businesses(name, location)")
    .eq("public_id", publicId)
    .single();
  if (error) return null;
  return data;
}

function isSameSriLankaDate(value) {
  const sriLankaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return sriLankaDate.format(new Date(value)) === sriLankaDate.format(new Date());
}

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (!requireSupabase(response)) return;

  if (request.method === "GET" && pathname === "/api/businesses") {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("slug, name, location")
      .eq("is_active", true)
      .order("name");
    if (error) return sendError(response, 500, error.message);
    return sendJson(response, 200, { businesses: data });
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

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("id, name, location")
      .eq("slug", businessSlug)
      .eq("is_active", true)
      .single();
    if (businessError || !business) return sendError(response, 404, "That store is not accepting orders right now.");

    const now = new Date().toISOString();
    const publicId = await getNextPublicId();
    const trackingToken = crypto.randomBytes(24).toString("base64url");
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        public_id: publicId,
        business_id: business.id,
        customer_name: customerName,
        customer_phone: customerPhone,
        order_text: orderText,
        tracking_token: trackingToken,
        status: "pending",
        created_at: now,
        updated_at: now
      })
      .select()
      .single();
    if (error) return sendError(response, 500, error.message);
    return sendJson(response, 201, { order: orderPayload(order, true) });
  }

  const customerOrderMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9-]+)$/);
  if (request.method === "GET" && customerOrderMatch) {
    const order = await getOrderWithBusiness(customerOrderMatch[1]);
    if (!order) return sendError(response, 404, "Order not found.");
    const trackingToken = url.searchParams.get("token") || "";
    const receivedToken = Buffer.from(trackingToken);
    const storedToken = Buffer.from(order.tracking_token || "");
    if (receivedToken.length !== storedToken.length || !crypto.timingSafeEqual(receivedToken, storedToken)) {
      return sendError(response, 404, "Order not found.");
    }

    const { count, error } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("business_id", order.business_id)
      .in("status", ["pending", "accepted"])
      .lte("created_at", order.created_at);
    if (error) return sendError(response, 500, error.message);

    const queuePosition = ["fulfilled", "cancelled"].includes(order.status) ? 0 : count || 0;
    return sendJson(response, 200, {
      order: orderPayload(order),
      queuePosition,
      estimatedWaitMinutes: order.status === "pending" ? Math.max(8, queuePosition * 5) : Math.max(5, queuePosition * 5)
    });
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const payload = await readJson(request);
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.session) return sendError(response, 401, "Incorrect email or password.");

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("name, email, location")
      .eq("owner_id", data.user.id)
      .eq("is_active", true)
      .single();
    if (businessError || !business) return sendError(response, 403, "No active business is connected to this account.");

    return sendJson(response, 200, { business }, {
      "Set-Cookie": [
        cookieHeader(ACCESS_COOKIE, data.session.access_token, data.session.expires_in || SESSION_DURATION_SECONDS),
        cookieHeader(REFRESH_COOKIE, data.session.refresh_token, 60 * 60 * 24 * 30)
      ]
    });
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const { [ACCESS_COOKIE]: accessToken } = parseCookies(request);
    if (accessToken) await supabaseAdmin.auth.admin.signOut(accessToken).catch(() => {});
    return sendJson(response, 200, { ok: true }, {
      "Set-Cookie": [clearCookieHeader(ACCESS_COOKIE), clearCookieHeader(REFRESH_COOKIE)]
    });
  }

  if (request.method === "GET" && pathname === "/api/auth/me") {
    const session = await requireSession(request, response);
    if (!session) return;
    return sendJson(response, 200, {
      business: {
        name: session.business.name,
        email: session.business.email,
        location: session.business.location
      }
    });
  }

  if (request.method === "GET" && pathname === "/api/business/orders") {
    const session = await requireSession(request, response);
    if (!session) return;
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("business_id", session.business.id)
      .order("created_at", { ascending: false });
    if (error) return sendError(response, 500, error.message);

    const stats = { pending: 0, accepted: 0, fulfilled: 0, cancelled: 0 };
    for (const order of orders) {
      if (isSameSriLankaDate(order.created_at)) stats[order.status] += 1;
    }
    return sendJson(response, 200, { orders: orders.map(orderPayload), stats });
  }

  const businessOrderMatch = pathname.match(/^\/api\/business\/orders\/([A-Fa-f0-9-]+)$/);
  if (request.method === "PATCH" && businessOrderMatch) {
    const session = await requireSession(request, response);
    if (!session) return;
    const payload = await readJson(request);
    const action = String(payload.action || "");

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", businessOrderMatch[1])
      .eq("business_id", session.business.id)
      .single();
    if (orderError || !order) return sendError(response, 404, "Order not found.");

    let nextStatus;
    if (action === "accept" && order.status === "pending") nextStatus = "accepted";
    if (action === "fulfill" && order.status === "accepted") nextStatus = "fulfilled";
    if (action === "cancel" && ["pending", "accepted"].includes(order.status)) nextStatus = "cancelled";
    if (!nextStatus) return sendError(response, 400, "That action is not available for this order.");

    const now = new Date().toISOString();
    const patch = {
      status: nextStatus,
      updated_at: now
    };
    if (nextStatus === "accepted") patch.accepted_at = now;
    if (nextStatus === "fulfilled") patch.fulfilled_at = now;
    if (nextStatus === "cancelled") patch.cancel_reason = "Store cancelled";

    const { data: updatedOrder, error } = await supabaseAdmin
      .from("orders")
      .update(patch)
      .eq("id", order.id)
      .select()
      .single();
    if (error) return sendError(response, 500, error.message);
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
  const blockedFiles = new Set(["server.js", "package.json", "README.md", ".env"]);
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
  if (!supabaseIsConfigured) console.log("Supabase is not configured yet. Add keys to .env and restart.");
});
