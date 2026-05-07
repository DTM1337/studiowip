'use client'

import { useState, useEffect } from 'react'
import PasswordGate from '@/components/PasswordGate'
import CreativeWall from '@/components/CreativeWall'
import { Post } from '@/types'

export default function Home() {
  const [authed,       setAuthed]       = useState(false)
  const [checking,     setChecking]     = useState(true)
  const [posts,        setPosts]        = useState<Post[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [uploaderName, setUploaderName] = useState('Anonymous')
  const [displayMode,  setDisplayMode]  = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const isDisplay = params.get('display') === 'true'
    setDisplayMode(isDisplay)

    if (isDisplay) {
      // Display mode – skip auth, fetch directly
      fetchPosts()
      setChecking(false)
      return
    }

    const stored = localStorage.getItem('showandtell_auth')
    const name   = localStorage.getItem('showandtell_name')
    if (stored === '1') { setAuthed(true); fetchPosts() }
    if (name) setUploaderName(name)
    setChecking(false)
  }, [])

  const fetchPosts = async () => {
    setLoadingPosts(true)
    const res = await fetch('/api/posts')
    if (res.ok) setPosts(await res.json())
    setLoadingPosts(false)
  }

  const handleAuth = () => {
    setAuthed(true)
    fetchPosts()
  }

  if (checking) return null

  if (loadingPosts) return (
    <div style={{ minHeight:'100vh', background:'#efefef', display:'flex',
                  alignItems:'center', justifyContent:'center',
                  fontFamily:'system-ui', fontSize:'14px', color:'#aaa' }}>
      Laddar…
    </div>
  )

  if (!authed && !displayMode) return <PasswordGate onSuccess={handleAuth} />

  return <CreativeWall initialPosts={posts} uploaderName={uploaderName} displayMode={displayMode} />
}