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
  const [uploaderName, setUploaderName] = useState('Anonym person 👀')

  useEffect(() => {
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

  if (!authed) return <PasswordGate onSuccess={handleAuth} />

  if (loadingPosts) return (
    <div style={{ minHeight:'100vh', background:'#efefef', display:'flex',
                  alignItems:'center', justifyContent:'center',
                  fontFamily:'system-ui', fontSize:'14px', color:'#aaa' }}>
      Laddar…
    </div>
  )

  return <CreativeWall initialPosts={posts} uploaderName={uploaderName} />
}