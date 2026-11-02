import "dotenv/config";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
const port = Number(process.env.PORT || 3000);
const statuses = ["new", "preparing", "ready", "completed", "cancelled"];

app.use(express.json({
  limit: "32kb",
  verify(request, response, buffer) {
    request.rawBody = buffer;
  }
}));

app.use((request, response, next) => {
  const origin = request.get("Origin");
  response.vary("Origin");

  if (origin === "http://localhost:5500") {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  }

  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});

function getSupabase() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key || url.includes("your-project") || key.includes("your-supabase")) {
    const error = new Error("Supabase server configuration is incomplete. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
    error.status = 503;
    throw error;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireAdmin(request, response, next) {
  const configuredKey = process.env.ADMIN_KEY;
  const suppliedKey = request.get("x-admin-key") || "";
  if (!configuredKey || configuredKey.startsWith("replace-with-")) {
    return response.status(503).json({ error: "Set ADMIN_KEY in .env before using admin operations." });
  }
  const supplied = Buffer.from(suppliedKey);
  const expected = Buffer.from(configuredKey);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return response.status(401).json({ error: "Admin key is invalid." });
  }
  next();
}

function failOnError(result) {
  if (result.error) {
    const error = new Error(result.error.message);
    error.status = 500;
    throw error;
  }
  return result.data;
}

function getPaystackSecret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || key.includes("your-paystack") || key.startsWith("replace-with-")) {
    const error = new Error("Paystack is not configured. Set PAYSTACK_SECRET_KEY in the server .env file.");
    error.status = 503;
    throw error;
  }
  return key;
}

async function paystackRequest(path, body) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${getPaystackSecret()}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok || !result.status) {
    const error = new Error(result.message || "Paystack could not complete the request.");
    error.status = 502;
    throw error;
  }
  return result.data;
}

async function verifyPaystackPayment(reference) {
  const client = getSupabase();
  const order = failOnError(await client.from("orders")
    .select("id,total,payment_status,payment_reference")
    .eq("payment_reference", reference)
    .maybeSingle());
  if (!order) {
    const error = new Error("No order matches this payment reference.");
    error.status = 404;
    throw error;
  }
  if (order.payment_status === "paid") return { paid: true, orderId: order.id };

  const transaction = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
  const expectedAmount = Math.round(Number(order.total) * 100);
  if (
    transaction.status !== "success" ||
    transaction.reference !== order.payment_reference ||
    transaction.amount !== expectedAmount ||
    transaction.currency !== "NGN"
  ) {
    return { paid: false, orderId: order.id };
  }

  failOnError(await client.from("orders")
    .update({ payment_status: "paid" })
    .eq("id", order.id)
    .neq("payment_status", "paid"));
  return { paid: true, orderId: order.id };
}

