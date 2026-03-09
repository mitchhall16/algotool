import algosdk from 'algosdk'
import { loadConfig } from './store.js'

const NETWORKS = {
  testnet: {
    algod: 'https://testnet-api.algonode.cloud',
    indexer: 'https://testnet-idx.algonode.cloud',
    faucet: null,
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
  throw new Error('No programmatic faucet available. Fund manually at https://lora.algokit.io/testnet/fund')
}
