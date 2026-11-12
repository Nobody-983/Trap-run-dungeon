import { useState } from 'react'
import { Award, ExternalLink, Lock, Plug, Trophy } from 'lucide-react'
import { useNav } from '@/app/nav'
import { AuthCard, SignedInDetails } from '@/components/AccountPanel'
import { Bar, Button, Label, Panel, Screen, Stat } from '@/components/ui'
import { PRACTICE_LEVELS } from '@/game/levels'
import { ACHIEVEMENTS } from '@/progress/achievements'
import { COSMETICS, describeRule, type Cosmetic } from '@/progress/cosmetics'
import { levelProgress } from '@/progress/profile'
import { profileStore, useProfile } from '@/progress/store'
import { NEAR_NETWORK_LABEL, nearTxUrl } from '@/services/chain/near'
import { upsertProfile } from '@/services/supabase'

function Swatch({ c }: { c: Cosmetic }) {
  return <span className="h-8 w-8 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${c.color}, ${c.accent})`, boxShadow: `0 0 14px ${c.color}66` }} />
}

export function ProfileScreen() {
  const { go } = useNav()
  const p = useProfile()
  const lv = levelProgress(p.xp)
  const [name, setName] = useState(p.displayName)
  const rate = p.runs > 0 ? Math.round((p.wins / p.runs) * 100) : 0
  const cleared = PRACTICE_LEVELS.filter((l) => (p.clears[l.dungeon.id] ?? 0) > 0).length
  const nearWallet = p.wallets.find((w) => w.chain === 'near')?.accountId ?? null

  const saveName = async () => {
    profileStore.setName(name)
    if (nearWallet) {
      await upsertProfile({ nearAccountId: nearWallet, displayName: name })
    }
  }

  return (
    <Screen title="Profile" onBack={() => go({ name: 'menu' })}>
      <div className="flex flex-col gap-4">
        <AuthCard />
        <Panel>
          <Label>Runner name</Label>
          <form
            className="mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void saveName()
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              aria-label="Runner name"
              className="h-11 min-w-0 flex-1 rounded-xl border border-ink-500 bg-ink-900 px-3 font-display font-bold text-zinc-50 outline-none focus:border-volt-400"
            />
            <Button type="submit" disabled={name.trim() === p.displayName || !name.trim()}>
              Save
            </Button>
          </form>
          <div className="mt-4 flex items-center gap-3">
            <div className="grid h-14 w-14 place-items-center rounded-xl bg-volt-500/20 font-pixel text-2xl text-acid-500">{lv.level}</div>
            <div className="flex-1">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Level {lv.level}</span>
                <span className="tabular">
                  {lv.into} / {lv.needed} XP
                </span>
              </div>
              <div className="mt-1.5">
                <Bar ratio={lv.ratio} color="bg-volt-500" />
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">XP, levels and leaderboard times come from skill and consistency only. Profile syncs securely with your NEAR account.</p>
          <div className="mt-3">
            <SignedInDetails />
          </div>
        </Panel>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Escapes" value={p.wins} accent="text-acid-500" />
          <Stat label="Defeats" value={p.losses} accent="text-blood-400" />
          <Stat label="Win rate" value={`${rate}%`} />
          <Stat label="Flawless" value={p.flawlessRuns} />
          <Stat label="Streak" value={`${p.streak.current}d`} accent="text-ember-400" />
          <Stat label="Best streak" value={`${p.streak.best}d`} />
          <Stat label="Best combo" value={`x${p.bestCombo}`} accent="text-volt-300" />
          <Stat label="Near misses" value={p.nearMisses} />
        </div>

        <Panel>
          <Label className="mb-3">Dungeon completion</Label>
          <div className="mb-2 flex justify-between text-sm">
            <span>Practice</span>
            <span className="tabular text-zinc-400">
              {cleared} / {PRACTICE_LEVELS.length}
            </span>
          </div>
          <Bar ratio={cleared / PRACTICE_LEVELS.length} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-zinc-400">
            <div>
              <div className="tabular font-pixel text-lg text-zinc-50">{Object.keys(p.daily).length}</div>dailies
            </div>
            <div>
              <div className="tabular font-pixel text-lg text-zinc-50">{p.published.length}</div>published
            </div>
            <div>
              <div className="tabular font-pixel text-lg text-zinc-50">{p.nearChallenges.length}</div>NEAR on-chain
            </div>
          </div>
        </Panel>

        <Panel>
          <Label className="mb-3 flex items-center gap-1">
            <Trophy size={12} /> Cosmetics unlocked
          </Label>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {COSMETICS.map((c) => {
              const unlocked = p.unlocked.includes(c.id) || c.rule.kind === 'default'
              return (
                <li key={c.id} className={`flex items-center gap-3 rounded-lg p-2 ${unlocked ? 'bg-ink-900/60' : 'bg-ink-900/20 opacity-50'}`}>
                  <Swatch c={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-sm font-semibold">
                      <span className="truncate">{c.name}</span>
                      {!unlocked && <Lock size={12} className="shrink-0 text-zinc-500" />}
                    </div>
                    <div className="truncate text-xs text-zinc-400">{describeRule(c.rule)}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel>
          <Label className="mb-3 flex items-center gap-1">
            <Award size={12} /> Achievements
          </Label>
          <ul className="flex flex-col gap-2">
            {ACHIEVEMENTS.map((a) => {
              const unlocked = p.achievements.some((x) => x.id === a.id)
              return (
                <li key={a.id} className={`rounded-lg p-2.5 ${unlocked ? 'bg-acid-500/10 text-acid-300 ring-1 ring-acid-500/30' : 'bg-ink-900/40 text-zinc-500'}`}>
                  <div className="text-sm font-semibold">{a.title}</div>
                  <div className="text-xs text-zinc-400">{a.description}</div>
                </li>
              )
            })}
          </ul>
        </Panel>

        {p.nearChallenges.length > 0 && (
          <Panel>
            <Label className="mb-3 flex items-center gap-1">
              <ExternalLink size={12} /> Registered NEAR Challenges
            </Label>
            <ul className="flex flex-col gap-1 text-sm">
              {p.nearChallenges.slice(0, 8).map((r) => (
                <li key={r.challengeId} className="flex items-center justify-between gap-2 rounded-lg bg-ink-900/60 px-3 py-2">
                  <span className="truncate font-mono text-xs text-zinc-300">
                    Challenge #{r.challengeId} · {r.shareCode.slice(0, 18)}...
                  </span>
                  <a href={nearTxUrl(r.txHash)} target="_blank" rel="noopener noreferrer" className="tabular inline-flex shrink-0 items-center gap-1 font-pixel text-xs text-acid-500 hover:underline">
                    Receipt <ExternalLink size={11} />
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel>
          <Label className="mb-2 flex items-center gap-1">
            <Plug size={12} /> Blockchain Identity
          </Label>
          <p className="text-sm text-zinc-300">
            Native NEAR Protocol ({NEAR_NETWORK_LABEL}). Your NEAR account is your verified creator identity.
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            <li className="flex justify-between rounded-lg bg-ink-900/60 px-3 py-2">
              <span>{NEAR_NETWORK_LABEL}</span>
              <span className={nearWallet ? 'text-acid-300 font-mono text-xs' : 'text-zinc-500'}>
                {nearWallet ?? 'Not connected'}
              </span>
            </li>
          </ul>
        </Panel>
      </div>
    </Screen>
  )
}
