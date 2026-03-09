# algotool

Algorand developer toolkit — wallets, funding, batch transactions, ASA management, contract interactions, and transaction inspection. Built for testnet developers.

Works as a **CLI** and as a **Claude Code MCP server**, so Claude can manage Algorand wallets and transactions directly in your terminal.

## Install

```bash
git clone https://github.com/mitchhall/algotool.git
cd algotool
npm install
```

Or link globally:

```bash
npm link
```

## Quick Start

```bash
# Create 5 wallets
algotool wallets create 5

# Fund them from the testnet faucet
algotool faucet

# Check balances
algotool status

# Send ALGO from wallet 0 to an address
algotool send 0 RECEIVERADDRESS... 1.5

# Create a token
algotool asa create 0 "My Token" TKN 1000000

# Inspect any transaction
algotool tx TXID...
```

## Architecture

```mermaid
graph TD
    A[algotool CLI] --> C[lib/wallets.js]
    A --> D[lib/transactions.js]
    A --> E[lib/asa.js]
    A --> F[lib/app.js]
    A --> G[lib/inspect.js]

    B[MCP Server] --> C
    B --> D
    B --> E
    B --> F
    B --> G

    C --> H[lib/store.js<br/>~/.algotool/]
    C --> I[lib/algod.js]
    D --> I
    E --> I
    F --> I
    G --> I

    I --> J[Algorand Testnet<br/>algonode.cloud]
    I --> K[Algorand Mainnet<br/>algonode.cloud]

    style A fill:#1a1a2e,stroke:#e94560,color:#fff
    style B fill:#1a1a2e,stroke:#0f3460,color:#fff
    style J fill:#16213e,stroke:#e94560,color:#fff
    style K fill:#16213e,stroke:#0f3460,color:#fff
```

## CLI Reference

### Wallets

| Command | Description |
|---|---|
| `wallets create <N>` | Generate N wallets |
| `wallets list` | Show wallets with balances |
| `wallets export` | Show wallets with mnemonics |
| `wallets import <mnemonic>` | Import wallet from 25-word mnemonic |
| `wallets clear` | Delete all wallets |

### Funding

| Command | Description |
|---|---|
| `faucet [index]` | Fund wallet(s) from testnet faucet (~10 ALGO each) |
| `fund <from> <amount>` | Send ALGO from wallet to all others |
| `send <from> <to-address> <amount>` | Send ALGO to any address |
| `batch <address> <amount>` | All wallets send to one address |

### ASA (Tokens)

| Command | Description |
|---|---|
| `asa create <wallet> <name> <unit> <total> [decimals]` | Create a new ASA |
| `asa optin <wallet> <asset-id>` | Opt into an ASA |
| `asa send <wallet> <to> <asset-id> <amount>` | Transfer tokens |
| `asa info <asset-id>` | Show ASA details |
| `asa list <wallet>` | Show holdings for a wallet |

### Smart Contracts

| Command | Description |
|---|---|
| `app call <wallet> <app-id> [method] [args...]` | Call a contract method |
| `app state <app-id>` | Read global state |
| `app address <app-id>` | Get app escrow address |

### Inspect

| Command | Description |
|---|---|
| `tx <txid>` | Inspect a transaction |
| `group <txid>` | Inspect an atomic group |
| `history <address\|index> [limit]` | Recent transactions |

### Config

| Command | Description |
|---|---|
| `network [testnet\|mainnet]` | Show or set network |
| `status` | Balance overview |

## MCP Server (Claude Code Integration)

The MCP server exposes all algotool functionality as tools that Claude Code can call directly.

### Setup

```bash
claude mcp add --transport stdio algotool -- node /path/to/algotool/bin/mcp-server.js
```

### How it works

```mermaid
sequenceDiagram
    participant U as Developer
    participant C as Claude Code
    participant M as algotool MCP
    participant A as Algorand

    U->>C: "Create 3 wallets and fund them"
    C->>M: wallets_create(count: 3)
    M->>A: Generate accounts
    M-->>C: 3 wallet addresses
    C->>M: faucet()
    M->>A: POST /fund (×3)
    M-->>C: All funded
    C-->>U: "Created and funded 3 wallets"
```

### Available MCP Tools (22)

**Wallets:** `wallets_create`, `wallets_list`, `wallets_export`, `wallets_import`, `wallets_clear`

**Funding:** `faucet`, `send_algo`, `fund_wallets`, `batch_send`

**ASA:** `asa_create`, `asa_optin`, `asa_send`, `asa_info`, `asa_list`

**Smart Contracts:** `app_call`, `app_state`, `app_address`

**Inspect:** `inspect_transaction`, `inspect_group`, `account_history`, `get_balance`

**Config:** `set_network`, `get_network`

## Storage

All data lives in `~/.algotool/`:

```
~/.algotool/
├── wallets.json    # Wallet addresses + encrypted mnemonics
└── config.json     # Network selection (testnet/mainnet)
```

## API

Uses [Nodely](https://nodely.io) (formerly Algonode) free-tier public endpoints:

- **Algod:** `testnet-api.algonode.cloud` / `mainnet-api.algonode.cloud`
- **Indexer:** `testnet-idx.algonode.cloud` / `mainnet-idx.algonode.cloud`
- **Faucet:** `dispenser-api.testnet.aws.algodev.network`
- **Limits:** ~6M requests/month, 60 req/s per IP

## Requirements

- Node.js 18+
- `algosdk` v3
- `@modelcontextprotocol/sdk` (for MCP server)

## License

MIT
