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
import { errAccountExists, errAccountIdMismatch, errAccountNotExists, errUnauthorized } from './errors.algo'
import { AccountWithId } from './types.algo'
import { ensure, ensureExtra, u32 } from './utils.algo'

class EmptyContract extends Contract {}

export abstract class AccountIdContract extends Contract {
  lastAccountId = GlobalState<uint64>({ initialValue: 0 })
  accountIds = BoxMap<Account, Uint32>({ keyPrefix: 'a' })

  /**
   * Create new account ID
   * @param account Account to create ID for
   * @throws ERR:AUTH if account already has ID
   * @returns new account ID
   */
  protected createAccountId(account: Account): Uint32 {
    const box = this.accountIds(account)
    ensure(!box.exists, errAccountExists)
    this.lastAccountId.value++
    const accountId = u32(this.lastAccountId.value)
    box.value = accountId
    return accountId
  }

  /**
   * Get account ID if exists, else return 0
   * @param account Account to get ID for
   * @returns Account ID or 0 if not exists
   */
  protected getAccountIdIfExists(account: Account): Uint32 {
    const box = this.accountIds(account)
    if (box.exists) return box.value
    else return u32(0)
  }

  /**
   * Get account ID or fail
   * @param account Account to get ID for
   * @throws ERR:A_NX if account does not exist
   * @returns Account ID
   */
  protected mustGetAccountId(account: Account): Uint32 {
    const accountIdBox = this.accountIds(account)
    ensure(accountIdBox.exists, errAccountNotExists)
    return accountIdBox.value
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

  /**
   * Ensures the caller is the contract creator (admin)
   * @throws ERR:AUTH if caller is not admin
   */
  protected ensureCallerIsAdmin(): void {
    ensure(Txn.sender === Global.creatorAddress, errUnauthorized)
  }

  /**
   * Utility to increase opcode budget by performing $itxns no-op itxns
   * @param itxns Number of no-op itxns to perform
   */
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
