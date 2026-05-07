'use client'

import { useState } from 'react'

interface Props {
  onSuccess: () => void
}

export default function PasswordGate({ onSuccess }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!password.trim()) return
    setLoading(true)
    setError(false)

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    setLoading(false)

    if (res.ok) {
      localStorage.setItem('showandtell_auth', '1')
      onSuccess()
    } else {
      setError(true)
    }
  }

  return (
    <div className="gate-wrapper">
      <div className="gate-card">
        <div className="gate-logo">NORD STUDIO WIP</div>
        <div className="gate-sub">hej vad jobbar du med?</div>
        <div className="gate-label">Lösenord</div>
        <input
          type="password"
          placeholder=""
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          autoFocus
          className={error ? 'error' : ''}
        />
        {error && <span className="error-msg">Fel lösenord</span>}
        <button onClick={handleSubmit} disabled={loading}>
          {loading ? '…' : '→'}
        </button>
      </div>

      <style>{`
        .gate-wrapper {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f5f2ee;
        }
        .gate-card {
          background: #fff;
          border: 1px solid #e0ddd8;
          border-radius: 14px;
          padding: 44px 40px;
          width: 320px;
          box-shadow: 0 2px 24px rgba(0,0,0,.07);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .gate-logo {
          font-size: 14px;
          font-weight: 800;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: #111;
        }
        .gate-sub {
          color: #bbb;
          font-size: 12px;
          margin-bottom: 8px;
        }
        .gate-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .07em;
          text-transform: uppercase;
          color: #bbb;
        }
        input {
          background: #f8f7f5;
          border: 1px solid #e0ddd8;
          border-radius: 8px;
          padding: 11px 14px;
          font-size: 14px;
          color: #111;
          outline: none;
          transition: border-color .15s;
          font-family: inherit;
        }
        input:focus { border-color: #bbb; }
        input.error { border-color: #e03; }
        .error-msg { color: #e03; font-size: 11px; }
        button {
          background: #111;
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          margin-top: 4px;
          transition: opacity .15s;
        }
        button:hover { opacity: .82; }
        button:disabled { opacity: .4; cursor: default; }
      `}</style>
    </div>
  )
}