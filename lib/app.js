import algosdk from 'algosdk'
import { getClient, waitForTxn } from './algod.js'
import { getAccountFromWallet } from './wallets.js'

export async function callApp(wallet, appId, { method, args = [], foreignApps = [], foreignAssets = [], accounts = [], boxes = [] } = {}) {
  const client = getClient()
  const sender = getAccountFromWallet(wallet)
  const senderAddr = sender.addr.toString()
  const params = await client.getTransactionParams().do()

  const appArgs = []
  if (method) {
    // ABI method selector: first 4 bytes of SHA-512/256 of method signature
    const selector = new Uint8Array(
      await crypto.subtle.digest('SHA-512/256', new TextEncoder().encode(method))
    ).slice(0, 4)
    appArgs.push(selector)
  }
  for (const arg of args) {
    if (typeof arg === 'string') {
      // hex string
      appArgs.push(new Uint8Array(arg.match(/.{1,2}/g).map(b => parseInt(b, 16))))
    } else if (arg instanceof Uint8Array) {
      appArgs.push(arg)
    } else {
      // number -> uint64
      const buf = new Uint8Array(8)
      const view = new DataView(buf.buffer)
      view.setBigUint64(0, BigInt(arg))
      appArgs.push(buf)
    }
  }

  const txn = algosdk.makeApplicationCallTxnFromObject({
    sender: senderAddr,
    appIndex: appId,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs,
    foreignApps: foreignApps.map(Number),
    foreignAssets: foreignAssets.map(Number),
    accounts,
    boxes: boxes.map(b => ({ appIndex: appId, name: typeof b === 'string' ? new TextEncoder().encode(b) : b })),
    suggestedParams: params,
  })

  const signed = txn.signTxn(sender.sk)
  const resp = await client.sendRawTransaction(signed).do()
  const txId = resp.txId ?? resp.txid
  const confirmed = await waitForTxn(client, txId)

  return { txId, confirmed: true, round: confirmed?.['confirmed-round'] }
}

export async function getAppState(appId) {
  const client = getClient()
  const info = await client.getApplicationByID(appId).do()
  const state = {}

  const globalState = info.params?.['global-state'] || []
  for (const kv of globalState) {
    const key = Buffer.from(kv.key, 'base64').toString()
    if (kv.value.type === 1) {
      state[key] = Buffer.from(kv.value.bytes, 'base64').toString('hex')
    } else {
      state[key] = kv.value.uint
    }
  }

  return { appId, state, raw: info }
}

export async function getAppAddress(appId) {
  return algosdk.getApplicationAddress(appId).toString()
}
