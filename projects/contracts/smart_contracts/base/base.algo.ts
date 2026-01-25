import { Account, BoxMap, compile, Contract, Global, GlobalState, itxn, OnCompleteAction, Txn, uint64 } from '@algorandfoundation/algorand-typescript'
import { abimethod, Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { errAccountExists, errUnauthorized } from '../oracle/errors.algo'
import { ensure, u32 } from './utils.algo'

class EmptyContract extends Contract {}

export abstract class AccountIdContract extends Contract {
  lastAccountId = GlobalState<uint64>({ initialValue: 0 })
  accountIds = BoxMap<Account, Uint32>({ keyPrefix: 'a' })

  protected getAccountIdIfExists(account: Account): Uint32 {
    const box = this.accountIds(account)
    if (box.exists) return box.value
    else return u32(0)
  }

  protected createAccountId(account: Account): Uint32 {
    const box = this.accountIds(account)
    ensure(!box.exists, errAccountExists)
    this.lastAccountId.value++
    const accountId = u32(this.lastAccountId.value)
    box.value = accountId
    return accountId
  }

  protected ensureCallerIsAdmin(): void {
    ensure(Txn.sender === Global.creatorAddress, errUnauthorized)
  }

  @abimethod({ validateEncoding: 'unsafe-disabled' })
  public increaseBudget(itxns: uint64) {
    const empty = compile(EmptyContract)
    for (let i: uint64 = 0; i < itxns; i++) {
      itxn
        .applicationCall({
          approvalProgram: empty.clearStateProgram, // intentionally using clear state program for "return true"
          clearStateProgram: empty.clearStateProgram,
          onCompletion: OnCompleteAction.DeleteApplication,
        })
        .submit()
    }
  }
}
