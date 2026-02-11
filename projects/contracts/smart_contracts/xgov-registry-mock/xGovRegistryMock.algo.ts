import {
  abimethod,
  Account,
  BoxMap,
  clone,
  compile,
  Global,
  itxn,
  Txn,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { compileArc4 } from '@algorandfoundation/algorand-typescript/arc4'
import { AccountIdContract } from '../base/base.algo'
import { XGovProposalMock } from '../xgov-proposal-mock/xGovProposalMock.algo'

export type XGovBoxValue = {
  votingAddress: Account
  toleratedAbsences: uint64
  lastVoteTimestamp: uint64
  subscriptionRound: uint64
}

export class XGovRegistryMock extends AccountIdContract {
  xgovBox = BoxMap<Account, XGovBoxValue>({ keyPrefix: 'x' })

  @abimethod({ readonly: true, name: 'get_xgov_box' })
  public getXGovBox(voterAddress: Account): [XGovBoxValue, boolean] {
    const box = this.xgovBox(voterAddress)
    const { exists } = box
    const value: XGovBoxValue = exists ? box.value : this.getEmptyXGovBoxValue()
    return [value, exists]
  }

  private getEmptyXGovBoxValue(): XGovBoxValue {
    return {
      votingAddress: Global.zeroAddress,
      toleratedAbsences: 0,
      lastVoteTimestamp: 0,
      subscriptionRound: 0,
    }
  }

  // Mock methods

  public createProposal(): uint64 {
    const proposalContract = compile(XGovProposalMock)

    const created = itxn
      .applicationCall({
        approvalProgram: proposalContract.approvalProgram, // intentionally using clear state program for "return true"
        clearStateProgram: proposalContract.clearStateProgram,
        globalNumBytes: 2,
        globalNumUint: 4,
      })
      .submit()
    const appId = created.createdApp.id

    const proposal = compileArc4(XGovProposalMock)
    proposal.call.setProposer({ appId, args: [Txn.sender] })

    return appId
  }

  public setXGovBox(voterAddress: Account, value: XGovBoxValue): void {
    this.ensureCallerIsAdmin()
    this.xgovBox(voterAddress).value = clone(value)
  }
}
