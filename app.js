"use strict";

// ==========================================
// 🎰 くじや｜抽選ツール - 画面まわり
// ==========================================
// 抽選の純粋ロジックは js/draw-core.js（KujiCore）にあり、
// このファイルは DOM の読み書きとイベント接続だけを担当する。

const Core = window.KujiCore;

// ==========================================
// 📊 状態
// ==========================================
let drawing = false;
let lastWinners = []; // 直近の当選者（表示名）
let history = []; // {winners: string[], winnerIds: string[], time: Date} 新しい順

// ==========================================
// 🧩 DOM要素
// ==========================================
const $ = (id) => document.getElementById(id);
const participantsArea = $("participantsArea");
const participantCount = $("participantCount");
const winnerCountInput = $("winnerCount");
const shuffleDisplay = $("shuffleDisplay");
const resultArea = $("resultArea");
const drawBtn = $("drawBtn");
const redrawBtn = $("redrawBtn");
const copyResultBtn = $("copyResultBtn");
const printBtn = $("printBtn");
const drawMsg = $("drawMsg");
const copyMsg = $("copyMsg");
const clearHistoryBtn = $("clearHistoryBtn");

// ==========================================
// 💾 リストと設定の自動保存（localStorage）
// ==========================================
// 💾 参加者リストと当選人数を localStorage に保存する
function saveData() {
  try {
    localStorage.setItem(
      Core.DATA_KEY,
      JSON.stringify(Core.buildSaveData(participantsArea.value, winnerCountInput.value))
    );
  } catch (e) { /* 保存できなくても利用自体は継続できる */ }
}

// 🗑️ 自動保存を消去する
function clearSavedData() {
  try { localStorage.removeItem(Core.DATA_KEY); } catch (e) { /* 同上 */ }
}

// 🔄 保存済みのリストと設定を復元する
function restoreData() {
  let raw = null;
  try { raw = localStorage.getItem(Core.DATA_KEY); } catch (e) { raw = null; }
  const plan = Core.parseSaveData(raw);
  if (!plan) return;
  if (plan.participants !== null) participantsArea.value = plan.participants;
  if (plan.winnerCount !== null) winnerCountInput.value = plan.winnerCount;
}

// ==========================================
// 👥 参加者リスト
// ==========================================
// 👥 参加者数を数えて表示する
function updateCount() {
  participantCount.textContent = String(Core.parseNames(participantsArea.value).length);
}

// ⌨️ 入力のたびに参加者数を更新して自動保存する
participantsArea.addEventListener("input", () => { updateCount(); saveData(); });
winnerCountInput.addEventListener("input", saveData);
winnerCountInput.addEventListener("change", saveData);

// 🗑️ リストをクリアする
$("clearBtn").addEventListener("click", () => {
  participantsArea.value = "";
  updateCount();
  clearSavedData(); // リストのクリアに連動して自動保存も消去する
  participantsArea.focus();
});

// 🧑‍🤝‍🧑 サンプル参加者を入れる
$("sampleBtn").addEventListener("click", () => {
  participantsArea.value = Core.SAMPLE.join("\n");
  updateCount();
  saveData();
});

// ==========================================
// 🎲 抽選
// ==========================================
// 🎲 抽選する（excludePast=true なら過去の当選者を候補から除く）
function draw(excludePast) {
  if (drawing) return;
  const entries = Core.parseEntries(participantsArea.value);
  const count = Core.parseWinnerCount(winnerCountInput.value);
  const pool = excludePast ? Core.poolExcludingPast(entries, history) : entries;

  const error = Core.drawError(entries, pool, count, excludePast);
  if (error) {
    drawMsg.textContent = error;
    return;
  }

  const winners = Core.pickWinners(pool, count);
  animateAndFinish(pool, winners);
}

