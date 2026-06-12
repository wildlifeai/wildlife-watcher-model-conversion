// Copyright (c) 2024
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Shared deployment-table types + styles. (The old per-row DeploymentActionRow /
// OverflowMenu components were retired when the Deployments table moved to row
// selection + a bulk-action dropdown — see DeploymentBulkActions.)

export interface DeploymentRow {
  id: string
  project_id: string
  project_name?: string
  device_name?: string
  location_name: string | null
  latitude: number | null
  longitude: number | null
  deployment_start: string | null
  deployment_end: string | null
  created_at: string
  observation_count?: number
}

// Shared compact button style for deployment/project row actions.
export const NAV_BTN: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  fontSize: '0.75rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  backgroundColor: 'transparent',
  color: 'var(--primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
