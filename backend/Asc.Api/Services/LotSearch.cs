using System.Collections.Concurrent;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Asc.Api.Controllers;
using Asc.Api.Models;

namespace Asc.Api.Services;

/// <summary>One column filter exactly as the Catalogue Manager's filter panel holds it
/// (frontend/src/lib/lotFilters.ts ColumnFilterState): categorical | numeric | text | lot.</summary>
public sealed class ColumnFilterDto
{
    public string Kind { get; set; } = "";
    public List<string>? Values { get; set; }
    public string? Min { get; set; }
    public string? Max { get; set; }
    public string? Value { get; set; }
}

/// <summary>A search over one sale: the filter panel's state plus a window into the matches.</summary>
public sealed class LotSearchRequest
{
    public string? Search { get; set; }
    public Dictionary<string, ColumnFilterDto>? ColumnFilters { get; set; }
    public string? Status { get; set; }
    public string? Classification { get; set; }
    public string? Year { get; set; }
    public int Offset { get; set; }
    public int Limit { get; set; } = 1000;
}

public sealed class FilterOptionsRequest
{
    public List<string>? Headers { get; set; }
}

/// <summary>
/// Server-side twin of the Catalogue Manager's client filter (frontend/src/lib/lotFilters.ts filterLots), so a sale
/// can be searched where it already lives — in the backend's memory — and only the matching rows sent to the
/// browser, instead of the browser downloading the whole sale to filter it. The rules are ported one for one:
/// case-insensitive "contains" for the universal search and text filters, exact match for categorical, JavaScript
/// parseFloat semantics for numeric ranges (so "1,200" and "12abc" behave as they always did), lot = range OR picked.
/// </summary>
public static class LotSearch
{
    private static readonly Regex LeadingNumber = new(@"^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", RegexOptions.Compiled);

