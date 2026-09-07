using Asc.Api.Data;

namespace Asc.Api.Migrations;

/// <summary>
/// Baselines the index catalog that was previously created opportunistically at API startup.
/// Future index/schema changes must add a new numbered migration instead of changing this one.
/// </summary>
public sealed class Migration001CurrentIndexes(MongoContext database) : IDatabaseMigration
{
    public int Version => 1;
    public string Name => "current_indexes";

    public Task ApplyAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        database.CreateIndexesForMigration();
        return Task.CompletedTask;
    }
}
