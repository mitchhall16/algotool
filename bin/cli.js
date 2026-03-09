#!/usr/bin/env node

import { createWallets, listWallets, getWalletByIndex } from '../lib/wallets.js'
import { disperseFunds, batchSend, sendAlgo } from '../lib/transactions.js'
import { loadWallets, clearWallets, loadConfig, saveConfig } from '../lib/store.js'
import { getBalance, getNetwork, getAccountInfo } from '../lib/algod.js'
import { createASA, optInASA, transferASA, getASAInfo, getAccountAssets } from '../lib/asa.js'
import { inspectTransaction, inspectGroup, formatTransaction, getAccountHistory } from '../lib/inspect.js'
import { callApp, getAppState, getAppAddress } from '../lib/app.js'

const args = process.argv.slice(2)
const cmd = args[0]
const sub = args[1]

function usage() {
  const net = getNetwork()
  console.log(`
  algotool — Algorand developer toolkit (${net})

  Wallets
    wallets create <N>              Generate N wallets
    wallets list                    Show wallets with balances
    wallets clear                   Delete all wallets
    wallets export                  Show wallets with mnemonics
    wallets import <mnemonic>       Import wallet from 25-word mnemonic

  Funding
    faucet                          Opens Lora testnet faucet in browser
    fund <from> <amount>            Send <amount> ALGO from wallet <from> to all others
    send <from> <to> <amount>       Send ALGO (wallet index -> address)
    batch <address> <amount>        All wallets send <amount> to <address>

  ASA (Tokens)
    asa create <wallet> <name> <unit> <total> [decimals]
                                    Create a new ASA token
    asa optin <wallet> <asset-id>   Opt wallet into an ASA
    asa send <wallet> <to> <asset-id> <amount>
                                    Transfer ASA tokens
    asa info <asset-id>             Show ASA details
    asa list <wallet>               Show ASA holdings for a wallet

  Smart Contracts
    app call <wallet> <app-id> [method] [args...]
                                    Call a smart contract
    app state <app-id>              Read app global state
    app address <app-id>            Get app's escrow address

  Inspect
    tx <txid>                       Inspect a transaction
    group <txid>                    Inspect full atomic group
    history <address> [limit]       Recent transactions for address

  Config
    network [testnet|mainnet]       Show or set network
    status                          Quick balance overview

  Examples:
    algotool wallets create 5
    algotool faucet                   # open faucet in browser
    algotool fund 0 2                 # wallet 0 sends 2 ALGO to each
    algotool send 0 ADDR... 1.5       # wallet 0 sends 1.5 ALGO
    algotool asa create 0 "My Token" TKN 1000000
    algotool tx TXID...               # inspect any transaction
    algotool app state 12345          # read contract state
`)
}

