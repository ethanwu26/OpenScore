import { useCallback, useEffect, useMemo, useState } from 'react'
import { deployed, loadBoard, localSigner, keys, restoredWallet } from './chain.js'

function savedOperator() {
  try {
    const pk = keys.operatorKey()
    return pk ? localSigner(pk, '操作钱包') : null
  } catch { return null }
}

export default function useSession() {
  const [board, setBoard] = useState(null)
  const [err, setErr] = useState('')
  const [agentKeys, setAgentKeys] = useState(keys.agents)
  const [operator, setOperator] = useState(savedOperator)
  const [busy, setBusy] = useState(false)
  const reloadKeys = () => setAgentKeys(keys.agents())
  const refresh = useCallback(async () => {
    if (!deployed) return
    try {
      const next = await loadBoard()
      setBoard(next)
      setErr('')
      return next
    } catch {
      setErr('暂时无法读取链上副卡数据，正在重试。')
    }
  }, [])
  useEffect(() => {
    let stopped = false
    let timer
    async function poll() {
      if (!document.hidden) await refresh()
      if (!stopped) timer = setTimeout(poll, 3000)
    }
    poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [refresh])
  useEffect(() => {
    let version = 0
    async function reload() {
      const id = ++version
      reloadKeys()
      const signer = savedOperator() || await restoredWallet()
      if (id === version) setOperator(signer)
    }
    reload()
    const sync = (event) => {
      if (!event.key || event.key === 'os.rpc') location.reload()
      else if (event.key.startsWith('os.')) reload()
    }
    window.addEventListener('storage', sync)
    window.ethereum?.on?.('accountsChanged', reload)
    window.ethereum?.on?.('chainChanged', reload)
    return () => {
      version++
      window.removeEventListener('storage', sync)
      window.ethereum?.removeListener?.('accountsChanged', reload)
      window.ethereum?.removeListener?.('chainChanged', reload)
    }
  }, [])
  const anySigner = useMemo(() => {
    if (operator) return operator
    const funded = board?.list?.find(v => v.gasBalance > 5n * 10n ** 16n && agentKeys.some(k => k.address.toLowerCase() === v.agent.toLowerCase()))
    const k = funded && agentKeys.find(k => k.address.toLowerCase() === funded.agent.toLowerCase())
    return k ? localSigner(k.privateKey, k.name) : null
  }, [operator, board, agentKeys])
  return { board, err, refresh, operator, setOperator, agentKeys, reloadKeys, anySigner, busy, setBusy }
}
