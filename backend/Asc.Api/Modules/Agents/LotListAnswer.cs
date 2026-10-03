using System.Globalization;
using System.Text.RegularExpressions;
using Asc.Api.Models;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// Lot-list questions ("give me the ASC lots of New Baddegama", "lots of grade BOPF in sale 41", "all High and Medium lots") are
/// answered with a table built on the server from the sale's lots, never by the model, so every row is exact. The table is a
/// markdown table, so the chat's own "Download as Excel" bar exports it as is. Brokers, grades, elevations, categories and
/// factory / mark / buyer names in the question are combined as filters; with none, there is no list to make.
/// </summary>
public static class LotListAnswer
{
    public const int MaxRows = 200;
    private static readonly string[] Brokers = ["ASC", "BC", "CT", "EB", "FW", "JK", "LC", "MPB"];
    private static readonly Regex ListWords = new(@"\b(lots?|list|give me|show me|all|every)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool Asks(string question) => ListWords.IsMatch(question ?? "");

    private static bool Mentions(string question, string term) =>
        Regex.IsMatch(question, $@"(?<![A-Za-z0-9]){Regex.Escape(term)}(?![A-Za-z0-9])", RegexOptions.IgnoreCase);

    /// <summary>The reply with the matching lots, or null when the question asks for no list or names nothing the sale has.</summary>
    public static string? Reply(string question, IReadOnlyList<Lot> lots, NameIndex index, string saleLabel)
    {
        if (!Asks(question)) return null;
        var q = question ?? "";

        var brokers = Brokers.Where(b => Mentions(q, b)).ToList();
        var grades = lots.Select(l => l.Grade).Where(g => !string.IsNullOrWhiteSpace(g)).Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(g => Mentions(q, g!)).ToList();
        var categories = lots.Select(l => l.Category).Where(c => !string.IsNullOrWhiteSpace(c)).Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(c => Mentions(q, c!)).ToList();
        var elevations = lots.Select(l => l.Elevation).Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(e => Mentions(q, e!)).ToList();
        var names = index.Find(q).Where(n => n.Kinds.Count == 1).ToList();
        if (brokers.Count + grades.Count + categories.Count + elevations.Count + names.Count == 0) return null;

        var rows = lots.Where(l =>
                (brokers.Count == 0 || brokers.Contains(l.Broker ?? "", StringComparer.OrdinalIgnoreCase)) &&
                (grades.Count == 0 || grades.Contains(l.Grade ?? "", StringComparer.OrdinalIgnoreCase)) &&
                (categories.Count == 0 || categories.Contains(l.Category ?? "", StringComparer.OrdinalIgnoreCase)) &&
                (elevations.Count == 0 || elevations.Contains(l.Elevation ?? "", StringComparer.OrdinalIgnoreCase)) &&
                names.All(n => Matches(l, n)))
            .OrderBy(l => l.Broker, StringComparer.Ordinal).ThenBy(l => l.LotNumber, StringComparer.Ordinal).ToList();

        var described = brokers.Concat(grades).Concat(categories).Concat(elevations).Concat(names.Select(n => n.Name)).ToList();
        var label = string.Join(", ", described);
        if (rows.Count == 0) return $"No lots for {label} in {saleLabel}.";

        var lines = new List<string>
        {
            $"{rows.Count} lot{(rows.Count == 1 ? "" : "s")} for {label} in {saleLabel}.",
            "",
            "| Broker | Lot | Grade | Elevation | Category | Selling Mark | Factory | Bags | Net kg | Status |",
            "|---|---|---|---|---|---|---|---|---|---|",
        };
        foreach (var r in rows.Take(MaxRows))
            lines.Add($"| {Cell(r.Broker)} | {Cell(r.LotNumber)} | {Cell(r.Grade)} | {Cell(r.Elevation)} | {Cell(r.Category)} | {Cell(r.SellingMark)} | {Cell(r.FactoryName)} ({Cell(r.Factory)}) | {r.Bags?.ToString(CultureInfo.InvariantCulture) ?? "–"} | {(r.NetWeight is { } w ? w.ToString("N0", CultureInfo.InvariantCulture) : "–")} | {Cell(r.Status)} |");
        if (rows.Count > MaxRows) lines.Add($"\nShowing the first {MaxRows} of {rows.Count} lots.");
        lines.Add("");
        lines.Add($"Scope: {saleLabel} · the lots in the catalogue (status as the catalogue shows it).");
        return string.Join("\n", lines);
    }

    private static bool Matches(Lot l, NameMatch n)
    {
        var target = NameIndex.Normalise(n.Name);
        return n.Kinds[0] switch
        {
            NameKind.Factory => NameIndex.Normalise(l.FactoryName) == target || (n.Code is not null && string.Equals(l.Factory, n.Code, StringComparison.OrdinalIgnoreCase)),
            NameKind.Mark => NameIndex.Normalise(l.Mark) == target || NameIndex.Normalise(l.SellingMark) == target,
            _ => NameIndex.Normalise(l.BuyerName) == target,
        };
    }

    private static string Cell(string? v) => string.IsNullOrWhiteSpace(v) ? "–" : v.Replace("|", "/").Trim();
}
