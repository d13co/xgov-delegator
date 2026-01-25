# xgov-delegator and [xgov-committee-oracle](#xgov-committee-oracle)

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

last_account_id: 0

vote_end_threshold: 21600 # earliest we can vote before vote end threshold. e.g. 21600 == 6 hrs in seconds == we can vote 6 hours before proposal vote end time

### Account boxes

key: address

value: uint32 incrementing ID

Assigns uint32 ids to accounts to save 28 bytes per reference

### 1M Algohour totals - total internal voting power (period fragment)

key: period_start

value: total algohours between [period_start, period_start+1M), uint64

### 1M Algohour per account - account internal voting power (period fragment)

key: [period_start][account_id]

value: algohours, uint64

### Committee Metadata

key: committee_id

value: struct

- period_start
- period_end
- ext_total_voting_power
  - total voting power delegated by xGov. Can be split across multiple accounts.
- ext_delegated_accounts_voting_power
  - individual delegated xGov accounts & their voting power
  - [account ID uint32, votes uint64][]
- int_total_algohours
  - sum of [1M Algohour totals] for $period_start, $period_start+1M, $period_start+2M

### Proposal Metadata

key: proposal_id

value: ProposalMetadata struct

- committee_id
- ext_vote_end_time
- ext_total_voting_power (dupe? we have in committee)
- ext_accounts_voted_on_xgov_registry
  - AccountID[]
  - Added when vote is cast
- int_vote_end_time
- int_total_algohours (dupe? we have in committee)
- int_voted_algohours
- int_votes_yes_algohours uint64
- int_votes_no_algohours uint64

### Vote Receipts

key: [account id][proposal_id]

value: empty                  # if no changing vote allowed

value: [votes_yes,votes_no]   # if changing vote is allowed

receipt to ensure each subdelegator votes once

changing votes could be allowed, subtract previous votes_yes / votes_no and add new ones

# xgov-committee-oracle

Store basic committee info and xgov voting power on chain

## global state

last_account_id: 0
last_superbox_prefix: 0

## boxes

### Account

As above

### Committee

Key: committee_id

Value: Committee Struct

- period_start
- period_end
- total_xgovs
- total_votes
- ingested_votes
  - keep track of ingested voting power for verification purposes
- superbox_prefix

### Committee > xGov voting power

Use [Superbox](https://github.com/tasosbit/puya-ts-superbox)

key: superbox_prefix

value: Array of tuples [account id uint32, votes uint32]

## Methods

### registerCommittee(id, start, end, total_xgovs, total_votes)

```
ensure committee not exists
ensure period_end > period_start
create box.committee_[id]
create superbox
```

### unregisterCommittee(committee_id)

```
ensure committee exists
ensure ingested_votes === 0
delete committee box
delete superbox
```

### ingestXGovs(committee_id, xGovs: [account_id, account, votes][])

```
// get committee record for metadata
committee = self.committee_[committee_id]
// account/xgov ingest progress uses superbox size
ingested_accounts = sb_exists ? count() : 0
// get last ingested ID to ensure ascending ID order, deduplication enforcement
last_ingested_id = ingested_accounts > 0 ? [ingested_accounts - 1].id : 0
// ensure we are not going over by # of accounts
ensure(ingested_accounts + xGovs.length <= committee.total_xgovs)
// buffer to write to superbox once
write_chunk: bytes of shape [id, votes][]
// iterate xGovs
foreach xGov in xGovs:
  // get or create account id
  if account_id === 0
    assert account_[account] not exists
    id = global.last_account_id + 1
    account_[account] = id
    global.last_account_id += 1
  else:
    assert account_[account] === account_id
  // assert ascending ID ingestion for dedupe/uniqueness enforcement
  assert id > last_ingested_id
  // keep track of ingested votes
  committee.ingested_votes += votes
  // assert not going over available votes
  assert committee.ingested_votes <= committee.total_votes
  // increase counter
  last_ingested_id = id
  write_chunk += [id, votes]
// if finished, ensure total votes match
if ingested_accounts + xGovs.length === committee.total_xgovs
  ensure committee.ingested_votes === committee.total_votes
```

### uningestXGovs(committee_id, num_xgovs)

Delete last N xGovs from committee superbox

### getAccountId(account) -> uint32

### logAccountIds(accounts[]) -> none

For quick fetching with simulate

### getCommitteeMetadata(committee_id) -> CommitteeMetadata

### logCommitteeMetadata(committee_ids[]) -> none

For quick fetching with simulate

### getCommitteeSuperboxMeta(committee_id) -> SuperboxMeta

### getXGovVotingPower(committee_id, account, account_offset_hint): uint32

```
ensure committee exists
ensure box.accounts[account] exists
xGov = get superbox xGov at offset account_offset_hint
ensure xGov.account_id === account_id
return xGov.votes
```
