window.BIKE_API = "";

window.bikeReady = (async function () {
  async function sameHost() {
    const res = await fetch("/api/health", { cache: "no-store" });
    const data = await res.json();
    return !!(data && data.ok);
  }
  try {
    if (await sameHost()) return;
  } catch (e) { /* 這一頁唔係課堂伺服器 */ }
  try {
    const res = await fetch("api-base.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    window.BIKE_API = String((data && data.api) || "").replace(/\/$/, "");
  } catch (e) { /* 課堂網址稍後先至有 */ }
})();

window.bikeRefresh = async function () {
  try {
    const health = await fetch("/api/health", { cache: "no-store" });
    const data = await health.json();
    if (data && data.ok) {
      window.BIKE_API = "";
      return;
    }
  } catch (e) { /* 這一頁唔係課堂伺服器 */ }
  try {
    const res = await fetch("api-base.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const next = String((data && data.api) || "").replace(/\/$/, "");
    if (next) window.BIKE_API = next;
  } catch (e) { /* 沿用上次的課堂網址 */ }
};

window.bikeUrl = async function (path) {
  if (window.bikeReady) await window.bikeReady;
  const base = String(window.BIKE_API || "").replace(/\/$/, "");
  if (!base || !path || /^https?:/i.test(path)) return path;
  if (path.charAt(0) === "/") return base + path;
  return path;
};

function bikeFetchTimeout(url, options, ms) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 12000) : null;
  const opts = Object.assign({}, options || {});
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(url, opts).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

window.bikeFetch = async function (path, options) {
  if (window.bikeReady) await window.bikeReady;
  const opts = options || {};
  try {
    const res = await bikeFetchTimeout(await window.bikeUrl(path), opts, 12000);
    if (res.status < 500) return res;
  } catch (e) { /* 通道可能剛換址 */ }
  if (window.bikeRefresh) await window.bikeRefresh();
  return bikeFetchTimeout(await window.bikeUrl(path), opts, 12000);
};
