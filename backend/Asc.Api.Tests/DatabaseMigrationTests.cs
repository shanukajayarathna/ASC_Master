using Asc.Api.Migrations;
using Microsoft.Extensions.Logging.Abstractions;

namespace Asc.Api.Tests;

public sealed class DatabaseMigrationTests
{
    [Fact]
    public async Task RunAsync_AppliesEachVersionOnlyOnce()
    {
        var history = new InMemoryHistory();
        var migration = new CountingMigration(1, "test");
        var runner = new MigrationRunner(history, [migration], NullLogger<MigrationRunner>.Instance);

        await runner.RunAsync();
        await runner.RunAsync();

        Assert.Equal(1, migration.ApplyCount);
        Assert.Contains(1, history.Applied);
        Assert.Single(history.Records);
    }

    private sealed class CountingMigration(int version, string name) : IDatabaseMigration
    {
        public int Version => version;
        public string Name => name;
        public int ApplyCount { get; private set; }

        public Task ApplyAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ApplyCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class InMemoryHistory : IMigrationHistoryStore
    {
        public HashSet<int> Applied { get; } = [];
        public List<MigrationRecord> Records { get; } = [];

        public Task<IReadOnlySet<int>> AppliedVersionsAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlySet<int>>(Applied);

        public Task RecordAppliedAsync(MigrationRecord record, CancellationToken cancellationToken)
        {
            Applied.Add(record.Version);
            Records.Add(record);
            return Task.CompletedTask;
        }
    }
}
