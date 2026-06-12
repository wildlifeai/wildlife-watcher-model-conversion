/**
 * FaqPage — prospect-facing FAQ (/faq).
 *
 * Answers the questions someone *considering* Wildlife Watcher asks: what it
 * is, how it differs from other camera traps, how the AI works, and how to
 * get one. Questions from *existing users* (troubleshooting, account, export)
 * live on the Support page — keep the two audiences separate.
 */
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FaqItem } from '../components/common/FaqItem'

export function FaqPage() {
  const { hash } = useLocation()

  // React Router doesn't scroll to hashes, and a <details> target stays
  // collapsed — open and scroll to the linked question (e.g. /faq#buy).
  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(hash.slice(1))
    if (el) {
      el.setAttribute('open', '')
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hash])

  return (
    <div className="container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 0', lineHeight: '1.6' }}>
      <h1 style={{ marginBottom: '0.75rem' }}>Frequently Asked Questions</h1>

      <p style={{ opacity: 0.8 }}>
        The Wildlife Watcher is a compact camera designed to monitor invertebrates and small
        animals that traditional camera traps miss. It uses on-device AI to identify target
        species in the field, and an open-source website for easy data analysis and reporting.
      </p>

      {/* Project status — set expectations before anyone reaches for a credit card */}
      <div style={{
        padding: '0.875rem 1.125rem', margin: '1.25rem 0 2rem',
        borderLeft: '3px solid var(--primary)', background: 'var(--surface)',
        borderRadius: '0 var(--radius) var(--radius) 0', fontSize: '0.9375rem',
      }}>
        <strong>Project status:</strong> Wildlife Watcher is currently in a prototype phase.
        Devices are available to Beta testers — see{' '}
        <a href="#buy" style={{ color: 'var(--primary)' }}>Where can I buy one?</a>
      </div>

      <FaqItem q="What makes it different from other camera traps?">
        This compact camera is specifically designed for collecting data on small invertebrates
        and cold-blooded animals such as skinks and frogs — species that conventional
        thermal-trigger camera traps miss. The full workflow is open source, from the hardware
        designs to the web analysis platform.
      </FaqItem>

      <FaqItem q="How are the images and data processed?">
        Images are captured on a microSD card. The camera can run local AI models to flag target
        species in real time, and you can later upload the media folder to our{' '}
        <Link to="/" style={{ color: 'var(--primary)' }}>web toolkit</Link> for advanced
        analysis, annotation, and data visualisation.
      </FaqItem>

      <FaqItem q="How does the AI component work?">
        The Wildlife Watcher uses a two-tiered AI system to help you process images efficiently
        without draining your camera's battery:
        <ul style={{ paddingLeft: '1.25rem', margin: '0.75rem 0' }}>
          <li style={{ marginBottom: '0.5rem' }}>
            <strong>On-device AI (Edge AI):</strong> the camera runs a lightweight, highly
            specialised AI model. It focuses specifically on your target species of interest
            with medium accuracy, filtering and flagging relevant motion detections right in
            the field.
          </li>
          <li>
            <strong>Website AI (Cloud AI):</strong> when you upload your media folder to the web
            toolkit, a much more powerful AI model takes over. It is highly capable of
            identifying a wide variety of animals, though it acts as an assistant — human
            confirmation is still required during the review process to ensure data accuracy.
          </li>
        </ul>
      </FaqItem>

      <FaqItem q="What is the camera's focal length, and can I change it?">
        The main camera has a fixed <strong>3.04 mm</strong> lens (f/2.0) with a ~62° field of
        view — chosen for close-range monitoring: positioned 30–50 cm above a platform, it
        captures the whole platform at around 5–9 pixels per millimetre, enough detail to
        identify small invertebrates and lizards. The focal length itself can't be swapped
        (there's no lens mount), but the <strong>focus is adjustable</strong>: the threaded lens
        barrel can be rotated to focus at your platform distance instead of the factory setting
        (~1 m–infinity). Use the mobile app's live preview to fine-tune sharpness when you set up.
      </FaqItem>

      <FaqItem q="How long does the battery last?">
        Currently about <strong>one month</strong> in the field, on 4× double-A batteries.
      </FaqItem>

      <FaqItem q="Does it have a mobile app?">
        Yes — the app is available on the iOS App Store and Google Play. It connects to the
        camera via Bluetooth and is required to configure, control, and start your monitoring
        sessions. See the <Link to="/resources" style={{ color: 'var(--primary)' }}>Resources</Link>{' '}
        page for a setup guide.
      </FaqItem>

      <FaqItem q="Can it monitor rats and other pests?">
        Yes — you can use rat-detection models and other applications, but the camera is more
        specifically designed to capture images of invertebrates and cold-blooded creatures
        such as reptiles.
      </FaqItem>

      <FaqItem q="What SD card should I use?">
        We recommend a <strong>FAT32-formatted</strong> microSD card, <strong>32–64 GB</strong>{' '}
        (Class 10 or higher).
      </FaqItem>

      <FaqItem q="Is it free to use?">
        The web platform is free for conservation projects — Wildlife.ai is a charity whose
        mission is to accelerate conservation using AI, open source, and community-driven tools.
        See the <Link to="/support" style={{ color: 'var(--primary)' }}>Support page</Link> for
        details on plans as the platform grows.
      </FaqItem>

      <FaqItem q="Where can I buy one?" id="buy">
        We are currently in a prototype phase. If you would like to get a device as a Beta
        tester, reach out to the team at{' '}
        <a href="mailto:contact@wildlife.ai" style={{ color: 'var(--primary)' }}>contact@wildlife.ai</a>{' '}
        or learn more at{' '}
        <a href="https://wildlife.ai/wildlife-watcher" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>wildlife.ai</a>.
      </FaqItem>

      <h2 style={{ marginTop: '2.5rem', marginBottom: '0.75rem', fontSize: '1.25rem' }}>Already using Wildlife Watcher?</h2>
      <p>
        Questions about monitoring sessions, Bluetooth, data export, or your account are answered
        on the <Link to="/support" style={{ color: 'var(--primary)' }}>Support page</Link>, and
        step-by-step guides live under{' '}
        <Link to="/resources" style={{ color: 'var(--primary)' }}>Resources</Link>.
      </p>
    </div>
  )
}
