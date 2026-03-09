#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import algosdk from 'algosdk'
import { createWallets, listWallets, getWalletByIndex, getAccountFromWallet } from '../lib/wallets.js'
import { loadWallets, clearWallets, addWallets, loadConfig, saveConfig } from '../lib/store.js'
import { getClient, getBalance, fundFromFaucet, getNetwork, getAccountInfo, getIndexer } from '../lib/algod.js'
import { sendAlgo, disperseFunds, batchSend } from '../lib/transactions.js'
import { createASA, optInASA, transferASA, getASAInfo, getAccountAssets } from '../lib/asa.js'
import { inspectTransaction, inspectGroup, formatTransaction, getAccountHistory } from '../lib/inspect.js'
import { callApp, getAppState, getAppAddress } from '../lib/app.js'

const server = new Server(
  { name: 'algotool', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

// ── Tool definitions ──

const TOOLS = [
  // Wallets
  {
    name: 'wallets_create',
    description: 'Create new Algorand wallets. Returns addresses. Wallets are stored locally in ~/.algotool/',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of wallets to create (default: 5)' },
      },
    },
  },
  {
    name: 'wallets_list',
    description: 'List all wallets with their balances',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wallets_export',
    description: 'Export all wallets with their mnemonics (sensitive!)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wallets_import',
    description: 'Import a wallet from a 25-word Algorand mnemonic',
    inputSchema: {
      type: 'object',
      properties: {
        mnemonic: { type: 'string', description: '25-word Algorand mnemonic' },
      },
      required: ['mnemonic'],
    },
  },
  {
    name: 'wallets_clear',
    description: 'Delete all stored wallets. This is destructive!',
    inputSchema: { type: 'object', properties: {} },
  },

  // Funding
  {
    name: 'faucet',
    description: 'Fund wallet(s) from the Algorand testnet faucet. Each wallet gets ~10 ALGO. Only works on testnet.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_index: { type: 'number', description: 'Wallet index to fund (omit to fund all wallets)' },
      },
    },
  },
  {
    name: 'send_algo',
    description: 'Send ALGO from a wallet to an address',
    inputSchema: {
      type: 'object',
      properties: {
        from_wallet: { type: 'number', description: 'Wallet index (0-based)' },
        to_address: { type: 'string', description: 'Recipient Algorand address' },
        amount: { type: 'number', description: 'Amount in ALGO' },
      },
      required: ['from_wallet', 'to_address', 'amount'],
    },
  },
  {
    name: 'fund_wallets',
    description: 'Distribute ALGO from one wallet to all other wallets',
    inputSchema: {
      type: 'object',
      properties: {
        from_wallet: { type: 'number', description: 'Source wallet index' },
        amount_each: { type: 'number', description: 'ALGO per recipient wallet' },
      },
      required: ['from_wallet', 'amount_each'],
    },
  },
  {
    name: 'batch_send',
    description: 'Send ALGO from ALL wallets to a single address',
    inputSchema: {
      type: 'object',
      properties: {
        to_address: { type: 'string', description: 'Recipient address' },
        amount_each: { type: 'number', description: 'ALGO per wallet' },
      },
      required: ['to_address', 'amount_each'],
    },
  },

  // ASA
  {
    name: 'asa_create',
    description: 'Create a new ASA (Algorand Standard Asset / token)',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_index: { type: 'number', description: 'Creator wallet index' },
        name: { type: 'string', description: 'Asset name' },
        unit: { type: 'string', description: 'Unit name (e.g. TKN)' },
        total: { type: 'number', description: 'Total supply' },
        decimals: { type: 'number', description: 'Decimal places (default: 0)' },
        url: { type: 'string', description: 'Asset URL (optional)' },
      },
      required: ['wallet_index', 'name', 'unit', 'total'],
    },
  },
  {
    name: 'asa_optin',
    description: 'Opt a wallet into an ASA (required before receiving)',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_index: { type: 'number', description: 'Wallet index' },
        asset_id: { type: 'number', description: 'Asset ID' },
      },
      required: ['wallet_index', 'asset_id'],
    },
  },
  {
    name: 'asa_send',
    description: 'Transfer ASA tokens from a wallet to an address',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_index: { type: 'number', description: 'Sender wallet index' },
        to_address: { type: 'string', description: 'Recipient address' },
        asset_id: { type: 'number', description: 'Asset ID' },
        amount: { type: 'number', description: 'Amount of tokens' },
      },
      required: ['wallet_index', 'to_address', 'asset_id', 'amount'],
    },
  },
  {
    name: 'asa_info',
    description: 'Get details about an ASA (name, total supply, decimals, creator)',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'number', description: 'Asset ID' },
      },
      required: ['asset_id'],
    },
  },
  {
    name: 'asa_list',
    description: 'List all ASA holdings for a wallet',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_index: { type: 'number', description: 'Wallet index' },
      },
      required: ['wallet_index'],
    },
  },

  // Smart Contracts
  {
    name: 'app_call',
    description: 'Call a smart contract method',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_index: { type: 'number', description: 'Caller wallet index' },
        app_id: { type: 'number', description: 'Application ID' },
        method: { type: 'string', description: 'ABI method signature (optional)' },
        args: { type: 'array', items: { type: 'string' }, description: 'Method arguments as hex strings (optional)' },
      },
      required: ['wallet_index', 'app_id'],
    },
  },
  {
    name: 'app_state',
    description: 'Read global state of a smart contract',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'number', description: 'Application ID' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'app_address',
    description: 'Get the escrow/application address for an app ID',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'number', description: 'Application ID' },
      },
      required: ['app_id'],
    },
  },

  // Inspect
  {
    name: 'inspect_transaction',
    description: 'Inspect a transaction by its ID. Shows sender, receiver, amount, type, fees, notes, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        tx_id: { type: 'string', description: 'Transaction ID' },
      },
      required: ['tx_id'],
    },
  },
  {
    name: 'inspect_group',
    description: 'Inspect all transactions in an atomic group (given any txID from the group)',
    inputSchema: {
      type: 'object',
      properties: {
        tx_id: { type: 'string', description: 'Any transaction ID from the group' },
      },
      required: ['tx_id'],
    },
  },
  {
    name: 'account_history',
    description: 'Get recent transaction history for an address or wallet index',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Algorand address or wallet index number' },
        limit: { type: 'number', description: 'Number of transactions (default: 10)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_balance',
    description: 'Get the ALGO balance for an address or wallet index',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Algorand address or wallet index number' },
      },
      required: ['address'],
    },
  },

  // Config
  {
    name: 'set_network',
    description: 'Switch between testnet and mainnet',
    inputSchema: {
      type: 'object',
      properties: {
        network: { type: 'string', enum: ['testnet', 'mainnet'], description: 'Network to use' },
      },
      required: ['network'],
    },
  },
  {
    name: 'get_network',
    description: 'Get the currently configured network (testnet or mainnet)',
    inputSchema: { type: 'object', properties: {} },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

// ── Tool handler ──

function ok(text) {
  return { content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) }] }
}

