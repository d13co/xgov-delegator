import { Account, Bytes, op } from '@algorandfoundation/algorand-typescript'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { describe, expect, it } from 'vitest'
import { AccountIdContract } from './base.algo'
import { expectArc65Error } from './common-tests.algo'
import { errAccountExists, errAccountIdMismatch, errAccountNotExists, errUnauthorized } from './errors.algo'
import { AccountWithId } from './types.algo'
import { u32 } from './utils.algo'

// Expose subroutines for testing
class AccountIdContractTest extends AccountIdContract {
  declare public createAccountId: (account: Account) => Uint32
  declare public getAccountIdIfExists: (account: Account) => Uint32
  declare public mustGetAccountId: (account: Account) => Uint32
  declare public getOrCreateAccountId: (account: AccountWithId) => Uint32
  declare public ensureCallerIsAdmin: () => void
}

describe('Base AccountIdContract contract', () => {
  const ctx = new TestExecutionContext()
  describe('createAccountId', () => {
    it('Creates account id 1 for first account', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      const actual = contract.createAccountId(account)

      const expected = u32(1)
      // is there a better/typed way to compare Uint32 values?
      expect(actual.asUint64()).toEqual(expected.asUint64())

      // test creates box
      const boxKey = Bytes`a`.concat(account.bytes)
      expect(ctx.ledger.boxExists(contract, boxKey)).toBe(true)

      const actualBox = op.btoi(Bytes(ctx.ledger.getBox(contract, boxKey)))
      expect(actualBox).toEqual(expected.asUint64())
    })

    it('Fails when trying to create account twice', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      contract.createAccountId(account)
      expectArc65Error(ctx, () => contract.createAccountId(account), errAccountExists)
    })
  })

  describe('getAccountIdIfExists', () => {
    it('Get account id for nonexistent account returns 0', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      const actual = contract.getAccountIdIfExists(account)

      const expected = u32(0)
      expect(actual.asUint64()).toEqual(expected.asUint64())
    })

    it('Get account id for existing account returns id', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      contract.createAccountId(account)
      const actual = contract.getAccountIdIfExists(account)

      const expected = u32(1)
      expect(actual.asUint64()).toEqual(expected.asUint64())
    })
  })

  describe('mustGetAccountId', () => {
    it('Get account id for existing account returns id', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      contract.createAccountId(account)
      const actual = contract.mustGetAccountId(account)

      const expected = u32(1)
      expect(actual.asUint64()).toEqual(expected.asUint64())
    })

    it('Get account id for nonexistent account throws', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      expectArc65Error(ctx, () => contract.mustGetAccountId(account), errAccountNotExists)
    })
  })

  describe('getOrCreateAccountId', () => {
    it('creates account id if not exists', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      const accountWithIdCreate = { account: account, accountId: u32(0) }
      const actual = contract.getOrCreateAccountId(accountWithIdCreate)

      const expected = u32(1)
      expect(actual.asUint64()).toEqual(expected.asUint64())
    })

    it('validates account ID if it exists', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      const accountWithIdCreate = { account: account, accountId: u32(0) }
      contract.getOrCreateAccountId(accountWithIdCreate)

      const accountWithIdValidate = { account: account, accountId: u32(1) }
      const actual = contract.getOrCreateAccountId(accountWithIdValidate)

      const expected = u32(1)
      expect(actual.asUint64()).toEqual(expected.asUint64())
    })

    it('throws when invalid account ID passed (nonzero)', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      const accountWithIdCreate = { account: account, accountId: u32(0) }
      contract.getOrCreateAccountId(accountWithIdCreate)

      const accountWithIdValidate = { account: account, accountId: u32(2) }
      expectArc65Error(ctx, () => contract.getOrCreateAccountId(accountWithIdValidate), errAccountIdMismatch)
    })

    it('throws when invalid account ID passed (zero)', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      const account = ctx.any.account()

      const accountWithIdCreate = { account: account, accountId: u32(0) }
      contract.getOrCreateAccountId(accountWithIdCreate)

      const accountWithIdValidate = { account: account, accountId: u32(0) }
      expectArc65Error(ctx, () => contract.getOrCreateAccountId(accountWithIdValidate), errAccountIdMismatch)
    })
  })

  describe('ensureCallerIsAdmin', () => {
    it('ensureCallerIsAdmin passes for creator', () => {
      const contract = ctx.contract.create(AccountIdContractTest)
      contract.ensureCallerIsAdmin()
    })

    it('ensureCallerIsAdmin fails for non-creator', async () => {
      ctx.reset() // prevent transient errors when running suite
      const contract = ctx.contract.create(AccountIdContractTest)
      ctx.defaultSender = ctx.any.account() // change sender to non-creator
      await expectArc65Error(ctx, () => contract.ensureCallerIsAdmin(), errUnauthorized)
    })
  })
})
