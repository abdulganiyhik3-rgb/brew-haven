const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-navigation");
const menuItems = document.querySelector(".menu-items");
const postsContainer = document.querySelector("#posts");
const cartStorageKey = "brewHavenCart";
const apiBaseUrl = "http://localhost:3000";
const cart = new Map();
let products = [];
const confirmation = document.createElement("div");
confirmation.className = "cart-confirmation";
confirmation.setAttribute("role", "status");
confirmation.setAttribute("aria-live", "polite");
document.body.append(confirmation);
let confirmationTimer;

const money = (value) => new Intl.NumberFormat("en-US").format(value);

async function request(path, options) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || "The request could not be completed.");
  return result;
}

function showMessage(message) {
  confirmation.textContent = message;
  confirmation.classList.add("is-visible");
  clearTimeout(confirmationTimer);
  confirmationTimer = setTimeout(() => confirmation.classList.remove("is-visible"), 3200);
}

const closeMenu = () => {
  navigation?.classList.remove("is-open");
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-label", "Open navigation menu");
};

menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") === "true";
  navigation?.classList.toggle("is-open", !open);
  menuToggle.setAttribute("aria-expanded", String(!open));
  menuToggle.setAttribute("aria-label", open ? "Open navigation menu" : "Close navigation menu");
});
navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

const cartButton = document.querySelector(".cart-button");

const cartOverlay = document.createElement("button");
cartOverlay.className = "cart-overlay";
cartOverlay.type = "button";
cartOverlay.setAttribute("aria-label", "Close shopping cart");
cartOverlay.setAttribute("aria-hidden", "true");
cartOverlay.inert = true;
document.body.append(cartOverlay);
const cartDrawer = document.createElement("aside");
cartDrawer.className = "cart-drawer";
cartDrawer.setAttribute("aria-label", "Shopping cart");
cartDrawer.setAttribute("role", "dialog");
cartDrawer.setAttribute("aria-modal", "true");
cartDrawer.setAttribute("aria-hidden", "true");
cartDrawer.inert = true;
cartDrawer.innerHTML = '<div class="cart-header"><h2>Your cart</h2><button class="cart-close" type="button" aria-label="Close shopping cart">×</button></div><div class="cart-items" aria-live="polite"></div><div class="cart-footer"><div class="cart-subtotal"><span>Subtotal</span><strong></strong></div><div class="cart-total"><span>Total</span><strong></strong></div><button class="continue-shopping" type="button">Continue shopping</button></div>';
document.body.append(cartDrawer);

const cartItems = cartDrawer.querySelector(".cart-items");
const cartSubtotal = cartDrawer.querySelector(".cart-subtotal strong");
const cartTotal = cartDrawer.querySelector(".cart-total strong");

function setCartOpen(open) {
  cartDrawer.classList.toggle("is-open", open);
  cartOverlay.classList.toggle("is-open", open);
  cartDrawer.setAttribute("aria-hidden", String(!open));
  cartOverlay.setAttribute("aria-hidden", String(!open));
  cartDrawer.inert = !open;
  cartOverlay.inert = !open;
  document.body.classList.toggle("cart-open", open);
  if (open) cartDrawer.querySelector(".cart-close").focus();
  else cartButton?.focus();
}

cartButton?.addEventListener("click", () => setCartOpen(true));
cartOverlay.addEventListener("click", () => setCartOpen(false));
cartDrawer.querySelector(".cart-close").addEventListener("click", () => setCartOpen(false));
cartDrawer.querySelector(".continue-shopping").addEventListener("click", () => setCartOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cartDrawer.classList.contains("is-open")) setCartOpen(false);
});

function restoreCart() {
  try {
    const savedItems = JSON.parse(localStorage.getItem(cartStorageKey) || "[]");
    if (!Array.isArray(savedItems)) throw new Error("Saved cart data has an invalid format.");
    for (const item of savedItems) {
      if (
        (typeof item.id !== "string" && typeof item.id !== "number") ||
        !item.name ||
        typeof item.name !== "string" ||
        typeof item.price !== "number" ||
        !Number.isFinite(item.price) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        throw new Error("Saved cart data contains an invalid item.");
      }
      cart.set(String(item.id), { ...item });
    }
  } catch (error) {
    cart.clear();
    showMessage(`Your saved cart could not be loaded: ${error.message}`);
  }
}

function saveCart() {
  try {
    localStorage.setItem(cartStorageKey, JSON.stringify([...cart.values()]));
  } catch (error) {
    showMessage(`Your cart could not be saved: ${error.message}`);
  }
}

function updateCartButton() {
  const quantity = [...cart.values()].reduce((sum, item) => sum + item.quantity, 0);
  cartButton.querySelector(".cart-count").textContent = String(quantity);
  cartButton.setAttribute("aria-label", `Open shopping cart, ${quantity} ${quantity === 1 ? "item" : "items"}`);
}

