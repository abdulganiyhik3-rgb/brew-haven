import { createClient } from "npm:@supabase/supabase-js@2";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info, x-paystack-signature",
    "Access-Control-Max-Age": "86400"
  });
  const origin = request.headers.get("origin");
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((value) => value.trim());
  if (origin && (allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

async function readJson(request: Request): Promise<{ body: Record<string, unknown>; raw: Uint8Array }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 32 * 1024) throw new HttpError(413, "Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A valid JSON body is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 32 * 1024) {
      await reader.cancel();
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "A JSON object is required.");
    return { body: body as Record<string, unknown>, raw };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "A valid JSON body is required.");
  }
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(503, "Supabase configuration is incomplete.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function failOnError<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function getPaystackSecret(): string {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) throw new HttpError(503, "Paystack is not configured.");
  return key;
}

async function paystackRequest(path: string, body?: Record<string, unknown>) {
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
    throw new HttpError(502, result.message || "Paystack could not complete the request.");
  }
  return result.data;
}

async function verifyPaystackPayment(reference: string) {
  const client = getSupabase();
  const order = failOnError(await client.from("orders")
    .select("id,total,payment_status,payment_reference")
    .eq("payment_reference", reference)
    .maybeSingle());
  if (!order) throw new HttpError(404, "No order matches this payment reference.");
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

async function initializePayment(body: Record<string, unknown>) {
  const customerName = body.customer_name;
  const customerEmail = body.customer_email;
  const items = body.items;
  if (typeof customerName !== "string" || !customerName.trim() || customerName.length > 100) {
    throw new HttpError(400, "Enter a customer name up to 100 characters.");
  }
  if (typeof customerEmail !== "string" || customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    throw new HttpError(400, "Your cart must contain between 1 and 30 products.");
  }

  const requested = new Map<number, number>();
  for (const item of items) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.product_id) ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      throw new HttpError(400, "A cart item is invalid.");
    }
    const quantity = (requested.get(item.product_id) || 0) + item.quantity;
    if (quantity > 50) throw new HttpError(400, "A product quantity cannot exceed 50.");
    requested.set(item.product_id, quantity);
  }

  const callbackUrl = Deno.env.get("PAYSTACK_CALLBACK_URL");
  if (!callbackUrl) throw new HttpError(503, "Set PAYSTACK_CALLBACK_URL in Supabase function secrets.");
  getPaystackSecret();
  try {
    const callback = new URL(callbackUrl);
    if (callback.protocol !== "https:" && !(callback.protocol === "http:" && callback.hostname === "localhost")) {
      throw new Error("The callback URL must use HTTPS, except for localhost development.");
    }
  } catch (error) {
    throw new HttpError(503, error instanceof Error ? error.message : "The callback URL is invalid.");
  }

  const client = getSupabase();
  const productRows = failOnError(await client.from("products")
    .select("id,name,price")
    .eq("is_available", true)
    .in("id", [...requested.keys()]));
  if (productRows.length !== requested.size) {
    throw new HttpError(400, "One or more selected products are no longer available.");
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
    throw new HttpError(400, "The order total is invalid.");
  }

  const reference = `brew-${crypto.randomUUID()}`;
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
    return { status: 201, body: { authorization_url: payment.authorization_url } };
  } catch (error) {
    failOnError(await client.from("orders")
      .update({ payment_status: "failed" })
      .eq("id", order.id)
      .eq("payment_status", "pending"));
    throw error;
  }
}

function decodeHex(value: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function isValidPaystackSignature(raw: Uint8Array, signature: string): Promise<boolean> {
  const received = decodeHex(signature);
  if (!received) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getPaystackSecret()),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  if (received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ received[index];
  return difference === 0;
}

 Deno.serve(async (request: Request): Promise<Response> => {
  const headers = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const method = request.method.toUpperCase();
  const path = new URL(request.url).pathname.replace(/^\/payments/, "") || "/";

  console.log("REQUEST METHOD:", method);
  console.log("REQUEST PATH:", path);

  try {
    if (method === "POST" && (path === "/initialize" || path === "/orders")) {
      const { body } = await readJson(request);
      const result = await initializePayment(body);
      return json(result.body, result.status, headers);
    }
    if (method === "GET" && path === "/verify") {
      const reference = new URL(request.url).searchParams.get("reference");
      if (!reference || reference.length > 100 || !/^brew-[\w-]+$/.test(reference)) {
        throw new HttpError(400, "A valid payment reference is required.");
      }
      return json(await verifyPaystackPayment(reference), 200, headers);
    }
    if (method === "POST" && path === "/webhook") {
      const { body, raw } = await readJson(request);
      const signature = request.headers.get("x-paystack-signature") || "";
      if (!await isValidPaystackSignature(raw, signature)) throw new HttpError(401, "Invalid webhook signature.");
      if (body.event === "charge.success") {
const data = body.data as { reference?: unknown } | null;
const reference = data && typeof data === "object" ? data.reference : null;
        if (typeof reference !== "string" || !/^brew-[\w-]+$/.test(reference)) {
          throw new HttpError(400, "The payment reference is invalid.");
        }
        const result = await verifyPaystackPayment(reference);
        if (!result.paid) throw new HttpError(400, "The payment has not been confirmed.");
      }
      return new Response(null, { status: 200, headers });
    }
    if (method === "GET" && path === "/health") {
      return json({ success: true, message: "Brew Haven API is running!" }, 200, headers);
    }
    throw new HttpError(404, "API endpoint not found.");
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    const message = status < 500 && error instanceof Error ? error.message
      : status === 503 && error instanceof Error ? error.message
      : "The request could not be completed. Check the function logs and backend configuration.";
    return json({ error: message }, status, headers);
  }
});
