import algosdk from 'algosdk'
import { getNetworkUrls } from './algod.js'

export async function inspectTransaction(txId) {
  const urls = getNetworkUrls()
  const resp = await fetch(`${urls.indexer}/v2/transactions/${txId}`)
  if (!resp.ok) throw new Error(`Transaction not found: ${txId}`)
  const data = await resp.json()
  return data.transaction
}

export async function inspectGroup(txId) {
  const tx = await inspectTransaction(txId)
  const round = tx['confirmed-round']
  const groupB64 = tx.group
  if (!groupB64) return [tx]

  const urls = getNetworkUrls()
  const resp = await fetch(`${urls.indexer}/v2/transactions?min-round=${round}&max-round=${round}&limit=50`)
  const data = await resp.json()
  const group = data.transactions.filter(t => t.group === groupB64)
  group.sort((a, b) => (a['intra-round-offset'] || 0) - (b['intra-round-offset'] || 0))
  return group
}

export function formatTransaction(tx) {
  const lines = []
  lines.push(`TX ID:     ${tx.id}`)
  lines.push(`Type:      ${tx['tx-type'].toUpperCase()}`)
  lines.push(`From:      ${tx.sender}`)
  lines.push(`Fee:       ${(tx.fee / 1e6)} ALGO`)
  lines.push(`Round:     ${tx['confirmed-round']}`)

  if (tx['tx-type'] === 'pay') {
    const pay = tx['payment-transaction']
    lines.push(`To:        ${pay.receiver}`)
    lines.push(`Amount:    ${(pay.amount / 1e6)} ALGO`)
    if (pay['close-remainder-to']) lines.push(`Close to:  ${pay['close-remainder-to']}`)
  }

  if (tx['tx-type'] === 'axfer') {
    const axfer = tx['asset-transfer-transaction']
    lines.push(`To:        ${axfer.receiver}`)
    lines.push(`Asset ID:  ${axfer['asset-id']}`)
    lines.push(`Amount:    ${axfer.amount}`)
  }

  if (tx['tx-type'] === 'appl') {
    const app = tx['application-transaction']
    lines.push(`App ID:    ${app['application-id']}`)
    lines.push(`On-Complete: ${['NoOp', 'OptIn', 'CloseOut', 'ClearState', 'UpdateApp', 'DeleteApp'][app['on-completion']] || app['on-completion']}`)
    if (app['application-args']?.length) {
      lines.push(`Args:      ${app['application-args'].length} arg(s)`)
    }
  }

  if (tx['tx-type'] === 'acfg') {
    const acfg = tx['asset-config-transaction']
    if (acfg?.params) {
      lines.push(`Asset:     ${acfg.params['asset-name'] || 'unnamed'} (${acfg.params['unit-name'] || '?'})`)
      lines.push(`Total:     ${acfg.params.total}`)
      lines.push(`Decimals:  ${acfg.params.decimals}`)
    }
  }

  const noteLen = tx.note ? Buffer.from(tx.note, 'base64').length : 0
  if (noteLen > 0) lines.push(`Note:      ${noteLen} bytes`)

  if (tx.signature?.logicsig) lines.push(`Signature: LogicSig`)
  else if (tx.signature?.multisig) lines.push(`Signature: MultiSig`)
  else lines.push(`Signature: Single`)

  if (tx['inner-txns']?.length) {
    lines.push(`Inner txns: ${tx['inner-txns'].length}`)
  }

  return lines.join('\n')
}

export async function getAccountHistory(address, limit = 10) {
  const urls = getNetworkUrls()
  const resp = await fetch(`${urls.indexer}/v2/accounts/${address}/transactions?limit=${limit}`)
  if (!resp.ok) throw new Error(`Could not fetch history for ${address}`)
  const data = await resp.json()
  return data.transactions || []
}
