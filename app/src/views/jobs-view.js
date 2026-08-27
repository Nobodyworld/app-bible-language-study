import { createDetailList, setDetail } from "../dom.js?v=pr13-live-qa-20260711e";
import { canRunJob, runJob } from "../job-processor.js?v=pr13-live-qa-20260711e";
import { completeJob, getAllJobEvents, updateJobStatus } from "../stores.js?v=pr13-live-qa-20260711e";
import { DETAIL_VIEW_IDS } from "../ui-contracts.js";

function stateLabel(state) {
  return String(state || "unknown").replaceAll("_", " ");
}

function jobFriendlySummary(job) {
  const payload = job.payload || {};
  const target = payload.target || {};
  const ref = target.reference || payload.reference || {};
  const parts = [];
  if (job.type === "tag-index-refresh") parts.push("Refresh study mark indexes");
  else if (job.type) parts.push(job.type.replaceAll("-", " "));
  if (payload.tag_id) parts.push(`label ${payload.tag_id}`);
  if (target.target_type) parts.push(target.target_type.replaceAll("_", " "));
  if (ref.book_id || ref.chapter || ref.verse_start) {
    const chapter = ref.chapter ? ` ${ref.chapter}` : "";
    const verse = ref.verse_start ? `:${ref.verse_start}` : "";
    parts.push(`${ref.book_id || "reference"}${chapter}${verse}`);
  }
  if (payload.target_id && !parts.some((part) => part.includes(payload.target_id))) parts.push(payload.target_id);
  return parts.filter(Boolean).join(" • ") || "Local study processing task";
}

export function renderJobsDiagnostics(ctx, refresh = () => {}) {
    const wrap = document.createElement("div");
    const intro = document.createElement("p");
    intro.className = "local-processing-intro";
    intro.textContent = "Technical job history and controls for troubleshooting browser-local processing.";
    wrap.append(intro);

    const jobs = getAllJobEvents(ctx.state);
    const summary = document.createElement("p");
    summary.className = "job-summary";
    const queued = jobs.filter((job) => job.state === "queued").length;
    const planned = jobs.filter((job) => job.state === "planned").length;
    const simulationOnly = jobs.filter((job) => job.state === "simulation_only").length;
    summary.textContent = `${queued} queued / ${planned} planned / ${simulationOnly} simulation-only / ${jobs.length} total`;
    wrap.append(summary);

    if (!jobs.length) {
      const empty = document.createElement("p");
      empty.textContent = "No local processing tasks are queued.";
      wrap.append(empty);
      return wrap;
    }

    const addJobAction = (parent, job, label, status, className = "") => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = ["mini-button", "job-action", className].filter(Boolean).join(" ");
      button.textContent = label;
      button.addEventListener("click", () => {
        updateJobStatus(ctx.state, job.store, job.id, status);
        refresh();
      });
      parent.append(button);
    };

    const addRunAction = (parent, job) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mini-button job-action job-action-run";
      button.textContent = "Run";
      button.addEventListener("click", async () => {
        updateJobStatus(ctx.state, job.store, job.id, "running");
        refresh();
        try {
          const result = await runJob(job, ctx.state);
          completeJob(ctx.state, job.store, job.id, result, "completed");
        } catch (error) {
          completeJob(
            ctx.state,
            job.store,
            job.id,
            {
              runner: "word-map-refresh-v1",
              processed_at: new Date().toISOString(),
              message: error?.message || "Job failed.",
            },
            "failed",
          );
        }
        refresh();
      });
      parent.append(button);
    };

    const renderJob = (li, job) => {
      li.className = "job-entry job-entry-friendly";
      const top = document.createElement("div");
      top.className = "job-entry-top";
      const type = document.createElement("span");
      type.className = "job-type";
      type.textContent = job.type;
      const status = document.createElement("span");
      status.className = `job-status ${job.state}`;
      status.textContent = stateLabel(job.state);
      top.append(type, status);

      const friendly = document.createElement("p");
      friendly.className = "job-friendly-summary";
      friendly.textContent = jobFriendlySummary(job);

      const meta = document.createElement("div");
      meta.className = "reference-meta";
      meta.textContent = `${job.store} - ${job.created_at}`;

      const actions = document.createElement("div");
      actions.className = "job-actions";
      if (job.state === "queued") {
        addJobAction(actions, job, "Plan Review", "planned", "job-action-review");
      }
      if ((job.state === "queued" || job.state === "planned") && canRunJob(job)) {
        addRunAction(actions, job);
      }
      if (job.state !== "simulation_only") {
        addJobAction(actions, job, "Simulate", "simulation_only", "job-action-process");
      }
      if (job.state !== "queued") {
        addJobAction(actions, job, "Requeue", "queued", "job-action-requeue");
      }

      const details = document.createElement("details");
      details.className = "technical-details-panel";
      const detailsSummary = document.createElement("summary");
      detailsSummary.textContent = "Technical details";
      const payload = document.createElement("pre");
      payload.className = "job-payload";
      payload.textContent = JSON.stringify(job.payload || {}, null, 2);
      details.append(detailsSummary, payload);

      li.append(top, friendly, meta, actions, details);

      if (job.result) {
        const resultDetails = document.createElement("details");
        resultDetails.className = "technical-details-panel";
        const resultSummary = document.createElement("summary");
        resultSummary.textContent = "Result details";
        const result = document.createElement("pre");
        result.className = "job-payload job-result";
        result.textContent = JSON.stringify(job.result, null, 2);
        resultDetails.append(resultSummary, result);
        li.append(resultDetails);
      }
    };

    const states = [
      ["queued", "Queued"],
      ["planned", "Planned"],
      ["simulation_only", "Simulation-only"],
      ["running", "Running"],
      ["completed", "Completed"],
      ["failed", "Failed"],
    ];
    const rendered = new Set();
    states.forEach(([state, label]) => {
      const group = jobs.filter((job) => job.state === state).slice(0, 80);
      if (!group.length) return;
      group.forEach((job) => rendered.add(job.id));
      const section = document.createElement("section");
      section.className = "local-processing-section";
      const title = document.createElement("h4");
      title.textContent = `${label} (${group.length})`;
      section.append(title, createDetailList(group, renderJob));
      wrap.append(section);
    });

    const other = jobs.filter((job) => !rendered.has(job.id)).slice(0, 80);
    if (other.length) {
      const section = document.createElement("section");
      section.className = "local-processing-section";
      const title = document.createElement("h4");
      title.textContent = `Other (${other.length})`;
      section.append(title, createDetailList(other, renderJob));
      wrap.append(section);
    }

    return wrap;
}

export function createJobsView(ctx) {
  return function showJobs() {
    const wrap = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = "Local Processing";
    wrap.append(heading);
    const refresh = () => showJobs();
    wrap.append(renderJobsDiagnostics(ctx, refresh));
    setDetail("Local Processing", wrap, { viewId: DETAIL_VIEW_IDS.localProcessing });
  };
}
