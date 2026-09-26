using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Agents;

public enum IntakeTopic { None, Menu, LotMenu, BylawsMenu, Ranking, Prices, Volume, Compare, Trend, Report, SaleSummary }

/// <summary>What exists to choose from. Plain lists, so the source (archive, sale catalogues, OKLO feed) can change freely.</summary>
public record IntakeData(
    IReadOnlyCollection<(int Year, int SaleNo)> Archived,
    IReadOnlyCollection<(int Year, int SaleNo)> Catalogued,
    IReadOnlyList<string> AllGrades,
    IReadOnlyList<string> TopGrades,
    string MyBroker = "ASC");

/// <summary>What to do with this turn: say something (with or without buttons), or hand the fully-specified request to an agent.</summary>
public record IntakeOutcome(string? Lead, ClarifyQuestion? Ask, ResolvedRequest? Resolved);

/// <summary>The request after the guided questions: exactly what the user chose, ready to become tool arguments.</summary>
public record ResolvedRequest(
    IntakeTopic Topic, ArchiveScope? Scope, (int Year, int SaleNo)? CatalogueSale, string? GroupBy, string? Metric,
    IReadOnlyList<string> Grades, IReadOnlyList<string> Elevations, IReadOnlyList<string> Brokers, IReadOnlyList<string> GradeTypes,
    string? Format, IReadOnlyList<string> Assumed)
{
    public string AgentKey => CatalogueSale is not null ? "auction" : Topic == IntakeTopic.Report ? "reports" : "analytics";

    /// <summary>The request in one plain sentence tail — used instead of the button-tapping turns, so the model reads one clear request.</summary>
    public string Summary()
    {
        var parts = new List<string>();
        if (Scope is not null) parts.Add(Scope.Describe());
        if (CatalogueSale is { } c) parts.Add($"sale {c.SaleNo:00}/{c.Year} (catalogue valuations)");
        if (GroupBy is not null) parts.Add($"broken down by {GroupBy}");
        if (Metric is not null) parts.Add($"measure: {Metric}");
        if (Grades.Count > 0) parts.Add($"grade {string.Join("/", Grades)}");
        if (Elevations.Count > 0) parts.Add($"elevation {string.Join("/", Elevations)}");
        if (Brokers.Count > 0) parts.Add($"broker {string.Join("/", Brokers)}");
        if (GradeTypes.Count > 0) parts.Add(string.Join("/", GradeTypes).ToLowerInvariant());
        if (Format is not null) parts.Add($"deliver as {Format}");
        return string.Join("; ", parts);
    }

    /// <summary>One compact prompt line: what was chosen, and what was assumed (to be said in one line).</summary>
    public static string PromptLine(ResolvedRequest? r)
    {
        if (r is null) return "";
        var parts = new List<string> { $"topic={r.Topic}" };
        if (r.Scope is not null) parts.Add($"period={r.Scope.Describe()}");
        if (r.CatalogueSale is { } c) parts.Add($"sale {c.SaleNo:00}/{c.Year} (catalogue only)");
        if (r.GroupBy is not null) parts.Add($"group_by={r.GroupBy}");
        if (r.Metric is not null) parts.Add($"measure={r.Metric}");
        if (r.Grades.Count > 0) parts.Add($"grades={string.Join("/", r.Grades)}");
        if (r.Elevations.Count > 0) parts.Add($"elevations={string.Join("/", r.Elevations)}");
        if (r.Brokers.Count > 0) parts.Add($"broker={string.Join("/", r.Brokers)}");
        if (r.GradeTypes.Count > 0) parts.Add($"grade_type={string.Join("/", r.GradeTypes)}");
        if (r.Format is not null) parts.Add($"format={r.Format}");
        var line = " RESOLVED REQUEST (the user chose these through guided questions — do not ask about them again; answer exactly this): " + string.Join("; ", parts) + ".";
        if (r.CatalogueSale is not null)
            line += " That sale is not in the results archive yet: answer from its catalogue (lots and valuations) and say that valuations are estimates, not sold prices.";
        if (r.Assumed.Count > 0)
            line += $" The user let you choose: {string.Join(", ", r.Assumed)} — state these assumptions in one short line.";
        return line;
    }

    /// <summary>Fills a <c>query_data</c> call's missing measure, breakdown and filters with what the user chose, so a model that forgets cannot answer for something else.</summary>
    public static string ApplyToToolCall(string toolName, string argumentsJson, ResolvedRequest? r)
    {
        if (r is null || toolName != "query_data") return argumentsJson;
        try
        {
            var node = JsonNode.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson)?.AsObject();
            if (node is null) return argumentsJson;
            static JsonArray Arr(IEnumerable<string> v) => new(v.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
            if (node["group_by"] is null && r.GroupBy is not null) node["group_by"] = r.GroupBy;
            if (node["metric"] is null && r.Metric is not null) node["metric"] = r.Metric;
            if (node["grades"] is null && r.Grades.Count > 0) node["grades"] = Arr(r.Grades);
            if (node["elevations"] is null && r.Elevations.Count > 0) node["elevations"] = Arr(r.Elevations);
            if (node["brokers"] is null && r.Brokers.Count > 0) node["brokers"] = Arr(r.Brokers);
            if (node["grade_types"] is null && r.GradeTypes.Count > 0) node["grade_types"] = Arr(r.GradeTypes);
            return node.ToJsonString();
        }
        catch (System.Text.Json.JsonException)
        {
            return argumentsJson;
        }
    }
}

