using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;
using UnityEngine.UI;

namespace TacticalShooter.UI
{
    /// <summary>Two team tables (yours first): name, agent, K/D/A, score, money (your team only), ult.</summary>
    public sealed class ScoreTable
    {
        readonly RectTransform root;
        readonly List<Text[]> rows = new List<Text[]>();
        readonly List<Image> rowBacks = new List<Image>();
        readonly Text[] headers = new Text[2];
        static readonly float[] Columns = { 330f, 170f, 80f, 80f, 80f, 100f, 130f, 90f };

        public ScoreTable(RectTransform root)
        {
            this.root = root;
            UIFactory.VBox(root, 4f, 0);
            for (int team = 0; team < 2; team++)
            {
                headers[team] = UIFactory.Label(root, "", 26, TextAnchor.MiddleLeft, UIFactory.TextColor, FontStyle.Bold);
                UIFactory.Size(headers[team], -1f, 44f);
                var head = UIFactory.Row(root, 30f, 0f);
                string[] titles = { "PLAYER", "AGENT", "K", "D", "A", "SCORE", "MONEY", "ULT" };
                for (int c = 0; c < titles.Length; c++)
                    UIFactory.Size(UIFactory.Label(head, titles[c], 17, c == 0 ? TextAnchor.MiddleLeft : TextAnchor.MiddleCenter, UIFactory.TextDim), Columns[c], -1f);
                for (int i = 0; i < 5; i++)
                {
                    var back = UIFactory.Image(root, "Row", new Color(1f, 1f, 1f, 0.05f));
                    UIFactory.Size(back, -1f, 40f);
                    UIFactory.HBox(back, 0f, 0);
                    var cells = new Text[Columns.Length];
                    for (int c = 0; c < Columns.Length; c++)
                    {
                        cells[c] = UIFactory.Label(back.transform, "", 20, c == 0 ? TextAnchor.MiddleLeft : TextAnchor.MiddleCenter);
                        UIFactory.Size(cells[c], Columns[c], -1f);
                    }
                    rows.Add(cells);
                    rowBacks.Add(back);
                }
            }
        }

        public void Refresh()
        {
            var m = Game.Match;
            if (m == null || m.Flow == null || m.Local == null) return;
            var mine = m.Local.team;
            var order = new[] { mine, Ids.Other(mine) };
            for (int t = 0; t < 2; t++)
            {
                var team = order[t];
                var side = m.Flow.SideOf(team);
                headers[t].text = $"{(team == mine ? "YOUR TEAM" : "ENEMY TEAM")}  -  {(side == Side.Attack ? "ATTACK" : "DEFENSE")}  -  {m.Flow.Score[(int)team]}";
                headers[t].color = Prims.ToColor(side == Side.Attack ? Game.Data.Game.visuals.attackColor : Game.Data.Game.visuals.defenseColor);
                var players = m.Players.FindAll(p => p.team == team);
                players.Sort((a, b) => b.score != a.score ? b.score.CompareTo(a.score) : b.kills.CompareTo(a.kills));
                for (int i = 0; i < 5; i++)
                {
                    int r = t * 5 + i;
                    bool used = i < players.Count;
                    rowBacks[r].gameObject.SetActive(used);
                    if (!used) continue;
                    var p = players[i];
                    var agent = Game.Data.Agent(p.agentId);
                    var cells = rows[r];
                    cells[0].text = (p.isLocal ? "> " : "") + p.name + (p.isBot ? "  <size=14>BOT</size>" : "");
                    cells[1].text = agent?.displayName ?? p.agentId;
                    cells[2].text = p.kills.ToString();
                    cells[3].text = p.deaths.ToString();
                    cells[4].text = p.assists.ToString();
                    cells[5].text = p.score.ToString();
                    cells[6].text = team == mine ? "$" + p.money : "";
                    int ult = PlayerRecord.UltCost(agent);
                    cells[7].text = ult > 0 ? p.ultPoints + "/" + ult : "-";
                    Color c = p.alive || m.Flow.Phase != MatchPhase.Live ? UIFactory.TextColor : new Color(0.5f, 0.5f, 0.5f);
                    foreach (var cell in cells) cell.color = c;
                    rowBacks[r].color = p.isLocal ? new Color(1f, 0.28f, 0.34f, 0.18f) : new Color(1f, 1f, 1f, 0.05f);
                }
            }
        }
    }

    public sealed class ScoreboardScreen : UIScreen
    {
        readonly ScoreTable table;
        readonly Text title;

        public ScoreboardScreen(RectTransform canvas)
        {
            Root = FullScreen(canvas, "Scoreboard");
            var panel = UIFactory.Image(Root, "Panel", UIFactory.PanelColor);
            UIFactory.Place(panel.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1200f, 740f));
            UIFactory.VBox(panel, 10f, 30);
            title = UIFactory.Label(panel.transform, "", 22, TextAnchor.MiddleCenter, UIFactory.TextDim);
            UIFactory.Size(title, -1f, 36f);
            var tableRoot = UIFactory.Rect("Table", panel.transform);
            UIFactory.Size(tableRoot, -1f, 620f);
            table = new ScoreTable(tableRoot);
        }

