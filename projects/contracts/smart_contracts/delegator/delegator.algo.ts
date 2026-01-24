import { Txn } from '@algorandfoundation/algorand-typescript'
import { Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { AccountIdContract } from '../base/base.algo'
import { ensure, u32 } from '../base/utils.algo'

export class Delegator extends AccountIdContract {
  public add(): Uint32 {
    return this.createAccountId(Txn.sender)
  }

  public get(): Uint32 {
    const id = this.getAccountIdIfExists(Txn.sender)
    // just testing if puya still merges the error code with the prefix
    return id
  }
}