/// <summary>
/// The guided dialogue: for an open-ended request the assistant asks the few things it needs — measure, what to look at
/// (grade / elevation / broker), which period or sale, and the output format — as buttons built only from data that exists,
/// then answers exactly what was chosen. A vague opener ("prices", "report") gets a short menu. It is rules, not a model, so
/// the questions cost no tokens and behave the same every time; every question offers "You choose for me" after the first.
/// Stateless: everything is re-read from the messages of the request being clarified.
/// </summary>
public static class GuidedIntake
{
    public const int MaxAsks = 5;
    public const string YouChoose = "You choose for me";
    public const string MenuQuestion = "What would you like to do?";

    // chips whose own words look like a new request but are answers (kept out of the "is this a brand-new request?" test)
    private static readonly HashSet<string> FixedChips = new(StringComparer.OrdinalIgnoreCase)
    {
        "Check prices", "Compare brokers", "Best-selling grades", "Look up a lot", "Build a report", "Ask about the by-laws",
        "Quantity sold", "Average price", "Total value (proceeds)", "Prices by broker", "Quantity by grade", "Off-grade share by broker",
        "Best-selling grades this year", "Excel", "PDF", "PowerPoint", "On screen (chart and table)", "All tea (overall)", "One grade", "One elevation", "One broker", "Break down by grade",
        YouChoose, "Yes, show valuations", "Choose another sale", "A specific sale", "Sales over time",
    };