        public override void Tick()
        {
            var m = Game.Match;
            if (m?.Flow == null) return;
            var map = Game.World?.Def;
            title.text = $"{map?.displayName ?? ""}  -  ROUND {m.Flow.Round}  -  FIRST TO {m.Options.roundsToWin}" + (m.Flow.InOvertime ? "  -  OVERTIME" : "");
            table.Refresh();
        }
    }

    /// <summary>The buy menu: one column per item group. Left click buys, right click sells back.</summary>
    public sealed class BuyScreen : UIScreen
    {
        struct Entry
        {
            public ShopItem item;
            public Button button;
            public Text label;
        }

        readonly RectTransform columns;
        readonly Text money;
        readonly Text hint;
        readonly List<Entry> entries = new List<Entry>();
        string builtForAgent;

        public BuyScreen(RectTransform canvas)
        {
            Root = FullScreen(canvas, "Buy", new Color(0f, 0f, 0f, 0.45f));
            var panel = UIFactory.Image(Root, "Panel", UIFactory.PanelColor, true);
            UIFactory.Place(panel.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1760f, 820f));
            UIFactory.VBox(panel, 14f, 30);
            var head = UIFactory.Row(panel.transform, 60f, 30f);
            UIFactory.Size(UIFactory.Label(head, "BUY", 44, TextAnchor.MiddleLeft, UIFactory.TextColor, FontStyle.Bold), 160f, -1f);
            money = UIFactory.Label(head, "", 36, TextAnchor.MiddleLeft, UIFactory.Good, FontStyle.Bold);
            UIFactory.Size(money, 300f, -1f);
            hint = UIFactory.Label(head, "", 20, TextAnchor.MiddleRight, UIFactory.TextDim);
            UIFactory.Size(hint, 1200f, -1f);
            columns = UIFactory.Rect("Columns", panel.transform);
            UIFactory.Size(columns, -1f, 680f);
            var h = UIFactory.HBox(columns, 14f);
            h.childForceExpandHeight = true;
            h.childAlignment = TextAnchor.UpperLeft;
        }

        public override void Refresh()
        {
            var local = Game.Match.Local;
            if (local == null || builtForAgent == local.agentId) return;
            builtForAgent = local.agentId;
            UIFactory.Clear(columns);
            entries.Clear();
            var agent = Game.Data.Agent(local.agentId);
            var catalog = ShopRules.Catalog(Game.Data, agent);
            foreach (string group in ShopRules.GroupOrder)
            {
                var items = catalog.FindAll(i => i.group == group);
                if (items.Count == 0) continue;
                var col = UIFactory.Rect(group, columns);
                UIFactory.Size(col, 232f, -1f);
                var v = UIFactory.VBox(col, 8f, 0);
                v.childAlignment = TextAnchor.UpperLeft;
                UIFactory.Size(UIFactory.Label(col, group.ToUpperInvariant(), 20, TextAnchor.MiddleLeft, UIFactory.TextDim, FontStyle.Bold), -1f, 36f);
                foreach (var item in items)
                {
                    var it = item;
                    var b = UIFactory.Button(col, "", () => Game.Match.TryBuy(Game.Match.Local, it.id), 19);
                    UIFactory.Size(b, -1f, 78f);
                    var relay = b.gameObject.AddComponent<ClickRelay>();
                    relay.OnRightClick = () => Game.Match.TrySell(Game.Match.Local, it.id);
                    var label = b.GetComponentInChildren<Text>();
                    label.supportRichText = true;
                    entries.Add(new Entry { item = it, button = b, label = label });
                }
            }
        }

        public override void Tick()
        {
            var m = Game.Match;
            var p = m.Local;
            if (p == null) return;
            money.text = "$" + p.money;
            var agent = Game.Data.Agent(p.agentId);
            var side = m.SideOf(p);
            hint.text = $"Left click: buy   Right click: sell back (buy phase only)   {KeyNames.Label(Game.Keys.Key("BuyMenu"))}/Esc: close   Buy time left: {Mathf.CeilToInt(BuyTimeLeft(m))}s";
            foreach (var e in entries)
            {
                var item = e.item;
                var result = ShopRules.Check(Game.Data, agent, side, p.loadout, p.money, item.id);
                bool owned = Owned(p.loadout, item);
                string price = item.forSale ? "$" + item.price : (item.kind == ItemKind.Ability ? "not for sale" : "");
                string extra = item.kind == ItemKind.Ability ? $"  [{p.loadout.abilityCharges[item.abilitySlot]}/{item.maxCharges}]" : "";
                string slotKey = item.kind == ItemKind.Ability ? "<b>" + agent.abilities[item.abilitySlot].slot + "</b>  " : "";
                e.label.text = $"{slotKey}{item.displayName}{extra}\n<size=17><color=#{(result == ShopResult.Ok ? "7CFFA8" : "9AA4AE")}>{price}</color></size>";
                e.button.interactable = result == ShopResult.Ok || ShopRules.CanSell(p.loadout, item.id);
                UIFactory.SetColor(e.button, owned ? new Color(0.25f, 0.45f, 0.35f, 1f) : UIFactory.ButtonColor);
            }
        }

        static float BuyTimeLeft(MatchController m)
        {
            var f = m.Flow;
            if (f.Phase == MatchPhase.BuyPhase) return f.PhaseTimeLeft + Game.Data.Game.round.buyGraceSeconds;
            return Mathf.Max(0f, Game.Data.Game.round.buyGraceSeconds - f.LiveElapsed);
        }

        static bool Owned(Loadout lo, ShopItem item)
        {
            switch (item.kind)
            {
                case ItemKind.Weapon: return lo.primaryId == item.id || lo.secondaryId == item.id;
                case ItemKind.Armor: return Game.Data.EquipmentItem(item.id)?.amount == lo.armor && lo.armor > 0;
                case ItemKind.DefuseKit: return lo.hasDefuseKit;
                default: return lo.abilityCharges[item.abilitySlot] > 0;
            }
        }
    }
}
