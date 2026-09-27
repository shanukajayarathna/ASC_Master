using System.Text;
using Asc.Api.Modules.Msl.GradeAnalysis;
using Asc.Api.Modules.Msl.PlantationRanking;

namespace Asc.Api.Tests;

/// <summary>Parsers for the grade-analysis and plantation-ranking reports (2018–2020 archive).</summary>
public class ReportParsersTests
{
    private static string Line(string label, int[] ends, params string?[] cells)
    {
        var line = new StringBuilder(label.PadRight(140));
        for (var i = 0; i < cells.Length; i++)
        {
            if (cells[i] is not { } c) continue;
            var start = ends[i] - c.Length;
            for (var k = 0; k < c.Length; k++) line[start + k] = c[k];
        }
        return line.ToString().TrimEnd();
    }

    // ---- grade analysis ----

    private static readonly int[] GradeEnds = [50, 67, 78, 102, 119, 130];

    private static string GradeReport(string mainTotal = "300.00") => string.Join("\n",
        "ASIA SIYAKA COMMODITIES PLC                                          DATE:  6/03/19",
        "ALL BROKERS' MONTHLY ELEVATION WISE GRADE ANALYSIS & AVERAGES - FEBRUARY  2019       TIME: 15:44:47",
        "ELEVATION : LOW                                                      PAGE:     0001",
        new string('-', 130),
        "            GRADE                         QUANTINT       AVG. PRICE       PCTG",
        Line("            BOP1", GradeEnds, "200.00", "700.50", "66.67", "500.00", "690.00", "62.50"),
        Line("            FBOPF1", GradeEnds, "100.00", "650.00", "33.33", "300.00", "640.00", "37.50"),
        Line("            KESARI", GradeEnds, null, null, null, "1.50", "22,000.00", null),
        Line(" M A I N  G R A D E S  T O T A L:", GradeEnds, mainTotal, "683.50", null, "801.50", "681.00", null),
        Line("            BM", GradeEnds, "50.00", "400.00", "100.00", "80.00", "395.00", "100.00"),
        Line(" O F F    G R A D E S  T O T A L:", GradeEnds, "50.00", "400.00", null, "80.00", "395.00", null),
        Line(" E L E V A T I O N A L  T O T A L:", GradeEnds, "350.00", "641.00", null, "881.50", "651.00", null));

    [Fact]
    public void GradeAnalysis_ReadsGradesTotalsAndBlanks()
    {
        var p = GradeAnalysisParser.Parse(GradeReport(), "grade-analysis-2019-02.txt")!;

        Assert.Equal((2019, 2), (p.Year, p.Month));
        var grades = p.Rows.Where(r => r.RowType == GradeAnalysisRowType.Grade).ToList();
        Assert.Equal(["BOP1", "FBOPF1", "KESARI", "BM"], grades.Select(g => g.Grade));

        // A digit inside a grade name ("BOP1") is part of the name, not a figure.
        var bop1 = grades[0];
        Assert.Equal(("LOW", "MAIN"), (bop1.Elevation, bop1.GradeGroup));
        Assert.Equal((200.00m, 700.50m, 66.67m), (bop1.MonthQtyKg, bop1.MonthAvgRs, bop1.MonthPct));
        Assert.Equal((500.00m, 690.00m, 62.50m), (bop1.TodateQtyKg, bop1.TodateAvgRs, bop1.TodatePct));

        // A grade not sold this month keeps its year-to-date figures and has nulls for the month.
        var kesari = grades[2];
        Assert.Null(kesari.MonthQtyKg);
        Assert.Equal(22000.00m, kesari.TodateAvgRs);

        // Grades after "MAIN GRADES TOTAL" are off grades.
        Assert.Equal("OFF", grades[3].GradeGroup);
        Assert.Contains(p.Rows, r => r.RowType == GradeAnalysisRowType.ElevationTotal && r.MonthQtyKg == 350.00m);
    }

    [Fact]
    public void GradeAnalysis_Reconcile_AcceptsBalancedAndFlagsUnbalanced()
    {
        Assert.Empty(GradeAnalysisParser.Reconcile(GradeAnalysisParser.Parse(GradeReport(), "x")!));

        var bad = GradeAnalysisParser.Parse(GradeReport(mainTotal: "999.00"), "x")!;
        Assert.Contains(GradeAnalysisParser.Reconcile(bad), m => m.StartsWith("LOW: main grades add to 300.00", StringComparison.Ordinal));
    }

