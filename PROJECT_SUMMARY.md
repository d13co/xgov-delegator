# Project Summary

pnpm monorepo for an Algorand xGov voting delegation system. Two core smart contracts (delegator + committee oracle), two SDKs, a React frontend, and shared resources.

## Workspace Layout

```
xgov-delegator/
  .algokit.toml              # workspace config; build order: contracts -> oracle-sdk -> delegator-sdk
  pnpm-workspace.yaml        # packages: projects/*
  projects/
    contracts/               # PuyaTs smart contracts
    oracle-sdk/              # SDK for committee oracle contract
    delegator-sdk/           # SDK for delegator contract
    frontend/                # React + Vite + TailwindCSS/DaisyUI frontend
    common/                  # Shared committee JSON files + build scripts
```

## projects/contracts

AlgoKit PuyaTs project. Contracts compile to TEAL; typed clients are auto-generated.

### Smart Contracts

| Contract | File | Purpose |
|----------|------|---------|
| `BaseContract` | `base/base.algo.ts` | Abstract base: admin checks, `increaseBudget()` |
| `EmptyContract` | `base/base.algo.ts` | Empty contract used for budget increases |
| Account ID mixin | `base/account-id.algo.ts` | Assigns uint32 IDs to addresses (saves 28 bytes/ref) |
| `Delegator` | `delegator/delegator.algo.ts` | Main delegator: internal voting (algohours) + external delegated xGov votes, proposal voting |
| `CommitteeOracleContract` | `oracle/oracle.algo.ts` | Stores xGov committee data on-chain via Superbox |
| Oracle account sub-contract | `oracle/oracle-account.algo.ts` | Account management for oracle |
| `XGovRegistryMock` | `xgov-registry-mock/xGovRegistryMock.algo.ts` | Mock for testing |
| `XGovProposalMock` | `xgov-proposal-mock/xGovProposalMock.algo.ts` | Mock for testing |

### Shared Contract Code

- `base/errors.algo.ts` - Centralized error constants (`ERR:CODE` format)
- `base/types.algo.ts` - Shared ARC-4 types and structs
- `base/utils.algo.ts` - Utility functions

### Tests

| File | Scope |
|------|-------|
| `base/base.algo.spec.ts` | Base contract unit tests |
| `base/account-id.algo.spec.ts` | Account ID tests |
| `delegator/delegator.algo.spec.ts` | Delegator unit tests |
| `delegator/delegator.simple.e2e.spec.ts` | Delegator simple E2E |
| `delegator/delegator.complex.e2e.spec.ts` | Delegator complex E2E |
| `oracle/oracle.e2e.spec.ts` | Oracle E2E tests |
| `common-tests.ts` | Shared test utilities (deployOracle, createCommittee, etc.) |

### Artifacts

Per contract: `*.approval.teal`, `*.arc32.json`, `*.arc56.json`, `*Client.ts`, `*.puya.map`. Located in `smart_contracts/artifacts/<contract>/`.

### Config

- `vitest.config.mts` - test runner
- `tsconfig.json` - CommonJS, ESNext, strict
- `.algokit.toml` - contract project config

### Commands

```bash
pnpm run build    # compile contracts + generate clients
pnpm run test     # vitest with coverage
```

## projects/oracle-sdk

SDK for the committee oracle contract.

### Structure

```
src/
  index.ts                           # Exports: XGovCommitteesOracleSDK, CommitteeOracleFactory, CommitteeOracleClient, calculateCommitteeId
  sdk.ts                             # Write SDK (extends reader): uploadCommitteeFile() orchestration
  sdkReader.ts                       # Read-only SDK
  types.ts                           # XGovCommitteeFile, AccountWithVotes, StoredXGov, etc.
  constants.ts
  networkConfig.ts
  generated/
    CommitteeOracleClient.ts         # Auto-generated typed client (copied from contracts artifacts)
    errors.ts                        # Auto-generated error map
  util/
    chunk.ts, chunked.ts, comitteeId.ts, increaseBudget.ts,
    requiresSender.ts, wrapErrors.ts, types.ts
examples/
  get.ts, upload.ts                  # Usage examples
```

### Build

Prebuild copies client from contracts artifacts + generates error map, then tsc to `dist/`.

## projects/delegator-sdk

SDK for the delegator contract. Same architecture as oracle-sdk.

### Structure

```
src/
  index.ts                           # Exports: XGovDelegatorSDK, DelegatorFactory, DelegatorClient, types, constants
  sdk.ts                             # Write SDK (extends reader)
  sdkReader.ts                       # Read-only SDK
  types.ts                           # Network, SenderWithSigner, AccountWithAlgoHours, etc.
  constants.ts
  networkConfig.ts
  generated/
    DelegatorClient.ts               # Auto-generated typed client
    errors.ts                        # Auto-generated error map
  util/
    chunk.ts, chunked.ts, comitteeId.ts, increaseBudget.ts,
    requiresSender.ts, wrapErrors.ts, types.ts
```

## projects/frontend

React 18 + Vite + TailwindCSS + DaisyUI.

### Key Dependencies

- `@algorandfoundation/algokit-utils`, `algosdk` - Algorand
- `@txnlab/use-wallet`, `@txnlab/use-wallet-react` - Wallet framework
- `@perawallet/connect`, `@blockshake/defly-connect` - Wallet providers
- `daisyui`, `notistack` - UI

### Structure

```
src/
  main.tsx, App.tsx, Home.tsx
  components/
    ConnectWallet.tsx, Account.tsx, AppCalls.tsx, Transact.tsx, ErrorBoundary.tsx
  contracts/
    Delegator.ts, CommitteeOracle.ts, EmptyContract.ts, Superbox.ts
  utils/
    ellipseAddress.ts, network/getAlgoClientConfigs.ts
  interfaces/network.ts
  styles/main.css
  assets/logo.svg
```

### Commands

```bash
pnpm run dev      # generate clients + dev server
pnpm run build    # generate clients + production build
```

## projects/common

Shared resources across projects.

- `committee-files/` - Committee JSON data (test data + historical)
- `sdks/generate-errors.ts` - Parses `errors.algo.ts` and generates SDK error maps

## Build Pipeline

1. Compile contracts (PuyaTs -> TEAL) + generate typed clients
2. Copy clients to SDK `generated/` folders
3. Generate error maps from `errors.algo.ts`
4. Build SDKs (tsc -> dist/)
5. Frontend links contract clients via AlgoKit

Full workspace build: `algokit project run build` (respects `.algokit.toml` build order)

## Key Patterns

- **Account ID system**: uint32 IDs assigned to addresses to save storage (28 bytes/ref)
- **Superbox**: Efficient large-array box storage via `@d13co/superbox`
- **Reader/Writer SDK split**: Separate classes for read-only vs write operations
- **Generated + hand-written**: Clients auto-generated, SDK logic hand-written on top
- **Error wrapping**: Contract `ERR:CODE` constants -> SDK human-readable messages
- **Budget management**: `increaseBudget()` calls via empty contract for complex operations
- **Dual voting power**: Internal (algohours) + external (delegated xGov votes)
