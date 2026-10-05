const STAGES = [
  { id: "plan", mark: "P", name: "計劃", en: "Plan" },
  { id: "do", mark: "D", name: "動手", en: "Do" },
  { id: "improve", mark: "I", name: "改良", en: "Improve" },
  { id: "review", mark: "R", name: "回顧", en: "Review" },
];

let lesson = null;
let rec = null;
let session = { gate: "plan", selfPace: true };
let screen = "login";
let who = null;
let err = "";
let cls = "";
let num = "";
let confirmName = null;
let doIndex = 0;
let planIndex = 0;
let impIndex = 0;
let revIndex = 0;
let backToReview = false;
let heard = "";
let heardSlot = "first";
let showTypeSlot = "";
let micSlot = "first";
let pendingPhoto = "";
let pendingPhotoFeedback = "";
let pendingPhotoSource = "";
let pendingPhotoOk = null;
let photoLooking = false;
let shotPreview = "";
let camStream = null;
let mic = null;
let mediaRec = null;
let micTimer = null;
let micStopWait = null;
let micGen = 0;
let linkNote = "";
let entering = false;
let rejoinTimer = 0;
let outbox = [];

const VOICE_LABEL = "語音輸入你的意見";
const app = document.getElementById("app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function rank(id) {
  return STAGES.findIndex((s) => s.id === id);
}

function stageOf(name) {
  if (name === "intro") return "plan";
  return name;
}

function allowedRank() {
  const unlocked = Math.max(0, rank(rec && rec.unlocked || "plan"));
  if (!session || session.selfPace !== false) return unlocked;
  return Math.min(unlocked, Math.max(0, rank(session.gate || "plan")));
}

function authHeaders() {
  return who ? { "X-Student-Token": who.token } : {};
}

const OFFLINE_NOTE = "課室暫時未連上。這部裝置可以繼續用，答案會在連上後自動送出。";

function offlineMessage() {
  if (location.hostname.endsWith("github.io")) {
    return "暫時連不到課室。請再試一次。";
  }
  return "連不到課室伺服器。請看老師的電腦是否仍開着黑色視窗。";
}

function blankRec(className, number) {
  return {
    class: className,
    no: String(number),
    name: "",
    unlocked: "plan",
    plan: { order: [], attempts: [], items: {} },
    do: {},
    improve: {},
    review: {},
  };
}

function isOfflineError(error) {
  const message = String((error && error.message) || error || "");
  if (error && (error.name === "AbortError" || error.name === "TypeError")) return true;
  return /課室|課堂電腦|連不到|Failed to fetch|NetworkError|Load failed|網路|aborted|逾時|請再入一次/.test(message);
}

function fetchWithTimeout(url, options, ms) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  const opts = Object.assign({}, options || {});
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(url, opts).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function remember(path, body) {
  outbox.push({ path: path, body: body });
  try { sessionStorage.setItem("bike-outbox", JSON.stringify(outbox)); } catch (e) { /* 這次先留在記憶體 */ }
}

function restoreRec(person) {
  if (!person) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem("bike-rec") || "null");
    if (saved && saved.class === person.class && String(saved.no) === String(person.no)) return saved;
  } catch (e) { /* 重新開一份 */ }
  return null;
}

function ensurePlan(question) {
  if (!rec.plan) rec.plan = { order: [], attempts: [], items: {} };
  if (!rec.plan.items) rec.plan.items = {};
  if (!rec.plan.items[question.id]) {
    rec.plan.items[question.id] = { choice: "", choice2: "", attempts: [], photo: "" };
  }
  return rec.plan.items[question.id];
}

function applyLocalPlan(question, choice, step) {
  const rounds = question.steps || [];
  const spec = rounds.length ? rounds[Math.max(0, step - 1)] : question;
  const answer = (spec && spec.answer) || "";
  const ok = !answer || choice === answer;
  const bag = ensurePlan(question);
  if (step === 2) bag.choice2 = choice;
  else bag.choice = choice;
  bag.attempts = bag.attempts || [];
  bag.attempts.push({
    n: bag.attempts.length + 1,
    step: step,
    text: "選擇 " + choice,
    feedback: answer ? (ok ? "你揀對了。" : "這個不是答案，請再選。") : "已記下你的選擇。",
    source: "coach",
    at: new Date().toISOString(),
  });
}

function applyLocalText(stage, qid, text) {
  const row = {
    n: 1,
    step: 1,
    text: text,
    feedback: "已記下。課堂電腦連上後會再給回饋。",
    source: "coach",
    at: new Date().toISOString(),
  };
  if (stage === "plan") {
    const bag = ensurePlan({ id: qid });
    bag.attempts = bag.attempts || [];
    row.n = bag.attempts.length + 1;
    bag.attempts.push(row);
    return;
  }
  if (!rec[stage] || typeof rec[stage] !== "object") rec[stage] = {};
  const bag = rec[stage][qid] || { attempts: [] };
  bag.attempts = bag.attempts || [];
  row.n = bag.attempts.length + 1;
  bag.attempts.push(row);
  rec[stage][qid] = bag;
}

function keepDoChoice(step, choice) {
  if (!rec.do) rec.do = {};
  const bag = rec.do[step.id] || { choice: "", attempts: [] };
  bag.choice = choice;
  const answer = step.answer || "";
  const ok = !answer || choice === answer;
  bag.attempts = bag.attempts || [];
  bag.attempts.push({
    n: bag.attempts.length + 1,
    text: "選擇 " + choice,
    feedback: answer ? (ok ? "你揀對了。" : "這個不是答案，請再選。") : "已記下你的選擇。",
    source: "coach",
    at: new Date().toISOString(),
  });
  rec.do[step.id] = bag;
}

function enterPlanLocal(value) {
  who = { class: cls, no: value, token: "", name: "" };
  sessionStorage.setItem("bike-who", JSON.stringify(who));
  rec = blankRec(cls, value);
  session = { gate: "plan", selfPace: true };
  screen = "plan";
  planIndex = 0;
  err = "";
  linkNote = OFFLINE_NOTE;
  render();
  scheduleRejoin();
}

async function flushOutbox() {
  if (!who || !who.token || !outbox.length) return false;
  const pending = outbox.slice();
  const left = [];
  let changed = false;
  for (let i = 0; i < pending.length; i += 1) {
    try {
      const data = await api(pending[i].path, pending[i].body);
      if (data.student) rec = data.student;
      changed = true;
    } catch (e) {
      left.push.apply(left, pending.slice(i));
      break;
    }
  }
  outbox = left;
  try { sessionStorage.setItem("bike-outbox", JSON.stringify(outbox)); } catch (e) { /* 下次再送 */ }
  return changed;
}

function scheduleRejoin() {
  if (rejoinTimer) return;
  rejoinTimer = setInterval(() => { tryRejoin(); }, 8000);
  tryRejoin();
}

async function tryRejoin() {
  if (!who) return;
  let changed = false;
  try {
    if (window.bikeRefresh) await window.bikeRefresh();
    if (!who.token) {
      const res = await fetchWithTimeout(await bikeUrl("/api/join"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class: who.class, no: String(who.no) }),
      }, 8000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      who = {
        class: who.class,
        no: String(who.no),
        token: data.token,
        name: (data.student && data.student.name) || "",
      };
      sessionStorage.setItem("bike-who", JSON.stringify(who));
      session = data.session || session;
      const localWork = Object.keys(((rec && rec.plan && rec.plan.items) || {})).length || outbox.length;
      if (!localWork && data.student) rec = data.student;
      linkNote = "";
      changed = true;
    }
    if (await flushOutbox()) changed = true;
    if (who.token && !outbox.length) {
      if (linkNote) {
        linkNote = "";
        changed = true;
      }
      if (rejoinTimer) {
        clearInterval(rejoinTimer);
        rejoinTimer = 0;
      }
    }
  } catch (e) { /* 留在這一頁，稍後再連 */ }
  if (changed && !mic && !showTypeSlot) render();
}

