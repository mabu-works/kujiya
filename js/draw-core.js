"use strict";

// ==========================================
// 🎰 くじや｜抽選ツール - 抽選ロジック（DOM 非依存）
// ==========================================
// 参加者の解析・当選者抽出・履歴管理・保存データの変換を担う純粋ロジック。
// ブラウザでは window.KujiCore、Node では module.exports として読み込む。

(function (global) {
  // ==========================================
  // 📏 定数
  // ==========================================
  const MAX_HISTORY = 50; // 履歴の保持件数（メモリ内のみ）
  const SHUFFLE_DURATION = 1800; // シャッフル演出の時間（ミリ秒）
  const SHUFFLE_INTERVAL = 50; // 名前が切り替わる間隔（ミリ秒）
  const SAMPLE = ["田中", "佐藤", "鈴木", "高橋", "伊藤", "渡辺"];
  const DATA_KEY = "kujiya-data"; // 参加者リストと設定の自動保存キー
  const THEME_KEY = "kujiya-theme"; // テーマ保存キー（DATA_KEY とは別）

  // ==========================================
  // 👥 参加者リストの解析
  // ==========================================
  // 📝 入力テキストの各行を「名前＋その名前の何番目の出現か」の識別子付き
  // エントリに変換する。空行は無視し、同名でも別々の人として扱う
  // （名簿の同姓同名対応のため重複除去はしない）。
  function parseEntries(text) {
    const counts = new Map();
    const entries = [];
    String(text).split(/\r?\n/).forEach((line) => {
      const name = line.trim();
      if (name === "") return;
      const occurrence = counts.get(name) || 0;
      counts.set(name, occurrence + 1);
      entries.push({ id: name + "\u0000" + occurrence, name });
    });
    return entries;
  }

  // 📝 参加者名だけの配列を返す
  function parseNames(text) {
    return parseEntries(text).map((entry) => entry.name);
  }

  // ==========================================
  // 🎲 抽選
  // ==========================================
  // 🎲 非復元抽出する（Fisher-Yates シャッフル後に先頭から取るので重複なし）。
  // rng は 0 以上 1 未満を返す関数（テスト用に差し替え可能）。
  function pickWinners(pool, count, rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    return shuffled.slice(0, count);
  }

  // 🏆 履歴に記録された当選者の識別子の集合を作る
  // （同名の別人は別識別子なので除外されない）
  function pastWinnerIds(history) {
    const set = new Set();
    (history || []).forEach((h) => {
      (h.winnerIds || []).forEach((id) => set.add(id));
    });
    return set;
  }

  // 🚫 過去の当選者を候補から除いたプールを返す
  function poolExcludingPast(entries, history) {
    const past = pastWinnerIds(history);
    return entries.filter((entry) => !past.has(entry.id));
  }

  // 🔢 当選人数の入力値を数値化する（不正な入力は NaN）
  function parseWinnerCount(raw) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : NaN;
  }

  // ✅ 抽選前の検証。問題があれば表示用メッセージを、なければ null を返す。
  // entries は全参加者、pool は除外適用後の候補、count は当選人数。
  function drawError(entries, pool, count, excludePast) {
    if (entries.length === 0) return "参加者を1人以上入れてください。";
    if (!Number.isFinite(count) || count < 1) {
      return "当選人数は1人以上で指定してください。";
    }
    if (excludePast && pool.length === 0) {
      return "過去の当選者を除くと、候補者がいません。";
    }
    if (count > pool.length) {
      return excludePast
        ? "候補者（" + pool.length + "人）より当選人数が多いです。"
        : "参加者（" + pool.length + "人）より当選人数が多いです。";
    }
    return null;
  }

  // 📋 結果コピー用のテキストを作る
  function resultText(winners) {
    return "当選者：" + winners.join("、");
  }

  // ==========================================
  // 🕘 履歴
  // ==========================================
  // 🕘 先頭に1件追加し、上限を超えた分は古いものから切り捨てる
  function pushHistory(history, item, max) {
    const limit = typeof max === "number" ? max : MAX_HISTORY;
    const next = [item].concat(history || []);
    if (next.length > limit) next.length = limit;
    return next;
  }

  // 🕘 履歴の時刻表示（月/日 時:分:秒）
  function formatHistoryTime(date) {
    return date.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  // ==========================================
  // 💾 自動保存データ（localStorage の値の形）
  // ==========================================
  // 💾 保存する JSON オブジェクトを作る（参加者テキストと当選人数の文字列）
  function buildSaveData(participantsText, winnerCountValue) {
    return {
      participants: participantsText,
      winnerCount: winnerCountValue,
    };
  }

  // 🔄 保存済み JSON を復元プランに変換する。
  // 壊れた値や想定外の形は null（復元しない）。当選人数は文字列が基本だが、
  // 数値で保存されていた場合も文字列化して受け入れる。
  function parseSaveData(raw) {
    if (!raw) return null;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!data || typeof data !== "object") return null;
    const plan = { participants: null, winnerCount: null };
    if (typeof data.participants === "string") plan.participants = data.participants;
    if (typeof data.winnerCount === "string" && data.winnerCount !== "") {
      plan.winnerCount = data.winnerCount;
    } else if (typeof data.winnerCount === "number" && Number.isFinite(data.winnerCount)) {
      plan.winnerCount = String(data.winnerCount);
    }
    return plan;
  }

  const api = {
    MAX_HISTORY,
    SHUFFLE_DURATION,
    SHUFFLE_INTERVAL,
    SAMPLE,
    DATA_KEY,
    THEME_KEY,
    parseEntries,
    parseNames,
    pickWinners,
    pastWinnerIds,
    poolExcludingPast,
    parseWinnerCount,
    drawError,
    resultText,
    pushHistory,
    formatHistoryTime,
    buildSaveData,
    parseSaveData,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.KujiCore = api;
})(typeof window !== "undefined" ? window : globalThis);
