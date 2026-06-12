import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '../config/supabase'
import { useAuth } from '../hooks/useAuth'
import { DemoLoginButton } from '../components/common/DemoLoginButton'
import type { ViewType } from '@supabase/auth-ui-shared'

export function LoginPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [view, setView] = useState<ViewType>('sign_in')

  useEffect(() => {
    if (user) {
      navigate('/')
    }
  }, [user, navigate])

  // Determine the production site URL for redirect
  const siteUrl = window.location.origin

  return (
    <div style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem', backgroundColor: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>
        {view === 'forgotten_password' ? 'Reset Your Password' : 'Login to Wildlife Watcher'}
      </h2>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        theme="light"
        providers={view === 'sign_in' ? ['github', 'google'] : []}
        redirectTo={view === 'forgotten_password'
          ? siteUrl + '/reset-password'
          : siteUrl + '/'}
        view={view}
        showLinks={false}
      />
      <div style={{ textAlign: 'center', marginTop: '1rem' }}>
        {view === 'sign_in' ? (
          <button
            onClick={() => setView('forgotten_password')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              textDecoration: 'underline',
              padding: '0.25rem'
            }}
          >
            Forgot your password?
          </button>
        ) : (
          <button
            onClick={() => setView('sign_in')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              textDecoration: 'underline',
              padding: '0.25rem'
            }}
          >
            Back to Login
          </button>
        )}
      </div>
      {view === 'sign_in' && (
        <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.8125rem', opacity: 0.6, marginBottom: '0.625rem' }}>
            No account? Explore with sample data:
          </div>
          <DemoLoginButton />
        </div>
      )}
    </div>
  )
}

