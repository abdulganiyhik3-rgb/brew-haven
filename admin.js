const accessForm = document.querySelector("#admin-access");
const keyInput = accessForm.elements.admin_key;
const dashboard = document.querySelector("#admin-dashboard");
const message = document.querySelector("#admin-message");
const productForm = document.querySelector("#product-form");
const postForm = document.querySelector("#post-form");
const productsContainer = document.querySelector("#products");
const postsContainer = document.querySelector("#posts");
const ordersContainer = document.querySelector("#orders");
const salesContainer = document.querySelector("#sales");
let adminKey = "";

const money = (value) => new Intl.NumberFormat("en-US").format(value);

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
      ...options.headers
    }
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || "The request could not be completed.");
  return result;
}

function showError(error) {
  message.textContent = error.message;
}

function makeButton(label, action, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  if (className) button.className = className;
  return button;
}

async function loadProducts() {
  const products = await request("/api/admin/products");
  productsContainer.replaceChildren();
  products.forEach((product) => {
    const form = document.createElement("form");
    form.className = "admin-product-row";
    form.dataset.id = product.id;
    for (const [name, value, type] of [
      ["name", product.name, "text"],
      ["description", product.description, "text"],
      ["image_url", product.image_url, "text"],
      ["price", product.price, "number"]
    ]) {
      const input = document.createElement("input");
      input.name = name;
      input.type = type;
      input.value = value;
      input.required = true;
      if (name === "price") {
        input.min = "0";
        input.step = "0.01";
      }
      form.append(input);
    }
    const availableLabel = document.createElement("label");
    const available = document.createElement("input");
    available.type = "checkbox";
    available.name = "is_available";
    available.checked = product.is_available;
    availableLabel.append(available, document.createTextNode("Available"));
    form.append(availableLabel, makeButton("Save", "save-product"), makeButton("Delete", "delete-product"));
    productsContainer.append(form);
  });
}

async function loadPosts() {
  const posts = await request("/api/admin/posts");
  postsContainer.replaceChildren();
  posts.forEach((post) => {
    const form = document.createElement("form");
    form.className = "admin-post-row";
    form.dataset.id = post.id;
    const title = document.createElement("input");
    title.name = "title";
    title.value = post.title;
    title.required = true;
    const author = document.createElement("input");
    author.name = "author";
    author.value = post.author;
    author.required = true;
    const content = document.createElement("textarea");
    content.name = "content";
    content.value = post.content;
    content.required = true;
    form.append(title, author, content, makeButton("Save", "save-post"), makeButton("Delete", "delete-post"));
    postsContainer.append(form);
  });
}

async function loadOrders() {
  const orders = await request("/api/admin/orders");
  ordersContainer.replaceChildren();
  if (!orders.length) {
    ordersContainer.textContent = "No orders yet.";
    return;
  }
  orders.forEach((order) => {
    const row = document.createElement("article");
    row.className = "admin-order-row";
    const heading = document.createElement("strong");
    heading.textContent = `${order.customer_name} · ${money(order.total)}`;
    const paymentStatus = document.createElement("span");
    paymentStatus.textContent = `Payment: ${order.payment_status || "pending"}${order.customer_email ? ` · ${order.customer_email}` : ""}`;
    const date = document.createElement("span");
    date.textContent = new Date(order.created_at).toLocaleString();
    const itemList = document.createElement("p");
    itemList.textContent = order.items.map((item) => `${item.quantity} × ${item.name}`).join(", ");
    const status = document.createElement("select");
    status.dataset.id = order.id;
    status.disabled = order.payment_status !== "paid";
    for (const value of ["new", "preparing", "ready", "completed", "cancelled"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = order.status === value;
      status.append(option);
    }
    row.append(heading, paymentStatus, date, itemList, status);
    ordersContainer.append(row);
  });
}

async function loadSales() {
  const sales = await request("/api/admin/sales");
  document.querySelector("#sales-summary").textContent = `${sales.order_count} orders · ${money(sales.total)} total sales`;
  salesContainer.replaceChildren();
  if (!sales.orders.length) {
    salesContainer.textContent = "No sales yet.";
    return;
  }
  sales.orders.forEach((order) => {
    const row = document.createElement("p");
    row.textContent = `Order #${order.id} · ${new Date(order.created_at).toLocaleDateString()} · ${order.status} · ${order.payment_status} · ${money(order.total)}`;
    salesContainer.append(row);
  });
}

async function loadDashboard() {
  const results = await Promise.allSettled([loadProducts(), loadPosts(), loadOrders(), loadSales()]);
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected) throw rejected.reason;
}

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminKey = keyInput.value;
  message.textContent = "";
  try {
    await loadDashboard();
    dashboard.hidden = false;
    accessForm.hidden = true;
  } catch (error) {
    adminKey = "";
    keyInput.value = "";
    showError(error);
  }
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(productForm));
  values.price = Number(values.price);
  try {
    await request("/api/admin/products", { method: "POST", body: JSON.stringify(values) });
    productForm.reset();
    await loadProducts();
    showError({ message: "Product added." });
  } catch (error) {
    showError(error);
  }
});

productsContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const form = button.closest("form");
  const id = form.dataset.id;
  try {
    if (button.dataset.action === "delete-product") {
      await request(`/api/admin/products/${id}`, { method: "DELETE" });
    } else {
      const values = Object.fromEntries(new FormData(form));
      values.price = Number(values.price);
      values.is_available = form.elements.is_available.checked;
      await request(`/api/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(values) });
    }
    await loadProducts();
    showError({ message: "Product updated." });
  } catch (error) {
    showError(error);
  }
});

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(postForm));
  try {
    await request("/api/admin/posts", { method: "POST", body: JSON.stringify(values) });
    postForm.reset();
    postForm.elements.author.value = "Brew Haven";
    await loadPosts();
    showError({ message: "Post published." });
  } catch (error) {
    showError(error);
  }
});

postsContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const form = button.closest("form");
  try {
    if (button.dataset.action === "delete-post") {
      await request(`/api/admin/posts/${form.dataset.id}`, { method: "DELETE" });
    } else {
      await request(`/api/admin/posts/${form.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
    }
    await loadPosts();
    showError({ message: "Post updated." });
  } catch (error) {
    showError(error);
  }
});

ordersContainer.addEventListener("change", async (event) => {
  if (!event.target.matches("select[data-id]")) return;
  try {
    await request(`/api/admin/orders/${event.target.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: event.target.value })
    });
    await loadSales();
    showError({ message: "Order status updated." });
  } catch (error) {
    showError(error);
  }
});
