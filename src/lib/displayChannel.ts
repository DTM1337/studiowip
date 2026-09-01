import { supabase } from './supabase'

export const CHANNEL = 'display-control'

export type DisplayCommand =
  | { action: 'view-sync'; scroll: number }
  | { action: 'select-post'; postId: string | null }
  | { action: 'rotate' }
  | { action: 'toggle-rulers' }
  | { action: 'toggle-canvas-video' }
  | { action: 'toggle-debug' }
  | { action: 'toggle-cursor' }

export function sendCommand(cmd: DisplayCommand) {
  supabase.channel(CHANNEL).send({
    type: 'broadcast',
    event: 'cmd',
    payload: cmd,
  })
}
