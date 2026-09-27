using System.Text;
using Asc.Api.Modules.Msl.FactoryAverages;

namespace Asc.Api.Tests;

public class FactoryAveragesParserTests
{
    // Right edge of each number column in the real report (see FactoryAveragesParser.Ends).
    private static readonly int[] QtyEnds = [46, 60, 74, 89, 105, 110, 125, 130];
    private static readonly int[] AvgEnds = [46, 60, 74, 89, 105, 125];

    private static string Row(string label, int[] ends, params string?[] cells)
    {
        var line = new StringBuilder(label.PadRight(132));
        for (var i = 0; i < cells.Length; i++)
        {
            if (cells[i] is not { } c) continue;
            var start = ends[i] - c.Length;
            for (var k = 0; k < c.Length; k++) line[start + k] = c[k];
        }
        return line.ToString().TrimEnd();
    }

    private static string Report(string title = "FACTORY WISE AVERAGES FOR AUGUST    2026") => string.Join("\r\n",
        "ASIA SIYAKA COMMODITIES PLC                                                                                          DATE: 31/08/26",
        title,
        "Elevation : UVA HIGH                                                                                                 PAGE:     0001",
        new string('-', 132),
        "NAME OF ESTATE/MFCODE                   M A I N   G R A D E           O F F  G R A D E                        T O T A L",
        "                                       MONTHLY    CUMULATIVE       MONTHLY     CUMULATIVE         MONTHLY  RANK   CUMULATIVE  RANK",
        new string('-', 132),
        Row("AISLABY", QtyEnds, "47946.00", "399139.50", "7173.00", "32522.00", "55119.00", "4", "431661.50", "9"),
        Row("MF0581", AvgEnds, "1738.07", "1274.02", "714.89", "763.29", "1604.91", "1235.55"),
        Row("ALMA", QtyEnds, "17482.00", "84253.00", null, null, "17482.00", "1", "84253.00", "3"),
        Row("MF0141", AvgEnds, "2963.42", "2909.46", null, null, "2963.42", "2909.46"),
        Row("E L E V A T I O N   T O T A L", QtyEnds, "65428.00", "483392.50", "7173.00", "32522.00", "72601.00", null, "515914.50", null),
        Row("", AvgEnds, "2051.15", "1521.38", "714.89", "763.29", "1878.10", "1447.44"),
        "ASIA SIYAKA COMMODITIES PLC                                                                                          DATE: 31/08/26",
        title,
        "Elevation : LOW                                                                                                      PAGE:     0002",
        Row("KELANI", QtyEnds, "100000.00", "100000.00", null, null, "100000.00", "2", "100000.00", "2"),
        Row("MF0353", AvgEnds, "1189.39", "1189.39", null, null, "1189.39", "1189.39"),
        Row("E L E V A T I O N   T O T A L", QtyEnds, "100000.00", "100000.00", null, null, "100000.00", null, "100000.00", null),
        Row("", AvgEnds, "1189.39", "1189.39", null, null, "1189.39", "1189.39"),
        Row("G R A N D   T O T A L", QtyEnds, "165428.00", "583392.50", "7173.00", "32522.00", "172601.00", null, "615914.50", null),
        Row("", AvgEnds, "1500.00", "1300.00", "714.89", "763.29", "1480.00", "1280.00"),
        "                                             *  *  *    E N D   O F   R E P O R T   *  *  *");

