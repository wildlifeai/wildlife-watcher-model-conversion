import { Link } from 'react-router-dom'
import { FaqItem } from '../components/common/FaqItem'

export function SupportPage() {
  return (
    <div className="container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 0', lineHeight: '1.6' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Support</h1>

      <p>
        Need help with the Wildlife Watcher mobile app or website? Browse our frequently asked
        questions below or contact our team directly. New to Wildlife Watcher? Start with the{' '}
        <Link to="/faq" style={{ color: 'var(--primary)' }}>general FAQ</Link>.
      </p>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Frequently Asked Questions</h2>

      {/* ── Getting Started ────────────────────────────────────────── */}
      <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', color: 'var(--primary)' }}>Getting Started</h3>

      <FaqItem q="How do I start a monitoring session?">
        To start a monitoring session, ensure your camera has batteries and a microSD card installed.
        Open the Wildlife Watcher mobile app, tap "Search for devices" in the app, and physically press the button at the bottom of the device to connect to it.
        Once connected, you can configure the project and start the monitoring session. When you are done, you can stop the monitoring through the app.
        See our <Link to="/resources" style={{ color: 'var(--primary)' }}>Resources</Link> page for a detailed step-by-step guide.
      </FaqItem>

      <FaqItem q="Is Wildlife Watcher free to use?">
        Yes. Wildlife.ai is a charity whose mission is to accelerate conservation using AI, open source, and community-driven tools.
        The platform is free for conservation projects. As more projects join the movement, we may introduce a paid tier for
        users with large-scale requirements (thousands of photos, custom ML algorithms, heavy cloud usage), but we are committed
        to always offering affordable or free services for most conservation projects.
      </FaqItem>

      <FaqItem q="What is an organisation?">
        Every user currently belongs to a single default organisation. As we expand the platform, we will roll out a full
        organisations feature where users can create their own organisation, manage members, and share AI models and data across
        projects within that organisation.
      </FaqItem>

      {/* ── Camera & Hardware ─────────────────────────────────────── */}
      <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', color: 'var(--primary)' }}>Camera & Hardware</h3>

      <FaqItem q="What SD card should I use?">
        We recommend using a <strong>FAT32-formatted</strong> microSD card with a capacity from <strong>32 GB up to 64 GB</strong> (Class 10 or higher) for optimal performance. The mobile app includes a "Format SD Card" option (accessible from the Engineer Console)
        if you need to reformat in the field.
      </FaqItem>

      <FaqItem q="Can I use Wildlife Watcher photos with other software?">
        Yes. The Wildlife Watcher is built for an end-to-end approach — all information collected in the field
        (GPS coordinates, timestamps, AI detections) is embedded with the images to save time during data analysis
        and preparation. We also provide APIs so you can retrieve your field data programmatically and use it with
        any analysis software you prefer.
      </FaqItem>

      <FaqItem q="Does the camera support LoRaWAN?">
        LoRaWAN connectivity is currently a work in progress. At the moment, images are stored on the SD card
        and retrieved when you visit the camera in the field. We will announce LoRaWAN support when it is ready.
      </FaqItem>

      <FaqItem q="How do I update the AI model on my camera?">
        You can prepare an SD card with the latest software and AI model via the "Prepare SD Card" option on the website.
        Download the package, extract it to the root of your SD card, and insert it into your camera before powering on.
        Alternatively, you can transfer models via Bluetooth from the mobile app.
      </FaqItem>

      {/* ── Mobile App ────────────────────────────────────────────── */}
      <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', color: 'var(--primary)' }}>Mobile App</h3>

      <FaqItem q="Does the app work offline?">
        Yes. The mobile app works without an internet connection using the data it has from the last time it was online.
        You can view projects, monitoring sessions, and cached data while offline. Any new data or changes made offline will be
        automatically uploaded to the cloud when an internet connection becomes available.
      </FaqItem>

      <FaqItem q="The app can't connect to my camera via Bluetooth. What should I do?">
        <ol style={{ paddingLeft: '1.5rem', margin: '0.5rem 0' }}>
          <li>Make sure you physically tap the button at the bottom of the device to activate Bluetooth advertising, and ensure the blue light is flashing.</li>
          <li>Ensure Bluetooth is enabled on your phone and you are within range (a few metres).</li>
          <li>If the app is scanning but not finding the device, <strong>close the app completely and reopen it</strong>.</li>
          <li>If the issue persists, restart both the camera and your phone.</li>
        </ol>
      </FaqItem>

      {/* ── Data & Export ─────────────────────────────────────────── */}
      <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', color: 'var(--primary)' }}>Data & Export</h3>

      <FaqItem q="What data formats can I export?">
        You can export your data as <strong>CSV files</strong> or in <strong>CamtrapDP format</strong> — a standardised
        camera trap data package used by biodiversity databases worldwide. CamtrapDP exports include monitoring sessions,
        media records, and observations in a single ZIP file.
      </FaqItem>

      <FaqItem q="Can I upload data from other cameras?">
        The site currently accepts external data if it is labelled and in <a href="https://camtrap-dp.tdwg.org/" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>CamtrapDP format</a>.
        We are actively building support for uploading unlabelled footage from other cameras — users will be able to
        upload their images and manually add the missing metadata (location, species, timestamps) through the web interface.
      </FaqItem>

      {/* ── Account ───────────────────────────────────────────────── */}
      <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', color: 'var(--primary)' }}>Account</h3>

      <FaqItem q="How do I reset my password?">
        On the login screen, tap "Forgot Password" and enter your email address. You will receive a password reset link
        via email. Follow the link to set a new password.
      </FaqItem>

      <FaqItem q="How do I delete my account?">
        You can request account deletion at any time by filling out our{' '}
        <a href="https://forms.gle/aasjsW5N26giYDk96" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Account Deletion Request Form</a>{' '}
        or by emailing <a href="mailto:contact@wildlife.ai" style={{ color: 'var(--primary)' }}>contact@wildlife.ai</a>.
        Your request will be processed within 7–14 business days. Personal data is deleted; anonymised wildlife
        observation data is retained for research purposes.
        See our <Link to="/privacy#account-deletion" style={{ color: 'var(--primary)' }}>Privacy Policy</Link> for full details.
      </FaqItem>

      {/* ── Contact ───────────────────────────────────────────────── */}
      <h2 style={{ marginTop: '2.5rem', marginBottom: '1rem' }}>Still Need Help?</h2>
      <p>If you cannot find the answer to your question, or need further technical assistance, please reach out to our team:</p>

      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Email:</strong> <a href="mailto:contact@wildlife.ai" style={{ color: 'var(--primary)' }}>contact@wildlife.ai</a></li>
        <li><strong>Resources:</strong> Visit our <Link to="/resources" style={{ color: 'var(--primary)' }}>Resources & How-To Guides</Link> for detailed setup and troubleshooting instructions.</li>
      </ul>

      <p style={{ marginTop: '2rem', fontStyle: 'italic', color: 'var(--text-muted, #666)' }}>
        Our support team is available Monday through Friday during standard New Zealand business hours.
        <br />
        Last updated: May 18, 2026
      </p>
    </div>
  )
}
