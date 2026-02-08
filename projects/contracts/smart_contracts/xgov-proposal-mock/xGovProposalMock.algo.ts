import { abimethod, Account, BoxMap, GlobalState, Txn, uint64 } from '@algorandfoundation/algorand-typescript'
import { Contract, StaticBytes } from '@algorandfoundation/algorand-typescript/arc4'
import { CommitteeId } from '../base/types.algo'
import { ensure } from '../base/utils.algo'

// Proposal Status
export const STATUS_EMPTY: uint64 = 0 // Empty structure (default values) for a new proposal, waiting for initialization
export const STATUS_DRAFT: uint64 = 10 // An Empty proposal is initialized (and updated) from the xGov Portal
export const STATUS_SUBMITTED: uint64 = 20 // Draft is submitted to vote by the Proposer after a minimum discussion time
export const STATUS_VOTING: uint64 = 25 // Final proposal is open to vote until the voting session expires
export const STATUS_APPROVED: uint64 = 30 // Approved at the end of voting phase
export const STATUS_REJECTED: uint64 = 40 // Rejected at the end of voting phase
export const STATUS_REVIEWED: uint64 = 45 // Approved proposal has been reviewed
export const STATUS_FUNDED: uint64 = 50 // Proposal has been funded
export const STATUS_BLOCKED: uint64 = 60 // Blocked with veto, the Grant Proposal can not be paid

export class XGovProposalMock extends Contract {
  proposer = GlobalState<Account>({ initialValue: Txn.sender })
  status = GlobalState<uint64>({ key: 'status', initialValue: STATUS_EMPTY })
  committeeId = GlobalState<CommitteeId>({
    key: 'committee_id',
    initialValue: new StaticBytes<32>(),
  })
  voteOpenTs = GlobalState<uint64>({ key: 'vote_open_ts', initialValue: 0 })
  votingDuration = GlobalState<uint64>({ key: 'voting_duration', initialValue: 0 })
  voters = BoxMap<Account, uint64>({ keyPrefix: 'V' })

  @abimethod({ readonly: true, name: 'get_voter_box' })
  public getVoterBox(voterAddress: Account): [uint64, boolean] {
    const box = this.voters(voterAddress)
    const { exists } = box
    const value: uint64 = exists ? box.value : 0
    return [value, exists]
  }

  // Mock methods

  public setProposer(proposer: Account) {
    this.ensureCallerIsProposer()
    this.proposer.value = proposer
  }

  public setStatus(status: uint64): void {
    this.ensureCallerIsProposer()
    this.status.value = status
  }

  public setCommitteeId(committeeId: CommitteeId): void {
    this.ensureCallerIsProposer()
    this.committeeId.value = committeeId
  }

  public setVoteOpenTs(voteOpenTs: uint64): void {
    this.ensureCallerIsProposer()
    this.voteOpenTs.value = voteOpenTs
  }

  public setVotingDuration(votingDuration: uint64): void {
    this.ensureCallerIsProposer()
    this.votingDuration.value = votingDuration
  }

  public setVoterBox(voterAddress: Account, votes: uint64): void {
    this.ensureCallerIsProposer()
    this.voters(voterAddress).value = votes
  }

  private ensureCallerIsProposer(): void {
    const caller = Txn.sender
    ensure(caller === this.proposer.value, 'ERR:AUTH')
  }
}