    [Fact]
    public void Parse_ReadsFactoriesTotalsAndBlankCells()
    {
        var p = FactoryAveragesParser.Parse(Report(), "factory-averages/2026/factory-averages-2026-08.txt")!;

        Assert.Equal((2026, 8), (p.Year, p.Month));
        var factories = p.Rows.Where(r => r.RowType == FactoryAverageRowType.Factory).ToList();
        Assert.Equal(3, factories.Count);

        var aislaby = factories[0];
        Assert.Equal(("UVA HIGH", "AISLABY", "MF0581"), (aislaby.Elevation, aislaby.FactoryName, aislaby.MfCode));
        Assert.Equal(47946.00m, aislaby.MainMonthlyQtyKg);
        Assert.Equal(1738.07m, aislaby.MainMonthlyAvgRs);
        Assert.Equal(32522.00m, aislaby.OffCumulativeQtyKg);
        Assert.Equal(763.29m, aislaby.OffCumulativeAvgRs);
        Assert.Equal(55119.00m, aislaby.TotalMonthlyQtyKg);
        Assert.Equal(1604.91m, aislaby.TotalMonthlyAvgRs);
        Assert.Equal(431661.50m, aislaby.TotalCumulativeQtyKg);
        Assert.Equal(1235.55m, aislaby.TotalCumulativeAvgRs);
        Assert.Equal((4, 9), (aislaby.MonthlyRank, aislaby.CumulativeRank));

        // Blank cells (no off-grade sales) are null, not zero.
        var alma = factories[1];
        Assert.Null(alma.OffMonthlyQtyKg);
        Assert.Null(alma.OffMonthlyAvgRs);
        Assert.Equal(1, alma.MonthlyRank);

        // A six-figure quantity starts before column 38 — it must not leak a digit into the name.
        var kelani = factories[2];
        Assert.Equal(("LOW", "KELANI"), (kelani.Elevation, kelani.FactoryName));
        Assert.Equal(100000.00m, kelani.MainMonthlyQtyKg);

        var uvaTotal = p.Rows.Single(r => r is { RowType: FactoryAverageRowType.ElevationTotal, Elevation: "UVA HIGH" });
        Assert.Equal(72601.00m, uvaTotal.TotalMonthlyQtyKg);
        Assert.Equal(1878.10m, uvaTotal.TotalMonthlyAvgRs);
        var grand = p.Rows.Single(r => r.RowType == FactoryAverageRowType.GrandTotal);
        Assert.Null(grand.Elevation);
        Assert.Equal(172601.00m, grand.TotalMonthlyQtyKg);
    }

    [Fact]
    public void Reconcile_AcceptsAConsistentMonth_AndFlagsAnUnbalancedOne()
    {
        var good = FactoryAveragesParser.Parse(Report(), "x")!;
        Assert.Empty(FactoryAveragesParser.Reconcile(good));

        // The Uva High total claims 1,000 kg more than its factories add up to.
        var bad = FactoryAveragesParser.Parse(Report().Replace("65428.00", "66428.00"), "x")!;
        Assert.Contains(FactoryAveragesParser.Reconcile(bad), m => m.StartsWith("UVA HIGH: main-grade factories", StringComparison.Ordinal));
    }

    [Fact]
    public void DecodeText_HandlesTheReportingSystemsUtf16AndPlainUtf8()
    {
        var text = Report();
        var utf16 = new UnicodeEncoding(false, true).GetPreamble().Concat(Encoding.Unicode.GetBytes(text)).ToArray();
        var utf8 = Encoding.UTF8.GetBytes(text);

        Assert.Equal(6, FactoryAveragesParser.Parse(FactoryAveragesParser.DecodeText(utf16), "x")!.Rows.Count);
        Assert.Equal(6, FactoryAveragesParser.Parse(FactoryAveragesParser.DecodeText(utf8), "x")!.Rows.Count);
    }

    [Fact]
    public void Parse_ReturnsNullForOlderLayouts_AndThrowsOnAChangedOne()
    {
        // The 2018 PDFs / Dec 2018 text file have no "FACTORY WISE AVERAGES FOR <MONTH> <YEAR>" title.
        Assert.Null(FactoryAveragesParser.Parse("UVA - HIGH   A S I A   S I Y A K A\nREF:FAC03   FACTORY WISE AVERAGES   21.12.18\n    DEC 2018", "x"));

        // A number that doesn't sit under any report column means the layout changed — fail loudly.
        var misaligned = Report() + Environment.NewLine + "BADCO".PadRight(44) + "12345.00"; // ends at column 52
        Assert.Throws<FormatException>(() => FactoryAveragesParser.Parse(misaligned, "x"));
    }
}
