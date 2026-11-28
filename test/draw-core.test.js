"use strict";

// ==========================================
// 🧪 くじや 抽選ロジックのテスト（node:test）
// ==========================================

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../js/draw-core.js");

// 🎲 決定的な乱数（mulberry32）で抽選を再現可能にする
function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==========================================
// 📏 定数（保存キー互換の固定）
// ==========================================
test("constants keep the storage keys and limits", () => {
  assert.equal(Core.DATA_KEY, "kujiya-data");
  assert.equal(Core.THEME_KEY, "kujiya-theme");
  assert.equal(Core.MAX_HISTORY, 50);
  assert.equal(Core.SHUFFLE_DURATION, 1800);
  assert.equal(Core.SHUFFLE_INTERVAL, 50);
  assert.deepEqual(Core.SAMPLE, ["田中", "佐藤", "鈴木", "高橋", "伊藤", "渡辺"]);
});

// ==========================================
// 👥 参加者の解析
// ==========================================
test("parseEntries ignores blank lines and trims names", () => {
  const entries = Core.parseEntries(" 田中 \n\n佐藤\n　\n鈴木");
  assert.deepEqual(entries.map((e) => e.name), ["田中", "佐藤", "鈴木"]);
});

test("parseEntries handles CRLF line endings", () => {
  const entries = Core.parseEntries("田中\r\n佐藤\r\n");
  assert.deepEqual(entries.map((e) => e.name), ["田中", "佐藤"]);
});

test("parseEntries gives duplicate names distinct occurrence ids", () => {
  const entries = Core.parseEntries("田中\n佐藤\n田中\n田中");
  assert.deepEqual(
    entries.map((e) => e.id),
    ["田中\u00000", "佐藤\u00000", "田中\u00001", "田中\u00002"]
  );
  assert.equal(new Set(entries.map((e) => e.id)).size, 4);
});

test("parseEntries of empty text is empty", () => {
  assert.deepEqual(Core.parseEntries(""), []);
  assert.deepEqual(Core.parseEntries("\n\n"), []);
});

test("parseNames returns only the names", () => {
  assert.deepEqual(Core.parseNames("田中\n田中"), ["田中", "田中"]);
});

// ==========================================
// 🎲 抽選
// ==========================================
test("pickWinners returns the requested count without duplicates", () => {
  const pool = Core.parseEntries("A\nB\nC\nD\nE\nF");
  for (let seed = 1; seed <= 40; seed++) {
    const winners = Core.pickWinners(pool, 3, seededRng(seed));
    assert.equal(winners.length, 3);
    assert.equal(new Set(winners.map((w) => w.id)).size, 3);
    winners.forEach((w) => assert.ok(pool.includes(w)));
  }
});

test("pickWinners with count = pool size returns a permutation", () => {
  const pool = Core.parseEntries("A\nB\nC\nD");
  const winners = Core.pickWinners(pool, 4, seededRng(7));
  assert.deepEqual(
    winners.map((w) => w.id).sort(),
    pool.map((w) => w.id).sort()
  );
});

test("pickWinners is deterministic for the same seed and does not mutate the pool", () => {
  const pool = Core.parseEntries("A\nB\nC\nD\nE");
  const before = pool.map((w) => w.id);
  const a = Core.pickWinners(pool, 2, seededRng(42)).map((w) => w.id);
  const b = Core.pickWinners(pool, 2, seededRng(42)).map((w) => w.id);
  assert.deepEqual(a, b);
  assert.deepEqual(pool.map((w) => w.id), before);
});

test("pickWinners can pick a duplicate-name person distinctly", () => {
  const pool = Core.parseEntries("田中\n田中");
  const winners = Core.pickWinners(pool, 2, seededRng(3));
  assert.deepEqual(winners.map((w) => w.id).sort(), ["田中\u00000", "田中\u00001"]);
});

// ==========================================
// 🚫 過去の当選者の除外
// ==========================================
test("poolExcludingPast excludes only the exact occurrence that won", () => {
  const entries = Core.parseEntries("田中\n佐藤\n田中");
  const history = [{ winners: ["田中"], winnerIds: ["田中\u00000"], time: new Date() }];
  const pool = Core.poolExcludingPast(entries, history);
  assert.deepEqual(pool.map((e) => e.id), ["佐藤\u00000", "田中\u00001"]);
});

test("pastWinnerIds collects ids across history and tolerates missing winnerIds", () => {
  const history = [
    { winners: ["A"], winnerIds: ["A\u00000"], time: new Date() },
    { winners: ["B"], time: new Date() },
    { winners: ["C"], winnerIds: ["C\u00000", "D\u00000"], time: new Date() },
  ];
  assert.deepEqual([...Core.pastWinnerIds(history)].sort(), ["A\u00000", "C\u00000", "D\u00000"]);
  assert.deepEqual([...Core.pastWinnerIds([])], []);
});

