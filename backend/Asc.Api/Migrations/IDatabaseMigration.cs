namespace Asc.Api.Migrations;

public interface IDatabaseMigration
{
    int Version { get; }
    string Name { get; }
    Task ApplyAsync(CancellationToken cancellationToken);
}
