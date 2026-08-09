const loginForm = document.querySelector("[data-login-form]");
const loginMessage = document.querySelector("[data-login-message]");
const logoutButton = document.querySelector("[data-logout]");
const ownerName = document.querySelector("[data-owner-name]");
const incomingList = document.querySelector("[data-incoming-list]");
const emptyIncoming = document.querySelector("[data-empty-incoming]");
const toast = document.querySelector("[data-toast]");

let toastTimer;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-LK", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Colombo"
  }).format(new Date(value));
}

function setMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.className = `form-message ${type}`.trim();
}

function setStat(name, value) {
  document.querySelectorAll(`[data-stat="${name}"]`).forEach((element) => {
    element.textContent = value;
  });
}

function showToast(message) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function orderStatusLabel(status) {
  return status === "pending" ? "Awaiting confirmation" : "Preparing";
}

function renderIncomingOrders(orders) {
  if (!incomingList || !emptyIncoming) return;
  const activeOrders = orders.filter((order) => ["pending", "accepted"].includes(order.status));
  incomingList.replaceChildren();
  emptyIncoming.hidden = activeOrders.length > 0;
  incomingList.hidden = activeOrders.length === 0;

  activeOrders.forEach((order) => {
    const orderCard = document.createElement("article");
    const isPending = order.status === "pending";
    orderCard.className = "incoming-order";
    orderCard.dataset.orderId = order.id;
    orderCard.innerHTML = `
      <div class="order-number">#${escapeHtml(order.publicId)}</div>
      <div class="order-details">
        <div class="order-title-row">
          <h3>${escapeHtml(order.customerName)}</h3>
          <span class="order-status ${isPending ? "awaiting" : "preparing"}">${orderStatusLabel(order.status)}</span>
        </div>
        <p>${escapeHtml(order.orderText)}</p>
        <small>${escapeHtml(order.customerPhone)} · Placed at ${formatTime(order.createdAt)}</small>
      </div>
      <div class="order-actions">
        <button class="text-button" type="button" data-order-action="cancel">Cancel</button>
        <button class="dark-button" type="button" data-order-action="${isPending ? "accept" : "fulfill"}">${isPending ? "Accept order" : "Mark fulfilled"}</button>
      </div>
    `;
    incomingList.append(orderCard);
  });
}

function renderHistory(tableId, orders, type) {
  const tableBody = document.querySelector(`#${tableId} tbody`);
  if (!tableBody) return;
  const historyOrders = orders.filter((order) => order.status === type);
  tableBody.replaceChildren();

  if (historyOrders.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = '<td colspan="3" class="empty-table">No orders here yet.</td>';
    tableBody.append(emptyRow);
    return;
  }

  historyOrders.forEach((order) => {
    const row = document.createElement("tr");
    const finalDetail = type === "fulfilled"
      ? formatTime(order.fulfilledAt || order.updatedAt)
      : escapeHtml(order.cancelReason || "Store cancelled");
    row.innerHTML = `
      <td><b>#${escapeHtml(order.publicId)}</b></td>
      <td><span>${escapeHtml(order.customerName)}</span><small>${escapeHtml(order.orderText)}</small></td>
      <td>${finalDetail}</td>
    `;
    tableBody.append(row);
  });
}

function renderDashboard({ orders, stats }) {
  setStat("new", stats.pending);
  setStat("preparing", stats.accepted);
  setStat("fulfilled", stats.fulfilled);
  setStat("cancelled", stats.cancelled);
  renderIncomingOrders(orders);
  renderHistory("fulfilled-orders", orders, "fulfilled");
  renderHistory("cancelled-orders", orders, "cancelled");
}

async function loadDashboard() {
  try {
    const result = await getJson("/api/business/orders");
    renderDashboard(result);
  } catch (error) {
    if (error.message.includes("sign in")) {
      window.location.href = "index.html";
      return;
    }
    showToast(error.message);
  }
}

async function initialiseDashboard() {
  if (!incomingList) return;
  try {
    const { business } = await getJson("/api/auth/me");
    if (ownerName) ownerName.textContent = business.name;
    const eyebrow = document.querySelector(".dashboard-intro .eyebrow");
    if (eyebrow) eyebrow.textContent = `${business.name} · ${business.location}`;
    await loadDashboard();
    window.setInterval(loadDashboard, 10_000);
  } catch {
    window.location.href = "index.html";
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;

    const formData = new FormData(loginForm);
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Signing in…";
    setMessage(loginMessage, "Checking your account…");

    try {
      await getJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries()))
      });
      window.location.href = "dashboard.html";
    } catch (error) {
      setMessage(loginMessage, error.message, "error");
      submitButton.disabled = false;
      submitButton.textContent = "Open dashboard";
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await getJson("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "index.html";
    }
  });
}

if (incomingList) {
  incomingList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-order-action]");
    if (!button) return;
    const orderCard = button.closest("[data-order-id]");
    if (!orderCard) return;

    const action = button.dataset.orderAction;
    document.querySelectorAll(`[data-order-id="${orderCard.dataset.orderId}"] button`).forEach((item) => {
      item.disabled = true;
    });

    try {
      const { order } = await getJson(`/api/business/orders/${orderCard.dataset.orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ action })
      });
      const actionCopy = {
        accept: "is now in the preparation queue.",
        fulfill: "was moved to fulfilled orders.",
        cancel: "was moved to cancelled orders."
      };
      showToast(`#${order.publicId} ${actionCopy[action]}`);
      await loadDashboard();
    } catch (error) {
      showToast(error.message);
      document.querySelectorAll(`[data-order-id="${orderCard.dataset.orderId}"] button`).forEach((item) => {
        item.disabled = false;
      });
    }
  });
}

initialiseDashboard();
