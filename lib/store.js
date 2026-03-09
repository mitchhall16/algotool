import fs from 'fs'
import path from 'path'
import os from 'os'

const STORE_DIR = path.join(os.homedir(), '.algotool')
const WALLETS_FILE = path.join(STORE_DIR, 'wallets.json')
const CONFIG_FILE = path.join(STORE_DIR, 'config.json')

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true })
}

export function loadWallets() {
  ensureDir()
  if (!fs.existsSync(WALLETS_FILE)) return []
  return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf-8'))
}

export function saveWallets(wallets) {
  ensureDir()
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2))
}

export function addWallets(newWallets) {
  const existing = loadWallets()
  const merged = [...existing, ...newWallets]
  saveWallets(merged)
  return merged
}

export function clearWallets() {
  saveWallets([])
}

export function loadConfig() {
  ensureDir()
  if (!fs.existsSync(CONFIG_FILE)) return { network: 'testnet' }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
}

export function saveConfig(config) {
  ensureDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}
