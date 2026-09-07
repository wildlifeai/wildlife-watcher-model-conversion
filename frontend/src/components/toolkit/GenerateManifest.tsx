import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useJob } from '../../hooks/useJob'
import { ErrorBanner } from '../common'

type Step = 'configure' | 'generating' | 'ready'

export function GenerateManifest() {
  const { user } = useAuth()

  const [step, setStep] = useState<Step>('configure')
  const [jobId, setJobId] = useState<string | null>(null)

  // Project-based state
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedFirmwareId, setSelectedFirmwareId] = useState<string>('')

  // Fetch Himax firmware versions from DB
  const { data: firmwares, isLoading: isLoadingFirmwares } = useQuery({
    queryKey: ['himaxFirmwares'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('firmware')
        .select('id, name, version, is_active, created_at, camera_variant')
        .eq('type', 'himax')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    }
  })

  // Derive active/fallback firmware ID if none is explicitly selected
  const himaxFirmwareId = useMemo(() => {
    if (selectedFirmwareId) return selectedFirmwareId
    if (!firmwares?.length) return ''
    const active = firmwares.find((f: any) => f.is_active)
    return active ? active.id : firmwares[0].id
  }, [firmwares, selectedFirmwareId])

  const selectedFirmware = useMemo(() => {
    if (!firmwares || !himaxFirmwareId) return null
    return firmwares.find((f: any) => f.id === himaxFirmwareId)
  }, [firmwares, himaxFirmwareId])

  // Fetch accessible projects
  const { data: projects, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['allProjects', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, model_id, ai_models(id, name, version, model_family_id, version_number, ai_model_families(firmware_model_id)), organisations(name)')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!user
  })

  // Auto-select first project
  useEffect(() => {
    if (projects?.length && !selectedProjectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedProjectId(projects[0].id)
    } else if (projects && !projects.length) {
      setSelectedProjectId('')
    }
  }, [projects, selectedProjectId])

  // Resolve model info from selected project
  const projectModelInfo = useMemo(() => {
    if (!projects || !selectedProjectId) return null
    const project = projects.find((p: any) => p.id === selectedProjectId) as any
    if (!project) return null
    if (!project.model_id || !project.ai_models) return { hasModel: false }

    const model = project.ai_models
    const family = model.ai_model_families
    const fwId = family?.firmware_model_id
    const verNum = model.version_number

    if (!fwId || !verNum) return { hasModel: true, incomplete: true, name: model.name }

    return {
      hasModel: true,
      incomplete: false,
      name: model.name,
      version: model.version,
      firmwareModelId: fwId,
      versionNumber: verNum,
      filename: `${fwId}V${verNum}.TFL`,
    }
  }, [projects, selectedProjectId])

  // Poll job status
  const { data: job } = useJob(jobId)

  // Auto-transition to 'ready' when job completes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (job && (job.status === 'completed' || job.status === 'completed_with_errors') && step === 'generating') {
      setStep('ready')
    }
  }, [job, step])
  /* eslint-enable react-hooks/set-state-in-effect */

  const generateMutation = useMutation({
    mutationFn: () => {
      return apiClient.post('/api/manifest/generate', {
        model_source: 'My Project',
        model_name: projectModelInfo?.name || 'None',
        project_id: selectedProjectId,
        github_branch: 'main',
        himax_firmware_id: himaxFirmwareId,
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (response: any) => {
      setJobId(response.data?.job_id)
      setStep('generating')
    },
  })

  const formIsValid = () => {
    if (!selectedProjectId) return false
    if (projectModelInfo?.incomplete) return false
    return true
  }

  const handleReset = () => {
    setJobId(null)
    setStep('configure')
    generateMutation.reset()
    setSelectedFirmwareId('')
  }

  // Get the selected project name for the summary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedProject = projects?.find((p: any) => p.id === selectedProjectId) as any

  const selectStyle = {
    width: '100%',
    padding: '0.5rem',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface)',
    color: 'var(--text-color)',
  }

  const labelStyle = {
    display: 'block' as const,
    fontSize: '0.8125rem',
    fontWeight: 500,
    marginBottom: '0.25rem',
  }

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Prepare SD Card</h3>
      <p style={{ opacity: 0.7, marginBottom: '1.5rem', lineHeight: 1.5 }}>
        While the mobile app can update your camera wirelessly, AI Models and System Software are large files that take a long time to send over Bluetooth.
        <br/><br/>
        For the fastest setup, download this package to your computer and move it to your SD card. When you insert the card into your Wildlife Watcher, it will instantly recognize the files and skip the long wireless wait.
      </p>

      {/* ── Step indicator ──────────────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '1.5rem',
        fontSize: '0.8125rem',
      }}>
        {(['configure', 'generating', 'ready'] as Step[]).map((s, i) => {
          const labels = ['1. Configure', '2. Generating', '3. Ready']
          const isActive = s === step
          const isDone = (step === 'generating' && i === 0) || (step === 'ready' && i < 2)
          return (
            <div
              key={s}
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius)',
                textAlign: 'center',
                fontWeight: isActive ? 600 : 400,
                backgroundColor: isActive ? 'var(--primary)' : isDone ? 'rgba(76,175,80,0.12)' : 'var(--surface)',
                color: isActive ? '#fff' : isDone ? 'var(--success, #4caf50)' : 'var(--text-color)',
                border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                opacity: isActive || isDone ? 1 : 0.5,
                transition: 'all 0.2s ease',
              }}
            >
              {isDone ? '✓ ' : ''}{labels[i]}
            </div>
          )
        })}
      </div>

      {/* ── Step 1: Configure ──────────────────────────────── */}
      {step === 'configure' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem', maxWidth: '600px' }}>
          <div style={{ padding: '1rem', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {!user ? (
                <div style={{ padding: '0.5rem', color: 'var(--warning, #f59e0b)' }}>
                  Please log in to access your projects.
                </div>
              ) : (
                <>
                  {/* Firmware selector */}
                  <div>
                    <label style={labelStyle}>Himax Firmware Version</label>
                    {isLoadingFirmwares ? (
                      <div style={{ padding: '0.5rem', opacity: 0.6 }}>Loading firmwares from database...</div>
                    ) : (
                      <select
                        value={himaxFirmwareId}
                        onChange={(e) => setSelectedFirmwareId(e.target.value)}
                        style={selectStyle}
                      >
                        {(firmwares || []).map((f: any) => (
                          <option key={f.id} value={f.id}>
                            {f.camera_variant ? `[${f.camera_variant}] ` : ''}{f.name} {f.is_active ? ' (Active)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>
                      Select the Himax firmware version to deploy to the camera. The MANIFEST
                      includes BOTH camera variants (RP3 colour + HM0360 night/IR) when available:
                      the selected image plus the latest active image of the other variant.
                    </p>
                  </div>

                  {/* Project selector */}
                  <div>
                    <label style={labelStyle}>Project & Species Brain</label>
                    {isLoadingProjects ? (
                      <div style={{ padding: '0.5rem', opacity: 0.6 }}>Loading projects…</div>
                    ) : projects && projects.length > 0 ? (
                      <select
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                        style={selectStyle}
                      >
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {projects.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.organisations?.name ? `(${p.organisations.name})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ padding: '0.5rem', color: 'var(--error)' }}>
                        No accessible projects found.
                      </div>
                    )}
                    <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>
                      Choose which project this camera belongs to. This includes the project's Species Brain — the Camera AI model that identifies animals on the device.
                    </p>
                  </div>

                  {/* Model info (read-only) */}
                  {projectModelInfo && (
                    <div style={{
                      borderTop: '1px solid var(--border)',
                      paddingTop: '1rem',
                      marginTop: '0.5rem',
                    }}>
                      {projectModelInfo.hasModel ? (
                        projectModelInfo.incomplete ? (
                          <div style={{ color: 'var(--warning, #f59e0b)' }}>
                            ⚠️ Model <strong>{projectModelInfo.name}</strong> is missing firmware IDs.
                            Please ensure it has a model family and version number assigned.
                          </div>
                        ) : (
                          <div>
                            <h4 style={{ marginBottom: '0.5rem' }}>✅ Model Info</h4>
                            <div style={{ fontSize: '0.8125rem', display: 'grid', gap: '0.25rem' }}>
                              <div><strong>Model:</strong> {projectModelInfo.name} v{projectModelInfo.version}</div>
                              <div><strong>Firmware ID (OP 14):</strong> <code>{projectModelInfo.firmwareModelId}</code></div>
                              <div><strong>Version (OP 15):</strong> <code>{projectModelInfo.versionNumber}</code></div>
                              <div><strong>Filename:</strong> <code>{projectModelInfo.filename}</code></div>
                            </div>
                          </div>
                        )
                      ) : (
                        <div style={{ fontSize: '0.8125rem', opacity: 0.8, color: 'var(--primary)' }}>
                          🤖 <strong>Note on AI Identification:</strong>
                          <br/>
                          This project doesn't have an AI model assigned yet. The setup folder will include the camera system and settings, but it won't be able to identify species automatically. You can add a "Species Brain" later via the Project Settings in the app.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Generate button */}
          <div>
            <button
              className="btn"
              disabled={generateMutation.isPending || !formIsValid()}
              onClick={() => generateMutation.mutate()}
              style={{ padding: '0.75rem 2rem' }}
            >
              {generateMutation.isPending ? '⏳ Submitting…' : '📦 Generate Setup Folder'}
            </button>
          </div>

          {generateMutation.isError && (
            <ErrorBanner error={{ message: (generateMutation.error as Error).message, retryable: true }} onRetry={() => generateMutation.mutate()} />
          )}
        </div>
      )}

      {/* ── Step 2: Generating ─────────────────────────────── */}
      {step === 'generating' && (
        <div style={{ maxWidth: '600px' }}>
          <div style={{
            padding: '1.5rem',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '1.25rem', animation: 'spin 1s linear infinite' }}>⚙️</div>
              <div>
                <div style={{ fontWeight: 600 }}>Generating setup folder…</div>
                <div style={{ fontSize: '0.8125rem', opacity: 0.7 }}>
                  {selectedProject?.name} • {selectedFirmware?.name || 'Loading...'}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            {job && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8125rem' }}>
                  <span>{job.message || job.status}</span>
                  <span>{Math.round(job.progress * 100)}%</span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'var(--border)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${job.progress * 100}%`,
                    height: '100%',
                    backgroundColor: job.status === 'failed' ? 'var(--error)' : 'var(--primary)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </>
            )}

            {job?.status === 'failed' && (
              <div style={{ marginTop: '1rem' }}>
                <ErrorBanner error={{ message: 'Generation failed', details: job.error, retryable: true }} onRetry={handleReset} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Ready ──────────────────────────────────── */}
      {step === 'ready' && job && (
        <div style={{ maxWidth: '600px' }}>

          {/* Success summary card */}
          <div style={{
            padding: '1.5rem',
            backgroundColor: 'rgba(76,175,80,0.06)',
            border: '1px solid rgba(76,175,80,0.3)',
            borderRadius: 'var(--radius)',
            marginBottom: '1.5rem',
          }}>
            <div style={{ fontWeight: 600, fontSize: '1.0625rem', marginBottom: '0.75rem', color: 'var(--primary)' }}>
              ✅ Setup folder ready!
            </div>

            <div style={{ fontSize: '0.8125rem', display: 'grid', gap: '0.375rem', marginBottom: '1.25rem' }}>
              <div><strong>Project:</strong> {selectedProject?.name}</div>
              {projectModelInfo?.hasModel && !projectModelInfo.incomplete && (
                <div><strong>AI Model:</strong> {projectModelInfo.name} v{projectModelInfo.version}</div>
              )}
              <div><strong>Himax Firmware:</strong> {selectedFirmware?.name}</div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {job.result_url && (
                <a
                  href={job.result_url}
                  className="btn"
                  style={{ textDecoration: 'none', display: 'inline-block', padding: '0.625rem 1.5rem' }}
                >
                  📥 Download Setup Folder
                </a>
              )}
              <button
                onClick={handleReset}
                style={{
                  padding: '0.625rem 1.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                🔄 Generate New Setup
              </button>
            </div>
          </div>

          {/* Next Steps checklist */}
          <div style={{
            padding: '1.5rem',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--primary)',
            borderRadius: 'var(--radius)',
          }}>
            <h4 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--primary)' }}>Next Steps Checklist:</h4>
            <ul style={{ listStyleType: 'none', paddingLeft: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <li><label style={{ cursor: 'pointer' }}><input type="checkbox" style={{ marginRight: '0.5rem' }} /> Unzip the downloaded folder.</label></li>
              <li><label style={{ cursor: 'pointer' }}><input type="checkbox" style={{ marginRight: '0.5rem' }} /> Copy the "MANIFEST" folder with its contents as it is to the root of your SD card.</label></li>
              <li><label style={{ cursor: 'pointer' }}><input type="checkbox" style={{ marginRight: '0.5rem' }} /> Insert the card in your Wildlife Watcher and power on the device.</label></li>
              <li><label style={{ cursor: 'pointer' }}><input type="checkbox" style={{ marginRight: '0.5rem' }} /> Connect the device with your app and start monitoring.</label></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
