namespace Asc.Api.Modules.Agents;

/// <summary>Short instructions every agent shares, so answers look the same whichever agent gave them and the model knows where each kind of figure comes from.</summary>
public static class AgentGuidance
{
    /// <summary>Where the data comes from — the sale files were replaced by the OKLO live feed.</summary>
    public const string DataSources =
        " DATA SOURCES: (1) the MSL auction archive — settled results of every public auction and private sale since 2013 up to the last imported sale: " +
        "quantities, prices, proceeds by broker, grade, elevation, buyer and mark (Analytics tools, query_data); " +
        "(2) the sale catalogues — the current and recent sales' lots with ASC's estimated valuations, pulled live from the OKLO SmartAuction system (Auction tools); a sale " +
        "that is still open or newer than the archive has catalogue data only, so its figures are valuations, not sold prices; " +
        "(3) the Sri Lanka Tea Board — official monthly national averages (get_teaboard_averages); " +
        "(3b) the monthly Factory Wise Averages — every factory's quantity and Rs/kg by elevation, main vs off grade, with rank, January 2023 onward (get_factory_averages, factory_history); " +
        "(4) the CTTA By-Laws (get_ctta_bylaws). Say which source a figure came from, and never mix sold prices with valuations.";

    /// <summary>How an answer is shaped: answer first, then the evidence, then the scope, then a way forward.</summary>
    public const string AnswerStyle =
        " ANSWER STYLE: start with the answer in one plain sentence (the number or name the user asked for). Then, only if it helps, one compact table (at most 8 rows) " +
        "or the chart placeholder. Then one line: 'Scope: <period · filters · source>'. Keep it short — no headings, no restating the question, no long preamble. " +
        "If the result is empty or a tool failed, say exactly that and what to try instead. " +
        "When you finish, offer 2–4 natural next steps as ONE CLARIFY line whose options are short answers the user can tap (for example 'Show it as a chart', 'Export to Excel', 'Compare with the previous sale'); omit it when nothing useful follows.";

    public const string Common = DataSources + AnswerStyle;
}
