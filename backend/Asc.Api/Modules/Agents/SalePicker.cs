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

    private static readonly Regex Wants = new(@"\b((sale|auction)\s+(data|summary|results?|figures|report|performance|volumes?|prices?|overview)|(data|summary|results?|figures|performance|overview)\s+(of|for|from|on)\s+(a|the|that|one)?\s*(sale|auction)|how did\s+(a|the)\s+sale)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Named = new(@"(\bsale\s*#?\s*\d+|\b20\d\d\b|\blast \d+|\bthis sale\b|\bcurrent sale\b|\blatest\b|\blast sale\b|\bprevious sale\b)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex YearAnswer = new(@"^\s*(20\d\d)\s*$", RegexOptions.Compiled);
    private static readonly Regex SaleAnswer = new(@"^\s*sale\s*(\d+)\s*/\s*(20\d\d)\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>True when this turn might belong to the picker, so the caller knows to load the list of sales.</summary>
    public static bool Involved(string message, string? lastAssistantReply) =>
        IsPickerQuestion(lastAssistantReply) || (Wants.IsMatch(message ?? "") && !Named.IsMatch(message ?? ""));

    private static bool IsPickerQuestion(string? reply) =>
        reply is not null && (reply.StartsWith(YearQuestion, StringComparison.Ordinal) || reply.StartsWith(SaleQuestionPrefix, StringComparison.Ordinal));

    /// <param name="sales">Every (year, sale number) that exists in the archive; private-sale buckets (sale 0) excluded by the caller.</param>
    public static SaleChoice? Next(string message, string? lastAssistantReply, IReadOnlyCollection<(int Year, int SaleNo)> sales)
    {
        var text = message ?? "";
        if (sales.Count == 0) return null;

        if (lastAssistantReply is not null && lastAssistantReply.StartsWith(YearQuestion, StringComparison.Ordinal)
            && YearAnswer.Match(text) is { Success: true } y && int.Parse(y.Groups[1].Value) is var year && sales.Any(s => s.Year == year))
            return ForYear(year, sales);

        if (lastAssistantReply is not null && lastAssistantReply.StartsWith(SaleQuestionPrefix, StringComparison.Ordinal)
            && SaleAnswer.Match(text) is { Success: true } m
            && (int.Parse(m.Groups[2].Value), int.Parse(m.Groups[1].Value)) is var (yr, no) && sales.Contains((yr, no)))
            return new SaleChoice(null, new ArchiveScope(yr, no, yr, no));

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
