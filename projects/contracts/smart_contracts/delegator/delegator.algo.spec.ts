import { Application, Bytes } from '@algorandfoundation/algorand-typescript'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it } from 'vitest'
import { expectArc65Error } from '../base/common-tests.algo'
import { errUnauthorized } from '../base/errors.algo'
import { Delegator } from './delegator.algo'

// Expose subroutines for testing
class DelegatorTests extends Delegator {}

describe('Delegator contract', () => {
  const ctx = new TestExecutionContext()

  describe('setCommitteeOracleAppId', () => {
    it('admin can change committeeOracleAppId', () => {
      const contract = ctx.contract.create(DelegatorTests)
      const expected = Application(1)
      contract.setCommitteeOracleAppId(expected)
      const [actual, found] = ctx.ledger.getGlobalState(contract, Bytes('committeeOracleAppId'))
      expect(found).toBe(true)
      expect(actual!.value).toEqual(expected)
    })

    it('non admin cannot change committeeOracleAppId', () => {
      ctx.reset()
      const contract = ctx.contract.create(DelegatorTests)
      ctx.defaultSender = ctx.any.account() // change sender to non-creator
      const expected = Application(1)
      expectArc65Error(ctx, () => contract.setCommitteeOracleAppId(expected), errUnauthorized)
    })
  })
})