// ==========================================
// 🔢 当選人数と検証メッセージ
// ==========================================
test("parseWinnerCount follows parseInt semantics", () => {
  assert.equal(Core.parseWinnerCount("3"), 3);
  assert.equal(Core.parseWinnerCount(" 4 "), 4);
  assert.equal(Core.parseWinnerCount("2.9"), 2);
  assert.ok(Number.isNaN(Core.parseWinnerCount("")));
  assert.ok(Number.isNaN(Core.parseWinnerCount("abc")));
});

test("drawError reports empty participants first", () => {
  assert.equal(Core.drawError([], [], NaN, false), "参加者を1人以上入れてください。");
});

test("drawError reports an invalid count", () => {
  const entries = Core.parseEntries("A\nB");
  assert.equal(Core.drawError(entries, entries, NaN, false), "当選人数は1人以上で指定してください。");
  assert.equal(Core.drawError(entries, entries, 0, false), "当選人数は1人以上で指定してください。");
});

test("drawError reports an emptied pool on redraw", () => {
  const entries = Core.parseEntries("A");
  assert.equal(Core.drawError(entries, [], 1, true), "過去の当選者を除くと、候補者がいません。");
});

test("drawError reports count larger than the pool with the right wording", () => {
  const entries = Core.parseEntries("A\nB");
  assert.equal(Core.drawError(entries, entries, 3, false), "参加者（2人）より当選人数が多いです。");
  assert.equal(Core.drawError(entries, entries.slice(0, 1), 2, true), "候補者（1人）より当選人数が多いです。");
});

test("drawError returns null for a valid draw", () => {
  const entries = Core.parseEntries("A\nB\nC");
  assert.equal(Core.drawError(entries, entries, 2, false), null);
  assert.equal(Core.drawError(entries, entries.slice(0, 2), 2, true), null);
});

// ==========================================
// 🕘 履歴
// ==========================================
test("pushHistory prepends and caps at MAX_HISTORY", () => {
  let history = [];
  for (let i = 0; i < 55; i++) {
    history = Core.pushHistory(history, { winners: ["n" + i], winnerIds: [], time: new Date() });
  }
  assert.equal(history.length, 50);
  assert.equal(history[0].winners[0], "n54");
  assert.equal(history[49].winners[0], "n5");
});

test("pushHistory does not mutate the input array", () => {
  const before = [{ winners: ["A"], winnerIds: [], time: new Date() }];
  const after = Core.pushHistory(before, { winners: ["B"], winnerIds: [], time: new Date() });
  assert.equal(before.length, 1);
  assert.equal(after.length, 2);
});

test("formatHistoryTime renders month/day and hh:mm:ss", () => {
  const text = Core.formatHistoryTime(new Date(2026, 10, 28, 14, 5, 9));
  assert.match(text, /11\/28/);
  assert.match(text, /14:05:09/);
});

test("resultText joins winners with the copy prefix", () => {
  assert.equal(Core.resultText(["田中", "佐藤"]), "当選者：田中、佐藤");
  assert.equal(Core.resultText(["田中"]), "当選者：田中");
});

// ==========================================
// 💾 自動保存データの形（互換性）
// ==========================================
test("buildSaveData keeps the exact saved shape", () => {
  const data = Core.buildSaveData("田中\n佐藤", "2");
  assert.deepEqual(Object.keys(data), ["participants", "winnerCount"]);
  assert.deepEqual(data, { participants: "田中\n佐藤", winnerCount: "2" });
});

test("parseSaveData round-trips buildSaveData output", () => {
  const raw = JSON.stringify(Core.buildSaveData("田中\n佐藤", "2"));
  assert.deepEqual(Core.parseSaveData(raw), { participants: "田中\n佐藤", winnerCount: "2" });
});

test("parseSaveData accepts a numeric winnerCount from older saves", () => {
  const raw = JSON.stringify({ participants: "田中", winnerCount: 3 });
  assert.deepEqual(Core.parseSaveData(raw), { participants: "田中", winnerCount: "3" });
});

test("parseSaveData treats an empty winnerCount string as absent", () => {
  const raw = JSON.stringify({ participants: "田中", winnerCount: "" });
  assert.deepEqual(Core.parseSaveData(raw), { participants: "田中", winnerCount: null });
});

test("parseSaveData ignores non-string participants", () => {
  const raw = JSON.stringify({ participants: 5, winnerCount: "1" });
  assert.deepEqual(Core.parseSaveData(raw), { participants: null, winnerCount: "1" });
});

test("parseSaveData returns null for broken or non-object values", () => {
  assert.equal(Core.parseSaveData(null), null);
  assert.equal(Core.parseSaveData(""), null);
  assert.equal(Core.parseSaveData("{not json"), null);
  assert.equal(Core.parseSaveData("5"), null);
  assert.equal(Core.parseSaveData("\"text\""), null);
  assert.equal(Core.parseSaveData("null"), null);
});
