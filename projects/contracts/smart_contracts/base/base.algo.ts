import {
  Account,
  BoxMap,
  compile,
  Contract,
  Global,
  GlobalState,
  itxn,
  OnCompleteAction,
  Txn,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { abimethod, Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { errAccountExists, errAccountIdMismatch, errAccountNotExists, errUnauthorized } from '../oracle/errors.algo'
import { AccountWithId } from '../oracle/types.algo'
import { ensure, ensureExtra, u32 } from './utils.algo'

class EmptyContract extends Contract {}

export abstract class AccountIdContract extends Contract {
  lastAccountId = GlobalState<uint64>({ initialValue: 0 })
  accountIds = BoxMap<Account, Uint32>({ keyPrefix: 'a' })

  /**
   * Get account ID if exists, else return 0
   * @param account
   * @returns
   */
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

  /**
   * Get validated account ID or create account ID
   * @param xGov
   * @returns account ID
   */
  protected getOrCreateAccountId(account: AccountWithId): Uint32 {
    let accountId = this.getAccountIdIfExists(account.account)
    if (accountId.asUint64() === 0) {
      return this.createAccountId(account.account)
    } else {
      ensureExtra(accountId === account.accountId, errAccountIdMismatch, account.accountId.bytes)
      return accountId
    }
  }

  protected mustGetAccountId(account: Account): Uint32 {
    const accountIdBox = this.accountIds(account)
    ensure(accountIdBox.exists, errAccountNotExists)
    return accountIdBox.value
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
