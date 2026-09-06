const API_BASE = "/api";

const Auth = {
  getAccessToken: () => localStorage.getItem("accessToken"),
  getRefreshToken: () => localStorage.getItem("refreshToken"),
  getUser: () => JSON.parse(localStorage.getItem("user") || "null"),
  setSession(accessToken, refreshToken, user) {
    localStorage.setItem("accessToken", accessToken);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
    if (user) localStorage.setItem("user", JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
  },
};

/**
 * Fetch wrapper that attaches the bearer token and transparently retries
 * once after refreshing an expired access token via the refresh token.
 */
async function api(path, { method = "GET", body, isForm = false } = {}) {
  const doFetch = async (token) => {
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    let payload = body;
    if (body && !isForm) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    return fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  };

  let res = await doFetch(Auth.getAccessToken());

  if (res.status === 401 && Auth.getRefreshToken()) {
    const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: Auth.getRefreshToken() }),
    });
    if (refreshRes.ok) {
      const { accessToken } = await refreshRes.json();
      Auth.setSession(accessToken);
      res = await doFetch(accessToken);
    } else {
      Auth.clear();
      window.location.hash = "#/login";
      throw new Error("Session expired");
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Downloads a file from an authenticated API route (PDF, etc.) by fetching as a blob and triggering a save, since a plain <a href> can't attach the bearer token. */
async function downloadAuthenticatedFile(path, filename) {
  const token = Auth.getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function initials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" }) +
    " — " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
