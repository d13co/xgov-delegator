# xgov-delegator and [xgov-committee-oracle](#xgov-committee-oracle)

## What is this?

When you stake ALGO through pooled or liquid staking protocols (Reti, xALGO, tALGO, etc.), the protocol's smart contract holds your ALGO and is credited with your xGov voting power.

**xgov-delegator** is a system of smart contracts and SDKs that lets staking protocols delegate xGov voting power to their individual participants, proportional to their stake. Participants vote internally on xGov proposals, and the system submits the aggregated result on-chain before the xGov deadline.

The system has two parts:

- **xgov-committee-oracle** - Stores xGov committee membership and voting power on-chain as a shared data source.
- **xgov-delegator** - Tracks internal voting power (via algohours), runs proposal votes among participants, and submits the final tally to the xGov registry.

Both contracts, TypeScript SDKs, and a React frontend are included in this monorepo. See [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) for the full architecture.

## Internal voting power: algohours

The delegator needs a fair way to split voting power among participants whose stake changes over time. It uses **algohours** - 1 algohour equals 1 ALGO staked for 1 hour.

A participant who stakes 100 ALGO for 30 days earns more voting power than one who stakes 1000 ALGO for the last hour before a vote. This rewards sustained commitment rather than last-minute capital.

Algohours are stored on-chain in **1M-round timeslices** (~30 days at ~2.6s rounds). Each timeslice tracks a per-account algohour value and a period total. When a proposal vote is synced, the contract sums all timeslices that fall within the committee period to determine each participant's share of the total internal voting power.

The flow:

1. An off-chain process computes algohours per account for each timeslice from staking data.
2. An admin uploads these to the contract via `addAccountAlgoHours`.
3. Once a timeslice is complete, it is marked as `final` - locking the data.
4. When a participant votes on a proposal, the contract aggregates their algohours across all relevant timeslices to determine their voting weight.
5. On vote submission, internal algohour votes are translated proportionally into external xGov votes.

Two **absentee modes** control how non-voters are handled:

- **strict** - Non-voters count against approval. The denominator is total algohours, so abstention is effectively a "no."
- **scaled** - Only votes cast are counted. The denominator is voted algohours, so the result reflects the will of active participants only.

---

# xgov-delegator

Smart contract to delegate xGov voting power for pooled and liquid staking systems.

- xgov committees
  - needs data to be synced to contract:
    - committee ID
      - read this from proposals to know if delegated account has voting power
    - period start round (inclusive)
    - period end round (exclusive)
    - sync from xgov-committee-oracle
      - do we need to get xgov delegations from registry?

- external voting power
  - xgov votes delegated to this system on xGov registry. Delegators would usually be smart contract account(s) (e.g. reti pool, dualstake token, etc)
  - support multiple accounts. E.g. reti can have up to 4 pools, xALGO/tALGO have multiple participating contract escrows. Etc

- internal voting power
  - voting power split between accounts participating
  - metric: algohours
    - corresponds to 1 hour of 1 algo staked in the system
  - offchain/trusted component to generate algohours per committee period
  - stored per 1M rounds to reduce stored state

## State

### Global

- `last_account_id`: uint32 (0) - incrementing account ID counter
- `committeeOracleApp`: Application - Committee Oracle Application ID
- `voteSubmitThreshold`: uint64 (10800) - time in seconds before external vote end to submit votes (default: 3 hours)
- `absenteeMode`: string ('strict') - absentee mode: 'strict' or 'scaled'

### Account boxes (keyPrefix: 'a')

key: address

value: uint32 incrementing ID

Assigns uint32 ids to accounts to save 28 bytes per reference

### Algohour Period Totals (keyPrefix: 'H')

Total internal voting power per period fragment (1M rounds)

key: period_start (uint64, aligned to 1M)

value: AlgohourPeriodTotals struct
- `totalAlgohours`: uint64 - total algohours between [period_start, period_start+1M)
- `final`: boolean - indicates account algohour records are complete for this period

### Algohour per Account (keyPrefix: 'h')

Account internal voting power per 1M period fragment

key: [period_start (uint64), account_id (uint32)]

value: algohours (uint64)

