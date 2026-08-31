/* 班別＋學號、送成績。之後新遊戲／小測驗請一齊用。 */
(function (global) {
  const TOKEN = "chilin-edu-2026";
  const SCORE_URL = global.SCORE_URL || "";

  function identityOk() {
    const klass = (document.getElementById("klass") || {}).value || "";
    const no = (document.getElementById("stuno") || {}).value || "";
    const c = String(klass).trim().slice(0, 8);
    const n = String(no).trim();
    return { ok: c.length >= 1 && /^\d{1,3}$/.test(n), class: c, no: n };
  }

  function bindIdentity(onChange) {
    ["klass", "stuno"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", onChange);
    });
    onChange();
  }

  function reportScore(info) {
    const id = identityOk();
    if (!SCORE_URL || !id.ok) return;
    const payload = Object.assign({
      token: TOKEN,
      class: id.class,
      no: id.no
    }, info || {});
    try {
      fetch(SCORE_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (e) {}
  }

  global.ChilinPlay = { identityOk, bindIdentity, reportScore };
})(window);
