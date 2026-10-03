namespace Asc.Api.Modules.Agents;

/// <summary>
/// Factory-code questions ("what is the MF code for New Baddegama") answered from the sale's lots, with no model. When the name
/// is not exact, the closest factory name is offered, so a misspelling is confirmed rather than answered wrongly.
/// </summary>
public static class FactoryLookup
{
    public static bool Asks(string question) =>
        System.Text.RegularExpressions.Regex.IsMatch(question ?? "", @"\b(mf|factory)?\s*code\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    /// <summary>The reply for a factory-code question, or null when it isn't one the index can answer.</summary>
    public static string? Reply(string question, NameIndex index, string saleLabel)
    {
        if (!Asks(question)) return null;
        var exact = index.Find(question).Where(m => m.Kinds.Contains(NameKind.Factory) && m.Code is not null).ToList();
        if (exact.Count == 1)
            return $"{exact[0].Name}'s MF code is {exact[0].Code} (from the Factory column, {saleLabel}).";
        var close = index.Suggest(question);
        return close is null
            ? $"I couldn't find a factory like that in {saleLabel}. Please check the name, or name the sale it sold in."
            : $"I couldn't find an exact match. Did you mean {close.Name}? If so, its MF code is {close.Code} (from the Factory column, {saleLabel}).";
    }
}
