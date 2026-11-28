using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows.Forms;

// ==========================================
// 🎰 くじや for Windows
// ==========================================

namespace Kujiya
{
    // 🚀 アプリのエントリポイント
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new MainForm());
        }
    }

    // 👤 参加者1人分（名前＋識別子）
    internal sealed class Entry
    {
        public string Id = "";
        public string Name = "";
    }

    // 🕘 履歴1件分
    internal sealed class HistoryItem
    {
        public List<string> Winners = new List<string>();
        public List<string> WinnerIds = new List<string>();
        public DateTime Time;
    }

    // 💾 自動保存データ
    internal sealed class SaveData
    {
        public string Participants { get; set; } = "";
        public string WinnerCount { get; set; } = "";
    }

    // 🪟 メイン画面
    internal sealed class MainForm : Form
    {
        // ------------------------------------------
        // 📏 定数
        // ------------------------------------------
        private const int MaxHistory = 50;
        private const int ShuffleDuration = 1800; // Web版と同じ（ミリ秒）
        private const int ShuffleInterval = 50; // 名前が切り替わる間隔（ミリ秒）

        // 🧑‍🤝‍🧑 サンプル参加者
        private static readonly string[] Sample = { "田中", "佐藤", "鈴木", "高橋", "伊藤", "渡辺" };

        // 🎨 配色
        private static readonly Color Bg = Color.FromArgb(10, 15, 28);
        private static readonly Color Surface = Color.FromArgb(17, 26, 46);
        private static readonly Color TextColor = Color.FromArgb(236, 241, 248);
        private static readonly Color Muted = Color.FromArgb(157, 177, 199);
        private static readonly Color Accent = Color.FromArgb(106, 141, 255);

        // 🧩 画面部品
        private readonly Label countLabel;
        private readonly TextBox participantsBox;
        private readonly TextBox winnerCountBox;
        private readonly Label shuffleDisplay;
        private readonly ListBox resultList;
        private readonly Button drawBtn;
        private readonly Button redrawBtn;
        private readonly Button copyBtn;
        private readonly Button clearHistoryBtn;
        private readonly Label drawMsg;
        private readonly Label copyMsg;
        private readonly ListBox historyList;
        private readonly Label historyEmpty;
        private readonly System.Windows.Forms.Timer shuffleTimer;

        // 📊 状態
        private bool _drawing;
        private List<string> _lastWinners = new List<string>();
        private readonly List<HistoryItem> _history = new List<HistoryItem>();
        private List<Entry> _animPool = new List<Entry>();
        private List<Entry> _animWinners = new List<Entry>();
        private int _animTicks;

        public MainForm()
        {
            Text = "くじや for Windows｜抽選ツール";
            ClientSize = new Size(640, 816);
            MinimumSize = new Size(656, 855);
            BackColor = Bg;
            ForeColor = TextColor;
            Font = new Font("Yu Gothic UI", 10F);

            // 🏷️ タイトル
            var title = new Label
            {
                Text = "くじや｜抽選ツール",
                Font = new Font("Yu Gothic UI", 16F, FontStyle.Bold),
                ForeColor = TextColor,
                Location = new Point(20, 14),
                AutoSize = true
            };
            Controls.Add(title);

            // 👥 参加者数表示
            countLabel = new Label
            {
                Text = "参加者（0人）",
                Font = new Font("Yu Gothic UI", 11F, FontStyle.Bold),
                ForeColor = TextColor,
                Location = new Point(20, 54),
                AutoSize = true
            };
            Controls.Add(countLabel);

            // 📝 参加者入力欄
            participantsBox = new TextBox
            {
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                Location = new Point(20, 82),
                Size = new Size(600, 168),
                BackColor = Surface,
                ForeColor = TextColor,
                BorderStyle = BorderStyle.FixedSingle
            };
            participantsBox.TextChanged += (s, e) => { UpdateCount(); SaveDataFile(); };
            Controls.Add(participantsBox);

            var note = new Label
            {
                Text = "空行は無視されます。同名でも別々の人として扱います（同姓同名対応）。参加者リストと当選人数は自動保存され、次回開いたときに復元されます。「リストをクリア」を押すと保存も消えます。",
                ForeColor = Muted,
                Font = new Font("Yu Gothic UI", 9F),
                Location = new Point(20, 256),
                Size = new Size(600, 40)
            };
            Controls.Add(note);

            // 🔘 リスト操作ボタン
            var clearBtn = SubButton("リストをクリア", 20, 302, 150);
            clearBtn.Click += (s, e) =>
            {
                participantsBox.Text = "";
                ClearSavedData();
                participantsBox.Focus();
            };
            Controls.Add(clearBtn);

            var sampleBtn = SubButton("サンプルを入れる", 182, 302, 150);
            sampleBtn.Click += (s, e) =>
            {
                participantsBox.Text = string.Join(Environment.NewLine, Sample);
            };
            Controls.Add(sampleBtn);

            // 🔢 当選人数入力
            var countHead = new Label
            {
                Text = "当選人数",
                ForeColor = Muted,
                Location = new Point(20, 352),
                AutoSize = true
            };
            Controls.Add(countHead);
            winnerCountBox = new TextBox
            {
                Text = "1",
                Location = new Point(96, 348),
                Width = 70,
                BackColor = Surface,
                ForeColor = TextColor,
                BorderStyle = BorderStyle.FixedSingle
            };
            winnerCountBox.TextChanged += (s, e) => SaveDataFile();
            Controls.Add(winnerCountBox);
            var ninLabel = new Label
            {
                Text = "人",
                ForeColor = Muted,
                Location = new Point(172, 352),
                AutoSize = true
            };
            Controls.Add(ninLabel);

            // 🎲 抽選表示
            shuffleDisplay = new Label
            {
                Text = "参加者を入れて「抽選する」を押してね",
                Font = new Font("Yu Gothic UI", 20F, FontStyle.Bold),
                ForeColor = TextColor,
                BackColor = Surface,
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(20, 386),
                Size = new Size(600, 60)
            };
            Controls.Add(shuffleDisplay);

            // 🏆 結果表示
            resultList = new ListBox
            {
                Location = new Point(20, 454),
                Size = new Size(600, 84),
                BackColor = Surface,
                ForeColor = TextColor,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Yu Gothic UI", 12F, FontStyle.Bold)
            };
            Controls.Add(resultList);

            // 🔘 抽選・コピーボタン
            drawBtn = new Button
            {
                Text = "抽選する",
                Font = new Font("Yu Gothic UI", 11F, FontStyle.Bold),
                BackColor = Accent,
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(20, 548),
                Size = new Size(140, 36)
            };
            drawBtn.FlatAppearance.BorderSize = 0;
            drawBtn.Click += (s, e) => Draw(false);
            Controls.Add(drawBtn);

            redrawBtn = SubButton("当選者を除いて再抽選", 172, 548, 220);
            redrawBtn.Click += (s, e) => Draw(true);
            Controls.Add(redrawBtn);

            copyBtn = SubButton("結果をコピー", 404, 548, 140);
            copyBtn.Click += (s, e) => CopyResult();
            Controls.Add(copyBtn);

            // 💬 メッセージ表示
            drawMsg = new Label
            {
                Text = "",
                ForeColor = Muted,
                Location = new Point(20, 592),
                AutoSize = true
            };
            Controls.Add(drawMsg);
            copyMsg = new Label
            {
                Text = "",
                ForeColor = Muted,
                Location = new Point(300, 592),
                AutoSize = true
            };
            Controls.Add(copyMsg);

            // 🕘 履歴表示
            var historyTitle = new Label
            {
                Text = "抽選履歴",
                Font = new Font("Yu Gothic UI", 12F, FontStyle.Bold),
                ForeColor = TextColor,
                Location = new Point(20, 622),
                AutoSize = true
            };
            Controls.Add(historyTitle);

            historyEmpty = new Label
            {
                Text = "まだ履歴はありません。",
                ForeColor = Muted,
                Location = new Point(20, 652),
                AutoSize = true
            };
            Controls.Add(historyEmpty);

            historyList = new ListBox
            {
                Location = new Point(20, 650),
                Size = new Size(600, 108),
                BackColor = Surface,
                ForeColor = TextColor,
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(historyList);

            clearHistoryBtn = SubButton("履歴をクリア", 20, 766, 140);
            clearHistoryBtn.Click += (s, e) =>
            {
                _history.Clear();
                RenderHistory();
            };
            Controls.Add(clearHistoryBtn);

            // ⏱️ シャッフル演出用タイマー
            shuffleTimer = new System.Windows.Forms.Timer { Interval = ShuffleInterval };
            shuffleTimer.Tick += ShuffleTimer_Tick;

            // 🚀 復元と初期表示
            RestoreData();
            UpdateCount();
            RenderHistory();
            UpdateButtons();
        }

        // 🔘 補助ボタン（共通の見た目）を作る
        private Button SubButton(string text, int x, int y, int w)
        {
            var b = new Button
            {
                Text = text,
                BackColor = Surface,
                ForeColor = TextColor,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(x, y),
                Size = new Size(w, 36)
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        // 👥 空行は無視する。同名でも別々の人として扱い、「名前＋出現順」で一意な識別子を付ける（Web版と同じ）
        private List<Entry> ParseEntries()
        {
            var counts = new Dictionary<string, int>();
            var result = new List<Entry>();
            foreach (var line in participantsBox.Text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                var name = line.Trim();
                if (name == "") continue;
                counts.TryGetValue(name, out int occurrence);
                counts[name] = occurrence + 1;
                result.Add(new Entry { Id = name + "\0" + occurrence, Name = name });
            }
            return result;
        }

        // 👥 参加者数を数えて表示する
        private void UpdateCount()
        {
            countLabel.Text = $"参加者（{ParseEntries().Count}人）";
        }

        // 🏆 過去の当選者の識別子の集合を作る
        private HashSet<string> PastWinnerIds()
        {
            var set = new HashSet<string>();
            foreach (var h in _history)
                foreach (var id in h.WinnerIds) set.Add(id);
            return set;
        }

        // 🎲 抽選する（excludePast=true なら過去の当選者を候補から除く）
        private void Draw(bool excludePast)
        {
            if (_drawing) return;
            var entries = ParseEntries();
            bool countOk = int.TryParse(winnerCountBox.Text.Trim(), out int count);

            var pool = entries;
            if (excludePast)
            {
                var past = PastWinnerIds();
                pool = entries.FindAll(e => !past.Contains(e.Id));
            }

            if (entries.Count == 0)
            {
                drawMsg.Text = "参加者を1人以上入れてください。";
                return;
            }
            if (!countOk || count < 1)
            {
                drawMsg.Text = "当選人数は1人以上で指定してください。";
                return;
            }
            if (excludePast && pool.Count == 0)
            {
                drawMsg.Text = "過去の当選者を除くと、候補者がいません。";
                return;
            }
            if (count > pool.Count)
            {
                drawMsg.Text = excludePast
                    ? $"候補者（{pool.Count}人）より当選人数が多いです。"
                    : $"参加者（{pool.Count}人）より当選人数が多いです。";
                return;
            }

            var winners = PickWinners(pool, count);
            AnimateAndFinish(pool, winners);
        }

        // 🎲 非復元抽出する（Fisher-Yates シャッフル後に先頭から取る。Web版と同じ）
        private static List<Entry> PickWinners(List<Entry> pool, int count)
        {
            var shuffled = new List<Entry>(pool);
            for (int i = shuffled.Count - 1; i > 0; i--)
            {
                int j = RandomNumberGenerator.GetInt32(i + 1);
                (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
            }
            return shuffled.GetRange(0, count);
        }

        // ✨ シャッフル演出を開始する
        private void AnimateAndFinish(List<Entry> pool, List<Entry> winners)
        {
            _drawing = true;
            _animPool = pool;
            _animWinners = winners;
            _animTicks = 0;
            drawMsg.Text = "";
            copyMsg.Text = "";
            resultList.Items.Clear();
            UpdateButtons();
            shuffleTimer.Start();
        }

        // ⏱️ シャッフル演出の1コマ（時間切れで当選を確定する）
        private void ShuffleTimer_Tick(object? sender, EventArgs e)
        {
            _animTicks++;
            if (_animTicks * ShuffleInterval >= ShuffleDuration)
            {
                shuffleTimer.Stop();
                _drawing = false;
                FinishDraw(_animWinners);
                return;
            }
            var picked = _animPool[RandomNumberGenerator.GetInt32(_animPool.Count)];
            shuffleDisplay.Text = picked.Name;
        }

        // 🎉 当選を確定して表示と履歴に反映する
        private void FinishDraw(List<Entry> winnerEntries)
        {
            _lastWinners = winnerEntries.ConvertAll(e => e.Name);
            shuffleDisplay.Text = "🎉 当選者発表";
            resultList.Items.Clear();
            foreach (var name in _lastWinners) resultList.Items.Add(name);

            _history.Insert(0, new HistoryItem
            {
                Winners = new List<string>(_lastWinners),
                WinnerIds = winnerEntries.ConvertAll(e => e.Id),
                Time = DateTime.Now
            });
            if (_history.Count > MaxHistory) _history.RemoveRange(MaxHistory, _history.Count - MaxHistory);
            RenderHistory();
            UpdateButtons();
        }

        // 🔘 ボタンの有効・無効を状態に合わせる
        private void UpdateButtons()
        {
            drawBtn.Enabled = !_drawing;
            redrawBtn.Enabled = !_drawing && _history.Count > 0;
            copyBtn.Enabled = !_drawing && _lastWinners.Count > 0;
            clearHistoryBtn.Enabled = _history.Count > 0;
        }

        // 🕘 履歴一覧を描き直す
        private void RenderHistory()
        {
            historyList.Items.Clear();
            foreach (var h in _history)
            {
                historyList.Items.Add($"{string.Join("、", h.Winners)}　（{h.Time:M/d HH:mm:ss}）");
            }
            historyEmpty.Visible = _history.Count == 0;
            historyList.Visible = _history.Count > 0;
            UpdateButtons();
        }

        // 📋 結果をクリップボードにコピーする
        private void CopyResult()
        {
            if (_lastWinners.Count == 0) return;
            var text = "当選者：" + string.Join("、", _lastWinners);
            try
            {
                Clipboard.SetText(text);
                copyMsg.Text = "結果をコピーしました。";
            }
            catch
            {
                copyMsg.Text = text;
            }
        }

        // ==========================================
        // 💾 リストと設定の自動保存（Web版 localStorage 相当）
        // ==========================================
        private static string DataPath =>
            Path.Combine(Application.LocalUserAppDataPath, "kujiya-data.json");

        // 💾 参加者リストと当選人数をファイルに保存する
        private void SaveDataFile()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(DataPath)!);
                var data = new SaveData
                {
                    Participants = participantsBox.Text,
                    WinnerCount = winnerCountBox.Text
                };
                File.WriteAllText(DataPath, JsonSerializer.Serialize(data));
            }
            catch { /* 保存できなくても利用自体は継続できる（Web版と同じ） */ }
        }

        // 🗑️ 自動保存ファイルを消去する
        private void ClearSavedData()
        {
            try { if (File.Exists(DataPath)) File.Delete(DataPath); }
            catch { /* 同上 */ }
        }

        // 🔄 保存済みのリストと設定を復元する
        private void RestoreData()
        {
            try
            {
                if (!File.Exists(DataPath)) return;
                var data = JsonSerializer.Deserialize<SaveData>(File.ReadAllText(DataPath));
                if (data == null) return;
                // 🔄 TextChanged で保存が走るが、復元中の値は同じ内容なので問題ない
                participantsBox.Text = data.Participants ?? "";
                if (!string.IsNullOrEmpty(data.WinnerCount)) winnerCountBox.Text = data.WinnerCount;
            }
            catch { /* 復元できなくても利用自体は継続できる */ }
        }
    }
}
