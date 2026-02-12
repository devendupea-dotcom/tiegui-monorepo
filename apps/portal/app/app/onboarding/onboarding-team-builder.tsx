"use client";

import { useMemo, useState } from "react";

const MAX_NEW_WORKERS = 3;

function getNextWorkerIndex(activeIndexes: number[]): number | null {
  for (let index = 0; index < MAX_NEW_WORKERS; index += 1) {
    if (!activeIndexes.includes(index)) {
      return index;
    }
  }
  return null;
}

export default function OnboardingTeamBuilder({ workspaceTimezone }: { workspaceTimezone: string }) {
  const [activeWorkerIndexes, setActiveWorkerIndexes] = useState<number[]>([]);
  const canAddWorker = activeWorkerIndexes.length < MAX_NEW_WORKERS;
  const sortedIndexes = useMemo(
    () => [...activeWorkerIndexes].sort((a, b) => a - b),
    [activeWorkerIndexes],
  );

  function addWorkerRow() {
    if (!canAddWorker) return;
    setActiveWorkerIndexes((current) => {
      const next = getNextWorkerIndex(current);
      if (next === null) return current;
      return [...current, next];
    });
  }

  function removeWorkerRow(index: number) {
    setActiveWorkerIndexes((current) => current.filter((value) => value !== index));
  }

  return (
    <div className="onboarding-team-builder">
      <button type="button" className="btn secondary onboarding-add-worker-btn" onClick={addWorkerRow} disabled={!canAddWorker}>
        + Add worker
      </button>

      {sortedIndexes.length === 0 ? (
        <p className="muted onboarding-helper-text">Start with one worker now. Add more later in Settings → Team.</p>
      ) : null}

      <div className="onboarding-team-rows">
        {sortedIndexes.map((index, listPosition) => (
          <div key={index} className="card onboarding-team-card onboarding-team-new-card">
            <div className="onboarding-team-row-header">
              <p>
                <strong>New worker {listPosition + 1}</strong>
              </p>
              <button type="button" className="btn secondary" onClick={() => removeWorkerRow(index)}>
                Remove
              </button>
            </div>

            <input type="hidden" name={`newWorkerTimezone_${index}`} value={workspaceTimezone} />

            <div className="grid two-col">
              <label>
                Name
                <input name={`newWorkerName_${index}`} placeholder="Crew member name" />
              </label>
              <label>
                Role
                <select name={`newWorkerRole_${index}`} defaultValue="WORKER">
                  <option value="OWNER">Owner</option>
                  <option value="WORKER">Worker</option>
                </select>
              </label>
            </div>

            <label>
              Phone (optional)
              <input name={`newWorkerPhone_${index}`} placeholder="+12065550112" />
              <small className="muted onboarding-field-help">
                Used for job alerts and quick call/text from the portal.
              </small>
            </label>
          </div>
        ))}
      </div>

      {!canAddWorker ? (
        <p className="muted onboarding-helper-text">You can add more team members later in Settings → Team.</p>
      ) : null}
    </div>
  );
}
