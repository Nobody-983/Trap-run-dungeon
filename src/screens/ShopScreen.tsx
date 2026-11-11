import { useState } from 'react'
import { Check, Heart, Shield, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useNav } from '@/app/nav'
import { HealthPill } from '@/components/AccountPanel'
import { Button, Panel, Screen } from '@/components/ui'
import { COSMETICS, describeRule, type Cosmetic } from '@/progress/cosmetics'
import { rollDay, FREE_HEALTH_PER_DAY } from '@/progress/health'
import { profileStore, useProfile } from '@/progress/store'
import { sfx } from '@/lib/audio'

export function ShopScreen() {
  const { go } = useNav()
  const p = useProfile()
  const [tab, setTab] = useState<'skin' | 'trail'>('skin')
  const h = rollDay(p.health)

  const items = COSMETICS.filter((c) => c.kind === tab)
  const isEquipped = (c: Cosmetic) => (c.kind === 'skin' ? p.equipped.skin === c.id : p.equipped.trail === c.id)
  const isUnlocked = (c: Cosmetic) => p.unlocked.includes(c.id) || c.rule.kind === 'default'

  const equip = (c: Cosmetic) => {
    profileStore.equip(c.kind, c.id)
    sfx.play('levelup')
    toast.success(`Equipped ${c.name}`)
  }

  return (
    <Screen title="Armory & Cosmetics" onBack={() => go({ name: 'menu' })} right={<HealthPill />}>
      <div className="flex flex-col gap-4">
        {/* Health status panel */}
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Heart size={18} className="fill-blood-500 text-blood-500" />
              <h2 className="font-display text-lg font-bold">Runner Energy</h2>
            </div>
            <span className="rounded-full bg-ink-700 px-2 py-0.5 font-pixel text-xs text-acid-400">
              {h.free} Free Daily Health
            </span>
          </div>
          <p className="text-sm text-zinc-400">
            Each escape run costs 1 energy. You receive {FREE_HEALTH_PER_DAY} free health every day at UTC midnight, plus bonuses for clearing daily challenges.
          </p>
        </Panel>

        {/* Cosmetics tabs */}
        <div className="flex gap-2">
          <Button
            variant={tab === 'skin' ? 'volt' : 'ghost'}
            className="flex-1"
            onClick={() => setTab('skin')}
          >
            <Shield size={16} /> Runner Skins
          </Button>
          <Button
            variant={tab === 'trail' ? 'volt' : 'ghost'}
            className="flex-1"
            onClick={() => setTab('trail')}
          >
            <Sparkles size={16} /> Particle Trails
          </Button>
        </div>

        {/* Cosmetics Grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const unlocked = isUnlocked(item)
            const equipped = isEquipped(item)
            return (
              <Panel key={item.id} className={`flex flex-col justify-between gap-3 ${equipped ? 'ring-2 ring-volt-400' : ''}`}>
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 shrink-0 rounded-xl"
                    style={{
                      background: `linear-gradient(135deg, ${item.color}, ${item.accent})`,
                      boxShadow: `0 0 16px ${item.color}66`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold">{item.name}</span>
                      {equipped && (
                        <span className="rounded bg-volt-400/20 px-1.5 py-0.5 font-pixel text-[10px] text-volt-300">
                          EQUIPPED
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-zinc-400">{describeRule(item.rule)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-zinc-500">
                    {unlocked ? 'Unlocked' : 'Locked'}
                  </span>
                  {unlocked ? (
                    <Button
                      size="sm"
                      variant={equipped ? 'ghost' : 'volt'}
                      disabled={equipped}
                      onClick={() => equip(item)}
                    >
                      {equipped ? <Check size={14} /> : null} {equipped ? 'In Use' : 'Equip'}
                    </Button>
                  ) : (
                    <span className="font-pixel text-xs text-zinc-500">Requires Progress</span>
                  )}
                </div>
              </Panel>
            )
          })}
        </div>
      </div>
    </Screen>
  )
}
