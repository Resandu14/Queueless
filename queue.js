const queueNumber = document.querySelector("[data-queue-number]");
const queueWait = document.querySelector("[data-queue-wait]");
const queueHeading = document.querySelector("[data-queue-heading]");
const queueDescription = document.querySelector("[data-queue-description]");
const orderId = new URLSearchParams(window.location.search).get("order");
const trackingToken = new URLSearchParams(window.location.search).get("token");

const statusCopy = {
  pending: {
    heading: "Order sent to the store.",
    description: (order) => `${order.business.name} is reviewing your order. You will see an update here once it is accepted.`
  },
  accepted: {
    heading: "Order accepted.",
    description: (order, position) => `${order.business.name} is preparing your order. There ${position === 1 ? "is" : "are"} ${position} active order${position === 1 ? "" : "s"} ahead of you.`
  },
  fulfilled: {
    heading: "Your order is ready.",
    description: (order) => `${order.business.name} has marked your order as fulfilled. You can collect it now.`
  },
  cancelled: {
    heading: "This order was cancelled.",
    description: (order) => `${order.business.name} cancelled this order${order.cancelReason ? `: ${order.cancelReason.toLowerCase()}.` : "."}`
  }
};

function showOrder(data) {
  const { order, queuePosition, estimatedWaitMinutes } = data;
  const copy = statusCopy[order.status];
  queueNumber.textContent = `#${order.publicId}`;
  queueWait.textContent = order.status === "fulfilled" ? "Ready now" : order.status === "cancelled" ? "—" : `${estimatedWaitMinutes} minutes`;
  queueHeading.textContent = copy.heading;
  queueDescription.textContent = copy.description(order, queuePosition);
}

async function refreshQueue() {
  if (!orderId || !trackingToken) {
    queueHeading.textContent = "No order selected.";
    queueDescription.textContent = "Place an order first to receive a live queue update.";
    queueWait.textContent = "—";
    return;
  }

  try {
    const query = new URLSearchParams({ token: trackingToken });
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}?${query.toString()}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Order not found.");
    showOrder(result);
  } catch (error) {
    queueHeading.textContent = "We could not load this order.";
    queueDescription.textContent = error.message || "Please return to the order page and try again.";
    queueWait.textContent = "—";
  }
}

refreshQueue();
if (orderId) window.setInterval(refreshQueue, 10_000);
