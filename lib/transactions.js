import algosdk from 'algosdk'
import { getClient, waitForTxn } from './algod.js'
import { getAccountFromWallet } from './wallets.js'

export async function sendAlgo(fromWallet, toAddress, amountAlgo) {
  const client = getClient()
  const sender = getAccountFromWallet(fromWallet)
  const senderAddr = sender.addr.toString()
  const params = await client.getTransactionParams().do()

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: senderAddr,
    receiver: toAddress,
    amount: Math.round(amountAlgo * 1e6),
    suggestedParams: params,
  })

  const signed = txn.signTxn(sender.sk)
  const resp = await client.sendRawTransaction(signed).do()
  const txId = resp.txId ?? resp.txid
  const confirmed = await waitForTxn(client, txId)

  return { txId, confirmed: !!confirmed, round: confirmed?.['confirmed-round'] }
}

export async function disperseFunds(fromWallet, targets, amountEach, onProgress) {
  const results = []
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    onProgress?.(`[${i + 1}/${targets.length}] Sending ${amountEach} ALGO to ${target.address.slice(0, 8)}...`)
    try {
      const result = await sendAlgo(fromWallet, target.address, amountEach)
      results.push({ address: target.address, ...result })
      onProgress?.(`  -> confirmed`)
    } catch (err) {
      results.push({ address: target.address, error: err.message })
      onProgress?.(`  -> ERROR: ${err.message}`)
    }
  }
  return results
}

export async function batchSend(wallets, toAddress, amountEach, onProgress) {
  const results = []
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i]
    onProgress?.(`[${i + 1}/${wallets.length}] ${w.address.slice(0, 8)}... -> ${toAddress.slice(0, 8)}... (${amountEach} ALGO)`)
    try {
      const result = await sendAlgo(w, toAddress, amountEach)
      results.push({ from: w.address, ...result })
      onProgress?.(`  -> confirmed`)
    } catch (err) {
      results.push({ from: w.address, error: err.message })
      onProgress?.(`  -> ERROR: ${err.message}`)
    }
  }
  return results
}
