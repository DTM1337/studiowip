export interface Post {
  id: string
  created_at: string
  file_url: string
  file_type: 'image' | 'video'
  uploader_name: string
  caption: string | null
}