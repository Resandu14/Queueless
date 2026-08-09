const orderForm = document.querySelector("[data-order-form]");
const orderMessage = document.querySelector("[data-order-message]");
const storeSelect = document.querySelector("[data-store-select]");
const submitOrderButton = document.querySelector("[data-submit-order]");

function setOrderMessage(message, type = "") {
  if (!orderMessage) return;
  orderMessage.textContent = message;
  orderMessage.className = `form-message ${type}`.trim();
}

async function loadBusinesses() {
  if (!storeSelect) return;

  try {
    const response = await fetch("/api/businesses");
    if (!response.ok) throw new Error("Could not load stores.");
    const { businesses } = await response.json();
    storeSelect.replaceChildren();

    businesses.forEach((business) => {
      const option = document.createElement("option");
      option.value = business.slug;
      option.textContent = `${business.name} · ${business.location}`;
      storeSelect.append(option);
    });
  } catch {
    setOrderMessage("Start the Queueless server to send an order to the business dashboard.", "error");
  }
}

if (orderForm) {
  orderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!orderForm.reportValidity()) return;

    const formData = new FormData(orderForm);
    const payload = Object.fromEntries(formData.entries());
    submitOrderButton.disabled = true;
    submitOrderButton.textContent = "Sending order…";
    setOrderMessage("Sending your order to the store…");

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not place your order.");

      const query = new URLSearchParams({
        order: result.order.publicId,
        token: result.order.trackingToken
      });
      window.location.href = `queue.html?${query.toString()}`;
    } catch (error) {
      setOrderMessage(error.message || "Could not place your order.", "error");
      submitOrderButton.disabled = false;
      submitOrderButton.textContent = "Place order";
    }
  });
}

loadBusinesses();
