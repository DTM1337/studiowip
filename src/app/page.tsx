'use client'

import { useState, useEffect } from 'react'
import CreativeWall from '@/components/CreativeWall'
import { Post } from '@/types'

export default function Home() {
  const [posts,        setPosts]        = useState<Post[]>([])
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [uploaderName, setUploaderName] = useState('Anonymous')

  useEffect(() => {
    const name = localStorage.getItem('showandtell_name')
    if (name) setUploaderName(name)
    fetchPosts()
  }, [])

  const fetchPosts = async () => {
    const res = await fetch('/api/posts')
    if (res.ok) setPosts(await res.json())
    setLoadingPosts(false)
  }

  if (loadingPosts) return (
    <div style={{ minHeight:'100vh', background:'#efefef', display:'flex',
                  alignItems:'center', justifyContent:'center',
                  fontFamily:'system-ui', fontSize:'14px', color:'#aaa' }}>
      Laddar…
    </div>
  )

  return <CreativeWall initialPosts={posts} uploaderName={uploaderName} />
}