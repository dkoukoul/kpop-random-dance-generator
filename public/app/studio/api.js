/** Every server call the mix builder makes, in one place. */

/** fetch + JSON with a timeout; throws an Error with the server's message. */
export async function request(url, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error((data && data.error) || `Request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The server took too long to answer.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function trackVisit() {
  return fetch("/api/visit", { method: "POST" }).catch(() => {});
}

export async function loadVersion() {
  const pkg = await request("/package.json");
  return pkg && typeof pkg.version === "string" ? pkg.version : null;
}

export function sendContact({ email, message, website }) {
  return request("/api/contact", { method: "POST", body: { email, message, website } });
}