async function initializePayment(request, response) {
  const { customer_name: customerName, customer_email: customerEmail, items } = request.body || {};
  if (typeof customerName !== "string" || !customerName.trim() || customerName.length > 100) {
    return response.status(400).json({ error: "Enter a customer name up to 100 characters." });
  }
  if (typeof customerEmail !== "string" || customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    return response.status(400).json({ error: "Your cart must contain between 1 and 30 products." });
  }

  const requested = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      return response.status(400).json({ error: "A cart item is invalid." });
    }
    const quantity = (requested.get(item.product_id) || 0) + item.quantity;
    if (quantity > 50) return response.status(400).json({ error: "A product quantity cannot exceed 50." });
    requested.set(item.product_id, quantity);
  }

  const callbackUrl = process.env.PAYSTACK_CALLBACK_URL;
  console.log({callbackUrl});
  
  if (!callbackUrl) {
    const error = new Error("Set PAYSTACK_CALLBACK_URL in the server .env file.");
    error.status = 503;
    throw error;
  }
  getPaystackSecret();
  try {
    const callback = new URL(callbackUrl);
    if (callback.protocol !== "https:" && !(callback.protocol === "http:" && callback.hostname === "localhost")) {
      throw new Error("The callback URL must use HTTPS, except for localhost development.");
    }
  } catch (error) {
    error.status = 503;
    throw error;
  }

  const client = getSupabase();
  const productRows = failOnError(await client.from("products")
    .select("id,name,price")
    .eq("is_available", true)
    .in("id", [...requested.keys()]));
  if (productRows.length !== requested.size) {
    return response.status(400).json({ error: "One or more selected products are no longer available." });
  }

  const orderItems = productRows.map((product) => ({
    product_id: product.id,
    name: product.name,
    quantity: requested.get(product.id),
    unit_price: Number(product.price)
  }));
  const amountMinor = orderItems.reduce(
    (sum, item) => sum + Math.round(item.unit_price * 100) * item.quantity,
    0
  );
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return response.status(400).json({ error: "The order total is invalid." });
  }

  const reference = `brew-${randomUUID()}`;
  const order = failOnError(await client.from("orders").insert({
    customer_name: customerName.trim(),
    customer_email: customerEmail.trim().toLowerCase(),
    items: orderItems,
    total: amountMinor / 100,
    payment_reference: reference,
    payment_status: "pending"
  }).select("id,total").single());

  try {
    const payment = await paystackRequest("/transaction/initialize", {
      email: customerEmail.trim().toLowerCase(),
      amount: amountMinor,
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: { order_id: order.id }
    });
    if (payment.reference !== reference || !payment.authorization_url) {
      throw new Error("Paystack returned an invalid payment initialization response.");
    }
    return response.status(201).json({ authorization_url: payment.authorization_url });
  } catch (error) {
    failOnError(await client.from("orders")
      .update({ payment_status: "failed" })
      .eq("id", order.id)
      .eq("payment_status", "pending"));
    throw error;
  }
}

function validProduct(input, partial = false) {
  const product = {};
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100) return null;
    product.name = input.name.trim();
  }
  if (!partial || input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > 1000) return null;
    product.description = input.description.trim();
  }
  if (!partial || input.image_url !== undefined) {
    if (typeof input.image_url !== "string" || !input.image_url.trim() || input.image_url.length > 500) return null;
    product.image_url = input.image_url.trim();
  }
  if (!partial || input.price !== undefined) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0 || price > 10000000) return null;
    product.price = price;
  }
  if (input.is_available !== undefined) {
    if (typeof input.is_available !== "boolean") return null;
    product.is_available = input.is_available;
  }
  return Object.keys(product).length ? product : null;
}

function validPost(input) {
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 150) return null;
  if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 5000) return null;
  const author = input.author === undefined ? "Brew Haven" : input.author;
  if (typeof author !== "string" || !author.trim() || author.length > 100) return null;
  return { title: input.title.trim(), content: input.content.trim(), author: author.trim() };
}

app.get("/api/products", async (request, response) => {
  const data = failOnError(await getSupabase().from("products").select("id,name,description,image_url,price").eq("is_available", true).order("created_at"));
  response.json(data);
});

app.get("/api/posts", async (request, response) => {
  const data = failOnError(await getSupabase().from("posts").select("id,title,content,author,created_at").order("created_at", { ascending: false }));
  response.json(data);
});

app.post(["/api/payments/initialize", "/api/orders"], initializePayment);

app.get("/api/payments/verify", async (request, response) => {
  const reference = request.query.reference;
  if (typeof reference !== "string" || reference.length > 100 || !/^brew-[\w-]+$/.test(reference)) {
    return response.status(400).json({ error: "A valid payment reference is required." });
  }
  response.json(await verifyPaystackPayment(reference));
});

