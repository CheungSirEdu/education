let pin = sessionStorage.getItem("bike-pin") || "";
let lesson = null;
let status = null;
let students = [];
let filter = "all";
let selected = "";
let detail = null;
let analysis = null;
let digest = null;
let records = [];
let slideIndex = Number(sessionStorage.getItem("bike-teacher-slide") || 0);
const openReplyKeys = new Set();
let editMode = false;
let notes = [];
let err = "";
let whySerial = 0;
let openSerial = 0;
const whyCache = new Map();
const openCache = new Map();
let mic = null;
let heard = "";
const blobs = {};
const app = document.getElementById("app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function tapi(path, body) {
  let res;
  try {
    res = await window.bikeFetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Teacher-Pin": pin },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(location.hostname.endsWith("github.io")
      ? "暫時連不到課室。請再試一次。"
      : "連不到課室伺服器");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    pin = "";
    sessionStorage.removeItem("bike-pin");
    throw new Error("密碼不對");
  }
  if (!res.ok) throw new Error(data.error || "未能讀取");
  return data;
}

async function blobUrl(path) {
  if (!path || path.startsWith("media/")) return path || "";
  if (blobs[path]) return blobs[path];
  const res = await window.bikeFetch("/" + path.replace(/^\//, ""), { headers: { "X-Teacher-Pin": pin } });
  if (!res.ok) return "";
  const url = URL.createObjectURL(await res.blob());
  blobs[path] = url;
  return url;
}

function stopMic() {
  if (mic) {
    try { mic.onend = null; mic.stop(); } catch (e) { /* stopped */ }
    mic = null;
  }
}

function startMic() {
  stopMic();
  heard = "";
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const box = document.getElementById("said");
  const btn = document.getElementById("entry-bar");
  if (!SR) {
    err = "這部瀏覽器不能使用語音。可以直接輸入文字。";
    render();
    return;
  }
  const recg = new SR();
  mic = recg;
  recg.lang = "zh-HK";
  recg.interimResults = true;
  recg.continuous = true;
  if (btn) {
    btn.classList.add("on");
    btn.textContent = "正在聆聽…";
  }
  recg.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript;
    heard = text.trim();
    const node = document.getElementById("said");
    const bar = document.getElementById("entry-bar");
    if (node) node.dataset.text = heard;
    if (bar) bar.textContent = heard || "正在聆聽…";
  };
  recg.onend = () => {
    mic = null;
    const button = document.getElementById("entry-bar");
    if (button) {
      button.classList.remove("on");
      if (!heard) button.textContent = "輸入你的意見";
    }
  };
  recg.onerror = (event) => {
    if (event.error === "not-allowed") {
      err = "未准用麥克風。";
      render();
    }
  };
  try { recg.start(); } catch (e) { err = "麥克風無法開啟。"; render(); }
}

function pairHtml(text, feedback, source) {
  return `
    <div class="pair">
      <div class="said"><b>學生說</b><p>${esc(text || "尚未回答")}</p></div>
      <div class="heard ${source === "ai" ? "" : "coach"}"><b>${source === "ai" ? "AI 回饋" : "課堂回饋"}</b><p>${esc(feedback || "尚未有回饋")}</p></div>
    </div>`;
}

function attemptsHtml(attempts) {
  return (attempts || []).map((item) => `
    <div class="answer">
      <div class="q">第 ${item.n} 次${item.n > 1 ? " · 再答" : ""}</div>
      ${pairHtml(item.text, item.feedback, item.source)}
      ${item.photo ? `<img data-file="${esc(item.photo)}" alt="學生相片" style="height:140px;object-fit:cover;border-radius:10px;margin-top:8px">` : ""}
      ${item.audio ? `<audio data-file="${esc(item.audio)}" controls></audio>` : ""}
    </div>
  `).join("");
}

function detailHtml() {
  if (!detail) return `<div class="maincard"><h2>選擇一位學生</h2><p class="hint">左邊是全班進度。按姓名查看他的計劃、相片和每次發言。</p></div>`;
  const student = detail;
  const matches = [];
  (lesson.planItems || []).forEach((item) => {
    (item.questions || []).forEach((question) => {
      const bag = ((student.plan || {}).items || {})[question.id] || {};
      const said = ((bag.attempts || []).slice(-1)[0] || {}).text || "尚未回答";
      matches.push(`${item.name}：${question.ask} ${said}`);
    });
  });
  const doBlocks = (lesson.doSteps || []).map((step) => {
    const bag = (student.do || {})[step.id] || {};
    const light = { red: "未成功", yellow: "差不多", green: "成功" }[bag.status] || "未選結果";
    return `<div class="answer">
      <div class="q">${esc(step.title)}</div>
      ${bag.photo ? `<img data-file="${esc(bag.photo)}" alt="安裝相片" class="proof">` : `<p class="hint">未有安裝相片</p>`}
      ${bag.photoFeedback ? pairHtml("交了一張安裝相片", bag.photoFeedback, bag.photoSource) : ""}
      ${attemptsHtml(bag.attempts)}
    </div>`;
  }).join("");
  const improve = (lesson.improve || []).map((item) => {
    const bag = (student.improve || {})[item.id] || {};
    if (!(bag.attempts || []).length) return "";
    return `<div class="answer"><div class="q">${esc(item.ask)}</div>${attemptsHtml(bag.attempts)}</div>`;
  }).join("");
  const review = (lesson.review || []).map((item) => {
    const bag = (student.review || {})[item.id] || {};
    if (!(bag.attempts || []).length) return "";
    return `<div class="answer"><div class="q">${esc(item.ask)}</div>${attemptsHtml(bag.attempts)}</div>`;
  }).join("");
  return `<div class="maincard">
    <h2>${esc(student.class)} ${esc(student.no)}號 ${esc(student.name || "名冊未有")}</h2>
    <p class="hint">現在到達${esc(stageName(student.unlocked))}。</p>
    <h2 style="margin-top:16px;font-size:20px">計劃：用途、位置、原理</h2>
    ${(lesson.planItems || []).map((item) => (item.questions || []).map((question) => {
      const bag = ((student.plan || {}).items || {})[question.id] || {};
      return `<div class="answer"><div class="q">${esc(item.name)} · ${esc(question.ask)}</div>${attemptsHtml(bag.attempts)}</div>`;
    }).join("")).join("")}
    <div class="row">
      <a class="btn" href="board.html?q=plan" target="_blank">投影計劃題</a>
      <button type="button" class="danger" id="del">刪除這位學生記錄</button>
    </div>
    <h2 style="margin-top:16px;font-size:20px">動手</h2>
    ${doBlocks}
    <h2 style="margin-top:16px;font-size:20px">改良</h2>
    ${improve || `<p class="hint">尚未回答</p>`}
    <div class="row"><a class="btn" href="board.html?q=brake-use" target="_blank">投影煞車有什麼用</a><a class="btn" href="board.html?q=debug" target="_blank">投影執漏</a></div>
    <h2 style="margin-top:16px;font-size:20px">回顧</h2>
    ${review || `<p class="hint">尚未回答</p>`}
  </div>`;
}

function stageName(id) {
  return { plan: "計劃", do: "動手", improve: "改良", review: "回顧" }[id] || id;
}

function linesOf(items) {
  return (items || []).map((line) => `<li>${esc(line)}</li>`).join("") || "<li>未有</li>";
}

function headlineHtml() {
  if (!digest) return "";
  return `<section class="banner">
    <div class="digest">
      <article><b>做得好</b><ul class="lines">${linesOf(digest.good)}</ul></article>
      <article><b>可以改進</b><ul class="lines">${linesOf(digest.improve)}</ul></article>
      <article class="span2"><b>大部分同學的選擇</b><ul class="lines">${linesOf(digest.majorities)}</ul></article>
    </div>
    <div class="row"><button type="button" class="btn" id="analyze">請 AI 總結全班</button></div>
  </section>`;
}

function digestHtml() {
  if (!digest) return "";
  const hard = (digest.hardest || []).map((item) => `<li>${esc(item.part)} · ${esc(item.count)} 人</li>`).join("");
  const samples = (digest.samples || []).map((item) => `
    <div class="answer">
      <div class="q">${esc(item.who)} · ${esc(item.stage)} · ${esc(item.ask)}</div>
      ${pairHtml(item.text, item.feedback, "coach")}
    </div>`).join("");
  return `<section class="banner digest-wrap">
    <b>全班總結</b>
    <p class="hint">${esc(digest.students || 0)} 位學生已有記錄。這頁給老師和來觀課的家長看。下面先按回答整理；按「請 AI 總結全班」會再收成一段建議。</p>
    <div class="digest">
      <article><b>已懂得</b><ul class="lines">${linesOf(digest.knows)}</ul></article>
      <article><b>尚未清楚</b><ul class="lines">${linesOf(digest.misses)}</ul></article>
      <article><b>可以改進</b><ul class="lines">${linesOf(digest.improve)}</ul></article>
      <article><b>做得好</b><ul class="lines">${linesOf(digest.good)}</ul></article>
    </div>
    ${hard ? `<p><b>最多人覺得最難</b></p><ul class="lines">${hard}</ul>` : ""}
    ${samples ? `<p><b>同學原話和回饋</b></p>${samples}` : ""}
  </section>`;
}

function analysisHtml() {
  if (!analysis) return "";
  const result = analysis.result || {};
  const knows = result.knows || result.themes || [];
  const misses = result.misses || result.gaps || [];
  const improve = result.improve || [];
  const good = result.good || [];
  const visit = (result.visit || []).map((item) => {
    const found = students.find((row) => row.class === item.class && String(row.no) === String(item.no));
    const name = found && found.name ? " " + found.name : "";
    return `<li>${esc(item.class)} ${esc(item.no)}號${esc(name)}：${esc(item.why || "")}</li>`;
  }).join("");
  return `<div class="card">
    <div class="teacher-line"><b>${result.source === "ai" ? "AI 全班總結" : "課堂整理 · 全班總結"}</b><span>${esc(analysis.at || "")}</span></div>
    <p class="hint">這是初步建議。老師仍要根據學生的實作、相片和課堂觀察作判斷。</p>
    <div class="digest">
      <article><b>已懂得</b><ul class="lines">${linesOf(knows)}</ul></article>
      <article><b>尚未清楚</b><ul class="lines">${linesOf(misses)}</ul></article>
      <article><b>可以改進</b><ul class="lines">${linesOf(improve)}</ul></article>
      <article><b>做得好</b><ul class="lines">${linesOf(good)}</ul></article>
    </div>
    <p><b>你可以對住全班追問</b></p>
    <ul class="lines">${(result.askNext || []).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
    ${visit ? `<p><b>可以行過去聽</b></p><ul class="lines">${visit}</ul>` : ""}
    ${result.raw ? `<p class="hint">${esc(result.raw)}</p>` : ""}
  </div>`;
}

function viewPin() {
  return `
    <header class="top"><p class="kicker">課後科學</p><h1>砌單車工程室老師後台</h1></header>
    <main class="wrap">
      <div class="card">
        <h2>老師後台</h2>
        <p class="hint">這一頁給老師和來觀課的家長看。請先輸入課室密碼。</p>
        ${err ? `<div class="err">${esc(err)}</div>` : ""}
        <div class="row"><input id="pin" type="password" inputmode="numeric" placeholder="密碼" style="flex:1;min-height:56px;border-radius:14px;border:1px solid var(--line);padding:0 12px"></div>
        <div class="row"><button type="button" class="primary" id="enter">入後台</button></div>
      </div>
    </main>`;
}

function viewMain() {
  const rows = students.filter((row) => filter === "all" || row.class === filter);
  const gates = ["plan", "do", "improve", "review"].map((id) =>
    `<button type="button" data-gate="${id}" class="${status && status.session && status.session.gate === id ? "on" : ""}">${stageName(id)}</button>`
  ).join("");
  const filters = [`<button type="button" data-filter="all" class="${filter === "all" ? "on" : ""}">全部</button>`]
    .concat((lesson.classes || []).map((item) => `<button type="button" data-filter="${esc(item)}" class="${filter === item ? "on" : ""}">${esc(item)}</button>`))
    .join("");
  const list = rows.map((row) => `
    <button type="button" class="student ${selected === row.class + "-" + row.no ? "on" : ""}" data-id="${esc(row.class)}-${esc(row.no)}">
      <b>${esc(row.class)} ${esc(row.no)}號 ${esc(row.name || "")}</b>
      <span>${esc(stageName(row.unlocked))} · 動手 ${row.doDone}/${row.doTotal} · 改良 ${row.improve}/${row.improveTotal} · 相片 ${row.photos}${row.growth ? " · 再次輸入後有進步 " + row.growth : ""}</span>
    </button>`).join("") || `<p class="hint">尚未有學生。請他們用上面的網址輸入班別和學號。</p>`;
  const selfPace = status && status.session ? status.session.selfPace !== false : true;
  const noteHtml = notes.slice(-3).reverse().map((note) => `
    <div class="answer"><p>${esc(note.text)}</p><div class="feedback ${note.source === "ai" ? "" : "coach"}"><div class="tag">${note.source === "ai" ? "即時回饋" : "課堂提示"}</div><div>${esc(note.feedback)}</div></div></div>
  `).join("");
  return `
    <header class="top">
      <div class="top-copy">
        <p class="kicker">老師帶領工程設計循環</p>
        <p class="pdir"><span><b>Plan</b> 計劃</span><span><b>Do</b> 動手</span><span><b>Improve</b> 改良</span><span><b>Review</b> 回顧</span></p>
        <h1>砌單車工程室老師後台</h1>
        <button type="button" class="edit-toggle${editMode ? " on" : ""}" id="edit-mode">${editMode ? "完成" : "編輯"}</button>
      </div>
      <img class="top-crew" src="media/header-engineers.png?v=2" alt="小志和小蓮化身工程師，一起砌單車">
    </header>
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    ${slideHtml()}
    ${analysisHtml()}`;
}

function render() {
  stopMic();
  app.innerHTML = pin && lesson && status ? viewMain() : viewPin();
  bind();
  hydrate();
  fillChoiceWhy();
  fillOpenRead();
  err = "";
}

function bind() {
  const enter = document.getElementById("enter");
  if (enter) {
    enter.onclick = async () => {
      pin = (document.getElementById("pin").value || "").trim();
      try {
        await loadAll();
        sessionStorage.setItem("bike-pin", pin);
      } catch (e) {
        err = e.message;
        pin = "";
        render();
      }
    };
    const input = document.getElementById("pin");
    if (input) input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") enter.click();
    });
    return;
  }
  app.querySelectorAll("[data-gate]").forEach((button) => {
    button.onclick = async () => {
      try {
        const data = await tapi("/api/teacher/session", {
          gate: button.dataset.gate,
          selfPace: document.getElementById("pace").checked,
        });
        status.session = data.session;
        render();
      } catch (e) { err = e.message; render(); }
    };
  });
  const pace = document.getElementById("pace");
  if (pace) {
    pace.onchange = async () => {
      try {
        const data = await tapi("/api/teacher/session", { gate: status.session.gate, selfPace: pace.checked });
        status.session = data.session;
        render();
      } catch (e) { err = e.message; render(); }
    };
  }
  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.onclick = async () => {
      filter = button.dataset.filter;
      try { await refreshDigest(); await refreshBoard(); } catch (e) { err = e.message; }
      render();
    };
  });
  app.querySelectorAll("[data-id]").forEach((button) => {
    button.onclick = () => openStudent(button.dataset.id);
  });
  const prevSlide = document.getElementById("prev-slide");
  const nextSlide = document.getElementById("next-slide");
  if (prevSlide) prevSlide.onclick = () => goSlide(slideIndex - 1);
  if (nextSlide) nextSlide.onclick = () => goSlide(slideIndex + 1);
  app.querySelectorAll("[data-jump]").forEach((button) => {
    button.onclick = () => goSlide(Number(button.dataset.jump));
  });
  app.querySelectorAll("[data-jump-q]").forEach((button) => {
    button.onclick = () => {
      const at = lessonSlides().findIndex((item) => item.kind === "plan" && item.question && item.question.id === button.dataset.jumpQ);
      if (at >= 0) goSlide(at);
    };
  });
  app.querySelectorAll(".replies").forEach((node) => {
    node.addEventListener("toggle", () => {
      const key = node.dataset.reply || "page";
      if (node.open) openReplyKeys.add(key);
      else openReplyKeys.delete(key);
    });
  });
  const edit = document.getElementById("edit-mode");
  if (edit) edit.onclick = () => {
    editMode = !editMode;
    render();
  };
  app.querySelectorAll("[data-del]").forEach((button) => {
    button.onclick = () => removeAnswer(button);
  });
  const excel = document.getElementById("excel");
  if (excel) excel.onclick = downloadExcel;
  const analyze = document.getElementById("analyze");
  if (analyze) analyze.onclick = runAnalyze;
  const bar = document.getElementById("entry-bar");
  const menu = document.getElementById("entry-menu");
  const typed = document.getElementById("typed");
  if (bar && menu) {
    bar.onclick = () => {
      if (mic) { stopMic(); return; }
      menu.classList.toggle("hidden");
    };
  }
  const pickText = document.getElementById("pick-text");
  if (pickText && typed && bar && menu) {
    pickText.onclick = () => {
      menu.classList.add("hidden");
      bar.classList.add("hidden");
      typed.classList.remove("hidden");
      typed.focus();
    };
  }
  const pickVoice = document.getElementById("pick-voice");
  if (pickVoice && typed && bar && menu) {
    pickVoice.onclick = () => {
      menu.classList.add("hidden");
      typed.classList.add("hidden");
      bar.classList.remove("hidden");
      startMic();
    };
  }
  const ask = document.getElementById("ask");
  if (ask) ask.onclick = askTeacher;
  const del = document.getElementById("del");
  if (del && detail) {
    del.onclick = async () => {
      const label = `${detail.class} ${detail.no}號`;
      if (!window.confirm("刪除 " + label + " 的課室記錄？")) return;
      try {
        await tapi("/api/teacher/delete", { class: detail.class, no: detail.no });
        selected = "";
        detail = null;
        await refreshStudents();
        render();
      } catch (e) { err = e.message; render(); }
    };
  }
}