function renderCart() {
  cartItems.replaceChildren();
  let subtotal = 0;
  if (!cart.size) {
    const empty = document.createElement("div");
    empty.className = "cart-empty";
    const title = document.createElement("h3");
    title.textContent = "Your cart is empty";
    const message = document.createElement("p");
    message.textContent = "A little something delicious is waiting on our menu.";
    const browse = document.createElement("button");
    browse.type = "button";
    browse.className = "continue-shopping";
    browse.textContent = "Explore the menu";
    browse.addEventListener("click", () => {
      setCartOpen(false);
      document.querySelector("#menu").scrollIntoView({ behavior: "smooth" });
    });
    empty.append(title, message, browse);
    cartItems.append(empty);
  }
  cart.forEach((item, id) => {
    subtotal += item.price * item.quantity;
    const row = document.createElement("div");
    row.className = "cart-item";
    const image = document.createElement("img");
    image.src = item.image_url;
    image.alt = "";
    const details = document.createElement("div");
    details.className = "cart-item-info";
    const title = document.createElement("h3");
    title.textContent = item.name;
    const price = document.createElement("span");
    price.textContent = `${money(item.price)} each`;
    const controls = document.createElement("div");
    controls.className = "cart-controls";
    for (const [action, label, text] of [["decrease", `Decrease ${item.name}`, "−"], ["increase", `Increase ${item.name}`, "+"], ["remove", `Remove ${item.name}`, "Remove"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.dataset.id = id;
      button.setAttribute("aria-label", label);
      button.textContent = text;
      if (action === "remove") button.className = "cart-remove";
      controls.append(button);
    }
    const quantity = document.createElement("strong");
    quantity.textContent = String(item.quantity);
    controls.insertBefore(quantity, controls.children[1]);
    details.append(title, price, controls);
    row.append(image, details);
    cartItems.append(row);
  });
  cartSubtotal.textContent = money(subtotal);
  cartTotal.textContent = money(subtotal);
  updateCartButton();
  saveCart();
}

function addToCart(id) {
  const product = products.find((item) => String(item.id) === String(id));
  if (!product) return;
  const current = cart.get(String(id));
  cart.set(String(id), { ...product, quantity: current ? current.quantity + 1 : 1 });
  renderCart();
  showMessage(`${product.name} added to your cart.`);
  setCartOpen(true);
}

cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const item = cart.get(button.dataset.id);
  if (!item) return;
  if (button.dataset.action === "increase") item.quantity += 1;
  if (button.dataset.action === "decrease") item.quantity -= 1;
  if (button.dataset.action === "remove" || item.quantity <= 0) cart.delete(button.dataset.id);
  renderCart();
});

async function loadProducts() {
  try {
    products = await request("/api/products");
    for (const [id, savedItem] of cart) {
      const product = products.find((item) => String(item.id) === id);
      if (product) cart.set(id, { ...product, quantity: savedItem.quantity });
      else cart.delete(id);
    }
    renderCart();
    menuItems.replaceChildren();
    if (!products.length) {
      const message = document.createElement("p");
      message.textContent = "Our menu is being updated. Please check back soon.";
      menuItems.append(message);
      return;
    }
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "menu-card";
      const image = document.createElement("img");
      image.src = product.image_url;
      image.alt = product.name;
      const title = document.createElement("h3");
      title.textContent = product.name;
      const description = document.createElement("p");
      description.textContent = product.description;
      const button = document.createElement("button");
      button.className = "add-to-cart";
      button.type = "button";
      button.textContent = "Add to Cart";
      button.addEventListener("click", () => addToCart(product.id));
      const price = document.createElement("span");
      price.textContent = money(product.price);
      card.append(image, title, description, button, price);
      menuItems.append(card);
    });
  } catch (error) {
    menuItems.replaceChildren();
    const message = document.createElement("p");
    message.textContent = error.message;
    menuItems.append(message);
  }
}

async function loadPosts() {
  try {
    const posts = await request("/api/posts");
    postsContainer.replaceChildren();
    if (!posts.length) {
      const message = document.createElement("p");
      message.textContent = "There are no updates to share right now.";
      postsContainer.append(message);
      return;
    }
    posts.forEach((post) => {
      const article = document.createElement("article");
      article.className = "review-post";
      const title = document.createElement("h3");
      title.textContent = post.title;
      const content = document.createElement("p");
      content.className = "review-text";
      content.textContent = post.content;
      const author = document.createElement("p");
      author.className = "post-author";
      author.textContent = post.author;
      article.append(title, content, author);
      postsContainer.append(article);
    });
  } catch (error) {
    postsContainer.replaceChildren();
    const message = document.createElement("p");
    message.textContent = error.message;
    postsContainer.append(message);
  }
}

restoreCart();
renderCart();
loadProducts();
loadPosts();
