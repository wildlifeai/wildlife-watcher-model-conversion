import { AnalyseImages } from '../components/toolkit/AnalyseImages'

export function UploadDataPage() {
  return (
    <div>
      <AnalyseImages />
    </div>
  )
}

/** @deprecated — kept for backward-compatible import in App.tsx redirect */
export { UploadDataPage as AnalyseImagesPage }
