namespace Asc.Api.Modules.ScheduledReports;

/// <summary>Every registered IScheduledReportJob, resolved once via DI's own
/// IEnumerable&lt;T&gt; support — adding a new job type means one new class plus one
/// registration line in Program.cs (AddScoped&lt;IScheduledReportJob, TheNewJob&gt;()); this
/// registry, the runner, the Admin Panel list, and ScheduledReportJobsController all pick it
/// up with no other change.</summary>
public interface IScheduledReportJobRegistry
{
    IReadOnlyList<IScheduledReportJob> All { get; }
    IScheduledReportJob? Find(string key);
}

public class ScheduledReportJobRegistry(IEnumerable<IScheduledReportJob> jobs) : IScheduledReportJobRegistry
{
    public IReadOnlyList<IScheduledReportJob> All { get; } = jobs.ToList();

    public IScheduledReportJob? Find(string key) => All.FirstOrDefault(j => j.Key == key);
}
