"use client";

import { api, ApiError } from "@/lib/api";
import MailOutlineIcon from "@mui/icons-material/MailOutlineOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useState, type MouseEvent } from "react";

/** Splits on comma, semicolon, or whitespace/newlines — however someone naturally pastes a
 *  list of addresses out of an email client or a spreadsheet cell — and drops empties from
 *  trailing separators. Format itself isn't validated here: the backend already rejects an
 *  invalid address per-recipient with a clear message, so there's no reason to duplicate that
 *  rule and risk the two disagreeing. */
function splitAddresses(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A "Send by Email" action for any Saved Report — reads the report id from the same
 *  ScheduledReportOutput/SavedReport shape every "Download" button next to it already uses, and
 *  posts to ReportsController.EmailSaved, which attaches the exact file DownloadSaved streams
 *  and sends it via SMTP. Self-contained (owns its own popover/sending/error state) so
 *  dropping it into a list row is a one-line addition, same as the Download IconButton it sits
 *  beside on every page that renders one (Saved Reports, Automated Reports' per-job outputs,
 *  Factory Sale Summary, Category Analysis). */
export default function SendReportEmailButton({ reportId, reportTitle }: { reportId: string; reportTitle: string }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const open = Boolean(anchorEl);

  const close = () => {
    setAnchorEl(null);
    // Reset after the popover's close transition so the form doesn't visibly clear mid-fade.
    setTimeout(() => {
      setTo("");
      setMessage("");
      setError(null);
      setSent(false);
    }, 200);
  };

  const send = async () => {
    const addresses = splitAddresses(to);
    if (addresses.length === 0) {
      setError("Enter at least one email address.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.emailSavedReport(reportId, addresses, message.trim() || undefined);
      setSent(true);
      setTimeout(close, 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send this report.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Tooltip title="Send by email">
        <IconButton
          size="small"
          onClick={(e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
          aria-label={`Send ${reportTitle} by email`}
        >
          <MailOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <div className="p-3.5 w-80 flex flex-col gap-2.5">
          <div className="text-[13px] font-semibold text-text-strong truncate">Email {reportTitle}</div>
          {sent ? (
            <div className="text-[13px] text-sage py-2">Sent.</div>
          ) : (
            <>
              <TextField
                size="small"
                label="To"
                placeholder="name@company.com, name2@company.com"
                value={to}
                autoFocus
                onChange={(e) => setTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={sending}
              />
              <TextField
                size="small"
                label="Message (optional)"
                multiline
                minRows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={sending}
              />
              {error && <div className="text-[12px] text-danger">{error}</div>}
              <div className="flex justify-end gap-1.5 mt-0.5">
                <Button size="small" onClick={close} disabled={sending}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={send}
                  disabled={sending || to.trim() === ""}
                  startIcon={sending ? <CircularProgress size={14} color="inherit" /> : undefined}
                >
                  {sending ? "Sending…" : "Send"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Popover>
    </>
  );
}
