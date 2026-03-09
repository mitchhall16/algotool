import algosdk from 'algosdk'
import { getClient, waitForTxn } from './algod.js'
import { getAccountFromWallet } from './wallets.js'

export async function createASA(wallet, { name, unit, total, decimals = 0, url = '' }) {
  const client = getClient()
  const sender = getAccountFromWallet(wallet)
  const senderAddr = sender.addr.toString()
  const params = await client.getTransactionParams().do()

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender: senderAddr,
    total: BigInt(total),
    decimals,
    defaultFrozen: false,
    assetName: name,
    unitName: unit,
    assetURL: url,
    manager: senderAddr,
    reserve: senderAddr,
    freeze: senderAddr,
    clawback: senderAddr,
    suggestedParams: params,
  })

  const signed = txn.signTxn(sender.sk)
  const resp = await client.sendRawTransaction(signed).do()
  const txId = resp.txId ?? resp.txid
  const confirmed = await waitForTxn(client, txId)
  const assetId = confirmed['asset-index']

  return { txId, assetId, confirmed: true }
}

export async function optInASA(wallet, assetId) {
  const client = getClient()
  const sender = getAccountFromWallet(wallet)
  const senderAddr = sender.addr.toString()
  const params = await client.getTransactionParams().do()

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: senderAddr,
    receiver: senderAddr,
    assetIndex: assetId,
    amount: 0,
    suggestedParams: params,
  })

  const signed = txn.signTxn(sender.sk)
  const resp = await client.sendRawTransaction(signed).do()
  const txId = resp.txId ?? resp.txid
  await waitForTxn(client, txId)

  return { txId, confirmed: true }
}

export async function transferASA(fromWallet, toAddress, assetId, amount) {
  const client = getClient()
  const sender = getAccountFromWallet(fromWallet)
  const senderAddr = sender.addr.toString()
  const params = await client.getTransactionParams().do()

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: senderAddr,
    receiver: toAddress,
    assetIndex: assetId,
    amount: BigInt(amount),
    suggestedParams: params,
  })

  const signed = txn.signTxn(sender.sk)
  const resp = await client.sendRawTransaction(signed).do()
  const txId = resp.txId ?? resp.txid
  await waitForTxn(client, txId)

  return { txId, confirmed: true }
}

export async function getASAInfo(assetId) {
  const client = getClient()
  const info = await client.getAssetByID(assetId).do()
  return info
}

export async function getAccountAssets(address) {
  const client = getClient()
  const info = await client.accountInformation(address).do()
  const assets = info.assets || []
  return assets.map(a => ({
    id: a['asset-id'],
    amount: Number(a.amount),
    frozen: a['is-frozen'],
  }))
}
