import algosdk from 'algosdk'
import { addWallets, loadWallets } from './store.js'
import { getBalance } from './algod.js'

export function createWallets(count) {
  const wallets = []
  for (let i = 0; i < count; i++) {
    const account = algosdk.generateAccount()
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk)
    wallets.push({
      name: `wallet-${Date.now()}-${i + 1}`,
      address: account.addr.toString(),
      mnemonic,
    })
  }
  return addWallets(wallets)
}

export async function listWallets() {
  const wallets = loadWallets()
  if (wallets.length === 0) return []

  const results = []
  for (const w of wallets) {
    const balance = await getBalance(w.address)
    results.push({ ...w, balance })
  }
  return results
}

export function getWalletByIndex(index) {
  const wallets = loadWallets()
  if (index < 0 || index >= wallets.length) return null
  return wallets[index]
}

export function getAccountFromWallet(wallet) {
  return algosdk.mnemonicToSecretKey(wallet.mnemonic)
}
