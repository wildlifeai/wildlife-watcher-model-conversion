

export function SupportPage() {
  return (
    <div className="container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 0', lineHeight: '1.6' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Support</h1>
      
      <p>Need help with the Wildlife Watcher mobile app or website? We are here to assist you.</p>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Frequently Asked Questions</h2>
      
      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>How do I deploy a camera?</h3>
      <p>Using the Wildlife Watcher mobile app, navigate to the "Deployments" tab and tap the blue "+" button to start the Deployment Wizard. Follow the on-screen instructions to select your camera, configure its view, and finalize the deployment.</p>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>How do I update the AI model on my camera?</h3>
      <p>You can prepare an SD card with the latest software and AI model via the "Prepare SD Card" option on this website. Simply download the package, extract it to the root of your SD card, and insert it into your camera before turning it on.</p>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>How do I delete my account?</h3>
      <p>You can request account deletion at any time by filling out our <a href="https://forms.gle/aasjsW5N26giYDk96" target="_blank" rel="noreferrer">Account Deletion Request Form</a>. Your request will be processed within 7-14 business days.</p>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Contact Us</h2>
      <p>If you cannot find the answer to your question, or need further technical assistance, please reach out to our support team:</p>
      
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Email:</strong> <a href="mailto:contact@wildlife.ai">contact@wildlife.ai</a></li>
      </ul>

      <p style={{ marginTop: '2rem', fontStyle: 'italic', color: 'var(--text-muted, #666)' }}>
        Our support team is available Monday through Friday during standard New Zealand business hours.
      </p>
    </div>
  )
}