async function api(path, body) {
  const headers = Object.assign({ "Content-Type": "application/json" }, authHeaders());
  const payload = body ? Object.assign({ class: who.class, no: who.no }, body) : null;
  let res;
  try {
    res = await window.bikeFetch(path, {
      method: payload ? "POST" : "GET",
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch (e) {
    throw new Error(offlineMessage());
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "未能完成");
  return data;
}

function fileUrl(path) {
  if (!path) return "";
  if (path.startsWith("media/")) return path;
  const base = String(window.BIKE_API || "").replace(/\/$/, "");
  const rel = "/" + path.replace(/^\//, "");
  return (base ? base + rel : rel) + "?t=" + encodeURIComponent(who.token);
}

function stopMic() {
  if (micTimer) {
    clearInterval(micTimer);
    micTimer = null;
  }
  if (mic) {
    try { mic.stop(); } catch (e) { /* already stopped */ }
    mic = null;
  }
  if (mediaRec && mediaRec.state === "recording") {
    try { mediaRec.stop(); } catch (e) { /* already stopped */ }
  }
  if (micStopWait) {
    const done = micStopWait;
    micStopWait = null;
    done();
  }
}

function finishListening() {
  if (micTimer) {
    clearInterval(micTimer);
    micTimer = null;
  }
  const listening = mic || (mediaRec && mediaRec.state === "recording");
  if (!listening) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      micStopWait = null;
      resolve();
    }, 1500);
    micStopWait = () => {
      clearTimeout(timer);
      micStopWait = null;
      resolve();
    };
    if (mic) {
      try { mic.stop(); } catch (e) { micStopWait(); }
    }
    if (mediaRec && mediaRec.state === "recording") {
      try { mediaRec.stop(); } catch (e) { micStopWait(); }
    }
  });
}

function joinVoice(prefix, spoken) {
  const base = (prefix || "").replace(/\s+/g, " ").trim();
  const next = (spoken || "").replace(/\s+/g, " ").trim();
  if (!base) return next;
  if (!next) return base;
  if (next === base || next.startsWith(base)) return next;
  const boundary = /[A-Za-z0-9]$/.test(base) && /^[A-Za-z0-9]/.test(next);
  return base + (boundary ? " " : "") + next;
}

function voicePrefix(slot) {
  const typed = document.getElementById("typed-" + slot);
  if (typed && !typed.classList.contains("hidden")) {
    return typed.value.replace(/\s+/g, " ").trim();
  }
  const node = document.getElementById("said-" + slot);
  const saved = ((node && node.dataset.text) || "").replace(/\s+/g, " ").trim();
  if (saved) return saved;
  if (heardSlot === slot && heard) return heard.replace(/\s+/g, " ").trim();
  if (typed) return typed.value.replace(/\s+/g, " ").trim();
  return "";
}

function paintVoice(slot, text, listening) {
  const typed = document.getElementById("typed-" + slot);
  if (typed && !typed.classList.contains("hidden")) return;
  const node = document.getElementById("said-" + slot);
  const bar = document.getElementById("entry-bar-" + slot);
  const shown = text || "";
  if (node) node.dataset.text = shown;
  if (typed) typed.value = shown;
  if (bar) {
    const placeholder = bar.dataset.placeholder || "輸入你的意見";
    bar.textContent = shown || (listening ? "正在聆聽…" : placeholder);
  }
}

function startMic(qid, slot) {
  micGen += 1;
  const gen = micGen;
  stopMic();
  micSlot = slot || "first";
  const prefix = voicePrefix(micSlot);
  heard = prefix;
  heardSlot = micSlot;
  showTypeSlot = "";
  const typed = document.getElementById("typed-" + micSlot);
  if (typed) {
    typed.blur();
    typed.classList.add("hidden");
  }
  const btn = document.getElementById("entry-bar-" + micSlot);
  if (btn) {
    btn.classList.remove("hidden");
    btn.classList.add("on");
  }
  paintVoice(micSlot, prefix, true);
  const send = document.getElementById("send-" + micSlot);
  if (send) send.textContent = "完成並查看回饋";
  let seconds = 0;
  micTimer = setInterval(() => {
    if (gen !== micGen) return;
    seconds += 1;
    const node = document.getElementById("live-" + micSlot);
    if (node && seconds < 30) node.textContent = "正在聆聽。停了可以再按語音輸入，繼續說。";
    if (seconds >= 30) {
      const live = document.getElementById("live-" + micSlot);
      if (live) live.textContent = heard ? "這一段已聽完。再按語音輸入，繼續說。" : "";
      const button = document.getElementById("send-" + micSlot);
      if (button) button.textContent = "完成並查看回饋";
      finishListening();
    }
  }, 1000);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const recg = new SR();
    mic = recg;
    recg.lang = "zh-HK";
    recg.interimResults = true;
    recg.continuous = true;
    recg.onresult = (event) => {
      if (gen !== micGen) return;
      const typing = document.getElementById("typed-" + micSlot);
      if (typing && !typing.classList.contains("hidden")) return;
      let finalText = "";
      let mid = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += text;
        else mid += text;
      }
      heard = joinVoice(prefix, finalText + mid);
      heardSlot = micSlot;
      paintVoice(micSlot, heard, true);
    };
    recg.onerror = (event) => {
      if (event.error === "not-allowed") {
        err = "尚未允許使用麥克風。請允許麥克風，或改用文字輸入。";
        render();
      }
    };
    recg.onend = () => {
      if (gen !== micGen) return;
      if (mic === recg) mic = null;
      const button = document.getElementById("entry-bar-" + micSlot);
      if (button) button.classList.remove("on");
      paintVoice(micSlot, heardSlot === micSlot ? heard : prefix, false);
      const live = document.getElementById("live-" + micSlot);
      if (live) live.textContent = heard ? "這一段已聽完。再按語音輸入，繼續說。" : "";
      if (micStopWait) {
        const done = micStopWait;
        micStopWait = null;
        done();
      }
    };
    try {
      recg.start();
    } catch (e) {
      err = "麥克風無法開啟。可以改用文字輸入。";
      render();
    }
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    err = "這部裝置接收不到聲音。可以改用文字輸入，或請老師聽你說。";
    render();
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    if (gen !== micGen) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    mediaRec.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (gen !== micGen) return;
      mediaRec = null;
      const blob = new Blob(chunks, { type: mime || "audio/mp4" });
      await uploadAudio(blob, qid);
      if (micStopWait) {
        const done = micStopWait;
        micStopWait = null;
        done();
      }
    };
    mediaRec.start();
    const live = document.getElementById("live-" + micSlot);
    if (live) live.textContent = "正在聆聽。停了可以再按語音輸入，繼續說。";
  }).catch(() => {
    err = "尚未允許使用麥克風。可以改用文字輸入。";
    render();
  });
}

async function uploadAudio(blob, qid) {
  const body = new FormData();
  body.append("class", who.class);
  body.append("no", who.no);
  body.append("slot", "aud-" + qid);
  body.append("file", blob, "speech.webm");
  const res = await window.bikeFetch("/api/transcribe", { method: "POST", headers: authHeaders(), body });
  const data = await res.json().catch(() => ({}));
  const node = document.getElementById("said-" + (micSlot || "first"));
  if (data.text && node) {
    heard = joinVoice(voicePrefix(micSlot || "first"), data.text);
    heardSlot = micSlot || "first";
    node.dataset.audio = data.path || "";
    paintVoice(heardSlot, heard, false);
  } else if (node) {
    node.dataset.audio = data.path || "";
    node.textContent = "錄音已保存。老師可以收聽。你也可以用文字再輸入一次。";
    err = data.error || "";
    const live = document.getElementById("err");
    if (live && err) live.textContent = err;
  }
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "zh-HK";
  utter.rate = 0.92;
  window.speechSynthesis.speak(utter);
}

async function compress(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1280;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!blob) return file;
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch (e) {
    return file;
  }
}