    /// <summary>JavaScript's parseFloat: the leading number of the string, else NaN.</summary>
    internal static double JsParseFloat(string s)
    {
        var m = LeadingNumber.Match(s);
        return m.Success && double.TryParse(m.Value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
    }

    /// <summary>Bounds on what one search may carry, so a hand-crafted request can't make the server do unbounded work.</summary>
    public static bool IsReasonable(LotSearchRequest r) =>
        (r.Search?.Length ?? 0) <= 500
        && (r.ColumnFilters?.Count ?? 0) <= 100
        && (r.ColumnFilters?.Values.All(f => (f.Values?.Count ?? 0) <= 5000
            && (f.Value?.Length ?? 0) <= 500 && (f.Min?.Length ?? 0) <= 50 && (f.Max?.Length ?? 0) <= 50) ?? true);

    /// <summary>Same test the filter panel uses to decide whether a column filter counts as set.</summary>
    internal static bool IsActive(ColumnFilterDto? f) => f is not null && f.Kind switch
    {
        "categorical" => f.Values is { Count: > 0 },
        "numeric" => !string.IsNullOrEmpty(f.Min) || !string.IsNullOrEmpty(f.Max),
        "lot" => f.Values is { Count: > 0 } || !string.IsNullOrEmpty(f.Min) || !string.IsNullOrEmpty(f.Max),
        _ => !string.IsNullOrWhiteSpace(f.Value),
    };

    /// <summary>A lot number in its comparable form: an all-digit number loses its leading zeros ("01", "001" and "1" are the
    /// same lot); anything else ("12A") is compared ignoring case. Typed lot numbers are matched this way, so the user never
    /// has to know how the sale file happens to pad them.</summary>
    internal static string NormalizeLot(string s)
    {
        var t = s.Trim();
        if (t.Length > 0 && t.All(char.IsAsciiDigit))
        {
            var stripped = t.TrimStart('0');
            return stripped.Length == 0 ? "0" : stripped;
        }
        return t.ToLowerInvariant();
    }

    // Universal search looks at every column of every lot; joining ~50 values for ~11,000 lots on every request is the bulk of a
    // search's cost. The joined text is built once per lot and kept for as long as the lot lives (a reloaded sale has new lots).
    private static readonly ConditionalWeakTable<Lot, string> SearchText = new();

    private static string SearchTextOf(Lot lot) =>
        SearchText.GetValue(lot, l => string.Join(' ', l.RawData.Values).ToLowerInvariant());

    // Option lists per loaded copy of a sale: the same lot list answers every filter-options call until the sale reloads.
    private static readonly ConditionalWeakTable<IReadOnlyList<Lot>, ConcurrentDictionary<string, List<string>?>> OptionCache = new();

    private sealed record Compiled(ColumnFilterDto Filter, string Header, HashSet<string> Picked, string TextNeedle);

    /// <summary>The lots (with the valuation that applies to each) matching the request, in the order given.</summary>
    public static List<(Lot Lot, Valuation? Val)> Filter(IEnumerable<(Lot Lot, Valuation? Val)> lots, LotSearchRequest req)
    {
        var search = (req.Search ?? "").Trim().ToLowerInvariant();
        var filters = (req.ColumnFilters ?? new())
            .Where(kv => IsActive(kv.Value))
            .Select(kv => new Compiled(
                kv.Value, kv.Key,
                kv.Value.Kind == "lot"
                    ? new HashSet<string>((kv.Value.Values ?? []).Select(NormalizeLot), StringComparer.Ordinal)
                    : new HashSet<string>(kv.Value.Values ?? [], StringComparer.Ordinal),
                (kv.Value.Value ?? "").Trim()))
            .ToList();

        return lots.Where(x => Matches(x.Lot, x.Val, req, search, filters)).ToList();
    }

    private static bool Matches(Lot lot, Valuation? val, LotSearchRequest req, string search, List<Compiled> filters)
    {
        if (search.Length > 0 && !SearchTextOf(lot).Contains(search, StringComparison.Ordinal)) return false;

        foreach (var c in filters)
        {
            var raw = lot.RawData.GetValueOrDefault(c.Header) ?? "";
            var f = c.Filter;
            switch (f.Kind)
            {
                case "categorical":
                    if (!c.Picked.Contains(raw)) return false;
                    break;
                case "numeric":
                {
                    var num = JsParseFloat(raw.Replace(",", ""));
                    if (!string.IsNullOrEmpty(f.Min) && !(num >= JsParseFloat(f.Min))) return false;
                    if (!string.IsNullOrEmpty(f.Max) && !(num <= JsParseFloat(f.Max))) return false;
                    break;
                }
                case "lot":
                {
                    var picked = c.Picked.Contains(NormalizeLot(raw));
                    var inRange = false;
                    if (!string.IsNullOrEmpty(f.Min) || !string.IsNullOrEmpty(f.Max))
                    {
                        var num = JsParseFloat(raw.Replace(",", ""));
                        inRange = !double.IsNaN(num)
                            && (string.IsNullOrEmpty(f.Min) || num >= JsParseFloat(f.Min))
                            && (string.IsNullOrEmpty(f.Max) || num <= JsParseFloat(f.Max));
                    }
                    if (!picked && !inRange) return false;
                    break;
                }
                default:
                    if (!raw.Contains(c.TextNeedle, StringComparison.OrdinalIgnoreCase)) return false;
                    break;
            }
        }

        if (!string.IsNullOrEmpty(req.Status) && LotsController.TicketStatus(val) != req.Status) return false;
        if (!string.IsNullOrEmpty(req.Classification) && (val?.Classification.ToString() ?? "Unclassified") != req.Classification) return false;
        if (!string.IsNullOrEmpty(req.Year) && (lot.SaleYear ?? "") != req.Year) return false;
        return true;
    }

    /// <summary>Distinct non-empty values of each requested column, most frequent first (ties alphabetical) — the order
    /// the filter dropdowns list them in. A column with no values, or an unreasonable number of distinct ones, is left out.</summary>
    public static Dictionary<string, List<string>> BuildOptions(IReadOnlyList<Lot> lots, IEnumerable<string> headers, int maxDistinct = 20000)
    {
        var cache = OptionCache.GetValue(lots, _ => new ConcurrentDictionary<string, List<string>?>(StringComparer.Ordinal));
        var result = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var header in headers.Distinct(StringComparer.Ordinal))
        {
            var list = cache.GetOrAdd($"{maxDistinct}|{header}", _ => OptionsFor(lots, header, maxDistinct));
            if (list is not null) result[header] = list;
        }
        return result;
    }

    private static List<string>? OptionsFor(IReadOnlyList<Lot> lots, string header, int maxDistinct)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var lot in lots)
        {
            var v = lot.RawData.GetValueOrDefault(header)?.Trim();
            if (string.IsNullOrEmpty(v)) continue;
            counts[v] = counts.GetValueOrDefault(v) + 1;
        }
        if (counts.Count == 0 || counts.Count > maxDistinct) return null;
        return counts.OrderByDescending(kv => kv.Value)
            .ThenBy(kv => kv.Key, StringComparer.CurrentCultureIgnoreCase)
            .Select(kv => kv.Key).ToList();
    }
}
