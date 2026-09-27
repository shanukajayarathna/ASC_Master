using Asc.Api.Data;

namespace Asc.Api.Migrations;

/// <summary>Indexes for the gradeAnalysis, plantationRankings and combinedAverages collections.</summary>
public sealed class Migration003ReportIndexes(MongoContext database) : IDatabaseMigration
{
    public int Version => 3;
    public string Name => "grade_analysis_and_plantation_ranking_indexes";

    public Task ApplyAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        database.CreateReportIndexes();
        return Task.CompletedTask;
    }
}
