import { Account, Bytes } from '@algorandfoundation/algorand-typescript'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { describe, expect, it } from 'vitest'
import { AccountIdContract } from './base.algo'
import { u32 } from './utils.algo'

// class to make subroutines public for testing
class AccountIdContractTest extends AccountIdContract {
  public getAccountIdIfExists(account: Account): Uint32 {
    return super.getAccountIdIfExists(account)
  }
  public createAccountId(account: Account): Uint32 {
    return super.createAccountId(account)
  }
}

describe('Base AccountIdContract contract', () => {
  const ctx = new TestExecutionContext()
  it('Creates account id 1 for first account', () => {
    const contract = ctx.contract.create(AccountIdContractTest)
    const account = ctx.any.account()

    const actual: any = contract.createAccountId(account)

    const expected: any = u32(1)
    // is there a better/typed way to compare Uint32 values?
    expect(actual._value).toEqual(expected._value)

    // test creates box
    const boxKey = Bytes`a`.concat(account.bytes)
    expect(ctx.ledger.boxExists(contract, boxKey)).toBe(true)
    expect(ctx.ledger.getBox(contract, boxKey)).toEqual(expected._value)
  })

  it('Get account id for nonexistent account returns 0', () => {
    const contract = ctx.contract.create(AccountIdContractTest)
    const account = ctx.any.account()

    const actual: any = contract.getAccountIdIfExists(account)

    const expected: any = u32(0)
    expect(actual._value).toEqual(expected._value)
  })

  it('Get account id for existing account returns id', () => {
    const contract = ctx.contract.create(AccountIdContractTest)
    const account = ctx.any.account()

    contract.createAccountId(account)
    const actual: any = contract.getAccountIdIfExists(account)

    const expected: any = u32(1)
    expect(actual._value).toEqual(expected._value)
  })

  it('Fails when trying to create account twice', () => {
    const contract = ctx.contract.create(AccountIdContractTest)
    const account = ctx.any.account()

    contract.createAccountId(account)
    expect(() => contract.createAccountId(account)).toThrowError(/err opcode/)
    // is there a way to get logs from errored transaction?
  })
})
