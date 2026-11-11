import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { profileStore, useProfile } from '@/progress/store'
import { nearServices } from '@/services/chain/near'
import { upsertProfile } from '@/services/supabase'
import { clearSession, createNearSession, readSession, writeSession } from './session'

export type AuthPhase = 'idle' | 'connecting' | 'error'

export function useAuth() {
  const profile = useProfile()
  const [phase, setPhase] = useState<AuthPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [nearAccount, setNearAccount] = useState<string | null>(() => {
    return nearServices.wallet.accountId ?? readSession()?.accountId ?? null
  })

  // Restore session on mount
  useEffect(() => {
    let mounted = true
    void nearServices.wallet.restore().then((session) => {
      if (!mounted) return
      if (session) {
        setNearAccount(session.identity.accountId)
        writeSession(createNearSession(session.identity.accountId))
        profileStore.switchTo(session.identity.accountId)
        void upsertProfile({ nearAccountId: session.identity.accountId, displayName: profile.displayName })
      }
    })
    return () => {
      mounted = false
    }
  }, [profile.displayName])

  const signIn = useCallback(async () => {
    setError(null)
    setPhase('connecting')
    try {
      const session = await nearServices.wallet.connect()
      const accountId = session.identity.accountId
      setNearAccount(accountId)
      writeSession(createNearSession(accountId))
      profileStore.switchTo(accountId)
      await upsertProfile({ nearAccountId: accountId, displayName: profile.displayName })
      toast.success(`Connected as ${accountId}`)
      setPhase('idle')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('closed')) {
        setError(msg)
        toast.error(msg)
      }
      setPhase('idle')
    }
  }, [profile.displayName])

  const signOut = useCallback(async () => {
    try {
      await nearServices.wallet.disconnect()
    } catch {
      // ignore
    }
    clearSession()
    setNearAccount(null)
    profileStore.switchTo(null)
    setPhase('idle')
    toast.info('Disconnected wallet')
  }, [])

  return {
    signedInAddress: nearAccount,
    connected: nearAccount,
    walletMismatch: false,
    phase,
    error,
    signIn,
    signOut,
    isNewWallet: nearAccount ? !profileStore.hasAccount(nearAccount) : true,
  }
}
