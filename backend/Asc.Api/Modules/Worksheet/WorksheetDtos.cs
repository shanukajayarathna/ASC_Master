namespace Asc.Api.Modules.Worksheet;

/// <summary>
/// One row of the Worksheet's working table. Deliberately not persisted anywhere — the
/// Worksheet is a rough, pre-auction scratchpad (per the user's own framing): rows can start
/// from a real sale via WorksheetController.Lots, or from a manual upload via
/// WorksheetController.Import, but whatever the user edits into Valuation/Remarks afterward is
/// exported straight back out, never written to Lot/StoredValuation.
/// </summary>
public record WorksheetRowDto(
    string? LotNumber,
    string? Broker,
    string? SellingMark,
    string? Grade,
    int? Bags,
    decimal? NetWeight,
    decimal? TotalWeight,
    // Valuation is always the numeric figure used for Total Proceeds/totals math — for a range,
    // that's the LOWER bound (matching the original standalone Worksheet tool's
    // parseValuationInput exactly: "for a range, the LOWER value is what's used for every
    // calculation"), not the midpoint. ValuationRangeText carries the "1200.00 - 1300.00"
    // display text so a range doesn't silently collapse to one number — set only when the
    // source valuation genuinely was a range (From != To).
    decimal? Valuation,
    string? ValuationRangeText,
    string? Remarks,
    // Any column beyond the fixed set above — e.g. "Invoice No" — keyed by its original header
    // label. Populated from Lot.InvoiceNo when loading from a sale, or from whatever headers in
    // an uploaded file didn't map to a recognised field, mirroring the original standalone
    // Worksheet's "extra columns" concept (auto-shown for anything invoice-like, toggleable for
    // everything else via the Columns menu).
    Dictionary<string, string>? Extra = null);

public record WorksheetLookupResultDto(List<WorksheetRowDto> Rows, int TotalMatches, bool Truncated);

public record WorksheetImportResultDto(string FileName, List<WorksheetRowDto> Rows, int SkippedRows);

/// <summary>ExcludeUnvalued mirrors the working table's "entered values only" toggle so the
/// exported average/summary boxes match exactly what's on screen. ExtraColumnKeys is the
/// ordered list of extra columns currently shown on screen — the export includes exactly those,
/// same as the original tool's getActiveColumns() driving both its Excel and PDF exports.
/// ValuationLabel/ProceedsLabel/SheetName default to the Worksheet tool's own wording; the
/// Asking Price tool (which shares this same export endpoint/builder — the original standalone
/// apps share one excel-report.js the same way) passes "Asking Price"/"Total Value"/"Asking
/// Price Report" instead.</summary>
public record WorksheetExportRequestDto(
    string Title,
    string? SaleLabel,
    List<WorksheetRowDto> Rows,
    bool ExcludeUnvalued,
    List<string>? ExtraColumnKeys = null,
    string ValuationLabel = "Valuation",
    string ProceedsLabel = "Total Proceeds",
    string SheetName = "Worksheet");

/// <summary>Distinct Broker/Factory values actually present in one sale, for the Worksheet's
/// "import from sale" autocomplete — fetched once when a sale is picked, filtered client-side
/// as the user types.</summary>
public record WorksheetFactoryOptionDto(string? Code, string? Name);

public record WorksheetFacetsDto(List<string> Brokers, List<WorksheetFactoryOptionDto> Factories);
