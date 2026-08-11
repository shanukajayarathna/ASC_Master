using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using Asc.Api.Modules.Reports;

namespace Asc.Api.Tests;

public class PresentationGeneratorTests
{
    private static ReportDto SampleReport() => new(
        "executive",
        "Executive Summary",
        "Full catalogue overview",
        "Sale 24 - 2026",
        DateTime.UtcNow,
        [
            new ReportSectionDto("Overview", [new KpiDto("Total Lots", 1234, "count"), new KpiDto("Average Valuation", 456.78m, "currency")], null, null),
            new ReportSectionDto("By Broker", null, "Broker", [new GroupRowDto("ABC Ltd", 42, 500.5m, 12.3), new GroupRowDto("XYZ Ltd", 10, 480.0m, 2.9)]),
        ]);

    [Fact]
    public void Build_ProducesAStructurallyValidPresentation()
    {
        var bytes = PresentationGenerator.Build(SampleReport());

        Assert.NotEmpty(bytes);
        Assert.Equal(0x50, bytes[0]); // 'P' — a .pptx is a zip archive (PK header)
        Assert.Equal(0x4B, bytes[1]); // 'K'

        using var stream = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(stream, false);

        var errors = new OpenXmlValidator(DocumentFormat.OpenXml.FileFormatVersions.Office2013).Validate(doc).ToList();
        Assert.True(errors.Count == 0, string.Join("\n", errors.Select(e => $"{e.Path?.XPath}: {e.Description}")));

        // Title slide + one slide per section.
        var slideCount = doc.PresentationPart!.SlideParts.Count();
        Assert.Equal(3, slideCount);
    }

    [Fact]
    public void Build_ReportWithNoSections_StillProducesAValidTitleSlideOnly()
    {
        var report = new ReportDto("blank", "Empty Report", "No sections", "Sale 1", DateTime.UtcNow, []);

        var bytes = PresentationGenerator.Build(report);

        using var stream = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(stream, false);
        Assert.Single(doc.PresentationPart!.SlideParts);

        var errors = new OpenXmlValidator(DocumentFormat.OpenXml.FileFormatVersions.Office2013).Validate(doc).ToList();
        Assert.True(errors.Count == 0, string.Join("\n", errors.Select(e => $"{e.Path?.XPath}: {e.Description}")));
    }
}
