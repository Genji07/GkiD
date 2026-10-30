/**
 * GkiD Advance payment API — Cloudflare Worker
 *
 * Required bindings:
 *   KV namespace: GKID_ORDERS
 *   Secret: TOYYIBPAY_SECRET
 *   Secret: TOYYIBPAY_CATEGORY
 *   Variable: GKID_APP_URL (e.g. https://genji07.github.io/GkiD)
 *   Variable: TOYYIBPAY_BASE_URL (optional; defaults to https://toyyibpay.com)
 *
 * Never put ToyyibPay secrets in the website or GitHub Pages.
 */
const PLANS = {
  monthly: { amount: 499, name: "GkiD Advance Bulanan", days: 30 },
  lifetime: { amount: 2999, name: "GkiD Advance Lifetime", days: null }
};

function cors(origin, env) {
  const allowed = (env.GKID_APP_URL || "").replace(/\/$/, "");
  if (!allowed || origin !== allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}
function hex(bytes) {
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// Small MD5 implementation for ToyyibPay's documented callback hash.
function md5(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 8) >>> 6) + 1) * 64;
  const data = new Uint8Array(paddedLen);
  data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);
  let a0=0x67452301, b0=0xefcdab89, c0=0x98badcfe, d0=0x10325476;
  const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  const K=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*0x100000000)>>>0);
  for(let off=0;off<paddedLen;off+=64){
    const M=Array.from({length:16},(_,i)=>view.getUint32(off+i*4,true));
    let A=a0,B=b0,C=c0,D=d0;
    for(let i=0;i<64;i++){
      let F,g,sh;
      if(i<16){F=(B&C)|(~B&D);g=i;sh=shifts[i%4];}
      else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)%16;sh=shifts[4+i%4];}
      else if(i<48){F=B^C^D;g=(3*i+5)%16;sh=shifts[8+i%4];}
      else{F=C^(B|~D);g=(7*i)%16;sh=shifts[12+i%4];}
      const sum=(A+F+K[i]+M[g])>>>0;
      const rot=((sum<<sh)|(sum>>>(32-sh)))>>>0;
      const next=(B+rot)>>>0;
      A=D;D=C;C=B;B=next;
    }
    a0=(a0+A)>>>0;b0=(b0+B)>>>0;c0=(c0+C)>>>0;d0=(d0+D)>>>0;
  }
  const out=new Uint8Array(16),v=new DataView(out.buffer);
  [a0,b0,c0,d0].forEach((x,i)=>v.setUint32(i*4,x,true));
  return hex(out);
}
async function toyPost(env, endpoint, fields) {
  const body = new URLSearchParams(fields);
  const base = (env.TOYYIBPAY_BASE_URL || "https://toyyibpay.com").replace(/\/$/, "");
  const res = await fetch(base + "/index.php/api/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Respons pembayaran tidak sah."); }
  if (!res.ok || parsed?.status === "error") throw new Error("Penyedia pembayaran menolak permintaan.");
  return parsed;
}
async function createBill(request, env) {
  if (!env.TOYYIBPAY_SECRET || !env.TOYYIBPAY_CATEGORY || !env.GKID_ORDERS || !env.GKID_APP_URL)
    return json({ error: "Backend pembayaran belum dikonfigurasi." }, 503);
  const body = await request.json().catch(() => ({}));
  const planKey = body.plan;
  const plan = PLANS[planKey];
  if (!plan) return json({ error: "Pelan tidak sah." }, 400);

  const orderId = crypto.randomUUID();
  const accessToken = hex(crypto.getRandomValues(new Uint8Array(24)));
  const appUrl = env.GKID_APP_URL.replace(/\/$/, "");
  const callbackUrl = new URL("/api/toyyibpay/callback", request.url).toString();
  const result = await toyPost(env, "createBill", {
    userSecretKey: env.TOYYIBPAY_SECRET,
    categoryCode: env.TOYYIBPAY_CATEGORY,
    billName: plan.name,
    billDescription: planKey === "monthly" ? "Akses GkiD Advance 30 hari" : "Akses GkiD Advance seumur hidup",
    billPriceSetting: "1",
    billPayorInfo: "0",
    billAmount: String(plan.amount),
    billReturnUrl: appUrl + "/advance.html?payment=return&order=" + encodeURIComponent(orderId),
    billCallbackUrl: callbackUrl,
    billExternalReferenceNo: orderId,
    billPaymentChannel: "0"
  });
  const billCode = Array.isArray(result) ? result[0]?.BillCode : result?.BillCode;
  if (!billCode || typeof billCode !== "string") return json({ error: "Kod bil tidak diterima." }, 502);

  await env.GKID_ORDERS.put("order:" + orderId, JSON.stringify({
    orderId, plan: planKey, amount: plan.amount, billCode,
    accessToken, paid: false, createdAt: Date.now()
  }), { expirationTtl: 60 * 60 * 24 * 90 });
  const base = (env.TOYYIBPAY_BASE_URL || "https://toyyibpay.com").replace(/\/$/, "");
  return json({ checkoutUrl: base + "/" + encodeURIComponent(billCode), orderId });
}
async function paymentCallback(request, env) {
  if (!env.TOYYIBPAY_SECRET || !env.GKID_ORDERS) return new Response("Not configured", { status: 503 });
  const form = await request.formData();
  const status = String(form.get("status") || "");
  const orderId = String(form.get("order_id") || "");
  const refno = String(form.get("refno") || "");
  const receivedHash = String(form.get("hash") || "");
  const billCode = String(form.get("billcode") || "");
  if (!orderId || !refno || !billCode) return new Response("Missing fields", { status: 400 });

  const raw = await env.GKID_ORDERS.get("order:" + orderId);
  if (!raw) return new Response("Unknown order", { status: 404 });
  const order = JSON.parse(raw);
  const expectedHash = md5(env.TOYYIBPAY_SECRET + status + orderId + refno + "ok");
  if (!constantTimeEqual(expectedHash.toLowerCase(), receivedHash.toLowerCase()))
    return new Response("Invalid callback signature", { status: 403 });
  if (billCode !== order.billCode || status !== "1") return new Response("Payment not successful", { status: 200 });

  // Verify the transaction with ToyyibPay's server API before granting access.
  const transactions = await toyPost(env, "getBillTransactions", {
    billCode,
    userSecretKey: env.TOYYIBPAY_SECRET,
    billpaymentStatus: "1"
  });
  if (!Array.isArray(transactions)) return new Response("Verification pending", { status: 202 });
  const match = transactions.find(t =>
    String(t.billpaymentStatus) === "1" &&
    String(t.billExternalReferenceNo || "") === orderId
  );
  if (!match) return new Response("Verified transaction not found", { status: 202 });
  const paidAmount = Number(match.billpaymentAmount);
  const amountMatches = Number.isFinite(paidAmount) &&
    (Math.round(paidAmount * 100) === order.amount || Math.round(paidAmount) === order.amount);
  if (!amountMatches) return new Response("Amount mismatch", { status: 403 });

  const now = Date.now();
  order.paid = true;
  order.paidAt = now;
  order.expiresAt = order.plan === "monthly" ? now + 30 * 24 * 60 * 60 * 1000 : null;
  await env.GKID_ORDERS.put("order:" + orderId, JSON.stringify(order), {
    expirationTtl: order.plan === "monthly" ? 60 * 60 * 24 * 90 : undefined
  });
  await env.GKID_ORDERS.put("token:" + order.accessToken, JSON.stringify({
    plan: order.plan, expiresAt: order.expiresAt, active: true
  }), order.expiresAt ? { expirationTtl: 60 * 60 * 24 * 35 } : {});
  return new Response("OK", { status: 200 });
}
async function checkOrder(url, env) {
  const orderId = url.searchParams.get("order") || "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Rujukan tidak sah." }, 400);
  const raw = await env.GKID_ORDERS.get("order:" + orderId);
  if (!raw) return json({ status: "not_found" }, 404);
  const order = JSON.parse(raw);
  if (!order.paid) return json({ status: "pending" });
  if (order.expiresAt && Date.now() > order.expiresAt) return json({ status: "expired" });
  return json({ status: "paid", plan: order.plan, accessToken: order.accessToken, expiresAt: order.expiresAt });
}
async function checkToken(url, env) {
  const token = url.searchParams.get("token") || "";
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ active: false }, 400);
  const raw = await env.GKID_ORDERS.get("token:" + token);
  if (!raw) return json({ active: false });
  const entitlement = JSON.parse(raw);
  const active = entitlement.active && (!entitlement.expiresAt || Date.now() <= entitlement.expiresAt);
  return json({ active, plan: entitlement.plan, expiresAt: entitlement.expiresAt });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      if (url.pathname === "/api/toyyibpay/callback" && request.method === "POST")
        return await paymentCallback(request, env);
      if (origin && !headers["Access-Control-Allow-Origin"]) return json({ error: "Origin not allowed." }, 403);
      if (url.pathname === "/api/create-bill" && request.method === "POST")
        return await createBill(request, env);
      if (url.pathname === "/api/payment-status" && request.method === "GET")
        return await checkOrder(url, env);
      if (url.pathname === "/api/verify-access" && request.method === "GET")
        return await checkToken(url, env);
      return json({ error: "Not found." }, 404, headers);
    } catch (error) {
      return json({ error: "Pembayaran belum dapat diproses. Cuba lagi kemudian." }, 502, headers);
    }
  }
};
