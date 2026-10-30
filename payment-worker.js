/**
 * GkiD FPX backend — Cloudflare Worker starter
 * Secrets: TOYYIBPAY_SECRET (Worker secret)
 * Vars: TOYYIBPAY_CATEGORY, APP_ORIGIN
 * KV binding: PAYMENTS
 *
 * IMPORTANT: configure with an adult account owner. Never put the secret in GitHub.
 */
const PLANS = {
  monthly: { amount: 499, name: "GkiD Advance Monthly", days: 30 },
  lifetime: { amount: 2999, name: "GkiD Advance Lifetime", days: null }
};

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return origin === env.APP_ORIGIN ? origin : null;
}

async function toyPost(base, path, fields) {
  const body = new URLSearchParams(fields);
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("Respons ToyyibPay tidak sah: " + raw.slice(0, 120)); }
  if (!response.ok) throw new Error("ToyyibPay HTTP " + response.status);
  return data;
}

async function verifyWithToyyibPay(env, order) {
  const rows = await toyPost("https://toyyibpay.com", "/index.php/api/getBillTransactions", {
    billCode: order.billCode,
    userSecretKey: env.TOYYIBPAY_SECRET,
    billpaymentStatus: "1"
  });
  if (!Array.isArray(rows)) return false;
  return rows.some(row =>
    String(row.billExternalReferenceNo || "") === order.orderId &&
    String(row.billpaymentStatus || "") === "1" &&
    Math.round(Number(row.billpaymentAmount) * 100) === order.amount &&
    String(row.billpaymentChannel || "").toLowerCase().includes("fpx")
  );
}

async function handleCreate(request, env, origin) {
  const body = await request.json().catch(() => ({}));
  const plan = PLANS[body.plan];
  if (!plan) return json({ error: "Pelan tidak sah." }, 400, origin);
  if (!env.TOYYIBPAY_SECRET || !env.TOYYIBPAY_CATEGORY || !env.APP_ORIGIN || !env.PAYMENTS) {
    return json({ error: "Backend belum dikonfigurasi oleh penjaga akaun." }, 503, origin);
  }

  const orderId = crypto.randomUUID();
  const returnUrl = env.APP_ORIGIN.replace(/\/$/, "") +
    "/advance.html?payment=return&order_id=" + encodeURIComponent(orderId);
  const callbackUrl = new URL("/api/toyyibpay-callback", request.url).toString();

  const result = await toyPost("https://toyyibpay.com", "/index.php/api/createBill", {
    userSecretKey: env.TOYYIBPAY_SECRET,
    categoryCode: env.TOYYIBPAY_CATEGORY,
    billName: plan.name,
    billDescription: "GkiD Advance access",
    billPriceSetting: "1",
    billPayorInfo: "0",
    billAmount: String(plan.amount),
    billReturnUrl: returnUrl,
    billCallbackUrl: callbackUrl,
    billExternalReferenceNo: orderId,
    billPaymentChannel: "0",
    billExpiryDays: "1"
  });

  const billCode = Array.isArray(result) ? result[0]?.BillCode : null;
  if (!billCode) return json({ error: "ToyyibPay tidak berjaya menyediakan bil." }, 502, origin);

  const order = {
    orderId, plan: body.plan, amount: plan.amount, billCode,
    state: "pending", createdAt: new Date().toISOString()
  };
  await env.PAYMENTS.put("order:" + orderId, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 3 });
  return json({ checkoutUrl: "https://toyyibpay.com/" + encodeURIComponent(billCode), orderId }, 200, origin);
}

async function handleCallback(request, env) {
  const form = await request.formData();
  const orderId = String(form.get("order_id") || "");
  const billCode = String(form.get("billcode") || "");
  if (!orderId || !billCode || !env.PAYMENTS || !env.TOYYIBPAY_SECRET) return new Response("Ignored", { status: 400 });
  const raw = await env.PAYMENTS.get("order:" + orderId);
  if (!raw) return new Response("Unknown order", { status: 404 });
  const order = JSON.parse(raw);
  if (order.billCode !== billCode) return new Response("Bill mismatch", { status: 400 });

  // Never trust the browser redirect or callback status alone.
  const verified = await verifyWithToyyibPay(env, order);
  if (verified) {
    order.state = "paid";
    order.verifiedAt = new Date().toISOString();
    order.access = order.plan === "lifetime" ? "lifetime" : "30-days";
    await env.PAYMENTS.put("order:" + orderId, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 365 * 5 });
  }
  return new Response(verified ? "OK" : "Payment not verified", { status: verified ? 200 : 202 });
}

async function handleStatus(request, env, origin) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Order ID tidak sah." }, 400, origin);
  const raw = await env.PAYMENTS.get("order:" + orderId);
  if (!raw) return json({ state: "not_found" }, 404, origin);
  const order = JSON.parse(raw);

  // Re-check against ToyyibPay server to handle a missed callback.
  if (order.state !== "paid" && await verifyWithToyyibPay(env, order)) {
    order.state = "paid";
    order.verifiedAt = new Date().toISOString();
    order.access = order.plan === "lifetime" ? "lifetime" : "30-days";
    await env.PAYMENTS.put("order:" + orderId, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 365 * 5 });
  }
  return json({
    state: order.state,
    plan: order.plan,
    access: order.state === "paid" ? order.access : null,
    note: "Pengesahan pembayaran sahaja; akaun pengguna dan pengaktifan akses aplikasi belum disambungkan."
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/toyyibpay-callback" && request.method === "POST") {
      try { return await handleCallback(request, env); }
      catch { return new Response("Callback verification failed", { status: 500 }); }
    }

    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") {
      if (!origin) return new Response("Origin not allowed", { status: 403 });
      return new Response(null, { headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }});
    }
    if (!origin) return json({ error: "Origin tidak dibenarkan." }, 403);
    try {
      if (url.pathname === "/api/create-checkout" && request.method === "POST") return await handleCreate(request, env, origin);
      if (url.pathname === "/api/payment-status" && request.method === "GET") return await handleStatus(request, env, origin);
      return json({ error: "Not found" }, 404, origin);
    } catch {
      return json({ error: "Ralat backend. Sila cuba semula." }, 500, origin);
    }
  }
};
