using Asc.Api.Data;
using Asc.Api.Models;
using MongoDB.Driver;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// The Saved Reports data-access seam for automated report jobs. Backed by local MongoDB
/// today; will be backed by a remote API client later — callers must not depend on
/// Mongo-specific behavior (ObjectId ordering, driver exceptions, etc.), only on this
/// interface's contract. Every scheduled report job reads/writes Saved Reports through this,
/// never through MongoContext.SavedReports directly, so the day the backend swaps to a remote
/// API only this class's implementation changes.
/// </summary>
public interface ISavedReportsService
{
    /// <summary>True if a SavedReport of this Type already exists for this (saleYear, saleNo)
    /// — the idempotency check every AfterSaleClose job needs before generating again.</summary>
    Task<bool> ExistsForSaleAsync(string type, int saleYear, int saleNo, CancellationToken ct = default);

    Task<SavedReport> SaveAsync(SavedReport report, CancellationToken ct = default);

    /// <summary>Most-recent-first outputs of one report Type — a scheduled job's Key doubles
    /// as its SavedReport.Type (see WeeklyFactAutoReportJob/MonthlyCombinedPlaceholderJob), so
    /// the Admin Panel's "Automated Reports" section calls this with a job's own Key to show
    /// what it has actually produced.</summary>
    Task<List<SavedReport>> ListByTypeAsync(string type, int limit, CancellationToken ct = default);

    Task<SavedReport?> GetAsync(Guid id, CancellationToken ct = default);
}

public class SavedReportsService(MongoContext db) : ISavedReportsService
{
    public Task<bool> ExistsForSaleAsync(string type, int saleYear, int saleNo, CancellationToken ct = default) =>
        db.SavedReports.Find(r => r.Type == type && r.SaleYear == saleYear && r.SaleNo == saleNo).AnyAsync(ct);

    public async Task<SavedReport> SaveAsync(SavedReport report, CancellationToken ct = default)
    {
        await db.SavedReports.InsertOneAsync(report, cancellationToken: ct);
        return report;
    }

    public Task<List<SavedReport>> ListByTypeAsync(string type, int limit, CancellationToken ct = default) =>
        db.SavedReports.Find(r => r.Type == type).SortByDescending(r => r.CreatedAt).Limit(limit).ToListAsync(ct);

    public async Task<SavedReport?> GetAsync(Guid id, CancellationToken ct = default) =>
        await db.SavedReports.Find(r => r.Id == id).FirstOrDefaultAsync(ct);
}