async function uploadPhoto(file, slot) {
  const image = await compress(file);
  const body = new FormData();
  body.append("class", who.class);
  body.append("no", who.no);
  body.append("slot", slot);
  body.append("file", image, "photo.jpg");
  const res = await window.bikeFetch("/api/upload", { method: "POST", headers: authHeaders(), body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "相片未能上載");
  return data;
}

function currentText(slot) {
  const typed = document.getElementById("typed-" + slot);
  if (typed && !typed.classList.contains("hidden")) return typed.value.trim();
  const box = document.getElementById("said-" + slot);
  return ((box && box.dataset.text) || (heardSlot === slot ? heard : "") || "").trim();
}

async function submitAnswer(stage, qid, slot) {
  slot = slot || "first";
  await finishListening();
  const text = currentText(slot);
  const box = document.getElementById("said-" + slot);
  const audio = (box && box.dataset.audio) || "";
  if (!text || text === "正在聆聽…") {
    err = "請先說出你的意見，然後提交。";
    render();
    return;
  }
  const send = document.getElementById("send-" + slot);
  if (send) {
    send.disabled = true;
    send.textContent = "正在接收回饋…";
  }
  try {
    const data = await api("/api/answer", {
      stage,
      qid,
      text,
      slot,
      photo: pendingPhoto,
      audio,
    });
    rec = data.student;
    pendingPhoto = "";
    heard = text;
    heardSlot = slot;
    showTypeSlot = slot;
    linkNote = "";
    render();
  } catch (e) {
    if (isOfflineError(e)) {
      applyLocalText(stage, qid, text);
      remember("/api/answer", { stage: stage, qid: qid, text: text, slot: slot, photo: "", audio: audio });
      pendingPhoto = "";
      heard = text;
      heardSlot = slot;
      showTypeSlot = slot;
      err = "";
      linkNote = OFFLINE_NOTE;
      scheduleRejoin();
      render();
      return;
    }
    err = e.message;
    render();
  }
}

function planBag(id) {
  return (((rec || {}).plan || {}).items || {})[id] || {};
}

function questionMeta(stage, qid) {
  const lists = {
    plan: lesson.planTasks,
    do: lesson.doSteps,
    improve: lesson.improve,
    review: lesson.review,
  };
  return (lists[stage] || []).find((item) => item.id === qid);
}

function attemptsOf(stage, qid) {
  if (!rec) return [];
  if (stage === "plan") return planBag(qid).attempts || [];
  const bag = (rec[stage] || {})[qid] || {};
  return bag.attempts || [];
}

function attemptHtml(attempts) {
  return (attempts || []).map((item) => `
    <div class="chat">
      <div class="bubble-you"><b>你</b><p>${esc(item.text)}</p></div>
      <div class="bubble-ai ${item.source === "ai" ? "" : "coach"}">
        <b>${item.source === "ai" ? "即時回饋" : "課堂提示"}</b>
        <p>${esc(item.feedback)}</p>
      </div>
    </div>
  `).join("");
}

function questionBox(text, compact) {
  return `<div class="chat"><div class="bubble-ai coach ${compact ? "follow" : ""}"><p>${esc(text || "")}</p></div></div>`;
}

function feedbackBubble(item) {
  if (!item) return "";
  return questionBox(item.feedback, true);
}

function barBlock(slot, draft, open, placeholder) {
  return `
    <div class="entry">
      <button type="button" class="entry-bar ${open ? "hidden" : ""}" id="entry-bar-${slot}" data-placeholder="${esc(placeholder)}">${esc(draft || placeholder)}</button>
      <textarea id="typed-${slot}" class="entry-bar ${open ? "" : "hidden"}" placeholder="${esc(placeholder)}">${esc(draft)}</textarea>
      <div class="entry-menu" id="entry-menu-${slot}">
        <button type="button" id="pick-voice-${slot}">${VOICE_LABEL}</button>
      </div>
      <div class="said hidden" id="said-${slot}" data-text="${esc(draft)}"></div>
      <p class="live" id="live-${slot}"></p>
    </div>
    <div class="row">
      <button type="button" class="primary" id="send-${slot}">完成並查看回饋</button>
    </div>`;
}

function composer(stage, qid, ask) {
  const attempts = attemptsOf(stage, qid);
  const stacked = attempts.length > 2;
  const first = stacked ? attempts[attempts.length - 1] : attempts[0];
  const second = stacked ? null : attempts[1];
  const third = stacked ? null : attempts[2];
  const draft1 = (heardSlot === "first" ? heard : "") || (first && first.text) || "";
  const draft2 = (heardSlot === "follow" ? heard : "") || (second && second.text) || "";
  const draft3 = (heardSlot === "third" ? heard : "") || (third && third.text) || "";
  const oneShot = /where$/.test(qid);
  const wantThird = qid === "review-teach";
  return `
    ${barBlock("first", draft1, showTypeSlot === "first", "輸入你的意見")}
    ${first && oneShot ? questionBox(first.feedback, true) : ""}
    ${first && !oneShot ? `
      ${questionBox(first.feedback, true)}
      ${barBlock("follow", draft2, showTypeSlot === "follow", "回答跟進問題")}
      ${second ? feedbackBubble(second) : ""}
      ${second && wantThird ? `
        <h2>你為什麼先教這一件？</h2>
        ${barBlock("third", draft3, showTypeSlot === "third", "說出原因")}
        ${third ? feedbackBubble(third) : ""}
      ` : ""}
    ` : ""}
  `;
}

function bindComposer(stage, qid) {
  ["first", "follow", "third"].forEach((slot) => bindOneBar(stage, qid, slot));
}

function bindOneBar(stage, qid, slot) {
  const bar = document.getElementById("entry-bar-" + slot);
  const menu = document.getElementById("entry-menu-" + slot);
  const typed = document.getElementById("typed-" + slot);
  if (!bar) return;
  if (typed) {
    typed.addEventListener("input", () => {
      heardSlot = slot;
      heard = typed.value.replace(/\s+/g, " ").trim();
      const node = document.getElementById("said-" + slot);
      if (node) node.dataset.text = typed.value;
    });
  }
  bar.onclick = () => {
    if (mic || (mediaRec && mediaRec.state === "recording")) stopMic();
    showTypeSlot = slot;
    heardSlot = slot;
    const draft = voicePrefix(slot);
    heard = draft;
    bar.classList.add("hidden");
    if (typed) {
      typed.value = draft;
      typed.classList.remove("hidden");
      typed.focus();
    }
  };
  const pickVoice = document.getElementById("pick-voice-" + slot);
  if (pickVoice) {
    pickVoice.onclick = () => startMic(qid, slot);
  }
  const send = document.getElementById("send-" + slot);
  if (send) send.onclick = () => submitAnswer(stage, qid, slot);
}

function icon(name) {
  if (name === "螺絲批") {
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="20" y="8" width="16" height="14" rx="3"/><path d="M28 22v24"/><path d="M22 46h12l-6 10z"/></svg>`;
  }
  if (name === "鉗仔") {
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M22 8l10 22-8 8"/><path d="M42 8L32 30l8 8"/><path d="M18 42l-8 14"/><path d="M46 42l8 14"/></svg>`;
  }
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M8 24h48v8H8z"/><path d="M16 32v18"/><path d="M48 32v18"/><path d="M10 50h14"/><path d="M40 50h14"/></svg>`;
}

function shell(inner) {
  const name = rec && rec.name ? ` · ${esc(rec.name)}` : "";
  const whoLine = rec ? `${esc(rec.class)} ${esc(rec.no)}號${name}` : "";
  return `
    <header class="top">
      <div class="top-copy">
        <p class="kicker">${esc(lesson.kicker)}</p>
        <p class="pdir"><span><b>Plan</b> 計劃</span><span><b>Do</b> 動手</span><span><b>Improve</b> 改良</span><span><b>Review</b> 回顧</span></p>
        <h1>${esc(lesson.title)}</h1>
        <a class="teacher-entry" href="teacher.html">老師查看成績</a>
        ${whoLine ? `<p class="who">${whoLine} <button type="button" id="leave" class="quiet" style="color:#d5e4de;min-height:36px;border-color:#35574f">離開</button></p>` : ""}
      </div>
      <img class="top-crew" src="media/header-engineers.png?v=2" alt="小志和小蓮化身工程師，一起砌單車">
    </header>
    ${rec ? rail() : ""}
    <main class="wrap">
      ${err ? `<div class="err" id="err">${esc(err)}</div>` : `<div class="err hidden" id="err"></div>`}
      ${linkNote ? `<p class="link-note">${esc(linkNote)}</p>` : ""}
      ${inner}
    </main>`;
}

function rail() {
  const allowed = allowedRank();
  const current = stageOf(screen);
  return `<nav class="rail">${STAGES.map((stage, index) => {
    const clsName = [
      current === stage.id ? "on" : "",
      index < rank(rec.unlocked || "plan") ? "done" : "",
    ].filter(Boolean).join(" ");
    return `<button type="button" data-go="${stage.id}" class="${clsName}" ${index > allowed ? "disabled" : ""}><span class="rail-name"><b>${stage.en}</b><small>${stage.name}</small></span></button>`;
  }).join("")}</nav>`;
}

function gateNote() {
  if (!session || session.selfPace !== false) return "";
  const gate = STAGES.find((s) => s.id === session.gate) || STAGES[0];
  return `<p class="hint">老師現在帶領全班停在「${esc(gate.name)}」。下一段要等老師才一起進入。</p>`;
}

function viewLogin() {
  const grades = lesson.grades || [{ name: "班別", classes: lesson.classes || [] }];
  const classOptions = grades.map((grade) => `
    <optgroup label="${esc(grade.name)}">
      ${(grade.classes || []).map((item) =>
        `<option value="${esc(item)}" ${item === cls ? "selected" : ""}>${esc(item)}</option>`
      ).join("")}
    </optgroup>`).join("");
  const lower = `
    <div class="card">
      <div class="teacher-line"><b>學生資料</b><span>選擇班別和學號，然後進入</span></div>
      <label class="field">班別
        <select id="class-pick">
          <option value="" ${cls ? "" : "selected"}>請選擇班別</option>
          ${classOptions}
        </select>
      </label>
      <label class="field">學號
        <input id="num-pick" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="例如 15" value="${esc(num)}">
      </label>
      <div class="dock"><button type="button" class="primary full" id="enter">進入計劃</button></div>
    </div>`;
  return shell(`
    <div class="card story">
      ${storyFilm()}
      <h2>${esc(lesson.storyTitle || "一個真實的任務")}</h2>
      ${(lesson.story || [lesson.problem]).map((line) => `<p>${esc(line)}</p>`).join("")}
    </div>
    ${lower}
  `);
}

function viewIntro() {
  const rows = [
    ["P", "計劃", "認識零件和工具", "把陌生的零件和工具配對到正確位置"],
    ["D", "動手", "安裝並固定", "按步驟把零件裝好，並把它們固定"],
    ["I", "改良", "試踩並找出問題", "發現未固定好、會移位，或未能有效煞車的地方"],
    ["R", "反思", "再裝或教同學", "想一想下次怎樣安裝，以及怎樣教另一位同學"],
  ];
  return shell(`
    ${gateNote()}
    <div class="card">
      <div class="teacher-line"><b>老師帶領</b><span>工程設計循環</span></div>
      ${storyFilm()}
      <div class="story">
        <h2>${esc(lesson.storyTitle || "一個真實的任務")}</h2>
        ${(lesson.story || [lesson.problem]).map((line) => `<p>${esc(line)}</p>`).join("")}
      </div>
      <ol class="cycle">${rows.map((row) => `<li><span class="mark">${row[0]}</span><div><strong>${row[1]}</strong><em>${row[2]}</em><span>${row[3]}</span></div></li>`).join("")}</ol>
      <div class="row"><button type="button" class="primary" id="begin">我是小小工程師，開始計劃</button></div>
    </div>
  `);
}

const STORY_SKY = [
  { start: 0, end: 2, text: "弟妹想學踩單車。" },
  { start: 2, end: 5, text: "哥哥姐姐，默默把單車安裝。" },
  { start: 5, end: 6.6, text: "再扶着他們。" },
  { start: 6.6, end: 12.2, text: "小小工程師建立的不只是單車，\n而是一顆為人着想的心。" },
];

function storyFilm() {
  return `
    <div class="story-stage">
      <video id="story-video" class="hero" controls playsinline preload="metadata" poster="media/story-poster.jpg?v=10" src="media/story.mp4?v=10"></video>
      <div id="story-sky" class="story-sky" aria-live="polite"></div>
    </div>
  `;
}

function paintStorySky() {
  const video = document.getElementById("story-video");
  const box = document.getElementById("story-sky");
  if (!video || !box) return;
  const t = video.currentTime || 0;
  const line = STORY_SKY.find((item) => t >= item.start && t < item.end);
  if (!line) {
    box.innerHTML = "";
    box.dataset.line = "";
    return;
  }
  const chars = Array.from(line.text).filter((ch) => ch !== "\n");
  const span = Math.max(0.2, line.end - line.start);
  const shown = Math.min(chars.length, Math.max(1, Math.ceil((t - line.start) / span * chars.length)));
  if (box.dataset.line !== String(line.start)) {
    box.dataset.line = String(line.start);
    let seen = 0;
    box.innerHTML = Array.from(line.text).map((ch) => {
      if (ch === "\n") return "<br>";
      seen += 1;
      return `<span data-i="${seen}">${esc(ch)}</span>`;
    }).join("");
  }
  box.querySelectorAll("span").forEach((node, index) => {
    node.classList.toggle("on", index < shown);
  });
}

function bindStorySky() {
  const video = document.getElementById("story-video");
  if (!video || video.dataset.sky) return;
  video.dataset.sky = "1";
  ["timeupdate", "seeked", "play", "pause"].forEach((name) => {
    video.addEventListener(name, paintStorySky);
  });
}

function stopCam() {
  if (!camStream) return;
  camStream.getTracks().forEach((track) => track.stop());
  camStream = null;
}

function photoFeedbackBox(text, source) {
  if (!text) return "";
  const label = source === "ai" ? "即時回饋" : "安裝提示";
  return `<div class="chat"><div class="bubble-ai coach follow photo-note"><b>${esc(label)}</b><p>${esc(text)}</p></div></div>`;
}

function photoRetake(task, bag) {
  if (!task || task.id !== "stem-use") return false;
  const verdict = pendingPhotoFeedback ? pendingPhotoOk : (bag && bag.photoOk);
  return verdict === false;
}

function stemPhotoNote(task, bag) {
  if (!task || !task.photo) return "";
  if (photoLooking) return photoFeedbackBox("正在儲存這張相……", "coach");
  const stored = bag || {};
  const text = pendingPhotoFeedback || stored.photoFeedback || "";
  const source = pendingPhotoFeedback ? pendingPhotoSource : (stored.photoSource || "coach");
  return photoFeedbackBox(text, source);
}

function photoBlock(task, savedPath, bag) {
  if (!task || !task.photo) return "";
  const path = pendingPhoto || savedPath || "";
  const src = photoLooking && shotPreview ? shotPreview : (path ? fileUrl(path) : "");
  return `
    <h2 class="photo-ask">${esc(task.photoAsk || "請對準剛裝好的零件，拍一張相。")}</h2>
    ${src ? `<img class="taken" src="${esc(src)}" alt="你拍攝的照片">` : ""}
    ${stemPhotoNote(task, bag)}
    <div id="cam-live" class="hidden">
      <video id="cam-video" autoplay playsinline muted></video>
      <div class="row">
        <button type="button" class="primary" id="snap">影相</button>
        <button type="button" class="quiet" id="cam-close">取消</button>
      </div>
    </div>
    <div class="row"><button type="button" class="btn cam" id="open-cam" ${photoLooking ? "disabled" : ""}>${photoRetake(task, bag) ? "再影一張" : "拍攝一張相"}</button></div>
  `;
}

function resumePlanIndex() {
  const pages = planPages();
  let best = 0;
  let bestAt = "";
  pages.forEach((page, index) => {
    if (!page.question) return;
    const attempts = attemptsOf("plan", page.question.id);
    const at = (attempts[attempts.length - 1] || {}).at || "";
    if (at && at >= bestAt) {
      bestAt = at;
      best = index;
    }
  });
  return best;
}

function planPages() {
  const pages = [{ type: "mission" }];
  (lesson.planItems || []).forEach((item) => {
    (item.questions || []).forEach((question, index) => {
      pages.push({ type: "ask", item, question, index });
    });
  });
  return pages;
}

function viewPlan() {
  const pages = planPages();
  const page = pages[Math.min(planIndex, Math.max(pages.length - 1, 0))];
  if (!page) return shell(`<div class="card"><h2>尚未有計劃活動</h2></div>`);
  const last = planIndex >= pages.length - 1;
  let body = "";
  let ready = false;
  if (page.type === "mission") {
    ready = true;
    body = `
      <h2>你知道下面這些零件是什麼嗎？</h2>
      <div class="partshow">${(lesson.planItems || []).map((item) => `<figure class="part"><img src="${esc((item.images || [])[0])}" alt="${esc(item.name)}"><figcaption>${esc(item.name)}</figcaption></figure>`).join("")}</div>
    `;
  } else {
    const item = page.item;
    const question = page.question;
    const choices = question.choices || [];
    const steps = question.steps || [];
    const bag = planBag(question.id);
    const picked = bag.choice || "";
    const picked2 = bag.choice2 || "";
    const tries = attemptsOf("plan", question.id);
    const feedbackFor = (step) => {
      const rows = tries.filter((item) => (item.step || 1) === step);
      return rows.length ? rows[rows.length - 1].feedback : "";
    };
    if (question.photo && question.optional) {
      ready = true;
    } else if (steps.length >= 2) {
      ready = picked === steps[0].answer && picked2 === steps[1].answer;
    } else if (choices.length) {
      ready = picked === question.answer;
    } else {
      ready = tries.length > 0;
    }
    const textRound = (round, step, chosen) => `
      <h2>${esc(round.ask)}</h2>
      <div class="pick-list">
        ${(round.choices || []).map((choice) => `
          <button type="button" class="pick ${chosen === choice.id ? (chosen === round.answer ? "yes" : "on") : ""}" data-pick="${esc(choice.id)}" data-step="${step}">
            ${esc(choice.id)}. ${esc(choice.text)}
          </button>
        `).join("")}
      </div>
      ${chosen && feedbackFor(step) ? questionBox(feedbackFor(step), true) : ""}
    `;
    const pbag = planBag(question.id);
    body = question.photo ? `
      <p class="hint">${esc(item.name)}</p>
      ${planMedia(item, question)}
      <h2>${esc(question.ask)}</h2>
      ${photoBlock(question, pbag.photo, pbag)}
      <p class="hint">如果相機開不到，可以直接按下一項。</p>
    ` : `
      <p class="hint">${esc(item.name)}</p>
      ${planMedia(item, question)}
      ${steps.length ? `
        ${textRound(steps[0], 1, picked)}
        ${steps[1] && picked === steps[0].answer ? textRound(steps[1], 2, picked2) : ""}
      ` : choices.length && choices[0].text ? `
        ${textRound(question, 1, picked)}
      ` : choices.length ? `
        <h2>${esc(question.ask)}</h2>
        <p class="hint">看下面四張相，選出它應該安裝的位置。</p>
        <div class="pick4">
          ${choices.map((choice) => `
            <button type="button" class="pick ${picked === choice.id ? (picked === question.answer ? "yes" : "on") : ""}" data-pick="${esc(choice.id)}" data-step="1">
              <img src="${esc(choice.image)}" alt="${esc(choice.id)}">
              <b>${esc(choice.id)}</b>
            </button>
          `).join("")}
        </div>
        ${picked && feedbackFor(1) ? questionBox(feedbackFor(1), true) : ""}
      ` : `
        <h2>${esc(question.ask)}</h2>
        ${composer("plan", question.id, question.ask)}
      `}
    `;
  }
  return shell(`
    ${gateNote()}
    <div class="card">
      <div class="teacher-line"><b>P 計劃</b><span>${planIndex + 1}/${pages.length}</span></div>
      <p class="plan-motto">看清零件，想明原理，安裝才穩。</p>
      ${body}
      <div class="row">
        ${planIndex > 0 ? `<button type="button" class="quiet" id="prev-plan">上一項</button>` : ""}
        ${last
          ? `<button type="button" class="primary" id="to-do" ${ready ? "" : "disabled"}>${ready ? "開始動手安裝" : "請先完成這項計劃"}</button>`
          : `<button type="button" class="primary" id="next-plan" ${ready ? "" : "disabled"}>下一項</button>`}
      </div>
    </div>
  `);
}

function planMedia(item, question) {
  const images = question.image ? [question.image] : item.images;
  const film = question.video
    ? `<video class="plan-film" controls playsinline preload="metadata" poster="${esc(question.poster || "")}" src="${esc(question.video)}"></video>`
    : "";
  return film + shotHtml(images);
}

function shotHtml(images, video, poster) {
  const pics = (images || []).map((src) => `<img src="${esc(src)}" alt="">`).join("");
  const film = video ? `<video controls playsinline preload="metadata" poster="${esc(poster || "")}" src="${esc(video)}"></video>` : "";
  const count = (images || []).length + (video ? 1 : 0);
  return `<div class="shots ${count > 1 ? "two" : ""}">${pics}${film}</div>`;
}

function viewDo() {
  const steps = lesson.doSteps || [];
  if (!steps.length) return shell(`<div class="card"><h2>動手部分未準備好</h2></div>`);
  const step = steps[Math.min(doIndex, steps.length - 1)];
  const bag = (rec.do || {})[step.id] || {};
  const tools = doIndex === 0 ? `<div class="toolgrid">${(lesson.toolbox || []).map((tool) => `
    <div class="tool">
      ${tool.image ? `<img src="${esc(tool.image)}" alt="${esc(tool.name)}">` : `<div class="icon">${icon(tool.name)}</div>`}
      <b>${esc(tool.name)}</b>
      <span>${esc(tool.use)}</span>
    </div>`).join("")}</div>` : "";
  const chips = steps.map((item, index) => {
    const did = (rec.do || {})[item.id] && rec.do[item.id].done;
    return `<button type="button" data-step="${index}" class="${index === doIndex ? "on" : ""} ${did ? "did" : ""}">${index + 1} ${esc(item.title)}</button>`;
  }).join("");
  const choices = step.choices || [];
  const picked = bag.choice || "";
  const told = choices.length ? picked === step.answer : (bag.attempts || []).length > 0;
  const stationReady = told;
  const next = doIndex < steps.length - 1
    ? `<button type="button" class="primary" id="next-step" ${stationReady ? "" : "disabled"}>下一個零件</button>`
    : `<button type="button" class="primary" id="to-improve">去試踩，然後執漏</button>`;
  return shell(`
    ${gateNote()}
    <p class="hint">你正在為一、二年級學踩單車而組裝。這裏是怎樣用螺絲和零件把主要部件固定好。老師在旁把關安全。</p>
    <div class="steps">${chips}</div>
    <div class="card">
      <div class="teacher-line"><b>D 動手</b><span>${esc(step.tool)}</span></div>
      <h2>${doIndex + 1}. ${esc(step.title)}</h2>
      ${shotHtml(step.images, step.video, step.poster)}
      ${tools}
      <p class="hint">安裝提示</p>
      <ul class="lines">${(step.tips || step.lines || []).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      ${step.safety ? `<div class="safety">安全：${esc(step.safety)}</div>` : ""}
      ${photoBlock(step, bag.photo, bag)}
      ${choices.length ? `
        <h2>${esc(step.noteAsk || "")}</h2>
        <div class="pick-list">
          ${choices.map((choice) => `
            <button type="button" class="pick ${picked === choice.id ? (picked === step.answer ? "yes" : "on") : ""}" data-pick="${esc(choice.id)}">
              ${esc(choice.id)}. ${esc(choice.text)}
            </button>
          `).join("")}
        </div>
        ${bag.choiceFeedback ? questionBox(bag.choiceFeedback, true) : ""}
      ` : `
        <h2>${esc(step.noteAsk || "")}</h2>
        ${composer("do", step.id, step.noteAsk || step.title)}
      `}
      <div class="row">${next}</div>
    </div>
  `);
}

function visibleImprove() {
  return (lesson.improve || []).filter((item) => {
    if (!item.after) return true;
    const bag = (rec.improve || {})[item.after];
    return bag && bag.attempts && bag.attempts.length;
  });
}

function viewImprove() {
  const items = visibleImprove();
  if (!items.length) {
    return shell(`<div class="card"><h2>改良題未準備好</h2></div>`);
  }
  impIndex = Math.min(impIndex, items.length - 1);
  const item = items[impIndex];
  return shell(`
    ${gateNote()}
    <div class="card">
      <div class="teacher-line"><b>I 改良</b><span>試踩之後執漏</span></div>
      <p class="hint">踩上單車走幾步。未打氣、螺絲未扭實、煞不到車，或座墊太高太低，都要說出來再修。</p>
      <h2>${esc(item.ask)}</h2>
      ${shotHtml(item.images, item.video, item.poster)}
      ${photoBlock(item, ((attemptsOf("improve", item.id).slice(-1)[0]) || {}).photo || "")}
      ${composer("improve", item.id, item.ask)}
      <div class="row">
        ${impIndex > 0 ? `<button type="button" class="quiet" id="prev-q">上一題</button>` : ""}
        ${impIndex < items.length - 1 ? `<button type="button" class="primary" id="next-q">下一題</button>` : `<button type="button" class="primary" id="to-review" ${rank(rec.unlocked) >= 3 ? "" : "disabled"}>去回顧</button>`}
      </div>
    </div>
  `);
}

function lessonFinished() {
  return !!((((rec || {}).review || {})["review-teach"] || {}).finished);
}

function viewClose() {
  return shell(`
    <div class="card ending">
      <video class="ending-video" controls playsinline preload="metadata" poster="media/story-poster.jpg?v=10" src="media/story.mp4?v=10"></video>
      <h2>多謝你為一、二年級小朋友製作單車。</h2>
      <div class="row">
        <button type="button" class="quiet" id="back-review">返回上一頁</button>
        <button type="button" class="primary" id="home">返回首頁</button>
      </div>
    </div>
  `);
}

function viewReview() {
  if (lessonFinished() && !backToReview) return viewClose();
  const items = lesson.review;
  const item = items[Math.min(revIndex, items.length - 1)];
  const done = items.filter((q) => attemptsOf("review", q.id).length).length;
  const choices = item.choices || [];
  const tries = attemptsOf("review", item.id);
  const partNames = (item.choices || []).map((choice) => choice.text);
  const pickedTry = tries.find((row) => partNames.indexOf(row.text) >= 0) || null;
  const whyTry = tries.find((row) => row !== pickedTry) || null;
  const pickedText = (pickedTry || {}).text || "";
  const feedback = (pickedTry || {}).feedback || "";
  return shell(`
    ${gateNote()}
    <div class="card">
      <div class="teacher-line"><b>R 回顧</b><span>分享過程，不只展示成品 · ${done}/${items.length}</span></div>
      <p class="hint">回顧你怎樣幫一、二年級準備這輛學踩的單車：計劃、測試、改良，和你學到的事。</p>
      ${item.frame && !choices.length ? `<p class="hint">${esc(item.frame)}</p>` : ""}
      <h2>${esc(item.ask)}</h2>
      ${choices.length ? `
        <div class="pick-list">
          ${choices.map((choice) => `
            <button type="button" class="pick ${pickedText === choice.text ? "yes" : ""}" data-pick="${esc(choice.id)}">
              ${esc(choice.id)}. ${esc(choice.text)}
            </button>
          `).join("")}
        </div>
        ${feedback ? questionBox(feedback, true) : ""}
        ${pickedTry ? `
          <h2>為什麼你覺得這個部分最難？</h2>
          ${barBlock("follow", (whyTry && whyTry.text) || "", showTypeSlot === "follow", "說出為什麼")}
          ${whyTry ? feedbackBubble(whyTry) : ""}
        ` : ""}
      ` : composer("review", item.id, item.ask)}
      <div class="row">
        ${revIndex > 0 ? `<button type="button" class="quiet" id="prev-r">上一題</button>` : ""}
        ${revIndex < items.length - 1 ? `<button type="button" class="primary" id="next-r">下一題</button>` : `<button type="button" class="primary" id="review-done" ${(item.id === "review-teach" && (tries.length >= 3 || ((rec.review || {})[item.id] || {}).finished)) ? "" : "disabled"}>${((rec.review || {})[item.id] || {}).finished ? "已完成" : "完成"}</button>`}
      </div>
    </div>
  `);
}

function view() {
  if (!who || screen === "login") return viewLogin();
  if (screen === "intro") return viewIntro();
  if (screen === "plan") return viewPlan();
  if (screen === "do") return viewDo();
  if (screen === "improve") return viewImprove();
  if (screen === "review") return viewReview();
  return viewIntro();
}

function render() {
  try {
    stopMic();
    stopCam();
    app.innerHTML = view();
    bind();
    if (who) {
      sessionStorage.setItem("bike-screen", screen);
      sessionStorage.setItem("bike-plan", String(planIndex));
      if (rec) {
        try { sessionStorage.setItem("bike-rec", JSON.stringify(rec)); } catch (e) { /* 畫面仍然保留 */ }
      }
    }
    err = "";
  } catch (e) {
    app.innerHTML = `<div class="err">這一頁開不到：${esc(e.message)}</div>`;
  }
}

function bind() {
  bindStorySky();
  const leave = document.getElementById("leave");
  if (leave) {
    leave.onclick = () => {
      sessionStorage.removeItem("bike-who");
      sessionStorage.removeItem("bike-screen");
      sessionStorage.removeItem("bike-plan");
      who = null;
      rec = null;
      screen = "login";
      planIndex = 0;
      cls = "";
      num = "";
      confirmName = null;
      render();
    };
  }
  const enter = document.getElementById("enter");
  if (enter) enter.onclick = enterStudent;
  const numPick = document.getElementById("num-pick");
  if (numPick) {
    numPick.addEventListener("keydown", (event) => {
      if (event.key === "Enter") enterStudent();
    });
  }
  const yes = document.getElementById("yes");
  if (yes) yes.onclick = join;
  const no = document.getElementById("no");
  if (no) {
    no.onclick = () => {
      confirmName = null;
      num = "";
      render();
    };
  }
  const begin = document.getElementById("begin");
  if (begin) begin.onclick = () => { screen = "plan"; render(); };
  const home = document.getElementById("home");
  if (home) home.onclick = () => {
    backToReview = false;
    screen = "intro";
    planIndex = 0;
    sessionStorage.setItem("bike-screen", "intro");
    render();
  };
  const backReview = document.getElementById("back-review");
  if (backReview) backReview.onclick = () => {
    backToReview = true;
    screen = "review";
    revIndex = Math.max(0, (lesson.review || []).length - 1);
    heard = "";
    render();
  };
  app.querySelectorAll("[data-go]").forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.go;
      if (rank(id) > allowedRank()) {
        err = "老師尚未開放這一段。";
        render();
        return;
      }
      heard = "";
      pendingPhoto = "";
      showTypeSlot = "";
      backToReview = false;
      screen = id;
      if (id === "do") doIndex = firstOpenStep();
      render();
    };
  });
  app.querySelectorAll("[data-choice]").forEach((button) => {
    button.onclick = async () => {
      const page = planPages()[planIndex];
      if (!page || page.type !== "match") return;
      try {
        const data = await api("/api/plan", { matchId: page.task.id, choice: button.dataset.choice });
        rec = data.student;
      } catch (e) {
        err = e.message;
      }
      render();
    };
  });
  app.querySelectorAll("[data-order]").forEach((button) => {
    button.onclick = async () => {
      const id = button.dataset.order;
      const order = ((rec.plan && rec.plan.order) || []).slice();
      const index = order.indexOf(id);
      if (index >= 0) order.splice(index, 1);
      else order.push(id);
      try {
        const data = await api("/api/plan", { order });
        rec = data.student;
      } catch (e) {
        err = e.message;
      }
      render();
    };
  });
  app.querySelectorAll("[data-role]").forEach((button) => {
    button.onclick = async () => {
      const step = lesson.doSteps[doIndex];
      try {
        const data = await api("/api/do", { id: step.id, role: button.dataset.role });
        rec = data.student;
      } catch (e) { err = e.message; }
      render();
    };
  });
  app.querySelectorAll("[data-status]").forEach((button) => {
    button.onclick = async () => {
      const step = lesson.doSteps[doIndex];
      try {
        const data = await api("/api/do", { id: step.id, status: button.dataset.status });
        rec = data.student;
      } catch (e) { err = e.message; }
      render();
    };
  });
  const prevPlan = document.getElementById("prev-plan");
  const nextPlan = document.getElementById("next-plan");
  if (prevPlan) prevPlan.onclick = () => { planIndex -= 1; heard = ""; showTypeSlot = ""; clearShot(); render(); };
  if (nextPlan) nextPlan.onclick = () => { planIndex += 1; heard = ""; showTypeSlot = ""; clearShot(); render(); };
  const toDo = document.getElementById("to-do");
  if (toDo) toDo.onclick = async () => {
    try {
      const data = await api("/api/plan-done", {});
      if (data.student) rec = data.student;
    } catch (e) {
      err = e.message;
    }
    screen = "do";
    doIndex = firstOpenStep();
    sessionStorage.setItem("bike-screen", "do");
    render();
  };
  app.querySelectorAll("[data-step]").forEach((button) => {
    button.onclick = () => {
      doIndex = Number(button.dataset.step);
      heard = "";
      clearShot();
      render();
    };
  });
  bindPhoto();
  const done = document.getElementById("done");
  if (done) {
    done.onclick = async () => {
      const step = lesson.doSteps[doIndex];
      const bag = (rec.do || {})[step.id] || {};
      if (!bag.status) {
        err = "請先選測試結果：未成功、差不多或成功。";
        render();
        return;
      }
      try {
        const data = await api("/api/do", { id: step.id, done: true });
        rec = data.student;
      } catch (e) {
        err = e.message;
      }
      render();
    };
  }
  const nextStep = document.getElementById("next-step");
  if (nextStep) nextStep.onclick = () => { doIndex += 1; heard = ""; clearShot(); render(); };
  const toImprove = document.getElementById("to-improve");
  if (toImprove) {
    toImprove.onclick = async () => {
      try {
        const data = await api("/api/do-done", {});
        if (data.student) rec = data.student;
      } catch (e) {
        err = e.message;
      }
      screen = "improve";
      impIndex = 0;
      sessionStorage.setItem("bike-screen", "improve");
      render();
    };
  }
  const step = screen === "do" ? lesson.doSteps[doIndex] : null;
  if (screen === "plan") {
    const page = planPages()[planIndex];
    const question = page && page.question;
    const choosing = question && ((question.choices || []).length || (question.steps || []).length);
    if (question && !choosing) bindComposer("plan", question.id);
    app.querySelectorAll("[data-pick]").forEach((button) => {
      button.onclick = async () => {
        if (!question) return;
        const stepNo = Number(button.dataset.step || 1);
        const choice = button.dataset.pick;
        try {
          const data = await api("/api/plan", {
            matchId: question.id,
            choice: choice,
            step: stepNo,
          });
          rec = data.student;
          err = "";
          linkNote = "";
        } catch (e) {
          if (isOfflineError(e)) {
            applyLocalPlan(question, choice, stepNo);
            remember("/api/plan", { matchId: question.id, choice: choice, step: stepNo });
            err = "";
            linkNote = OFFLINE_NOTE;
            scheduleRejoin();
          } else {
            err = e.message;
          }
        }
        render();
      };
    });
  }
  if (step && (step.choices || []).length) {
    app.querySelectorAll("[data-pick]").forEach((button) => {
      button.onclick = async () => {
        const choice = button.dataset.pick;
        try {
          const data = await api("/api/do", { id: step.id, choice: choice });
          rec = data.student;
          err = "";
          linkNote = "";
        } catch (e) {
          if (isOfflineError(e)) {
            keepDoChoice(step, choice);
            remember("/api/do", { id: step.id, choice: choice });
            linkNote = OFFLINE_NOTE;
            scheduleRejoin();
          } else {
            err = e.message;
          }
        }
        render();
      };
    });
  } else if (step) {
    bindComposer("do", step.id, step.noteAsk || step.title);
  }
  if (screen === "improve") {
    const item = visibleImprove()[impIndex];
    if (item) bindComposer("improve", item.id, item.ask);
  }
  if (screen === "review") {
    const item = lesson.review[revIndex];
    if (item && (item.choices || []).length) {
      app.querySelectorAll("[data-pick]").forEach((button) => {
        button.onclick = async () => {
          const choice = (item.choices || []).find((row) => row.id === button.dataset.pick);
          if (!choice) return;
          try {
            const data = await api("/api/answer", { stage: "review", qid: item.id, text: choice.text, slot: "first" });
            rec = data.student;
            err = "";
            linkNote = "";
          } catch (e) {
            if (isOfflineError(e)) {
              applyLocalText("review", item.id, choice.text);
              remember("/api/answer", { stage: "review", qid: item.id, text: choice.text, slot: "first" });
              linkNote = OFFLINE_NOTE;
              scheduleRejoin();
            } else {
              err = e.message;
            }
          }
          render();
        };
      });
      if (item && attemptsOf("review", item.id).some((row) => (item.choices || []).some((choice) => choice.text === row.text))) {
        bindOneBar("review", item.id, "follow");
      }
    } else if (item) {
      bindComposer("review", item.id, item.ask);
    }
    const reviewDone = document.getElementById("review-done");
    if (reviewDone && item && !reviewDone.disabled) {
      reviewDone.onclick = async () => {
        if (((rec.review || {})[item.id] || {}).finished) {
          backToReview = false;
          render();
          return;
        }
        try {
          const data = await api("/api/answer", { stage: "review", qid: item.id, slot: "finish", text: "完成" });
          rec = data.student;
          err = "";
        } catch (e) {
          err = e.message;
        }
        backToReview = false;
        render();
      };
    }
  }
  const prevQ = document.getElementById("prev-q");
  const nextQ = document.getElementById("next-q");
  if (prevQ) prevQ.onclick = () => { impIndex -= 1; heard = ""; pendingPhoto = ""; render(); };
  if (nextQ) nextQ.onclick = () => { impIndex += 1; heard = ""; pendingPhoto = ""; render(); };
  const toReview = document.getElementById("to-review");
  if (toReview) {
    toReview.onclick = () => {
      if (rank(rec.unlocked) < 3) {
        err = "請先回答至少一題改良，再前往反思。";
        render();
        return;
      }
      if (allowedRank() < 3) {
        err = "老師尚未開放反思。";
        render();
        return;
      }
      backToReview = false;
      screen = "review";
      revIndex = 0;
      render();
    };
  }
  const prevR = document.getElementById("prev-r");
  const nextR = document.getElementById("next-r");
  if (prevR) prevR.onclick = () => { revIndex -= 1; heard = ""; render(); };
  if (nextR) nextR.onclick = () => { revIndex += 1; heard = ""; render(); };
}