    // ---------- detectors
    private static readonly Regex BylawsMenu = new(@"ask about the by-?laws", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex LotMenu = new(@"^\s*look up a lot\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Multiline);
    private static readonly Regex Bylaws = new(@"\b(by-?laws?|ctta|deposit|penalt(y|ies)|prompt day|debar\w*|claims?|storage charges?|objection)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex LotOrValuation = new(@"(\blots?\s*#?\s*\d+|\bvaluations?\b|\bvalued\b|\bgardens?\b|\bliquor\b|\bcatalogue\b)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ThisSale = new(@"\b(this|current) sale\b|\btop (lots?|prices?)\b|\bhighest price\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Deictic = new(@"\b(this (chart|table|report|answer|data|result|one|graph)|that (chart|table|report|answer|one)|the (above|chart|table) |above|same (thing|data)|export (this|it)|it)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ReportWords = new(@"\b(report|deck|powerpoint|power point|pptx|slides?|presentation|excel|spreadsheet|pdf)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex TrendWords = new(@"\b(trend|trends|over time|week by week|weekly|month by month|history of|progress)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex CompareWords = new(@"\b(compare|comparison|compared|versus|vs\.?|difference between)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RankWords = new(@"\b(best|top|highest|lowest|worst|most|least|leading|biggest|largest|smallest|best[- ]?sell\w*)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SummaryWords = new(@"\b((sale|auction)\s+(data|summary|results?|figures|performance|volumes?|overview)|(data|summary|results?|figures|performance|overview)\s+(of|for|from|on)\s+(a|the|that|one)?\s*(sale|auction)|how did (a|the) sale|a specific sale)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PriceWords = new(@"\b(price|prices|rate|rates|average|avg|per kg)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex VolumeWords = new(@"\b(quantity|quantities|volume|volumes|kg|tonnage|tonnes?|sold|sell|sells|selling)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Vague = new(@"^\s*(i\s+)?(want|need|would like|wanna|like)?\s*(to see\s+|to know\s+)?(some\s+|the\s+|a\s+)?(help|data|info|information|numbers|figures|stats|statistics|analysis|analytics|reports?|prices?|tea|market|sales?|something|anything|insights?|tea prices?|market data|tea data)( please| pls)?\s*[.?!]*\s*$|^\s*show me (something|data|numbers|stats)\s*[.?!]*\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex SpecificPhrase = new(@"\b(specific|another|particular) sale\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SaleAndYear = new(@"\bsale\s*#?\s*(\d{1,3})\s*[/\-, ]\s*(20\d\d)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SaleNoOnly = new(@"\bsale\s*#?\s*(\d{1,3})\b(?!\s*[/\-]\s*20\d\d)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex BareYear = new(@"^\s*(20\d\d)\s*$", RegexOptions.Compiled);
    private static readonly Regex AnyYear = new(@"\b(20\d\d)\b", RegexOptions.Compiled);
    private static readonly Regex LastN = new(@"\blast (\d{1,2}|four|five|six|eight|ten|twelve) sales\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ThisYear = new(@"\b(this year|current year|year to date|ytd)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex LastYear = new(@"\blast year\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex LatestWords = new(@"\b(latest|most recent|last sale|newest)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PreviousWords = new(@"\bprevious sale\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex Specific = new(@"\b(one|a|an|specific|single|particular|certain)\s+(grade|elevation|broker)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex OffGrade = new(@"\boff[- ]?grades?\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex MainGrade = new(@"\bmain[- ]?grades?\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Nouns = new(@"\b(grades?|elevations?|brokers?|buyers?|marks?|factor(?:y|ies)|categor(?:y|ies))\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex OverTime = new(@"\b(over time|per sale|by sale|each sale|weekly|week by week|sales over time)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex AllTea = new(@"\b(all tea|overall|whole market|everything)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Ours = new(@"\b(we|our|ours|us|my|mine)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex MetricPrice = new(@"\b(price|prices|rate|average|avg|per kg)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex MetricQty = new(@"\b(quantity|quantities|volume|volumes|kg|tonnage|tonnes?)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex MetricValue = new(@"\b(value|proceeds|revenue|turnover|worth)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex MetricShare = new(@"\b(share|percentage|percent|proportion)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex FormatExcel = new(@"\b(excel|spreadsheet|xlsx)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex FormatPdf = new(@"\bpdf\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex FormatPpt = new(@"\b(powerpoint|power point|pptx|slides?|deck|presentation)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex FormatScreen = new(@"\b(on screen|here|chart and table)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly (Regex Re, string Code, string Label)[] BrokerTable =
    [
        (new(@"asia\s*siyaka|\basc\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "ASC", "ASC (Asia Siyaka)"),
        (new(@"forbes|\bfw\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "FW", "FW (Forbes & Walker)"),
        (new(@"bartleet|\bbc\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "BC", "BC (Bartleet)"),
        (new(@"ceylon\s*tea\s*brokers|\bct\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "CT", "CT (Ceylon Tea Brokers)"),
        (new(@"john\s*keells|keells|\bjk\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "JK", "JK (John Keells)"),
        (new(@"mercantile|\bmpb\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "MPB", "MPB (Mercantile)"),
        (new(@"eastern\s*brokers|\beb\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "EB", "EB (Eastern Brokers)"),
        (new(@"lanka\s*commodit|\blc\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "LC", "LC (Lanka Commodities)"),
    ];

    private static readonly (Regex Re, string[] Values)[] ElevationTable =
    [
        (new(@"\buva\s*high\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), ["UVA HIGH"]),
        (new(@"\bwestern\s*high\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), ["WESTERN HIGH"]),
        (new(@"\buva\s*medium\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), ["UVA MEDIUM"]),
        (new(@"\bwestern\s*medium\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), ["WESTERN MEDIUM"]),
        (new(@"\bhigh[\s-]*grown\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), ["UVA HIGH", "WESTERN HIGH"]),
        (new(@"\bmedium[\s-]*grown\b|\bmid[\s-]*grown\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), ["UVA MEDIUM", "WESTERN MEDIUM"]),
        (new(@"\blow[\s-]*grown\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), ["LOW"]),
    ];

    // ---------- the frame: what the request says so far

    private enum PeriodKind { None, Single, Year, LastN, Latest, Previous }

    private sealed class Frame
    {
        public IntakeTopic Topic;
        public PeriodKind Period; public int Year, No, N;
        public bool Specific; public int? SpecificYear; public int? PendingNo;
        public bool CatalogueConfirmed;
        public string? Dimension;             // grade | elevation | broker | buyer | mark | factory | category | sale
        public bool SplitBySale;
        public string? Metric;
        public bool SellingWord;
        public bool AllTea, AllGrades, AllElevations, AllBrokers;
        public readonly HashSet<string> WantFilter = new(StringComparer.OrdinalIgnoreCase);
        public readonly List<string> Grades = [], Elevations = [], Brokers = [], GradeTypes = [];
        public string? Format; public bool FormatChosen;
        public bool ChooseForMe;
        public int Asked;
    }

    /// <summary>The messages of the request being clarified: everything since the last real answer, or just the newest message when it starts something new.</summary>
    public static IReadOnlyList<(string Role, string Content)> OpenTurns(IReadOnlyList<(string Role, string Content, string? Provider)> prior, string current)
    {
        var all = prior.ToList();
        all.Add(("user", current, null));
        var lastAnswer = all.FindLastIndex(m => m.Role == "assistant" && m.Provider != "router");
        var open = all.Skip(lastAnswer + 1).Select(m => (m.Role, m.Content)).ToList();
        var last = current.Trim();
        var words = last.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
        var startsNew = words > 5 || (!FixedChips.Contains(last) && TopicOf(last, null) != IntakeTopic.None);
        var priorAsk = open.Count >= 3 && open[^2].Role == "assistant" && open[^2].Content.Contains("CLARIFY:", StringComparison.Ordinal);
        return startsNew || !priorAsk ? [("user", current)] : open;
    }

    /// <summary>Cheap pre-check, so the caller only loads the list of sales/grades when the guided dialogue might apply.</summary>
    public static bool Involved(IReadOnlyList<(string Role, string Content)> open) => Combined(open).Topic != IntakeTopic.None;

    private static Frame Combined(IReadOnlyList<(string Role, string Content)> open)
    {
        var f = new Frame();
        var userTexts = open.Where(m => m.Role == "user").Select(m => m.Content).ToList();
        f.Asked = open.Count(m => m.Role == "assistant" && m.Content.Contains("CLARIFY:", StringComparison.Ordinal));
        var joined = string.Join("\n", userTexts);
        f.Topic = TopicOf(joined, userTexts.FirstOrDefault());
        return f;
    }

    private static IntakeTopic TopicOf(string text, string? first)
    {
        var t = text ?? "";
        var g = first ?? t;
        if (LotMenu.IsMatch(t)) return IntakeTopic.LotMenu;
        if (BylawsMenu.IsMatch(t)) return IntakeTopic.BylawsMenu;
        if (Bylaws.IsMatch(g) || LotOrValuation.IsMatch(g) || ThisSale.IsMatch(g) || Deictic.IsMatch(g)) return IntakeTopic.None;
        var dim = Nouns.IsMatch(OffGrade.Replace(MainGrade.Replace(Specific.Replace(t, " "), " "), " "));
        var entity = dim || Ours.IsMatch(t) || BrokerTable.Any(b => b.Re.IsMatch(t)) || AnyYear.IsMatch(t) || LastN.IsMatch(t);
        if (ReportWords.IsMatch(t)) return IntakeTopic.Report;
        if (TrendWords.IsMatch(t)) return IntakeTopic.Trend;
        if (CompareWords.IsMatch(t)) return IntakeTopic.Compare;
        if (RankWords.IsMatch(t) && dim) return IntakeTopic.Ranking;
        if (SummaryWords.IsMatch(t)) return IntakeTopic.SaleSummary;
        if (PriceWords.IsMatch(t)) return IntakeTopic.Prices;
        if ((VolumeWords.IsMatch(t) || MetricShare.IsMatch(t) || OffGrade.IsMatch(t)) && entity) return IntakeTopic.Volume;
        if (Vague.IsMatch(t.Trim())) return IntakeTopic.Menu;
        return IntakeTopic.None;
    }

    private static Frame Parse(IReadOnlyList<(string Role, string Content)> open, IntakeData data)
    {
        var f = Combined(open);
        var latestYear = data.Archived.Concat(data.Catalogued).Select(s => s.Year).DefaultIfEmpty(DateTime.UtcNow.Year).Max();
        var grades = data.AllGrades.Where(g => g.Length >= 2).ToList();

        foreach (var text in open.Where(m => m.Role == "user").Select(m => m.Content))
        {
            var t = text.Trim();
            if (t.Equals(YouChoose, StringComparison.OrdinalIgnoreCase)) { f.ChooseForMe = true; continue; }

            // period
            if (Regex.IsMatch(t, @"choose another sale|another sale", RegexOptions.IgnoreCase)) { f.Period = PeriodKind.None; f.Specific = true; f.SpecificYear = null; f.CatalogueConfirmed = false; f.PendingNo = null; }
            else if (SpecificPhrase.IsMatch(t)) { f.Specific = true; f.Period = PeriodKind.None; f.SpecificYear = null; f.PendingNo = null; }

            if (SaleAndYear.Match(t) is { Success: true } sy)
            { f.Period = PeriodKind.Single; f.No = int.Parse(sy.Groups[1].Value); f.Year = int.Parse(sy.Groups[2].Value); f.Specific = false; f.PendingNo = null; f.SpecificYear = null; }
            else if (SaleNoOnly.Match(t) is { Success: true } sn && !SpecificPhrase.IsMatch(t))
            {
                var no = int.Parse(sn.Groups[1].Value);
                if (AnyYear.Match(t) is { Success: true } y1) { f.Period = PeriodKind.Single; f.No = no; f.Year = int.Parse(y1.Groups[1].Value); f.Specific = false; }
                else
                {
                    var years = data.Archived.Concat(data.Catalogued).Where(s => s.SaleNo == no).Select(s => s.Year).Distinct().ToList();
                    if (years.Count == 1) { f.Period = PeriodKind.Single; f.No = no; f.Year = years[0]; f.Specific = false; }
                    else { f.PendingNo = no; f.Period = PeriodKind.None; }
                }
            }
            else if (BareYear.Match(t) is { Success: true } by)
            {
                var yr = int.Parse(by.Groups[1].Value);
                if (f.PendingNo is { } pn) { f.Period = PeriodKind.Single; f.No = pn; f.Year = yr; f.PendingNo = null; }
                else if (f.Specific) f.SpecificYear = yr;
                else { f.Period = PeriodKind.Year; f.Year = yr; }
            }
            else if (LastN.Match(t) is { Success: true } ln) { f.Period = PeriodKind.LastN; f.N = NumberOf(ln.Groups[1].Value); f.Specific = false; }
            else if (ThisYear.IsMatch(t)) { f.Period = PeriodKind.Year; f.Year = latestYear; f.Specific = false; }
            else if (LastYear.IsMatch(t)) { f.Period = PeriodKind.Year; f.Year = latestYear - 1; f.Specific = false; }
            else if (PreviousWords.IsMatch(t)) { f.Period = PeriodKind.Previous; f.Specific = false; }
            else if (LatestWords.IsMatch(t)) { f.Period = PeriodKind.Latest; f.Specific = false; }
            else if (AnyYear.Match(t) is { Success: true } ay) { f.Period = PeriodKind.Year; f.Year = int.Parse(ay.Groups[1].Value); f.Specific = false; }

            if (Regex.IsMatch(t, @"show valuations", RegexOptions.IgnoreCase)) f.CatalogueConfirmed = true;

            // what to look at
            if (OffGrade.IsMatch(t) && !f.GradeTypes.Contains("Off Grade")) f.GradeTypes.Add("Off Grade");
            if (MainGrade.IsMatch(t) && !f.GradeTypes.Contains("Main Grade")) f.GradeTypes.Add("Main Grade");
            foreach (Match m in Specific.Matches(t)) f.WantFilter.Add(m.Groups[2].Value.ToLowerInvariant());
            var stripped = OffGrade.Replace(MainGrade.Replace(Specific.Replace(t, " "), " "), " ");
            if (f.Dimension is null && Nouns.Match(stripped) is { Success: true } nm) f.Dimension = NounToDimension(nm.Groups[1].Value);
            if (OverTime.IsMatch(t) || f.Topic == IntakeTopic.Trend) f.SplitBySale = true;
            if (AllTea.IsMatch(t) || Regex.IsMatch(t, @"^\s*all tea", RegexOptions.IgnoreCase)) f.AllTea = true;
            if (Regex.IsMatch(t, @"\ball grades\b", RegexOptions.IgnoreCase)) f.AllGrades = true;
            if (Regex.IsMatch(t, @"\ball elevations\b", RegexOptions.IgnoreCase)) f.AllElevations = true;
            if (Regex.IsMatch(t, @"\ball brokers\b", RegexOptions.IgnoreCase)) f.AllBrokers = true;

            foreach (var g in grades)
                if (Regex.IsMatch(t, $@"(?<![A-Za-z0-9]){Regex.Escape(g)}(?![A-Za-z0-9])", RegexOptions.IgnoreCase) && !f.Grades.Contains(g, StringComparer.OrdinalIgnoreCase)) f.Grades.Add(g);
            foreach (var (re, values) in ElevationTable)
                if (re.IsMatch(t)) foreach (var v in values) if (!f.Elevations.Contains(v)) f.Elevations.Add(v);
            foreach (var (re, code, _) in BrokerTable)
                if (re.IsMatch(t) && !f.Brokers.Contains(code)) f.Brokers.Add(code);
            if (Ours.IsMatch(t) && f.Brokers.Count == 0 && !string.IsNullOrEmpty(data.MyBroker)) f.Brokers.Add(data.MyBroker);

            // measure
            if (MetricShare.IsMatch(t)) f.Metric = "share_of_own_volume_pct";
            else if (MetricValue.IsMatch(t)) f.Metric = "proceeds_rs";
            else if (MetricQty.IsMatch(t)) f.Metric = "sold_quantity_kg";
            else if (MetricPrice.IsMatch(t)) f.Metric = "avg_price_rs";
            if (Regex.IsMatch(t, @"\b(sell|sells|selling|sold)\b", RegexOptions.IgnoreCase) && f.Metric is null) f.SellingWord = true;

            // output
            if (FormatExcel.IsMatch(t)) { f.Format = "excel"; f.FormatChosen = true; }
            else if (FormatPdf.IsMatch(t)) { f.Format = "pdf"; f.FormatChosen = true; }
            else if (FormatPpt.IsMatch(t)) { f.Format = "powerpoint"; f.FormatChosen = true; }
            else if (FormatScreen.IsMatch(t)) { f.Format = null; f.FormatChosen = true; }
        }
        if (f.Metric is not null) f.SellingWord = false;
        return f;
    }

    private static int NumberOf(string s) => s.ToLowerInvariant() switch { "four" => 4, "five" => 5, "six" => 6, "eight" => 8, "ten" => 10, "twelve" => 12, var n => int.TryParse(n, out var v) ? v : 4 };

    private static string NounToDimension(string noun) => noun.ToLowerInvariant() switch
    {
        var n when n.StartsWith("grade") => "grade",
        var n when n.StartsWith("elevation") => "elevation",
        var n when n.StartsWith("broker") => "broker",
        var n when n.StartsWith("buyer") => "buyer",
        var n when n.StartsWith("mark") => "mark",
        var n when n.StartsWith("factor") => "factory",
        _ => "category",
    };

    // ---------- the dialogue

    /// <summary>The next turn of the dialogue, or null when the guided dialogue doesn't apply (the normal routing then answers).</summary>
    public static IntakeOutcome? Next(IReadOnlyList<(string Role, string Content)> open, IntakeData data, bool hasScope)
    {
        var f = Parse(open, data);
        switch (f.Topic)
        {
            case IntakeTopic.None: return null;
            case IntakeTopic.LotMenu:
                return new IntakeOutcome("Type the lot number, and the sale if you know it — for example “valuation of lot 1204 in sale 39”.", null, null);
            case IntakeTopic.BylawsMenu:
                return new IntakeOutcome("Ask me about a CTTA by-law, or tap one of these.", new ClarifyQuestion("Which by-law question?",
                    ["What is the default penalty for a late buyer?", "What is the buyer's deposit and when is it due?", "When is the Buyer's Prompt Day?", "How long do I have to file a complaint?"]), null);
            case IntakeTopic.Menu:
                return new IntakeOutcome("Happy to help — pick where to start, or just type what you need.", new ClarifyQuestion(MenuQuestion,
                    ["Check prices", "Compare brokers", "Best-selling grades", "Look up a lot", "Build a report", "Ask about the by-laws"]), null);
        }

        var assumed = new List<string>();
        var defaults = f.ChooseForMe || f.Asked >= MaxAsks;
        IntakeOutcome Ask(string question, IEnumerable<string> options, string? lead = null)
        {
            var opts = options.ToList();
            if (f.Asked >= 1 && !defaults) opts.Add(YouChoose);
            return new IntakeOutcome(lead, new ClarifyQuestion(question, opts), null);
        }

        var latestArchived = data.Archived.OrderByDescending(s => s.Year).ThenByDescending(s => s.SaleNo).ToList();
        var union = data.Archived.Concat(data.Catalogued).Distinct().ToList();

        // what the request is about (a breakdown, a filter, or the whole market)
        var hasFilter = f.Grades.Count > 0 || f.Elevations.Count > 0 || f.Brokers.Count > 0 || f.AllTea || f.AllGrades || f.AllElevations || f.AllBrokers;
        var whatFor = f.Dimension is not null || hasFilter;

        // 1. topic-specific details
        if (!defaults)
        {
            switch (f.Topic)
            {
                case IntakeTopic.Ranking when f.Dimension is null:
                    return Ask("Best-selling what?", ["Grade", "Broker", "Buyer", "Mark", "Elevation"]);
                case IntakeTopic.Compare when f.Dimension is null:
                    return Ask("What should I compare?", ["Brokers", "Grades", "Elevations", "Sales over time"]);
                case IntakeTopic.Ranking or IntakeTopic.Compare or IntakeTopic.Trend when f.Metric is null:
                    return Ask("By what measure?", ["Quantity sold", "Average price", "Total value (proceeds)"], f.SellingWord ? "“Best selling” can mean volume, price or value." : null);
                case IntakeTopic.Report when f.Dimension is null && f.Metric is null:
                    return Ask("What should the report show?", ["Prices by broker", "Quantity by grade", "Off-grade share by broker", "Best-selling grades this year"]);
                case IntakeTopic.Prices or IntakeTopic.Volume when !whatFor && f.WantFilter.Count == 0:
                    return Ask("What should I look at?", ["All tea (overall)", "One grade", "One elevation", "One broker", "Break down by grade"]);
            }
            if (f.WantFilter.Contains("grade") && f.Grades.Count == 0 && !f.AllGrades)
                return Ask("Which grade?", data.TopGrades.Take(6).Append("All grades"));
            if (f.WantFilter.Contains("elevation") && f.Elevations.Count == 0 && !f.AllElevations)
                return Ask("Which elevation?", ["High grown", "Medium grown", "Low grown", "All elevations"]);
            if (f.WantFilter.Contains("broker") && f.Brokers.Count == 0 && !f.AllBrokers)
                return Ask("Which broker?", BrokerTable.OrderBy(b => b.Code == data.MyBroker ? 0 : 1).Select(b => b.Label).Append("All brokers"));
        }

        // 2. period (a chosen scope in the header already answers it)
        var needPeriod = !defaults && f.Period == PeriodKind.None && (!hasScope || f.Specific);
        if (needPeriod)
        {
            if (f.PendingNo is { } pending)
            {
                var yrs = union.Where(s => s.SaleNo == pending).Select(s => s.Year).Distinct().OrderByDescending(y => y).Take(SalePicker.MaxYears).ToList();
                if (yrs.Count == 0) return new IntakeOutcome($"I can't find a sale {pending} in the data. Pick another period.", PeriodQuestion(latestArchived, f), null);
                return Ask($"{SalePicker.WhichYearOfSalePrefix}{pending}?", yrs.Select(y => y.ToString()));
            }
            if (f.Specific)
            {
                if (f.SpecificYear is not { } sy)
                    return Ask(SalePicker.YearQuestion, union.Select(s => s.Year).Distinct().OrderByDescending(y => y).Take(SalePicker.MaxYears).Select(y => y.ToString()));
                var nos = union.Where(s => s.Year == sy).Select(s => s.SaleNo).Distinct().OrderByDescending(n => n).Take(SalePicker.MaxSales).ToList();
                if (nos.Count == 0) return Ask(SalePicker.YearQuestion, union.Select(s => s.Year).Distinct().OrderByDescending(y => y).Take(SalePicker.MaxYears).Select(y => y.ToString()), $"I have no sales for {sy}.");
                return Ask($"{SalePicker.SaleQuestionPrefix}{sy}?", nos.Select(n => $"Sale {n}/{sy}"));
            }
            var q = PeriodQuestion(latestArchived, f);
            return Ask(q.Question, q.Options);
        }

        // 3. resolve the period
        ArchiveScope? scope = null;
        (int Year, int SaleNo)? catalogueSale = null;
        if (!hasScope)
        {
            var kind = f.Period;
            if (kind == PeriodKind.None) { kind = PeriodKind.Latest; assumed.Add("the latest sale"); }
            switch (kind)
            {
                case PeriodKind.Single:
                    if (data.Archived.Contains((f.Year, f.No))) scope = new ArchiveScope(f.Year, f.No, f.Year, f.No);
                    else if (data.Catalogued.Contains((f.Year, f.No)))
                    {
                        if (!f.CatalogueConfirmed && !defaults)
                            return Ask($"Sale {f.No}/{f.Year} isn't in the results archive yet.", ["Yes, show valuations", "Choose another sale"], $"Sale {f.No}/{f.Year} has no final results yet — only its catalogue with estimated valuations. Show those instead?");
                        catalogueSale = (f.Year, f.No);
                    }
                    else return new IntakeOutcome($"I can't find sale {f.No}/{f.Year}. Pick another.", PeriodQuestion(latestArchived, f), null);
                    break;
                case PeriodKind.Year:
                    if (data.Archived.Any(s => s.Year == f.Year)) scope = new ArchiveScope(f.Year, null, f.Year, null);
                    else return new IntakeOutcome($"I have no results for {f.Year}. Pick another period.", PeriodQuestion(latestArchived, f), null);
                    break;
                case PeriodKind.LastN:
                    var take = latestArchived.Take(Math.Clamp(f.N, 1, CustomReportLogic.MaxSales)).ToList();
                    if (take.Count > 0) scope = new ArchiveScope(take.Min(s => s.Year), take.Where(s => s.Year == take.Min(x => x.Year)).Min(s => s.SaleNo), take.Max(s => s.Year), take.Where(s => s.Year == take.Max(x => x.Year)).Max(s => s.SaleNo));
                    break;
                case PeriodKind.Previous:
                    if (latestArchived.Count > 1) { var p = latestArchived[1]; scope = new ArchiveScope(p.Year, p.SaleNo, p.Year, p.SaleNo); }
                    break;
                default:
                    if (latestArchived.Count > 0) { var l = latestArchived[0]; scope = new ArchiveScope(l.Year, l.SaleNo, l.Year, l.SaleNo); }
                    else if (data.Catalogued.Count > 0) catalogueSale = data.Catalogued.OrderByDescending(s => s.Year).ThenByDescending(s => s.SaleNo).First();
                    break;
            }
        }

        // 4. output format for a report
        if (f.Topic == IntakeTopic.Report && !f.FormatChosen && !defaults)
            return Ask("Which format?", ["On screen (chart and table)", "Excel", "PDF", "PowerPoint"]);

        // nothing was asked and nothing needs to be: the normal routing answers a fully-specified request itself
        if (f.Asked == 0 && !f.ChooseForMe) return null;

        // 5. defaults for whatever is still open
        var groupBy = f.Dimension;
        var metric = f.Metric;
        if (f.SplitBySale && groupBy is null && f.Topic != IntakeTopic.Trend) groupBy = "sale";
        if (groupBy is null && !hasFilter && f.Topic is IntakeTopic.Ranking or IntakeTopic.Compare) { groupBy = f.Topic == IntakeTopic.Compare ? "broker" : "grade"; assumed.Add($"breakdown by {groupBy}"); }
        if (metric is null)
        {
            metric = f.Topic switch { IntakeTopic.Prices or IntakeTopic.Compare or IntakeTopic.Trend => "avg_price_rs", IntakeTopic.Ranking or IntakeTopic.Volume => "sold_quantity_kg", _ => null };
            if (metric is not null && f.Topic is IntakeTopic.Ranking or IntakeTopic.Compare or IntakeTopic.Trend) assumed.Add(metric == "avg_price_rs" ? "average price as the measure" : "quantity sold as the measure");
        }
        static IReadOnlyList<string> Unless(bool all, List<string> values) => all ? Array.Empty<string>() : values;
        var brokers = Unless(f.AllBrokers, f.Brokers);
        var grades2 = Unless(f.AllGrades, f.Grades);
        var elevs = Unless(f.AllElevations, f.Elevations);
        return new IntakeOutcome(null, null, new ResolvedRequest(f.Topic, scope, catalogueSale, groupBy, metric, grades2, elevs, brokers, f.GradeTypes, f.Format, assumed));
    }

    private static ClarifyQuestion PeriodQuestion(IReadOnlyList<(int Year, int SaleNo)> latestArchived, Frame f)
    {
        var options = new List<string>();
        var year = latestArchived.Count > 0 ? latestArchived[0].Year : DateTime.UtcNow.Year;
        if (f.Topic != IntakeTopic.Trend && latestArchived.Count > 0) options.Add($"Latest sale ({latestArchived[0].SaleNo}/{latestArchived[0].Year})");
        options.Add("Last 4 sales");
        options.Add("Last 12 sales");
        options.Add($"This year ({year})");
        options.Add($"Last year ({year - 1})");
        if (f.Topic != IntakeTopic.Trend) options.Add("A specific sale");
        return new ClarifyQuestion(f.Topic == IntakeTopic.Trend ? "How far back?" : "Which period?", options);
    }
}