### Committee Metadata (keyPrefix: 'C')

Synced committee details with own delegated totals

key: committee_id (byte[32])

value: DelegatorCommittee struct
- `periodStart`: uint32
- `periodEnd`: uint32
- `extDelegatedVotes`: uint32 - total voting power delegated by xGov. Can be split across multiple accounts
- `extDelegatedAccountVotes`: [accountId uint32, votes uint32][] - individual delegated xGov accounts & their voting power

### Proposal Metadata (keyPrefix: 'P')

key: proposal_id (Application)

value: DelegatorProposal struct
- `status`: string - 'WAIT' | 'VOTE' | 'VOTD' | 'CANC'
- `committeeId`: byte[32]
- `extVoteStartTime`: uint32
- `extVoteEndTime`: uint32
- `extTotalVotingPower`: uint32 (not dupe - committee member may have been removed for absenteeism)
- `extAccountsPendingVotes`: [accountId uint32, votes uint32][] - added when synced, removed when vote is cast
- `extAccountsVoted`: [accountId uint32, votes uint32][] - accounts that have voted
- `intVoteEndTime`: uint32 - set earlier than external to allow for vote submission before xGov proposal voting ends
- `intTotalAlgohours`: uint64 - sum of algohour period totals for committee periods
- `intVotedAlgohours`: uint64
- `intVotesYesAlgohours`: uint64
- `intVotesNoAlgohours`: uint64
- `intVotesAbstainAlgohours`: uint64
- `intVotesBoycottAlgohours`: uint64

### Vote Records (keyPrefix: 'V')

key: [proposal_id (Application), account_id (uint32)]

value: DelegatorVote struct
- `yesVotes`: uint64
- `noVotes`: uint64
- `abstainVotes`: uint64
- `boycottVotes`: uint64

Tracks each participant's vote per proposal. Votes can be changed — previous votes are subtracted and new votes added.

## Methods

### Admin Methods

- `setCommitteeOracleApp(appId: Application)` - Set the Committee Oracle Application ID
- `setVoteSubmitThreshold(threshold: uint64)` - Set the vote submit threshold (time in seconds before external vote end)
- `setAbsenteeMode(mode: 'strict' | 'scaled')` - Set the absentee mode
- `addAccountAlgoHours(periodStart: uint64, accountAlgohourInputs: [account, hours][])` - Add account algohours and update total for period
- `removeAccountAlgoHours(periodStart: uint64, accountAlgohourInputs: [account, hours][])` - Remove account algohours and update total for period
- `updateAlgoHourPeriodFinality(periodStart: uint64, totalAlgohours: uint64, final: boolean)` - Update period algohour finality status

### Sync Methods

- `syncCommitteeMetadata(committeeId: byte[32], delegatedAccounts: Account[])` - Sync committee metadata and delegated accounts from CommitteeOracle
- `syncProposalMetadata(proposalId: Application)` - Sync proposal metadata from xGov registry

### Voting Methods

- `voteInternal(proposalId: Application, voterAccount: Account, vote: DelegatorVote)` - Cast internal vote for a proposal. Voter must be the account that earned the algohours. Votes can be changed.
- `voteExternal(proposalId: Application, extAccounts: Account[])` - Submit aggregated votes to the xGov proposal contract for each external account

### Read Methods

- `getAlgoHourPeriodTotals(periodStart: uint64)` - Get total algohours and finality for period
- `getAccountAlgoHours(periodStart: uint64, account: Account)` - Get account algohours for period
- `logCommitteeMetadata(committeeIds: CommitteeId[])` - Log committee metadata for multiple committees
- `logProposalMetadata(proposalIds: Application[])` - Log proposal metadata for multiple proposals

# xgov-committee-oracle

Store basic committee info and xgov voting power on chain

## Global State

- `lastAccountId`: uint64 (0) - incrementing account ID counter
- `lastCommitteeId`: uint64 (0) - incrementing numeric ID for committees (used as superbox prefix)
- `xGovRegistryApp`: Application - xGov registry application ID

## Boxes

### Account (keyPrefix: 'a')

key: address

value: OracleAccount struct
- `accountId`: uint32 - incrementing ID
- `committeeOffsets`: [committeeNumId uint16, accountOffset uint16][] - superbox offset hints per committee