function clearShot() {
  pendingPhoto = "";
  pendingPhotoFeedback = "";
  pendingPhotoSource = "";
  pendingPhotoOk = null;
  photoLooking = false;
  if (shotPreview) URL.revokeObjectURL(shotPreview);
  shotPreview = "";
}

async function saveShot(file) {
  if (screen === "do") {
    const step = lesson.doSteps[doIndex];
    const uploaded = await uploadPhoto(file, "do-" + step.id);
    pendingPhoto = uploaded.path || "";
    pendingPhotoFeedback = uploaded.feedback || "";
    pendingPhotoSource = uploaded.source || "";
    pendingPhotoOk = uploaded.ok === true ? true : uploaded.ok === false ? false : null;
    const data = await api("/api/me?class=" + who.class + "&no=" + who.no);
    rec = data.student;
  } else if (screen === "plan") {
    const page = planPages()[planIndex];
    const question = page && page.question;
    if (question && question.photo) {
      const uploaded = await uploadPhoto(file, "plan-" + question.id);
      pendingPhoto = uploaded.path || "";
      pendingPhotoFeedback = uploaded.feedback || "";
      pendingPhotoSource = uploaded.source || "";
      pendingPhotoOk = uploaded.ok === true ? true : uploaded.ok === false ? false : null;
      const data = await api("/api/me?class=" + who.class + "&no=" + who.no);
      rec = data.student;
    }
  } else if (screen === "improve") {
    const item = visibleImprove()[impIndex];
    const uploaded = await uploadPhoto(file, "imp-" + item.id);
    pendingPhoto = uploaded.path || "";
  }
}