function paintWhy(node, item) {
  if (!item || (!item.text && !(item.good || []).length && !(item.follow || []).length)) {
    node.remove();
    return;
  }
  const label = item.source === "ai" ? "AI 回饋" : "課堂整理";
  if ((item.good || []).length || (item.follow || []).length) {
    node.innerHTML = `<p class="hint">${label}</p>
      <div class="digest">
        <article><b>答得好</b>${openLines(item.good, false)}</article>
        <article><b>需要跟進</b>${openLines(item.follow, false)}</article>
      </div>`;
    return;
  }
  node.innerHTML = `<b>${label}</b><p>${esc(item.text)}</p>`;
}

async function fillChoiceWhy() {
  const nodes = [...app.querySelectorAll("[data-why]")];
  if (!nodes.length) return;
  const serial = ++whySerial;
  const pending = [];
  nodes.forEach((node) => {
    let spec;
    try { spec = JSON.parse(node.dataset.why); } catch (e) { return; }
    const key = JSON.stringify(spec);
    const hit = whyCache.get(key);
    if (hit) paintWhy(node, hit);
    else pending.push({ node, key, spec });
  });
  if (!pending.length) return;
  try {
    const data = await tapi("/api/teacher/choice-why", { items: pending.map((item) => item.spec) });
    if (serial !== whySerial) return;
    (data.items || []).forEach((item, index) => {
      const row = pending[index];
      if (!row) return;
      whyCache.set(row.key, item || { text: "", source: "coach" });
      if (row.node.isConnected) paintWhy(row.node, item);
    });
  } catch (e) { /* 留住「正在看」這句 */ }
}

