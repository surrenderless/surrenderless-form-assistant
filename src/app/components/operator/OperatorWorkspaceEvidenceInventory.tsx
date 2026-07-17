"use client";

import {
  buildOperatorEvidenceViewFileControl,
  type OperatorWorkspaceEvidenceItem,
} from "@/lib/justice/operatorWorkspaceEvidence";

/**
 * Shared evidence inventory for guided operator filing workspaces.
 * Attached files expose a "View file" control (short-lived signed URL route) — never raw storage paths.
 */
export function OperatorWorkspaceEvidenceInventory({
  evidence,
}: {
  evidence: readonly OperatorWorkspaceEvidenceItem[];
}) {
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
      <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
        Evidence inventory
      </p>
      {evidence.length === 0 ? (
        <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
          No saved evidence rows on this case yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {evidence.map((row, index) => {
            const viewFile = buildOperatorEvidenceViewFileControl(row);
            return (
              <li
                key={`${row.id || row.title}-${row.file_name ?? "nofile"}-${index}`}
                className="text-[11px] text-neutral-800 dark:text-neutral-100"
              >
                <span className="font-medium">[{row.evidence_type}]</span> {row.title}
                {viewFile ? (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {" "}
                    · {viewFile.fileName}{" "}
                    <a
                      href={viewFile.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-neutral-900 underline underline-offset-2 hover:text-neutral-700 dark:text-neutral-50 dark:hover:text-neutral-200"
                    >
                      {viewFile.label}
                    </a>
                  </span>
                ) : row.file_name ? (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {" "}
                    · {row.file_name}
                  </span>
                ) : null}
                {row.evidence_date ? (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {" "}
                    · {row.evidence_date}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
