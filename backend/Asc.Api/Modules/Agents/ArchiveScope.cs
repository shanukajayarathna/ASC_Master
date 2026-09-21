using System.Text.Json.Nodes;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// The stretch of the auction archive the user chose to look at, from the scope control in the assistant: one sale, a
/// range of sales (possibly across a year boundary), a whole year or several years. A missing sale number means "from
/// the year's first sale" / "to the year's last". No scope at all means the assistant is not restricted to any sale.
/// </summary>
public record ArchiveScope(int FromYear, int? FromSale, int ToYear, int? ToSale)
{
    public const int MaxYears = 3;

    private int FromSaleNo => FromSale ?? 1;
    private int ToSaleNo => ToSale ?? 99;

    /// <summary>Null when the scope is usable; otherwise the message to return.</summary>
    public string? Validate()
    {
        if (FromYear is < 2000 or > 2100 || ToYear is < 2000 or > 2100) return "Scope years must be between 2000 and 2100.";
        if (FromSale is < 1 or > 99 || ToSale is < 1 or > 99) return "Scope sale numbers must be between 1 and 99.";
        if (ToYear < FromYear || (ToYear == FromYear && ToSaleNo < FromSaleNo)) return "The scope must end after it starts.";
        if (ToYear - FromYear + 1 > MaxYears) return $"A scope can span at most {MaxYears} years.";
        return null;
    }

    public bool Contains(int year, int saleNo) =>
        (year > FromYear || (year == FromYear && saleNo >= FromSaleNo)) &&
        (year < ToYear || (year == ToYear && saleNo <= ToSaleNo));

    /// <summary>The scope in words, for the prompt and for the answer's own scope line.</summary>
    public string Describe()
    {
        var single = FromYear == ToYear && FromSale is not null && FromSale == ToSale;
        if (single) return $"sale {FromSale:00}/{FromYear}";
        var wholeYears = FromSale is null && ToSale is null;
        if (wholeYears) return FromYear == ToYear ? $"the whole of {FromYear}" : $"the years {FromYear}–{ToYear}";
        return $"sales {FromSaleNo:00}/{FromYear}–{ToSaleNo:00}/{ToYear}";
    }

    /// <summary>The prompt line that makes an agent stay inside the scope. Empty for no scope.</summary>
    public static string PromptLine(ArchiveScope? scope) => scope is null ? "" :
        $" The user has limited archive questions to {scope.Describe()}. Treat that as the period for every archive tool " +
        "call and every comparison unless the user explicitly names a different one, and say the period in your answer. " +
        "(Questions about lots in the current catalogue still use the sale selected in the app.)";

    /// <summary>Puts the scope into a <c>query_data</c> call that named no period of its own — deterministically, so a
    /// model that forgets the scope cannot silently answer for the wrong sales. Other tools and explicit periods pass through.</summary>
    public static string ApplyToToolCall(string toolName, string argumentsJson, ArchiveScope? scope)
    {
        if (scope is null || toolName != "query_data") return argumentsJson;
        try
        {
            var node = JsonNode.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson)?.AsObject();
            if (node is null) return argumentsJson;
            var namesPeriod = node["years"] is not null || node["sale_nos"] is not null || node["last_n_sales"] is not null || node["from_year"] is not null;
            if (namesPeriod) return argumentsJson;
            node["from_year"] = scope.FromYear;
            node["to_year"] = scope.ToYear;
            if (scope.FromSale is { } f) node["from_sale"] = f;
            if (scope.ToSale is { } t) node["to_sale"] = t;
            return node.ToJsonString();
        }
        catch (System.Text.Json.JsonException)
        {
            return argumentsJson; // malformed arguments flow through; the tool reports them back to the model
        }
    }

    /// <summary>The scope as tool arguments (used by the report preview), or nothing.</summary>
    public void AddTo(JsonObject args)
    {
        args["from_year"] = FromYear;
        args["to_year"] = ToYear;
        if (FromSale is { } f) args["from_sale"] = f;
        if (ToSale is { } t) args["to_sale"] = t;
    }
}