async function openLiveCam() {
  const attempts = [
    { audio: false, video: { facingMode: { ideal: "environment" } } },
    { audio: false, video: true },
  ];
  let last;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("沒有相機");
}

function bindPhoto() {
  const open = document.getElementById("open-cam");
  const live = document.getElementById("cam-live");
  const video = document.getElementById("cam-video");
  const snap = document.getElementById("snap");
  const close = document.getElementById("cam-close");
  if (!open || !live || !video) return;
  const shut = () => {
    stopCam();
    live.classList.add("hidden");
    open.classList.remove("hidden");
  };
  open.onclick = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      err = "請允許使用相機，直接拍攝。不用去圖片庫。";
      render();
      return;
    }
    try {
      stopCam();
      camStream = await openLiveCam();
      video.srcObject = camStream;
      await video.play();
      live.classList.remove("hidden");
      open.classList.add("hidden");
      err = "";
    } catch (e) {
      err = "請允許使用相機，直接拍攝。不用去圖片庫。";
      render();
    }
  };
  if (close) close.onclick = shut;
  if (snap) {
    snap.onclick = () => {
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(video, 0, 0, width, height);
      canvas.toBlob(async (blob) => {
        shut();
        if (!blob) return;
        const file = new File([blob], "photo.jpg", { type: "image/jpeg" });
        const step = screen === "do" ? lesson.doSteps[doIndex] : null;
        const planQ = screen === "plan" ? ((planPages()[planIndex] || {}).question) : null;
        if (shotPreview) URL.revokeObjectURL(shotPreview);
        shotPreview = URL.createObjectURL(file);
        pendingPhotoFeedback = "";
        pendingPhotoSource = "";
        photoLooking = !!((step && step.photo) || (planQ && planQ.photo));
        err = "";
        render();
        try {
          await saveShot(file);
        } catch (e) {
          err = e.message;
        }
        photoLooking = false;
        if (shotPreview) URL.revokeObjectURL(shotPreview);
        shotPreview = "";
        render();
      }, "image/jpeg", 0.85);
    };
  }
}

