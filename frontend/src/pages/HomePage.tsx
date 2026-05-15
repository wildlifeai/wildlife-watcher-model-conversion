import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { QRCodeSVG } from 'qrcode.react'

const APP_STORE_URL = 'https://apps.apple.com/app/id6480342929'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.wildlife.wildlifewatcher&pcampaignid=web_share'

export function HomePage() {
  const { user, loading } = useAuth()

  return (
    <div>
      <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto', padding: '0 0 3rem 0' }}>
        <h1 style={{ fontSize: '3rem', color: 'var(--primary)', marginBottom: '1rem' }}>Monitor wildlife the right way!</h1>
        <p style={{ fontSize: '1.25rem', opacity: 0.8 }}>
          Analyse here the photos from your Wildlife Watchers, upload new models, visualise your data and get the devices ready to set them up in the field.
        </p>

        {!loading && !user && (
          <Link
            to="/login"
            className="btn"
            id="hero-login-button"
            style={{
              display: 'inline-block',
              marginTop: '2rem',
              padding: '0.875rem 2.5rem',
              fontSize: '1.125rem',
              fontWeight: 600,
              textDecoration: 'none',
              borderRadius: 'var(--radius)',
              boxShadow: '0 4px 14px rgba(0,110,28,0.3)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
          >
            Log in to get started
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', fontWeight: 600 }}>Get the Mobile App</h2>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4rem', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '1rem' }}>
              <a href={APP_STORE_URL} target="_blank" rel="noreferrer">
                <img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" style={{ height: '40px' }} />
              </a>
            </div>
            <div style={{ padding: '1rem', backgroundColor: 'white', borderRadius: '12px', display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <QRCodeSVG value={APP_STORE_URL} size={150} />
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '1rem' }}>
              <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
                <img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" alt="Get it on Google Play" style={{ height: '40px' }} />
              </a>
            </div>
            <div style={{ padding: '1rem', backgroundColor: 'white', borderRadius: '12px', display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <QRCodeSVG value={PLAY_STORE_URL} size={150} />
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
