using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Asc.Api.Modules.Email;

/// <summary>
/// Emails a single generated-report attachment to one or more recipients. Backed by SMTP
/// through an already-owned mailbox (Gmail, Microsoft 365, or any other provider) rather than a
/// transactional-email API: those (Resend included) all require verifying a domain you control
/// DNS for before they'll send anything, which this deployment doesn't have. MailKit is
/// Microsoft's own recommended replacement for the deprecated System.Net.Mail.SmtpClient —
/// correct STARTTLS/app-password handling, actively maintained.
/// </summary>
public interface IReportEmailSender
{
    bool IsConfigured { get; }

    Task SendReportAsync(
        IReadOnlyList<string> to,
        string subject,
        string message,
        byte[] attachmentBytes,
        string attachmentFileName,
        string attachmentContentType,
        CancellationToken ct = default);
}

/// <summary>
/// Config keys: Smtp:Host, Smtp:Port (default 587, STARTTLS), Smtp:User, Smtp:Password (an app
/// password for Gmail/Microsoft 365 — the account's real login password won't work once 2FA is
/// on), Smtp:FromAddress (defaults to Smtp:User — the two are the same mailbox for every
/// provider that matters here, since you can only send as the account you authenticated as
/// unless you've separately configured domain-wide delegation/aliases). 25MB is the de facto
/// safe attachment ceiling across mainstream providers (Gmail's own limit); enforced here
/// against the raw byte count so an oversized report fails with a clear message instead of a
/// provider-side rejection mid-send.
/// </summary>
public class SmtpReportEmailSender(IConfiguration config, ILogger<SmtpReportEmailSender> logger) : IReportEmailSender
{
    private const long MaxAttachmentBytes = 25_000_000;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(config["Smtp:Host"])
        && !string.IsNullOrWhiteSpace(config["Smtp:User"])
        && !string.IsNullOrWhiteSpace(config["Smtp:Password"]);

    public async Task SendReportAsync(
        IReadOnlyList<string> to,
        string subject,
        string message,
        byte[] attachmentBytes,
        string attachmentFileName,
        string attachmentContentType,
        CancellationToken ct = default)
    {
        var host = config["Smtp:Host"]
            ?? throw new InvalidOperationException("Smtp:Host is not configured. Set it with: dotnet user-secrets set Smtp:Host \"smtp.gmail.com\"");
        var user = config["Smtp:User"]
            ?? throw new InvalidOperationException("Smtp:User is not configured. Set it with: dotnet user-secrets set Smtp:User \"you@gmail.com\"");
        var password = config["Smtp:Password"]
            ?? throw new InvalidOperationException("Smtp:Password is not configured. Set it with: dotnet user-secrets set Smtp:Password \"<app password>\"");
        var port = int.TryParse(config["Smtp:Port"], out var p) ? p : 587;
        var from = config["Smtp:FromAddress"] is { Length: > 0 } configuredFrom ? configuredFrom : user;

        if (attachmentBytes.LongLength > MaxAttachmentBytes)
            throw new InvalidOperationException(
                $"'{attachmentFileName}' is {attachmentBytes.LongLength / 1_000_000}MB, too large to email (25MB limit).");

        var mime = new MimeMessage();
        mime.From.Add(MailboxAddress.Parse(from));
        foreach (var address in to) mime.To.Add(MailboxAddress.Parse(address));
        mime.Subject = subject;

        var body = new BodyBuilder { TextBody = message };
        body.Attachments.Add(attachmentFileName, attachmentBytes, ContentType.Parse(attachmentContentType));
        mime.Body = body.ToMessageBody();

        using var client = new SmtpClient();
        try
        {
            // SecureSocketOptions.Auto picks STARTTLS on 587 / implicit TLS on 465 — matches
            // both Gmail's and Microsoft 365's documented setups without needing a separate
            // config knob for it.
            await client.ConnectAsync(host, port, SecureSocketOptions.Auto, ct);
            await client.AuthenticateAsync(user, password, ct);
            await client.SendAsync(mime, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "SMTP send to {Host}:{Port} failed", host, port);
            throw new InvalidOperationException($"SMTP send failed: {ex.Message}", ex);
        }
        finally
        {
            if (client.IsConnected) await client.DisconnectAsync(true, ct);
        }
    }
}
