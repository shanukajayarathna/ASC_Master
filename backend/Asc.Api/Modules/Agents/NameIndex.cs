using System.Text.RegularExpressions;
using Asc.Api.Models;

namespace Asc.Api.Modules.Agents;

public enum NameKind { Factory, Mark, Buyer }

/// <summary>What a name in a question was found to be: one kind (use it) or several (ask the user which).</summary>
public record NameMatch(string Name, IReadOnlyList<NameKind> Kinds, string? Code = null);

/// <summary>
/// Which names a sale knows, and in which column: factory (FactoryName), mark (Mark / SellingMark) and buyer (BuyerName).
/// Built from one sale's lots, so a name in a question can be checked against real values. Pure: the lots are passed in.
/// </summary>
public sealed class NameIndex
{
    private readonly Dictionary<string, (string Display, HashSet<NameKind> Kinds, string? Code)> _names = new(StringComparer.OrdinalIgnoreCase);

    public static NameIndex From(IEnumerable<Lot> lots)
    {
        var index = new NameIndex();
        foreach (var lot in lots)
        {
            index.Add(lot.FactoryName, NameKind.Factory, lot.Factory);
            index.Add(lot.Factory, NameKind.Factory, lot.Factory, lot.FactoryName);
            index.Add(lot.Mark, NameKind.Mark);
            index.Add(lot.SellingMark, NameKind.Mark);
            index.Add(lot.BuyerName, NameKind.Buyer);
        }
        return index;
    }

    private void Add(string? value, NameKind kind, string? code = null, string? display = null)
    {
        var name = Normalise(value);
        if (name.Length < 3) return;
        if (!_names.TryGetValue(name, out var entry)) _names[name] = entry = (display ?? value!.Trim(), [], code);
        entry.Kinds.Add(kind);
    }

    public static string Normalise(string? value) => Regex.Replace((value ?? "").Trim().ToLowerInvariant(), @"\s+", " ");

    /// <summary>Names that appear in the question, longest first, so "New Baddegama" wins over "Baddegama".</summary>
    public IReadOnlyList<NameMatch> Find(string question)
    {
        var words = Regex.Split(Normalise(question).Replace("?", " ").Replace(",", " ").Replace(".", " "), @"\s+").Where(w => w.Length > 0).ToArray();
        var found = new List<NameMatch>();
        var covered = new bool[words.Length];
        for (var size = 4; size >= 1; size--)
            for (var i = 0; i + size <= words.Length; i++)
            {
                if (Enumerable.Range(i, size).Any(k => covered[k])) continue;
                var phrase = string.Join(' ', words[i..(i + size)]);
                if (!_names.TryGetValue(phrase, out var entry)) continue;
                found.Add(new NameMatch(entry.Display, [.. entry.Kinds.OrderBy(k => k)], entry.Code));
                for (var k = i; k < i + size; k++) covered[k] = true;
            }
        return found;
    }
}
