

export function PrivacyPolicyPage() {
  return (
    <div className="container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 0', lineHeight: '1.6' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Privacy Policy</h1>
      
      <p>Wildlife.ai ("we", "us", "our") values your privacy. This privacy policy explains how the Wildlife Watcher mobile application ("App") collects, uses, stores, and protects your personal information.</p>
      
      <p>This policy applies specifically to the Wildlife Watcher mobile app. For information about our educational services, please see the Privacy Policy for the Wild About AI online courses.</p>
      
      <p>Where you provide personal information to us, we will comply with the New Zealand Privacy Act 2020 and other applicable privacy and data protection laws ("Privacy Laws"). This privacy policy does not limit or exclude any of your rights under Privacy Laws. For further information on the New Zealand Privacy Act 2020, see <a href="https://www.privacy.org.nz" target="_blank" rel="noreferrer">www.privacy.org.nz</a>.</p>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>1. Information We Collect</h2>
      
      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Account Information</h3>
      <p>When you create an account, we collect:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Email address</strong> – used for authentication and account identification.</li>
        <li><strong>First name and surname</strong> – used for display within the App and to identify you to your organisation members.</li>
      </ul>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Location Data</h3>
      <p>The App collects location data to support wildlife monitoring operations:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Precise location (GPS)</strong> – used to record GPS coordinates for camera trap deployment sites, enabling accurate habitat mapping and wildlife tracking.</li>
        <li><strong>Approximate location (network-based)</strong> – used as a fallback when GPS is unavailable.</li>
        <li><strong>Background location</strong> – with your explicit permission, the App may access your location while minimised to maintain GPS coordinates during active field deployments.</li>
      </ul>
      <p><em>Note: Location data is stored alongside your deployment records and is shared with other members of your organisation who have access to the same project.</em></p>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Bluetooth Data</h3>
      <p>The App uses Bluetooth Low Energy (BLE) to:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li>Discover and connect to Wildlife Watcher camera trap devices.</li>
        <li>Transfer configuration settings (e.g. detection sensitivity, timelapse intervals) to devices.</li>
        <li>Receive device status information (battery level, firmware version, LoRaWAN signal strength).</li>
        <li>Perform firmware updates on devices.</li>
      </ul>
      <p>No Bluetooth data is transmitted to external parties. Device identifiers are used solely for communicating with camera hardware.</p>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Camera and Photo Library</h3>
      <p>With your permission, the App may access:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Camera</strong> – to capture photos of deployment sites for documentation.</li>
        <li><strong>Photo library</strong> – to select existing photos for deployment records.</li>
      </ul>
      <p>Photos you capture or select are uploaded to your organisation's project storage and are visible to members with access to that project.</p>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Device and Network Information</h3>
      <p>The App collects standard diagnostics, including:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Wi-Fi and Network status</strong> – to manage offline-first data behaviour and synchronisation.</li>
        <li><strong>Device information</strong> – used for crash reporting and compatibility diagnostics.</li>
      </ul>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Usage Data</h3>
      <p>We may collect information about how you interact with the App:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li>Features accessed and actions taken within the App.</li>
        <li>Error logs, crash reports, and performance metrics.</li>
      </ul>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>2. How We Use Your Information</h2>
      <p>We use the information we collect to:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Provide the App Service:</strong> Authenticate your account, display projects/deployments, and synchronise data between your device and the cloud.</li>
        <li><strong>Enable wildlife monitoring:</strong> Record camera trap locations, device configurations, and field observations.</li>
        <li><strong>Facilitate collaboration:</strong> Share project data with authorised members of your organisation.</li>
        <li><strong>Improve the App:</strong> Analyse usage patterns, diagnose technical issues, and develop new features.</li>
        <li><strong>Communicate with you:</strong> Send important service notifications (e.g. account changes, system updates).</li>
        <li><strong>Comply with legal obligations:</strong> Respond to lawful requests from authorities as required by law.</li>
      </ul>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>3. How We Store and Protect Your Information</h2>
      
      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>3.1 Data Storage</h3>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Cloud storage:</strong> Your account data and project records are stored securely on Supabase (hosted on Amazon Web Services infrastructure).</li>
        <li><strong>Local storage:</strong> The App uses an offline-first architecture. A local database (WatermelonDB/SQLite) on your device stores a synchronised copy of your data for offline use.</li>
        <li><strong>Secure credentials:</strong> Authentication tokens are stored in your device's secure storage (Keychain on iOS, Encrypted SharedPreferences on Android).</li>
      </ul>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>3.2 Data Security</h3>
      <p>We implement technical and organisational measures including:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Row Level Security (RLS):</strong> Policies that enforce multi-tenant organisation isolation, ensuring you only access data belonging to your own organisation.</li>
        <li><strong>Role-based access controls:</strong> Permissions limited by role (System Admin, Org Manager, Project Admin, Project Member).</li>
        <li><strong>Encrypted transmission:</strong> HTTPS/TLS encryption for all communication.</li>
        <li><strong>JWT-based authentication:</strong> For all API requests.</li>
      </ul>

      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>3.3 International Data Transfers</h3>
      <p>Your data may be stored in data centres outside of New Zealand. By using the App, you consent to the transfer of information to facilities where data protection laws may differ.</p>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>4. Data Sharing and Disclosure</h2>
      <p>We do not sell your personal information. We may share data with:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Organisation members:</strong> Project records and your name are visible to members with shared access.</li>
        <li><strong>Service providers:</strong> We use third parties to operate the App, including Supabase (database/auth), Google Maps (mapping), and Expo (updates). These providers are contractually obligated to protect your data.</li>
        <li><strong>Law Enforcement:</strong> If required by law or valid legal requests.</li>
        <li><strong>Business transfers:</strong> In the event of a merger or acquisition, your information may be transferred to the acquiring entity.</li>
      </ul>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>5. Data Retention and Deletion</h2>
      
      <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>5.1 Retention Policy</h3>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Active accounts:</strong> We retain info as long as your account is active.</li>
        <li><strong>Scientific data:</strong> Camera trap records and wildlife observations may be retained indefinitely for research purposes. However, this data will be permanently anonymised and no longer linked to your identity.</li>
      </ul>

      <h3 id="account-deletion" style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>5.2 Account Deletion</h3>
      <p>You have the right to request deletion of your account and personal data at any time.</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>How to Request:</strong> Submit our <a href="https://forms.gle/aasjsW5N26giYDk96" target="_blank" rel="noreferrer">Account Deletion Request Form</a>.</li>
        <li><strong>Process:</strong> Requests are processed within 7–14 business days.</li>
        <li><strong>What is Deleted:</strong> User profile (name, email), credentials, role assignments, and personal settings.</li>
        <li><strong>What is Retained (Anonymised):</strong> Deployment locations, dates, and wildlife metadata. All audit trails (e.g., "created by") are set to null.</li>
      </ul>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>6. Your Rights</h2>
      <p>Under the New Zealand Privacy Act 2020, you have the right to:</p>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li>Access your personal information held by us.</li>
        <li>Request correction of inaccurate or incomplete information.</li>
        <li>Request deletion of your account.</li>
        <li>Withdraw consent for optional data (e.g. GPS, camera) via device settings.</li>
      </ul>
      <p>To exercise these rights, contact <a href="mailto:contact@wildlife.ai">contact@wildlife.ai</a>.</p>

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>7. Additional Disclosures</h2>
      <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
        <li><strong>Children's Privacy:</strong> The App is not directed at children under 13. We do not knowingly collect their data.</li>
        <li><strong>Cookies:</strong> The mobile app does not use cookies.</li>
        <li><strong>Complaints:</strong> If you believe your privacy has been breached, email <a href="mailto:contact@wildlife.ai">contact@wildlife.ai</a>. If unsatisfied, you may contact the Office of the Privacy Commissioner.</li>
        <li><strong>Governing Law:</strong> This policy is governed by the laws of New Zealand. Wildlife.ai means Wildlife.ai Trust, a New Zealand Charity (CC57052).</li>
      </ul>

      <p style={{ marginTop: '2rem', fontStyle: 'italic', color: 'var(--text-muted, #666)' }}>
        Last Updated: March 16, 2026
      </p>
    </div>
  )
}
