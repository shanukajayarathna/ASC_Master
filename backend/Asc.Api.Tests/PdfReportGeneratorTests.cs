using Asc.Api.Modules.Reports;

namespace Asc.Api.Tests;

public class PdfReportGeneratorTests
{
    private static ReportDto SampleReport() => new(
        "msl-analytics",
        "MSL Analytics",
        "Sale 30 of 2026",
        "ASC Intelligence Hub — MSL archive",
        DateTime.UtcNow,
        [
            new ReportSectionDto("Overview", [new KpiDto("Total Lots", 1234, "count"), new KpiDto("Proceeds (Rs)", 456789.12m, "currency")], null, null),
            new ReportSectionDto("Brokers", null, "Broker", [new GroupRowDto("ASC — Asia Siyaka", 420, 1250.55m, 34.2), new GroupRowDto("FW — Forbes & Walker", 310, 1180.10m, 25.1)]),
        ]);

    [Fact]
    public void Build_ProducesAValidPdf()
    {
        var bytes = PdfReportGenerator.Build(SampleReport());

        Assert.NotEmpty(bytes);
        // "%PDF" magic bytes — the one structural check that doesn't require a full PDF parser.
        Assert.Equal((byte)'%', bytes[0]);
        Assert.Equal((byte)'P', bytes[1]);
        Assert.Equal((byte)'D', bytes[2]);
        Assert.Equal((byte)'F', bytes[3]);
    }

    [Fact]
    public void Build_ReportWithNoSections_StillProducesAValidPdf()
    {
        var report = new ReportDto("blank", "Empty Report", "No sections", "Sale 1", DateTime.UtcNow, []);

        var bytes = PdfReportGenerator.Build(report);

        Assert.NotEmpty(bytes);
        Assert.Equal((byte)'%', bytes[0]);
    }

    [Fact]
    public void Build_SectionWithNeitherKpisNorGroups_DoesNotThrow()
    {
        var report = new ReportDto("t", "Title", "Sub", "Src", DateTime.UtcNow,
            [new ReportSectionDto("Empty Section", null, null, null)]);

        var bytes = PdfReportGenerator.Build(report);

        Assert.NotEmpty(bytes);
    }

    [Fact]
    public void Build_ManyGroupRows_PaginatesWithoutThrowing()
    {
        // Enough rows to overflow a single A4 page at the generator's line height — this is
        // the pagination path (NewPage/EnsureRoom), the part most likely to have an off-by-one
        // in the "end the previous page before starting the next" bookkeeping.
        var groups = Enumerable.Range(1, 80)
            .Select(i => new GroupRowDto($"Mark {i}", i, 1000m + i, 1.0 + i * 0.1))
            .ToList();
        var report = new ReportDto("t", "Title", "Sub", "Src", DateTime.UtcNow,
            [new ReportSectionDto("Selling Marks", null, "Mark", groups)]);

        var bytes = PdfReportGenerator.Build(report);

        Assert.NotEmpty(bytes);
        Assert.Equal((byte)'%', bytes[0]);
    }
}