function err(msg) {
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
}

function resolveAddress(addressOrIndex) {
  if (/^\d+$/.test(String(addressOrIndex))) {
    const wallet = getWalletByIndex(parseInt(addressOrIndex))
    if (!wallet) throw new Error(`Wallet ${addressOrIndex} not found`)
    return wallet.address
  }
  return String(addressOrIndex)
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: a } = request.params

  try {
    switch (name) {

      // ── Wallets ──
      case 'wallets_create': {
        const count = a?.count || 5
        const wallets = createWallets(count)
        const newOnes = wallets.slice(-count)
        return ok({
          message: `Created ${count} wallets (${wallets.length} total)`,
          wallets: newOnes.map((w, i) => ({ index: wallets.length - count + i, address: w.address })),
        })
      }

      case 'wallets_list': {
        const wallets = await listWallets()
        if (wallets.length === 0) return ok('No wallets. Use wallets_create to generate some.')
        const total = wallets.reduce((s, w) => s + w.balance, 0)
        return ok({
          network: getNetwork(),
          wallets: wallets.map((w, i) => ({ index: i, address: w.address, balance: `${w.balance.toFixed(4)} ALGO` })),
          total: `${total.toFixed(4)} ALGO`,
        })
      }

      case 'wallets_export': {
        const wallets = loadWallets()
        if (wallets.length === 0) return ok('No wallets.')
        return ok({
          wallets: wallets.map((w, i) => ({ index: i, address: w.address, mnemonic: w.mnemonic })),
        })
      }

      case 'wallets_import': {
        const account = algosdk.mnemonicToSecretKey(a.mnemonic)
        const wallets = addWallets([{
          name: `imported-${Date.now()}`,
          address: account.addr.toString(),
          mnemonic: a.mnemonic,
        }])
        return ok({ message: `Imported wallet`, address: account.addr.toString(), total_wallets: wallets.length })
      }

      case 'wallets_clear': {
        clearWallets()
        return ok('All wallets cleared.')
      }

      // ── Funding ──
      case 'faucet': {
        const wallets = loadWallets()
        if (wallets.length === 0) return err('No wallets. Create some first.')

        let targets = wallets
        if (a?.wallet_index !== undefined) {
          if (a.wallet_index < 0 || a.wallet_index >= wallets.length) return err(`Wallet ${a.wallet_index} not found`)
          targets = [wallets[a.wallet_index]]
        }

        const results = []
        for (const w of targets) {
          try {
            await fundFromFaucet(w.address)
            results.push({ address: w.address, status: 'funded' })
          } catch (e) {
            results.push({ address: w.address, status: 'error', error: e.message })
          }
        }
        return ok({ message: `Funded ${results.filter(r => r.status === 'funded').length}/${targets.length} wallets`, results })
      }

      case 'send_algo': {
        const wallet = getWalletByIndex(a.from_wallet)
        if (!wallet) return err(`Wallet ${a.from_wallet} not found`)
        const result = await sendAlgo(wallet, a.to_address, a.amount)
        return ok({ message: `Sent ${a.amount} ALGO`, txId: result.txId, confirmed: result.confirmed })
      }

      case 'fund_wallets': {
        const wallets = loadWallets()
        const from = wallets[a.from_wallet]
        if (!from) return err(`Wallet ${a.from_wallet} not found`)
        const targets = wallets.filter((_, i) => i !== a.from_wallet)
        const results = []
        await disperseFunds(from, targets, a.amount_each, (msg) => results.push(msg))
        return ok({ message: `Distributed ${a.amount_each} ALGO to ${targets.length} wallets`, log: results })
      }

      case 'batch_send': {
        const wallets = loadWallets()
        if (wallets.length === 0) return err('No wallets')
        const results = []
        await batchSend(wallets, a.to_address, a.amount_each, (msg) => results.push(msg))
        return ok({ message: `Batch sent from ${wallets.length} wallets`, log: results })
      }

      // ── ASA ──
      case 'asa_create': {
        const wallet = getWalletByIndex(a.wallet_index)
        if (!wallet) return err(`Wallet ${a.wallet_index} not found`)
        const result = await createASA(wallet, {
          name: a.name, unit: a.unit, total: a.total,
          decimals: a.decimals || 0, url: a.url || '',
        })
        return ok({ message: `Created ASA "${a.name}"`, assetId: result.assetId, txId: result.txId })
      }

      case 'asa_optin': {
        const wallet = getWalletByIndex(a.wallet_index)
        if (!wallet) return err(`Wallet ${a.wallet_index} not found`)
        const result = await optInASA(wallet, a.asset_id)
        return ok({ message: `Opted into ASA ${a.asset_id}`, txId: result.txId })
      }

      case 'asa_send': {
        const wallet = getWalletByIndex(a.wallet_index)
        if (!wallet) return err(`Wallet ${a.wallet_index} not found`)
        const result = await transferASA(wallet, a.to_address, a.asset_id, a.amount)
        return ok({ message: `Sent ${a.amount} of ASA ${a.asset_id}`, txId: result.txId })
      }

      case 'asa_info': {
        const info = await getASAInfo(a.asset_id)
        const p = info.params
        return ok({
          assetId: a.asset_id,
          name: p['asset-name'] || p.name,
          unit: p['unit-name'],
          total: p.total,
          decimals: p.decimals,
          creator: p.creator,
          url: p.url || null,
        })
      }

      case 'asa_list': {
        const wallet = getWalletByIndex(a.wallet_index)
        if (!wallet) return err(`Wallet ${a.wallet_index} not found`)
        const assets = await getAccountAssets(wallet.address)
        return ok({ address: wallet.address, assets })
      }

      // ── Smart Contracts ──
      case 'app_call': {
        const wallet = getWalletByIndex(a.wallet_index)
        if (!wallet) return err(`Wallet ${a.wallet_index} not found`)
        const result = await callApp(wallet, a.app_id, {
          method: a.method, args: a.args || [],
        })
        return ok({ message: `Called app ${a.app_id}`, txId: result.txId })
      }

      case 'app_state': {
        const { state } = await getAppState(a.app_id)
        return ok({ appId: a.app_id, globalState: state })
      }

      case 'app_address': {
        const addr = await getAppAddress(a.app_id)
        return ok({ appId: a.app_id, address: addr })
      }

      // ── Inspect ──
      case 'inspect_transaction': {
        const tx = await inspectTransaction(a.tx_id)
        return ok(formatTransaction(tx))
      }

      case 'inspect_group': {
        const group = await inspectGroup(a.tx_id)
        const formatted = group.map((tx, i) => `[${i}]\n${formatTransaction(tx)}`).join('\n\n')
        return ok(`Atomic group — ${group.length} transactions\n\n${formatted}`)
      }

      case 'account_history': {
        const address = resolveAddress(a.address)
        const limit = a.limit || 10
        const txns = await getAccountHistory(address, limit)
        const lines = txns.map(tx => {
          const type = tx['tx-type']
          let detail = ''
          if (type === 'pay') {
            const pay = tx['payment-transaction']
            detail = `${tx.sender.slice(0, 8)}... → ${pay.receiver.slice(0, 8)}...  ${pay.amount / 1e6} ALGO`
          } else if (type === 'axfer') {
            const axfer = tx['asset-transfer-transaction']
            detail = `ASA ${axfer['asset-id']} amt: ${axfer.amount}`
          } else if (type === 'appl') {
            detail = `app ${tx['application-transaction']['application-id']}`
          }
          return `${type.toUpperCase()} | round ${tx['confirmed-round']} | ${detail}`
        })
        return ok(lines.join('\n'))
      }

      case 'get_balance': {
        const address = resolveAddress(a.address)
        const balance = await getBalance(address)
        return ok({ address, balance: `${balance.toFixed(4)} ALGO` })
      }

      // ── Config ──
      case 'set_network': {
        const config = loadConfig()
        config.network = a.network
        saveConfig(config)
        return ok({ message: `Switched to ${a.network}`, network: a.network })
      }

      case 'get_network': {
        return ok({ network: getNetwork() })
      }

      default:
        return err(`Unknown tool: ${name}`)
    }
  } catch (e) {
    return err(e.message)
  }
})

// ── Start ──

const transport = new StdioServerTransport()
await server.connect(transport)