function firstOpenStep() {
  const index = (lesson.doSteps || []).findIndex((step) => !((rec.do || {})[step.id] && rec.do[step.id].done));
  return index < 0 ? 0 : index;
}

async function enterStudent() {
  if (entering) return;
  const classPick = document.getElementById("class-pick");
  const numPick = document.getElementById("num-pick");
  cls = classPick ? classPick.value : "";
  num = numPick ? numPick.value.trim() : "";
  confirmName = null;
  const value = parseInt(num, 10);
  if (!cls || !value || value < 1 || value > 40) {
    err = "請先選擇班別。學號由 1 至 40。";
    render();
    return;
  }
  num = String(value);
  err = "";
  entering = true;
  const button = document.getElementById("enter");
  if (button) {
    button.disabled = true;
    button.textContent = "正在進入…";
  }
  try {
    await join();
  } finally {
    entering = false;
  }
}

async function join() {
  const value = String(parseInt(num, 10));
  try {
    if (window.bikeRefresh) await window.bikeRefresh();
    const res = await fetchWithTimeout(await bikeUrl("/api/join"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class: cls, no: value }),
    }, 8000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "未能進入");
    who = { class: cls, no: value, token: data.token, name: data.student.name || "" };
    sessionStorage.setItem("bike-who", JSON.stringify(who));
    rec = data.student;
    session = data.session;
    confirmName = null;
    linkNote = "";
    const resumed = Object.keys((rec.plan && rec.plan.items) || {}).length;
    screen = (STAGES[allowedRank()] || STAGES[0]).id;
    if (screen === "plan" && !resumed) planIndex = 0;
    if (screen === "plan" && resumed && sessionStorage.getItem("bike-plan") == null) planIndex = resumePlanIndex();
    render();
  } catch (e) {
    const message = String((e && e.message) || "");
    if (/請選|學號|班別/.test(message)) {
      err = message;
      render();
      return;
    }
    enterPlanLocal(value);
  }
}