async function main() {
  if (!cmd) { usage(); return }

  // ── wallets ──
  if (cmd === 'wallets') {
    if (sub === 'create') {
      const count = parseInt(args[2]) || 5
      const wallets = createWallets(count)
      const newOnes = wallets.slice(-count)
      console.log(`\nCreated ${count} wallets (${wallets.length} total):\n`)
      for (const w of newOnes) {
        console.log(`  ${w.address}`)
      }
      console.log(`\nSaved to ~/.algotool/wallets.json`)
      return
    }

    if (sub === 'list' || sub === 'ls') {
      const wallets = await listWallets()
      if (wallets.length === 0) {
        console.log('No wallets. Run: algotool wallets create 5')
        return
      }
      console.log(`\n  # | Address                            | Balance`)
      console.log(`  --|------------------------------------|---------`)
      for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i]
        console.log(`  ${String(i).padStart(2)} | ${w.address.slice(0, 8)}...${w.address.slice(-4)} | ${w.balance.toFixed(4)} ALGO`)
      }
      const total = wallets.reduce((s, w) => s + w.balance, 0)
      console.log(`  --|------------------------------------|---------`)
      console.log(`     Total: ${total.toFixed(4)} ALGO across ${wallets.length} wallets\n`)
      return
    }

    if (sub === 'clear') {
      clearWallets()
      console.log('All wallets cleared.')
      return
    }

    if (sub === 'export') {
      const wallets = loadWallets()
      if (wallets.length === 0) {
        console.log('No wallets.')
        return
      }
      console.log(`\n${wallets.length} wallets:\n`)
      for (let i = 0; i < wallets.length; i++) {
        const w = wallets[i]
        console.log(`  Wallet ${i}`)
        console.log(`  Address:  ${w.address}`)
        console.log(`  Mnemonic: ${w.mnemonic}\n`)
      }
      return
    }

    if (sub === 'import') {
      const mnemonic = args.slice(2).join(' ')
      if (!mnemonic || mnemonic.split(' ').length !== 25) {
        console.log('Usage: algotool wallets import <25-word mnemonic>')
        return
      }
      const algosdk = (await import('algosdk')).default
      try {
        const account = algosdk.mnemonicToSecretKey(mnemonic)
        const { addWallets } = await import('../lib/store.js')
        const wallets = addWallets([{
          name: `imported-${Date.now()}`,
          address: account.addr.toString(),
          mnemonic,
        }])
        console.log(`\nImported wallet: ${account.addr.toString()}`)
        console.log(`Total wallets: ${wallets.length}`)
      } catch (e) {
        console.log('Invalid mnemonic:', e.message)
      }
      return
    }

    usage()
    return
  }

  // ── faucet ──
  if (cmd === 'faucet') {
    const wallets = loadWallets()
    if (wallets.length === 0) {
      console.log('No wallets. Run: algotool wallets create 5')
      return
    }

    const url = 'https://lora.algokit.io/testnet/fund'
    console.log(`\nOpening Lora faucet... Copy an address below to fund it:\n`)
    for (let i = 0; i < wallets.length; i++) {
      console.log(`  [${i}] ${wallets[i].address}`)
    }
    console.log(`\n  ${url}\n`)

    const { exec } = await import('child_process')
    exec(`open "${url}"`)
    return
  }

  // ── fund ──
  if (cmd === 'fund') {
    const fromIdx = parseInt(sub) || 0
    const amount = parseFloat(args[2])
    if (!amount || amount <= 0) {
      console.log('Usage: algotool fund <wallet-index> <amount-per-wallet>')
      return
    }

    const wallets = loadWallets()
    const from = wallets[fromIdx]
    if (!from) {
      console.log(`Wallet ${fromIdx} not found. You have ${wallets.length} wallets.`)
      return
    }

    const targets = wallets.filter((_, i) => i !== fromIdx)
    if (targets.length === 0) {
      console.log('Need at least 2 wallets.')
      return
    }

    const fromBal = await getBalance(from.address)
    console.log(`\nFunding ${targets.length} wallets with ${amount} ALGO each from wallet ${fromIdx} (${fromBal.toFixed(4)} ALGO)\n`)
    await disperseFunds(from, targets, amount, console.log)
    console.log('\nDone.')
    return
  }

  // ── send ──
  if (cmd === 'send') {
    const fromIdx = parseInt(sub)
    const toAddr = args[2]
    const amount = parseFloat(args[3])

    if (isNaN(fromIdx) || !toAddr || !amount) {
      console.log('Usage: algotool send <wallet-index> <to-address> <amount>')
      return
    }

    const from = getWalletByIndex(fromIdx)
    if (!from) {
      console.log(`Wallet ${fromIdx} not found.`)
      return
    }

    console.log(`Sending ${amount} ALGO from wallet ${fromIdx} to ${toAddr.slice(0, 8)}...`)
    const result = await sendAlgo(from, toAddr, amount)
    console.log(`Confirmed — txId: ${result.txId}`)
    return
  }

  // ── batch ──
  if (cmd === 'batch') {
    const toAddr = sub
    const amount = parseFloat(args[2])

    if (!toAddr || !amount) {
      console.log('Usage: algotool batch <to-address> <amount-per-wallet>')
      return
    }

    const wallets = loadWallets()
    if (wallets.length === 0) {
      console.log('No wallets. Run: algotool wallets create 5')
      return
    }

    console.log(`\nBatch sending ${amount} ALGO from ${wallets.length} wallets to ${toAddr.slice(0, 8)}...\n`)
    await batchSend(wallets, toAddr, amount, console.log)
    console.log('\nDone.')
    return
  }

  // ── asa ──
  if (cmd === 'asa') {
    if (sub === 'create') {
      const walletIdx = parseInt(args[2])
      const name = args[3]
      const unit = args[4]
      const total = args[5]
      const decimals = parseInt(args[6]) || 0

      if (isNaN(walletIdx) || !name || !unit || !total) {
        console.log('Usage: algotool asa create <wallet> <name> <unit> <total> [decimals]')
        return
      }

      const wallet = getWalletByIndex(walletIdx)
      if (!wallet) { console.log(`Wallet ${walletIdx} not found.`); return }

      console.log(`\nCreating ASA "${name}" (${unit}) — total: ${total}, decimals: ${decimals}`)
      const result = await createASA(wallet, { name, unit, total, decimals })
      console.log(`Created! Asset ID: ${result.assetId}`)
      console.log(`TX: ${result.txId}`)
      return
    }

    if (sub === 'optin') {
      const walletIdx = parseInt(args[2])
      const assetId = parseInt(args[3])

      if (isNaN(walletIdx) || isNaN(assetId)) {
        console.log('Usage: algotool asa optin <wallet> <asset-id>')
        return
      }

      const wallet = getWalletByIndex(walletIdx)
      if (!wallet) { console.log(`Wallet ${walletIdx} not found.`); return }

      console.log(`Opting wallet ${walletIdx} into ASA ${assetId}...`)
      const result = await optInASA(wallet, assetId)
      console.log(`Done! TX: ${result.txId}`)
      return
    }

    if (sub === 'send') {
      const walletIdx = parseInt(args[2])
      const toAddr = args[3]
      const assetId = parseInt(args[4])
      const amount = args[5]

      if (isNaN(walletIdx) || !toAddr || isNaN(assetId) || !amount) {
        console.log('Usage: algotool asa send <wallet> <to-address> <asset-id> <amount>')
        return
      }

      const wallet = getWalletByIndex(walletIdx)
      if (!wallet) { console.log(`Wallet ${walletIdx} not found.`); return }

      console.log(`Sending ${amount} of ASA ${assetId} to ${toAddr.slice(0, 8)}...`)
      const result = await transferASA(wallet, toAddr, assetId, amount)
      console.log(`Done! TX: ${result.txId}`)
      return
    }

    if (sub === 'info') {
      const assetId = parseInt(args[2])
      if (isNaN(assetId)) {
        console.log('Usage: algotool asa info <asset-id>')
        return
      }

      const info = await getASAInfo(assetId)
      const p = info.params
      console.log(`\n  ASA ${assetId}`)
      console.log(`  Name:     ${p['asset-name'] || p.name || '(unnamed)'}`)
      console.log(`  Unit:     ${p['unit-name'] || p['unit-name'] || '?'}`)
      console.log(`  Total:    ${p.total}`)
      console.log(`  Decimals: ${p.decimals}`)
      console.log(`  Creator:  ${p.creator}`)
      if (p.url) console.log(`  URL:      ${p.url}`)
      console.log()
      return
    }

    if (sub === 'list') {
      const walletIdx = parseInt(args[2])
      if (isNaN(walletIdx)) {
        console.log('Usage: algotool asa list <wallet>')
        return
      }

      const wallet = getWalletByIndex(walletIdx)
      if (!wallet) { console.log(`Wallet ${walletIdx} not found.`); return }

      const assets = await getAccountAssets(wallet.address)
      if (assets.length === 0) {
        console.log(`Wallet ${walletIdx} has no ASA holdings.`)
        return
      }

      console.log(`\n  Wallet ${walletIdx} ASA holdings:\n`)
      console.log(`  Asset ID   | Amount          | Frozen`)
      console.log(`  -----------|-----------------|-------`)
      for (const a of assets) {
        console.log(`  ${String(a.id).padEnd(10)} | ${String(a.amount).padEnd(15)} | ${a.frozen ? 'yes' : 'no'}`)
      }
      console.log()
      return
    }

    usage()
    return
  }

  // ── app ──
  if (cmd === 'app') {
    if (sub === 'call') {
      const walletIdx = parseInt(args[2])
      const appId = parseInt(args[3])
      const method = args[4] || undefined
      const extraArgs = args.slice(5)

      if (isNaN(walletIdx) || isNaN(appId)) {
        console.log('Usage: algotool app call <wallet> <app-id> [method-signature] [args...]')
        return
      }

      const wallet = getWalletByIndex(walletIdx)
      if (!wallet) { console.log(`Wallet ${walletIdx} not found.`); return }

      console.log(`Calling app ${appId}${method ? ` method: ${method}` : ''}...`)
      const result = await callApp(wallet, appId, { method, args: extraArgs })
      console.log(`Confirmed! TX: ${result.txId}`)
      return
    }

    if (sub === 'state') {
      const appId = parseInt(args[2])
      if (isNaN(appId)) {
        console.log('Usage: algotool app state <app-id>')
        return
      }

      const { state } = await getAppState(appId)
      console.log(`\n  App ${appId} global state:\n`)
      for (const [key, value] of Object.entries(state)) {
        console.log(`  ${key}: ${value}`)
      }
      console.log()
      return
    }

    if (sub === 'address') {
      const appId = parseInt(args[2])
      if (isNaN(appId)) {
        console.log('Usage: algotool app address <app-id>')
        return
      }

      const addr = await getAppAddress(appId)
      console.log(addr)
      return
    }

    usage()
    return
  }

  // ── tx inspect ──
  if (cmd === 'tx') {
    const txId = sub
    if (!txId) {
      console.log('Usage: algotool tx <txid>')
      return
    }

    const tx = await inspectTransaction(txId)
    console.log(`\n${formatTransaction(tx)}\n`)
    return
  }

  // ── group inspect ──
  if (cmd === 'group') {
    const txId = sub
    if (!txId) {
      console.log('Usage: algotool group <txid>')
      return
    }

    const group = await inspectGroup(txId)
    console.log(`\n  Atomic group — ${group.length} transaction(s)\n`)
    for (let i = 0; i < group.length; i++) {
      console.log(`  ── [${i}] ──`)
      console.log(`  ${formatTransaction(group[i]).split('\n').join('\n  ')}`)
      console.log()
    }
    return
  }

  // ── history ──
  if (cmd === 'history') {
    let address = sub
    const limit = parseInt(args[2]) || 10

    // If it's a number, treat as wallet index
    if (!isNaN(parseInt(address))) {
      const wallet = getWalletByIndex(parseInt(address))
      if (!wallet) { console.log(`Wallet ${address} not found.`); return }
      address = wallet.address
    }

    if (!address) {
      console.log('Usage: algotool history <address|wallet-index> [limit]')
      return
    }

    const txns = await getAccountHistory(address, limit)
    console.log(`\n  Last ${txns.length} transactions for ${address.slice(0, 8)}...${address.slice(-4)}:\n`)
    for (const tx of txns) {
      const type = tx['tx-type'].toUpperCase().padEnd(5)
      let detail = ''
      if (tx['tx-type'] === 'pay') {
        const pay = tx['payment-transaction']
        const dir = tx.sender === address ? '->' : '<-'
        const other = tx.sender === address ? pay.receiver : tx.sender
        detail = `${dir} ${other.slice(0, 8)}...  ${(pay.amount / 1e6)} ALGO`
      } else if (tx['tx-type'] === 'axfer') {
        const axfer = tx['asset-transfer-transaction']
        detail = `ASA ${axfer['asset-id']}  amt: ${axfer.amount}`
      } else if (tx['tx-type'] === 'appl') {
        const app = tx['application-transaction']
        detail = `app ${app['application-id']}`
      }
      console.log(`  ${type} | round ${tx['confirmed-round']} | ${detail}`)
    }
    console.log()
    return
  }

  // ── network ──
  if (cmd === 'network') {
    if (sub === 'testnet' || sub === 'mainnet') {
      const config = loadConfig()
      config.network = sub
      saveConfig(config)
      console.log(`Switched to ${sub}`)
      return
    }
    console.log(`Network: ${getNetwork()}`)
    return
  }

  // ── status ──
  if (cmd === 'status') {
    const wallets = await listWallets()
    if (wallets.length === 0) {
      console.log('No wallets. Run: algotool wallets create 5')
      return
    }
    const total = wallets.reduce((s, w) => s + w.balance, 0)
    const net = getNetwork()
    console.log(`\n  algotool status (${net})\n`)
    console.log(`   # | Address                            | Balance`)
    console.log(`  ---|------------------------------------|---------`)
    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i]
      console.log(`  ${String(i).padStart(2)} | ${w.address.slice(0, 8)}...${w.address.slice(-4)} | ${w.balance.toFixed(4)} ALGO`)
    }
    console.log(`  ---|------------------------------------|---------`)
    console.log(`      Total: ${total.toFixed(4)} ALGO across ${wallets.length} wallets\n`)
    return
  }

  usage()
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
