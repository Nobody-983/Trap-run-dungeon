import { useState } from 'react'
import { Check, Coins, Heart, Package, Shield, ShoppingBag, Sparkles, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useNav } from '@/app/nav'
import { HealthPill } from '@/components/AccountPanel'
import { Button, Panel, Screen } from '@/components/ui'
import { CONSUMABLE_ITEMS, canPurchase } from '@/economy/catalog'
import { COSMETICS, describeRule, type Cosmetic } from '@/progress/cosmetics'
import { rollDay, FREE_HEALTH_PER_DAY } from '@/progress/health'
import { profileStore, useProfile } from '@/progress/store'
import { sfx } from '@/lib/audio'

export function ShopScreen() {
  const { go } = useNav()
  const p = useProfile()
  const [tab, setTab] = useState<'skin' | 'trail' | 'supplies'>('skin')
  const h = rollDay(p.health)

  const cosmetics = COSMETICS.filter((c) => c.kind === (tab === 'skin' ? 'skin' : 'trail'))
  const isEquipped = (c: Cosmetic) => (c.kind === 'skin' ? p.equipped.skin === c.id : p.equipped.trail === c.id)
  const isUnlocked = (c: Cosmetic) => p.unlocked.includes(c.id) || c.rule.kind === 'default'

  const equip = (c: Cosmetic) => {
    profileStore.equip(c.kind, c.id)
    sfx.play('levelup')
    toast.success(`Equipped ${c.name}`)
  }

  const buyItem = (itemId: string, name: string, price: number) => {
    const check = canPurchase(p, itemId)
    if (!check.ok) {
      toast.error(check.reason ?? 'Cannot purchase item.')
      sfx.play('error')
      return
    }

    try {
      const item = profileStore.buyItem(itemId)
      sfx.play('win')
      toast.success(`Purchased ${item.name} for ${price} coins!`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Purchase failed')
      sfx.play('error')
    }
  }

  return (
    <Screen
      title="Armory & Supplies"
      onBack={() => go({ name: 'menu' })}
      right={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-ink-900/90 px-3 py-1 font-pixel text-xs text-amber-300 shadow-md">
            <Coins size={14} className="text-amber-400" />
            <span>{p.coins ?? 0}</span>
          </div>
          <HealthPill />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Runner Status & Inventory Overview */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heart size={18} className="fill-blood-500 text-blood-500" />
                <h2 className="font-display text-base font-bold">Runner Energy</h2>
              </div>
              <span className="rounded-full bg-ink-700 px-2 py-0.5 font-pixel text-xs text-acid-400">
                {h.free} Free Daily
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Each dungeon run costs 1 energy ({FREE_HEALTH_PER_DAY} free daily + bonuses). Earn coins by escaping dungeons!
            </p>
          </Panel>

          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-volt-400" />
                <h2 className="font-display text-base font-bold">Consumable Supplies</h2>
              </div>
              <span className="rounded-full bg-ink-700 px-2 py-0.5 font-pixel text-xs text-zinc-300">
                In Backpack
              </span>
            </div>
            <div className="flex items-center justify-around gap-2 pt-1 font-pixel text-xs">
              <div className="flex flex-col items-center">
                <span className="text-zinc-400">Potions</span>
                <span className="text-sm text-blood-400">{p.inventory?.healthPotions ?? 0}</span>
              </div>
              <div className="h-6 w-px bg-ink-600" />
              <div className="flex flex-col items-center">
                <span className="text-zinc-400">Elixirs</span>
                <span className="text-sm text-purple-400">{p.inventory?.fullElixirs ?? 0}</span>
              </div>
              <div className="h-6 w-px bg-ink-600" />
              <div className="flex flex-col items-center">
                <span className="text-zinc-400">Energy Cells</span>
                <span className="text-sm text-acid-400">{p.inventory?.energyCells ?? 0}</span>
              </div>
            </div>
          </Panel>
        </div>

        {/* Navigation Tabs */}
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
            <Sparkles size={16} /> Trails
          </Button>
          <Button
            variant={tab === 'supplies' ? 'volt' : 'ghost'}
            className="flex-1"
            onClick={() => setTab('supplies')}
          >
            <ShoppingBag size={16} /> Supplies
          </Button>
        </div>

        {/* Supplies Tab */}
        {tab === 'supplies' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CONSUMABLE_ITEMS.map((item) => {
              const ownedCount =
                item.id === 'potion-health'
                  ? p.inventory?.healthPotions ?? 0
                  : item.id === 'potion-elixir'
                    ? p.inventory?.fullElixirs ?? 0
                    : p.inventory?.energyCells ?? 0

              const canAfford = (p.coins ?? 0) >= item.price

              return (
                <Panel key={item.id} className="flex flex-col justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-xl"
                        style={{
                          background: `linear-gradient(135deg, ${item.color}, ${item.accent})`,
                          boxShadow: `0 0 14px ${item.color}55`,
                        }}
                      >
                        {item.id === 'potion-health' ? (
                          <Heart size={20} className="fill-white text-white" />
                        ) : item.id === 'potion-elixir' ? (
                          <Sparkles size={20} className="text-white" />
                        ) : (
                          <Zap size={20} className="fill-white text-white" />
                        )}
                      </div>
                      <span className="font-pixel text-xs text-zinc-400">Owned: {ownedCount}</span>
                    </div>

                    <div>
                      <h3 className="font-display font-bold text-zinc-100">{item.name}</h3>
                      <p className="mt-1 text-xs text-zinc-400 leading-snug">{item.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-ink-700/60">
                    <div className="flex items-center gap-1 font-pixel text-xs text-amber-300">
                      <Coins size={13} className="text-amber-400" />
                      <span>{item.price} Coins</span>
                    </div>
                    <Button
                      size="sm"
                      variant={canAfford ? 'volt' : 'ghost'}
                      disabled={!canAfford}
                      onClick={() => buyItem(item.id, item.name, item.price)}
                    >
                      Buy
                    </Button>
                  </div>
                </Panel>
              )
            })}
          </div>
        )}

        {/* Cosmetics Grid (Skins & Trails) */}
        {tab !== 'supplies' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cosmetics.map((item) => {
              const unlocked = isUnlocked(item)
              const equipped = isEquipped(item)
              const isCoinShopItem = item.rule.kind === 'coin' || (item.rule.kind === 'shop' && item.rule.price !== undefined)
              const price = item.rule.kind === 'coin' ? item.rule.price : item.rule.kind === 'shop' ? item.rule.price ?? 200 : 0
              const canAfford = (p.coins ?? 0) >= price

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

                  <div className="flex items-center justify-between pt-1 border-t border-ink-700/60">
                    <span className="text-xs text-zinc-500">
                      {unlocked ? 'Unlocked' : isCoinShopItem ? `${price} Coins` : 'Progress Unlock'}
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
                    ) : isCoinShopItem ? (
                      <Button
                        size="sm"
                        variant={canAfford ? 'volt' : 'ghost'}
                        disabled={!canAfford}
                        onClick={() => buyItem(item.id, item.name, price)}
                      >
                        Buy for {price} 🪙
                      </Button>
                    ) : (
                      <span className="font-pixel text-xs text-zinc-500">Requires Progress</span>
                    )}
                  </div>
                </Panel>
              )
            })}
          </div>
        )}
      </div>
    </Screen>
  )
}
