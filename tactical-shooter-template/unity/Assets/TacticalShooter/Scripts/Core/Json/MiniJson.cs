using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace TacticalShooter.Core.Json
{
    /// <summary>
    /// Small, dependency-free JSON reader/writer. Objects become Dictionary&lt;string, object&gt;,
    /// arrays become List&lt;object&gt;, numbers become double. Used instead of JsonUtility so the
    /// core assembly has no engine references and behaves identically in tests and in Unity.
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string json)
        {
            if (json == null) throw new ArgumentNullException(nameof(json));
            var p = new Parser(json);
            object value = p.ParseValue();
            p.SkipWhitespace();
            if (!p.AtEnd) throw p.Error("unexpected trailing characters");
            return value;
        }

        public static string Serialize(object value, bool pretty = true)
        {
            var sb = new StringBuilder();
            Write(sb, value, pretty, 0);
            return sb.ToString();
        }

        sealed class Parser
        {
            readonly string s;
            int i;

            public Parser(string text) { s = text; }

            public bool AtEnd => i >= s.Length;

            public FormatException Error(string message)
            {
                int line = 1;
                for (int k = 0; k < i && k < s.Length; k++) if (s[k] == '\n') line++;
                return new FormatException($"JSON parse error at line {line}: {message}");
            }

            public void SkipWhitespace()
            {
                while (i < s.Length)
                {
                    char c = s[i];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { i++; continue; }
                    // Tolerate // line comments so config files can be annotated.
                    if (c == '/' && i + 1 < s.Length && s[i + 1] == '/')
                    {
                        while (i < s.Length && s[i] != '\n') i++;
                        continue;
                    }
                    break;
                }
            }

            public object ParseValue()
            {
                SkipWhitespace();
                if (AtEnd) throw Error("unexpected end of input");
                char c = s[i];
                switch (c)
                {
                    case '{': return ParseObject();
                    case '[': return ParseArray();
                    case '"': return ParseString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ParseNumber();
                        throw Error($"unexpected character '{c}'");
                }
            }

            void Expect(string word)
            {
                if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) throw Error($"expected '{word}'");
                i += word.Length;
            }

            Dictionary<string, object> ParseObject()
            {
                var obj = new Dictionary<string, object>();
                i++; // {
                SkipWhitespace();
                if (i < s.Length && s[i] == '}') { i++; return obj; }
                while (true)
                {
                    SkipWhitespace();
                    if (AtEnd || s[i] != '"') throw Error("expected a property name");
                    string key = ParseString();
                    SkipWhitespace();
                    if (AtEnd || s[i] != ':') throw Error("expected ':'");
                    i++;
                    obj[key] = ParseValue();
                    SkipWhitespace();
                    if (AtEnd) throw Error("unterminated object");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return obj; }
                    throw Error("expected ',' or '}'");
                }
            }

            List<object> ParseArray()
            {
                var list = new List<object>();
                i++; // [
                SkipWhitespace();
                if (i < s.Length && s[i] == ']') { i++; return list; }
                while (true)
                {
                    list.Add(ParseValue());
                    SkipWhitespace();
                    if (AtEnd) throw Error("unterminated array");
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return list; }
                    throw Error("expected ',' or ']'");
                }
            }

            string ParseString()
            {
                var sb = new StringBuilder();
                i++; // opening quote
                while (true)
                {
                    if (AtEnd) throw Error("unterminated string");
                    char c = s[i++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (AtEnd) throw Error("unterminated escape");
                    char e = s[i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw Error("bad unicode escape");
                            sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            i += 4;
                            break;
                        default: throw Error($"bad escape '\\{e}'");
                    }
                }
            }

            object ParseNumber()
            {
                int start = i;
                if (s[i] == '-') i++;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-')) i++;
                string text = s.Substring(start, i - start);
                if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double d))
                    throw Error($"bad number '{text}'");
                return d;
            }
        }

        static void Write(StringBuilder sb, object v, bool pretty, int indent)
        {
            switch (v)
            {
                case null: sb.Append("null"); return;
                case string str: WriteString(sb, str); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); return;
                case float f: sb.Append(((double)f).ToString("R", CultureInfo.InvariantCulture)); return;
                case int n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); return;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case uint u: sb.Append(u.ToString(CultureInfo.InvariantCulture)); return;
                case IDictionary dict:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (DictionaryEntry kv in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        NewLine(sb, pretty, indent + 1);
                        WriteString(sb, Convert.ToString(kv.Key, CultureInfo.InvariantCulture));
                        sb.Append(pretty ? ": " : ":");
                        Write(sb, kv.Value, pretty, indent + 1);
                    }
                    if (!first) NewLine(sb, pretty, indent);
                    sb.Append('}');
                    return;
                }
                case IList list:
                {
                    sb.Append('[');
                    for (int k = 0; k < list.Count; k++)
                    {
                        if (k > 0) sb.Append(',');
                        NewLine(sb, pretty, indent + 1);
                        Write(sb, list[k], pretty, indent + 1);
                    }
                    if (list.Count > 0) NewLine(sb, pretty, indent);
                    sb.Append(']');
                    return;
                }
                default:
                    if (v is IFormattable fmt) { sb.Append(fmt.ToString(null, CultureInfo.InvariantCulture)); return; }
                    WriteString(sb, v.ToString());
                    return;
            }
        }

        static void NewLine(StringBuilder sb, bool pretty, int indent)
        {
            if (!pretty) return;
            sb.Append('\n');
            sb.Append(' ', indent * 2);
        }

        static void WriteString(StringBuilder sb, string str)
        {
            sb.Append('"');
            foreach (char c in str)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
