// Copyright (c) 2026
// SPDX-License-Identifier: GPL-3.0-or-later
/** Pure helpers over PipelineState — kept out of the component file so they can be shared
 *  (e.g. the Insights live banner) without tripping react-refresh's component-only rule. */
import type { PipelineState } from './PipelineStatusBox'

const TERMINAL_STATUSES = ['completed', 'completed_with_errors', 'failed', 'skipped']

/**
 * The offloaded AI-analysis job(s). The upload spawns one via `child_job_id` and the dock
 * chains it in with `fileCount: 0` (it processes deployments, not a file count) — so a
 * 0-fileCount job is the analysis phase. Returns its aggregate progress and whether it's
 * still running: drives the "Analysing…" phase of the dock indicator and the Insights banner.
 */
export function aiAnalysisStatus(state: PipelineState): { active: boolean; progress: number } | null {
  const ai = state.jobs.filter((j) => j.fileCount === 0)
  if (ai.length === 0) return null
  const active = ai.some((j) => !TERMINAL_STATUSES.includes(j.status))
  const progress = ai.reduce((s, j) => s + Math.max(0, Math.min(1, j.progress || 0)), 0) / ai.length
  return { active, progress }
}