async function poll() {
  if (!who || mic || (mediaRec && mediaRec.state === "recording")) return;
  try {
    if (window.bikeRefresh) await window.bikeRefresh();
    const res = await fetchWithTimeout(await bikeUrl("/api/session"), {}, 8000);
    if (!res.ok) throw new Error("session");
    const data = await res.json();
    if (JSON.stringify(data.session) !== JSON.stringify(session)) {
      session = data.session;
      if (rank(stageOf(screen)) > allowedRank()) screen = STAGES[allowedRank()].id;
      render();
    }
    if (outbox.length || !who.token) scheduleRejoin();
  } catch (e) {
    scheduleRejoin();
  }
}

async function boot() {
  if (window.bikeReady) await window.bikeReady;
  try {
    outbox = JSON.parse(sessionStorage.getItem("bike-outbox") || "[]");
    if (!Array.isArray(outbox)) outbox = [];
  } catch (e) {
    outbox = [];
  }
  try {
    lesson = await fetch("lesson.json", { cache: "no-store" }).then((res) => res.json());
  } catch (e) {
    app.textContent = "連不到課室伺服器。請用老師開啟的網址進入。";
    return;
  }
  const saved = sessionStorage.getItem("bike-who");
  if (saved) {
    try {
      who = JSON.parse(saved);
      const data = await api("/api/me?class=" + who.class + "&no=" + who.no);
      rec = data.student;
      session = data.session;
      screen = sessionStorage.getItem("bike-screen") || "plan";
      if (sessionStorage.getItem("bike-plan") == null) planIndex = resumePlanIndex();
      else planIndex = parseInt(sessionStorage.getItem("bike-plan") || "0", 10) || 0;
      if (["login", "intro", "plan", "do", "improve", "review"].indexOf(screen) < 0) screen = "plan";
      if (screen !== "intro" && screen !== "login" && rank(stageOf(screen)) > allowedRank()) {
        screen = STAGES[allowedRank()].id;
      }
      linkNote = "";
      if (outbox.length) scheduleRejoin();
    } catch (e) {
      if (!who || !who.class || !who.no) {
        who = null;
        rec = null;
        screen = "login";
        render();
        setInterval(poll, 8000);
        return;
      }
      rec = restoreRec(who) || blankRec(who.class, who.no);
      session = { gate: "plan", selfPace: true };
      screen = sessionStorage.getItem("bike-screen") || "plan";
      if (["intro", "plan", "do", "improve", "review"].indexOf(screen) < 0) screen = "plan";
      planIndex = parseInt(sessionStorage.getItem("bike-plan") || "0", 10) || 0;
      linkNote = OFFLINE_NOTE;
      scheduleRejoin();
    }
  }
  render();
  setInterval(poll, 8000);
}

boot();
