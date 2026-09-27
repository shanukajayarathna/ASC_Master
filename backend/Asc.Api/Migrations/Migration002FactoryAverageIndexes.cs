using Asc.Api.Data;

namespace Asc.Api.Migrations;

/// <summary>Indexes for the factoryAverages collection (monthly Factory Wise Averages reports).</summary>
public sealed class Migration002FactoryAverageIndexes(MongoContext database) : IDatabaseMigration
{
    public int Version => 2;
    public string Name => "factory_average_indexes";

    public Task ApplyAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        database.CreateFactoryAverageIndexes();
        return Task.CompletedTask;
    }
}