### Committee (keyPrefix: 'c')

Key: committee_id (byte[32])

Value: CommitteeMetadata struct
- `numericId`: uint16 - incrementing numeric ID, used to derive superbox prefix ('S' + numericId)
- `periodStart`: uint32
- `periodEnd`: uint32 (exclusive)
- `totalMembers`: uint32
- `totalVotes`: uint32
- `xGovRegistryId`: uint64
- `ingestedVotes`: uint32 - keep track of ingested voting power for verification

### Committee > xGov voting power

Uses [Superbox](https://github.com/tasosbit/puya-ts-superbox)

key: superbox_prefix

value: Array of tuples [accountId uint32, votes uint32]

## Methods

### Admin Methods

- `registerCommittee(committeeId, periodStart, periodEnd, totalMembers, totalVotes, xGovRegistryId)` - Register a committee

```
ensure committee not exists
ensure period_end > period_start
create committee box
create superbox with prefix 'S' + lastCommitteeId
increment lastCommitteeId
```

- `unregisterCommittee(committeeId)` - Delete committee. Must not have any ingested votes

```
ensure committee exists
ensure ingested_votes === 0
delete committee box
delete superbox
```

- `ingestXGovs(committeeId, xGovs: [account, votes][])` - Ingest xGovs into a committee

```
// get committee record for metadata
committee = self.committees[committee_id]
// account/xgov ingest progress uses superbox size
ingested_accounts = count from superbox
// get last ingested ID to ensure ascending ID order, deduplication enforcement
last_ingested_id = ingested_accounts > 0 ? [ingested_accounts - 1].id : 0
// ensure we are not going over by # of accounts
ensure(ingested_accounts + xGovs.length <= committee.total_members)
// buffer to write to superbox once
write_chunk: bytes of shape [id, votes][]
// iterate xGovs
foreach xGov in xGovs:
  // get or create oracle account
  oracleAccount = getOrCreateAccount(account)
  account_id = oracleAccount.accountId
  // assert ascending ID ingestion for dedupe/uniqueness enforcement
  assert account_id > last_ingested_id
  // store committee offset hint on oracle account
  addCommitteeAccountOffsetHint(committee.numericId, account, oracleAccount, ingestedAccountCtr++)
  // keep track of ingested votes
  ingested_votes += votes
  // increase counter
  last_ingested_id = account_id
  write_chunk += [account_id, votes]
// assert not going over available votes
ensure ingested_votes <= committee.total_votes
// write to superbox once
sbAppend(superbox_name, write_chunk)
// if finished, ensure total votes match
if ingested_accounts + xGovs.length === committee.total_members
  ensure committee.ingested_votes === committee.total_votes
```

- `uningestXGovs(committeeId, xGovs: Account[])` - Delete xGovs from committee superbox (strictly descending order)
- `setXGovRegistryApp(appId: Application)` - Set the xGov Registry Application ID

### Read Methods

- `getAccount(account)` -> OracleAccount - Get account (with ID and committee offsets) if exists, else return empty
- `logAccounts(accounts[])` - Log multiple accounts' OracleAccount data for quick fetching with simulate
- `getCommitteeMetadata(committeeId, mustBeComplete: boolean)` -> CommitteeMetadata - Get committee metadata
- `logCommitteeMetadata(committeeIds[])` - Log committee metadata for multiple committees
- `logCommitteePages(committeeId, logMetadata, startDataPage, dataPageLength)` - Facilitates fetching committee in "one shot" / parallel queries. Logs metadata, superbox meta, and data pages
- `getCommitteeSuperboxMeta(committeeId)` -> SuperboxMeta - Get committee superbox metadata
- `getXGovVotingPower(committeeId, account)` -> uint32 - Get xGov voting power (offset looked up from account's committeeOffsets)

```
ensure committee exists
oracleAccount = getAccountIfExists(account)
ensure oracleAccount.accountId !== 0
offset = lookup from oracleAccount.committeeOffsets by committee numericId
xGov = get superbox xGov at offset
ensure xGov.accountId === oracleAccount.accountId
return xGov.votes
```
