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

window.bikeUrl = async function (path) {
  if (window.bikeReady) await window.bikeReady;
  const base = String(window.BIKE_API || "").replace(/\/$/, "");
  if (!base || !path || /^https?:/i.test(path)) return path;
  if (path.charAt(0) === "/") return base + path;
  return path;
};
