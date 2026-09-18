using System.IO.Compression;
using Asc.Api.Modules.MarkIntelligence;
using Asc.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;

namespace Asc.Api.Tests;

file sealed class FakeEnvS36 : IWebHostEnvironment
{
    public string ContentRootPath { get; set; } = "";
    public string EnvironmentName { get; set; } = "Development";
    public string ApplicationName { get; set; } = "Asc.Api";
    public string WebRootPath { get; set; } = "";
    public IFileProvider ContentRootFileProvider { get; set; } = null!;
    public IFileProvider WebRootFileProvider { get; set; } = null!;
}

public class Sale36Investigate
{
    [Fact]
    public void Run()
    {
        var contentRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "Asc.Api"));
        var env = new FakeEnvS36 { ContentRootPath = contentRoot };
        var importer = new CatalogueImportService();

        const string zipPath = @"C:\Users\_ASUS_\Downloads\SALE_NO;36_ALL_BORKERS_CAT_FILES.zip";
        var lines = new List<string>();
        var rowsByBroker = new Dictionary<string, List<List<string>>>();
        var entryNameByBroker = new Dictionary<string, string>();

        using (var archive = ZipFile.OpenRead(zipPath))
        {
            foreach (var entry in archive.Entries)
            {
                if (string.IsNullOrEmpty(entry.Name)) continue;
                var ext = Path.GetExtension(entry.Name).ToLowerInvariant();
                if (ext != ".xls" && ext != ".xlsx") continue;
                using var entryStream = entry.Open();
                using var buffered = new MemoryStream();
                entryStream.CopyTo(buffered);
                buffered.Position = 0;
                var rows = importer.ParseExcel(buffered);
                var brokerCode = BrokerCatalogueUploadParser.DetectBroker(rows);
                if (brokerCode is null) continue;
                rowsByBroker[brokerCode] = rows;
                entryNameByBroker[brokerCode] = entry.Name;
            }
        }

        foreach (var code in BrokerCode.All)
        {
            if (!rowsByBroker.TryGetValue(code, out var rows)) continue;
            var (year, saleNo, date) = BrokerCatalogueUploadParser.TryDetectSaleInfo(code, importer, rows);
            lines.Add($"{code} ({entryNameByBroker[code]}): Year={year} SaleNo={saleNo} Date={date:yyyy-MM-dd}");
        }

        File.WriteAllLines("sale36_investigate_output.txt", lines);
    }
}
