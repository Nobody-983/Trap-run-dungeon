import { useEffect, useState } from 'react'
import { Loader2, Medal, Trophy } from 'lucide-react'
import { formatTime } from '@/game/result'
import { getDungeonLeaderboard } from '@/services/supabase'
import { useAuth } from '@/auth/useAuth'
import { Label } from './ui'

export interface BoardEntry {
  rank: number
  name: string
  timeMs: number
  score: number
  moves?: number
  you: boolean
}

export function Leaderboard({
  dungeonId,
  par,
  you,
}: {
  dungeonId: string
  par: number
  you?: { name: string; timeMs: number; score?: number } | null
}) {
  const { signedInAddress } = useAuth()
  const [entries, setEntries] = useState<BoardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    void getDungeonLeaderboard(dungeonId, 10, signedInAddress).then((data) => {
      if (!active) return

      let rows: BoardEntry[] = data.map((d) => ({
        rank: d.rank,
        name: d.display_name,
        timeMs: d.completion_time_ms,
        score: d.score,
        moves: d.moves,
        you: Boolean(d.isYou || (signedInAddress && d.player_near_account === signedInAddress)),
      }))

      // If user provided a run result not yet in the fetched page, merge it
      if (you && !rows.some((r) => r.you)) {
        rows.push({
          rank: rows.length + 1,
          name: you.name,
          timeMs: you.timeMs,
          score: you.score ?? 100,
          you: true,
        })
        rows.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          return a.timeMs - b.timeMs
        })
        rows = rows.map((r, i) => ({ ...r, rank: i + 1 }))
      }

      setEntries(rows)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [dungeonId, par, you, signedInAddress])

  return (
    <div className="rounded-2xl border border-ink-600/80 bg-ink-800/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Trophy size={14} className="text-volt-400" />
          <Label>Verified Leaderboard</Label>
        </div>
        <span className="rounded-full bg-ink-700 px-2 py-0.5 font-pixel text-[9px] uppercase tracking-wider text-volt-300">
          Server-Verified
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-zinc-500">
          <Loader2 size={16} className="mr-2 animate-spin text-volt-400" /> Loading rankings...
        </div>
      ) : entries.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-500">
          No verified escapes yet. Be the first to escape!
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {entries.slice(0, 5).map((r) => (
            <li
              key={`${r.rank}-${r.name}-${r.timeMs}`}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                r.you ? 'bg-acid-500/15 text-acid-300 ring-1 ring-acid-500/40' : 'bg-ink-900/50 text-zinc-300'
              }`}
            >
              <span className="tabular w-6 font-pixel text-xs">
                {r.rank <= 3 ? (
                  <Medal
                    size={16}
                    className={
                      r.rank === 1 ? 'text-yellow-300' : r.rank === 2 ? 'text-zinc-300' : 'text-ember-500'
                    }
                  />
                ) : (
                  r.rank
                )}
              </span>
              <span className="flex-1 truncate font-medium">
                {r.you ? `${r.name} (you)` : r.name}
              </span>
              <span className="tabular font-pixel text-xs text-volt-300">{r.score} pts</span>
              <span className="tabular font-pixel text-xs text-zinc-400">{formatTime(r.timeMs)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
