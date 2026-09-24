using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Agents;

/// <summary>What the picker wants to do with this turn: ask the next narrowing question, or hand over the sale the user chose.</summary>
public record SaleChoice(ClarifyQuestion? Ask, ArchiveScope? Chosen);

/// <summary>
/// When someone asks for "sale data" without saying which sale, the assistant narrows it down as a short dialogue:
/// first the year, then the sale number — offering only years and sales that really exist in the archive. The answer
/// then runs on exactly that sale, which is both more accurate and far cheaper than letting a model search the whole
/// archive. Plain rules (no model), so it costs no tokens and behaves the same every time.
/// </summary>
public static class SalePicker
{
    public const string YearQuestion = "Which year?";
    public const string SaleQuestionPrefix = "Which sale of ";
    public const int MaxYears = 5;
    public const int MaxSales = 8;
    public const string WhichYearOfSalePrefix = "Which year was sale ";

    private static readonly Regex Wants = new(@"\b((sale|auction)\s+(data|summary|results?|figures|report|performance|volumes?|prices?|overview)|(data|summary|results?|figures|performance|overview)\s+(of|for|from|on)\s+(a|the|that|one)?\s*(sale|auction)|how did\s+(a|the)\s+sale)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Named = new(@"(\bsale\s*#?\s*\d+|\b20\d\d\b|\blast \d+|\bthis sale\b|\bcurrent sale\b|\blatest\b|\blast sale\b|\bprevious sale\b)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SaleNoOnly = new(@"\bsale\s*#?\s*(\d{1,2})\b(?!\s*/)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex AnyYear = new(@"\b20\d\d\b", RegexOptions.Compiled);
    private static readonly Regex YearAnswer = new(@"^\s*(20\d\d)\s*$", RegexOptions.Compiled);
    private static readonly Regex SaleAnswer = new(@"^\s*sale\s*(\d+)\s*/\s*(20\d\d)\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex NameNo = new(@"sale\s*#?\s*(\d+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>The sale number in a catalogue name such as "Sale 37 - 2026", or null.</summary>
    public static int? SaleNoOf(string? sourceName) =>
        NameNo.Match(sourceName ?? "") is { Success: true } m && int.Parse(m.Groups[1].Value) is > 0 and var n ? n : null;

    /// <summary>True when this turn might belong to the picker, so the caller knows to load the list of sales.</summary>
    public static bool Involved(string message, string? lastAssistantReply) =>
        IsPickerQuestion(lastAssistantReply) || (Wants.IsMatch(message ?? "") && !Named.IsMatch(message ?? "")) || SaleNumberWithoutYear(message ?? "") is not null;

    /// <summary>The one sale number the message names without a year ("sale 32"), or null when there is none or several.</summary>
    private static int? SaleNumberWithoutYear(string text)
    {
        if (AnyYear.IsMatch(text)) return null;
        var nos = SaleNoOnly.Matches(text).Select(m => int.Parse(m.Groups[1].Value)).Distinct().ToList();
        return nos.Count == 1 && nos[0] > 0 ? nos[0] : null;
    }

    private static bool IsPickerQuestion(string? reply) =>
        reply is not null && (reply.StartsWith(YearQuestion, StringComparison.Ordinal) || reply.StartsWith(SaleQuestionPrefix, StringComparison.Ordinal) || reply.StartsWith(WhichYearOfSalePrefix, StringComparison.Ordinal));

    /// <param name="sales">Every (year, sale number) that exists in the archive; private-sale buckets (sale 0) excluded by the caller.</param>
    public static SaleChoice? Next(string message, string? lastAssistantReply, IReadOnlyCollection<(int Year, int SaleNo)> sales)
    {
        var text = message ?? "";
        if (sales.Count == 0) return null;

        if (lastAssistantReply is not null && lastAssistantReply.StartsWith(YearQuestion, StringComparison.Ordinal)
            && YearAnswer.Match(text) is { Success: true } y && int.Parse(y.Groups[1].Value) is var year && sales.Any(s => s.Year == year))
            return ForYear(year, sales);

        // "Which year was sale 32?" -> the year answers it.
        if (lastAssistantReply is not null && lastAssistantReply.StartsWith(WhichYearOfSalePrefix, StringComparison.Ordinal)
            && YearAnswer.Match(text) is { Success: true } ya && int.Parse(ya.Groups[1].Value) is var ay
            && int.TryParse(new string(lastAssistantReply[WhichYearOfSalePrefix.Length..].TakeWhile(char.IsDigit).ToArray()), out var asked) && sales.Contains((ay, asked)))
            return new SaleChoice(null, new ArchiveScope(ay, asked, ay, asked));

        if (lastAssistantReply is not null && lastAssistantReply.StartsWith(SaleQuestionPrefix, StringComparison.Ordinal)
            && SaleAnswer.Match(text) is { Success: true } m
            && (int.Parse(m.Groups[2].Value), int.Parse(m.Groups[1].Value)) is var (yr, no) && sales.Contains((yr, no)))
            return new SaleChoice(null, new ArchiveScope(yr, no, yr, no));

        // "sale 32" with no year, when several years have a sale 32: ask which.
        if (SaleNumberWithoutYear(text) is { } number)
        {
            var yearsWith = sales.Where(x => x.SaleNo == number).Select(x => x.Year).Distinct().OrderByDescending(v => v).Take(MaxYears).ToList();
            if (yearsWith.Count > 1) return new SaleChoice(new ClarifyQuestion($"{WhichYearOfSalePrefix}{number}?", [.. yearsWith.Select(v => v.ToString())]), null);
        }

        if (!Wants.IsMatch(text) || Named.IsMatch(text)) return null;

        var years = sales.Select(s => s.Year).Distinct().OrderByDescending(v => v).Take(MaxYears).ToList();
        return years.Count == 1
            ? ForYear(years[0], sales)
            : new SaleChoice(new ClarifyQuestion(YearQuestion, [.. years.Select(v => v.ToString())]), null);
    }

    private static SaleChoice ForYear(int year, IReadOnlyCollection<(int Year, int SaleNo)> sales)
    {
        var nos = sales.Where(s => s.Year == year).Select(s => s.SaleNo).Distinct().OrderByDescending(n => n).ToList();
        if (nos.Count == 1) return new SaleChoice(null, new ArchiveScope(year, nos[0], year, nos[0]));
        return new SaleChoice(new ClarifyQuestion($"{SaleQuestionPrefix}{year}?", [.. nos.Take(MaxSales).Select(n => $"Sale {n}/{year}")]), null);
    }
}

/// <summary>The same idea for a lot question: "valuation of lot 1204" with no sale to look in asks which sale's catalogue,
/// offering only the catalogues that exist. Used only when the screen sent no active sale.</summary>
public static class LotSalePicker
{
    public const string Question = "Which sale is that lot in?";
    public const int MaxCatalogues = 6;

    private static readonly Regex Lot = new(@"\blot\s*#?\s*\d+", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex NamesSale = new(@"(\bsale\s*#?\s*\d+|\b20\d\d\b|\bthis sale\b|\bcurrent sale\b|\blatest\b)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static bool Involved(string message, string? lastAssistantReply) =>
        (lastAssistantReply?.StartsWith(Question, StringComparison.Ordinal) ?? false) || (Lot.IsMatch(message ?? "") && !NamesSale.IsMatch(message ?? ""));

    /// <param name="catalogues">Known sales, newest first, as (id, display name).</param>
    public static (ClarifyQuestion? Ask, Guid? Chosen)? Next(string message, string? lastAssistantReply, IReadOnlyList<(Guid Id, string Name)> catalogues)
    {
        if (catalogues.Count == 0) return null;
        if (lastAssistantReply?.StartsWith(Question, StringComparison.Ordinal) ?? false)
        {
            var hit = catalogues.Where(c => string.Equals(c.Name, (message ?? "").Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
            if (hit.Count == 1) return (null, hit[0].Id);
        }
        if (!Lot.IsMatch(message ?? "") || NamesSale.IsMatch(message ?? "")) return null;
        if (catalogues.Count == 1) return (null, catalogues[0].Id);
        return (new ClarifyQuestion(Question, [.. catalogues.Take(MaxCatalogues).Select(c => c.Name)]), null);
    }
}