// ✨ シャッフル演出をしてから当選を確定する
function animateAndFinish(pool, winners) {
  drawing = true;
  drawBtn.disabled = true;
  redrawBtn.disabled = true;
  copyResultBtn.disabled = true;
  if (printBtn) printBtn.disabled = true;
  drawMsg.textContent = "";
  copyMsg.textContent = "";
  resultArea.innerHTML = "";
  shuffleDisplay.classList.add("is-shuffling");

  const startTime = performance.now();
  const timer = setInterval(() => {
    const elapsed = performance.now() - startTime;
    if (elapsed >= Core.SHUFFLE_DURATION) {
      clearInterval(timer);
      shuffleDisplay.classList.remove("is-shuffling");
      drawing = false;
      finishDraw(winners);
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    shuffleDisplay.textContent = picked.name;
  }, Core.SHUFFLE_INTERVAL);
}

// 🎉 当選を確定して表示と履歴に反映する
function finishDraw(winnerEntries) {
  const winners = winnerEntries.map((entry) => entry.name);
  const winnerIds = winnerEntries.map((entry) => entry.id);
  lastWinners = winners.slice();
  shuffleDisplay.textContent = "🎉 当選者発表";

  const ul = document.createElement("ul");
  ul.className = "result-list";
  winners.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    ul.appendChild(li);
  });
  resultArea.innerHTML = "";
  resultArea.appendChild(ul);

  history = Core.pushHistory(history, {
    winners: winners.slice(),
    winnerIds: winnerIds.slice(),
    time: new Date(),
  });
  renderHistory();
  updateButtons();
}

// 🔘 ボタンの有効・無効を状態に合わせる
function updateButtons() {
  drawBtn.disabled = drawing;
  redrawBtn.disabled = drawing || history.length === 0;
  copyResultBtn.disabled = drawing || lastWinners.length === 0;
  if (printBtn) printBtn.disabled = drawing || lastWinners.length === 0;
  clearHistoryBtn.disabled = history.length === 0;
}

// 🎲 抽選ボタン
drawBtn.addEventListener("click", () => draw(false));
// 🔁 過去の当選者を除いて再抽選するボタン
redrawBtn.addEventListener("click", () => draw(true));

// ==========================================
// 🕘 履歴
// ==========================================
// 🕘 履歴一覧を描き直す
function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  history.forEach((h) => {
    const li = document.createElement("li");
    const winners = document.createElement("span");
    winners.className = "winners";
    winners.textContent = h.winners.join("、");
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = Core.formatHistoryTime(h.time);
    li.appendChild(winners);
    li.appendChild(time);
    list.appendChild(li);
  });
  $("historyEmpty").style.display = history.length ? "none" : "";
  updateButtons();
}

// 🗑️ 履歴をクリアする
clearHistoryBtn.addEventListener("click", () => {
  history = [];
  renderHistory();
});

// ==========================================
// 📋 結果コピー
// ==========================================
// 📋 結果をクリップボードにコピーする
copyResultBtn.addEventListener("click", async () => {
  if (lastWinners.length === 0) return;
  const text = Core.resultText(lastWinners);
  try {
    await navigator.clipboard.writeText(text);
    copyMsg.textContent = "結果をコピーしました。";
  } catch (e) {
    copyMsg.textContent = text;
  }
});

// ==========================================
// 🖨️ 結果の印刷
// ==========================================
// 🖨️ 結果を印刷する
if (printBtn) {
  printBtn.addEventListener("click", () => {
    if (lastWinners.length === 0) return;
    if (typeof window !== "undefined" && typeof window.print === "function") window.print();
  });
}

// ==========================================
// 🚀 初期化
// ==========================================
// 🚀 保存済みデータを復元して初期表示する
restoreData();
updateCount();
renderHistory();
updateButtons();

// ==========================================
// 🌙 テーマ切り替え
// ==========================================
// 🌙 テーマを切り替える（選択は localStorage に保存）
(function initTheme() {
  var root = document.documentElement;
  if (!root || !root.getAttribute || !root.setAttribute) return;
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
  }
  var current = root.getAttribute("data-theme");
  if (current !== "light" && current !== "dark") {
    try { current = localStorage.getItem(Core.THEME_KEY); } catch (e) { current = null; }
  }
  apply(current === "light" ? "light" : "dark");
  var btn = document.getElementById("themeToggle");
  if (btn && btn.addEventListener) {
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      apply(next);
      try { localStorage.setItem(Core.THEME_KEY, next); } catch (e) { /* 保存できなくても切り替え自体は有効 */ }
    });
  }
})();
