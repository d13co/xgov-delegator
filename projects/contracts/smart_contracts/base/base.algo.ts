import { Account, BoxMap, Contract, GlobalState, uint64 } from '@algorandfoundation/algorand-typescript'
import { Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { ensure, u32 } from './utils.algo'

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
    ensure(!box.exists, 'ERR:A_EX')
    this.lastAccountId.value++
    const accountId = u32(this.lastAccountId.value)
    box.value = accountId
    return accountId
  }
}
