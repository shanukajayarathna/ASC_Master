using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Models;

/// <summary>
/// A report the Reports workspace was asked to re-run on a schedule: the builder's choices (RequestJson is a serialised
/// CustomPreviewRequest — kept as text so the stored shape never depends on how the driver maps a record), who asked,
/// and when it last ran. The scheduled-reports runner (CustomReportSpecsJob) turns each enabled spec into a Saved
/// Report snapshot every Monday.
/// </summary>
public class CustomReportSpec
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string OwnerId { get; set; } = "";
    public string OwnerName { get; set; } = "";
    public string Title { get; set; } = "";
    public string RequestJson { get; set; } = "";

    /// <summary>bar | line | table — how the snapshot draws it.</summary>
    public string Visual { get; set; } = "bar";

    public bool Enabled { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastRunAt { get; set; }

    [BsonRepresentation(BsonType.String)]
    public Guid? LastSavedReportId { get; set; }

    public string? LastError { get; set; }
}
