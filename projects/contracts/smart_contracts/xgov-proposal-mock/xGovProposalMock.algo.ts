import { abimethod, Account, BoxMap, GlobalState, uint64 } from '@algorandfoundation/algorand-typescript'
import { AccountIdContract } from '../base/base.algo'
import { CommitteeId } from '../base/types.algo'

export class XGovProposalMock extends AccountIdContract {
  committeeId = GlobalState<CommitteeId>({ key: 'committee_id' })
  voteOpenTs = GlobalState<uint64>({ key: 'vote_open_ts' })
  voters = BoxMap<Account, uint64>({ keyPrefix: 'V' })

  @abimethod({ readonly: true, name: 'get_voter_box' })
  public getVoterBox(voterAddress: Account): [uint64, boolean] {
    const box = this.voters(voterAddress)
    const { exists } = box
    const value: uint64 = exists ? box.value : 0
    return [value, exists]
  }

  // Mock methods

  public setCommitteeId(committeeId: CommitteeId): void {
    this.ensureCallerIsAdmin()
    this.committeeId.value = committeeId
  }

  public setVoteOpenTs(voteOpenTs: uint64): void {
    this.ensureCallerIsAdmin()
    this.voteOpenTs.value = voteOpenTs
  }

  public setVoterBox(voterAddress: Account, votes: uint64): void {
    this.ensureCallerIsAdmin()
    this.voters(voterAddress).value = votes
  }
}