    [Fact]
    public void GradeAnalysis_AllElevationsSummary_HasFourColumnsAndNoElevationHeadingRows()
    {
        int[] ends = [50, 67, 86, 103];
        var text = string.Join("\n",
            "ASIA SIYAKA COMMODITIES PLC                                          DATE:  1",
            "ALL BROKERS' MONTHLY ELEVATION WISE GRADE ANALYSIS & AVERAGES - MAY       2019       TIME: 14",
            "ELEVATION : ALL                                                      PAGE:",
            "            ELEVATION                     QUANTITY       AVG. PRICE       QUANTITY       AVG. PRICE",
            Line("            LOW", ends, "15,606,408.00", "568.72", "81,583,409.80", "600.23"),
            Line("            UVA HIGH", ends, "1,793,641.00", "472.68", "7,058,942.50", "499.70"),
            Line("            G R A N D  T O T A L", ends, "17,400,049.00", "558.39", "88,642,352.30", "591.31"));
        var p = GradeAnalysisParser.Parse(text, "x")!;

        var summary = p.Rows.Where(r => r.RowType == GradeAnalysisRowType.ElevationSummary).ToList();
        Assert.Equal(["LOW", "UVA HIGH"], summary.Select(s => s.Elevation));
        Assert.Equal(81_583_409.80m, summary[0].TodateQtyKg);
        Assert.Empty(GradeAnalysisParser.Reconcile(p));
    }

    [Fact]
    public void GradeAnalysis_ReturnsNullForOtherReports() =>
        Assert.Null(GradeAnalysisParser.Parse("FACTORY WISE AVERAGES FOR MARCH 2019\nElevation : LOW", "x"));

    // ---- plantation ranking ----

    private static readonly int[] RankEnds = [32, 36, 43, 47, 63, 67, 75, 79];

    private static string RankingReport(string total = "500.0") => string.Join("\n",
        "PERFORMANCE OF COMPANIES AS AT END OF FEBRUARY  2019             DATE:  3/03/19",
        "ELEVATION : HIGH                                                 TIME: 10:58:28",
        "                                                                 PAGE:     0001",
        new string('-', 79),
        "COMPANY NAME           TOTAL QTY RNK AVG.PR RNK       TOTAL QTY RNK  AVG.PR RNK",
        Line("KELANI VALLEY PLANT", RankEnds, "300.0", "4", "673.05", "2", "744.00", "4", "669.67", "2"),
        Line("   JOHN KEELLS PLC", RankEnds, "100.0", null, "701.55", null, "128.00", null, "678.07"),
        Line("   FORBES & WALKERS", RankEnds, "200.0", null, "660.00", null, "616.00", null, "665.00"),
        Line("TALAWAKELLE PLANTAT", RankEnds, "200.0", "6", "704.20", "1", "700.00", "5", "696.44", "1"),
        Line("   ASIA SIYAKA COMM", RankEnds, "200.0", null, "704.20", null, "700.00", null, "696.44"),
        Line("T O T A L", RankEnds, total, null, "685.00", null, "1,444.00", null, "680.00"));

    [Fact]
    public void PlantationRanking_ReadsCompaniesBrokersAndTotal()
    {
        var p = PlantationRankingParser.Parse(RankingReport(), "plantation-ranking-2019-02.txt")!;

        Assert.Equal((2019, 2), (p.Year, p.Month));
        var kelani = p.Rows.Single(r => r is { RowType: PlantationRowType.Company, Company: "KELANI VALLEY PLANT" });
        Assert.Equal(("HIGH", 300.0m, 4, 673.05m, 2), (kelani.Elevation, kelani.MonthQtyKg, kelani.MonthQtyRank, kelani.MonthAvgRs, kelani.MonthAvgRank));
        Assert.Equal((744.00m, 4, 669.67m, 2), (kelani.TodateQtyKg, kelani.TodateQtyRank, kelani.TodateAvgRs, kelani.TodateAvgRank));

        var brokers = p.Rows.Where(r => r is { RowType: PlantationRowType.Broker, Company: "KELANI VALLEY PLANT" }).ToList();
        Assert.Equal(["JOHN KEELLS PLC", "FORBES & WALKERS"], brokers.Select(b => b.Broker));
        Assert.Null(brokers[0].MonthQtyRank);   // brokers carry quantity and average only
        Assert.Equal(500.0m, p.Rows.Single(r => r.RowType == PlantationRowType.Total).MonthQtyKg);
    }

    [Fact]
    public void PlantationRanking_Reconcile_AcceptsBalancedAndFlagsUnbalanced()
    {
        Assert.Empty(PlantationRankingParser.Reconcile(PlantationRankingParser.Parse(RankingReport(), "x")!));
        Assert.Contains(PlantationRankingParser.Reconcile(PlantationRankingParser.Parse(RankingReport(total: "999.0"), "x")!),
            m => m.StartsWith("HIGH: companies add to 500.0", StringComparison.Ordinal));
    }

    [Fact]
    public void PlantationRanking_ReturnsNullForOtherReports_AndThrowsOnAMisplacedFigure()
    {
        Assert.Null(PlantationRankingParser.Parse("GRADE ANALYSIS\nELEVATION : LOW", "x"));

        // A company-line figure ending at column 55 sits under none of the report's columns — the layout
        // changed, so fail loudly instead of importing it as something else.
        var bad = RankingReport() + Environment.NewLine +
                  Line("BADCO PLANT", [32, 36, 43, 47, 55, 67, 75, 79], "1.0", "1", "2.00", "1", "3.0", "1", "4.00", "1");
        Assert.Throws<FormatException>(() => PlantationRankingParser.Parse(bad, "x"));
    }
}
