import algosdk from 'algosdk'
import { loadConfig } from './store.js'

const NETWORKS = {
  testnet: {
    algod: 'https://testnet-api.algonode.cloud',
    indexer: 'https://testnet-idx.algonode.cloud',
    faucet: 'https://dispenser-api.testnet.aws.algodev.network',
  },
  mainnet: {
    algod: 'https://mainnet-api.algonode.cloud',
    indexer: 'https://mainnet-idx.algonode.cloud',
    faucet: null,
  },
}

export function getNetwork() {
  const config = loadConfig()
  return config.network || 'testnet'
}

export function getNetworkUrls() {
  return NETWORKS[getNetwork()] || NETWORKS.testnet
}

export function getClient() {
  const urls = getNetworkUrls()
  return new algosdk.Algodv2('', urls.algod, '')
}

export function getIndexer() {
  const urls = getNetworkUrls()
  return new algosdk.Indexer('', urls.indexer, '')
}

export async function getBalance(address) {
  const client = getClient()
  const info = await client.accountInformation(address).do()
  return Number(info.amount) / 1e6
}

export async function getAccountInfo(address) {
  const client = getClient()
  return await client.accountInformation(address).do()
}

export async function waitForTxn(client, txId, maxRounds = 15) {
  return algosdk.waitForConfirmation(client, txId, maxRounds)
}

export async function fundFromFaucet(address) {
  const network = getNetwork()
  if (network !== 'testnet') {
    throw new Error('Faucet only available on testnet')
  }
  const resp = await fetch('https://dispenser-api.testnet.aws.algodev.network/fund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver: address, amount: 10_000_000 }), // 10 ALGO
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Faucet error: ${resp.status} ${text}`)
  }
  return await resp.json()
}
