import { abimethod, Account, BoxMap, clone, Global, uint64 } from '@algorandfoundation/algorand-typescript'
import { AccountIdContract } from '../base/base.algo'

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

  public setXGovBox(voterAddress: Account, value: XGovBoxValue): void {
    this.ensureCallerIsAdmin()
    this.xgovBox(voterAddress).value = clone(value)
  }
}
