# xgov-delegator and [xgov-committee-oracle](#xgov-committee-oracle)

# xgov-delegator

Smart contract to delegate xGov voting power for pooled and liquid staking systems.

- xgov committees
  - needs data to be synced to contract:
    - committee ID
      - read this from proposals to know if delegated account has voting power
    - period start round (inclusive)
    - period end round (exclusive)
    - would currently need trusted offchain component
      - would be good to have this onchain, see xgov-committee-oracle

- external voting power: xgov votes for delegated account (e.g. reti pool, dualstake token, etc)

- internal voting power
  - voting power split between accounts participating
  - metric: algohours
    - corresponds to 1 hour of 1 algo staked in the system
  - offchain/trusted component to generate algohours per committee period.
  - stored per 1M rounds to reduce stored state

## State

### Global

last_account_id: 0

vote_end_threshold: 21600 # earliest we can vote before vote end threshold. e.g. 21600 == 6 hrs in seconds == we can vote 6 hours before proposal vote end time

### Account boxes

key: address

value: uint32 incrementing ID

Assigns uint32 ids to accounts to save 28 bytes per reference

### 1M Algohour totals - total voting power fragment

key: period_start

value: total algohours between [period_start, period_start+1M), uint64

### 1M Algohour per account - voting power fragment

key: [period_start][account_id]

value: algohours, uint64

### Committee Metadata

key: committee_id

value: struct

- period_start
- period_end
- own_total_voting_power
- own_total_algohours
  - sum of [1M Algohour totals] for $period_start, $period_start+1M, $period_start+2M

### Proposal Metadata

key: proposal_id

value: ProposalMetadata struct

- committee_id
- vote_end_time
- total_voting_power
- total_algohours
- voted_algohours
- votes_yes_algohours uint64
- votes_no_algohours uint64
- has_voted_on_xgov_registry bool

### Vote Receipts

key: [account id][proposal_id]

value: empty # if no changing vote allowed

value: [votes_yes,votes_no] # if changing vote is allowed

receipt to ensure each subdelegator votes once

changing votes could be allowed, subtract previous votes_yes / votes_no and add new ones

# xgov-committee-oracle

Store basic committee info and xgov voting power on chain

## global state

last_account_id: 0

## boxes

### Account

As above

### Committee

Key: committee_id

Value: Committee Struct

- period_start
- period_end
- total_votes
- total_xgovs
- state
- ingested_votes
  - keep track of ingested voting power for verification purposes

### Committee > xGov voting power

Use [Superbox](https://github.com/tasosbit/puya-ts-superbox)

key: committee_id

value: Array of tuples [account id uint32, votes uint64]

### Period end to committee ID lookup

key: period end round

value: committee id

## Methods

### upload_committee_metadata(id, start, end, total_votes, total_xgovs)

```
ensure box.p_end_round not set
create box.committee_[id]
```

### ingest_committee_voters(committee_id, tuples: [id, account, votes][])

```
// get committee record for metadata
committee = self.committee_[committee_id]

// account/xgov ingest progress uses superbox size
ingested_accounts = sb_exists ? count() : 0

// get last ingested ID to ensure ascending ID order, deduplication enforcement
last_ingested_id = ingested_accounts > 0 ? [ingested_accounts 1].id : 0

// ensure we are not going over by # of accounts
ensure(ingested_accounts + tuples.length <= committee.total_xgovs)

// buffer to write to superbox once
write_chunk: bytes of shape [id, votes][]
// iterate tuples
foreach tuple in tuples:
  // new account, who dis. create ID
  if id === 0
    assert account_[account] not exists
    id = global.last_account_id + 1
    account_[account] = id
    global.last_account_id += 1
  else:
    assert account_[account] === id
  // assert ascending ID ingestion for dedupe/uniqueness enforcement
   assert id > last_ingested_id
  // keep track of ingested votes
  committee.ingested_votes += votes
  // assert not going over available votes
  assert committee.ingested_votes <= committee.total_votes
  // increase counter
  last_ingested_id = id
  write_chunk += [id, votes]
```

### get_account_id(account) -> uint32

### log_account_ids(accounts[]) -> none

For quick fetching with simulate

### get_xgov_voting_power(committee_id, xgov_account, xgov_offset_hint): uint64

```
ensure box.accounts[xgov_account] == xgov_id_hint
xgov_tuple = get superbox committee_voters[committee_id] offset xgov_offset_hint
ensure xgov_tuple.id === xgov_id_hint
return xgov_tuple.votes
```
