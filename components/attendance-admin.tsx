"use client";

import { useMemo, useState } from "react";

type AttendanceEntry = {
  id: string;
  username: string;
  clock_in: string;
  clock_out: string | null;
};

const timeInManila = (value: string | null) => {
  if (!value) return "Still clocked in";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const hoursBetween = (start: string, end: string | null) => {
  if (!end) return "In progress";
  const hours = Math.max(0, (Date.parse(end) - Date.parse(start)) / 3_600_000);
  return `${hours.toFixed(2)} hrs`;
};

export function AttendanceAdmin({ data, username, offline, refresh }: any) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const rows: AttendanceEntry[] = useMemo(
    () => (Array.isArray(data?.attendance) ? data.attendance : []),
    [data?.attendance],
  );
  const activeShift = rows.find((entry) => entry.username === username && !entry.clock_out);

  const toggleClock = async () => {
    if (busy || offline || !data?.canAttendance) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: activeShift ? "clock-out" : "clock-in" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update attendance.");
      setMessage(activeShift ? "You are clocked out." : "You are clocked in.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update attendance.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div>
          <h3>Staff attendance</h3>
          <p>Record your shift start and finish. Times are shown in Asia/Manila.</p>
        </div>
        <button className="refresh" type="button" onClick={refresh} disabled={busy}>
          ↻ Refresh
        </button>
      </div>
      {data?.canAttendance && (
        <section className="dashboard-card attendance-clock-card">
          <div>
            <span className="eyebrow">YOUR SHIFT</span>
            <strong className="attendance-clock-status">
              {activeShift ? "Currently clocked in" : "No active shift"}
            </strong>
            {activeShift && <small>Started {timeInManila(activeShift.clock_in)}</small>}
          </div>
          <button className="button button-green" type="button" disabled={busy || offline} onClick={toggleClock}>
            {busy ? "Saving…" : activeShift ? "Clock out" : "Clock in"}
          </button>
          {message && <p className="attendance-message" role="status">{message}</p>}
        </section>
      )}
      <section className="dashboard-card attendance-history-card">
        <div className="card-title">
          <strong>{data?.manageAttendance ? "Team attendance" : "Your attendance history"}</strong>
          <small>{rows.length} recent {rows.length === 1 ? "shift" : "shifts"}</small>
        </div>
        {rows.length ? (
          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead><tr>{data?.manageAttendance && <th>Staff member</th>}<th>Clock in</th><th>Clock out</th><th>Duration</th></tr></thead>
              <tbody>{rows.map((entry) => <tr key={entry.id}>
                {data?.manageAttendance && <td>{entry.username}</td>}
                <td>{timeInManila(entry.clock_in)}</td>
                <td>{timeInManila(entry.clock_out)}</td>
                <td>{hoursBetween(entry.clock_in, entry.clock_out)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <div className="empty-state">No attendance records yet.</div>}
      </section>
      {offline && <p className="muted">Attendance is read-only while offline. Reconnect to clock in or out.</p>}
    </div>
  );
}
