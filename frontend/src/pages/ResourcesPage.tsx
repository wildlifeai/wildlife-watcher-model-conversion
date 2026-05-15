import { useState } from 'react'

const sections = [
  { id: 'whats-in-box',   label: "📦 What's in the Box",   emoji: '📦' },
  { id: 'camera-setup',   label: '📷 Camera Setup',         emoji: '📷' },
  { id: 'mobile-app',     label: '📱 Mobile App',           emoji: '📱' },
  { id: 'deployment',     label: '🚀 Starting a Deployment',emoji: '🚀' },
  { id: 'ai-models',      label: '🤖 AI Models',            emoji: '🤖' },
  { id: 'image-analysis', label: '🔬 Image Analysis',       emoji: '🔬' },
  { id: 'maintenance',    label: '🔧 Maintenance',           emoji: '🔧' },
  { id: 'researchers',    label: '📊 For Researchers',      emoji: '📊' },
]

function SidebarLink({ label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '0.6rem 1rem', border: 'none', borderRadius: 'var(--radius)',
        background: active ? 'var(--primary)' : 'transparent',
        color: active ? '#fff' : 'var(--text-color)',
        cursor: 'pointer', fontSize: '0.875rem', fontWeight: active ? 600 : 400,
        transition: 'background 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: '3rem' }}>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--primary)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'flex-start' }}>
      <span style={{
        minWidth: '2rem', height: '2rem', borderRadius: '50%',
        background: 'var(--primary)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.8rem', fontWeight: 700, flexShrink: 0,
      }}>{n}</span>
      <div style={{ paddingTop: '0.2rem', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '0.75rem 1rem', borderLeft: '3px solid var(--primary)',
      background: 'var(--surface)', borderRadius: '0 var(--radius) var(--radius) 0',
      fontSize: '0.875rem', margin: '1rem 0', lineHeight: 1.6,
    }}>{children}</div>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: '1.1rem', marginTop: '1.5rem', marginBottom: '0.75rem' }}>{children}</h3>
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {items.map((item, i) => <li key={i} style={{ lineHeight: 1.6 }}>{item}</li>)}
    </ul>
  )
}