function latestOpenAnswers(rows) {
  const latest = new Map();
  rows.forEach((row) => {
    const who = row.who || "";
    const text = (row.text || "").trim();
    const bag = latest.get(who) || { text: "", feedback: "" };
    if (text && text !== "交了一張相片" && text !== "交了一張安裝相片") {
      bag.text = text.slice(0, 80);
      bag.feedback = (row.feedback || "").slice(0, 180);
    } else if (row.feedback && !bag.text) {
      bag.text = "相片";
      bag.feedback = row.feedback.slice(0, 180);
    }
    if (bag.text) latest.set(who, bag);
  });
  return [...latest.values()].sort((a, b) => (a.text + a.feedback).localeCompare(b.text + b.feedback, "zh"));
}

function openSpec(slide, rows) {
  const qid = slide.kind === "plan" ? slide.question.id : slide.kind === "do" ? slide.step.id : slide.item.id;
  return { kind: slide.kind, qid, answers: latestOpenAnswers(rows) };
}

function openLines(items, waiting) {
  if (!items || !items.length) return `<p class="hint">${waiting ? "……" : "未有"}</p>`;
  return `<ul class="lines">${items.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
}

function openBox(spec) {
  if (!spec || !(spec.answers || []).length) return "";
  const key = JSON.stringify(spec);
  const hit = openCache.get(key);
  const label = hit && hit.source === "ai" ? "AI 回饋" : "課堂整理";
  const majority = hit && hit.majority ? hit.majority : "正在整理這一頁的答案……";
  return `<div class="open-read" data-open="${esc(key)}">
    <p class="hint">${label}</p>
    <div class="digest">
      <article class="span2"><b>大部分同學的答案</b><p>${esc(majority)}</p></article>
      <article><b>答得好</b>${openLines(hit && hit.good, !hit)}</article>
      <article><b>需要跟進</b>${openLines(hit && hit.follow, !hit)}</article>
    </div>
  </div>`;
}

function paintOpen(node, item) {
  if (!item || !item.majority) {
    node.remove();
    return;
  }
  const label = item.source === "ai" ? "AI 回饋" : "課堂整理";
  node.innerHTML = `<p class="hint">${label}</p>
    <div class="digest">
      <article class="span2"><b>大部分同學的答案</b><p>${esc(item.majority)}</p></article>
      <article><b>答得好</b>${openLines(item.good, false)}</article>
      <article><b>需要跟進</b>${openLines(item.follow, false)}</article>
    </div>`;
}

async function fillOpenRead() {
  const nodes = [...app.querySelectorAll("[data-open]")];
  if (!nodes.length) return;
  const serial = ++openSerial;
  const pending = [];
  nodes.forEach((node) => {
    let spec;
    try { spec = JSON.parse(node.dataset.open); } catch (e) { return; }
    const key = JSON.stringify(spec);
    const hit = openCache.get(key);
    if (hit) paintOpen(node, hit);
    else pending.push({ node, key, spec });
  });
  if (!pending.length) return;
  try {
    const results = await Promise.all(pending.map(async (row) => {
      try {
        return { row, data: await tapi("/api/teacher/open-read", row.spec) };
      } catch (e) {
        return null;
      }
    }));
    if (serial !== openSerial) return;
    results.forEach((item) => {
      if (!item) return;
      openCache.set(item.row.key, item.data || { majority: "", source: "coach" });
      if (item.row.node.isConnected) paintOpen(item.row.node, item.data);
    });
  } catch (e) { /* 留住「正在整理」 */ }
}

async function hydrate() {
  const nodes = app.querySelectorAll("[data-file]");
  for (const node of nodes) {
    const url = await blobUrl(node.dataset.file);
    if (url) node.src = url;
  }
}

async function openStudent(id) {
  selected = id;
  const [cls, no] = id.split("-");
  try {
    const data = await tapi("/api/teacher/student?class=" + encodeURIComponent(cls) + "&no=" + encodeURIComponent(no));
    detail = data.student;
    render();
  } catch (e) {
    err = e.message;
    render();
  }
}

async function downloadExcel() {
  const res = await window.bikeFetch("/api/teacher/export", { headers: { "X-Teacher-Pin": pin } });
  if (!res.ok) {
    err = "未能匯出 Excel";
    render();
    return;
  }
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "砌單車工程室.xlsx";
  link.click();
}

async function runAnalyze() {
  const button = document.getElementById("analyze");
  if (button) button.textContent = "分析緊…";
  try {
    const data = await tapi("/api/teacher/analyze", { class: filter === "all" ? "all" : filter });
    analysis = data.analysis;
  } catch (e) {
    err = e.message;
  }
  render();
}

async function askTeacher() {
  stopMic();
  const typed = document.getElementById("typed");
  const text = typed && !typed.classList.contains("hidden") ? typed.value.trim() : heard.trim();
  if (text.length < 2) {
    err = "請先說出或輸入一句。";
    render();
    return;
  }
  try {
    const data = await tapi("/api/teacher/ask", { text });
    notes.push(data.note);
    heard = "";
    render();
  } catch (e) {
    err = e.message;
    render();
  }
}

async function refreshStudents() {
  const data = await tapi("/api/teacher/students");
  students = data.students || [];
  if (status) status.session = data.session;
}

async function refreshDigest() {
  const data = await tapi("/api/teacher/digest?class=" + encodeURIComponent(filter === "all" ? "all" : filter));
  digest = data.digest;
}

async function refreshBoard() {
  const data = await tapi("/api/teacher/records?class=" + encodeURIComponent(filter === "all" ? "all" : filter));
  records = data.records || [];
}

function goSlide(index) {
  openReplyKeys.clear();
  const last = lessonSlides().length - 1;
  slideIndex = Math.max(0, Math.min(last, index));
  sessionStorage.setItem("bike-teacher-slide", String(slideIndex));
  render();
}

function lessonSlides() {
  const slides = [{ kind: "mission" }];
  (lesson.planItems || []).forEach((item) => {
    (item.questions || []).forEach((question, index) => {
      slides.push({ kind: "plan", item, question, index });
    });
  });
  (lesson.doSteps || []).forEach((step, index) => {
    slides.push({ kind: "do", step, index });
  });
  (lesson.improve || []).forEach((item) => slides.push({ kind: "improve", item }));
  (lesson.review || []).forEach((item) => slides.push({ kind: "review", item }));
  slides.push({ kind: "summary" });
  return slides;
}

function staticChoices(question) {
  const choices = question.choices || [];
  if (!choices.length) return "";
  if (choices[0].text) {
    return `<div class="pick-list">${choices.map((choice) => `<div class="pick">${esc(choice.id)}. ${esc(choice.text)}</div>`).join("")}</div>`;
  }
  return `<div class="pick4">${choices.map((choice) => `<div class="pick"><img src="${esc(choice.image)}" alt="${esc(choice.id)}"><b>${esc(choice.id)}</b></div>`).join("")}</div>`;
}

function slideFace(slide, total) {
  if (slide.kind === "summary") {
    return `
      <div class="teacher-line"><b>全班</b><span>總結</span></div>
      <h2>全班回答整理</h2>
      <p class="hint">這一頁不是學生的題目。它把所有頁的回答收在一起。</p>`;
  }
  if (slide.kind === "mission") {
    return `
      <div class="teacher-line"><b>P 計劃</b><span>1/${total}</span></div>
      <p class="plan-motto">看清零件，想明原理，安裝才穩。</p>
      <h2>你知道下面這些零件是什麼嗎？</h2>
      <div class="partshow">${(lesson.planItems || []).map((item) => `<figure class="part"><img src="${esc((item.images || [])[0])}" alt="${esc(item.name)}"><figcaption>${esc(item.name)}</figcaption></figure>`).join("")}</div>`;
  }
  if (slide.kind === "plan") {
    const images = slide.question.image ? [slide.question.image] : (slide.item.images || []);
    const shots = images.map((src) => `<img src="${esc(src)}" alt="">`).join("");
    const film = slide.question.video
      ? `<video class="plan-film" controls playsinline preload="metadata" poster="${esc(slide.question.poster || "")}" src="${esc(slide.question.video)}"></video>`
      : "";
    return `
      <div class="teacher-line"><b>P 計劃</b><span>${slide.pageNo}/${slide.planTotal || total}</span></div>
      <p class="plan-motto">看清零件，想明原理，安裝才穩。</p>
      <p class="hint">${esc(slide.item.name)}</p>
      ${partQuestionLinks(slide)}
      ${film}
      <div class="shots ${images.length > 1 ? "two" : ""}">${shots}</div>
      ${faceQuestions(slide.question)}`;
  }
  if (slide.kind === "do") {
    const step = slide.step;
    const shots = (step.images || []).map((src) => `<img src="${esc(src)}" alt="">`).join("");
    return `
      <div class="teacher-line"><b>D 動手</b><span>${slide.index + 1}/${(lesson.doSteps || []).length}</span></div>
      <h2>${slide.index + 1}. ${esc(step.title)}</h2>
      <div class="shots">${shots}</div>
      ${(step.tips || []).length ? `<ul class="lines">${step.tips.map((tip) => `<li>${esc(tip)}</li>`).join("")}</ul>` : ""}
      ${step.safety ? `<p class="hint">${esc(step.safety)}</p>` : ""}
      ${doFaceQuestions(step)}
      ${staticChoices(step)}
      ${step.photoAsk ? `<p class="hint">${esc(step.photoAsk)}</p>` : ""}`;
  }
  if (slide.kind === "improve") {
    return `
      <div class="teacher-line"><b>I 改良</b><span>試踩之後執漏</span></div>
      <p class="hint">踩上單車走幾步。未打氣、螺絲未扭實、煞不到車，或座墊太高太低，都要說出來再修。</p>
      ${doFaceQuestions(slide.item)}`;
  }
  const reviewNo = (lesson.review || []).indexOf(slide.item) + 1;
  return `
    <div class="teacher-line"><b>R 回顧</b><span>分享過程，不只展示成品 · ${reviewNo}/${(lesson.review || []).length}</span></div>
    <p class="hint">回顧你怎樣幫一、二年級準備這輛學踩的單車：計劃、測試、改良，和你學到的事。</p>
    <h2>${esc(slide.item.ask)}</h2>
    ${staticChoices(slide.item)}
    ${slide.item.frame ? `<p class="hint">${esc(slide.item.frame)}</p>` : ""}`;
}

function faceQuestions(question) {
  const steps = question.steps || [];
  if (steps.length) {
    return steps.map((step, index) => `<h2>${index + 1}. ${esc(step.ask || question.ask)}</h2>${staticChoices(step)}`).join("");
  }
  return `<h2>${esc(question.ask)}</h2>${staticChoices(question)}`;
}

function partQuestionLinks(slide) {
  const questions = (slide.item && slide.item.questions) || [];
  if (questions.length < 2) return "";
  return `<div class="filters qset">${questions.map((question, index) => `<button type="button" data-jump-q="${esc(question.id)}" class="${question.id === slide.question.id ? "on" : ""}">${index + 1}. ${esc(question.ask)}</button>`).join("")}</div>`;
}

function choiceLabel(choice) {
  if (!choice) return "";
  if (choice.text) return choice.text;
  const image = choice.image || "";
  if (image.includes("saddle")) return "座墊那個位置";
  if (image.includes("wheel")) return "車輪那個位置";
  if (image.includes("crank")) return "腳踏應該裝的位置";
  if (image.includes("stem")) return "車頭那個位置";
  return "選項 " + (choice.id || "");
}

function tallySpec(kind, qid, step, counts) {
  const clean = {};
  Object.keys(counts).sort().forEach((id) => {
    if (counts[id] > 0) clean[id] = counts[id];
  });
  return { kind, qid, step, counts: clean };
}

function whyBox(spec) {
  if (!spec || !Object.keys(spec.counts || {}).length) return "";
  const key = JSON.stringify(spec);
  const hit = whyCache.get(key);
  const label = hit && hit.source === "ai" ? "AI 回饋" : "課堂整理";
  if (hit && ((hit.good || []).length || (hit.follow || []).length)) {
    return `<div class="open-read why" data-why="${esc(key)}">
      <p class="hint">${label}</p>
      <div class="digest">
        <article><b>答得好</b>${openLines(hit.good, false)}</article>
        <article><b>需要跟進</b>${openLines(hit.follow, false)}</article>
      </div>
    </div>`;
  }
  const text = hit && hit.text ? hit.text : "正在整理答得好和需要跟進……";
  return `<div class="open-read why" data-why="${esc(key)}"><p class="hint">${label}</p><p>${esc(text)}</p></div>`;
}

function tallyHtml(title, choices, counts, spec) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return `<p class="hint">${esc(title)}尚未有學生作答</p>`;
  const labelOf = (id) => {
    const choice = (choices || []).find((item) => item.id === id);
    return choice ? choiceLabel(choice) : id;
  };
  const [top, topCount] = entries[0];
  const head = topCount * 2 > total
    ? `大部分同學選了${labelOf(top)}（${topCount}/${total}）`
    : `最多人選了${labelOf(top)}（${topCount}/${total}），尚未過半`;
  const rest = entries.slice(1);
  const few = rest.length
    ? `少部分同學選了${rest.map(([id, count]) => `${labelOf(id)}（${count}人）`).join("、")}`
    : "沒有人選其他答案";
  const titleHtml = title ? `<div class="q">${esc(title)}</div>` : "";
  return `<div class="answer">${titleHtml}
    <div class="digest">
      <article class="span2"><b>歸納</b><p><b>${esc(head)}</b></p><p>${esc(few)}</p></article>
    </div>
    ${whyBox(spec)}</div>`;
}

function countLetters(choices, letterOf) {
  const counts = {};
  const ids = new Set((choices || []).map((item) => item.id));
  records.forEach((rec) => {
    const letter = letterOf(rec);
    if (!ids.has(letter)) return;
    counts[letter] = (counts[letter] || 0) + 1;
  });
  return counts;
}

function jumpBar(slides) {
  const findAt = (kind) => slides.findIndex((item) => item.kind === kind);
  const current = slides[slideIndex] || {};
  const stage = current.kind === "mission" || current.kind === "plan" ? "plan" : current.kind;
  const main = [
    ["plan", "Plan 計劃", slides.findIndex((item) => item.kind === "mission")],
    ["do", "Do 動手", findAt("do")],
    ["improve", "Improve 改良", findAt("improve")],
    ["review", "Review 回顧", findAt("review")],
  ];
  const steps = stage === "do"
    ? `<div class="steps">${(lesson.doSteps || []).map((step, index) => {
        const at = slides.findIndex((item) => item.kind === "do" && item.step.id === step.id);
        return `<button type="button" data-jump="${at}" class="${slideIndex === at ? "on" : ""}">${index + 1} ${esc(step.title)}</button>`;
      }).join("")}</div>`
    : "";
  return `<div class="jump">
    <div class="filters">${main.map(([id, label, at]) => `<button type="button" data-jump="${at}" class="${stage === id ? "on" : ""}">${label}</button>`).join("")}</div>
    ${steps}
  </div>`;
}

const DO_THREE = {
  saddle: [
    "你會怎樣把座墊固定在合適的高度？",
    "坐上去時，腳尖能不能觸到地面？",
    "扭實之後，雙手托住，拉不拉得起來？",
  ],
  wheel: [
    "你會怎樣把車輪固定，並知道氣是否足夠？",
    "兩邊螺絲要一樣緊，還是只扭一邊？",
    "你怎樣知道氣夠不夠？是按一按輪胎，還是只看它扁不扁？",
  ],
  debug: [
    "你踩了幾步之後，發現什麼問題要再修理？",
    "你準備先做哪一個修理動作？",
    "修完之後，你會再踩幾步檢查，還是只看一眼？",
  ],
};

function doFaceQuestions(step) {
  const prompts = DO_THREE[step.id];
  if (prompts) return prompts.map((ask, index) => `<h2>${index + 1}. ${esc(ask)}</h2>`).join("");
  return `${step.noteAsk ? `<h2>${esc(step.noteAsk)}</h2>` : ""}`;
}

function answerCards(rows, wipe) {
  const shown = new Set();
  return rows.map((row) => {
    const id = `${row.cls || ""}-${row.no || ""}`;
    const tools = row.cls && !shown.has(id) ? deleteTools(row, wipe) : "";
    if (row.cls) shown.add(id);
    return `
    <div class="answer">
      <div class="q">${esc(row.who)}</div>
      ${tools}
      ${row.photo ? `<img data-file="${esc(row.photo)}" alt="學生相片" class="proof">` : ""}
      ${pairHtml(row.text, row.feedback, row.source)}
    </div>`;
  }).join("");
}

function repliesDrawer(key, rows, wipe) {
  if (!rows.length) return "";
  const count = new Set(rows.map((row) => row.who)).size;
  const open = editMode || openReplyKeys.has(key);
  return `<details class="replies" data-reply="${esc(key)}" ${open ? "open" : ""}><summary>學生回覆（${count} 位）</summary>${answerCards(rows, wipe)}</details>`;
}

function whoOf(rec) {
  return `${rec.class} ${rec.no}號${rec.name ? " " + rec.name : ""}`;
}

function person(rec) {
  return { who: whoOf(rec), cls: rec.class, no: String(rec.no) };
}

function deleteTools(row, wipe) {
  if (!editMode || !wipe || !row.cls) return "";
  const spec = esc(JSON.stringify({
    class: row.cls,
    no: String(row.no),
    stage: wipe.stage,
    qid: wipe.qid,
    part: wipe.part,
    index: Number(wipe.index || 0),
  }));
  return `<div class="edit-tools">
    <button type="button" class="danger" data-del="question" data-who="${esc(row.who)}" data-spec="${spec}">只刪這題</button>
    <button type="button" class="danger" data-del="student" data-who="${esc(row.who)}" data-spec="${spec}">刪除此學生所有回答</button>
  </div>`;
}

async function removeAnswer(button) {
  let spec;
  try { spec = JSON.parse(button.dataset.spec || ""); } catch (e) { return; }
  const who = button.dataset.who || `${spec.class} ${spec.no}號`;
  const whole = button.dataset.del === "student";
  const ask = whole
    ? `刪除 ${who} 的全部課室記錄？全部答案和相片都會刪走。`
    : `刪除 ${who} 這一題的答案？其他題目會保留。`;
  if (!window.confirm(ask)) return;
  const body = whole
    ? { class: spec.class, no: spec.no }
    : {
      class: spec.class,
      no: spec.no,
      scope: "question",
      stage: spec.stage,
      qid: spec.qid,
      part: spec.part,
      index: spec.index,
    };
  try {
    await tapi("/api/teacher/delete", body);
    whyCache.clear();
    openCache.clear();
    await refreshStudents();
    await refreshDigest();
    await refreshBoard();
    render();
  } catch (e) {
    err = e.message;
    render();
  }
}

function choiceAnswerText(choice) {
  if (!choice) return "";
  if (choice.text) return `${choice.id}. ${choice.text}`;
  const place = choiceLabel(choice);
  return choice.id ? `${choice.id}. ${place}` : place;
}

function textOnly(rows) {
  return (rows || []).filter((row) => {
    const text = (row.text || "").trim();
    return text && text !== "交了一張相片" && text !== "交了一張安裝相片";
  });
}

function openSummary(kind, qid, rows) {
  const spoken = textOnly(rows);
  if (!spoken.length) return "";
  const fake = kind === "plan"
    ? { kind, question: { id: qid } }
    : kind === "do"
      ? { kind, step: { id: qid } }
      : { kind, item: { id: qid } };
  return openBox(openSpec(fake, spoken));
}

function blocksHtml(blocks) {
  return blocks.map((block, index) => {
    const rows = block.rows || [];
    const drawer = repliesDrawer(block.key, rows, block.wipe);
    const summary = block.summary || "";
    const mark = blocks.length > 1 ? `${index + 1}. ` : "";
    const empty = !drawer && !summary ? `<p class="hint">尚未有學生作答</p>` : "";
    return `<div class="part-q ${index % 2 ? "dark" : ""} ${block.current ? "on" : ""}">
      <div class="q">${mark}${esc(block.ask)}</div>
      ${block.hint ? `<p class="hint">${esc(block.hint)}</p>` : ""}
      ${summary}
      ${drawer}
      ${empty}
    </div>`;
  }).join("");
}

function stageAttempts(rec, stage, id) {
  const group = stage === "do" ? (rec.do || {}) : stage === "improve" ? (rec.improve || {}) : (rec.review || {});
  return ((group || {})[id] || {}).attempts || [];
}

function indexedRows(stage, id, index) {
  const rows = [];
  records.forEach((rec) => {
    const item = stageAttempts(rec, stage, id)[index];
    if (!item || !(item.text || "").trim() || item.text === "完成") return;
    rows.push({ ...person(rec), text: item.text, feedback: item.feedback || "", source: item.source || "" });
  });
  return rows;
}

function allAttemptRows(stage, id) {
  const rows = [];
  records.forEach((rec) => {
    stageAttempts(rec, stage, id).forEach((item) => {
      if (!item || !(item.text || "").trim() || item.text === "完成") return;
      rows.push({ ...person(rec), text: item.text, feedback: item.feedback || "", source: item.source || "" });
    });
  });
  return rows;
}

function planChoiceRows(question, stepNo) {
  const rounds = question.steps || [];
  const round = rounds[stepNo - 1] || question;
  const field = stepNo === 2 ? "choice2" : "choice";
  const rows = [];
  records.forEach((rec) => {
    const bag = ((rec.plan || {}).items || {})[question.id] || {};
    let letter = bag[field] || "";
    const hit = [...(bag.attempts || [])].reverse().find((item) => (item.step || 1) === stepNo && String(item.text || "").indexOf("選擇 ") === 0);
    if (!letter && hit) letter = String(hit.text || "").replace(/^選擇\s*/, "").trim();
    if (!letter) return;
    const choice = (round.choices || []).find((item) => item.id === letter);
    rows.push({
      ...person(rec),
      text: choiceAnswerText(choice) || letter,
      feedback: (hit && hit.feedback) || "",
      source: (hit && hit.source) || "coach",
    });
  });
  return rows;
}

function planOpenRows(question) {
  const rows = [];
  records.forEach((rec) => {
    const bag = ((rec.plan || {}).items || {})[question.id] || {};
    (bag.attempts || []).forEach((item) => {
      if (String(item.text || "").indexOf("選擇 ") === 0) return;
      if (!(item.text || "").trim()) return;
      rows.push({ ...person(rec), text: item.text, feedback: item.feedback, source: item.source });
    });
    if (bag.photo || bag.photoFeedback) {
      rows.push({ ...person(rec), text: "交了一張相片", feedback: bag.photoFeedback, source: bag.photoSource, photo: bag.photo });
    }
  });
  return rows;
}

function planBlocks(slide) {
  const questions = (slide.item && slide.item.questions) || [slide.question];
  const blocks = [];
  questions.forEach((question) => {
    const current = question.id === slide.question.id;
    const steps = question.steps || [];
    if (steps.length) {
      steps.forEach((step, index) => {
        const counts = countLetters(step.choices, (rec) => {
          const bag = ((rec.plan || {}).items || {})[question.id] || {};
          return index === 0 ? bag.choice : bag.choice2;
        });
        blocks.push({
          key: `${question.id}-${index + 1}`,
          ask: step.ask || question.ask,
          current,
          summary: tallyHtml("", step.choices, counts, tallySpec("plan", question.id, index + 1, counts)),
          rows: planChoiceRows(question, index + 1),
          wipe: { stage: "plan", qid: question.id, part: "choice", index: index + 1 },
        });
      });
      return;
    }
    if ((question.choices || []).length) {
      const counts = countLetters(question.choices, (rec) => (((rec.plan || {}).items || {})[question.id] || {}).choice);
      blocks.push({
        key: question.id,
        ask: question.ask,
        current,
        summary: tallyHtml("", question.choices, counts, tallySpec("plan", question.id, 0, counts)),
        rows: planChoiceRows(question, 1),
        wipe: { stage: "plan", qid: question.id, part: "choice", index: 1 },
      });
      return;
    }
    const rows = planOpenRows(question);
    blocks.push({
      key: question.id,
      ask: question.ask,
      hint: question.photoAsk || "",
      current,
      summary: openSummary("plan", question.id, rows),
      rows,
      wipe: { stage: "plan", qid: question.id, part: "bag", index: 0 },
    });
  });
  return blocks;
}

function spokenBlocks(stage, id, prompts) {
  return prompts.map((ask, index) => {
    const rows = indexedRows(stage, id, index);
    return {
      key: `${id}-${index}`,
      ask,
      summary: openSummary(stage, id, rows),
      rows,
      wipe: { stage, qid: id, part: "slot", index },
    };
  });
}

function doBlocks(step) {
  const blocks = [];
  if (step.photo || step.photoAsk) {
    const rows = [];
    records.forEach((rec) => {
      const bag = (rec.do || {})[step.id] || {};
      if (!bag.photo && !bag.photoFeedback) return;
      rows.push({
        ...person(rec),
        text: "交了一張安裝相片",
        feedback: bag.photoFeedback,
        source: bag.photoSource,
        photo: bag.photo,
      });
    });
    blocks.push({
      key: step.id + "-photo",
      ask: step.photoAsk || "請拍一張安裝相片。",
      rows,
      wipe: { stage: "do", qid: step.id, part: "photo", index: 0 },
    });
  }
  const prompts = DO_THREE[step.id];
  if (prompts) return blocks.concat(spokenBlocks("do", step.id, prompts));
  if ((step.choices || []).length) {
    const counts = countLetters(step.choices, (rec) => ((rec.do || {})[step.id] || {}).choice);
    const rows = [];
    records.forEach((rec) => {
      const bag = (rec.do || {})[step.id] || {};
      if (!bag.choice) return;
      const choice = (step.choices || []).find((item) => item.id === bag.choice);
      rows.push({
        ...person(rec),
        text: choiceAnswerText(choice) || bag.choice,
        feedback: bag.choiceFeedback || "",
        source: "coach",
      });
    });
    blocks.push({
      key: step.id + "-choice",
      ask: step.noteAsk || step.title,
      summary: tallyHtml("", step.choices, counts, tallySpec("do", step.id, 0, counts)),
      rows,
      wipe: { stage: "do", qid: step.id, part: "choice", index: 0 },
    });
    return blocks;
  }
  if (step.noteAsk) {
    const rows = allAttemptRows("do", step.id);
    blocks.push({
      key: step.id,
      ask: step.noteAsk,
      summary: openSummary("do", step.id, rows),
      rows,
      wipe: { stage: "do", qid: step.id, part: "bag", index: 0 },
    });
  }
  return blocks;
}

function improveBlocks(item) {
  const prompts = DO_THREE[item.id];
  if (prompts) return spokenBlocks("improve", item.id, prompts);
  const rows = allAttemptRows("improve", item.id);
  return [{
    key: item.id,
    ask: item.ask,
    summary: openSummary("improve", item.id, rows),
    rows,
    wipe: { stage: "improve", qid: item.id, part: "bag", index: 0 },
  }];
}

function questionFromFeedback(feedback) {
  const matches = String(feedback || "").match(/[^。！？?]*[？?]/g);
  if (!matches || !matches.length) return "";
  return matches.map((line) => line.trim()).filter(Boolean).join("");
}

function reviewBlocks(item) {
  if ((item.choices || []).length) {
    const byText = {};
    item.choices.forEach((choice) => { byText[choice.text] = choice.id; });
    const counts = {};
    const choiceRows = [];
    const whyRows = [];
    records.forEach((rec) => {
      const attempts = stageAttempts(rec, "review", item.id);
      const picked = attempts.find((row) => byText[row.text]);
      if (picked) {
        const id = byText[picked.text];
        counts[id] = (counts[id] || 0) + 1;
        const choice = item.choices.find((row) => row.id === id);
        choiceRows.push({
          ...person(rec),
          text: choiceAnswerText(choice) || picked.text,
          feedback: picked.feedback,
          source: picked.source,
        });
      }
      attempts.forEach((row) => {
        if (!row.text || byText[row.text] || row.text === "完成") return;
        whyRows.push({ ...person(rec), text: row.text, feedback: row.feedback, source: row.source });
      });
    });
    return [
      {
        key: item.id + "-pick",
        ask: item.ask,
        summary: tallyHtml("", item.choices, counts, tallySpec("review", item.id, 0, counts)),
        rows: choiceRows,
        wipe: { stage: "review", qid: item.id, part: "pick", index: 0 },
      },
      {
        key: item.id + "-why",
        ask: "為什麼你覺得這個部分最難？",
        summary: openSummary("review", item.id, whyRows),
        rows: whyRows,
        wipe: { stage: "review", qid: item.id, part: "why", index: 0 },
      },
    ];
  }
  if (item.id === "review-teach") {
    const first = indexedRows("review", item.id, 0);
    const third = indexedRows("review", item.id, 2);
    const followGroups = new Map();
    records.forEach((rec) => {
      const attempts = stageAttempts(rec, "review", item.id);
      const answer = attempts[1];
      if (!answer || !(answer.text || "").trim() || answer.text === "完成") return;
      const ask = questionFromFeedback((attempts[0] || {}).feedback) || "跟進問題";
      const bag = followGroups.get(ask) || [];
      bag.push({ ...person(rec), text: answer.text, feedback: answer.feedback || "", source: answer.source || "" });
      followGroups.set(ask, bag);
    });
    const blocks = [{
      key: item.id + "-1",
      ask: item.ask,
      summary: openSummary("review", item.id, first),
      rows: first,
      wipe: { stage: "review", qid: item.id, part: "slot", index: 0 },
    }];
    let n = 0;
    followGroups.forEach((rows, ask) => {
      blocks.push({
        key: item.id + "-f" + n,
        ask,
        summary: openSummary("review", item.id, rows),
        rows,
        wipe: { stage: "review", qid: item.id, part: "slot", index: 1 },
      });
      n += 1;
    });
    blocks.push({
      key: item.id + "-why",
      ask: "你為什麼先教這一件？",
      summary: openSummary("review", item.id, third),
      rows: third,
      wipe: { stage: "review", qid: item.id, part: "slot", index: 2 },
    });
    return blocks;
  }
  const rows = allAttemptRows("review", item.id);
  return [{
    key: item.id,
    ask: item.ask,
    summary: openSummary("review", item.id, rows),
    rows,
    wipe: { stage: "review", qid: item.id, part: "bag", index: 0 },
  }];
}

function askBlocks(slide) {
  if (slide.kind === "plan") return planBlocks(slide);
  if (slide.kind === "do") return doBlocks(slide.step);
  if (slide.kind === "improve") return improveBlocks(slide.item);
  if (slide.kind === "review") return reviewBlocks(slide.item);
  return [];
}

function slideHtml() {
  const slides = lessonSlides();
  const planSlides = slides.filter((item) => item.kind === "mission" || item.kind === "plan");
  planSlides.forEach((item, index) => {
    item.pageNo = index + 1;
    item.planTotal = planSlides.length;
  });
  const totalPlan = planSlides.length;
  if (slideIndex >= slides.length) slideIndex = 0;
  const slide = slides[slideIndex];
  const blocks = (slide.kind === "mission" || slide.kind === "summary") ? [] : askBlocks(slide);
  return `
    ${jumpBar(slides)}
    <div class="card">
      ${slideFace(slide, totalPlan)}
      <div class="row">
        <button type="button" class="quiet" id="prev-slide" ${slideIndex ? "" : "disabled"}>上一項</button>
        <button type="button" class="primary" id="next-slide" ${slideIndex < slides.length - 1 ? "" : "disabled"}>下一項</button>
      </div>
    </div>
    ${slide.kind === "mission" ? `
      <section class="banner">
        <b>這一頁沒有作答</b>
        <p class="hint">學生只看三件零件，不用回答。答案從下一頁開始。</p>
      </section>` : slide.kind === "summary" ? `${digestHtml()}${analysisHtml()}` : `
      <section class="banner">
        <b>這一頁的學生回答</b>
        ${blocks.length ? blocksHtml(blocks) : `<p class="hint">這一頁尚未有學生回答</p>`}
      </section>`}`;
}

let polling = false;

async function loadAll() {
  lesson = await fetch("lesson.json", { cache: "no-store" }).then((res) => res.json());
  status = await tapi("/api/teacher/status");
  await refreshStudents();
  await refreshDigest();
  await refreshBoard();
  const noteData = await tapi("/api/teacher/notes");
  notes = noteData.notes || [];
  render();
  if (!polling) {
    polling = true;
    setInterval(poll, 8000);
  }
}

async function poll() {
  if (!pin || mic) return;
  try {
    const before = JSON.stringify(students.map((row) => [row.class, row.no, row.updated, row.improve, row.doDone]));
    await refreshStudents();
    const after = JSON.stringify(students.map((row) => [row.class, row.no, row.updated, row.improve, row.doDone]));
    if (before !== after && !selected) render();
    if (before !== after && selected && detail) {
      const [cls, no] = selected.split("-");
      const data = await tapi("/api/teacher/student?class=" + cls + "&no=" + no);
      if (data.student.updated !== detail.updated) {
        detail = data.student;
        render();
      }
    }
  } catch (e) { /* leave the page as it is */ }
}

async function boot() {
  if (window.bikeReady) await window.bikeReady;
  if (!pin) {
    render();
    return;
  }
  try {
    await loadAll();
  } catch (e) {
    err = e.message;
    pin = "";
    render();
  }
}

boot();
