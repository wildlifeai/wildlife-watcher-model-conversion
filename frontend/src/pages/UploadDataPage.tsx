import { UploadFlow } from '../components/upload/UploadFlow'

/**
 * /upload-data, the single upload surface. The header Upload button, Home and
 * the three-step guide all link here. The flow itself (drop zone, deployment
 * resolution, triage, CamtrapDP import) lives in UploadFlow; the progress dock
 * and the redirect to Annotations take over once an upload starts.
 */
export function UploadDataPage() {
  return (
    <div>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>Upload data</h2>
      <p style={{ margin: '0 0 1.5rem', opacity: 0.7, fontSize: '0.875rem', maxWidth: '72ch' }}>
        Drop a <strong>media folder</strong> from a Wildlife Watcher SD card, or a{' '}
        <strong>CamtrapDP package</strong> (.zip) exported from another camera-trap tool.
        Photos are matched to their deployment from the id the camera wrote into each frame,
        saved to Google Drive and run through the AI pipeline.
      </p>
      <UploadFlow />
    </div>
  )
}