export function ResourcesPage() {
  const [active, setActive] = useState('whats-in-box')

  const scrollTo = (id: string) => {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📚 Resources & How-To Guides</h1>
        <p style={{ opacity: 0.7, maxWidth: '640px', lineHeight: 1.6 }}>
          Everything you need to set up, deploy, and analyse data from your Wildlife Watcher camera.
          From unboxing to AI-powered species identification — all in one place.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', alignItems: 'start' }}>

        {/* Sidebar */}
        <aside style={{
          position: 'sticky', top: '1rem',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '0.75rem',
          display: 'flex', flexDirection: 'column', gap: '0.25rem',
        }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, opacity: 0.5, padding: '0.25rem 1rem 0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contents</div>
          {sections.map(s => (
            <SidebarLink key={s.id} id={s.id} label={s.label} active={active === s.id} onClick={() => scrollTo(s.id)} />
          ))}
        </aside>

        {/* Content */}
        <div style={{ minWidth: 0 }}>

          <Section id="whats-in-box" title="📦 What's in the Box">
            <p style={{ lineHeight: 1.7, marginBottom: '1rem' }}>
              Your Wildlife Watcher package includes everything needed to get started monitoring wildlife straight away.
            </p>
            <H3>Included in the box</H3>
            <Ul items={['Smart AI camera unit', 'Stand and mounting bracket', 'USB charging cable', 'User Manual']} />
            <H3>Optional add-ons</H3>
            <Ul items={['Solar panel, AA batteries, or external battery pack', 'SD card (up to 128 GB recommended)', 'Bait holder', 'Wildlife platform', 'Mounting straps and clasps']} />
            <Note>💡 The SD card is not always included. We recommend a Class 10 microSD card of at least 32 GB.</Note>
          </Section>

          <Section id="camera-setup" title="📷 Camera Setup">
            <H3>1. Powering the camera</H3>
            <p style={{ lineHeight: 1.7, marginBottom: '0.75rem' }}>The Wildlife Watcher supports three power modes:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
              {[
                { title: '🔋 Battery Pack', desc: 'Charge the internal battery fully using the included USB cable before deployment.' },
                { title: '🔌 AA Batteries', desc: 'Use high-quality AA batteries. Premium alkaline or lithium batteries will last longest in the field.' },
                { title: '☀️ Solar Panel', desc: 'Connect the optional solar panel and position it in a well-lit area to keep the camera running indefinitely.' },
              ].map(p => (
                <div key={p.title} style={{ padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <strong style={{ display: 'block', marginBottom: '0.4rem' }}>{p.title}</strong>
                  <span style={{ fontSize: '0.875rem', opacity: 0.8, lineHeight: 1.6 }}>{p.desc}</span>
                </div>
              ))}
            </div>

            <H3>2. Inserting the SD card</H3>
            <Step n={1}>Open the SD card slot cover on the camera body.</Step>
            <Step n={2}>Insert the SD card with the contacts facing inward.</Step>
            <Step n={3}>Close the slot cover securely.</Step>

            <H3>3. Mounting the camera</H3>
            <p style={{ lineHeight: 1.7, marginBottom: '0.75rem' }}>Choose your mounting strategy based on the target species and terrain:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              {[
                { title: 'Ground-facing (downward view)', steps: ['Use the included stand to place the device securely facing the ground', 'Adjust the angle to cover the desired field of view', 'Fix the wildlife platform in the camera view', 'Set up any bait or attractants'] },
                { title: 'Tree / post mount', steps: ['Use straps and mounting clasps to fix to a tree trunk or post', 'Adjust the angle to capture the target zone', 'Ensure the camera is level and stable', 'Clear any obstructions (branches, leaves) from the field of view'] },
              ].map(m => (
                <div key={m.title} style={{ padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <strong style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>{m.title}</strong>
                  <ul style={{ paddingLeft: '1rem', margin: 0, fontSize: '0.85rem', lineHeight: 1.7 }}>
                    {m.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              ))}
            </div>

            <H3>4. Additional external camera (optional)</H3>
            <Ul items={[
              'Plug the additional camera into the USB port on the Wildlife Watcher.',
              'Specify which camera to use when starting a deployment in the app.',
              'Verify the connection using the Camera Testing section in the app.',
            ]} />
          </Section>

          <Section id="mobile-app" title="📱 Mobile App">
            <p style={{ lineHeight: 1.7, marginBottom: '1rem' }}>
              The Wildlife Watcher companion app is the primary way to configure, control, and monitor your cameras.
              It connects via Bluetooth and is available for iOS and Android.
            </p>

            <H3>Installing the app</H3>
            <Step n={1}>Open the App Store (iOS) or Google Play (Android) on your phone.</Step>
            <Step n={2}>Search for <strong>Wildlife Watcher</strong> and install the app.</Step>
            <Step n={3}>Open the app and create an account or log in.</Step>

            <H3>Creating an account</H3>
            <Ul items={[
              'Tap "Create Account" on the login screen.',
              'Enter your email address and choose a strong password.',
              'Verify your email address via the confirmation link sent to your inbox.',
              'Log in with your new credentials.',
            ]} />

            <H3>Connecting to a camera</H3>
            <Step n={1}>Power on your Wildlife Watcher camera.</Step>
            <Step n={2}>Enable Bluetooth on your phone.</Step>
            <Step n={3}>In the app, go to the <strong>Devices</strong> section.</Step>
            <Step n={4}>Your camera should appear in the list — tap it to pair.</Step>
            <Step n={5}>Once connected, you can check battery level, SD card space, and install firmware updates.</Step>

            <H3>Before your first deployment</H3>
            <Ul items={[
              'Check the battery level — replace or recharge if low.',
              'Check SD card available space — format if needed.',
              'Install any available firmware updates.',
              'Test the camera preview to verify field of view.',
            ]} />
            <Note>💡 Always test the camera before heading into the field to avoid wasted trips.</Note>
          </Section>

          <Section id="deployment" title="🚀 Starting a Deployment">
            <p style={{ lineHeight: 1.7, marginBottom: '1rem' }}>
              A deployment is a monitored camera session linked to a specific project and location.
              All images captured during a deployment are stored and can be reviewed in the app.
            </p>

            <H3>Starting a deployment</H3>
            <Step n={1}>Mount and power on the camera in the field.</Step>
            <Step n={2}>Open the app and connect to the camera via Bluetooth.</Step>
            <Step n={3}>Tap <strong>Start Deployment</strong>.</Step>
            <Step n={4}>Fill in the required details:
              <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', lineHeight: 1.7 }}>
                <li>Project name</li>
                <li>Deployment name / label</li>
                <li>Location — use your current GPS position or enter latitude/longitude manually</li>
                <li>Capture mode — motion detection or time-lapse</li>
                <li>Image quality setting</li>
              </ul>
            </Step>
            <Step n={5}>Take a test snapshot to verify the camera field of view.</Step>
            <Step n={6}>Optionally take a photo of the camera location for reference.</Step>
            <Step n={7}>Confirm — the camera will begin monitoring automatically.</Step>

            <H3>Ending a deployment</H3>
            <Step n={1}>Open the app and connect to the camera.</Step>
            <Step n={2}>Go to the active deployment and tap <strong>End Deployment</strong>.</Step>
            <Step n={3}>Confirm the termination — data is preserved on the SD card.</Step>

            <H3>Motion detection & AI recognition</H3>
            <Ul items={[
              'The camera detects motion and automatically captures images of wildlife activity.',
              'An on-device AI model identifies species in real time.',
              'Infrared sensors enable high-quality capture in low-light and night conditions.',
              'The camera automatically switches to night mode when ambient light drops.',
              'Local storage supports microSD cards up to 128 GB.',
            ]} />
          </Section>

          <Section id="ai-models" title="🤖 AI Models">
            <p style={{ lineHeight: 1.7, marginBottom: '1rem' }}>
              Wildlife Watcher uses on-device machine learning models to identify species without an internet connection.
              Models can be managed through the web toolkit and uploaded to your camera via the app.
            </p>

            <H3>How models work</H3>
            <Ul items={[
              'Models run directly on the camera chip — no connectivity required in the field.',
              'Each project can have a different model assigned for different target species.',
              'Models are trained using Edge Impulse and compiled for the Wildlife Watcher hardware.',
              'Organisation managers can upload custom or pre-trained models via the web toolkit.',
            ]} />

            <H3>Uploading a model to your camera</H3>
            <Step n={1}>Go to <strong>Upload Model</strong> in the web toolkit (requires Organisation Manager role).</Step>
            <Step n={2}>Select your model source: Custom Upload, Pre-trained, or SenseCap Zoo.</Step>
            <Step n={3}>Submit — the model is processed and associated with your organisation.</Step>
            <Step n={4}>In the mobile app, go to <strong>Devices</strong> and select your camera.</Step>
            <Step n={5}>If a model is already loaded, remove it first.</Step>
            <Step n={6}>Select the new model from your files and upload it.</Step>
            <Step n={7}>Verify that the correct model name appears on the device screen.</Step>
            <Note>💡 After uploading, always do a quick test capture to confirm the model is detecting correctly before leaving the field.</Note>

            <H3>Preparing the SD card with firmware & model (fastest method)</H3>
            <p style={{ lineHeight: 1.7, marginBottom: '0.75rem' }}>
              For large models, Bluetooth transfer can be slow. The fastest way is to write the files directly to the SD card on your computer:
            </p>
            <Step n={1}>Go to <strong>Prepare SD Card</strong> in the web toolkit.</Step>
            <Step n={2}>Select your project and software version.</Step>
            <Step n={3}>Click <strong>Download Setup Folder</strong>.</Step>
            <Step n={4}>Unzip the downloaded file.</Step>
            <Step n={5}>Copy the <code>MANIFEST</code> folder (with its contents) to the root of your SD card.</Step>
            <Step n={6}>Insert the SD card into the Wildlife Watcher and power it on — it will detect and apply the files automatically.</Step>
          </Section>

          <Section id="image-analysis" title="🔬 Image Analysis with AddaxAI">
            <p style={{ lineHeight: 1.7, marginBottom: '1rem' }}>
              After collecting images from the field, you can use <strong>AddaxAI</strong> — a free, open-source tool — to
              run AI-powered species detection and generate analysis reports.
            </p>

            <H3>What AddaxAI provides</H3>
            <Ul items={[
              'Batch species detection across all collected images.',
              'Spatial distribution maps showing where detections occurred (using EXIF GPS data).',
              'Pie charts showing detection distribution by species.',
              'Export to CSV, Excel, or CamTrapDP format for further analysis.',
            ]} />

            <H3>Step-by-step workflow</H3>
            <Step n={1}>Remove the SD card from the camera and insert it into your computer.</Step>
            <Step n={2}>Copy the deployment folder to your computer. Images follow this structure:
              <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem', marginTop: '0.5rem', lineHeight: 1.8 }}>
                images/<br/>
                &nbsp;&nbsp;image_0001_2025-01-02.jpg<br/>
                &nbsp;&nbsp;image_0002_2025-01-02.jpg<br/>
                &nbsp;&nbsp;image_0003_2025-01-02.jpg
              </div>
            </Step>
            <Step n={3}>Open AddaxAI and drag-and-drop the deployment folder into the application.</Step>
            <Step n={4}>Select a detection model (e.g. MegaDetector for general wildlife).</Step>
            <Step n={5}>Run the analysis — AddaxAI will process each image.</Step>
            <Step n={6}>(Optional) Manually review and correct annotations.</Step>
            <Step n={7}>(Optional) Run post-processing to generate reports and charts.</Step>

            <H3>Output files</H3>
            <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem', marginBottom: '1rem', lineHeight: 1.8 }}>
              addaxAI_results/<br/>
              &nbsp;&nbsp;results_detections.csv &nbsp;← per-image detection results with EXIF data<br/>
              &nbsp;&nbsp;results_files.csv &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← summary per image file<br/>
              &nbsp;&nbsp;results_summary.csv &nbsp;&nbsp;&nbsp;← total detections by species<br/>
              &nbsp;&nbsp;graphs/<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;maps/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← interactive HTML maps by location<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;pie-charts/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← species distribution charts
            </div>
            <Note>
              💡 AddaxAI reads the GPS coordinates embedded in image EXIF data to generate accurate location maps.
              Ensure GPS is enabled on the camera before deployment for best results.
            </Note>

            <H3>Download AddaxAI</H3>
            <p style={{ lineHeight: 1.7 }}>
              AddaxAI is free and open source.{' '}
              <a href="https://addaxdatascience.com/addaxai/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                Download AddaxAI →
              </a>
            </p>
          </Section>

          <Section id="maintenance" title="🔧 Maintenance & Troubleshooting">
            <H3>Regular maintenance</H3>
            <Ul items={[
              'Clean the lens and sensor area regularly with a soft, dry cloth.',
              'Keep firmware updated via the app for security and performance improvements.',
              'Check battery connections and solar panel cables periodically.',
              'Format the SD card after each deployment to free up space.',
              'Inspect mounting straps and clasps for wear after extended outdoor use.',
            ]} />

            <H3>Troubleshooting common issues</H3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[
                {
                  issue: 'Camera not turning on',
                  fix: 'Ensure the battery is fully charged. Try removing and reinserting the battery pack. If using AA batteries, replace them with fresh high-quality batteries.',
                },
                {
                  issue: 'App not connecting via Bluetooth',
                  fix: 'Restart both the camera and your mobile device. Ensure Bluetooth is enabled. Move closer to the camera and retry pairing from the Devices screen.',
                },
                {
                  issue: 'Blurred or dark images',
                  fix: 'Clean the lens with a soft cloth. Ensure the camera is mounted securely without vibration. Check that no branches or vegetation are in the field of view.',
                },
                {
                  issue: 'SD card not detected',
                  fix: 'Remove and reinsert the SD card. Ensure it is formatted as FAT32 or exFAT. Try formatting the card via the app settings.',
                },
                {
                  issue: 'AI model not detecting species',
                  fix: 'Verify the correct model is loaded in the Devices section of the app. Ensure the camera has a clear, unobstructed view. Check that the firmware is up to date.',
                },
              ].map(({ issue, fix }) => (
                <div key={issue} style={{ padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <strong style={{ color: 'var(--primary)', display: 'block', marginBottom: '0.35rem' }}>⚠️ {issue}</strong>
                  <span style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>{fix}</span>
                </div>
              ))}
            </div>

            <H3>Still need help?</H3>
            <p style={{ lineHeight: 1.7 }}>
              Visit our <a href="/support" style={{ color: 'var(--primary)' }}>Support page</a> for FAQs
              or contact us at <a href="mailto:contact@wildlife.ai" style={{ color: 'var(--primary)' }}>contact@wildlife.ai</a>.
            </p>
          </Section>

          <Section id="researchers" title="📊 For Researchers & Data Analysts">
            <p style={{ lineHeight: 1.7, marginBottom: '1rem' }}>
              The Wildlife Watcher ecosystem includes open-source Python tools for programmatic data manipulation,
              format conversion, and integration with biodiversity databases.
            </p>

            <H3>wai_data_tools</H3>
            <p style={{ lineHeight: 1.7, marginBottom: '0.75rem' }}>
              A Python library and collection of Jupyter notebooks for working with Wildlife Watcher data.
              MIT licensed and freely available on GitHub.
            </p>
            <Ul items={[
              'Parse and extract EXIF metadata from camera images.',
              'Convert deployments to CamTrapDP format for sharing with biodiversity databases.',
              'Batch export and analyse detection results.',
              'Integrate with iNaturalist and other species databases.',
            ]} />
            <a
              href="https://github.com/wildlifeai/wai_data_tools"
              target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-block', padding: '0.5rem 1.25rem',
                background: 'var(--primary)', color: '#fff', borderRadius: 'var(--radius)',
                textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600, marginBottom: '1.5rem',
              }}
            >
              View wai_data_tools on GitHub →
            </a>

            <H3>Case study: Gecko monitoring</H3>
            <p style={{ lineHeight: 1.7, marginBottom: '1rem' }}>
              Read how researchers used Wildlife Watcher cameras and analysis tools to monitor gecko populations —
              including how they chose the right software pipeline for their images.
            </p>
            <a
              href="https://wildlife.ai/gecko-monitoring-choosing-the-right-software-to-analyse-wildlife-watcher-photos/"
              target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-block', padding: '0.5rem 1.25rem',
                border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: 'var(--radius)',
                textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600, marginBottom: '1.5rem',
              }}
            >
              Read the gecko monitoring case study →
            </a>

            <H3>Full user guide PDF downloads</H3>
            <p style={{ lineHeight: 1.7, marginBottom: '0.75rem' }}>
              All guides are available as downloadable PDFs from the Wildlife Watcher documentation site:
            </p>
            <a
              href="https://wildlifeai.github.io/wildlife-watcher-user-guide/"
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--primary)' }}
            >
              wildlifeai.github.io/wildlife-watcher-user-guide →
            </a>
          </Section>

        </div>
      </div>
    </div>
  )
}
