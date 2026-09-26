using System.Net;
using Asc.Api.Modules.Oklo;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Asc.Api.Tests;

/// <summary>When OKLO is overloaded, background requests must stop piling on after repeated failures — but a request a
/// person is waiting on is never blocked by that pause.</summary>
public class OkloClientBreakerTests
{
    private sealed class FailingOklo : HttpMessageHandler
    {
        public int DataRequests;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.AbsoluteUri.Contains("token", StringComparison.OrdinalIgnoreCase))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"access_token\":\"t\",\"expires_in\":\"3600\"}") });
            Interlocked.Increment(ref DataRequests);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("boom") });
        }
    }

    private static OkloClient Make(FailingOklo handler) => new(
        new HttpClient(handler),
        Options.Create(new OkloOptions { TokenUrl = "https://login.test/token", BaseUrl = "https://oklo.test", ClientId = "c", ClientSecret = "s", Username = "u", Password = "p" }),
        NullLogger<OkloClient>.Instance);

    [Fact]
    public async Task AfterRepeatedFailures_BackgroundRequestsPause_ButPeopleAreNeverBlocked()
    {
        OkloClient.ResetCircuitBreaker();
        OkloClient.RetryDelay = _ => TimeSpan.Zero;
        try
        {
            var handler = new FailingOklo();
            var client = Make(handler);

            // A user-lane request fails five attempts in a row (with the client's own waits between them: use a short one).
            // Drive the failure count with background-lane calls until the breaker trips.
            var tripped = false;
            for (var i = 0; i < 4 && !tripped; i++)
            {
                try { await client.GetGeneralReportPageAsync(1, 1, 100, CancellationToken.None, background: true); }
                catch (OkloApiException ex) when (ex.Status == 503) { tripped = true; }
                catch (HttpRequestException) { }
            }
            Assert.True(tripped, "six failed attempts in a row should pause background requests");

            var before = handler.DataRequests;
            await Assert.ThrowsAsync<OkloApiException>(() => client.GetGeneralReportPageAsync(1, 1, 100, CancellationToken.None, background: true));
            Assert.Equal(before, handler.DataRequests);                 // paused: nothing was sent to OKLO

            // A person waiting on a sale still gets through (it fails here only because this fake OKLO is down).
            await Assert.ThrowsAsync<HttpRequestException>(() => client.GetGeneralReportPageAsync(1, 1, 100, CancellationToken.None, background: false));
            Assert.True(handler.DataRequests > before);
        }
        finally
        {
            OkloClient.ResetCircuitBreaker();
            OkloClient.RetryDelay = attempt => TimeSpan.FromSeconds(5 * attempt);
        }
    }
}
