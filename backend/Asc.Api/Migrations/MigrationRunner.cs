using MongoDB.Driver;

namespace Asc.Api.Migrations;

public sealed record MigrationRecord
{
    public string Id { get; init; } = string.Empty;
    public int Version { get; init; }
    public string Name { get; init; } = string.Empty;
    public DateTime AppliedAtUtc { get; init; }
}

public interface IMigrationHistoryStore
{
    Task<IReadOnlySet<int>> AppliedVersionsAsync(CancellationToken cancellationToken);
    Task RecordAppliedAsync(MigrationRecord record, CancellationToken cancellationToken);
}

public sealed class MongoMigrationHistoryStore(IMongoDatabase database) : IMigrationHistoryStore
{
    private readonly IMongoCollection<MigrationRecord> _records = database.GetCollection<MigrationRecord>("_migrations");

    public async Task<IReadOnlySet<int>> AppliedVersionsAsync(CancellationToken cancellationToken) =>
        (await _records.Find(Builders<MigrationRecord>.Filter.Empty)
            .Project(record => record.Version)
            .ToListAsync(cancellationToken))
        .ToHashSet();

    public Task RecordAppliedAsync(MigrationRecord record, CancellationToken cancellationToken) =>
        _records.InsertOneAsync(record, cancellationToken: cancellationToken);
}

public sealed class MigrationRunner(
    IMigrationHistoryStore history,
    IEnumerable<IDatabaseMigration> migrations,
    ILogger<MigrationRunner> logger)
{
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        var applied = await history.AppliedVersionsAsync(cancellationToken);

        foreach (var migration in migrations.OrderBy(m => m.Version))
        {
            if (applied.Contains(migration.Version)) continue;

            await migration.ApplyAsync(cancellationToken);
            await history.RecordAppliedAsync(
                new MigrationRecord
                {
                    Id = $"{migration.Version:D3}_{migration.Name}",
                    Version = migration.Version,
                    Name = migration.Name,
                    AppliedAtUtc = DateTime.UtcNow,
                },
                cancellationToken);
            applied = applied.Append(migration.Version).ToHashSet();
            logger.LogInformation("Applied database migration {Version}: {Name}", migration.Version, migration.Name);
        }
    }
}