app.post("/api/payments/webhook", async (request, response) => {
  const signature = request.get("x-paystack-signature") || "";
  if (!Buffer.isBuffer(request.rawBody)) {
    return response.status(400).json({ error: "A JSON webhook body is required." });
  }
  const secret = getPaystackSecret();
  const expected = createHmac("sha512", secret).update(request.rawBody).digest();
  let received;
  try {
    received = Buffer.from(signature, "hex");
  } catch {
    return response.status(401).json({ error: "Invalid webhook signature." });
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return response.status(401).json({ error: "Invalid webhook signature." });
  }

  if (request.body?.event === "charge.success") {
    const reference = request.body.data?.reference;
    if (typeof reference !== "string" || !/^brew-[\w-]+$/.test(reference)) {
      return response.status(400).json({ error: "The payment reference is invalid." });
    }
    const result = await verifyPaystackPayment(reference);
    if (!result.paid) return response.status(400).json({ error: "The payment has not been confirmed." });
  }
  response.sendStatus(200);
});

app.use("/api/admin", requireAdmin);

app.get("/api/admin/products", async (request, response) => {
  response.json(failOnError(await getSupabase().from("products").select("*").order("created_at", { ascending: false })));
});

app.post("/api/admin/products", async (request, response) => {
  const product = validProduct(request.body);
  if (!product) return response.status(400).json({ error: "Provide a valid name, description, image URL, and non-negative price." });
  response.status(201).json(failOnError(await getSupabase().from("products").insert(product).select().single()));
});

app.patch("/api/admin/products/:id", async (request, response) => {
  const product = validProduct(request.body, true);
  if (!product) return response.status(400).json({ error: "Provide at least one valid product field." });
  const data = failOnError(await getSupabase().from("products").update(product).eq("id", request.params.id).select().single());
  response.json(data);
});

app.delete("/api/admin/products/:id", async (request, response) => {
  failOnError(await getSupabase().from("products").delete().eq("id", request.params.id));
  response.status(204).end();
});

app.get("/api/admin/orders", async (request, response) => {
  response.json(failOnError(await getSupabase().from("orders").select("*").order("created_at", { ascending: false })));
});

app.patch("/api/admin/orders/:id", async (request, response) => {
  const { status } = request.body || {};
  if (!statuses.includes(status)) return response.status(400).json({ error: "Choose a valid order status." });
  const client = getSupabase();
  const order = failOnError(await client.from("orders").select("payment_status").eq("id", request.params.id).single());
  if (order.payment_status !== "paid") {
    return response.status(409).json({ error: "Only verified paid orders can be processed." });
  }
  const data = failOnError(await client.from("orders").update({ status }).eq("id", request.params.id).select().single());
  response.json(data);
});

app.get("/api/admin/sales", async (request, response) => {
  const orders = failOnError(await getSupabase().from("orders").select("id,total,status,payment_status,created_at").eq("payment_status", "paid").neq("status", "cancelled").order("created_at", { ascending: false }));
  response.json({
    total: orders.reduce((sum, order) => sum + Number(order.total), 0),
    order_count: orders.length,
    orders
  });
});

app.get("/api/admin/posts", async (request, response) => {
  response.json(failOnError(await getSupabase().from("posts").select("*").order("created_at", { ascending: false })));
});

app.post("/api/admin/posts", async (request, response) => {
  const post = validPost(request.body || {});
  if (!post) return response.status(400).json({ error: "Provide a title, content, and author with valid lengths." });
  response.status(201).json(failOnError(await getSupabase().from("posts").insert(post).select().single()));
});

app.patch("/api/admin/posts/:id", async (request, response) => {
  const post = validPost(request.body || {});
  if (!post) return response.status(400).json({ error: "Provide a title, content, and author with valid lengths." });
  response.json(failOnError(await getSupabase().from("posts").update(post).eq("id", request.params.id).select().single()));
});

app.delete("/api/admin/posts/:id", async (request, response) => {
  failOnError(await getSupabase().from("posts").delete().eq("id", request.params.id));
  response.status(204).end();
});

app.use("/api", (request, response) => response.status(404).json({ error: "API endpoint not found." }));
app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(error.status || 500).json({ error: error.status === 503 ? error.message : "The request could not be completed. Check the server logs and database connection." });
});

app.use("/img", express.static("img"));

const { createServer: createViteServer } = await import("vite");
if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist"));
} else {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Brew Haven running at http://localhost:${port}`);
});
