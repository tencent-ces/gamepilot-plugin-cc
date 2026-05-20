import { createTrackedJob } from "./tracked-jobs.mjs";
import { loadState, saveState, writeJobFile } from "./state.mjs";

export async function recordForegroundReviewResult(workspaceRoot, { kind, title, request, threadId, payload, rendered, summary }) {
  const job = await createTrackedJob({
    workspaceRoot,
    kind,
    title,
    request
  });
  const completedAt = new Date().toISOString();
  const completed = {
    ...job,
    status: "completed",
    phase: "done",
    pid: null,
    threadId: threadId ?? null,
    completedAt,
    updatedAt: completedAt,
    healthStatus: "completed",
    summary: summary ?? "",
    result: payload,
    rendered,
    events: [
      ...(job.events ?? []),
      {
        type: "completed",
        message: "Job completed.",
        timestamp: completedAt
      }
    ]
  };
  await writeJobFile(workspaceRoot, job.id, completed);
  await saveState(workspaceRoot, {
    ...loadState(workspaceRoot),
    jobs: [completed]
  });
  return completed;
}
