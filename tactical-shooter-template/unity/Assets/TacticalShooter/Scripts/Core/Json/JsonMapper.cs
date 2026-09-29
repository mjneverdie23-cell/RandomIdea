using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

namespace TacticalShooter.Core.Json
{
    /// <summary>
    /// Maps parsed JSON onto plain classes by public field name (exact match first, then
    /// case-insensitive, the same rule Unreal's FJsonObjectConverter uses). Missing fields keep
    /// their C# initialiser values; unknown JSON keys are ignored.
    /// </summary>
    public static class JsonMapper
    {
        public static T FromJson<T>(string json) => (T)ToType(MiniJson.Parse(json), typeof(T));

        public static string ToJson(object value, bool pretty = true) => MiniJson.Serialize(ToNode(value), pretty);

        /// <summary>Overwrites only the fields present in the JSON object; everything else is left as is.</summary>
        public static void Populate(object target, string json)
        {
            if (!(MiniJson.Parse(json) is Dictionary<string, object> dict)) return;
            foreach (FieldInfo f in target.GetType().GetFields(BindingFlags.Public | BindingFlags.Instance))
            {
                if (f.IsInitOnly || f.IsLiteral) continue;
                if (TryGet(dict, f.Name, out object value)) f.SetValue(target, ToType(value, f.FieldType));
            }
        }

        public static object ToType(object node, Type type)
        {
            if (node == null) return type.IsValueType ? Activator.CreateInstance(type) : null;
            if (type == typeof(object)) return node;
            if (type == typeof(string)) return node as string ?? Convert.ToString(node, CultureInfo.InvariantCulture);
            if (type == typeof(bool)) return node is bool b ? b : Convert.ToDouble(node, CultureInfo.InvariantCulture) != 0.0;
            if (type == typeof(int)) return (int)Math.Round(ToDouble(node));
            if (type == typeof(long)) return (long)Math.Round(ToDouble(node));
            if (type == typeof(uint)) return (uint)Math.Round(ToDouble(node));
            if (type == typeof(float)) return (float)ToDouble(node);
            if (type == typeof(double)) return ToDouble(node);
            if (type.IsEnum)
            {
                if (node is string es) return Enum.Parse(type, es, true);
                return Enum.ToObject(type, (int)ToDouble(node));
            }
            if (type.IsArray)
            {
                var src = node as IList ?? throw new FormatException($"expected a JSON array for {type.Name}");
                Type elem = type.GetElementType();
                Array arr = Array.CreateInstance(elem, src.Count);
                for (int i = 0; i < src.Count; i++) arr.SetValue(ToType(src[i], elem), i);
                return arr;
            }
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(List<>))
            {
                var src = node as IList ?? throw new FormatException($"expected a JSON array for {type.Name}");
                Type elem = type.GetGenericArguments()[0];
                var list = (IList)Activator.CreateInstance(type);
                foreach (object item in src) list.Add(ToType(item, elem));
                return list;
            }
            if (node is Dictionary<string, object> dict)
            {
                object obj = Activator.CreateInstance(type);
                foreach (FieldInfo f in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (f.IsInitOnly || f.IsLiteral) continue;
                    if (!TryGet(dict, f.Name, out object value)) continue;
                    f.SetValue(obj, ToType(value, f.FieldType));
                }
                return obj;
            }
            throw new FormatException($"cannot map JSON value '{node}' to {type.Name}");
        }

        static bool TryGet(Dictionary<string, object> dict, string name, out object value)
        {
            if (dict.TryGetValue(name, out value)) return true;
            foreach (var kv in dict)
            {
                if (string.Equals(kv.Key, name, StringComparison.OrdinalIgnoreCase)) { value = kv.Value; return true; }
            }
            value = null;
            return false;
        }

        static double ToDouble(object node)
        {
            switch (node)
            {
                case double d: return d;
                case bool b: return b ? 1 : 0;
                case string s: return double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
                default: return Convert.ToDouble(node, CultureInfo.InvariantCulture);
            }
        }

        static object ToNode(object value)
        {
            if (value == null) return null;
            Type t = value.GetType();
            if (value is string || value is bool || value is double || value is float || value is int || value is long || value is uint) return value;
            if (t.IsEnum) return value.ToString();
            if (value is IList list)
            {
                var outList = new List<object>(list.Count);
                foreach (object item in list) outList.Add(ToNode(item));
                return outList;
            }
            var dict = new Dictionary<string, object>();
            foreach (FieldInfo f in t.GetFields(BindingFlags.Public | BindingFlags.Instance))
            {
                if (f.IsInitOnly || f.IsLiteral) continue;
                dict[f.Name] = ToNode(f.GetValue(value));
            }
            return dict;
        }
    }
}
